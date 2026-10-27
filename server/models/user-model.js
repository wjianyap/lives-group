const { Schema, model } = require("../db");
const { ROLES, APPROVER_FUNCTIONS, ENTITIES, COUNTRIES } = require("../config/constants");

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    title: { type: String, trim: true }, // job title shown in the UI, e.g. "Product Manager"
    role: { type: String, required: true, enum: ROLES },
    // approvers only: which checks they own (Finance checks credit terms, QRA checks licences...)
    functions: [{ type: String, enum: APPROVER_FUNCTIONS.map((f) => f.code) }],
    // which business entities this person works for; BU Heads only approve their own entity
    entities: [{ type: String, enum: ENTITIES.map((e) => e.code) }],
    country: { type: String, enum: COUNTRIES.map((c) => c.code) },
    timeZone: { type: String, default: "Asia/Singapore" },
  },
  { timestamps: true },
);

module.exports = model("User", UserSchema, "users");
