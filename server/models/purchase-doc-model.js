const { Schema, model } = require("../db");

// A customer purchasing document pulled from SAP B1 (or captured from email intake).
// docType keeps the three things the brief asks us to tell apart:
//   order            - a confirmed customer purchase order (this is what demand / growth is measured on)
//   purchase_request - an actionable request for quotation / tender that can become an order
//   enquiry          - general enquiry or follow-up (not demand)
// MDM setup requests are NOT here - they live in the "requests" collection.
const PurchaseDocSchema = new Schema({
  docNo: { type: String, required: true, unique: true },
  docType: { type: String, enum: ["order", "purchase_request", "enquiry"], required: true, index: true },
  country: { type: String, required: true, index: true },
  entity: String,
  customerCode: { type: String, index: true },
  product: { type: String, enum: ["A", "B", "C"], index: true },
  month: { type: String, required: true, index: true }, // "YYYY-MM"
  date: Date,
  qty: Number,
  valueUsd: Number,
});

module.exports = model("PurchaseDoc", PurchaseDocSchema, "purchase_docs");
