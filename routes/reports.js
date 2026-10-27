const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/reportController');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const P = require('../constant/permissions');

const router = express.Router();
router.use(authenticate);

const aggregateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan agregasi' } },
});

router.post(
  '/aggregate',
  requirePermission(P.REPORT_AGGREGATE),
  aggregateLimiter,
  controller.runAggregate
);

router.get('/summary', requirePermission(P.REPORT_READ), controller.summary);
router.get('/by-day', requirePermission(P.REPORT_READ), controller.byDay);
router.get('/by-device', requirePermission(P.REPORT_READ), controller.byDevice);
router.get('/export.csv', requirePermission(P.REPORT_READ), controller.exportCsv);

router.get('/campaigns', requirePermission(P.REPORT_READ), controller.campaignsReport);
router.get('/creatives', requirePermission(P.REPORT_READ), controller.creativesReport);
router.get('/campaigns/:id/summary', requirePermission(P.REPORT_READ), controller.campaignSummary);
router.get('/campaigns/:id/timeseries', requirePermission(P.REPORT_READ), controller.campaignTimeseries);
router.get('/campaigns/:id/breakdown', requirePermission(P.REPORT_READ), controller.campaignBreakdown);
router.get('/campaigns/:id/export.csv', requirePermission(P.REPORT_READ), controller.campaignExport);
router.get('/publishers', requirePermission(P.REPORT_READ), controller.publishersReport);
router.get('/publishers/:id', requirePermission(P.REPORT_READ), controller.publisherDetailReport);
router.get('/no-fill', requirePermission(P.REPORT_READ), controller.noFillReport);

module.exports = router;
