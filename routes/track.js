const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/trackController');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak request' } },
});

router.use(limiter);
router.post('/', controller.track);
router.get('/', controller.track);
router.get('/click', controller.click);

module.exports = router;
