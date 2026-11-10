<script setup lang="ts">
import type { SpecialTimeSettings, TimeValue } from '../core/index.ts'
defineProps<{
  settings: SpecialTimeSettings; charges: number; remaining: number; editing: boolean; canStart: boolean; canConfirm: boolean
  selectedCell: number | null; currentValue: bigint; selectedValue: TimeValue | null; size: number
}>()
const emit = defineEmits<{ start: []; cancel: []; confirm: []; selectValue: [value: TimeValue] }>()
</script>
<template>
  <section class="special-time-panel" aria-label="スペシャルタイム">
    <p class="time-countdown">スペシャルタイム：{{ charges >= settings.maxCharges ? `保有上限（次の周期まであと${remaining}手）` : `あと${remaining}手で獲得` }}</p>
    <p class="time-charges" role="status" aria-live="polite" aria-atomic="true">変更権：<strong>{{ charges }} / {{ settings.maxCharges }}</strong></p>
    <p v-if="!editing" class="time-use-help">{{ settings.interval }}回の有効移動ごとに変更権を1回獲得します。獲得後は下のボタンでマスの数字を変更できます。</p>
    <button v-if="!editing" class="secondary special-time-start" type="button" :disabled="!canStart" @click="emit('start')">数字を変更する</button>
    <div v-else class="time-editor">
      <p class="time-editor-title" role="status">スペシャルタイム発動中！ 盤面のマスと変更後の数字を選んでください。</p>
      <div class="time-number-buttons" role="group" aria-label="変更後の数字">
        <button v-for="value in settings.values" :key="value" class="time-number" type="button" :data-value="value" :aria-pressed="selectedValue === value" @click="emit('selectValue', value)">{{ value }}</button>
      </div>
      <p class="time-preview" aria-live="polite">{{ selectedCell === null ? '盤面のマスを選択してください。' : `${Math.floor(selectedCell / size) + 1}行${selectedCell % size + 1}列：${currentValue === 0n ? '空き' : currentValue} → ${selectedValue ?? '数字を選択'}` }}</p>
      <p class="settings-help">確定すると変更権を1回消費し、変更前のUndo履歴を破棄します。得点・手数は増えません。時間制限中も時計は進みます。</p>
      <div class="time-editor-actions">
        <button class="primary time-confirm" type="button" :disabled="!canConfirm" @click="emit('confirm')">確定</button>
        <button class="secondary time-cancel" type="button" @click="emit('cancel')">キャンセル</button>
      </div>
    </div>
  </section>
</template>
