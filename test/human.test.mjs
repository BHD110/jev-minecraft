import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanInput } from '../human-player.mjs';
test('视角输入拒绝非有限数，避免污染角色位置与渲染',()=>{
  assert.equal(cleanInput({yaw:Infinity,pitch:0}),null);
  assert.equal(cleanInput({yaw:0,pitch:'bad'}),null);
  assert.equal(cleanInput(null),null);
});
test('输入只允许正常的移动按键与合法俯仰角',()=>{
  const input=cleanInput({yaw:0,pitch:-100,keys:{forward:true,jump:true,back:'true',teleport:true},mining:false});
  assert.equal(input.pitch,-1.55);
  assert.equal(input.keys.forward,true);
  assert.equal(input.keys.jump,true);
  assert.equal(input.keys.back,false);
  assert.equal(input.keys.teleport,undefined);
});
