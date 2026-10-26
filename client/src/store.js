import { reactive } from "vue";

// App-wide state: who is logged in, reference data, notifications
export const store = reactive({
  user: null,
  checked: false, // have we asked the server who is logged in yet?
  meta: { countries: [], entities: [], products: [], functions: [] },
  notifications: { items: [], unread: 0 },
  toast: null,
});

let toastTimer;
export function toast(message, kind = "ok") {
  store.toast = { message, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = null), 3500);
}

export const isStaff = () => ["mdm", "admin"].includes(store.user?.role);
export const isApprover = () => store.user?.role === "approver" || store.user?.role === "admin";

export const countryName = (code) => store.meta.countries.find((c) => c.code === code)?.name || code || "—";
export const entityName = (code) => store.meta.entities.find((e) => e.code === code)?.name || code;
export const productName = (code) => store.meta.products.find((p) => p.code === code)?.name || code;
export const functionName = (code) => store.meta.functions.find((f) => f.code === code)?.name || code;
