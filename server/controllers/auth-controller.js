const bcrypt = require("bcryptjs");
const User = require("../models/user-model");

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  title: u.title,
  role: u.role,
  functions: u.functions,
  entities: u.entities,
  country: u.country,
});

exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: "Email and password are required." });
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select("+password");
  if (!user || !(await bcrypt.compare(String(password), user.password))) {
    return res.status(401).json({ message: "Wrong email or password." });
  }
  // new session id on login (stops session fixation)
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ message: "Could not start session." });
    req.session.userId = String(user._id);
    req.session.save(() => res.json(publicUser(user)));
  });
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
};

exports.me = (req, res) => res.json(publicUser(req.user));

// Demo personas for the login screen (turn off with DEMO_LOGIN=false)
exports.demoUsers = async (req, res) => {
  if (process.env.DEMO_LOGIN === "false") return res.json([]);
  const users = await User.find({ email: /@demo\.livesgroup\.test$/ }).sort({ role: 1, name: 1 }).lean();
  res.json(users.map(publicUser));
};

exports.list = async (req, res) => {
  const users = await User.find().sort({ role: 1, name: 1 }).lean();
  res.json(users.map(publicUser));
};

exports.publicUser = publicUser;
