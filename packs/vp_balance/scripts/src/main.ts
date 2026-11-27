import {
    world,
    system,
    Player,
    EquipmentSlot,
    EntityComponentTypes,
    EffectTypes,
    CommandPermissionLevel,
    CustomCommandParamType,
    CustomCommandStatus,
    EntityHurtBeforeEvent,
    EntityDamageCause,
} from "@minecraft/server";
import { WEAPON_DAMAGE } from "./weapons";

const DIFFICULTY = "5fs_br:world_difficulty";
const LOCK = "5fs_br:lock_difficulty";
const SHROUD = "5fs:shroud_spawn_rate";
const THIRST = "5fs:thirst_water_replenish";
const TIER = "vp:diff_tier";
const STAGE = "vp:stage";
const LEVELS = ["hardplus", "hard", "normal"] as const;
const STAGE_HIT = [1, 1.08, 1.15, 1.25] as const;
const EFFECT_TICKS = 20 * 60 * 20;

type Level = (typeof LEVELS)[number];

let stageNow = 0;
const tiers = new Map<string, string>();
const held = new Map<string, string>();
const recent = new Map<string, { typeId: string; until: number }>();
const thrown = new Map<string, string>();


function isLevel(value: string): value is Level {
    return (LEVELS as readonly string[]).includes(value);
}

function loadStage(): void {
    const value = world.getDynamicProperty(STAGE);
    if (typeof value === "number") {
        if (value > stageNow) stageNow = value;
    } else {
        world.setDynamicProperty(STAGE, stageNow);
    }
}

function lockWorld(): void {
    world.setDynamicProperty(DIFFICULTY, "brutal");
    world.setDynamicProperty(LOCK, true);
    world.setDynamicProperty(SHROUD, "high");
    loadStage();
}

function raiseStage(next: number): void {
    if (next <= stageNow) return;
    stageNow = next;
    world.setDynamicProperty(STAGE, next);
    const message = { translate: "vp.balance.stage", with: [String(next)] };
    for (const player of world.getPlayers()) player.sendMessage(message);
}

function applyTier(player: Player, level?: string): void {
    const stored = tiers.get(player.id) ?? String(player.getDynamicProperty(TIER) ?? "hardplus");
    const next = level && isLevel(level) ? level : stored;
    tiers.set(player.id, next);
    player.setDynamicProperty(TIER, next);
    player.setDynamicProperty(THIRST, next === "normal");
}

function asPlayers(arg: unknown): Player[] {
    const list = Array.isArray(arg) ? arg : [arg];
    return list.filter((entry): entry is Player => {
        if (!entry || typeof entry !== "object") return false;
        return (entry as Player).typeId === "minecraft:player";
    });
}

function weaponOf(playerId: string): string | undefined {
    const live = held.get(playerId);
    if (live) return live;
    const last = recent.get(playerId);
    if (!last) return undefined;
    if (last.until < system.currentTick) {
        recent.delete(playerId);
        return undefined;
    }
    return last.typeId;
}

function hitScale(ev: EntityHurtBeforeEvent): number {
    let scale = 1;
    const projectileId = ev.damageSource.damagingProjectile?.id;
    const sourceId = ev.damageSource.damagingEntity?.id;
    const typeId = (projectileId ? thrown.get(projectileId) : undefined) ?? (sourceId ? weaponOf(sourceId) : undefined);
    if (projectileId) thrown.delete(projectileId);
    const row = typeId ? WEAPON_DAMAGE[typeId] : undefined;
    if (row) scale *= row[0] / row[1];
    const fromFighter = ev.damageSource.cause === EntityDamageCause.entityAttack
        || ev.damageSource.cause === EntityDamageCause.projectile;
    if (fromFighter && ev.hurtEntity.typeId === "minecraft:player") {
        const tier = tiers.get(ev.hurtEntity.id) ?? "hardplus";
        if (tier === "hard") scale *= 1.7 / 2.5;
        else if (tier === "normal") scale *= 1 / 2.5;
        else scale *= STAGE_HIT[Math.min(3, Math.max(0, stageNow))];
    }
    return scale;
}

function rememberHeld(): void {
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
                { name: "level", type: CustomCommandParamType.String },
            ],
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
                    (admin as Player).sendMessage({
                        translate: "vp.balance.admin",
                        with: [list.map((player) => player.name).join(", "), want],
                    });
                }
            });
            return { status: CustomCommandStatus.Success };
        },
    );
});

world.afterEvents.worldLoad.subscribe(() => {
    try {
        lockWorld();
    } catch {
        /* world properties are not writable yet */
    }
});

world.afterEvents.playerSpawn.subscribe((ev) => {
    try {
        lockWorld();
    } catch {
        /* same tick as the first join */
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
        /* the dead entity is already invalid */
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
        const sameKind = (name.includes("trident") && entity.typeId.includes("trident"))
            || (name.includes("spear") && entity.typeId.includes("spear"));
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
        /* players are not readable yet */
    }
}, 5);

world.beforeEvents.entityHurt.subscribe((ev) => {
    if (ev.damage <= 0) return;
    try {
        const scale = hitScale(ev);
        if (Math.abs(scale - 1) < 0.001) return;
        ev.damage *= scale;
    } catch {
        /* reading the attacker is refused in this event */
    }
});

system.runInterval(() => {
    try {
        lockWorld();
        const day = world.getDay();
        if (day >= 21) raiseStage(2);
        else if (day >= 7) raiseStage(1);
    } catch {
        /* before the world is ready */
    }
}, 200);
