// 在 Flying Squid 自带的 Diamond Square 地形上添加森林；世界和方块规则仍由服务端处理。
const { createRequire } = require('node:module');
const squidRequire = createRequire(require.resolve('flying-squid'));
const Vec3 = require('vec3').Vec3;
module.exports = (options) => {
  const generate = squidRequire('diamond-square')(options);
  const palette = options.registry.blocksByName;
  return (cx, cz) => {
    const chunk = generate(cx, cz);
    for (const x of [4, 12]) for (const z of [4, 12]) {
      const wx = cx * 16 + x, wz = cz * 16 + z;
      if (Math.abs(wx) < 4 && Math.abs(wz) < 4) continue;
      let ground = 80;
      while (ground > 1 && chunk.getBlockType(new Vec3(x, ground, z)) !== palette.grass_block.id) ground--;
      if (ground <= 1) continue;
      for (let y = 1; y <= 4; y++) chunk.setBlockStateId(new Vec3(x, ground + y, z), palette.oak_log.defaultState);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        for (const dy of [3, 4]) {
          if (dx === 0 && dz === 0) continue;
          chunk.setBlockStateId(new Vec3(x + dx, ground + dy, z + dz), palette.oak_leaves.defaultState);
        }
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        chunk.setBlockStateId(new Vec3(x + dx, ground + 5, z + dz), palette.oak_leaves.defaultState);
      }
    }
    return chunk;
  };
};
