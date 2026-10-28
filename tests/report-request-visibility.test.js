const { hideAdRequests, visibleEventRows } = require('../utils/reportVisibility');

describe('report ad request visibility', () => {
  const rows = [
    { type: 'request', total: 40 },
    { type: 'impression', total: 38 },
  ];

  test.each(['Admin', 'Users'])('%s does not receive Ad request metrics', (role) => {
    expect(hideAdRequests({ request: 40, impression: 38 }, { role: { name: role } })).toEqual({
      impression: 38,
    });
    expect(visibleEventRows(rows, { role: { name: role } })).toEqual([
      { type: 'impression', total: 38 },
    ]);
  });

  test('Superadmin retains Ad request metrics', () => {
    const user = { role: { name: 'Superadmin' } };
    expect(hideAdRequests({ request: 40, impression: 38 }, user)).toEqual({
      request: 40,
      impression: 38,
    });
    expect(visibleEventRows(rows, user)).toEqual(rows);
  });
});
