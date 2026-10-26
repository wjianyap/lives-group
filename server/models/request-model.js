const mongoose = require("mongoose");
const { REQUEST_STATUSES } = require("../config/constants");

const ApprovalSchema = new mongoose.Schema(
  {
    key: String,
    label: String,
    function: String,
    stage: Number,
    entity: String, // set when only that entity's approvers may act
    checks: String,
    status: { type: String, enum: ["waiting", "pending", "approved", "rejected", "changes_requested"], default: "waiting" },
    startedAt: Date, // when it landed on the approver
    dueAt: Date, // startedAt + SLA
    actedAt: Date,
    actedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    comment: String,
    remindersSent: { type: Number, default: 0 },
    escalated: { type: Boolean, default: false },
  },
  { _id: false },
);

const DuplicateSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["master", "request"] },
    id: String,
    code: String, // SAP code or request reference
    name: String,
    entity: String,
    score: Number,
    level: { type: String, enum: ["likely", "possible"] },
    reasons: [String],
  },
  { _id: false },
);

const RequestSchema = new mongoose.Schema(
  {
    refNo: { type: String, required: true, unique: true },
    domainKey: { type: String, required: true, index: true },
    domainVersion: Number,
    title: { type: String, required: true }, // the record name, for lists
    entity: { type: String, required: true },
    country: String,
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: REQUEST_STATUSES, default: "draft", index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // ordinary field values
    secure: { type: mongoose.Schema.Types.Mixed, default: {} }, // sensitive values, each AES-256-GCM encrypted
    approvals: [ApprovalSchema],
    duplicates: [DuplicateSchema],
    duplicateOverride: { reason: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: Date },
    comments: [
      {
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: String,
        at: { type: Date, default: Date.now },
      },
    ],
    source: { type: String, default: "portal" }, // "portal" or "intake" (created from a classified email)
    submittedAt: Date,
    approvedAt: Date,
    completedAt: Date,
    sapCode: String,
    returnedCount: { type: Number, default: 0 }, // times sent back for changes (first-time-right metric)
  },
  { timestamps: true },
);

module.exports = mongoose.model("Request", RequestSchema, "requests");
