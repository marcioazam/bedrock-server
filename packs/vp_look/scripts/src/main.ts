import {
  EntityComponentTypes,
  Player,
  system,
  world,
  type Block,
  type Entity,
  type RawMessage,
} from "@minecraft/server";
import { vanillaBlockKey, vanillaEntityKey, vanillaItemKey } from "./vanilla-names";

/** BR's look-card. While this pack is on, that card stays off. */
const WAILA_ENABLED = "5fs_br:waila_enabled";
const PREFIX = "vp:look:";
const REACH = 8;
const SCAN_TICKS = 4;
const REFRESH_TICKS = 20;

const TITLE_TIME = { fadeInDuration: 0, stayDuration: 20, fadeOutDuration: 0 };

const BLOCK_ALIAS: Readonly<Record<string, string>> = {
  grass_block: "tile.grass.name",
  dirt_path: "tile.grass_path.name",
  cobweb: "tile.web.name",
  dead_bush: "tile.deadbush.name",
};

const TOOLS: readonly [string, string][] = [
  ["minecraft:is_shears_item_destructible", "vp.look.tool.shears"],
  ["minecraft:is_sword_item_destructible", "vp.look.tool.sword"],
  ["minecraft:is_axe_item_destructible", "vp.look.tool.axe"],
  ["minecraft:is_pickaxe_item_destructible", "vp.look.tool.pickaxe"],
  ["minecraft:is_shovel_item_destructible", "vp.look.tool.shovel"],
  ["minecraft:is_hoe_item_destructible", "vp.look.tool.hoe"],
];

interface Look {
  identity: string;
  signature: string;
  title: RawMessage;
}

interface Shown {
  identity: string;
  signature: string;
  tick: number;
}

const shown = new Map<string, Shown>();

