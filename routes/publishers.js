const express = require('express');
const controller = require('../controllers/publisherController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate);
router.get('/', requirePermission(P.PUBLISHER_MANAGE), controller.list);
router.get('/:id', requirePermission(P.PUBLISHER_MANAGE), controller.getOne);
router.post('/', requirePermission(P.PUBLISHER_MANAGE), controller.create);
router.patch('/:id', requirePermission(P.PUBLISHER_MANAGE), controller.update);
router.delete('/:id', requirePermission(P.PUBLISHER_MANAGE), controller.remove);

module.exports = router;
