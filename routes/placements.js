const express = require('express');
const controller = require('../controllers/placementController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate, requirePermission(P.PLACEMENT_MANAGE));

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.put('/:id/creatives', controller.assignCreatives);
router.delete('/:id', controller.remove);

module.exports = router;
