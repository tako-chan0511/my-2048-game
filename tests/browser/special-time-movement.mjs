const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox']});
const base=process.env.TEST_URL??'http://127.0.0.1:4178';
try {for(const width of [1280,320,390]) {
 const page=await browser.newPage({viewport:{width,height:width===320?568:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.evaluate(()=>localStorage.clear());await page.reload();
 await page.locator('#setting-size').selectOption('4');await page.locator('#setting-time-enabled').selectOption('on');await page.locator('#setting-time-interval').fill('1');await page.locator('.apply-settings').click();
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('my-2048-game:progress:v1')));
 for(const label of ['左','上','右','下']) {await page.getByRole('button',{name:`${label}に移動`,exact:true}).click();if((await saved()).game.position.moveCount)break;}
 await page.locator('.board[data-animation="idle"]').waitFor();await page.locator('.special-time-start').click();
 const before=await saved(),board=before.game.position.board;let chosen;
 for(let i=0;i<16&&!chosen;i++) {if(!board[i])continue;for(const [step,dx,dy] of [[1,80,0],[-1,-80,0],[4,0,80],[-4,0,-80]]) {let j=i+step;if(j<0||j>=16||(Math.abs(step)===1&&Math.floor(i/4)!==Math.floor(j/4))||board[j])continue;let end=j;while(true){j=end+step;if(j<0||j>=16||(Math.abs(step)===1&&Math.floor(end/4)!==Math.floor(j/4))||board[j])break;end=j;}
 if(j>=0&&j<16&&(Math.abs(step)!==1||Math.floor(end/4)===Math.floor(j/4))&&board[j]?.power===board[i].power)continue;
 chosen={i,end,dx,dy};break;}}
 assert.ok(chosen);const cell=page.locator(`[data-cell="${chosen.i}"] .cell-select`);await cell.scrollIntoViewIfNeeded();const box=await cell.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+chosen.dx,y+chosen.dy,{steps:5});await page.mouse.up();
 await page.waitForTimeout(100);const after=await saved(),expected=[...board];expected[chosen.end]=board[chosen.i];expected[chosen.i]=null;
 assert.deepEqual(after.game.position.board,expected);assert.equal(after.game.position.moveCount,before.game.position.moveCount);assert.deepEqual(after.game.position.rng,before.game.position.rng);assert.equal(after.specialTime.used,1);assert.equal(await page.locator('.time-editor').count(),0);
 await page.reload();assert.deepEqual((await saved()).game.position.board,expected);assert.deepEqual(errors,[]);console.log(`PASS ${width}: selected-only swipe, credit, no RNG/spawn, reload`);await page.close();
}} finally {await browser.close()}
