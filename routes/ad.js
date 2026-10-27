const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/serveController');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak request' } },
});

router.use(limiter);
router.get('/serve', controller.serve);
router.get('/tag.js', controller.tagJs);
router.get('/frame', controller.frame);

module.exports = router;
