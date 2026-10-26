import { createRouter, createWebHistory } from "vue-router";
import { store } from "./store";
import { restoreSession } from "./session";

const routes = [
  { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
  { path: "/", name: "dashboard", component: () => import("./views/DashboardView.vue") },
  { path: "/requests", name: "requests", component: () => import("./views/RequestsView.vue") },
  { path: "/approvals", name: "approvals", component: () => import("./views/RequestsView.vue"), props: { initialScope: "awaiting" } },
  { path: "/requests/new/:domain?", name: "new-request", component: () => import("./views/RequestFormView.vue") },
  { path: "/requests/:id/edit", name: "edit-request", component: () => import("./views/RequestFormView.vue") },
  { path: "/requests/:id", name: "request", component: () => import("./views/RequestDetailView.vue") },
  { path: "/mdm", name: "mdm", component: () => import("./views/MdmView.vue"), meta: { staff: true } },
  { path: "/insights", name: "insights", component: () => import("./views/InsightsView.vue") },
  { path: "/intake", name: "intake", component: () => import("./views/IntakeView.vue") },
  { path: "/admin/domains", name: "domains", component: () => import("./views/DomainsView.vue"), meta: { staff: true } },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (!store.checked) await restoreSession();
  if (!to.meta.public && !store.user) return { name: "login", query: { redirect: to.fullPath } };
  if (to.name === "login" && store.user) return { name: "dashboard" };
  if (to.meta.staff && !["mdm", "admin"].includes(store.user?.role)) return { name: "dashboard" };
});

export default router;
