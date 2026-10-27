const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const env = require('./config/env');
const { CREATIVE_CSP, EMBED_CSP } = require('./constant/headers');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const eventBuffer = require('./utils/eventBuffer');
const { aggregateEvents } = require('./utils/aggregateEvents');
const { requestUrlForLog } = require('./utils/requestLog');

const app = express();

if (env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

const adminCors = cors({
  origin(origin, callback) {
    // Non-browser / same-origin tools (curl, server-side) often omit Origin.
    if (!origin) return callback(null, true);
    if (env.ADMIN_CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
});

const publicCors = cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 204,
});

// Ad tag & creative preview harus bisa di-embed dari origin lain (publisher / frontend).
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    frameguard: false,
  })
);

function allowEmbed(res) {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', EMBED_CSP);
}

function setCreativeHeaders(res) {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', CREATIVE_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
morgan.token('safe-url', (req) => requestUrlForLog(req));
app.use(
  morgan(
    env.NODE_ENV === 'production'
      ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
      : ':method :safe-url :status :response-time ms - :res[content-length]',
    {
      // Polling live monitoring mengotori log; jangan catat.
      skip(req) {
        const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
        return pathOnly === '/api/monitoring' || pathOnly.startsWith('/api/monitoring/');
      },
    }
  )
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/health', adminCors, require('./routes/health'));

app.use('/ad', publicCors, (req, res, next) => {
  allowEmbed(res);
  next();
}, require('./routes/ad'));
app.use('/track', publicCors, require('./routes/track'));
app.use(
  '/sdk',
  publicCors,
  express.static(path.join(__dirname, 'public', 'sdk'), {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    },
  })
);
app.use(
  '/creatives',
  publicCors,
  express.static(path.join(__dirname, 'public', 'creatives'), {
    setHeaders(res) {
      setCreativeHeaders(res);
    },
  }),
  (req, res) => {
    setCreativeHeaders(res);
    res.status(404);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Preview tidak tersedia</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100%;background:#f8f3e8;color:#3f2a1d;text-align:center;padding:1rem;">
<p>File creative tidak ada di storage.<br/>Unggah ulang ZIP untuk melihat preview.</p>
</body></html>`);
  }
);
app.use('/test', publicCors, express.static(path.join(__dirname, 'public', 'test')));

app.use('/auth', adminCors, require('./routes/auth'));
app.use('/api/users', adminCors, require('./routes/users'));
app.use('/api/roles', adminCors, require('./routes/roles'));
app.use('/api/advertisers', adminCors, require('./routes/advertisers'));
app.use('/api/campaigns', adminCors, require('./routes/campaigns'));
app.use('/api/creatives', adminCors, require('./routes/creatives'));
app.use('/api/sites', adminCors, require('./routes/sites'));
app.use('/api/placements', adminCors, require('./routes/placements'));
app.use('/api/publishers', adminCors, require('./routes/publishers'));
app.use('/api/tag', adminCors, require('./routes/tag'));
app.use('/api/reports', adminCors, require('./routes/reports'));
app.use('/api/billing', adminCors, require('./routes/billing'));
app.use('/api/monitoring', adminCors, require('./routes/monitoring'));

app.get('/', (req, res) => {
  res.json({ name: 'jobosrv. API', version: '1.0.0' });
});

app.use(notFound);
app.use(errorHandler);

let server;

if (require.main === module) {
  eventBuffer.start();
  cron.schedule('*/5 * * * *', () => {
    aggregateEvents({ sinceHours: 48 }).catch((err) =>
      console.error('aggregate cron failed', err)
    );
  });

  server = app.listen(env.PORT, () => {
    console.log(`jobosrv. listening on http://localhost:${env.PORT}`);
  });

  async function shutdown() {
    console.log('Shutting down...');
    await eventBuffer.stop();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;
