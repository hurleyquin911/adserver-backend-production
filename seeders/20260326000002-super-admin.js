'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in environment');
    }

    const [roles] = await queryInterface.sequelize.query(
      "SELECT id FROM roles WHERE name IN ('Superadmin', 'Super Admin') ORDER BY FIELD(name, 'Superadmin', 'Super Admin') LIMIT 1"
    );

    if (!roles.length) {
      throw new Error('Superadmin role not found; run permissions-roles seeder first');
    }

    const [existingUsers] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { replacements: { email } }
    );
    if (existingUsers.length) return;

    const password_hash = bcrypt.hashSync(password, 10);
    const now = new Date();

    await queryInterface.bulkInsert('users', [
      {
        email,
        password_hash,
        name: 'Superadmin',
        role_id: roles[0].id,
        advertiser_id: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    const email = process.env.SEED_ADMIN_EMAIL;
    if (email) {
      await queryInterface.bulkDelete('users', { email });
    }
  },
};
