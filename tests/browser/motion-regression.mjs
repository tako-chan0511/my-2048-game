// Optional real-browser regression: see docs/motion-regression.md.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const base = process.env.TEST_URL ?? 'http://127.0.0.1:4175/'
const errors = [], key = 'my-2048-game:progress:v1'
const labels = { left: '左', up: '上', right: '右', down: '下' }
try {
  for (const width of [1280, 320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width < 400 })
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()) })
    const response = await page.goto(base)
    assert.equal(response.status(), 200, `Public URL unavailable: ${await page.title()}`)
    await page.evaluate(() => localStorage.clear()); await page.reload()
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)
    for (const size of [3, 4, 5, 6, 7, 8, 9, 10]) {
      await page.locator('#setting-size').selectOption(String(size))
      await page.locator('#setting-time-enabled').selectOption('on')
      await page.locator('#setting-time-interval').fill('10')
      await page.locator('#setting-target').selectOption('65536')
      await page.locator('.apply-settings').click()
      // Record actual frames, not just the DOM after animation completion.
      await page.evaluate(() => {
        window.motionSamples = []
        window.recordMotion = true
        function sample() {
          if (!window.recordMotion) return
          const board = document.querySelector('.board'), rect = board.getBoundingClientRect()
          for (const tile of document.querySelectorAll('.visual-tile')) {
            const tileRect = tile.getBoundingClientRect()
            window.motionSamples.push({ phase: board.dataset.animation, position: getComputedStyle(tile).position,
              inside: tileRect.left >= rect.left - 1 && tileRect.right <= rect.right + 1 && tileRect.top >= rect.top - 1 && tileRect.bottom <= rect.bottom + 1 })
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      const moves = size === 10 ? 20 : 3
      for (let i = 1; i <= moves; i++) {
        const before = (await saved()).game.position.moveCount
        for (const direction of ['left', 'up', 'right', 'down']) {
          await page.getByRole('button', { name: `${labels[direction]}に移動`, exact: true }).click()
          if ((await saved()).game.position.moveCount > before) break
        }
        assert.equal((await saved()).game.position.moveCount, i)
        await page.locator('.board[data-animation="idle"]').waitFor()
        if (size === 10) {
          assert.equal((await saved()).specialTime.charges, Math.floor(i / 10))
          assert.equal(await page.locator('.special-time-start').isDisabled(), i < 10)
          if (i === 10) {
            await page.locator('.special-time-start').click()
            assert.equal(await page.locator('.cell-select').count(), 100)
            await page.locator('.time-cancel').click()
          }
        }
      }
      const samples = await page.evaluate(() => { window.recordMotion = false; return window.motionSamples })
      assert.ok(samples.some(s => s.phase === 'slide'), 'No real sliding frames observed')
      assert.ok(samples.some(s => s.phase === 'pop'), 'No real pop frames observed')
      assert.ok(samples.every(s => s.position === 'absolute'), 'Animation tiles lost absolute positioning')
      assert.ok(samples.every(s => s.inside), 'Animated tile escaped the board')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow')
      console.log(`PASS ${width}px, ${size}×${size}: ${samples.length} measured tile frames${size === 10 ? ', awards usable at moves 10 and 20' : ''}`)
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS: real animation geometry, default interval, button activation, no console errors')
} finally { await browser.close() }
