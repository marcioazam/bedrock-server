// src/main.ts
import {
  world,
  system,
  EquipmentSlot,
  EntityComponentTypes,
  EffectTypes,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  EntityDamageCause
} from "@minecraft/server";

// src/weapons.ts
var WEAPON_DAMAGE = {
  "5fs_br:cobalt_axe": [7, 9],
  "5fs_br:cobalt_hoe": [6, 8],
  "5fs_br:cobalt_pickaxe": [6, 8],
  "5fs_br:cobalt_shovel": [5, 6],
  "5fs_br:cobalt_spear": [5, 6],
  "5fs_br:cobalt_sword": [8, 10],
  "5fs_br:crystalline_axe": [6, 7],
  "5fs_br:crystalline_hoe": [5, 6],
  "5fs_br:crystalline_shovel": [4, 5],
  "5fs_br:crystalline_sword": [7, 8],
  "5fs_br:dragonite_axe": [7, 11],
  "5fs_br:dragonite_hammer": [6, 7],
  "5fs_br:dragonite_hoe": [6, 10],
  "5fs_br:dragonite_pickaxe": [6, 10],
  "5fs_br:dragonite_shovel": [5, 9],
  "5fs_br:dragonite_spear": [5, 9],
  "5fs_br:dragonite_sword": [8, 12],
  "5fs_br:dragonite_trident": [5, 9],
  "5fs_br:emerald_axe": [5, 6],
  "5fs_br:emerald_hammer": [4, 3],
  "5fs_br:emerald_hoe": [4, 5],
  "5fs_br:emerald_shovel": [3, 4],
  "5fs_br:emerald_sword": [6, 7],
  "5fs_br:golden_hammer": [2, 4],
  "5fs_br:meteorite_axe": [7, 10],
  "5fs_br:meteorite_hoe": [6, 9],
  "5fs_br:meteorite_pickaxe": [6, 9],
  "5fs_br:meteorite_shovel": [5, 8],
  "5fs_br:meteorite_spear": [5, 7],
  "5fs_br:meteorite_trident": [5, 9],
  "5fs_br:obsidian_hoe": [6, 7],
  "5fs_br:obsidian_pickaxe": [6, 7],
  "5fs_br:obsidian_shovel": [5, 6],
  "5fs_br:steel_hoe": [5, 6],
  "5fs_br:steel_pickaxe": [5, 6],
  "5fs_br:steel_shovel": [4, 5],
  "5fs_br:steel_spear": [4, 5],
  "5fs_br:stone_hammer": [3, 2],
  "5fs_br:wooden_hammer": [2, 1],
  "5fs_br:iron_hammer": [4, 3],
  "5fs_br:obsidian_hammer": [6, 4],
  "5fs_br:steel_hammer": [5, 3]
};

