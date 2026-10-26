// Tiny fetch wrapper: JSON in/out, cookies included, errors carry the server's message
import router from "./router";
import { store } from "./store";

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && !url.startsWith("/auth/")) {
    store.user = null;
    router.push({ name: "login", query: { redirect: router.currentRoute.value.fullPath } });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body = {}) => request("POST", url, body),
  put: (url, body = {}) => request("PUT", url, body),
  patch: (url, body = {}) => request("PATCH", url, body),
};
