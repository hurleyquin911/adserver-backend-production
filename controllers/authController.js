const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} = require('../utils/tokens');
const env = require('../config/env');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function serializeUser(user) {
  const permissions = (user.role?.permissions || []).map((p) => p.code);
  return {
    id: String(user.id),
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    role: user.role
      ? { id: String(user.role.id), name: user.role.name }
      : null,
    advertiser_id: user.advertiser_id != null ? String(user.advertiser_id) : null,
    permissions,
  };
}

const profileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
  phone: z
    .string()
    .trim()
    .max(64)
    .optional()
    .nullable()
    .transform((v) => (v == null || v === '' ? null : v)),
});

const passwordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
});

async function loadUser(id) {
  return db.User.findByPk(id, {
    include: [
      {
        model: db.Role,
        as: 'role',
        include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
      },
    ],
  });
}

function setRefreshCookie(res, token) {
  const httpsApi = String(env.PUBLIC_BASE_URL || '').startsWith('https://');
  res.cookie('refresh_token', token, {
    httpOnly: true,
    // none+secure: frontend lokal (localhost) → API publik HTTPS tetap bisa refresh.
    // lax: cukup untuk frontend lokal → API lokal HTTP.
    sameSite: httpsApi ? 'none' : 'lax',
    secure: httpsApi || env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/auth',
  });
}

async function persistRefreshToken(userId, token) {
  const decoded = verifyRefreshToken(token);
  await db.RefreshToken.create({
    user_id: userId,
    token_hash: hashRefreshToken(token),
    expires_at: new Date((decoded.exp || 0) * 1000),
  });
}

async function issueRefreshToken(userId) {
  const token = signRefreshToken({
    sub: String(userId),
    jti: crypto.randomBytes(16).toString('hex'),
  });
  await persistRefreshToken(userId, token);
  return token;
}

async function revokeRefreshToken(token) {
  if (!token) return;
  const row = await db.RefreshToken.findOne({
    where: { token_hash: hashRefreshToken(token) },
  });
  if (row && !row.revoked_at) {
    row.revoked_at = new Date();
    await row.save();
  }
}

async function consumeRefreshToken(token) {
  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 'Refresh token tidak valid', 401);
  }
  const row = await db.RefreshToken.findOne({
    where: { token_hash: hashRefreshToken(token) },
  });
  if (!row || row.revoked_at || (row.expires_at && row.expires_at.getTime() < Date.now())) {
    throw new AppError('UNAUTHORIZED', 'Refresh token tidak valid', 401);
  }
  row.revoked_at = new Date();
  await row.save();
  return decoded;
}

const login = asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await db.User.findOne({
    where: { email: body.email },
    include: [
      {
        model: db.Role,
        as: 'role',
        include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
      },
    ],
  });

  if (!user || !user.is_active) {
    throw new AppError('INVALID_CREDENTIALS', 'Email atau password salah', 401);
  }

  const match = await bcrypt.compare(body.password, user.password_hash);
  if (!match) {
    throw new AppError('INVALID_CREDENTIALS', 'Email atau password salah', 401);
  }

  const accessToken = signAccessToken({ sub: String(user.id), role_id: String(user.role_id) });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.json({ accessToken, user: serializeUser(user) });
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) {
    throw new AppError('UNAUTHORIZED', 'Refresh token tidak ditemukan', 401);
  }

  const decoded = await consumeRefreshToken(token);
  const user = await loadUser(decoded.sub);
  if (!user || !user.is_active) {
    throw new AppError('UNAUTHORIZED', 'Pengguna tidak aktif', 401);
  }

  const accessToken = signAccessToken({ sub: String(user.id), role_id: String(user.role_id) });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.json({ accessToken, user: serializeUser(user) });
});

const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refresh_token;
  await revokeRefreshToken(token);
  res.clearCookie('refresh_token', { path: '/auth' });
  res.json({ ok: true });
});

const me = asyncHandler(async (req, res) => {
  const user = await loadUser(req.user.id);
  res.json({ user: serializeUser(user) });
});

const updateProfile = asyncHandler(async (req, res) => {
  const body = profileSchema.parse(req.body);
  const user = await db.User.findByPk(req.user.id);
  if (!user || !user.is_active) {
    throw new AppError('UNAUTHORIZED', 'Pengguna tidak aktif', 401);
  }

  if (body.email.toLowerCase() !== user.email.toLowerCase()) {
    const taken = await db.User.findOne({ where: { email: body.email } });
    if (taken && Number(taken.id) !== Number(user.id)) {
      throw new AppError('VALIDATION_ERROR', 'Email sudah dipakai akun lain', 400);
    }
  }

  user.name = body.name;
  user.email = body.email;
  user.phone = body.phone;
  await user.save();

  const full = await loadUser(user.id);
  res.json({ user: serializeUser(full) });
});

const changePassword = asyncHandler(async (req, res) => {
  const body = passwordSchema.parse(req.body);
  const user = await db.User.findByPk(req.user.id);
  if (!user || !user.is_active) {
    throw new AppError('UNAUTHORIZED', 'Pengguna tidak aktif', 401);
  }

  const match = await bcrypt.compare(body.current_password, user.password_hash);
  if (!match) {
    throw new AppError('VALIDATION_ERROR', 'Password saat ini salah', 400);
  }
  if (body.current_password === body.new_password) {
    throw new AppError('VALIDATION_ERROR', 'Password baru harus berbeda', 400);
  }

  user.password_hash = await bcrypt.hash(body.new_password, 10);
  await user.save();
  res.json({ ok: true });
});

module.exports = {
  login,
  refresh,
  logout,
  me,
  updateProfile,
  changePassword,
  serializeUser,
};
