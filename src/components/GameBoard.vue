<script setup lang="ts">
import { computed, ref } from 'vue'
import { boardSize, tileValue, type Board, type BoardSize, type Tile } from '../core/index.ts'
import { useTileAnimation } from '../composables/useTileAnimation.ts'
import { POP_MS, SLIDE_MS, tileCoordinates, type MovePresentation } from '../presentation/tiles.ts'
const props = defineProps<{ board: Board; size?: BoardSize; presentation?: MovePresentation | null; suspended?: boolean }>()
const size = computed(() => props.size ?? boardSize(props.board))
const element = ref<HTMLElement | null>(null)
const { frame, phase, tiles: visualTiles, reduced } = useTileAnimation({
  board: () => props.board, presentation: () => props.presentation, suspended: () => props.suspended ?? false, element,
})
function tileLabel(tile: Tile | null) {
  const value = tile ? tileValue(tile).toString() : ''
  const digits = size.value <= 4 ? 7 : size.value <= 6 ? 4 : 3
  return { value, label: value.length > digits ? `2^${tile!.power}` : value }
}
const specialId = computed(() => props.presentation?.result.specialSpawned && props.presentation.result.state.position.board === props.board
  ? props.presentation.result.spawned?.tile.id : undefined)
const cells = computed(() => props.board.map((tile, index) => ({
  index, power: tile?.power ?? 0, id: tile?.id, special: tile !== null && tile.id === specialId.value, ...tileLabel(tile),
})))
const visuals = computed(() => visualTiles.value.map(tile => ({ ...tile, ...tileLabel({ id: tile.id, power: tile.power }), style: tileCoordinates(tile, size.value) })))
</script>
<template>
  <div ref="element" class="board" :class="{ 'is-animating': frame !== null }" role="table" :aria-label="`${size}行${size}列の2048盤面`" :aria-rowcount="size" :aria-colcount="size" :data-size="size" :data-animation="frame ? phase : 'idle'" :data-reduced-motion="reduced" :style="{ '--board-size': size, '--slide-ms': `${SLIDE_MS}ms`, '--pop-ms': `${POP_MS}ms` }">
    <div v-for="row in size" :key="row" class="board-row" role="row">
      <div v-for="cell in cells.slice((row - 1) * size, row * size)" :key="cell.index" class="cell" :class="{ tile: cell.power > 0, 'is-special-spawn': cell.special }" role="cell" :data-cell="cell.index" :data-power="cell.power" :data-tile-id="cell.id" :aria-label="`${row}行${cell.index % size + 1}列、${cell.value || '空き'}${cell.special ? '、スペシャル出現' : ''}`" :title="cell.value">
        <span v-if="cell.special" class="special-star" aria-hidden="true">★</span>
        <span v-if="cell.value" class="number" :style="{ '--label-length': cell.label.length }" :class="{ long: cell.label.length >= 4, 'extra-long': cell.label.length >= 6 }" aria-hidden="true">{{ cell.label }}</span>
      </div>
    </div>
    <div v-if="frame" :key="`${frame.id}-${phase}`" class="tile-animation-layer" aria-hidden="true">
      <div v-for="tile in visuals" :key="tile.id" class="cell visual-tile" :class="[`effect-${tile.effect}`, { 'special-visual': tile.special }]" :data-visual-id="tile.id" :data-power="tile.power" :data-from="tile.from" :data-to="tile.to" :style="tile.style">
        <span v-if="tile.special" class="special-star" aria-hidden="true">★</span>
        <span class="number" :class="{ long: tile.label.length >= 4, 'extra-long': tile.label.length >= 6 }" :style="{ '--label-length': tile.label.length }">{{ tile.label }}</span>
      </div>
    </div>
  </div>
</template>
