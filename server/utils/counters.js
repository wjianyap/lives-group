const mongoose = require("mongoose");

// Atomic sequence numbers (request references, SAP codes) and simple running metrics
exports.next = async function (name) {
  const doc = await mongoose.connection
    .collection("counters")
    .findOneAndUpdate({ _id: name }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" });
  return doc.value; // driver v6 returns the document itself
};

exports.bump = function (name, by = 1) {
  return mongoose.connection.collection("counters").updateOne({ _id: name }, { $inc: { value: by } }, { upsert: true });
};

exports.get = async function (name) {
  const doc = await mongoose.connection.collection("counters").findOne({ _id: name });
  return doc?.value || 0;
};

exports.set = function (name, value) {
  return mongoose.connection.collection("counters").updateOne({ _id: name }, { $set: { value } }, { upsert: true });
};
