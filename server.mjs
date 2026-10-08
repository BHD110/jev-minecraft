import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { createJevCredentials, installJevKeyEndpoint } from './jev-credentials.mjs';
import { attachViewer, express } from './viewer-server.mjs';
import { attachHumanPlayer } from './human-player.mjs';
import { CAMP_TASK, prepareCamp } from './camp-game.mjs';
import { TASK, actions, request, snapshot, execute, configureMovements, sleep, vector } from './game.mjs';
const require = createRequire(import.meta.url);
const squid = require('flying-squid');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const root = dirname(fileURLToPath(import.meta.url));
await mkdir(resolve(root, 'logs'), { recursive: true });
for (const file of [resolve(root, '.env')]) {
  try {
    for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const port = Number(process.env.JEV_MC_PORT || 5192);
const mcPort = Number(process.env.JEV_MC_GAME_PORT || 25566);
const credentials = createJevCredentials({ initialKey: process.env.TYPESAFE_API_KEY,
  createClient: (apiKey) => new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai' }) });
const app = express();
const http = createServer(app);
app.use(express.json({ limit: '10kb' }));
app.use((error, _req, res, next) => {
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(error.status || 400).json({ error: '请求格式不正确或内容过长，请重新输入。' }); return;
  }
  next(error);
});
const game = { id: randomUUID(), mode:'tower', maxSteps:30, plan:[], camp: null, marker: null, records: [], running: false, busy: false, ready: false, message: '正在启动 Minecraft 世界…', error: null, steps: 0, failedTargets: new Set() };
const task=()=>game.mode==='camp'?CAMP_TASK:TASK;
let bot;
let forestBackup = [];
let player;
let generation = 0;
installJevKeyEndpoint(app, { credentials, port, isBusy: () => game.busy || game.running });

function status() {
  return { ready: game.ready, configured: credentials.configured, task: task(), mode:game.mode, maxSteps:game.maxSteps, version: '1.16.5', id: game.id,
    running: game.running, busy: game.busy, message: game.message, error: game.error, steps: game.steps,
    world: game.ready ? snapshot(bot, game) : null,
    last: game.records.at(-1) || null,
    history: game.records.map(({ step, action, effect, ok, model, latencyMs }) => ({ step, label: action.label, effect, ok, model, latencyMs })),
  };
}
app.get('/api/status', (_req, res) => res.json(status()));
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'jev-minecraft', ready: game.ready, configured: credentials.configured, provider: 'TypeSafe 官方 Jev', minecraftVersion: '1.16.5', gamePort: mcPort }));
app.get('/api/records', (_req, res) => res.json({ id: game.id, task: task(), mode:game.mode, world: game.ready ? snapshot(bot, game) : null, records: game.records }));
app.get('/api/export', (_req, res) => { res.attachment(`jev-minecraft-${game.id}.json`); res.json({ id: game.id, task: task(), mode:game.mode, world: game.ready ? snapshot(bot, game) : null, records: game.records }); });
app.post('/api/control', async (req, res) => {
  const command = req.body?.command;
  if (command === 'pause') { game.running = false; generation++; game.message = game.busy ? '正在完成当前动作，随后暂停' : '演示已暂停'; res.json(status()); return; }
  if (!game.ready || game.busy || game.running) { res.status(409).json({ error: '请等待当前操作结束。' }); return; }
  if (!['run', 'step', 'reset', 'camp'].includes(command)) { res.status(400).json({ error: '未知操作' }); return; }
  if (command === 'reset' || command==='camp') {
    game.busy = true; game.ready = false; game.message = '正在恢复森林和营地…';
    try {
      bot.pathfinder.setGoal(null); bot.clearControlStates();
      if(command==='camp'){game.mode='camp';game.maxSteps=80;}
      if(game.mode==='camp')await prepareCamp(server,player,game);
      else {
        for (const saved of forestBackup) await server.setBlock(server.overworld, vector(saved.position), saved.stateId);
        for (let y = 0; y < 3; y++) await server.setBlock(server.overworld, vector(game.marker).offset(0, y, 0), 0);
        for (let slot = 0; slot < player.inventory.slots.length; slot++) if (player.inventory.slots[slot]) player.inventory.updateSlot(slot, null);
      }
      for (const entity of Object.values(server.entities)) if (entity !== player && entity.type !== 'player') entity.destroy();
      player.teleport(vector(game.camp));
      await sleep(700); await bot.lookAt(vector(game.marker).offset(.5, 1.5, .5), true);
      game.id = randomUUID(); game.records = []; game.steps = 0; game.failedTargets.clear(); game.error = null; game.message = game.mode==='camp'?'营地工地与材料已准备，等待 Jev 施工':'Jev 已空手回到营地，等待出发';
    } catch (error) { game.error = error.message; }
    finally { game.ready = true; game.busy = false; }
    res.json(status()); return;
  }
  if (!credentials.configured) { res.status(503).json({ error: '请在页面输入官方 Jev 密钥，无需重启。' }); return; }
  if (snapshot(bot, game).finished || game.steps >= game.maxSteps) { res.status(409).json({ error: '任务已经完成或达到步数上限，请重置。' }); return; }
  game.error = null;
  if (command === 'run') {
    game.running = true; const token = ++generation;
    res.json(status());
    while (game.running && generation === token && !snapshot(bot, game).finished && game.steps < game.maxSteps) {
      await step(); if (game.running) await sleep(700);
    }
    if (generation === token) game.running = false;
    return;
  }
  await step(); res.json(status());
});
app.get('/', (_req, res) => res.sendFile(resolve(root, 'public/index.html')));
app.use(express.static(resolve(root, 'public'), { dotfiles: 'deny' }));
http.listen(port, '127.0.0.1', () => console.log(`控制页面 http://127.0.0.1:${port}/`));

