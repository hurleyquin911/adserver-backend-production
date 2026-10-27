const express = require('express');
const userController = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireSuperadmin = require('../middleware/requireSuperadmin');
const P = require('../constant/permissions');

const router = express.Router();

router.use(authenticate, requireSuperadmin, requirePermission(P.USER_MANAGE));

router.get('/', userController.list);
router.get('/:id', userController.getOne);
router.post('/', userController.create);
router.patch('/:id', userController.update);
router.delete('/:id', userController.remove);

module.exports = router;
