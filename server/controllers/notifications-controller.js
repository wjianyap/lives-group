const Notification = require("../models/notification-model");

exports.list = async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  const unread = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ items, unread });
};

exports.markRead = async (req, res) => {
  const filter = { user: req.user._id };
  if (req.params.id !== "all") filter._id = req.params.id;
  await Notification.updateMany(filter, { read: true });
  res.json({ ok: true });
};
