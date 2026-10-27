const { pacingFactor, pickWeighted, campaignWeight } = require('../utils/pacing');

describe('pacingFactor', () => {
  const startDate = '2026-01-01';
  const endDate = '2026-01-10';

  test('tanpa goal atau pacing mati = 1', () => {
    expect(pacingFactor({ goal: 0, delivered: 10, startDate, endDate })).toBe(1);
    expect(pacingFactor({ goal: 100, delivered: 10, startDate, endDate, enabled: false })).toBe(1);
  });

  test('tertinggal (delivered jauh di bawah expected) mendekati 4 (clamp)', () => {
    const now = new Date('2026-01-10T12:00:00+07:00');
    const f = pacingFactor({ goal: 1000, delivered: 1, startDate, endDate, now });
    expect(f).toBe(4);
  });

  test('terlalu cepat (delivered jauh di atas expected) mendekati 0.25 (clamp)', () => {
    const now = new Date('2026-01-02T00:00:00+07:00');
    const f = pacingFactor({ goal: 1000, delivered: 999, startDate, endDate, now });
    expect(f).toBe(0.25);
  });

  test('on track sekitar 1 di tengah periode dengan setengah goal', () => {
    const now = new Date('2026-01-06T00:00:00+07:00');
    const f = pacingFactor({ goal: 100, delivered: 50, startDate, endDate, now });
    expect(f).toBeGreaterThan(0.7);
    expect(f).toBeLessThan(1.4);
  });
});

describe('pickWeighted + campaignWeight', () => {
  test('rng 0 memilih item pertama berbobot', () => {
    const items = ['a', 'b'];
    const weights = [9, 1];
    expect(pickWeighted(items, weights, () => 0)).toBe('a');
  });

  test('rng mendekati 1 memilih item terakhir', () => {
    const items = ['a', 'b'];
    const weights = [1, 9];
    expect(pickWeighted(items, weights, () => 0.999)).toBe('b');
  });

  test('weight = max(1, priority) × factor', () => {
    expect(campaignWeight(10, 2)).toBe(20);
    expect(campaignWeight(0, 1)).toBe(1);
  });
});
