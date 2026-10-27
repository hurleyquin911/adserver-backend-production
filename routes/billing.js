const express = require('express');
const controller = require('../controllers/billingController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireBillingRole = require('../middleware/requireBillingRole');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate, requirePermission(P.REPORT_READ), requireBillingRole);

router.get('/export.csv', controller.exportCsv);
router.get('/', controller.list);

module.exports = router;
