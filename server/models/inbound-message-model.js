const mongoose = require("mongoose");

// An email that arrived in a shared mailbox (sales@ / mdm@). The intake classifier sorts these into
// purchase orders, purchase requests, enquiries and MDM setup requests.
const InboundMessageSchema = new mongoose.Schema(
  {
    from: String,
    fromName: String,
    subject: String,
    body: String,
    receivedAt: { type: Date, default: Date.now },
    classification: mongoose.Schema.Types.Mixed, // result of utils/classifier.js
    status: { type: String, enum: ["new", "actioned", "dismissed"], default: "new" },
    linkedRequest: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("InboundMessage", InboundMessageSchema, "inbound_messages");
