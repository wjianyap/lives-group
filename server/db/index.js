// A small Mongoose-style data layer over JSON files (see ./store.js), so models and controllers read the same as before:
//   Model.find(filter).populate("requester", "name").sort({ updatedAt: -1 }).limit(50).lean()
//   const doc = await Model.findById(id); doc.status = "approved"; await doc.save();
// Schemas keep their Mongoose syntax: types are cast, defaults filled in, required / enum / match / unique checked,
// unknown keys dropped, and createdAt / updatedAt stamped when { timestamps: true }.
// Filters support plain equality (also "array contains"), RegExp, $in, $nin, $ne, $exists, $gt(e), $lt(e), $or and $and.
const crypto = require("crypto");
const store = require("./store");

function Mixed() {}
function ObjectId() {}

// 24 hex characters like a MongoDB ObjectId (time first, so ids sort roughly by creation) - URLs keep the same shape
const newId = () => Math.floor(Date.now() / 1000).toString(16).padStart(8, "0") + crypto.randomBytes(8).toString("hex");

class Schema {
  constructor(definition, options = {}) {
    this.options = { _id: true, strict: true, ...options };
    this.paths = {};
    for (const [key, def] of Object.entries(definition)) this.paths[key] = normalize(def);
  }
}
Schema.Types = { Mixed, ObjectId };

const isType = (t) => typeof t === "function" || Array.isArray(t) || t instanceof Schema;

function normalize(def) {
  if (def instanceof Schema || typeof def === "function") return { type: def };
  if (Array.isArray(def)) return { type: Array, of: normalize(def[0] ?? Mixed) };
  if (def && typeof def === "object") {
    if (!isType(def.type)) return { type: new Schema(def) }; // nested object such as { reason, by, at }
    if (Array.isArray(def.type)) return { ...def, type: Array, of: normalize(def.type[0] ?? Mixed) };
    return { ...def };
  }
  return { type: Mixed };
}

// ---------- casting and validation ----------

function check(spec, value, path, errors) {
  const empty = value === undefined || value === null || value === "";
  if (spec.required && empty) errors.push(`${path}: Path \`${path}\` is required.`);
  if (empty) return;
  if (spec.enum && !spec.enum.includes(value)) errors.push(`${path}: \`${value}\` is not a valid enum value for path \`${path}\`.`);
  if (spec.match && !spec.match.test(String(value))) errors.push(`${path}: Path \`${path}\` is invalid (${value}).`);
}

function cast(spec, value, path, errors) {
  if (value === undefined || value === null) return value;
  const T = spec.type;
  const fail = () => {
    errors.push(`${path}: Cast to ${T.name || "value"} failed for value "${value}"`);
    return value;
  };
  if (T === Mixed) return value;
  if (T === String) {
    let s = value instanceof Date ? value.toISOString() : String(value);
    if (spec.trim) s = s.trim();
    if (spec.lowercase) s = s.toLowerCase();
    return s;
  }
  if (T === Number) {
    if (value === "") return null;
    const n = Number(value);
    return Number.isNaN(n) ? fail() : n;
  }
  if (T === Boolean) {
    if ([true, "true", 1, "1"].includes(value)) return true;
    if ([false, "false", 0, "0"].includes(value)) return false;
    return fail();
  }
  if (T === Date) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? fail() : d;
  }
  if (T === ObjectId) return String(typeof value === "object" && value._id !== undefined ? value._id : value);
  if (T === Array) {
    return (Array.isArray(value) ? value : [value]).map((item, i) => {
      const out = cast(spec.of, item, `${path}.${i}`, errors);
      check(spec.of, out, `${path}.${i}`, errors);
      // array elements that are sub-documents get their own _id, as in Mongoose
      if (spec.of.type instanceof Schema && spec.of.type.options._id && out && typeof out === "object" && out._id === undefined) {
        return { _id: newId(), ...out };
      }
      return out;
    });
  }
  if (T instanceof Schema) return typeof value === "object" ? castObject(T, value, `${path}.`, errors) : fail();
  return value;
}

function castObject(schema, obj, prefix, errors) {
  const out = {};
  if (obj._id !== undefined) out._id = String(obj._id);
  for (const [key, spec] of Object.entries(schema.paths)) {
    let v = obj[key];
    if (v === undefined && spec.default !== undefined) v = typeof spec.default === "function" ? spec.default() : spec.default;
    if (v === undefined && spec.type === Array) v = [];
    v = cast(spec, v, prefix + key, errors);
    check(spec, v, prefix + key, errors);
    if (v !== undefined) out[key] = v;
  }
  if (schema.options.timestamps) {
    for (const key of ["createdAt", "updatedAt"]) if (obj[key] != null) out[key] = cast({ type: Date }, obj[key], key, errors);
  }
  if (!schema.options.strict) for (const key of Object.keys(obj)) if (!(key in out)) out[key] = obj[key];
  return out;
}

function validationError(modelName, errors) {
  const err = new Error(`${modelName} validation failed: ${errors.join(", ")}`);
  err.name = "ValidationError";
  return err;
}

