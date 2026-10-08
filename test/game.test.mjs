import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { snapshot, actions, towerHeight } from '../game.mjs';
const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const game = { camp: {x:.5,y:37,z:.5}, marker:{x:2,y:37,z:0}, failedTargets:new Set() };
function world({wood=0,height=0,position=new Vec3(.5,37,.5),hole=false}={}) {
  return { entity:{position}, health:20, food:20, game:{gameMode:'survival'}, entities:{},
    inventory:{items:()=>wood?[{name:'oak_log',count:wood}]:[]},
    blockAt:(p)=>({name:p.x===2&&p.z===0&&p.y>=37&&p.y<37+height&&!(hole&&p.y===38)?'oak_log':'air'}),
    findBlocks:()=>[new Vec3(2,37,0),new Vec3(4,37,4)] };
}
test('通关需要实际三格木柱、四块材料和返回营地同时成立',()=>{
  assert.equal(snapshot(world({wood:1,height:3}),game).finished,true);
  assert.equal(snapshot(world({wood:0,height:3}),game).finished,false);
  assert.equal(snapshot(world({wood:4,height:0}),game).finished,false);
  assert.equal(snapshot(world({wood:1,height:3,position:new Vec3(10,37,10)}),game).finished,false);
});
test('悬空原木不计入连续木柱高度',()=>assert.equal(towerHeight(world({height:3,hole:true}),game.marker),1));
test('候选动作不会挖掉已建木柱，且空背包没有建造选项',()=>{
  const available=actions(world({height:1}),game);
  assert.equal(available.some(a=>a.id==='dig_2_37_0'),false);
  assert.equal(available.some(a=>a.kind==='build'),false);
  assert.equal(available.some(a=>a.id==='dig_4_37_4'),true);
  assert.equal(actions(world({wood:1}),game).some(a=>a.kind==='build'),true);
});
