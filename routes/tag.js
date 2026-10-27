const express = require('express');
const controller = require('../controllers/tagController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate);
router.get('/', requirePermission(P.CAMPAIGN_READ), controller.getTag);

module.exports = router;
