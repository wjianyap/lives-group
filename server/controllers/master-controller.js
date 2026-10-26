const MasterRecord = require("../models/master-record-model");
const Domain = require("../models/domain-model");
const duplicates = require("../services/duplicates");
const analytics = require("../services/analytics");

// POST /api/duplicates/check { domainKey, data, excludeRequestId } - live check while the requester types
exports.check = async (req, res) => {
  const domain = await Domain.findOne({ key: req.body?.domainKey }).lean();
  if (!domain) return res.status(400).json({ message: "Unknown request type." });
  res.json(await duplicates.check(domain, req.body.data || {}, { excludeRequestId: req.body.excludeRequestId }));
};

// GET /api/master?domain=customer&q=hosp
exports.list = async (req, res) => {
  const filter = {};
  if (req.query.domain) filter.domainKey = req.query.domain;
  if (req.query.country) filter.country = req.query.country;
  if (req.query.q) filter.name = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  res.json(await MasterRecord.find(filter).sort({ code: 1 }).limit(500).lean());
};

// GET /api/master/scan?domain=customer - near-duplicates already in SAP B1
exports.scan = async (req, res) => res.json(await duplicates.scanMasterData(req.query.domain || "customer"));

// POST /api/master/merge { from, into } - MDM confirms two records are the same customer
exports.merge = async (req, res) => {
  const { from, into } = req.body || {};
  if (!from || !into || from === into) return res.status(400).json({ message: "Pick two different records." });
  const [a, b] = await Promise.all([MasterRecord.findOne({ code: from }), MasterRecord.findOne({ code: into })]);
  if (!a || !b) return res.status(404).json({ message: "Record not found." });
  if (b.mergedInto) return res.status(409).json({ message: `${into} is itself merged into ${b.mergedInto}.` });
  a.mergedInto = into;
  await a.save();
  // anything that pointed at the merged record now points at the survivor
  await MasterRecord.updateMany({ mergedInto: from }, { mergedInto: into });
  analytics.clearCache(); // the regional view now counts them as one customer
  res.json({ ok: true });
};

// POST /api/master/unmerge { code }
exports.unmerge = async (req, res) => {
  await MasterRecord.updateOne({ code: req.body?.code }, { $unset: { mergedInto: 1 } });
  analytics.clearCache();
  res.json({ ok: true });
};
