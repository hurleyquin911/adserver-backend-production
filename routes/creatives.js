const express = require('express');
const controller = require('../controllers/creativeController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const upload = require('../middleware/uploadZip');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission(P.CAMPAIGN_READ), controller.list);
router.get('/:id', requirePermission(P.CAMPAIGN_READ), controller.getOne);
router.post('/', requirePermission(P.CREATIVE_UPLOAD), upload.single('file'), controller.upload);
router.patch(
  '/:id',
  requirePermission(P.CREATIVE_UPLOAD),
  upload.single('file'),
  controller.update
);
router.delete('/:id', requirePermission(P.CREATIVE_UPLOAD), controller.remove);

module.exports = router;
