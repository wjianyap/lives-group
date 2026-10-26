const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    kind: { type: String, enum: ["action", "reminder", "escalation", "update", "completed"], default: "update" },
    message: String,
    link: String,
    read: { type: Boolean, default: false },
    channel: { type: String, default: "portal" }, // portal / teams / email
  },
  { timestamps: true },
);

module.exports = mongoose.model("Notification", NotificationSchema, "notifications");
