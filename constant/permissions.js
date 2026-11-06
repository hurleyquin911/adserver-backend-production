const CAMPAIGN_READ = 'campaign:read';
const CAMPAIGN_WRITE = 'campaign:write';
const CREATIVE_UPLOAD = 'creative:upload';
const PLACEMENT_MANAGE = 'placement:manage';
const PUBLISHER_MANAGE = 'publisher:manage';
const REPORT_READ = 'report:read';
const REPORT_AGGREGATE = 'report:aggregate';
const USER_MANAGE = 'user:manage';

/** Izin resmi role Users: hanya baca. Izin tulis tidak boleh melekat. */
const USERS_READ_PERMISSIONS = [CAMPAIGN_READ, REPORT_READ];

module.exports = {
  CAMPAIGN_READ,
  CAMPAIGN_WRITE,
  CREATIVE_UPLOAD,
  PLACEMENT_MANAGE,
  PUBLISHER_MANAGE,
  REPORT_READ,
  REPORT_AGGREGATE,
  USER_MANAGE,
  USERS_READ_PERMISSIONS,
};
