<script setup>
import { STATUS } from "../utils";
defineProps({ status: String });
</script>

<template>
  <span class="badge" :class="`t-${(STATUS[status] || STATUS.draft).tone}`">{{ (STATUS[status] || { label: status }).label }}</span>
</template>
