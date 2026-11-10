<script setup lang="ts">
import type { EndReason } from '../core/session.ts'
import type { Target } from '../core/types.ts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  kind: 'goal' | 'game-over'
  target: Target
  score: bigint
  moves: number
  maxTile: bigint
  error: string
  canSpecialTime?: boolean
  canUndo?: boolean
  endReason?: EndReason
}>()
const emit = defineEmits<{ dismiss: []; newGame: []; undo: []; specialTime: [] }>()
const endText = computed(() => props.endReason === 'time-expired' ? '時間切れ' : props.endReason === 'move-limit' ? '手数上限に到達' : 'ゲームオーバー')
const description = computed(() => props.kind === 'goal'
  ? props.endReason ? `目標達成と${endText.value}が重なりました。「結果を見る」またはEscキーで終了結果を確認できます。` : '「続ける」またはEscキーでプレイを再開できます。時間制限中はこの画面でも時間が進みます。'
  : props.endReason === 'time-expired' ? '制限時間が終了しました。Undoはできません。「盤面を見る」またはEscキーで閉じられます。'
  : '「盤面を見る」またはEscキーで閉じられます。閉じるだけでは終了状態は変わりません。Undoが使える場合は戻って再開できます。')
const dialog = ref<HTMLDialogElement | null>(null)
let previousOverflow = ''
watch(() => [props.canUndo, props.canSpecialTime], () => {
  // An expiring deadline can remove the focused Undo action from an open
  // stuck-game dialog. Keep focus in its remaining actions.
  if (dialog.value?.open && !dialog.value.contains(document.activeElement)) dialog.value.querySelector<HTMLButtonElement>('button')?.focus()
}, { flush: 'post' })

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('dismiss')
  } else if (event.key === 'Tab') {
    const buttons = [...dialog.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const first = buttons[0]!, last = buttons.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }
}

onMounted(() => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value!.showModal()
  dialog.value!.querySelector<HTMLButtonElement>('[autofocus]')!.focus()
})
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
  document.body.style.overflow = previousOverflow
})
</script>
<template>
  <dialog ref="dialog" class="result-dialog" :class="kind" aria-labelledby="game-result-title" aria-describedby="game-result-description" aria-modal="true" @cancel.prevent="emit('dismiss')" @keydown.stop="onKeydown">
    <div class="result-icon" aria-hidden="true">
      <svg width="38" height="38" viewBox="0 0 40 40" focusable="false">
        <template v-if="props.kind === 'goal'">
          <path d="m20 7 4.2 8.5 9.4 1.4-6.8 6.6 1.6 9.4-8.4-4.5-8.4 4.5 1.6-9.4-6.8-6.6 9.4-1.4Z" fill="currentColor" />
          <path d="M7 4v6M4 7h6M33 3v6M30 6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </template>
        <rect v-else x="10" y="10" width="20" height="20" rx="4" fill="currentColor" />
      </svg>
    </div>
    <h2 id="game-result-title">{{ props.kind === 'goal' ? `${target}達成！おめでとう！` : endText }}</h2>
    <p id="game-result-description">{{ description }}</p>
    <dl class="result-stats">
      <div><dt>{{ props.kind === 'goal' ? '現在のスコア' : '最終スコア' }}</dt><dd class="result-score">{{ score.toLocaleString('ja-JP') }}</dd></div>
      <div><dt>移動手数</dt><dd class="result-moves">{{ moves }}</dd></div>
      <div><dt>最大数字</dt><dd class="result-max">{{ maxTile.toLocaleString('ja-JP') }}</dd></div>
    </dl>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="result-actions">
      <button v-if="props.kind === 'goal'" class="primary dialog-continue" type="button" autofocus @click="emit('dismiss')">{{ endReason ? '結果を見る' : '続ける' }}</button>
      <button class="dialog-new-game" :class="props.kind === 'game-over' ? 'primary' : 'secondary'" type="button" :autofocus="props.kind === 'game-over'" @click="emit('newGame')">新しいゲーム</button>
      <button v-if="props.kind === 'game-over' && canSpecialTime" class="secondary dialog-special-time" type="button" @click="emit('specialTime')">スペシャルタイムで修復</button>
      <button v-if="props.kind === 'game-over' && canUndo" class="secondary dialog-undo" type="button" @click="emit('undo')">Undoで続ける</button>
      <button v-if="props.kind === 'game-over'" class="secondary dialog-view-board" type="button" @click="emit('dismiss')">盤面を見る</button>
    </div>
  </dialog>
</template>
