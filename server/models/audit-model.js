const mongoose = require("mongoose");

// Append-only, hash-chained audit trail. Every entry stores the hash of the entry before it (for the same request),
// so editing or deleting any past entry breaks the chain and the "Verify" check shows it.
const AuditSchema = new mongoose.Schema({
  requestId: { type: String, index: true },
  refNo: String,
  seq: Number,
  action: { type: String, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actorName: String,
  details: mongoose.Schema.Types.Mixed,
  at: { type: Date, default: Date.now },
  prevHash: String,
  hash: String,
});

module.exports = mongoose.model("Audit", AuditSchema, "audit_log");
