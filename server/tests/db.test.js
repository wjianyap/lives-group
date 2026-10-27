const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// point the JSON database at a throwaway folder before anything loads it
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lives-db-"));
const { Schema, model, store } = require("../db");

const Person = model(
  "Person",
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      secret: { type: String, select: false },
      role: { type: String, enum: ["a", "b"], default: "a" },
      tags: [String],
      born: Date,
      score: Number,
      notes: [{ text: String, at: { type: Date, default: Date.now } }],
    },
    { timestamps: true },
  ),
  "people",
);
const Pet = model("Pet", new Schema({ name: String, owner: { type: Schema.Types.ObjectId, ref: "Person" } }), "pets");

test("create casts, fills defaults, drops unknown keys and stamps times", async () => {
  const p = await Person.create({ email: "  Amy@X.test ", born: "2000-01-02", score: "7", extra: 1 });
  assert.match(p._id, /^[0-9a-f]{24}$/);
  assert.equal(p.email, "amy@x.test");
  assert.equal(p.role, "a");
  assert.ok(p.born instanceof Date);
  assert.equal(p.score, 7);
  assert.deepEqual(p.tags, []);
  assert.equal(p.extra, undefined);
  assert.ok(p.createdAt instanceof Date);
});

test("validation and unique errors look like Mongoose's", async () => {
  await assert.rejects(Person.create({ role: "a" }), { name: "ValidationError" });
  await assert.rejects(Person.create({ email: "z@x.test", role: "nope" }), { name: "ValidationError" });
  await assert.rejects(Person.create({ email: "amy@x.test" }), { code: 11000 });
});

test("filters, sort, limit, projection and hidden fields", async () => {
  await Person.create({ email: "bob@x.test", role: "b", tags: ["vip"], score: 3, secret: "s3" });
  await Person.create({ email: "cat@x.test", role: "b", score: 9 });
  assert.equal((await Person.find({ role: "b" }).lean()).length, 2);
  assert.equal((await Person.find({ tags: "vip" }).lean())[0].email, "bob@x.test");
  assert.equal((await Person.find({ email: /^c/ }).lean()).length, 1);
  assert.equal((await Person.find({ role: { $in: ["b"] }, score: { $gt: 5 } }).lean())[0].email, "cat@x.test");
  assert.deepEqual((await Person.find({ $or: [{ score: 3 }, { score: 7 }] }).sort({ score: -1 }).lean()).map((p) => p.score), [7, 3]);
  assert.equal((await Person.find().sort({ email: 1 }).limit(1).lean())[0].email, "amy@x.test");
  const bob = await Person.findOne({ email: "bob@x.test" }, "email").lean();
  assert.deepEqual(Object.keys(bob).sort(), ["_id", "email"]);
  assert.equal((await Person.findOne({ email: "bob@x.test" }).lean()).secret, undefined);
  assert.equal((await Person.findOne({ email: "bob@x.test" }).select("+secret")).secret, "s3");
  assert.equal(await Person.countDocuments({ role: "b" }), 2);
  assert.ok(await Person.exists({ email: "cat@x.test" }));
});

test("saving a document keeps fields the query did not load", async () => {
  const bob = await Person.findOne({ email: "bob@x.test" });
  bob.score = 4;
  bob.notes.push({ text: "hi" });
  await bob.save();
  const again = await Person.findById(bob._id).select("+secret").lean();
  assert.equal(again.secret, "s3");
  assert.equal(again.score, 4);
  assert.match(again.notes[0]._id, /^[0-9a-f]{24}$/);
  assert.ok(again.notes[0].at instanceof Date);
});

test("update operators and populate", async () => {
  const amy = await Person.findOne({ email: "amy@x.test" }).lean();
  await Person.updateMany({ role: "b" }, { $set: { score: 1 } });
  await Person.updateOne({ email: "cat@x.test" }, { $unset: { score: 1 } });
  assert.deepEqual((await Person.find({ role: "b" }).sort({ email: 1 }).lean()).map((p) => p.score), [1, undefined]);
  await Pet.create({ name: "Rex", owner: amy._id });
  const rex = await Pet.findOne({ name: "Rex" }).populate("owner", "email").lean();
  assert.deepEqual(rex.owner, { _id: amy._id, email: "amy@x.test" });
});

test("changes are written to the JSON file and read back with dates", async () => {
  store.flush();
  const rows = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "people.json"), "utf8"));
  assert.equal(rows.length, 3);
  assert.equal(typeof rows[0].createdAt, "string");
  const amy = await Person.findOne({ email: "amy@x.test" }).lean();
  assert.ok(amy.born instanceof Date);
});
