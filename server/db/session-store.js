// express-session store kept in the JSON database (sessions.json), so logins survive a local server restart
const session = require("express-session");
const store = require("./store");

const COLLECTION = "sessions";
const DAY = 24 * 60 * 60 * 1000;

class JsonSessionStore extends session.Store {
  rows() {
    const rows = store.rows(COLLECTION);
    const now = Date.now();
    const live = rows.filter((r) => r.expires > now);
    if (live.length !== rows.length) {
      rows.splice(0, rows.length, ...live);
      store.changed(COLLECTION);
    }
    return rows;
  }

  get(sid, cb) {
    cb(null, this.rows().find((r) => r._id === sid)?.session ?? null);
  }

  set(sid, sess, cb) {
    const rows = this.rows();
    const row = { _id: sid, session: JSON.parse(JSON.stringify(sess)), expires: new Date(sess.cookie?.expires || Date.now() + DAY).getTime() };
    const at = rows.findIndex((r) => r._id === sid);
    if (at >= 0) rows[at] = row;
    else rows.push(row);
    store.changed(COLLECTION);
    cb?.(null);
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }

  destroy(sid, cb) {
    const rows = this.rows();
    const at = rows.findIndex((r) => r._id === sid);
    if (at >= 0) {
      rows.splice(at, 1);
      store.changed(COLLECTION);
    }
    cb?.(null);
  }
}

module.exports = JsonSessionStore;
