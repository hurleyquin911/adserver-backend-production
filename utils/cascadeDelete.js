'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { getStorage } = require('./storage');

/**
 * Hapus advertiser beserta campaign/creative-nya.
 * Campaign & creative memakai soft-delete (paranoid), sementara advertiser
 * hard-delete - FK RESTRICT di campaigns.advertiser_id menolak DELETE
 * selama baris campaign masih ada. Karena itu child dihapus force dulu.
 */
async function cascadeDeleteAdvertiser(advertiserId) {
  const storagePaths = [];

  await db.sequelize.transaction(async (transaction) => {
    const campaigns = await db.Campaign.findAll({
      where: { advertiser_id: advertiserId },
      paranoid: false,
      transaction,
    });
    const campaignIds = campaigns.map((c) => Number(c.id));

    let creativeIds = [];
    if (campaignIds.length) {
      const creatives = await db.Creative.findAll({
        where: { campaign_id: { [Op.in]: campaignIds } },
        paranoid: false,
        transaction,
      });
      creativeIds = creatives.map((c) => Number(c.id));
      for (const row of creatives) {
        if (row.base_path) storagePaths.push(row.base_path);
      }
    }

    if (campaignIds.length || creativeIds.length) {
      const or = [];
      if (campaignIds.length) or.push({ campaign_id: { [Op.in]: campaignIds } });
      if (creativeIds.length) or.push({ creative_id: { [Op.in]: creativeIds } });
      await db.EventAggregate.destroy({ where: { [Op.or]: or }, transaction });
    }

    if (creativeIds.length) {
      await db.Event.update(
        { creative_id: null },
        { where: { creative_id: { [Op.in]: creativeIds } }, transaction }
      );
      await db.Creative.destroy({
        where: { id: { [Op.in]: creativeIds } },
        force: true,
        transaction,
      });
    }

    if (campaignIds.length) {
      await db.Event.update(
        { campaign_id: null },
        { where: { campaign_id: { [Op.in]: campaignIds } }, transaction }
      );
      await db.Campaign.destroy({
        where: { id: { [Op.in]: campaignIds } },
        force: true,
        transaction,
      });
    }

    await db.Advertiser.destroy({ where: { id: advertiserId }, transaction });
  });

  const storage = getStorage();
  for (const key of storagePaths) {
    try {
      await storage.delete(key);
    } catch {
      // file kreatif boleh gagal dibersihkan
    }
  }
}

module.exports = { cascadeDeleteAdvertiser };
