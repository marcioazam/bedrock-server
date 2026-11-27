import {
    BlockComponentTypes,
    MolangVariableMap,
    system,
    world,
    type Block,
    type Dimension,
} from "@minecraft/server";

/**
 * BR hides a climbing squirrel inside the canopy and respawns it later through
 * the 5fs_br:squirrel_respawn scriptevent. Rustling leaves only fall when it
 * dives in, never when it pops back out. This hook mirrors BR's own enter-side
 * effect (same particle, same sound) on the exit side.
 */
const RESPAWN_EVENT = "5fs_br:squirrel_respawn";
const LEAF_PARTICLE = "5fs_br:squirrel_leaves";
const LEAF_SOUND = "block.leaf_litter.step";
const DEBUG_PROPERTY = "vp:squirrel_leaf_debug";
const DEBUG_EVENT = "vp_squirrel:leafdebug";
const SOUND_BURSTS = 5;

/** Oak-leaf green, used only when the tint component refuses a reading. */
const FALLBACK_COLOR = { red: 0.29, green: 0.52, blue: 0.13 };

/** Pending markers pin inside the topmost leaf but can drift a little. */
const SCAN_OFFSETS: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, -1, 0],
    [0, 2, 0],
];

function debug(message: string): void {
    // warn on purpose: the dev server filters content-log at warning level,
    // so console.info never reaches any log a human can read.
    if (world.getDynamicProperty(DEBUG_PROPERTY) === true) {
        console.warn(`[vp_squirrel] ${message}`);
    }
}

function isLeaves(typeId: string): boolean {
    return typeId.endsWith("_leaves");
}

function leafNear(dimension: Dimension, x: number, y: number, z: number): Block | undefined {
    for (const [dx, dy, dz] of SCAN_OFFSETS) {
        try {
            const block = dimension.getBlock({ x: x + dx, y: y + dy, z: z + dz });
            if (block && isLeaves(block.typeId)) return block;
        } catch {
            /* outside the world or an unloaded chunk */
        }
    }
    return undefined;
}

function leafColor(block: Block): { red: number; green: number; blue: number } {
    try {
        const tint = block.getComponent(BlockComponentTypes.MapColor)?.tintedColor;
        if (tint) return { red: tint.red, green: tint.green, blue: tint.blue };
    } catch {
        /* tintedColor can throw on some blocks; fall back to green */
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
