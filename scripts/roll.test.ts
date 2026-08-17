// Smallest check that fails if the roll logic breaks: node scripts/roll.test.ts
import assert from "node:assert/strict";
import { canFill, fillTeam, rerollSlot, type Hero, type Slot } from "../src/roll.ts";

const heroes: Hero[] = [
  { name: "V1", slug: "v1", roles: ["vanguard"] },
  { name: "V2", slug: "v2", roles: ["vanguard"] },
  { name: "D1", slug: "d1", roles: ["duelist"] },
  { name: "S1", slug: "s1", roles: ["strategist"] },
  { name: "Pool", slug: "pool", roles: ["vanguard", "duelist", "strategist"] },
];
const rng = () => 0.5;

assert.ok(canFill(heroes[4], "flex") && canFill(heroes[4], "duelist"));
assert.ok(!canFill(heroes[0], "duelist"));

// fills roles, respects pins, no duplicates within team
const slots: Slot[] = [
  { role: "vanguard", hero: null, pinned: false },
  { role: "vanguard", hero: "v2", pinned: true },
  { role: "duelist", hero: null, pinned: false },
  { role: "flex", hero: null, pinned: false },
];
fillTeam(slots, heroes, new Set(), rng);
assert.equal(slots[1].hero, "v2", "pinned hero survives");
assert.ok(["v1", "pool"].includes(slots[0].hero!), "vanguard slot gets a vanguard-capable hero");
assert.ok(["d1", "pool"].includes(slots[2].hero!), "duelist slot gets a duelist-capable hero");
assert.ok(slots[3].hero, "flex slot filled");
const filled = slots.map((s) => s.hero);
assert.equal(new Set(filled).size, filled.length, "no duplicates in team");

// bans exclude heroes; impossible slots stay empty
const one: Slot[] = [{ role: "duelist", hero: null, pinned: false }];
fillTeam(one, heroes, new Set(["d1", "pool"]), rng);
assert.equal(one[0].hero, null, "banned pool leaves slot empty");

// reroll changes the hero when an alternative exists, and unpins
const rr: Slot[] = [{ role: "vanguard", hero: "v1", pinned: true }];
rerollSlot(rr[0], rr, heroes, new Set(), rng);
assert.notEqual(rr[0].hero, "v1");
assert.equal(rr[0].pinned, false);

// reroll with no alternative keeps the current hero
const stuck: Slot[] = [{ role: "duelist", hero: "d1", pinned: false }];
rerollSlot(stuck[0], stuck, heroes, new Set(["pool"]), rng);
assert.equal(stuck[0].hero, "d1");

console.log("roll.test.ts ok");
