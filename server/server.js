const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "config.env") });

const express = require("express");
const session = require("express-session");
const store = require("./db/store");
const JsonSessionStore = require("./db/session-store");
const { runReminders } = require("./services/workflow");

const isProduction = process.env.NODE_ENV === "production";
const app = express();
if (isProduction) app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));

// Allow a separately-hosted frontend (CLIENT_ORIGINS=comma,separated) to call the API with cookies
const origins = (process.env.CLIENT_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});

async function start() {
  console.log(`Data folder: ${store.dir}`);

  app.use(
    session({
      secret: process.env.SECRET || "dev-only-secret-change-me",
      resave: false,
      saveUninitialized: false,
      store: new JsonSessionStore(),
      cookie: { httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 1000 * 60 * 60 * 8 },
    }),
  );

  app.use("/api", require("./routes"));
  app.use("/api", (req, res) => res.status(404).json({ message: "Not found." }));

  // Serve the built Vue app (client/dist) from the same origin when it exists
  const dist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res, next) => res.sendFile(path.join(dist, "index.html"), (err) => err && next()));

  // Errors (Express 5 forwards rejected promises here)
  app.use((err, req, res, _next) => {
    if (err.name === "ValidationError") return res.status(422).json({ message: err.message });
    if (err.name === "CastError") return res.status(400).json({ message: "Invalid id." });
    if (err.code === 11000) return res.status(409).json({ message: "That already exists." });
    console.error(err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Something went wrong." });
  });

  const port = Number(process.env.PORT) || 8100;
  app.listen(port, process.env.HOST || (isProduction ? "0.0.0.0" : "localhost"), () => console.log(`API on http://localhost:${port}`));

  // SLA reminders every 10 minutes
  setInterval(() => runReminders().catch((e) => console.error("reminders:", e.message)), 10 * 60 * 1000);
}

start().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
