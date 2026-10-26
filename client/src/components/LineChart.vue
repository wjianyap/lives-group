<script setup>
// Lightweight SVG line chart. series: [{ label, color, values: (number|null)[], dashed?, band?: [lo,hi][] }]
import { computed, ref } from "vue";

const props = defineProps({
  labels: { type: Array, required: true },
  series: { type: Array, required: true },
  height: { type: Number, default: 240 },
  marker: { type: Number, default: null }, // index where a vertical "today" line goes
  format: { type: Function, default: (v) => Math.round(v).toLocaleString() },
});

const W = 720;
const pad = { l: 52, r: 16, t: 14, b: 28 };
const hover = ref(null);

const max = computed(() => {
  let m = 0;
  for (const s of props.series) {
    for (const v of s.values) if (v !== null && v !== undefined) m = Math.max(m, v);
    for (const b of s.band || []) if (b) m = Math.max(m, b[1]);
  }
  return niceMax(m || 1);
});

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, props.labels.length - 1);
const y = (v) => pad.t + (1 - v / max.value) * (props.height - pad.t - pad.b);

function path(values) {
  let d = "";
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const prev = values[i - 1];
    d += `${prev === null || prev === undefined || i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  return d;
}

function bandPath(band) {
  const pts = band.map((b, i) => (b ? [i, b] : null)).filter(Boolean);
  if (!pts.length) return "";
  const top = pts.map(([i, b]) => `${x(i)},${y(b[1])}`).join("L");
  const bottom = [...pts].reverse().map(([i, b]) => `${x(i)},${y(b[0])}`).join("L");
  return `M${top}L${bottom}Z`;
}

const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((f) => max.value * f));
const every = computed(() => Math.ceil(props.labels.length / 12));

function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * W;
  const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (props.labels.length - 1));
  hover.value = i >= 0 && i < props.labels.length ? i : null;
}
</script>

<template>
  <div class="chart">
    <svg :viewBox="`0 0 ${W} ${height}`" @mousemove="onMove" @mouseleave="hover = null">
      <g>
        <line v-for="t in ticks" :key="t" :x1="pad.l" :x2="W - pad.r" :y1="y(t)" :y2="y(t)" stroke="#eef2f6" />
        <text v-for="t in ticks" :key="'l' + t" :x="pad.l - 8" :y="y(t) + 4" text-anchor="end" class="axis">{{ format(t) }}</text>
        <text v-for="(l, i) in labels" v-show="i % every === 0" :key="'x' + i" :x="x(i)" :y="height - 8" text-anchor="middle" class="axis">{{ l }}</text>
      </g>
      <line v-if="marker !== null" :x1="x(marker)" :x2="x(marker)" :y1="pad.t" :y2="height - pad.b" stroke="#94a3b8" stroke-dasharray="3 3" />
      <path v-for="(s, k) in series.filter((s) => s.band)" :key="'b' + k" :d="bandPath(s.band)" :fill="s.color" opacity="0.13" />
      <path
        v-for="(s, k) in series"
        :key="k"
        :d="path(s.values)"
        fill="none"
        :stroke="s.color"
        :stroke-width="s.width || 2.2"
        :stroke-dasharray="s.dashed ? '5 4' : null"
        vector-effect="non-scaling-stroke"
        stroke-linejoin="round"
      />
      <g v-if="hover !== null">
        <line :x1="x(hover)" :x2="x(hover)" :y1="pad.t" :y2="height - pad.b" stroke="#cbd5e1" />
        <template v-for="(s, k) in series" :key="'h' + k">
          <circle v-if="s.values[hover] !== null && s.values[hover] !== undefined" :cx="x(hover)" :cy="y(s.values[hover])" r="3.5" :fill="s.color" />
        </template>
      </g>
    </svg>
    <div v-if="hover !== null" class="tip" :style="{ left: `${(x(hover) / W) * 100}%` }">
      <strong>{{ labels[hover] }}</strong>
      <div v-for="(s, k) in series.filter((s) => s.values[hover] !== null && s.values[hover] !== undefined)" :key="k">
        <i :style="{ background: s.color }"></i>{{ s.label }}: {{ format(s.values[hover]) }}
      </div>
    </div>
    <div class="legend mt8">
      <span v-for="s in series" :key="s.label"><i :style="{ background: s.color, opacity: s.dashed ? 0.7 : 1 }"></i>{{ s.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart { position: relative; }
svg { width: 100%; height: auto; display: block; }
.axis { font-size: 11px; fill: #6b7a8f; }
.tip { position: absolute; top: 0; transform: translateX(-50%); background: #fff; border: 1px solid var(--line); box-shadow: var(--shadow-lg); border-radius: 8px; padding: 8px 10px; font-size: 12px; pointer-events: none; white-space: nowrap; z-index: 5; }
.tip i { display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 6px; }
</style>
