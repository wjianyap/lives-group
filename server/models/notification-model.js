const { Schema, model } = require("../db");

const NotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    kind: { type: String, enum: ["action", "reminder", "escalation", "update", "completed"], default: "update" },
    message: String,
    link: String,
    read: { type: Boolean, default: false },
    channel: { type: String, default: "portal" }, // portal / teams / email
  },
  { timestamps: true },
);

module.exports = model("Notification", NotificationSchema, "notifications");
