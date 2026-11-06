const express = require('express');
const controller = require('../controllers/campaignController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const denyUsersWrite = require('../middleware/denyUsersWrite');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate, denyUsersWrite);

router.get('/', requirePermission(P.CAMPAIGN_READ), controller.list);
router.get('/:id', requirePermission(P.CAMPAIGN_READ), controller.getOne);
router.post('/', requirePermission(P.CAMPAIGN_WRITE), controller.create);
router.patch('/:id', requirePermission(P.CAMPAIGN_WRITE), controller.update);
router.delete('/:id', requirePermission(P.CAMPAIGN_WRITE), controller.remove);

module.exports = router;
