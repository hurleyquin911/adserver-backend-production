const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireSuperadmin = require('../middleware/requireSuperadmin');
const controller = require('../controllers/monitoringController');

const router = express.Router();

router.use(authenticate, requireSuperadmin);
router.get('/', controller.overview);
router.get('/logs', controller.logs);

module.exports = router;