async function step() {
  if (game.busy) return;
  game.busy = true;
  let record;
  try {
    const available = actions(bot, game);
    const input = request(bot, game, available);
    game.message = '正在把游戏状态发给 Jev…';
    const started = performance.now();
    const response = await credentials.client.systemOne({ model: input.model, state: input.state, questions: { next_action: choice(input.questions.next_action.instructions, input.questions.next_action.criteria) } }, { timeout: 15000, retry: { maxRetries: 0 } });
    const answer = response.answers.next_action;
    const selected = available.find((a) => a.id === answer.choice);
    if (!selected) throw new Error('Jev 返回了当前不可用的动作');
    game.steps++;
    record = { step: game.steps, at: new Date().toISOString(), model: response.model, latencyMs: Math.round(performance.now() - started), request: input, response, answer, action: selected, before: snapshot(bot, game), ok: false, effect: '正在执行…' };
    game.records.push(record);
    game.message = `Jev 选择：${selected.label} · 正在执行`;
    record.effect = await execute(bot, game, selected); record.ok = true;
    record.after = snapshot(bot, game);
    if (record.after.finished) { game.running = false; game.message = `任务完成 · ${game.steps} 次真实 Jev 决策`; }
    else if (game.steps >= game.maxSteps) { game.running = false; game.message = '达到步数上限，本次未完成任务'; }
    else game.message = game.running ? record.effect : '这一步已完成 · 可以继续或重置';
    console.log(`[${record.step}] ${record.model} ${record.action.label} => ${record.effect}`);
  } catch (error) {
    const safeMessage = credentials.redact(error.message);
    game.running = false; game.error = safeMessage; game.message = '遇到问题，演示已暂停';
    if (record) {
      record.effect = safeMessage; record.after = snapshot(bot, game);
      if (record.action.kind === 'dig') {
        const p = record.action.target; game.failedTargets.add(`${p.x},${p.y},${p.z}`);
      }
    }
    console.error('[step]', safeMessage);
  } finally {
    game.busy = false;
    if (record) await writeFile(resolve(root, 'logs', `run-${game.id}.json`), JSON.stringify({ id: game.id, task: task(), mode:game.mode, world: snapshot(bot, game), records: game.records }, null, 2)).catch(console.error);
  }
}

const server = squid.createMCServer({
  host: '127.0.0.1', port: mcPort, version: '1.16.5',
  'online-mode': false, 'max-players': 4, 'view-distance': 4,
  'max-entities': 300, 'everybody-op': false, kickTimeout: 20000,
  logging: false, noConsoleOutput: true, gameMode: 0, difficulty: 0,
  generation: { name: resolve(root, 'worldgen.cjs'), options: { worldHeight: 64, waterline: 20, seed: 20261007 } },
  plugins: {}, motd: 'Jev · Flying Squid local world',
  'player-list-text': { header: { text: 'Jev Minecraft' }, footer: { text: 'Local demo' } },
});
server.on('error', (error) => console.error('[MC server]', error.message));
await server.waitForReady(20000);
let ground = 80;
while (ground > 1 && (await server.overworld.getBlock(new Vec3(0, ground, 0))).name !== 'grass_block') ground--;
game.camp = { x: .5, y: ground + 1, z: .5 };
game.marker = { x: 2, y: ground + 1, z: 0 };
for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
  await server.setBlock(server.overworld, new Vec3(x, ground, z), server.registry.blocksByName.stone_bricks.defaultState);
  for (let y = 1; y <= 6; y++) await server.setBlock(server.overworld, new Vec3(x, ground + y, z), 0);
}
await server.setBlock(server.overworld, new Vec3(2, ground, 0), server.registry.blocksByName.gold_block.defaultState);
server.getSpawnPoint = async () => vector(game.camp);
server.doDaylightCycle = false; server.time = 1000;
server.on('newPlayer', (p) => {
  if (p._client.username === 'Jev') player = p;
  // 1.16 客户端移动物品时需要事务确认；上游库存模块处理点击但缺少回包。
  p._client.on('window_click', (packet) => p._client.write('transaction', { windowId: packet.windowId, action: packet.action, accepted: true }));
});
bot = mineflayer.createBot({ host: '127.0.0.1', port: mcPort, username: 'Jev', version: '1.16.5', auth: 'offline' });
bot.on('error', (error) => { game.error = error.message; game.running = false; console.error('[bot]', error.message); });
bot.on('kicked', (reason) => { game.ready = false; game.error = String(reason); });
bot.on('end', () => { game.ready = false; game.running = false; game.message = '机器人已断开，需要重启服务'; });
bot.loadPlugin(pathfinder);
await once(bot, 'spawn'); await bot.waitForChunksToLoad();
configureMovements(bot);
const treeBlocks = bot.findBlocks({ matching: (b) => /_log$/.test(b.name), maxDistance: 30, count: 300 });
forestBackup = treeBlocks.map((position) => ({ position, stateId: bot.blockAt(position).stateId }));
attachViewer(http, app, bot, game.camp, game.marker);
await bot.lookAt(new Vec3(4.5, game.camp.y + 1.6, 4.5), true);
game.ready = true; game.message = 'Jev 已进入生存世界 · 等待出发';
console.log(`世界就绪 · 原木方块 ${forestBackup.length} · 官方 key ${credentials.configured ? '已配置' : '未配置'}`);
await attachHumanPlayer({ http, app, server, port: mcPort, camp: game.camp, marker: game.marker });
