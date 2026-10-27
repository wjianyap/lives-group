<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { login } from "../session";

const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function signIn(e = email.value, p = password.value) {
  busy.value = true;
  error.value = "";
  try {
    await login(e, p);
    router.push(route.query.redirect || "/");
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <section class="hero">
      <div class="brand-row">
        <div class="mark">L</div>
        <strong>Lives Group</strong>
      </div>
      <h1>One place to request, approve and track master data, and to see where the region is growing.</h1>
      <ul>
        <li>Guided forms that only ask for what each record type needs</li>
        <li>Duplicate check before anything reaches an approver</li>
        <li>Parallel approvals with SLA reminders, so every step shows who it is waiting on</li>
        <li>Tamper-evident audit trail and encrypted bank &amp; credit fields</li>
        <li>Regional view: Products A–C across five countries, with forecasts</li>
      </ul>
      <p class="foot">Prototype for the SMU DSA Data Case Competition 2026 · all data is synthetic</p>
    </section>

    <section class="panel">
      <h2>Sign in</h2>
      <form class="stack mt16" @submit.prevent="signIn()">
        <div class="field"><label>Email</label><input v-model="email" class="input" type="email" autocomplete="username" /></div>
        <div class="field"><label>Password</label><input v-model="password" class="input" type="password" autocomplete="current-password" /></div>
        <div v-if="error" class="callout bad">{{ error }}</div>
        <button class="btn primary" :disabled="busy">Sign in</button>
      </form>

    </section>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; }
.hero { background: linear-gradient(160deg, #0b2a33, #0f766e); color: #e3f1ef; padding: 56px; display: flex; flex-direction: column; gap: 22px; }
.hero h1 { color: #fff; font-size: 30px; max-width: 520px; line-height: 1.2; }
.hero ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; max-width: 520px; }
.hero .foot { margin-top: auto; font-size: 12px; opacity: 0.7; }
.brand-row { display: flex; align-items: center; gap: 10px; color: #fff; font-size: 16px; }
.mark { width: 36px; height: 36px; border-radius: 9px; background: rgba(255, 255, 255, 0.15); display: grid; place-items: center; font-weight: 700; }
.panel { padding: 48px 56px; max-width: 620px; width: 100%; background: var(--surface); overflow-y: auto; }
@media (max-width: 900px) {
  .login { grid-template-columns: 1fr; }
  .hero { padding: 28px 16px; }
  .hero h1 { font-size: 22px; }
  .panel { padding: 24px 16px; }
}
</style>
