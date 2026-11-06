const express = require('express');
const controller = require('../controllers/billingController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireBillingRole = require('../middleware/requireBillingRole');
const requireSuperadmin = require('../middleware/requireSuperadmin');
const denyUsersWrite = require('../middleware/denyUsersWrite');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate, denyUsersWrite, requirePermission(P.REPORT_READ), requireBillingRole);

router.get('/export.csv', controller.exportCsv);
router.get('/history', controller.history);
router.patch('/pricing/:creativeId', requireSuperadmin, controller.updatePricing);
router.get('/', controller.list);

module.exports = router;
