import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { Board } from '../core/index.ts'
import { buildTileAnimation, POP_MS, SLIDE_MS, type MovePresentation, type TileAnimation } from '../presentation/tiles.ts'

export function useTileAnimation(options: {
  board: () => Board
  presentation: () => MovePresentation | null | undefined
  suspended: () => boolean
  element: Ref<HTMLElement | null>
}) {
  const frame = shallowRef<TileAnimation | null>(null)
  const phase = ref<'slide' | 'pop'>('slide')
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const reduced = ref(media?.matches ?? false)
  let generation = 0
  let consumed: MovePresentation | null | undefined
  let slideTimer: ReturnType<typeof setTimeout> | undefined
  let popTimer: ReturnType<typeof setTimeout> | undefined
  function clear() {
    generation++
    clearTimeout(slideTimer); clearTimeout(popTimer)
    slideTimer = undefined; popTimer = undefined; frame.value = null
  }
  watch(() => [options.board(), options.presentation(), options.suspended()] as const, ([board, event, suspended]) => {
    clear()
    if (event === consumed) return
    consumed = event
    if (!event || suspended || reduced.value || (typeof document !== 'undefined' && document.hidden)
      || event.result.state.position.board !== board) return
    const next = buildTileAnimation(event)
    if (!next) return
    const token = generation
    phase.value = 'slide'; frame.value = next
    slideTimer = setTimeout(() => {
      if (generation !== token) return
      phase.value = 'pop'
      popTimer = setTimeout(() => { if (generation === token) clear() }, POP_MS)
    }, SLIDE_MS)
  })
  function motionPreference() { reduced.value = media?.matches ?? false; clear() }
  function visibility() { if (document.hidden) clear() }
  let observer: ResizeObserver | undefined
  onMounted(() => {
    media?.addEventListener('change', motionPreference)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', clear)
    // Container changes need not be viewport resizes. An interrupted frame is
    // snapped to the already committed board, never measured into engine state.
    if (typeof ResizeObserver !== 'undefined' && options.element.value) {
      let previousWidth: number | undefined
      observer = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width
        if (width !== undefined) {
          if (previousWidth !== undefined && width !== previousWidth) clear()
          previousWidth = width
        }
      })
      observer.observe(options.element.value)
    }
  })
  onBeforeUnmount(() => {
    clear(); observer?.disconnect()
    media?.removeEventListener('change', motionPreference)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('resize', clear)
  })
  const tiles = computed(() => frame.value ? phase.value === 'slide' ? frame.value.sliding : frame.value.settled : [])
  return { frame, phase, tiles, reduced }
}