// ---------- filters, sorting, projection ----------

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  if (value === undefined) delete target[last];
  else target[last] = value;
}

function equal(a, b) {
  if (b === null || b === undefined) return a === null || a === undefined;
  if (b instanceof RegExp) return typeof a === "string" && b.test(a);
  if (a instanceof Date || b instanceof Date) return a != null && new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}

// a filter value matches an array field when any element matches (like MongoDB)
const has = (value, wanted) => (Array.isArray(value) && !Array.isArray(wanted) ? value.some((x) => equal(x, wanted)) : equal(value, wanted));

const compare = (a, b) => {
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
};

const isOperatorObject = (c) =>
  c && typeof c === "object" && !(c instanceof RegExp) && !(c instanceof Date) && !Array.isArray(c) && Object.keys(c).some((k) => k.startsWith("$"));

function matchCondition(value, cond) {
  if (!isOperatorObject(cond)) return has(value, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case "$in": return arg.some((x) => has(value, x));
      case "$nin": return !arg.some((x) => has(value, x));
      case "$ne": return !has(value, arg);
      case "$exists": return (value !== undefined && value !== null) === Boolean(arg);
      case "$gt": return value != null && compare(value, arg) > 0;
      case "$gte": return value != null && compare(value, arg) >= 0;
      case "$lt": return value != null && compare(value, arg) < 0;
      case "$lte": return value != null && compare(value, arg) <= 0;
      default: throw new Error(`Unsupported filter operator ${op}`);
    }
  });
}

function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return cond.some((f) => matches(row, f));
    if (key === "$and") return cond.every((f) => matches(row, f));
    return matchCondition(getPath(row, key), cond);
  });
}

// "name email", "+password", "-data" or { name: 1 } -> { include: Set | null, exclude: Set, force: Set }
function parseProjection(spec, into = { include: null, exclude: new Set(), force: new Set() }) {
  if (!spec) return into;
  const entries = typeof spec === "string" ? spec.split(/\s+/).filter(Boolean).map((p) => (p[0] === "-" ? [p.slice(1), 0] : [p, 1])) : Object.entries(spec);
  for (const [path, on] of entries) {
    if (path.startsWith("+")) into.force.add(path.slice(1));
    else if (!on) into.exclude.add(path);
    else (into.include ??= new Set()).add(path);
  }
  return into;
}

// returns the projected copy and the top-level paths it left out (so save() keeps them)
function project(row, schema, projection) {
  const left = new Set();
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const hidden =
      (key !== "_id" && projection.include && !projection.include.has(key)) ||
      projection.exclude.has(key) ||
      (schema.paths[key]?.select === false && !projection.force.has(key));
    if (hidden) left.add(key);
    else out[key] = value;
  }
  return { out, left };
}

// ---------- models ----------

const models = {};

function specAt(schema, path) {
  let spec;
  for (const key of path.split(".")) {
    spec = schema?.paths[key];
    if (spec?.type === Array) spec = spec.of;
    schema = spec?.type instanceof Schema ? spec.type : null;
  }
  return spec;
}

class Query {
  constructor(Model, filter, { single = false, projection } = {}) {
    Object.assign(this, { Model, filter: filter || {}, single, projection: parseProjection(projection), sortBy: null, max: null, refs: [], plain: false });
  }
  sort(spec) {
    this.sortBy = spec;
    return this;
  }
  limit(n) {
    this.max = n;
    return this;
  }
  select(spec) {
    parseProjection(spec, this.projection);
    return this;
  }
  populate(path, select) {
    this.refs.push({ path, select });
    return this;
  }
  lean() {
    this.plain = true;
    return this;
  }
  run() {
    const { Model } = this;
    let rows = Model.rows().filter((r) => matches(r, this.filter));
    if (this.sortBy) {
      const keys = Object.entries(this.sortBy);
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of keys) {
          const c = compare(getPath(a, k), getPath(b, k));
          if (c) return dir < 0 || dir === "desc" ? -c : c;
        }
        return 0;
      });
    }
    if (this.single) rows = rows.slice(0, 1);
    else if (this.max) rows = rows.slice(0, this.max);

    const docs = rows.map((r) => {
      const { out, left } = project(structuredClone(r), Model.schema, this.projection);
      for (const ref of this.refs) populate(Model.schema, out, ref);
      return this.plain ? out : new Model(out, { isNew: false, left });
    });
    return this.single ? (docs[0] ?? null) : docs;
  }
  exec() {
    return Promise.resolve().then(() => this.run());
  }
  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }
  catch(reject) {
    return this.exec().catch(reject);
  }
}

// Replaces stored ids with the referenced documents, e.g. populate("approvals.actedBy", "name title")
function populate(schema, obj, { path, select }) {
  const spec = specAt(schema, path);
  const Ref = spec?.ref && models[spec.ref];
  if (!Ref) throw new Error(`Cannot populate "${path}": no ref`);
  const projection = parseProjection(select);
  const lookup = (id) => {
    if (id === undefined || id === null) return id;
    const row = Ref.rows().find((r) => r._id === String(id));
    return row ? project(structuredClone(row), Ref.schema, projection).out : null;
  };
  const walk = (o, keys) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, keys));
    const [key, ...rest] = keys;
    if (rest.length) return walk(o[key], rest);
    o[key] = Array.isArray(o[key]) ? o[key].map(lookup) : lookup(o[key]);
  };
  walk(obj, path.split("."));
}

