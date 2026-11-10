import { onBeforeUnmount, onMounted, watch } from 'vue'
interface TickerOptions { readonly isRunning: () => boolean; readonly refresh: () => void; readonly checkpoint: () => void }
// This owns the only display interval. The interval never subtracts time: every
// refresh derives the remainder from the saved deadline and injected wall time.
export function useGameTicker(options: TickerOptions) {
  let mounted = false
  let interval: ReturnType<typeof setInterval> | null = null
  function stop() { if (interval !== null) { clearInterval(interval); interval = null } }
  function synchronize() {
    if (!mounted || !options.isRunning()) stop()
    else if (interval === null) interval = setInterval(options.refresh, 250)
  }
  watch(options.isRunning, synchronize, { flush: 'sync' })
  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', options.checkpoint)
    window.addEventListener('pagehide', options.checkpoint)
    options.refresh()
    synchronize()
  })
  onBeforeUnmount(() => {
    mounted = false
    stop()
    options.checkpoint()
    document.removeEventListener('visibilitychange', options.checkpoint)
    window.removeEventListener('pagehide', options.checkpoint)
  })
}
