<script setup>
import { store } from "../store";
import Icon from "./Icon.vue";

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: null,
  error: String,
  savedMask: String, // sensitive value already stored (shown masked)
});
const emit = defineEmits(["update:modelValue", "blur"]);
const set = (v) => emit("update:modelValue", v);
</script>

<template>
  <div class="field" :class="{ wide: field.type === 'textarea' }">
    <label v-if="field.type !== 'checkbox'" :for="field.key">
      {{ field.label }}<span v-if="field.required" class="req">*</span>
      <span v-if="field.sensitive" class="lock" title="Encrypted at rest; only Finance and MDM can see it unmasked"><Icon name="lock" :size="11" /> sensitive</span>
    </label>

    <label v-if="field.type === 'checkbox'" class="check">
      <input :id="field.key" type="checkbox" :checked="modelValue === true" @change="set($event.target.checked)" />
      {{ field.label }}
    </label>
    <select v-else-if="field.type === 'select'" :id="field.key" class="input" :class="{ invalid: error }" :value="modelValue ?? ''" @change="set($event.target.value)" @blur="emit('blur')">
      <option value="" disabled>Choose…</option>
      <option v-for="o in field.options" :key="o" :value="o">{{ o }}</option>
    </select>
    <select v-else-if="field.type === 'country'" :id="field.key" class="input" :class="{ invalid: error }" :value="modelValue ?? ''" @change="set($event.target.value)" @blur="emit('blur')">
      <option value="" disabled>Choose…</option>
      <option v-for="c in store.meta.countries" :key="c.code" :value="c.code">{{ c.name }}</option>
    </select>
    <textarea v-else-if="field.type === 'textarea'" :id="field.key" class="input" :class="{ invalid: error }" :value="modelValue ?? ''" :placeholder="field.placeholder" @input="set($event.target.value)" @blur="emit('blur')"></textarea>
    <input
      v-else
      :id="field.key"
      class="input"
      :class="{ invalid: error }"
      :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'"
      :value="modelValue ?? ''"
      :placeholder="savedMask ? `Saved (${savedMask}) – leave blank to keep` : field.placeholder"
      :min="field.min"
      :max="field.max"
      autocomplete="off"
      @input="set(field.type === 'number' && $event.target.value !== '' ? Number($event.target.value) : $event.target.value)"
      @blur="emit('blur')"
    />
    <span v-if="error" class="err">{{ error }}</span>
    <span v-else-if="field.help" class="help">{{ field.help }}</span>
  </div>
</template>
