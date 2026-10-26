const mongoose = require("mongoose");

// A record that already exists in SAP B1 (mirrored here so we can check for duplicates before anyone approves).
const MasterRecordSchema = new mongoose.Schema(
  {
    domainKey: { type: String, required: true, index: true },
    code: { type: String, required: true, unique: true }, // SAP B1 CardCode / ItemCode / cost center code
    name: { type: String, required: true },
    entity: String,
    country: String,
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    // When MDM confirms two records are the same real-world customer, the extra one points at the survivor.
    // Analytics uses this to give one clean regional view per customer.
    mergedInto: String,
    segment: String, // customers: Hospital, Laboratory, Clinic...
    createdFromRequest: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("MasterRecord", MasterRecordSchema, "master_records");
