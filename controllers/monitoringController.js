const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const eventBuffer = require('../utils/eventBuffer');
const env = require('../config/env');

const execFileAsync = promisify(execFile);

const STARTED_AT = Date.now();
const PM2_LOG_DIR = process.env.PM2_HOME
  ? path.join(process.env.PM2_HOME, 'logs')
  : path.join(os.homedir(), '.pm2', 'logs');

function bytes(n) {
  return Number(n) || 0;
}

function fmtBytes(n) {
  const v = bytes(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}

function redactLine(line) {
  return String(line || '')
    .replace(/(password|passwd|secret|token|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
}

const LOG_LINE_LIMIT = 50;
const LOG_BYTE_LIMIT = 48 * 1024;

async function tailFile(filePath, maxLines = LOG_LINE_LIMIT, maxBytes = LOG_BYTE_LIMIT) {
  try {
    const st = await fsp.stat(filePath);
    const start = Math.max(0, st.size - maxBytes);
    const fh = await fsp.open(filePath, 'r');
    try {
      const len = st.size - start;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      const lines = buf
        .toString('utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(-maxLines)
        .map(redactLine);
      return {
        path: path.basename(filePath),
        lines,
        limit: maxLines,
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    } finally {
      await fh.close();
    }
  } catch {
    return {
      path: path.basename(filePath),
      lines: [],
      limit: maxLines,
      size: 0,
      mtime: null,
      missing: true,
    };
  }
}

async function readLogs(limit = LOG_LINE_LIMIT) {
  const n = Math.min(100, Math.max(1, Number(limit) || LOG_LINE_LIMIT));
  const [out, error] = await Promise.all([
    tailFile(path.join(PM2_LOG_DIR, 'adserver-backend-out.log'), n),
    tailFile(path.join(PM2_LOG_DIR, 'adserver-backend-error.log'), n),
  ]);
  return { out, error, generated_at: new Date().toISOString() };
}

/** Cache berat (PM2 + ukuran creative) agar overview tidak mahal tiap refresh. */
let heavyCache = { at: 0, pm2: null, creativesStorage: null, disk: null };
const HEAVY_TTL_MS = 20_000;

async function loadHeavyCached() {
  const now = Date.now();
  if (now - heavyCache.at < HEAVY_TTL_MS && heavyCache.pm2 !== undefined) {
    return heavyCache;
  }
  const [pm2, creativesStorage, disk] = await Promise.all([
    loadPm2(),
    dirSize(path.join(__dirname, '..', 'public', 'creatives')),
    diskInfo('/var/www/ads-server'),
  ]);
  heavyCache = { at: now, pm2, creativesStorage, disk };
  return heavyCache;
}

async function dirSize(dir, maxFiles = 5000) {
  let total = 0;
  let files = 0;
  async function walk(d) {
    if (files >= maxFiles) return;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files >= maxFiles) return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        await walk(p);
      } else if (ent.isFile()) {
        try {
          const st = await fsp.stat(p);
          total += st.size;
          files += 1;
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(dir);
  return { bytes: total, files, truncated: files >= maxFiles };
}

async function loadPm2() {
  try {
    const { stdout } = await execFileAsync('pm2', ['jlist'], {
      timeout: 4000,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    const list = JSON.parse(stdout || '[]');
    return (Array.isArray(list) ? list : [])
      .filter((p) => String(p.name || '').includes('adserver'))
      .map((p) => ({
        name: p.name,
        status: p.pm2_env?.status || 'unknown',
        pid: p.pid || null,
        cpu: p.monit?.cpu ?? null,
        memory: p.monit?.memory ?? null,
        memory_label: fmtBytes(p.monit?.memory),
        restarts: p.pm2_env?.restart_time ?? 0,
        uptime_ms: p.pm2_env?.pm_uptime ? Date.now() - Number(p.pm2_env.pm_uptime) : null,
        unstable_restarts: p.pm2_env?.unstable_restarts ?? 0,
      }));
  } catch {
    return null;
  }
}

async function diskInfo(targetPath) {
  try {
    if (typeof fsp.statfs === 'function') {
      const s = await fsp.statfs(targetPath);
      const total = Number(s.blocks) * Number(s.bsize);
      const free = Number(s.bfree) * Number(s.bsize);
      const available = Number(s.bavail) * Number(s.bsize);
      const used = total - free;
      return {
        path: targetPath,
        total,
        used,
        available,
        total_label: fmtBytes(total),
        used_label: fmtBytes(used),
        available_label: fmtBytes(available),
        used_pct: total > 0 ? Math.round((used / total) * 1000) / 10 : null,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

const overview = asyncHandler(async (req, res) => {
  const mem = process.memoryUsage();
  const load = os.loadavg();

  let dbOk = false;
  let dbError = null;
  try {
    await db.sequelize.authenticate();
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : 'DB error';
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    publishers,
    publishersPending,
    publishersActive,
    publishersBlocked,
    campaigns,
    campaignsActive,
    creatives,
    users,
    events24h,
    heavy,
  ] = await Promise.all([
    db.Publisher.count(),
    db.Publisher.count({ where: { status: 'pending' } }),
    db.Publisher.count({ where: { status: 'active' } }),
    db.Publisher.count({ where: { status: 'blocked' } }),
    db.Campaign.count(),
    db.Campaign.count({ where: { status: 'active' } }),
    db.Creative.count(),
    db.User.count({ where: { is_active: true } }),
    dbOk
      ? db.Event.count({ where: { occurred_at: { [db.Sequelize.Op.gte]: since24h } } })
      : Promise.resolve(0),
    loadHeavyCached(),
  ]);
  const { pm2, creativesStorage, disk } = heavy;

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      app: {
        name: 'jobosrv. API',
        env: env.NODE_ENV,
        version: '1.0.0',
        public_base_url: env.PUBLIC_BASE_URL,
        frontend_origin: env.FRONTEND_ORIGIN,
        node: process.version,
        pid: process.pid,
        uptime_sec: Math.floor(process.uptime()),
        started_at: new Date(STARTED_AT).toISOString(),
      },
      process: {
        memory: {
          rss: mem.rss,
          heap_used: mem.heapUsed,
          heap_total: mem.heapTotal,
          external: mem.external,
          rss_label: fmtBytes(mem.rss),
          heap_used_label: fmtBytes(mem.heapUsed),
          heap_total_label: fmtBytes(mem.heapTotal),
        },
        cpu_count: os.cpus().length,
        loadavg: {
          '1m': Math.round(load[0] * 100) / 100,
          '5m': Math.round(load[1] * 100) / 100,
          '15m': Math.round(load[2] * 100) / 100,
        },
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        freemem: os.freemem(),
        totalmem: os.totalmem(),
        freemem_label: fmtBytes(os.freemem()),
        totalmem_label: fmtBytes(os.totalmem()),
      },
      database: {
        status: dbOk ? 'up' : 'down',
        error: dbError,
      },
      event_buffer: eventBuffer.getStats(),
      inventory: {
        publishers,
        publishers_pending: publishersPending,
        publishers_active: publishersActive,
        publishers_blocked: publishersBlocked,
        campaigns,
        campaigns_active: campaignsActive,
        creatives,
        users_active: users,
        events_24h: events24h,
      },
      storage: {
        creatives: {
          ...creativesStorage,
          bytes_label: fmtBytes(creativesStorage.bytes),
        },
        disk,
      },
      pm2,
    },
  });
});

const logs = asyncHandler(async (req, res) => {
  const limit = req.query.limit != null ? Number(req.query.limit) : LOG_LINE_LIMIT;
  const payload = await readLogs(limit);
  res.json({ data: payload });
});

module.exports = { overview, logs };
