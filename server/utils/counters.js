const store = require("../db/store");

// Sequence numbers (request references, SAP codes) and simple running metrics, kept in counters.json.
// The server is one Node process and these run without awaiting in between, so two requests never get the same number.
function row(name) {
  const rows = store.rows("counters");
  let r = rows.find((x) => x._id === name);
  if (!r) rows.push((r = { _id: name, value: 0 }));
  return r;
}

exports.next = async function (name) {
  const r = row(name);
  r.value += 1;
  store.changed("counters");
  return r.value;
};

exports.bump = async function (name, by = 1) {
  row(name).value += by;
  store.changed("counters");
};

exports.get = async function (name) {
  return store.rows("counters").find((x) => x._id === name)?.value || 0;
};

exports.set = async function (name, value) {
  row(name).value = value;
  store.changed("counters");
};
