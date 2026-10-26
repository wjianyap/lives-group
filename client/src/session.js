import { api } from "./api";
import { store } from "./store";

let poll;

export async function loadMeta() {
  if (!store.meta.countries.length) store.meta = await api.get("/meta");
}

export async function refreshNotifications() {
  if (!store.user) return;
  try {
    store.notifications = await api.get("/notifications");
  } catch {
    /* ignore - the next poll will retry */
  }
}

function startPolling() {
  clearInterval(poll);
  refreshNotifications();
  poll = setInterval(refreshNotifications, 20000);
}

export async function restoreSession() {
  try {
    await loadMeta();
    store.user = await api.get("/auth/me");
    startPolling();
  } catch {
    store.user = null;
  } finally {
    store.checked = true;
  }
}

export async function login(email, password) {
  store.user = await api.post("/auth/login", { email, password });
  await loadMeta();
  startPolling();
}

export async function logout() {
  await api.post("/auth/logout").catch(() => {});
  clearInterval(poll);
  store.user = null;
  store.notifications = { items: [], unread: 0 };
}
