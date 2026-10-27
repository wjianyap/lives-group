// The database is a folder of JSON files (server/data/db by default, DATA_DIR to move it), one per collection.
// Each collection is loaded into memory on first use; changes are written back shortly after, and on shutdown.
// Writes go to a temp file that is then renamed over the old one, so a crash never leaves half a file.
const fs = require("fs");
const path = require("path");

const DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data", "db");
const WRITE_DELAY_MS = 25; // bursts of changes (a save + its audit entries) become one write

const collections = new Map(); // name -> { rows, timer }

const fileFor = (name) => path.join(DIR, `${name}.json`);

function open(name) {
  let c = collections.get(name);
  if (!c) {
    const file = fileFor(name);
    c = { rows: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [], timer: null };
    collections.set(name, c);
  }
  return c;
}

// One document per line: small, readable files with clean git diffs
function writeNow(name) {
  const c = collections.get(name);
  if (!c) return;
  clearTimeout(c.timer);
  c.timer = null;
  fs.mkdirSync(DIR, { recursive: true });
  const text = c.rows.length ? `[\n${c.rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n` : "[]\n";
  const tmp = `${fileFor(name)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, fileFor(name));
}

exports.dir = DIR;

// The live array of plain objects for a collection (callers change it, then call changed())
exports.rows = (name) => open(name).rows;

exports.changed = function (name) {
  const c = open(name);
  if (!c.timer) c.timer = setTimeout(() => writeNow(name), WRITE_DELAY_MS);
};

exports.replace = function (name, rows) {
  open(name).rows = rows;
  exports.changed(name);
};

// Writes everything that is waiting (used on shutdown and at the end of the seed script)
exports.flush = function () {
  for (const [name, c] of collections) if (c.timer) writeNow(name);
};

process.on("exit", exports.flush);
for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) { // SIGUSR2: nodemon restart
  process.once(signal, () => {
    exports.flush();
    process.exit(0);
  });
}
