const { Schema, model } = require("../db");

// A "domain" is one kind of master record (Customer, Vendor, Item, Cost Center...).
// Everything about it - the intake form, the required fields, the approval chain - is DATA in this collection,
// so the MDM team can add a domain, change a field or add an approval step from the Admin screen without IT.

// A rule such as { field: "isMedicalDevice", op: "eq", value: true }
const ConditionSchema = new Schema(
  {
    field: { type: String, required: true },
    op: { type: String, enum: ["eq", "neq", "in", "truthy", "gt", "gte", "lt"], default: "eq" },
    value: Schema.Types.Mixed,
  },
  { _id: false },
);

const FieldSchema = new Schema(
  {
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]*$/ },
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "textarea", "number", "select", "email", "date", "checkbox", "country", "entity"],
      default: "text",
    },
    section: { type: String, default: "Details" },
    required: { type: Boolean, default: false },
    options: [String],
    sensitive: { type: Boolean, default: false }, // encrypted at rest, masked for most viewers
    help: String,
    placeholder: String,
    pattern: String, // optional regex the value must match
    min: Number,
    max: Number,
    showWhen: ConditionSchema, // only shown (and only required) when this is true
    // How the field is used to find duplicates: the record name, a unique identifier (tax / part no.), email or phone
    dedupe: { type: String, enum: ["name", "identifier", "email", "phone", null], default: null },
    sapField: String, // the SAP B1 Service Layer property this field maps to
  },
  { _id: false },
);

const StepSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    function: { type: String, required: true }, // APPROVER_FUNCTIONS code
    stage: { type: Number, default: 1 }, // steps that share a stage run IN PARALLEL
    entityScoped: { type: Boolean, default: false }, // only approvers of the request's entity can act
    when: ConditionSchema, // step only applies when this is true (e.g. QRA only for medical devices)
    slaHours: { type: Number, default: 48 },
    checks: String, // what this approver is expected to verify
  },
  { _id: false },
);

const DomainSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, match: /^[a-z][a-z0-9-]*$/ },
    name: { type: String, required: true },
    description: String,
    icon: { type: String, default: "box" },
    sapObject: String, // e.g. "BusinessPartners", "Items", "ProfitCenters"
    codePrefix: { type: String, default: "X" }, // SAP code prefix for new records
    active: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    fields: [FieldSchema],
    steps: [StepSchema],
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = model("Domain", DomainSchema, "domains");
