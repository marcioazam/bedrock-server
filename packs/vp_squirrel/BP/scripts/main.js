// src/main.ts
import {
  BlockComponentTypes,
  MolangVariableMap,
  system,
  world
} from "@minecraft/server";
var RESPAWN_EVENT = "5fs_br:squirrel_respawn";
var LEAF_PARTICLE = "5fs_br:squirrel_leaves";
var LEAF_SOUND = "block.leaf_litter.step";
var DEBUG_PROPERTY = "vp:squirrel_leaf_debug";
var DEBUG_EVENT = "vp_squirrel:leafdebug";
var SOUND_BURSTS = 5;
var FALLBACK_COLOR = { red: 0.29, green: 0.52, blue: 0.13 };
var SCAN_OFFSETS = [
  [0, 0, 0],
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
  [0, 2, 0]
];
function debug(message) {
  if (world.getDynamicProperty(DEBUG_PROPERTY) === true) {
    console.warn(`[vp_squirrel] ${message}`);
  }
}
function isLeaves(typeId) {
  return typeId.endsWith("_leaves");
}
function leafNear(dimension, x, y, z) {
  for (const [dx, dy, dz] of SCAN_OFFSETS) {
    try {
      const block = dimension.getBlock({ x: x + dx, y: y + dy, z: z + dz });
      if (block && isLeaves(block.typeId)) return block;
    } catch {
    }
  }
  return void 0;
}
function leafColor(block) {
  try {
    const tint = block.getComponent(BlockComponentTypes.MapColor)?.tintedColor;
    if (tint) return { red: tint.red, green: tint.green, blue: tint.blue };
  } catch {
  }
  return FALLBACK_COLOR;
}
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id === DEBUG_EVENT) {
    const next = world.getDynamicProperty(DEBUG_PROPERTY) !== true;
    world.setDynamicProperty(DEBUG_PROPERTY, next);
    console.warn(`[vp_squirrel] leaf debug ${next ? "on" : "off"}`);
    return;
  }
  if (ev.id !== RESPAWN_EVENT) return;
  const source = ev.sourceEntity;
  if (!source?.isValid) {
    debug("respawn event without a valid pending marker");
    return;
  }
  const dimension = source.dimension;
  const base = source.location;
  const x = Math.floor(base.x);
  const y = Math.floor(base.y);
  const z = Math.floor(base.z);
  const leaf = leafNear(dimension, x, y, z);
  if (!leaf) {
    debug(`no leaves near ${x},${y},${z}: the foliage is gone, no rustle`);
    return;
  }
  const color = leafColor(leaf);
  const variables = new MolangVariableMap();
  variables.setFloat("variable.color_r", color.red);
  variables.setFloat("variable.color_g", color.green);
  variables.setFloat("variable.color_b", color.blue);
  const center = leaf.center();
  try {
    dimension.spawnParticle(LEAF_PARTICLE, center, variables);
    for (let burst = 0; burst < SOUND_BURSTS; burst++) {
      dimension.playSound(LEAF_SOUND, center);
    }
    debug(`leaves fall at ${center.x},${center.y},${center.z} (${leaf.typeId})`);
  } catch (error) {
    console.warn(`[vp_squirrel] leaf burst failed: ${error}`);
  }
});
