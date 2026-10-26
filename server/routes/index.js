const express = require("express");
const { requireLogin, requireRole } = require("../middleware/auth");
const auth = require("../controllers/auth-controller");
const requests = require("../controllers/requests-controller");
const domains = require("../controllers/domains-controller");
const master = require("../controllers/master-controller");
const analytics = require("../controllers/analytics-controller");
const intake = require("../controllers/intake-controller");
const notifications = require("../controllers/notifications-controller");
const constants = require("../config/constants");

const router = express.Router();
const staff = requireRole("mdm", "admin");

// ---- auth ----
router.post("/auth/login", auth.login);
router.post("/auth/logout", auth.logout);
router.get("/auth/me", requireLogin, auth.me);
router.get("/auth/demo-users", auth.demoUsers);
router.get("/users", requireLogin, staff, auth.list);

// ---- reference data ----
router.get("/meta", (req, res) =>
  res.json({
    countries: constants.COUNTRIES,
    entities: constants.ENTITIES,
    products: constants.PRODUCTS,
    functions: constants.APPROVER_FUNCTIONS,
  }),
);

// ---- domains (form + approval chain configuration) ----
router.get("/domains", requireLogin, domains.list);
router.get("/domains/:key", requireLogin, domains.get);
router.post("/domains", requireLogin, staff, domains.create);
router.put("/domains/:key", requireLogin, staff, domains.update);

// ---- requests ----
router.get("/requests/stats", requireLogin, requests.stats);
router.post("/requests/reminders/run", requireLogin, staff, requests.runReminders);
router.get("/requests", requireLogin, requests.list);
router.post("/requests", requireLogin, requests.create);
router.get("/requests/:id", requireLogin, requests.get);
router.put("/requests/:id", requireLogin, requests.update);
router.post("/requests/:id/approvals/:key", requireLogin, requests.decide);
router.post("/requests/:id/comments", requireLogin, requests.comment);
router.post("/requests/:id/complete", requireLogin, staff, requests.complete);
router.get("/requests/:id/audit", requireLogin, requests.audit);

// ---- master data & duplicates ----
router.post("/duplicates/check", requireLogin, master.check);
router.get("/master", requireLogin, master.list);
router.get("/master/scan", requireLogin, staff, master.scan);
router.post("/master/merge", requireLogin, staff, master.merge);
router.post("/master/unmerge", requireLogin, staff, master.unmerge);

// ---- regional business view ----
router.get("/analytics/regional", requireLogin, analytics.regional);
router.get("/analytics/forecasts", requireLogin, analytics.forecasts);
router.get("/analytics/insights", requireLogin, analytics.insights);
router.get("/analytics/pipeline", requireLogin, analytics.pipeline);
router.get("/analytics/recommendations", requireLogin, analytics.recommendations);

// ---- email intake ----
router.get("/intake/messages", requireLogin, intake.list);
router.post("/intake/classify", requireLogin, intake.classify);
router.post("/intake/messages", requireLogin, intake.create);
router.patch("/intake/messages/:id", requireLogin, intake.setStatus);
router.post("/intake/messages/:id/convert", requireLogin, intake.convert);

// ---- notifications ----
router.get("/notifications", requireLogin, notifications.list);
router.post("/notifications/:id/read", requireLogin, notifications.markRead);

module.exports = router;
