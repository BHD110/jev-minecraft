import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const viewerRequire = createRequire(require.resolve('prismarine-viewer'));
const { Server } = viewerRequire('socket.io');
const { WorldView } = require('prismarine-viewer').viewer;
const express = viewerRequire('express');
const viewerRoot = dirname(require.resolve('prismarine-viewer'));

export { express, Server };
export function attachViewer(http, app, bot, camp, marker, prefix = '/view') {
  // 复用开源查看器的原始资源和 Socket 协议，所有服务只绑定本机。
  app.use(prefix, express.static(join(viewerRoot, 'public')));
  const io = new Server(http, { path: prefix + '/socket.io' });
  io.on('connection', (socket) => {
    const referer = new URL(socket.handshake.headers.referer || 'http://127.0.0.1');
    const firstPerson = referer.searchParams.get('camera') !== 'third';
    socket.emit('version', bot.version);
    const world = new WorldView(bot.world, 3, bot.entity.position, socket);
    world.init(bot.entity.position).catch((error) => console.error('[viewer]', error.message));
    world.listenToBot(bot);
    // 上游 boxgrid 要求整数格尺寸；营地用真实石砖地面表示。
    socket.emit('primitive', { id: 'tower', type: 'boxgrid', start: marker, end: { x: marker.x + 1, y: marker.y + 3, z: marker.z + 1 }, color: '#fac364' });
    function position() {
      const packet = { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true };
      if (firstPerson) packet.pitch = bot.entity.pitch;
      socket.emit('position', packet); world.updatePosition(bot.entity.position);
    }
    position(); bot.on('move', position);
    socket.on('disconnect', () => { bot.off('move', position); world.removeListenersFromBot(bot); });
  });
  return io;
}
