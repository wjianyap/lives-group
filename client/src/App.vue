<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, isStaff } from "./store";
import { api } from "./api";
import { logout, refreshNotifications } from "./session";
import { timeAgo } from "./utils";
import Icon from "./components/Icon.vue";

const route = useRoute();
const router = useRouter();
const showBell = ref(false);
const awaiting = ref(0);
const bare = computed(() => route.meta.public);

const roleLabel = computed(() => ({ requestor: "Requestor", approver: "Approver", mdm: "MDM team", admin: "Admin" })[store.user?.role]);

async function loadCounts() {
  if (!store.user || !["approver", "admin"].includes(store.user.role)) return (awaiting.value = 0);
  try {
    awaiting.value = (await api.get("/requests?scope=awaiting")).length;
  } catch {
    /* not critical */
  }
}
watch(() => [store.user?._id, route.fullPath, store.notifications.unread], loadCounts, { immediate: true });

async function openNotification(n) {
  showBell.value = false;
  if (!n.read) await api.post(`/notifications/${n._id}/read`);
  refreshNotifications();
  if (n.link) router.push(n.link);
}
async function markAll() {
  await api.post("/notifications/all/read");
  refreshNotifications();
}
async function signOut() {
  await logout();
  router.push({ name: "login" });
}

const close = (e) => {
  if (!e.target.closest?.(".bell-wrap")) showBell.value = false;
};
onMounted(() => document.addEventListener("click", close));
onBeforeUnmount(() => document.removeEventListener("click", close));

const kindTone = { action: "t-info", reminder: "t-warn", escalation: "t-bad", completed: "t-good", update: "t-muted" };
</script>

<template>
  <router-view v-if="bare" />
  <div v-else-if="store.user" class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">L</div>
        <div>
          <strong>Lives Group</strong>
          <small>Master Data Portal</small>
        </div>
      </div>
      <router-link class="nav-link" to="/" active-class="" exact-active-class="router-link-active"><Icon name="home" />Home</router-link>
      <router-link class="nav-link" to="/requests/new"><Icon name="plus" />New request</router-link>
      <router-link class="nav-link" to="/requests" active-class="" exact-active-class="router-link-active"><Icon name="list" />Requests</router-link>
      <router-link v-if="['approver', 'admin'].includes(store.user.role)" class="nav-link" to="/approvals">
        <Icon name="check" />Waiting on me <span v-if="awaiting" class="count">{{ awaiting }}</span>
      </router-link>
      <div class="nav-group">Commercial</div>
      <router-link class="nav-link" to="/insights"><Icon name="chart" />Regional view</router-link>
      <router-link class="nav-link" to="/intake"><Icon name="inbox" />Email intake</router-link>
      <template v-if="isStaff()">
        <div class="nav-group">MDM team</div>
        <router-link class="nav-link" to="/mdm"><Icon name="db" />MDM workbench</router-link>
        <router-link class="nav-link" to="/admin/domains"><Icon name="sliders" />Request types</router-link>
      </template>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="spacer"></div>
        <div class="bell-wrap" style="position: relative">
          <button class="btn ghost icon-btn" aria-label="Notifications" @click="showBell = !showBell">
            <Icon name="bell" />
            <span v-if="store.notifications.unread" class="dot">{{ store.notifications.unread }}</span>
          </button>
          <div v-if="showBell" class="card bell-panel">
            <div class="card-head">
              <h3>Notifications</h3>
              <button class="btn ghost sm" @click="markAll">Mark all read</button>
            </div>
            <div v-if="!store.notifications.items.length" class="empty">Nothing yet</div>
            <button v-for="n in store.notifications.items" :key="n._id" class="note" :class="{ unread: !n.read }" @click="openNotification(n)">
              <span class="badge plain" :class="kindTone[n.kind]">{{ n.kind }}</span>
              <span class="note-text">{{ n.message }}</span>
              <span class="muted small">{{ timeAgo(n.createdAt) }}</span>
            </button>
          </div>
        </div>
        <div class="who">
          <div class="avatar">{{ store.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("") }}</div>
          <div class="who-text">
            <strong>{{ store.user.name }}</strong>
            <span class="muted small">{{ store.user.title }} · {{ roleLabel }}</span>
          </div>
        </div>
        <button class="btn ghost sm" title="Sign out / switch persona" @click="signOut"><Icon name="logout" :size="16" />Switch</button>
      </header>
      <main class="page"><router-view :key="route.fullPath" /></main>
    </div>
  </div>
  <div v-if="store.toast" class="toast" :class="store.toast.kind">{{ store.toast.message }}</div>
</template>

<style scoped>
.who { display: flex; align-items: center; gap: 10px; }
.who-text { display: flex; flex-direction: column; line-height: 1.25; }
.avatar { width: 34px; height: 34px; border-radius: 99px; background: var(--brand-50); color: var(--brand); display: grid; place-items: center; font-weight: 700; font-size: 13px; }
.bell-panel { position: absolute; right: 0; top: 44px; width: 400px; max-height: 70vh; overflow: auto; z-index: 50; box-shadow: var(--shadow-lg); }
.note { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; width: 100%; text-align: left; padding: 11px 16px; border: none; border-bottom: 1px solid var(--line-2); background: #fff; font: inherit; cursor: pointer; }
.note:hover { background: #f8fafb; }
.note.unread { background: #f3faf9; }
.note .muted { grid-column: 2; }
.note-text { font-size: 13px; }
@media (max-width: 760px) {
  .who-text { display: none; }
  .bell-panel { width: calc(100vw - 32px); right: -60px; }
}
</style>
