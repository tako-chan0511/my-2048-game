<script setup lang="ts">
import { computed } from 'vue'
import { BOARD_SIZES, TARGETS, SPECIAL_VALUES, DEFAULT_SPECIAL, DEFAULT_SPECIAL_TIME, TIME_VALUES, type SpecialTimeSettings, type SettingsDraft, type SettingsValidation } from '../core/index.ts'
const props = defineProps<{ draft: SettingsDraft; validation: SettingsValidation; disabled: boolean; appliedTime?: SpecialTimeSettings }>()
const emit = defineEmits<{ 'update:draft': [value: SettingsDraft]; apply: [] }>()
function update(field: keyof SettingsDraft, event: Event) {
  const input = event.target as HTMLInputElement | HTMLSelectElement
  emit('update:draft', { ...props.draft, [field]: field === 'modeKind' || field === 'undoLimit' && input.value === 'unlimited' ? input.value : input.value.trim() === '' ? '' : Number(input.value) })
}
function updateSpecial(event: Event) {
  emit('update:draft', { ...props.draft, specialEnabled: (event.target as HTMLSelectElement).value === 'on' })
}
function updateTimeEnabled(event: Event) {
  emit('update:draft', { ...props.draft, timeEnabled: (event.target as HTMLSelectElement).value === 'on' })
}
function toggleTimeValue(value: number) {
  const values = props.draft.timeValues ?? [...DEFAULT_SPECIAL_TIME.values]
  emit('update:draft', { ...props.draft, timeValues: values.includes(value) ? values.filter(v => v !== value) : [...values, value].sort((a, b) => a - b) })
}
const timePending = computed(() => {
  const draft = props.draft, applied = props.appliedTime ?? DEFAULT_SPECIAL_TIME
  const enabled = draft.timeEnabled ?? false
  if (!enabled && !applied.enabled) return false
  return enabled !== applied.enabled || draft.timeInterval !== undefined && Number(draft.timeInterval) !== applied.interval
    || draft.timeMaxCharges !== undefined && Number(draft.timeMaxCharges) !== applied.maxCharges
    || JSON.stringify([...(draft.timeValues ?? DEFAULT_SPECIAL_TIME.values)].sort((a, b) => a - b)) !== JSON.stringify(applied.values)
})
const maximumTiles = computed(() => typeof props.draft.size === 'number' && Number.isInteger(props.draft.size) && props.draft.size >= 3 && props.draft.size <= 10 ? props.draft.size ** 2 : 100)
const twoPercent = computed(() => typeof props.draft.spawn4Percent === 'number' && Number.isInteger(props.draft.spawn4Percent) && props.draft.spawn4Percent >= 0 && props.draft.spawn4Percent <= 100 ? 100 - props.draft.spawn4Percent : '—')
function invalid(field: keyof SettingsDraft | 'mode') { return !props.validation.valid && props.validation.issues.some(issue => issue.field === field) }
</script>
<template>
  <section class="panel settings-panel" aria-labelledby="next-settings-title">
    <h2 id="next-settings-title">次のゲームの設定</h2>
    <p class="settings-description">編集中の設定です。「この設定で新しいゲーム」を押すと適用されます。</p>
    <form novalidate @submit.prevent="!disabled && emit('apply')">
      <fieldset :disabled="disabled">
        <legend class="sr-only">次のゲームに適用する設定</legend>
        <div class="settings-grid">
          <label for="setting-size">盤面サイズ
            <select id="setting-size" :value="draft.size" :aria-invalid="invalid('size')" @change="update('size', $event)"><option v-for="size in BOARD_SIZES" :key="size" :value="size">{{ size }} × {{ size }}</option></select>
          </label>
          <label for="setting-target">目標数字
            <select id="setting-target" :value="draft.target" :aria-invalid="invalid('target')" @change="update('target', $event)"><option v-for="target in TARGETS" :key="target" :value="target">{{ target }}</option></select>
          </label>
          <label for="setting-initial">初期タイル枚数
            <input id="setting-initial" type="number" inputmode="numeric" min="1" :max="maximumTiles" step="1" :value="draft.initialTiles" :aria-invalid="invalid('initialTiles')" aria-describedby="initial-tiles-help" @input="update('initialTiles', $event)">
          </label>
          <label for="setting-probability">4の出現率（%）
            <input id="setting-probability" type="number" inputmode="numeric" min="0" max="100" step="1" :value="draft.spawn4Percent" :aria-invalid="invalid('spawn4Percent')" aria-describedby="probability-help" @input="update('spawn4Percent', $event)">
          </label>
          <label for="setting-undo">Undo使用上限
            <select id="setting-undo" :value="draft.undoLimit" :aria-invalid="invalid('undoLimit')" @change="update('undoLimit', $event)">
              <option v-for="limit in 11" :key="limit - 1" :value="limit - 1">{{ limit - 1 }}回</option><option value="unlimited">無制限</option>
            </select>
          </label>
          <label for="setting-mode">ゲームモード
            <select id="setting-mode" :value="draft.modeKind ?? 'normal'" :aria-invalid="invalid('mode')" @change="update('modeKind', $event)">
              <option value="normal">通常</option><option value="timed">時間制限</option><option value="moves">手数制限</option>
            </select>
          </label>
          <label v-if="draft.modeKind === 'timed'" for="setting-seconds">制限時間（秒）
            <input id="setting-seconds" type="number" inputmode="numeric" min="10" max="3600" step="1" :value="draft.timeSeconds ?? 300" :aria-invalid="invalid('timeSeconds')" aria-describedby="mode-help" @input="update('timeSeconds', $event)">
          </label>
          <label v-if="draft.modeKind === 'moves'" for="setting-moves">制限手数
            <input id="setting-moves" type="number" inputmode="numeric" min="1" max="100000" step="1" :value="draft.moveLimit ?? 1000" :aria-invalid="invalid('moveLimit')" aria-describedby="mode-help" @input="update('moveLimit', $event)">
          </label>
          <label for="setting-special">スペシャルモード
            <select id="setting-special" :value="draft.specialEnabled === true ? 'on' : 'off'" :aria-invalid="invalid('specialEnabled')" @change="updateSpecial"><option value="off">OFF</option><option value="on">ON</option></select>
          </label>
          <label for="setting-special-interval">スペシャル出現間隔（手）
            <input id="setting-special-interval" type="number" inputmode="numeric" min="1" max="100" step="1" :value="draft.specialInterval ?? DEFAULT_SPECIAL.interval" :disabled="draft.specialEnabled !== true" :aria-invalid="invalid('specialInterval')" aria-describedby="special-help" @input="update('specialInterval', $event)">
          </label>
          <label for="setting-special-value">スペシャル数字
            <select id="setting-special-value" :value="draft.specialValue ?? DEFAULT_SPECIAL.value" :disabled="draft.specialEnabled !== true" :aria-invalid="invalid('specialValue')" aria-describedby="special-help" @change="update('specialValue', $event)"><option v-for="value in SPECIAL_VALUES" :key="value" :value="value">{{ value }}</option></select>
          </label>
        </div>
        <div class="settings-grid time-settings">
          <label for="setting-time-enabled">スペシャルタイム
            <select id="setting-time-enabled" :value="draft.timeEnabled === true ? 'on' : 'off'" :aria-invalid="invalid('timeEnabled')" @change="updateTimeEnabled"><option value="off">OFF</option><option value="on">ON</option></select>
          </label>
          <label for="setting-time-interval">変更権の獲得間隔（手）
            <input id="setting-time-interval" type="number" inputmode="numeric" min="1" max="100" step="1" :value="draft.timeInterval ?? 10" :disabled="draft.timeEnabled !== true" :aria-invalid="invalid('timeInterval')" @input="update('timeInterval', $event)">
          </label>
          <label for="setting-time-max">変更権の最大保有数
            <input id="setting-time-max" type="number" inputmode="numeric" min="1" max="10" step="1" :value="draft.timeMaxCharges ?? 3" :disabled="draft.timeEnabled !== true" :aria-invalid="invalid('timeMaxCharges')" @input="update('timeMaxCharges', $event)">
          </label>
        </div>
        <fieldset class="time-values-settings" :disabled="draft.timeEnabled !== true" :aria-invalid="invalid('timeValues')" aria-describedby="time-help">
          <legend>スペシャルタイムで選択可能な数字</legend>
          <div class="time-value-checks"><label v-for="value in TIME_VALUES" :key="value"><input type="checkbox" :value="value" :checked="(draft.timeValues ?? DEFAULT_SPECIAL_TIME.values).includes(value)" @change="toggleTimeValue(value)">{{ value }}</label></div>
        </fieldset>
        <p v-if="timePending" class="time-settings-pending" role="status">スペシャルタイムの設定は編集中です。現在のゲームに適用するには、下の「この設定で新しいゲーム」を押してください。</p>
        <p id="time-help" class="settings-help">指定した有効移動ごとに変更権を獲得し、空きマスを含む1マスの数字を変更できます。Undoで権利は戻りません。上限で見送った権利は後から付与しません。</p>
        <p id="special-help" class="settings-help">出現方式：通常タイルを置換（固定）。指定した有効移動ごとに1枚出現します。初期タイルは通常の2・4です。OFFでは通常ゲームと同じ条件になります。</p>
        <p v-if="draft.modeKind === 'timed'" id="mode-help" class="settings-help">最初の有効な移動で開始します。ポップアップ中、タブ非表示中、ページを閉じた間も時間が進み、時間切れ後はUndoできません。</p>
        <p v-else-if="draft.modeKind === 'moves'" id="mode-help" class="settings-help">盤面が変化した移動だけを数えます。上限後も履歴とUndo回数があれば戻って再開できます。</p>
        <p id="initial-tiles-help" class="settings-help">初期タイルは1〜{{ maximumTiles }}枚。全マスを埋めると、配置によって開始直後に手詰まりになる場合があります。</p>
        <p id="probability-help" class="settings-help">2の出現率：{{ twoPercent }}%。初期タイルにも同じ確率を使います。</p>
        <div class="settings-messages" aria-live="polite">
          <ul v-if="!validation.valid" class="settings-errors"><li v-for="issue in validation.issues" :key="issue.field">入力エラー：{{ issue.message }}</li></ul>
          <ul v-else-if="validation.warnings.length" class="settings-warnings"><li v-for="warning in validation.warnings" :key="warning">注意：{{ warning }}</li></ul>
        </div>
        <button class="primary apply-settings" type="submit" :disabled="!validation.valid || disabled">この設定で新しいゲーム</button>
      </fieldset>
    </form>
  </section>
</template>
