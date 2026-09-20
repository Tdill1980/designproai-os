import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const revision=read('app/src/pages/RevisionStudioIQ.tsx');
const board=read('app/src/pages/AdminGeminiCompareStudio.tsx');
const routes=read('app/src/App.tsx');
const body=revision.slice(revision.lastIndexOf('onClick={() => {',revision.indexOf('Refine in PanelProStudio')),revision.indexOf('disabled={!selectedRender}',revision.indexOf('page (/designpro/studio-board)')));
const match=body.match(/onClick=\{\(\) => \{([\s\S]*?)\}\}/);
test('Refine in PanelProStudio opens the registered board with the exact selected design or order',()=>{
  assert.ok(match,'locate the actual Refine callback');
  assert.match(routes, /path="\/designpro\/studio-board"[^\n]*AdminGeminiCompareStudio/);
  assert.ok(board.includes('const o = params.get("order");') && board.includes('if (!job && o) runSearch(o);'));
  for(const [selectedRender,expected]of [[{order_number:'ORDER / 2026 #42'},'ORDER / 2026 #42'],[{_generationId:'a08df28c-f897-444e-bed3-f9d5d4d07fcb'},'a08df28c-f897-444e-bed3-f9d5d4d07fcb'],[{id:'selected-design'},'selected-design']]){
    let actual;
    vm.runInNewContext(`(()=>{${match[1].replaceAll(' as any','')}})()`,{selectedRender,genIdOf:()=>null,navigate:value=>{actual=value;},encodeURIComponent});
    const target=new URL(actual,'https://os.designproai.com');
    assert.equal(target.pathname,'/designpro/studio-board');assert.equal(target.searchParams.get('order'),expected);
  }
});
