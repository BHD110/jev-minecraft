import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {campPlan,campSnapshot,campActions} from '../camp-game.mjs';
const require=createRequire(import.meta.url);const {Vec3}=require('vec3');
const game={camp:{x:.5,y:37,z:.5},marker:{x:2,y:37,z:0},plan:campPlan(37)};
const names=new Map(game.plan.flatMap(g=>g.blocks.map(b=>[`${b.x},${b.y},${b.z}`,b.name])));
function bot(blocks=new Map()){return {entity:{position:new Vec3(.5,37,.5)},health:20,food:20,game:{gameMode:'survival'},inventory:{items:()=>[...new Set(names.values())].map(name=>({name,count:64}))},blockAt:p=>({name:blocks.get(`${p.x},${p.y},${p.z}`)||'air'})};}
test('营地蓝图包含 90 个独立方块位置并保留两格高入口',()=>{
  assert.equal(names.size,90);
  assert.equal(names.has('6,38,0'),false);assert.equal(names.has('6,39,0'),false);
  assert.equal(names.get('8,40,0'),'oak_planks');
  assert.equal(names.get('4,37,-3'),'campfire');
});
test('验收读取实际世界方块，缺屋顶或入口被堵都不能完成',()=>{
  assert.equal(campSnapshot(bot(names),game).finished,true);
  const incomplete=new Map(names);incomplete.delete('8,40,0');
  assert.equal(campSnapshot(bot(incomplete),game).finished,false);
  const blocked=new Map(names);blocked.set('6,38,0','stone');
  assert.equal(campSnapshot(bot(blocked),game).finished,false);
});
test('施工阶段有支撑要求，未铺地板不能直接封屋顶或摆设施',()=>{
  const initial=campActions(bot(),game);assert.equal(initial.some(a=>a.id.startsWith('floor_')),true);
  assert.equal(initial.some(a=>a.id.startsWith('roof_')),false);
  assert.equal(initial.some(a=>a.id==='fire'),false);
  const floor=new Map(game.plan.filter(g=>g.category==='floor').flatMap(g=>g.blocks.map(b=>[`${b.x},${b.y},${b.z}`,b.name])));
  assert.equal(campActions(bot(floor),game).some(a=>a.id.startsWith('wall_')),true);
});
