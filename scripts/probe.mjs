import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const squid = require('flying-squid');
const mineflayer = require('mineflayer');
const { mineflayer: viewer } = require('prismarine-viewer');
const server = squid.createMCServer({
  host: '127.0.0.1', port: 25566, version: '1.16.5',
  'online-mode': false, 'max-players': 4, 'view-distance': 4,
  'max-entities': 200, 'everybody-op': false, kickTimeout: 20000,
  logging: false, gameMode: 0, difficulty: 0,
  generation: { name: 'diamond_square', options: { worldHeight: 64, seed: 20261007 } },
  plugins: {}, motd: 'Jev Minecraft local world',
  'player-list-text': { header: { text: 'Jev' }, footer: { text: 'Local demo' } },
});
server.on('error', console.error);
server.on('clientError', (_client, error) => console.error('CLIENT ERROR', error));
await server.waitForReady(20000);
console.log('SERVER READY');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'Jev', version: '1.16.5', auth: 'offline' });
bot.on('error', console.error);
bot.on('kicked', (reason) => console.log('KICKED', reason));
await once(bot, 'spawn');
await bot.waitForChunksToLoad();
console.log('SPAWN', bot.entity.position, 'MODE', bot.game.gameMode);
const logs = bot.findBlocks({ matching: block => /_log$/.test(block.name), maxDistance: 32, count: 12 });
console.log('TREES', logs);
console.log('INVENTORY', bot.inventory.items().map(({ name, count }) => ({ name, count })));
viewer(bot, { port: 5193, viewDistance: 4, firstPerson: true });
await fs.mkdir('logs', { recursive: true });
await fs.writeFile('logs/probe.json', JSON.stringify({ position: bot.entity.position, logs }, null, 2));
console.log('VIEWER http://127.0.0.1:5193');
