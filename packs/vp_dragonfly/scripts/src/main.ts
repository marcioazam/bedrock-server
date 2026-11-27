import {
    EntityComponentTypes,
    system,
    world,
    type Entity,
    type Vector3,
} from "@minecraft/server";

const DRAGONFLY_TYPE = "5fs_br:dragonfly";
const PLAYER_TYPE = "minecraft:player";
const ZONES_PROPERTY = "vp:dragonfly_death_echo_zones";

const ZONE_RADIUS = 24;
const ZONE_RADIUS_SQUARED = ZONE_RADIUS * ZONE_RADIUS;
const ECHO_DURATION_MS = 20 * 60 * 1000;
const SWEEP_INTERVAL_TICKS = 100;
const SCATTER_DURATION_TICKS = 80;
const SCATTER_EFFECT_TICKS = 100;
const MAX_ZONES = 64;
const IMPULSE_STRENGTH = 0.28;
const IMPULSE_LIFT = 0.08;

interface EchoZone {
    x: number;
    y: number;
    z: number;
    dim: string;
    expiresAtMs: number;
}

const scattering = new Set<string>();

function isZone(value: unknown): value is EchoZone {
    if (!value || typeof value !== "object") return false;
    const zone = value as Partial<EchoZone>;
    return typeof zone.dim === "string"
        && zone.dim.length > 0
        && typeof zone.x === "number" && Number.isFinite(zone.x)
        && typeof zone.y === "number" && Number.isFinite(zone.y)
        && typeof zone.z === "number" && Number.isFinite(zone.z)
        && typeof zone.expiresAtMs === "number" && Number.isFinite(zone.expiresAtMs);
}

function loadZones(): EchoZone[] {
    const raw = world.getDynamicProperty(ZONES_PROPERTY);
    if (typeof raw !== "string") return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isZone) : [];
    } catch {
        return [];
    }
}

function saveZones(zones: EchoZone[]): void {
    world.setDynamicProperty(ZONES_PROPERTY, JSON.stringify(zones));
}

function activeOnly(zones: EchoZone[], nowMs: number): EchoZone[] {
    return zones.filter((zone) => zone.expiresAtMs > nowMs);
}

