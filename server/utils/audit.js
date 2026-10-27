const crypto = require("crypto");
const Audit = require("../models/audit-model");

function hashEntry(e) {
  const body = JSON.stringify({
    requestId: e.requestId,
    seq: e.seq,
    action: e.action,
    actor: e.actor ? String(e.actor) : null,
    details: e.details ?? null,
    at: new Date(e.at).toISOString(),
    prevHash: e.prevHash,
  });
  return crypto.createHash("sha256").update(body).digest("hex");
}

// Adds an entry to the request's audit chain (`at` is only passed by the seed script for back-dated history)
exports.log = async function (request, action, actor, details, at = new Date()) {
  const requestId = String(request._id);
  const last = await Audit.findOne({ requestId }).sort({ seq: -1 });
  const entry = {
    requestId,
    refNo: request.refNo,
    seq: last ? last.seq + 1 : 1,
    action,
    actor: actor?._id || actor?.id || null,
    actorName: actor?.name || "System",
    // round-trip through JSON so what we hash is exactly what the JSON file stores (no undefined values)
    details: details === undefined || details === null ? null : JSON.parse(JSON.stringify(details)),
    at,
    prevHash: last ? last.hash : "GENESIS",
  };
  entry.hash = hashEntry(entry);
  return Audit.create(entry);
};

// Recomputes every hash; returns where the chain breaks, if it does
exports.verify = async function (requestId) {
  const entries = await Audit.find({ requestId: String(requestId) }).sort({ seq: 1 }).lean();
  let prev = "GENESIS";
  for (const e of entries) {
    if (e.prevHash !== prev || hashEntry(e) !== e.hash) return { valid: false, brokenAt: e.seq, count: entries.length };
    prev = e.hash;
  }
  return { valid: true, count: entries.length, head: prev };
};

exports.list = function (requestId) {
  return Audit.find({ requestId: String(requestId) }).sort({ seq: 1 }).lean();
};
