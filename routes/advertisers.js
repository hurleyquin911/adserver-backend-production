const express = require('express');
const controller = require('../controllers/advertiserController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireSuperadmin = require('../middleware/requireSuperadmin');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate);

// GET tetap mengikuti scope role; Admin/Superadmin melihat semua Brand.
router.get('/', requirePermission(P.CAMPAIGN_READ), controller.list);
router.get('/:id', requirePermission(P.CAMPAIGN_READ), controller.getOne);
// Admin dapat membuat Brand; perubahan dan penghapusan tetap khusus Superadmin.
router.post('/', requirePermission(P.CAMPAIGN_WRITE), controller.create);
router.patch('/:id', requireSuperadmin, requirePermission(P.CAMPAIGN_WRITE), controller.update);
router.delete('/:id', requireSuperadmin, requirePermission(P.CAMPAIGN_WRITE), controller.remove);

module.exports = router;
