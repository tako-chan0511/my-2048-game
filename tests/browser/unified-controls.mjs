const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const browser=await chromium.launch({args:['--no-sandbox']})
const base=process.env.TEST_URL??'http://127.0.0.1:4177/'
const output=process.env.RESULT_DIR??'/tmp/2048-browser/unified-local'
await fs.mkdir(output,{recursive:true})
const errors=[],results=[]
try{
 for(const [width,height] of [[1280,720],[320,568],[390,667]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<400})
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())})
  const response=await page.goto(base);assert.equal(response.status(),200,`Public URL unavailable: ${await page.title()}`)
  await page.evaluate(()=>localStorage.clear());await page.reload()
  const act=locator=>width<400?locator.tap():locator.click()
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('my-2048-game:progress:v1')))
  for(const size of [3,4,10]){
   await page.locator('#setting-size').selectOption(String(size));await page.locator('#setting-time-enabled').selectOption('on');await page.locator('#setting-time-interval').fill('1')
   await act(page.locator('.apply-settings'))
   for(const label of ['左','上','右','下']){
    await act(page.getByRole('button',{name:`${label}に移動`,exact:true}))
    if((await saved()).game.position.moveCount===1)break
   }
   await page.locator('.board[data-animation="idle"]').waitFor()
   assert.equal(await page.locator('.special-time-status .special-time-start').count(),1)
   await page.locator('.special-time-workspace').evaluate(e=>e.scrollIntoView({block:'start'}))
   const y=await page.evaluate(()=>scrollY)
   await act(page.locator('.special-time-start'))
   const geometry=await page.locator('.special-time-workspace').evaluate(e=>{
    const box=e.getBoundingClientRect();return {top:box.top,bottom:box.bottom,height:box.height,viewport:innerHeight}
   })
   assert.ok(geometry.top>=-1&&geometry.bottom<=height+1,`Workspace does not fit ${width}x${height}, size ${size}: ${JSON.stringify(geometry)}`)
   assert.equal(await page.evaluate(()=>scrollY),y,'Starting edit scrolled the page')
   assert.equal(await page.locator('.special-time-status .time-number').count(),8)
   const before=await saved(), index=before.game.position.board.length-1
   await act(page.locator(`[data-cell="${index}"] .cell-select`))
   assert.equal(await page.evaluate(()=>scrollY),y,'Selecting bottom cell scrolled')
   await act(page.locator('.time-number[data-value="256"]'))
   assert.equal(await page.evaluate(()=>scrollY),y,'Selecting number scrolled')
   const sizes=await page.locator('.time-number').evaluateAll(elements=>elements.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})))
   assert.ok(sizes.every(s=>s.width>=44&&s.height>=48),'Number buttons too small')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow')
   if(size===4)await page.screenshot({path:`${output}/${width}-editing.png`})
   await act(page.locator('.time-confirm'))
   assert.equal(await page.evaluate(()=>scrollY),y,'Confirming edit scrolled')
   const after=await saved();assert.equal(after.game.position.board[index].power,8);assert.equal(after.specialTime.used,1)
   assert.deepEqual(after.game.position.rng,before.game.position.rng);assert.equal(after.game.position.moveCount,before.game.position.moveCount)
   assert.equal(await page.locator('.special-time-status .special-time-start').count(),1)
   results.push({width,height,size,workspaceHeight:geometry.height,result:'pass'})
   console.log(`PASS ${width}x${height}, ${size}x${size}: one card, full workspace ${geometry.height}px, zero scrolling from start through confirmation`)
  }
  await context.close()
 }
 assert.deepEqual(errors,[]);console.log('PASS: all compact workspaces, no console errors')
}finally{await fs.writeFile(`${output}/results.json`,JSON.stringify({base,results,errors},null,2));await browser.close()}