function applyUpdate(doc, update) {
  const ops = Object.keys(update).some((k) => k.startsWith("$")) ? update : { $set: update };
  for (const [op, fields] of Object.entries(ops)) {
    for (const [path, value] of Object.entries(fields)) {
      if (op === "$set") setPath(doc, path, value);
      else if (op === "$unset") setPath(doc, path, undefined);
      else if (op === "$inc") setPath(doc, path, (getPath(doc, path) || 0) + value);
      else throw new Error(`Unsupported update operator ${op}`);
    }
  }
}

function model(name, schema, collection) {
  let hydrated = false;

  class Model {
    constructor(data = {}, { isNew = true, left = new Set() } = {}) {
      Object.defineProperty(this, "$isNew", { value: isNew, writable: true });
      Object.defineProperty(this, "$left", { value: left, writable: true });
      if (isNew) Object.assign(this, { _id: data._id ? String(data._id) : newId() }, castObject(schema, data, "", []));
      else Object.assign(this, data);
    }

    // stored rows, with dates turned back into Date objects the first time the collection is read
    static rows() {
      const rows = store.rows(collection);
      if (!hydrated) {
        for (let i = 0; i < rows.length; i++) rows[i] = { _id: rows[i]._id, ...castObject(schema, rows[i], "", []) };
        hydrated = true;
      }
      return rows;
    }

    static find(filter, projection) {
      return new Query(Model, filter, { projection });
    }
    static findOne(filter, projection) {
      return new Query(Model, filter, { single: true, projection });
    }
    static findById(id, projection) {
      return Model.findOne({ _id: String(id) }, projection);
    }
    static async findByIdAndUpdate(id, update, { new: returnNew = false } = {}) {
      const doc = await Model.findById(id);
      if (!doc) return null;
      const before = doc.toObject();
      applyUpdate(doc, update);
      await doc.save();
      return returnNew ? doc : new Model(before, { isNew: false });
    }
    static async exists(filter) {
      const row = Model.rows().find((r) => matches(r, filter));
      return row ? { _id: row._id } : null;
    }
    static async countDocuments(filter) {
      return Model.rows().filter((r) => matches(r, filter)).length;
    }
    static async create(data) {
      if (Array.isArray(data)) return Model.insertMany(data);
      return new Model(data).save();
    }
    static async insertMany(list) {
      const docs = [];
      for (const data of list) docs.push(await new Model(data).save());
      return docs;
    }
    static async updateOne(filter, update) {
      return Model.updateMany(filter, update, { one: true });
    }
    static async updateMany(filter, update, { one = false } = {}) {
      let hits = Model.rows().filter((r) => matches(r, filter));
      if (one) hits = hits.slice(0, 1);
      for (const row of hits) {
        const doc = new Model(structuredClone(row), { isNew: false });
        applyUpdate(doc, update);
        await doc.save();
      }
      return { acknowledged: true, matchedCount: hits.length, modifiedCount: hits.length };
    }
    static async deleteMany(filter = {}) {
      const rows = Model.rows();
      const keep = rows.filter((r) => !matches(r, filter));
      const deletedCount = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      store.changed(collection);
      return { acknowledged: true, deletedCount };
    }

    async save({ timestamps = true } = {}) {
      const errors = [];
      const out = { _id: this._id, ...castObject(schema, { ...this }, "", errors) };
      if (errors.length) throw validationError(name, errors);
      const rows = Model.rows();
      const at = rows.findIndex((r) => r._id === this._id);
      // fields the query did not load (e.g. a hidden password) keep their stored values
      if (at >= 0) for (const key of this.$left) if (rows[at][key] !== undefined) out[key] = rows[at][key];
      for (const [key, spec] of Object.entries(schema.paths)) {
        if (!spec.unique || out[key] == null) continue;
        if (rows.some((r) => r._id !== out._id && equal(r[key], out[key]))) {
          const err = new Error(`E11000 duplicate key error collection: ${collection} dup key: { ${key}: "${out[key]}" }`);
          err.code = 11000;
          throw err;
        }
      }
      if (schema.options.timestamps && timestamps) {
        const now = new Date();
        out.createdAt ??= now;
        out.updatedAt = now;
      }
      if (at >= 0) rows[at] = structuredClone(out);
      else rows.push(structuredClone(out));
      store.changed(collection);
      for (const key of Object.keys(this)) if (!(key in out)) delete this[key];
      Object.assign(this, out);
      this.$isNew = false;
      this.$left = new Set();
      return this;
    }

    toObject() {
      return structuredClone({ ...this });
    }
    markModified() {} // every save writes the whole document, so there is nothing to track
  }

  Object.defineProperty(Model, "name", { value: name });
  Object.assign(Model, { modelName: name, schema, collection });
  models[name] = Model;
  return Model;
}

module.exports = { Schema, model, newId, store };
