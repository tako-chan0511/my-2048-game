import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { Direction } from '../core/types.ts'
import { swipeDirection } from '../input/swipe.ts'

interface ControlOptions {
  readonly surface: Ref<HTMLElement | null>
  readonly isBlocked: () => boolean
  readonly dispatchMove: (direction: Direction) => boolean
}
interface Gesture {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly surface: HTMLElement
}
const keys: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
}
const editableSelector = '[data-game-controls-ignore], input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]'

export function useGameControls(options: ControlOptions) {
  const pointers = new Set<number>()
  let gesture: Gesture | null = null

  function cancelGesture() {
    const previous = gesture
    gesture = null
    if (previous?.surface.hasPointerCapture?.(previous.id)) {
      try { previous.surface.releasePointerCapture(previous.id) } catch { /* Already released by the browser. */ }
    }
  }

  // Buttons, keys and swipes all use this same entry point. A second input
  // invalidates any unfinished swipe instead of moving again on pointerup.
  function dispatchMove(direction: Direction) {
    cancelGesture()
    return options.isBlocked() ? false : options.dispatchMove(direction)
  }

  function onKeydown(event: KeyboardEvent) {
    const direction = keys[event.key]
    if (!direction || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target instanceof Element && event.target.closest(editableSelector)) return
    if (options.isBlocked()) return
    event.preventDefault()
    // One physical key press produces at most one move, even across dialogs.
    if (!event.repeat) dispatchMove(direction)
  }

  function onGlobalPointerDown(event: PointerEvent) {
    pointers.add(event.pointerId)
    if (pointers.size > 1) cancelGesture()
  }

  function onGlobalPointerEnd(event: PointerEvent) {
    pointers.delete(event.pointerId)
    // With capture unavailable, a release outside the surface still cancels.
    if (gesture?.id === event.pointerId) cancelGesture()
  }

  function onPointerDown(event: PointerEvent) {
    if (options.isBlocked() || !event.isPrimary || event.button !== 0 || pointers.size !== 1 || gesture) return
    const surface = options.surface.value
    if (!surface || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    surface.focus({ preventScroll: true })
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, surface }
    try { surface.setPointerCapture?.(event.pointerId) } catch { /* Capture can fail for a canceled pointer. */ }
  }

  function onPointerMove(event: PointerEvent) {
    if (gesture?.id !== event.pointerId) return
    if (options.isBlocked() || (event.pointerType === 'mouse' && event.buttons !== 1)) cancelGesture()
    // Movement is committed on release only, so a later second finger or
    // pointercancel can invalidate the whole gesture without consuming RNG.
  }

  function onPointerUp(event: PointerEvent) {
    if (gesture?.id !== event.pointerId) return
    const previous = gesture
    const allowed = pointers.size === 1 && !options.isBlocked()
    cancelGesture()
    if (!allowed) return
    const direction = swipeDirection(event.clientX - previous.x, event.clientY - previous.y)
    if (direction) dispatchMove(direction)
  }

  function onPointerCancel(event: PointerEvent) {
    if (gesture?.id === event.pointerId) cancelGesture()
  }

  function resetPointers() { cancelGesture(); pointers.clear() }
  function onVisibilityChange() { if (document.hidden) resetPointers() }
  watch(options.isBlocked, blocked => { if (blocked) cancelGesture() }, { flush: 'sync' })

  onMounted(() => {
    window.addEventListener('pointerdown', onGlobalPointerDown, true)
    window.addEventListener('pointerup', onGlobalPointerEnd)
    window.addEventListener('pointercancel', onGlobalPointerEnd)
    window.addEventListener('blur', resetPointers)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onBeforeUnmount(() => {
    resetPointers()
    window.removeEventListener('pointerdown', onGlobalPointerDown, true)
    window.removeEventListener('pointerup', onGlobalPointerEnd)
    window.removeEventListener('pointercancel', onGlobalPointerEnd)
    window.removeEventListener('blur', resetPointers)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { dispatchMove, cancelGesture, onKeydown, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel }
}
