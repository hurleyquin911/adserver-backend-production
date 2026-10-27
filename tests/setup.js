process.env.NODE_ENV = process.env.NODE_ENV || 'test';
/** Tes delivery butuh publisher auto-active; production memakai pending. */
process.env.PUBLISHER_DEFAULT_STATUS = 'active';
require('dotenv').config({ quiet: true });
process.env.ELIGIBLE_CACHE_SECONDS = '0';
process.env.DELIVERY_RECOUNT_SECONDS = '1';
process.env.PUBLISHER_DEFAULT_STATUS = 'active';
