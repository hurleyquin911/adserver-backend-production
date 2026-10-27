const express = require('express');
const roleController = require('../controllers/roleController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireSuperadmin = require('../middleware/requireSuperadmin');
const P = require('../constant/permissions');

const router = express.Router();

router.use(authenticate, requireSuperadmin, requirePermission(P.USER_MANAGE));

router.get('/', roleController.list);
router.get('/permissions', roleController.listPermissions);
router.get('/:id', roleController.getOne);
router.post('/', roleController.create);
router.patch('/:id', roleController.update);

module.exports = router;
