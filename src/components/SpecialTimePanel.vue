<script setup lang="ts">
import type { SpecialTimeSettings, TimeValue } from '../core/index.ts'
defineProps<{
  settings: SpecialTimeSettings; charges: number; remaining: number; editing: boolean; canStart: boolean; canConfirm: boolean
  selectedCell: number | null; currentValue: bigint; selectedValue: TimeValue | null; size: number
}>()
const emit = defineEmits<{ start: []; cancel: []; confirm: []; selectValue: [value: TimeValue] }>()
</script>
<template>
  <div class="special-time-panel">
    <div v-if="!editing" class="time-progress">
      <p class="time-charges" role="status" aria-live="polite" aria-atomic="true">変更権：<strong>{{ charges }} / {{ settings.maxCharges }}</strong></p>
      <p class="time-countdown">{{ charges >= settings.maxCharges ? '保有上限' : `次回あと${remaining}手` }}</p>
    </div>
    <button v-if="!editing" class="secondary special-time-start" type="button" :disabled="!canStart" @click="emit('start')">数字を変更する</button>
    <div v-else class="time-editor">
      <p class="time-preview" aria-live="polite">{{ selectedCell === null ? '盤面のマスを選択してください。' : `${Math.floor(selectedCell / size) + 1}行${selectedCell % size + 1}列：${currentValue === 0n ? '空き' : currentValue} → ${selectedValue ?? '数字を選択'}` }}</p>
      <div class="time-number-buttons" role="group" aria-label="変更後の数字">
        <button v-for="value in settings.values" :key="value" class="time-number" type="button" :data-value="value" :aria-pressed="selectedValue === value" @click="emit('selectValue', value)">{{ value }}</button>
      </div>
      <div class="time-editor-actions">
        <button class="primary time-confirm" type="button" :disabled="!canConfirm" @click="emit('confirm')">確定</button>
        <button class="secondary time-cancel" type="button" @click="emit('cancel')">キャンセル</button>
      </div>
      <p class="time-edit-notice">確定で変更権を1回消費し、変更前のUndo履歴を破棄します。</p>
    </div>
  </div>
</template>
