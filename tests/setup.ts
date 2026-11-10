import { beforeEach } from 'vitest'
beforeEach(() => {
  // Browser tests each start with a clean origin; restore behavior is tested
  // explicitly within a test, not accidentally shared between test cases.
  if (typeof window !== 'undefined') window.localStorage.clear()
})
