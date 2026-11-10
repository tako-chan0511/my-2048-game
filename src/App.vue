<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import GameBoard from './components/GameBoard.vue'
import GameSettingsPanel from './components/GameSettingsPanel.vue'
import GameResultDialog from './components/GameResultDialog.vue'
import { useGameTicker } from './composables/useGameTicker.ts'
import { use2048Game } from './composables/use2048Game.ts'
import { browserStorage } from './services/gameStorage.ts'
import { useGameControls } from './composables/useGameControls.ts'
import { DEFAULT_SETTINGS, type Direction } from './core/index.ts'

const game = use2048Game(undefined, browserStorage)
const { state, score, moves, maxTile, gameOver, goalReached, error, popup, inputBlocked, dismissPopup, draftSettings, settingsValidation, canUndo, remainingUndo, undoUsed, bestScore, saveResult, restoreMessage, bestMessage } = game
const { specialRemaining, specialLabel, specialArrival } = game
const { endReason, remainingMs, movesLeft, clockStarted, clockRunning, timeLabel, modeLabel } = game
useGameTicker({ isRunning: () => clockRunning.value, refresh: game.refreshTime, checkpoint: game.checkpoint })
const surface = ref<HTMLElement | null>(null)
const controls = useGameControls({ surface, isBlocked: () => inputBlocked.value, dispatchMove: game.dispatchMove })
const { dispatchMove, onKeydown, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture } = controls
const directions: readonly { direction: Direction; label: string; arrow: string }[] = [
  { direction: 'up', label: '上', arrow: '↑' }, { direction: 'left', label: '左', arrow: '←' },
  { direction: 'down', label: '下', arrow: '↓' }, { direction: 'right', label: '右', arrow: '→' },
]
const statusMessage = computed(() => gameOver.value
  ? `${goalReached.value ? '目標達成！ ' : ''}${endReason.value === 'time-expired' ? '時間切れ。Undoはできません。' : endReason.value === 'move-limit' ? '手数上限に達しました。Undoが使える場合は再開できます。' : 'ゲームオーバー。動かせる方向がありません。'}新しいゲームで挑戦できます。`
  : goalReached.value ? '目標達成！ このまま続けて遊べます。' : '同じ数字を合わせて、目標の数字を目指しましょう。')

