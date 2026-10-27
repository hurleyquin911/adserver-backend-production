const express = require('express');
const db = require('../models');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await db.sequelize.authenticate();
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  })
);

module.exports = router;
