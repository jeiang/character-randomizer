export type Role = "vanguard" | "duelist" | "strategist";
export type SlotRole = Role | "flex";

export interface Hero {
  name: string;
  slug: string;
  roles: Role[];
}

export interface Slot {
  role: SlotRole;
  hero: string | null;
  pinned: boolean;
}

export const ROLES: Role[] = ["vanguard", "duelist", "strategist"];
export const SLOT_ROLES: SlotRole[] = [...ROLES, "flex"];

export function canFill(hero: Hero, role: SlotRole): boolean {
  return role === "flex" || hero.roles.includes(role);
}

function pick<T>(pool: T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)];
}

/** Clear unpinned slots and refill them. Unique within the team; empty pool leaves a slot open. */
export function fillTeam(slots: Slot[], heroes: Hero[], banned: Set<string>, rng: () => number): void {
  for (const s of slots) if (!s.pinned) s.hero = null;
  const taken = new Set(slots.map((s) => s.hero).filter((h): h is string => h !== null));
  // role slots before flex so flex doesn't starve a scarce role
  const order = [...slots].sort((a, b) => Number(a.role === "flex") - Number(b.role === "flex"));
  for (const s of order) {
    if (s.hero) continue;
    const pool = heroes.filter((h) => !banned.has(h.slug) && !taken.has(h.slug) && canFill(h, s.role));
    if (!pool.length) continue;
    s.hero = pick(pool, rng).slug;
    taken.add(s.hero);
  }
}

/** Redraw one slot to a different hero if any is available. Unpins it. */
export function rerollSlot(slot: Slot, slots: Slot[], heroes: Hero[], banned: Set<string>, rng: () => number): void {
  const taken = new Set(slots.filter((s) => s !== slot && s.hero).map((s) => s.hero!));
  const pool = heroes.filter(
    (h) => !banned.has(h.slug) && !taken.has(h.slug) && h.slug !== slot.hero && canFill(h, slot.role),
  );
  if (!pool.length) return;
  slot.hero = pick(pool, rng).slug;
  slot.pinned = false;
}
