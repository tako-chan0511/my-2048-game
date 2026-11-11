import { computed, ref, shallowRef } from 'vue'
import {
  createGame, createSession, dismissSessionPopup, moveSessionWithResult, undoSession, canUndoSession, undoRemaining,
  hasReachedTarget, highestPower, DEFAULT_SETTINGS, DEFAULT_SPECIAL, DEFAULT_SPECIAL_TIME, canUseSpecialTime, editSessionTile, moveSpecialTimeTile, movesUntilSpecial, validateSettings, observeSession, sessionEndReason, remainingTimeMs, remainingMoves,
  type TimeValue, type GameState, type Direction, type GameSettings, type SettingsDraft, type PlaySession,
} from '../core/index.ts'
import { createGameStorage, type StoragePort, type SaveResult } from '../services/gameStorage.ts'
import type { MovePresentation } from '../presentation/tiles.ts'
export type { GamePopup } from '../core/session.ts'
export type SeedSource = () => number
export type NowSource = () => number
const browserSeed: SeedSource = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!

// Browser persistence is explicitly supplied by App; callers can inject an
// isolated storage port, or omit persistence when using just game state.
export function use2048Game(seedSource: SeedSource = browserSeed, storage?: StoragePort, now: NowSource = () => Date.now()) {
  const current = shallowRef<PlaySession | null>(null), error = ref('')
  const presentation = shallowRef<MovePresentation | null>(null)
  let presentationId = 0
  const timeEditing = ref(false), selectedCell = ref<number | null>(null), selectedValue = ref<TimeValue | null>(null), animationActive = ref(false)
  let editingGame: GameState | null = null
  function cancelTimeEditing() { timeEditing.value = false; selectedCell.value = null; selectedValue.value = null; editingGame = null }
  function setAnimationActive(active: boolean) { animationActive.value = active }
  const repository = storage ? createGameStorage(storage) : null
  const saveResult = shallowRef<SaveResult | null>(null), restoreMessage = ref(''), bestMessage = ref(repository?.bestMessage() ?? '')
  const bestRevision = ref(0)
  const draftSettings = ref<SettingsDraft>({ size: DEFAULT_SETTINGS.size, target: DEFAULT_SETTINGS.target,
    initialTiles: DEFAULT_SETTINGS.initialTiles, spawn4Percent: DEFAULT_SETTINGS.spawn4Percent, undoLimit: DEFAULT_SETTINGS.undoLimit })
  const settingsValidation = computed(() => {
    const draft = draftSettings.value, kind = draft.modeKind ?? 'normal'
    const mode = kind === 'timed' ? { kind, seconds: draft.timeSeconds ?? 300 }
      : kind === 'moves' ? { kind, limit: draft.moveLimit ?? 1000 } : { kind }
    const { size, target, initialTiles, spawn4Percent, undoLimit } = draft
    return validateSettings({ ...DEFAULT_SETTINGS, size, target, initialTiles, spawn4Percent, undoLimit, mode,
      ...(draft.specialEnabled !== undefined || draft.specialInterval !== undefined || draft.specialValue !== undefined ? { special: { enabled: draft.specialEnabled ?? false,
        interval: draft.specialInterval ?? DEFAULT_SPECIAL.interval, value: draft.specialValue ?? DEFAULT_SPECIAL.value, replacement: 'replace' } } : {}),
      ...(draft.timeEnabled !== undefined || draft.timeInterval !== undefined || draft.timeMaxCharges !== undefined || draft.timeValues !== undefined
        ? { specialTime: { enabled: draft.timeEnabled ?? false, interval: draft.timeInterval ?? DEFAULT_SPECIAL_TIME.interval,
          maxCharges: draft.timeMaxCharges ?? DEFAULT_SPECIAL_TIME.maxCharges, values: draft.timeValues ?? DEFAULT_SPECIAL_TIME.values } } : {}) })
  })
  const state = computed(() => current.value?.game ?? null)
  const popup = computed(() => current.value?.popup ?? null)
  const score = computed(() => state.value?.position.score ?? 0n)
  const moves = computed(() => state.value?.position.moveCount ?? 0)
  const endReason = computed(() => current.value ? sessionEndReason(current.value) : null)
  const gameOver = computed(() => endReason.value !== null)
  const remainingMs = computed(() => current.value ? remainingTimeMs(current.value) : null)
  const movesLeft = computed(() => current.value ? remainingMoves(current.value) : null)
  const clockStarted = computed(() => current.value?.clock.startedAtMs !== null && current.value !== null)
  const clockRunning = computed(() => state.value?.settings.mode.kind === 'timed' && clockStarted.value && endReason.value !== 'time-expired')
  const timeLabel = computed(() => {
    const seconds = Math.ceil((remainingMs.value ?? 0) / 1000)
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  })
  const modeLabel = computed(() => {
    const mode = state.value?.settings.mode ?? DEFAULT_SETTINGS.mode
    return mode.kind === 'timed' ? `時間制限（${mode.seconds}秒）` : mode.kind === 'moves' ? `手数制限（${mode.limit}手）` : '通常モード'
  })
  const specialRemaining = computed(() => state.value ? movesUntilSpecial(state.value.settings, moves.value) : null)
  const specialLabel = computed(() => state.value?.settings.special?.enabled
    ? `スペシャル：${state.value.settings.special.interval}手ごとに${state.value.settings.special.value}` : 'スペシャル：OFF')
  const specialArrival = computed(() => presentation.value?.result.specialSpawned ? state.value?.settings.special?.value ?? null : null)
  const goalReached = computed(() => state.value ? hasReachedTarget(state.value) : false)
  const maxTile = computed(() => { const power = state.value ? highestPower(state.value.position.board) : 0; return power ? 1n << BigInt(power) : 0n })
  const inputBlocked = computed(() => timeEditing.value || !state.value || popup.value !== null || gameOver.value)
  const canUndo = computed(() => !timeEditing.value && current.value ? canUndoSession(current.value) : false)
  const remainingUndo = computed(() => current.value ? undoRemaining(current.value) : DEFAULT_SETTINGS.undoLimit)
  const undoUsed = computed(() => current.value?.undoUsed ?? 0)
  const historyLength = computed(() => current.value?.history.length ?? 0)
  const bestScore = computed(() => { void bestRevision.value; return state.value && repository ? repository.bestFor(state.value.settings) : 0n })

  const timeSettings = computed(() => state.value?.settings.specialTime)
  const timeCharges = computed(() => current.value?.specialTime?.charges ?? 0)
  const timeRemaining = computed(() => timeSettings.value?.enabled ? (current.value!.specialTime!.processedEvents + 1) * timeSettings.value.interval - moves.value : null)
  const timeLabelSettings = computed(() => timeSettings.value?.enabled
    ? `スペシャルタイム：${timeSettings.value.interval}手ごと・最大${timeSettings.value.maxCharges}回` : 'スペシャルタイム：OFF')
  const canStartTime = computed(() => !timeEditing.value && !animationActive.value && current.value !== null && canUseSpecialTime(current.value))
  const currentCellValue = computed(() => {
    const tile = selectedCell.value === null ? null : state.value?.position.board[selectedCell.value]
    return tile ? 1n << BigInt(tile.power) : 0n
  })
  const canConfirmTime = computed(() => timeEditing.value && !animationActive.value && current.value !== null && editingGame === state.value
    && selectedCell.value !== null && selectedValue.value !== null && BigInt(selectedValue.value) !== currentCellValue.value
    && canUseSpecialTime(current.value))
  function beginTimeEditing() {
    refreshTime()
    if (!canStartTime.value || !current.value) return false
    current.value = dismissSessionPopup(current.value, now())
    if (!canUseSpecialTime(current.value)) { persist(); return false }
    editingGame = current.value.game; timeEditing.value = true; selectedCell.value = null; selectedValue.value = null
    presentation.value = null; persist(); return true
  }
  function selectTimeCell(index: number) {
    if (!timeEditing.value || !Number.isInteger(index) || index < 0 || index >= (state.value?.position.board.length ?? 0)) return
    selectedCell.value = index
  }
  function selectTimeValue(value: TimeValue) {
    if (timeEditing.value && timeSettings.value?.values.includes(value)) selectedValue.value = value
  }
  function confirmTimeEdit() {
    refreshTime()
    if (!canConfirmTime.value || !current.value || selectedCell.value === null || selectedValue.value === null) return false
    try {
      const before = current.value, next = editSessionTile(before, selectedCell.value, selectedValue.value, now())
      current.value = next
      if (next.game === before.game) { if (!canUseSpecialTime(next)) cancelTimeEditing(); persist(); return false }
      cancelTimeEditing(); presentation.value = null; error.value = ''; updateBest(); persist(); return true
    } catch { error.value = '数字を変更できませんでした。盤面と変更権は変更していません。'; return false }
  }

  function persist() { if (repository && current.value) saveResult.value = repository.saveGame(current.value) }
  function updateBest() {
    if (repository && state.value) {
      repository.updateBest(state.value.settings, state.value.position.score)
      bestRevision.value++; bestMessage.value = repository.bestMessage()
    }
  }
  function startGame(settings: GameSettings) {
    try {
      const next = createSession(createGame(seedSource(), settings))
      current.value = next
      cancelTimeEditing(); animationActive.value = false
      presentation.value = null
      error.value = ''; restoreMessage.value = ''
      persist()
      return true
    } catch {
      error.value = 'ゲームを開始できませんでした。「新しいゲーム」でもう一度お試しください。'
      return false
    }
  }
  function newGame() { return startGame(state.value?.settings ?? DEFAULT_SETTINGS) }
  function applySettings() {
    if (popup.value) return false
    const validation = settingsValidation.value
    return validation.valid ? startGame(validation.settings) : false
  }
  function dismissPopup() {
    if (!current.value) return
    current.value = dismissSessionPopup(current.value, now())
    persist()
  }
  function dispatchMove(direction: Direction) {
    if (timeEditing.value) { refreshTime(); return false }
    if (!current.value) return false
    try {
      const before = current.value, outcome = moveSessionWithResult(before, direction, now()), next = outcome.session
      const moved = next.game !== before.game
      if (next === before) return false
      current.value = next; error.value = ''
      if (outcome.move) presentation.value = { id: ++presentationId, before: before.game.position.board, result: outcome.move }
      if (moved) updateBest()
      if (moved || sessionEndReason(next) !== sessionEndReason(before) || next.popup !== before.popup) persist()
      return moved
    } catch {
      error.value = '移動を処理できませんでした。盤面は変更していません。'
      return false
    }
  }
  function dispatchSelectedMove(direction: Direction, index: number) {
    refreshTime()
    if (!timeEditing.value || animationActive.value || !current.value || editingGame !== state.value) return false
    const before = current.value, next = moveSpecialTimeTile(before, index, direction, now())
    current.value = next
    if (next.game === before.game) { persist(); return false }
    cancelTimeEditing(); presentation.value = null; error.value = ''; updateBest(); persist(); return true
  }
  function undo() {
    if (timeEditing.value) { refreshTime(); return false }
    if (!current.value) return false
    try {
      const before = current.value, next = undoSession(before, undefined, now())
      if (next === before) return false
      current.value = next; error.value = ''
      if (next.game !== before.game) presentation.value = null
      persist()
      return next.game !== before.game
    } catch { error.value = 'Undoを処理できませんでした。盤面は変更していません。'; return false }
  }

  function refreshTime() {
    if (!current.value || state.value?.settings.mode.kind !== 'timed' || !clockStarted.value) return
    try {
      const before = current.value, next = observeSession(before, now())
      if (next !== before) {
        current.value = next
        if (sessionEndReason(next) === 'time-expired') cancelTimeEditing()
        if (sessionEndReason(before) !== sessionEndReason(next) || before.popup !== next.popup) persist()
      }
    } catch { error.value = '時計を確認できませんでした。操作を再度お試しください。' }
  }
  function checkpoint() { refreshTime(); persist() }
  const loaded = repository?.loadGame(now())
  if (loaded?.status === 'restored') {
    current.value = loaded.data.session
    const applied = current.value.game.settings
    draftSettings.value = { size: applied.size, target: applied.target, initialTiles: applied.initialTiles,
      spawn4Percent: applied.spawn4Percent, undoLimit: applied.undoLimit,
      ...(applied.specialTime ? { timeEnabled: applied.specialTime.enabled, timeInterval: applied.specialTime.interval, timeMaxCharges: applied.specialTime.maxCharges, timeValues: [...applied.specialTime.values] } : {}),
      ...(applied.special ? { specialEnabled: applied.special.enabled, specialInterval: applied.special.interval, specialValue: applied.special.value } : {}),
      ...(applied.mode.kind === 'timed' ? { modeKind: 'timed', timeSeconds: applied.mode.seconds }
        : applied.mode.kind === 'moves' ? { modeKind: 'moves', moveLimit: applied.mode.limit } : {}) }
    restoreMessage.value = loaded.data.historyOmitted
      ? 'ゲームを復元しました。保存時にUndo履歴を保存できなかったため、以前の履歴は使えません。'
      : '保存したゲームを復元しました。'
    updateBest()
    saveResult.value = { status: loaded.data.historyOmitted ? 'history-omitted' : 'saved', message: loaded.data.historyOmitted ? 'Undo履歴は保存されていません。新しい操作の履歴は引き続き記録します。' : '保存した進行状態を読み込みました。' }
    if (loaded.data.migratedFromOlderVersion || endReason.value === 'time-expired') persist()
  } else {
    const started = newGame()
    if (loaded?.status === 'invalid') restoreMessage.value = started
      ? '保存データが不正または未対応のため、新しいゲームを開始しました。有効なベスト記録は維持します。'
      : '保存データが不正または未対応のため、復元しませんでした。有効なベスト記録は維持します。'
    if (loaded?.status === 'failed') restoreMessage.value = started
      ? '保存データを読み込めなかったため、新しいゲームを開始しました。'
      : '保存データを読み込めませんでした。新しいゲームの開始をお試しください。'
  }
  return {
    timeEditing, selectedCell, selectedValue, timeCharges, timeRemaining, timeSettings, timeLabelSettings, canStartTime, canConfirmTime, currentCellValue,
    beginTimeEditing, cancelTimeEditing, selectTimeCell, selectTimeValue, confirmTimeEdit, setAnimationActive,
    state, presentation, specialRemaining, specialLabel, specialArrival, score, moves, gameOver, endReason, remainingMs, movesLeft, clockStarted, clockRunning, timeLabel, modeLabel, refreshTime, checkpoint, goalReached, maxTile, draftSettings, settingsValidation, applySettings,
    popup, inputBlocked, canUndo, remainingUndo, undoUsed, historyLength, undo, bestScore,
    saveResult, restoreMessage, bestMessage, error: computed(() => error.value), newGame, dispatchMove, dispatchSelectedMove, dismissPopup,
    move: dispatchMove,
  }
}