// src/main.ts
var DIFFICULTY = "5fs_br:world_difficulty";
var LOCK = "5fs_br:lock_difficulty";
var SHROUD = "5fs:shroud_spawn_rate";
var THIRST = "5fs:thirst_water_replenish";
var TIER = "vp:diff_tier";
var STAGE = "vp:stage";
var LEVELS = ["hardplus", "hard", "normal"];
var STAGE_HIT = [1, 1.08, 1.15, 1.25];
var EFFECT_TICKS = 20 * 60 * 20;
var stageNow = 0;
var tiers = /* @__PURE__ */ new Map();
var held = /* @__PURE__ */ new Map();
var recent = /* @__PURE__ */ new Map();
var thrown = /* @__PURE__ */ new Map();
function isLevel(value) {
  return LEVELS.includes(value);
}
function loadStage() {
  const value = world.getDynamicProperty(STAGE);
  if (typeof value === "number") {
    if (value > stageNow) stageNow = value;
  } else {
    world.setDynamicProperty(STAGE, stageNow);
  }
}
function lockWorld() {
  world.setDynamicProperty(DIFFICULTY, "brutal");
  world.setDynamicProperty(LOCK, true);
  world.setDynamicProperty(SHROUD, "high");
  loadStage();
}
function raiseStage(next) {
  if (next <= stageNow) return;
  stageNow = next;
  world.setDynamicProperty(STAGE, next);
  const message = { translate: "vp.balance.stage", with: [String(next)] };
  for (const player of world.getPlayers()) player.sendMessage(message);
}
function applyTier(player, level) {
  const stored = tiers.get(player.id) ?? String(player.getDynamicProperty(TIER) ?? "hardplus");
  const next = level && isLevel(level) ? level : stored;
  tiers.set(player.id, next);
  player.setDynamicProperty(TIER, next);
  player.setDynamicProperty(THIRST, next === "normal");
}
function asPlayers(arg) {
  const list = Array.isArray(arg) ? arg : [arg];
  return list.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return entry.typeId === "minecraft:player";
  });
}
function weaponOf(playerId) {
  const live = held.get(playerId);
  if (live) return live;
  const last = recent.get(playerId);
  if (!last) return void 0;
  if (last.until < system.currentTick) {
    recent.delete(playerId);
    return void 0;
  }
  return last.typeId;
}
function hitScale(ev) {
  let scale = 1;
  const projectileId = ev.damageSource.damagingProjectile?.id;
  const sourceId = ev.damageSource.damagingEntity?.id;
  const typeId = (projectileId ? thrown.get(projectileId) : void 0) ?? (sourceId ? weaponOf(sourceId) : void 0);
  if (projectileId) thrown.delete(projectileId);
  const row = typeId ? WEAPON_DAMAGE[typeId] : void 0;
  if (row) scale *= row[0] / row[1];
  const fromFighter = ev.damageSource.cause === EntityDamageCause.entityAttack || ev.damageSource.cause === EntityDamageCause.projectile;
  if (fromFighter && ev.hurtEntity.typeId === "minecraft:player") {
    const tier = tiers.get(ev.hurtEntity.id) ?? "hardplus";
    if (tier === "hard") scale *= 1.7 / 2.5;
    else if (tier === "normal") scale *= 1 / 2.5;
    else scale *= STAGE_HIT[Math.min(3, Math.max(0, stageNow))];
  }
  return scale;
}
function rememberHeld() {
  for (const player of world.getPlayers()) {
    const item = player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
    if (item && WEAPON_DAMAGE[item.typeId]) {
      held.set(player.id, item.typeId);
      recent.set(player.id, { typeId: item.typeId, until: system.currentTick + 200 });
    } else held.delete(player.id);
  }
}
system.beforeEvents.startup.subscribe((init) => {
  init.customCommandRegistry.registerCommand(
    {
      name: "vp:dificuldade",
      description: "Sets one player's Hard+ exception.",
      permissionLevel: CommandPermissionLevel.Admin,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "level", type: CustomCommandParamType.String }
      ]
    },
    (origin, players, level) => {
      const want = String(level).trim();
      if (!isLevel(want)) {
        return { status: CustomCommandStatus.Failure, message: "Use hardplus, hard or normal." };
      }
      const list = asPlayers(players);
      if (list.length === 0) {
        return { status: CustomCommandStatus.Failure, message: "No player." };
      }
      system.run(() => {
        for (const player of list) {
          if (!player.isValid) continue;
          applyTier(player, want);
          player.sendMessage({ translate: "vp.balance.you", with: [want] });
        }
        const admin = origin.sourceEntity;
        if (admin?.isValid && admin.typeId === "minecraft:player") {
          admin.sendMessage({
            translate: "vp.balance.admin",
            with: [list.map((player) => player.name).join(", "), want]
          });
        }
      });
      return { status: CustomCommandStatus.Success };
    }
  );
});
world.afterEvents.worldLoad.subscribe(() => {
  try {
    lockWorld();
  } catch {
  }
});
world.afterEvents.playerSpawn.subscribe((ev) => {
  try {
    lockWorld();
  } catch {
  }
  if (ev.player.isValid) applyTier(ev.player);
});
world.afterEvents.playerDimensionChange.subscribe((ev) => {
  if (ev.toDimension.id === "minecraft:nether") raiseStage(1);
  if (ev.toDimension.id === "minecraft:the_end") raiseStage(3);
});
world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const id = ev.deadEntity.typeId;
    if (id === "minecraft:wither") raiseStage(2);
    if (id === "minecraft:ender_dragon") raiseStage(3);
  } catch {
  }
});
world.afterEvents.entitySpawn.subscribe((ev) => {
  const entity = ev.entity;
  if (!entity.isValid || entity.typeId === "minecraft:player" || entity.hasTag("vp:staged")) return;
  const projectile = entity.getComponent(EntityComponentTypes.Projectile);
  const ownerId = projectile?.owner?.id;
  if (ownerId) {
    const typeId = weaponOf(ownerId);
    const name = typeId ? typeId.slice(typeId.indexOf(":") + 1) : "";
    const sameKind = name.includes("trident") && entity.typeId.includes("trident") || name.includes("spear") && entity.typeId.includes("spear");
    if (typeId && sameKind) thrown.set(entity.id, typeId);
    return;
  }
  const now = stageNow;
  if (now < 1) return;
  const family = entity.getComponent(EntityComponentTypes.TypeFamily);
  if (!family?.hasTypeFamily("monster")) return;
  const strength = EffectTypes.get("minecraft:strength") ?? EffectTypes.get("strength");
  const resistance = EffectTypes.get("minecraft:resistance") ?? EffectTypes.get("resistance");
  entity.addTag("vp:staged");
  if (strength) entity.addEffect(strength, EFFECT_TICKS, { amplifier: now >= 3 ? 1 : 0, showParticles: true });
  if (now >= 2 && resistance) entity.addEffect(resistance, EFFECT_TICKS, { amplifier: 0, showParticles: true });
});
world.afterEvents.playerLeave.subscribe((ev) => {
  tiers.delete(ev.playerId);
  held.delete(ev.playerId);
  recent.delete(ev.playerId);
});
system.runInterval(() => {
  try {
    rememberHeld();
  } catch {
  }
}, 5);
world.beforeEvents.entityHurt.subscribe((ev) => {
  if (ev.damage <= 0) return;
  try {
    const scale = hitScale(ev);
    if (Math.abs(scale - 1) < 1e-3) return;
    ev.damage *= scale;
  } catch {
  }
});
system.runInterval(() => {
  try {
    lockWorld();
    const day = world.getDay();
    if (day >= 21) raiseStage(2);
    else if (day >= 7) raiseStage(1);
  } catch {
  }
}, 200);
