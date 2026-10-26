const User = require("../models/user-model");

// Loads the logged-in user onto req.user (or answers 401)
exports.requireLogin = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ message: "Please log in." });
  const user = await User.findById(req.session.userId).lean();
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Please log in." });
  }
  req.user = user;
  next();
};

exports.requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ message: "You do not have access to this." });
    next();
  };