function distanceSquared(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

function insideZone(zone: EchoZone, location: Vector3, dimensionId: string): boolean {
    return zone.dim === dimensionId && distanceSquared(zone, location) <= ZONE_RADIUS_SQUARED;
}

function capZones(zones: EchoZone[]): EchoZone[] {
    zones.sort((a, b) => a.expiresAtMs - b.expiresAtMs);
    return zones.slice(Math.max(0, zones.length - MAX_ZONES));
}

function activateZone(dimensionId: string, center: Vector3): void {
    const nowMs = Date.now();
    const zones = activeOnly(loadZones(), nowMs);
    let resetExisting = false;

    for (const zone of zones) {
        if (!insideZone(zone, center, dimensionId)) continue;
        zone.expiresAtMs = nowMs + ECHO_DURATION_MS;
        resetExisting = true;
    }

    if (!resetExisting) {
        zones.push({
            x: center.x,
            y: center.y,
            z: center.z,
            dim: dimensionId,
            expiresAtMs: nowMs + ECHO_DURATION_MS,
        });
    }

    saveZones(capZones(zones));
}

function fallbackAngle(entityId: string): number {
    let hash = 0;
    for (let index = 0; index < entityId.length; index++) {
        hash = (hash * 31 + entityId.charCodeAt(index)) >>> 0;
    }
    return (hash / 0xffffffff) * Math.PI * 2;
}

function impulseAway(entity: Entity, center: Vector3): Vector3 {
    const location = entity.location;
    let dx = location.x - center.x;
    let dz = location.z - center.z;
    let horizontal = Math.hypot(dx, dz);

    if (horizontal < 0.001) {
        const angle = fallbackAngle(entity.id);
        dx = Math.cos(angle);
        dz = Math.sin(angle);
        horizontal = 1;
    }

    return {
        x: (dx / horizontal) * IMPULSE_STRENGTH,
        y: IMPULSE_LIFT,
        z: (dz / horizontal) * IMPULSE_STRENGTH,
    };
}

function removeQuietly(entity: Entity): void {
    if (!entity.isValid) return;
    try {
        entity.remove();
    } catch {
        /* the entity became invalid between the check and the removal */
    }
}

function scatterEntity(entity: Entity, center: Vector3): void {
    if (!entity.isValid || scattering.has(entity.id)) return;
    scattering.add(entity.id);
    let originalFlyingSpeed: number | undefined;

    try {
        entity.addEffect("minecraft:speed", SCATTER_EFFECT_TICKS, {
            amplifier: 4,
            showParticles: false,
        });
    } catch {
        /* the impulse and removal below still apply if effects are refused */
    }

    try {
        const flyingSpeed = entity.getComponent(EntityComponentTypes.FlyingSpeed);
        if (flyingSpeed) {
            originalFlyingSpeed = flyingSpeed.value;
            flyingSpeed.value = Math.max(0.45, originalFlyingSpeed * 4);
        }
    } catch {
        /* not every dragonfly state necessarily exposes the flying-speed component */
    }

    try {
        entity.applyImpulse(impulseAway(entity, center));
    } catch {
        /* the timed pulses below still apply if the first push is refused */
    }

    for (const delay of [20, 40]) {
        system.runTimeout(() => {
            if (!entity.isValid || !scattering.has(entity.id)) return;
            try {
                entity.applyImpulse(impulseAway(entity, center));
            } catch {
                /* unloaded or removed before this pulse */
            }
        }, delay);
    }

    system.runTimeout(() => {
        scattering.delete(entity.id);
        if (entity.isValid && originalFlyingSpeed !== undefined) {
            try {
                const flyingSpeed = entity.getComponent(EntityComponentTypes.FlyingSpeed);
                if (flyingSpeed) flyingSpeed.value = originalFlyingSpeed;
            } catch {
                /* the removal below is the cleanup that matters */
            }
        }
        removeQuietly(entity);
    }, SCATTER_DURATION_TICKS);
}

function dimensionForId(dimensionId: string) {
    const unprefixed = dimensionId.startsWith("minecraft:") ? dimensionId.slice("minecraft:".length) : dimensionId;
    try {
        return world.getDimension(unprefixed);
    } catch (error) {
        if (unprefixed === dimensionId) throw error;
        return world.getDimension(dimensionId);
    }
}

function dragonfliesNear(zone: EchoZone): Entity[] {
    return dimensionForId(zone.dim).getEntities({
        type: DRAGONFLY_TYPE,
        location: { x: zone.x, y: zone.y, z: zone.z },
        maxDistance: ZONE_RADIUS,
    });
}

function scatterAround(dimensionId: string, center: Vector3): void {
    const query: EchoZone = {
        x: center.x,
        y: center.y,
        z: center.z,
        dim: dimensionId,
        expiresAtMs: 0,
    };
    for (const entity of dragonfliesNear(query)) {
        scatterEntity(entity, center);
    }
}

function sweepZones(): void {
    const nowMs = Date.now();
    const stored = loadZones();
    const active = activeOnly(stored, nowMs);
    if (active.length !== stored.length) saveZones(capZones(active));

    for (const zone of active) {
        let entities: Entity[];
        try {
            entities = dragonfliesNear(zone);
        } catch (error) {
            console.warn(`[vp_dragonfly] death echo sweep skipped ${zone.dim}: ${error}`);
            continue;
        }
        for (const entity of entities) {
            if (!entity.isValid || scattering.has(entity.id)) continue;
            removeQuietly(entity);
        }
    }
}

world.afterEvents.entityDie.subscribe((event) => {
    let captured: { center: Vector3; dimensionId: string } | undefined;
    try {
        if (event.deadEntity.typeId !== DRAGONFLY_TYPE) return;
        const attacker = event.damageSource.damagingEntity;
        if (!attacker || attacker.typeId !== PLAYER_TYPE) return;
        captured = {
            center: {
                x: event.deadEntity.location.x,
                y: event.deadEntity.location.y,
                z: event.deadEntity.location.z,
            },
            dimensionId: event.deadEntity.dimension.id,
        };
    } catch {
        return;
    }

    const { center, dimensionId } = captured;
    system.run(() => {
        try {
            activateZone(dimensionId, center);
            scatterAround(dimensionId, center);
        } catch (error) {
            console.warn(`[vp_dragonfly] death echo failed: ${error}`);
        }
    });
}, { entityTypes: [DRAGONFLY_TYPE] });

world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    let captured: { location: Vector3; dimensionId: string } | undefined;
    try {
        if (entity.typeId !== DRAGONFLY_TYPE) return;
        captured = {
            location: {
                x: entity.location.x,
                y: entity.location.y,
                z: entity.location.z,
            },
            dimensionId: entity.dimension.id,
        };
    } catch {
        return;
    }

    const { location, dimensionId } = captured;
    system.run(() => {
        try {
            if (!entity.isValid) return;
            const nowMs = Date.now();
            const active = activeOnly(loadZones(), nowMs);
            if (active.some((zone) => insideZone(zone, location, dimensionId))) {
                removeQuietly(entity);
            }
        } catch (error) {
            console.warn(`[vp_dragonfly] death echo spawn check failed: ${error}`);
        }
    });
});

system.runInterval(() => {
    try {
        sweepZones();
    } catch (error) {
        console.warn(`[vp_dragonfly] death echo sweep failed: ${error}`);
    }
}, SWEEP_INTERVAL_TICKS);
