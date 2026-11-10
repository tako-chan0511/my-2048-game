<script setup lang="ts">
import { computed } from 'vue'
import type { EndReason } from '../core/index.ts'
const props = defineProps<{
  enabled: boolean; editing: boolean; charges: number; maxCharges: number; remaining: number | null; endReason: EndReason
}>()
const status = computed(() => !props.enabled ? 'off' : props.editing ? 'editing'
  : props.endReason === 'time-expired' || props.endReason === 'move-limit' ? 'ended' : props.charges > 0 ? 'ready' : 'waiting')
const label = computed(() => ({ off: '無効', waiting: '待機中', ready: '変更権あり', editing: '数字を変更中', ended: '使用終了' })[status.value])
const detail = computed(() => {
  if (status.value === 'off') return 'このゲームではOFFです。'
  if (status.value === 'editing') return '盤面のマスを選び、変更後の数字を確認して確定してください。'
  if (status.value === 'ended') return props.endReason === 'time-expired' ? '時間切れのため、変更権は使用できません。' : '手数上限に達したため、変更権は使用できません。'
  if (status.value === 'ready') return `変更権 ${props.charges} / ${props.maxCharges}回。「数字を変更する」ボタンで開始できます。`
  return `あと${props.remaining}手で変更権を獲得します。`
})
</script>
<template>
  <section id="special-time-state" class="special-time-status" :data-status="status" aria-label="現在のスペシャルタイム状態">
    <div class="time-mode-heading">
      <strong>スペシャルタイム</strong>
      <span class="time-mode-switch">{{ enabled ? 'ON' : 'OFF' }}</span>
      <span class="time-mode-state" role="status" aria-live="polite">{{ label }}</span>
    </div>
    <p class="time-mode-detail">{{ detail }}</p>
  </section>
</template>
