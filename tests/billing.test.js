const db = require('../models');
const { centsFor, csvCell, loadBilling } = require('../controllers/billingController');
const requireBillingRole = require('../middleware/requireBillingRole');
const { recordRateChange } = require('../utils/billingRateHistory');

describe('Billing helpers', () => {
  test('calculates USD per thousand impressions in cents', () => {
    expect(centsFor(1_240_000, 0.5)).toBe(62_000);
    expect(centsFor(1_000, 0.5) / 100).toBe(0.5);
  });

  test('rounds each creative amount to the nearest cent', () => {
    expect(centsFor(1, 5)).toBe(1);
    expect(centsFor(1, 4)).toBe(0);
  });

  test('escapes CSV cells and neutralizes spreadsheet formulas', () => {
    expect(csvCell('Brand "A"')).toBe('"Brand ""A"""');
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
  });

  test('summarizes priced impressions and excludes unpriced creatives', async () => {
    const creativeQuery = jest.spyOn(db.Creative, 'findAll').mockResolvedValue([
      {
        id: 12,
        name: 'Priced creative',
        width: 300,
        height: 250,
        cpm_usd: '0.5000',
        campaign: { id: 4, name: 'Campaign' },
      },
      {
        id: 13,
        name: 'Unpriced creative',
        width: 728,
        height: 90,
        cpm_usd: null,
        campaign: { id: 4, name: 'Campaign' },
      },
    ]);
    const aggregateQuery = jest
      .spyOn(db.EventAggregate, 'findAll')
      .mockResolvedValue([{ creative_id: 12, impressions: '1240000' }]);

    try {
      const result = await loadBilling(
        { from: '2026-10-01', to: '2026-10-27' },
        { advertiser_id: 4, role: { name: 'Admin' } }
      );

      expect(result.summary).toEqual({
        total_impressions: 1_240_000,
        billable_impressions: 1_240_000,
        total_amount_usd: 620,
        unpriced_creative_count: 1,
      });
      expect(result.data[1].amount_usd).toBeNull();
      expect(creativeQuery).toHaveBeenCalledTimes(1);
      expect(aggregateQuery).toHaveBeenCalledTimes(1);
    } finally {
      creativeQuery.mockRestore();
      aggregateQuery.mockRestore();
    }
  });

  test('records rate changes with actor and required terms', async () => {
    const create = jest.spyOn(db.BillingRateHistory, 'create').mockResolvedValue({ id: 21 });
    try {
      const history = await recordRateChange({
        creativeId: 12,
        oldRate: '0.5000',
        newRate: '0.7500',
        changedBy: 7,
        reason: 'Updated contract rate',
      });

      expect(history).toEqual({ id: 21 });
      expect(create).toHaveBeenCalledWith(
        {
          creative_id: 12,
          old_cpm_usd: 0.5,
          new_cpm_usd: 0.75,
          changed_by: 7,
          reason: 'Updated contract rate',
        },
        { transaction: undefined }
      );
      expect(await recordRateChange({
        creativeId: 12,
        oldRate: '0.7500',
        newRate: 0.75,
        changedBy: 7,
        reason: 'No actual rate change',
      })).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      create.mockRestore();
    }
  });
});

describe('Billing role access', () => {
  test.each(['Superadmin', 'Admin', 'Users'])('%s can access Billing', (name) => {
    const next = jest.fn();
    requireBillingRole({ user: { role: { name } } }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('unknown roles are denied Billing access', () => {
    const next = jest.fn();
    requireBillingRole({ user: { role: { name: 'Guest' } } }, {}, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FORBIDDEN', status: 403 })
    );
  });
});
