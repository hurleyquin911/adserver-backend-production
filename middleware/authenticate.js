const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokens');
const db = require('../models');
const asyncHandler = require('../utils/asyncHandler');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    throw new AppError('UNAUTHORIZED', 'Token tidak ditemukan', 401);
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 'Token tidak valid atau kedaluwarsa', 401);
  }

  const user = await db.User.findByPk(decoded.sub, {
    include: [
      {
        model: db.Role,
        as: 'role',
        include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
      },
    ],
  });

  if (!user || !user.is_active) {
    throw new AppError('UNAUTHORIZED', 'Pengguna tidak aktif', 401);
  }

  req.user = user;
  req.permissions = (user.role?.permissions || []).map((p) => p.code);
  next();
});

module.exports = authenticate;
