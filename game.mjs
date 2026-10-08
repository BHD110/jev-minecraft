import { createRequire } from 'node:module';
import { campSnapshot, campActions, campRequest, campExecute } from './camp-game.mjs';
const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const { Movements, goals } = require('mineflayer-pathfinder');
export const TASK = '空手采集至少 4 块原木，在营地金色地基上搭起 3 格高的原木柱，最后返回营地中心。';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isLog = (name) => /_log$/.test(name);
export const vector = ({ x, y, z }) => new Vec3(x, y, z);
const plain = (p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 });

export function inventory(bot) { return bot.inventory.items().map(({ name, count }) => ({ name, count })); }
export function logCount(bot) { return inventory(bot).filter((i) => isLog(i.name)).reduce((sum, i) => sum + i.count, 0); }
export function towerHeight(bot, marker) {
  let height = 0;
  for (let y = 0; y < 3; y++) {
    if (!isLog(bot.blockAt(vector(marker).offset(0, y, 0))?.name || '')) break;
    height++;
  }
  return height;
}
export function snapshot(bot, game) {
  if(game.mode==='camp')return campSnapshot(bot,game);
  const height = towerHeight(bot, game.marker);
  const wood = logCount(bot);
  const nearCamp = bot.entity.position.distanceTo(vector(game.camp)) < 1.6;
  return {
    task: TASK, position: plain(bot.entity.position), health: bot.health, food: bot.food,
    gameMode: bot.game.gameMode, inventory: inventory(bot), wood,
    collected: wood + height, towerHeight: height, nearCamp,
    finished: wood + height >= 4 && height === 3 && nearCamp,
    camp: game.camp, marker: game.marker,
  };
}
export function actions(bot, game) {
  if(game.mode==='camp')return campActions(bot,game);
  const list = [];
  const state = snapshot(bot, game);
  const logs = bot.findBlocks({ matching: (b) => isLog(b.name), maxDistance: 24, count: 80 });
  const targets = logs.filter((p) => p.y < bot.entity.position.y + 4 &&
    !(p.x === game.marker.x && p.z === game.marker.z && p.y >= game.marker.y && p.y < game.marker.y + 3) &&
    !game.failedTargets.has(`${p.x},${p.y},${p.z}`))
    .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, 5);
  for (const p of targets) list.push({ id: `dig_${p.x}_${p.y}_${p.z}`, kind: 'dig', target: plain(p),
    label: `挖原木 (${p.x},${p.y},${p.z})`, description: `走近并挖一块原木，尝试拾取掉落物。距离 ${p.distanceTo(bot.entity.position).toFixed(1)} 格。` });
  const items = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 18).slice(0, 3);
  for (const item of items) list.push({ id: `pickup_${item.id}`, kind: 'pickup', target: plain(item.position),
    label: '拾取地上的掉落物', description: `走向附近掉落物，拾取后由服务端更新背包；距离 ${item.position.distanceTo(bot.entity.position).toFixed(1)} 格。` });
  if (!state.nearCamp) list.push({ id: 'go_camp', kind: 'move', target: game.camp, label: '回到营地中心', description: '沿可走地形返回营地中心。不挖树，不放方块。' });
  if (state.wood > 0 && state.towerHeight < 3) list.push({ id: 'build_tower', kind: 'build', label: '在营地木柱上放一块原木',
    description: `走到营地金色地基旁，用背包中的原木放置一块。当前木柱 ${state.towerHeight}/3 格；消耗 1 块原木。` });
  list.push({ id: 'look_around', kind: 'look', label: '环顾四周', description: '转头观察，不获得材料、不推进建造。' });
  list.push({ id: 'wait', kind: 'wait', label: '原地等待', description: '等待一秒；没有材料收益。' });
  return list;
}
export function request(bot, game, available) {
  if(game.mode==='camp')return campRequest(bot,game,available);
  return {
    model: 'jev-latest', state: {
      ...snapshot(bot, game),
      world: { server: 'Flying Squid', minecraftVersion: bot.version, terrain: '开放森林和起伏地形；所有挖掘、拾取和放置都由 Minecraft 协议与服务端背包处理。' },
      rules: ['目标共需采集 4 块原木，其中 3 块用于木柱，另 1 块保留在背包。', '挖树可能会掉出物品，需要拾取后背包才增加。', '木柱必须建在指定金色地基上。用原木直接搭柱，不需要工作台或合成配方。', '材料够了就回营地建造；木柱完成后回营地中心。避免多余采集、反复回头和等待。'],
      recentActions: game.records.slice(-6).map((r) => ({ action: r.action.label, effect: r.effect, ok: r.ok })),
      availableActions: available.map(({ id, label, description }) => ({ id, label, effect: description })),
    },
    questions: { next_action: { type: 'choice',
      instructions: '你正在 Minecraft 兼容的生存世界中。为了空手采集 4 块原木、在营地搭 3 格高的原木柱并返回营地中心，现在最合适的下一项操作是什么？根据实际位置、背包、木柱高度、最近操作及候选效果选择一个动作；材料足够后不要继续砍树，完成建造后回营地中心。',
      criteria: Object.fromEntries(available.map((a) => [a.id, `${a.label}。${a.description}`])),
    } },
  };
}
export function configureMovements(bot) {
  const movements = new Movements(bot);
  movements.canDig = false; movements.allow1by1towers = false; movements.allowParkour = false;
  movements.maxDropDown = 2; movements.scafoldingBlocks = [];
  bot.pathfinder.setMovements(movements);
  bot.pathfinder.thinkTimeout = 3500;
}
async function walk(bot, goal) {
  let timer;
  try {
    await Promise.race([bot.pathfinder.goto(goal), new Promise((_, reject) => {
      timer = setTimeout(() => { bot.pathfinder.setGoal(null); bot.clearControlStates(); reject(new Error('寻路超时，已停下')); }, 14000);
    })]);
  } finally { clearTimeout(timer); }
}
async function pickup(bot, before) {
  if (logCount(bot) > before) return true;
  await sleep(900);
  const item = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 9);
  if (item) {
    try { await walk(bot, new goals.GoalNearXZ(Math.floor(item.position.x), Math.floor(item.position.z), 1)); } catch {}
  }
  for (let n = 0; n < 18; n++) { if (logCount(bot) > before) return true; await sleep(150); }
  return false;
}
export async function execute(bot, game, action) {
  if(game.mode==='camp')return campExecute(bot,game,action);
  const before = snapshot(bot, game);
  if (action.kind === 'dig') {
    const target = vector(action.target);
    await walk(bot, new goals.GoalNearXZ(target.x, target.z, 1));
    const block = bot.blockAt(target);
    if (!block || !isLog(block.name)) throw new Error('目标原木已变化，需要重新观察');
    await bot.lookAt(target.offset(.5, .5, .5), true);
    if (!bot.canDigBlock(block)) throw new Error('原木不在挖掘范围内');
    await bot.dig(block, true);
    if (isLog(bot.blockAt(target)?.name || '')) throw new Error('服务端没有确认挖掘成功');
    await pickup(bot, before.wood);
    const added = logCount(bot) - before.wood;
    return `挖开真实原木方块；${added > 0 ? `背包原木 +${added}` : '掉落物尚未拾取'}`;
  }
  if (action.kind === 'pickup') {
    await walk(bot, new goals.GoalNearXZ(Math.floor(action.target.x), Math.floor(action.target.z), 1));
    await pickup(bot, before.wood);
    return `拾取掉落物 · 背包原木 ${logCount(bot)} 块`;
  }
  if (action.kind === 'move') {
    await walk(bot, new goals.GoalNear(Math.floor(game.camp.x), game.camp.y, Math.floor(game.camp.z), 1));
    await bot.lookAt(vector(game.marker).offset(.5, 1.5, .5), true);
    return '已经走回营地中心';
  }
  if (action.kind === 'build') {
    await walk(bot, new goals.GoalNear(Math.floor(game.camp.x), game.camp.y, Math.floor(game.camp.z), 1));
    const height = towerHeight(bot, game.marker);
    const reference = bot.blockAt(vector(game.marker).offset(0, height - 1, 0));
    const item = bot.inventory.items().find((i) => isLog(i.name));
    if (!item || !reference) throw new Error('没有原木或地基未加载');
    await bot.equip(item, 'hand');
    await bot.placeBlock(reference, new Vec3(0, 1, 0));
    await sleep(250);
    if (towerHeight(bot, game.marker) !== height + 1) throw new Error('服务端没有确认放置成功');
    if (logCount(bot) !== before.wood - 1) throw new Error('放置后的背包数量没有按生存规则变化');
    return `放置真实原木方块 · 木柱 ${height + 1}/3 格 · 背包原木 −1`;
  }
  if (action.kind === 'look') {
    await bot.look(bot.entity.yaw + Math.PI / 2, 0, true); await sleep(500); return '转头观察了周围地形';
  }
  await sleep(1000); return '原地等待了一秒';
}