function focusBoard() {
  if (!popup.value && surface.value) {
    surface.value.focus({ preventScroll: true })
    surface.value.scrollIntoView?.({ block: 'nearest' })
  }
}
async function startNewGame() {
  controls.cancelGesture()
  if (game.newGame()) { await nextTick(); focusBoard() }
}
async function undoMove() {
  controls.cancelGesture()
  if (game.undo()) { await nextTick(); focusBoard() }
}
async function applyNextSettings() {
  if (game.applySettings()) { controls.cancelGesture(); await nextTick(); focusBoard() }
}
const exactTiles = computed(() => (state.value?.position.board ?? []).flatMap((tile, index) => tile ? [{
  id: tile.id, row: Math.floor(index / state.value!.settings.size) + 1,
  col: index % state.value!.settings.size + 1, value: (1n << BigInt(tile.power)).toLocaleString('ja-JP'),
}] : []))
watch(popup, async (next, previous) => {
  if (!next && previous) { await nextTick(); focusBoard() }
})
</script>
<template>
  <main class="app">
    <div class="page-content" :inert="popup !== null ? true : undefined">
      <header class="header">
        <div class="brand" aria-hidden="true">2048</div>
        <div><p class="eyebrow">NUMBER PUZZLE</p><h1>2048カスタム</h1></div>
      </header>
      <p class="intro">スライドして、合わせて、もうひとつ大きな数字へ。</p>
      <section class="panel" aria-label="2048ゲーム" @keydown="onKeydown">
        <div class="toolbar">
          <span class="settings-badge">{{ state?.settings.size ?? DEFAULT_SETTINGS.size }} × {{ state?.settings.size ?? DEFAULT_SETTINGS.size }} · 目標 {{ state?.settings.target ?? DEFAULT_SETTINGS.target }}</span>
          <button class="primary new-game" type="button" @click="!popup && startNewGame()">新しいゲーム</button>
        </div>
        <p v-if="state" class="applied-settings" aria-label="現在適用中の設定">現在適用中：初期{{ state.settings.initialTiles }}枚 · 2が{{ 100 - state.settings.spawn4Percent }}%／4が{{ state.settings.spawn4Percent }}% · Undo上限{{ state.settings.undoLimit === 'unlimited' ? '無制限' : `${state.settings.undoLimit}回` }} · {{ modeLabel }} · {{ specialLabel }}</p>
        <p v-if="specialRemaining !== null" class="special-status">★ 次のスペシャルまで：<strong>{{ specialRemaining === 1 ? '次の有効移動で出現' : `あと${specialRemaining}手` }}</strong></p>
        <p v-if="specialArrival !== null" class="special-arrival" role="status">★ スペシャル：{{ specialArrival }}が出現しました（通常タイルを置換）</p>
        <p v-if="remainingMs !== null" class="limit-status" :class="{ 'limit-warning': clockStarted && remainingMs <= 30000 }" aria-live="off">残り時間：<strong class="time-remaining">{{ timeLabel }}</strong><span v-if="!clockStarted">（有効な移動で開始）</span><span v-else-if="remainingMs === 0"> · 時間切れ</span><span v-else-if="remainingMs <= 30000"> · 残りわずか</span></p>
        <p v-if="movesLeft !== null" class="limit-status">残り手数：<strong class="moves-remaining">{{ movesLeft }}</strong>手<span v-if="movesLeft === 0"> · 上限到達</span></p>
        <div class="score-grid">
          <div><span>スコア</span><strong class="score">{{ score.toLocaleString('ja-JP') }}</strong></div>
          <div><span>移動回数</span><strong class="move-count">{{ moves }}</strong></div>
          <div><span>最大数字</span><strong class="max-tile">{{ maxTile.toLocaleString('ja-JP') }}</strong></div>
        </div>
        <p class="best-score-line">同条件のベストスコア：<strong class="best-score">{{ bestScore.toLocaleString('ja-JP') }}</strong></p>
        <div class="undo-controls">
          <button class="secondary undo-button" type="button" :disabled="!canUndo || popup !== null" @click="!popup && undoMove()">Undo（1手戻す）</button>
          <span class="undo-remaining">残り：{{ remainingUndo === 'unlimited' ? '無制限' : `${remainingUndo}回` }} · 使用{{ undoUsed }}回</span>
        </div>
        <div class="storage-status" aria-live="polite">
          <p v-if="restoreMessage" class="restore-status">{{ restoreMessage }}</p>
          <p v-if="saveResult" class="save-status" :class="{ 'storage-warning': saveResult.status !== 'saved' }">{{ saveResult.message }}</p>
          <p v-if="bestMessage" class="storage-warning best-storage-status">{{ bestMessage }}</p>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <template v-if="state">
          <p id="game-controls-help" class="controls-help">盤面をクリック／タップして矢印キーで操作。盤面のスワイプ、下の方向ボタンでも遊べます。</p>
          <div ref="surface" class="game-surface" :class="{ 'is-locked': inputBlocked }" tabindex="0" role="group" aria-label="盤面の操作領域" aria-describedby="game-controls-help" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerCancel" @lostpointercapture="onLostPointerCapture">
            <GameBoard :board="state.position.board" :size="state.settings.size" :presentation="game.presentation.value" :suspended="popup !== null" />
          </div>
          <details class="tile-values" data-game-controls-ignore>
            <summary>タイルの正確な数字を確認</summary>
            <div class="tile-values-list" tabindex="0" aria-label="タイルの位置と正確な数字">
              <ul><li v-for="tile in exactTiles" :key="tile.id">{{ tile.row }}行{{ tile.col }}列：{{ tile.value }}</li></ul>
            </div>
          </details>
          <p class="game-status" :class="{ achieved: goalReached, ended: gameOver }" role="status">{{ statusMessage }}</p>
          <div class="direction-pad" role="group" aria-label="移動方向">
            <button v-for="item in directions" :key="item.direction" type="button" :class="item.direction" :aria-label="`${item.label}に移動`" :disabled="inputBlocked" @click="dispatchMove(item.direction)">
              <span aria-hidden="true">{{ item.arrow }}</span><span>{{ item.label }}</span>
            </button>
          </div>
        </template>
        <div v-else class="placeholder">新しいゲームを開始してください。</div>
      </section>
      <GameSettingsPanel v-model:draft="draftSettings" :validation="settingsValidation" :disabled="popup !== null" @apply="applyNextSettings" />
      <section class="panel rules">
        <h2>遊び方</h2>
        <p>矢印キー・盤面のスワイプ・方向ボタンで、盤面全体を動かします。同じ数字がぶつかると合体し、その数字がスコアに加わります。</p>
        <p>盤面が動いたときだけ、新しい2または4が1枚現れます。目標の数字を達成したらお祝いを表示し、その後も続けて遊べます。</p>
        <p>スペシャルモードONでは、指定した有効移動ごとに新規タイル1枚を特別な数字へ置き換えます。得点は合体したときだけ加算されます。</p>
        <p>Tabキーで盤面やボタンに移動できます。矢印キーは1回押すと1手、スワイプは指を離すと1手です。複数指や斜めすぎる操作は移動しません。</p>
        <p>どの方向にも動かせなくなるとゲームオーバーです。ポップアップはEscキーでも閉じられます。</p>
      </section>
      <footer>2048 CUSTOM · ひとつずつ、大きく。</footer>
    </div>
    <GameResultDialog v-if="popup" :key="popup" :kind="popup" :target="state?.settings.target ?? DEFAULT_SETTINGS.target" :score="score" :moves="moves" :max-tile="maxTile" :error="error" :can-undo="canUndo" :end-reason="endReason" @undo="undoMove" @dismiss="dismissPopup" @new-game="startNewGame" />
  </main>
</template>
