const InboundMessage = require("../models/inbound-message-model");
const MasterRecord = require("../models/master-record-model");
const Request = require("../models/request-model");
const { classify } = require("../utils/classifier");
const audit = require("../utils/audit");
const counters = require("../utils/counters");

async function customerPool() {
  return MasterRecord.find({ domainKey: "customer", mergedInto: { $in: [null, undefined] } }, "code name country").lean();
}

// GET /api/intake/messages
exports.list = async (req, res) => {
  res.json(await InboundMessage.find().sort({ receivedAt: -1 }).limit(200).lean());
};

// POST /api/intake/classify { subject, body, from, fromName } - try it without saving
exports.classify = async (req, res) => {
  res.json(classify(req.body || {}, await customerPool()));
};

// POST /api/intake/messages - store an email (as if it arrived in the shared mailbox) and classify it
exports.create = async (req, res) => {
  const { subject, body, from, fromName } = req.body || {};
  if (!subject && !body) return res.status(400).json({ message: "Paste the email subject or body." });
  const msg = await InboundMessage.create({
    subject, body, from, fromName, classification: classify({ subject, body, from, fromName }, await customerPool()),
  });
  res.status(201).json(msg);
};

// PATCH /api/intake/messages/:id { status }
exports.setStatus = async (req, res) => {
  const msg = await InboundMessage.findByIdAndUpdate(req.params.id, { status: req.body?.status }, { new: true, runValidators: true });
  if (!msg) return res.status(404).json({ message: "Message not found." });
  res.json(msg);
};

// POST /api/intake/messages/:id/convert - start a pre-filled draft MDM request from the email
exports.convert = async (req, res) => {
  const msg = await InboundMessage.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: "Message not found." });
  const c = msg.classification || {};
  const domainKey = c.extracted?.domainKey || "customer";
  const name = c.extracted?.organisation || msg.fromName || "New record";
  const data =
    domainKey === "vendor"
      ? { vendorName: name, country: c.extracted?.country, contactEmail: msg.from }
      : domainKey === "item"
        ? { itemName: msg.subject }
        : { customerName: name, country: c.extracted?.country, contactEmail: msg.from, contactPerson: msg.fromName };

  const year = new Date().getFullYear();
  const r = await Request.create({
    refNo: `MDM-${year}-${String(await counters.next(`ref:${year}`)).padStart(4, "0")}`,
    domainKey,
    title: name,
    entity: req.user.entities?.[0] || "SPD",
    country: c.extracted?.country,
    requester: req.user._id,
    status: "draft",
    data: Object.fromEntries(Object.entries(data).filter(([, v]) => v)),
    source: "intake",
  });
  await audit.log(r, "draft_from_email", req.user, { subject: msg.subject, classification: c.label });
  msg.status = "actioned";
  msg.linkedRequest = String(r._id);
  await msg.save();
  res.status(201).json({ _id: r._id, refNo: r.refNo });
};