function pretty(typeId: string): string {
  const id = typeId.includes(":") ? typeId.split(":")[1] : typeId;
  return id
    .replace(/_entity\b/gi, "")
    .replace(/[._]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function blockKey(shortId: string): string | undefined {
  return vanillaBlockKey(shortId) ?? BLOCK_ALIAS[shortId];
}

function displayName(typeId: string, kind: "block" | "item" | "entity"): RawMessage {
  if (!typeId.startsWith("minecraft:")) return { text: pretty(typeId) };
  const short = typeId.slice("minecraft:".length);
  if (kind === "block") {
    const key = blockKey(short);
    return key ? { translate: key } : { text: pretty(typeId) };
  }
  if (kind === "item") {
    const item = vanillaItemKey(short);
    if (item) return { translate: item };
    const tile = blockKey(short);
    if (tile) return { translate: tile };
    return { text: pretty(typeId) };
  }
  const key = vanillaEntityKey(short);
  return key ? { translate: key } : { text: pretty(typeId) };
}

function compose(name: RawMessage, details: RawMessage[]): RawMessage {
  const rawtext: RawMessage[] = [{ text: PREFIX }, name];
  for (const detail of details) rawtext.push({ text: "\n" }, detail);
  return { rawtext };
}

function skipBlock(typeId: string): boolean {
  return (
    typeId === "minecraft:air" ||
    typeId === "minecraft:cave_air" ||
    typeId === "minecraft:void_air" ||
    typeId === "minecraft:structure_void" ||
    typeId.startsWith("minecraft:light_block")
  );
}

function hiddenEntity(typeId: string): boolean {
  const id = typeId.toLowerCase();
  return id.includes("inventory") || id.endsWith("_dummy") || id.includes("marker");
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function toolKey(block: Block): string | undefined {
  try {
    for (const [tag, key] of TOOLS) {
      if (block.hasTag(tag)) return key;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function blockLook(block: Block): Look {
  const tool = toolKey(block);
  const details: RawMessage[] = [];
  if (tool) details.push({ translate: tool });
  return {
    identity: `b:${block.typeId}:${tool ?? ""}`,
    signature: `b:${block.typeId}:${tool ?? ""}`,
    title: compose(displayName(block.typeId, "block"), details),
  };
}

function entityLook(entity: Entity): Look {
  const details: RawMessage[] = [];
  const bits: string[] = [entity.typeId];
  let name: RawMessage;

  if (entity.typeId === "minecraft:player") {
    name = { text: (entity as Player).name };
    bits.push((entity as Player).name);
  } else if (entity.typeId === "minecraft:item") {
    const stack = entity.getComponent(EntityComponentTypes.Item)?.itemStack;
    if (stack) {
      name = displayName(stack.typeId, "item");
      bits.push(stack.typeId, String(stack.amount));
      details.push({ translate: "vp.look.count", with: [String(stack.amount)] });
    } else {
      name = displayName(entity.typeId, "entity");
    }
  } else {
    const tag = entity.nameTag?.trim();
    name = tag ? { text: tag } : displayName(entity.typeId, "entity");
    if (tag) bits.push(tag);
  }

  if (entity.typeId !== "minecraft:item") {
    const health = entity.getComponent(EntityComponentTypes.Health);
    if (health) {
      const cur = Math.max(0, Math.ceil(health.currentValue));
      const max = Math.max(0, Math.ceil(health.effectiveMax));
      bits.push(`${cur}/${max}`);
      details.push({ translate: "vp.look.health", with: [String(cur), String(max)] });
    }
    if (entity.getComponent(EntityComponentTypes.IsBaby)) {
      bits.push("baby");
      details.push({ translate: "vp.look.baby" });
    }
  }

  return {
    identity: `e:${entity.id}`,
    signature: bits.join("|"),
    title: compose(name, details),
  };
}

function lookAt(player: Player): Look | undefined {
  let block: Block | undefined;
  let blockDistance = Number.POSITIVE_INFINITY;
  try {
    const hit = player.getBlockFromViewDirection({
      maxDistance: REACH,
      includeLiquidBlocks: true,
      includePassableBlocks: true,
    });
    if (hit && !skipBlock(hit.block.typeId)) {
      block = hit.block;
      blockDistance = distance(player.getHeadLocation(), hit.block.center());
    }
  } catch {
    block = undefined;
  }

  let entity: Entity | undefined;
  let entityDistance = Number.POSITIVE_INFINITY;
  try {
    for (const hit of player.getEntitiesFromViewDirection({
      maxDistance: REACH,
      includeLiquidBlocks: true,
      includePassableBlocks: true,
    })) {
      const target = hit.entity;
      if (!target.isValid || target.id === player.id || hiddenEntity(target.typeId)) continue;
      entity = target;
      entityDistance = hit.distance;
      break;
    }
  } catch {
    entity = undefined;
  }

  if (entity && entityDistance <= blockDistance) return entityLook(entity);
  if (block) return blockLook(block);
  return undefined;
}

function silenceWaila(player: Player): void {
  if (player.getDynamicProperty(WAILA_ENABLED) !== false) {
    player.setDynamicProperty(WAILA_ENABLED, false);
  }
}

function writeTitle(player: Player, title: RawMessage | string, identity: string): void {
  const send = () => {
    if (!player.isValid) return;
    if (shown.get(player.id)?.identity !== identity) return;
    try {
      player.onScreenDisplay.setTitle(title, TITLE_TIME);
    } catch {
      /* player left between the scan and the deferred write */
    }
  };
  send();
  // Land again after other packs' title writes in this tick.
  system.run(send);
}

function publish(player: Player, look: Look): void {
  const prev = shown.get(player.id);
  const tick = system.currentTick;
  if (prev && prev.identity === look.identity && tick - prev.tick < REFRESH_TICKS) return;
  shown.set(player.id, { identity: look.identity, signature: look.signature, tick });
  writeTitle(player, look.title, look.identity);
}

function clearLook(player: Player): void {
  const prev = shown.get(player.id);
  if (!prev || prev.identity === "") return;
  shown.set(player.id, { identity: "", signature: "", tick: system.currentTick });
  writeTitle(player, PREFIX, "");
}

function scan(player: Player): void {
  if (!player.isValid) return;
  silenceWaila(player);
  const look = lookAt(player);
  if (!look) clearLook(player);
  else publish(player, look);
}

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      scan(player);
    } catch (error) {
      console.warn(`[vp_look] ${error}`);
    }
  }
}, SCAN_TICKS);

world.afterEvents.playerSpawn.subscribe((ev) => {
  try {
    silenceWaila(ev.player);
  } catch {
    /* player not ready */
  }
});

world.afterEvents.playerLeave.subscribe((ev) => {
  shown.delete(ev.playerId);
});
