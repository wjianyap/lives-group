const { Schema, model } = require("../db");

// Append-only, hash-chained audit trail. Every entry stores the hash of the entry before it (for the same request),
// so editing or deleting any past entry breaks the chain and the "Verify" check shows it.
const AuditSchema = new Schema({
  requestId: { type: String, index: true },
  refNo: String,
  seq: Number,
  action: { type: String, required: true },
  actor: { type: Schema.Types.ObjectId, ref: "User" },
  actorName: String,
  details: Schema.Types.Mixed,
  at: { type: Date, default: Date.now },
  prevHash: String,
  hash: String,
});

module.exports = model("Audit", AuditSchema, "audit_log");
