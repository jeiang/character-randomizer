// Smallest check that fails if the assignment logic breaks: node scripts/roll.test.ts
import assert from "node:assert/strict";
import { assign, type Exclusions, type Hero, type Player, type Rules } from "../src/roll.ts";

const heroes: Hero[] = [];
for (let i = 0; i < 6; i++) {
  heroes.push({ id: `v${i}`, name: `V${i}`, role: "V" });
  heroes.push({ id: `d${i}`, name: `D${i}`, role: "D" });
  heroes.push({ id: `s${i}`, name: `S${i}`, role: "S" });
}
heroes.push({ id: "m0", name: "M0", role: "M" });

const player = (over: Partial<Player> = {}): Player => ({
  name: "P",
  active: true,
  hero: null,
  locked: false,
  rolePref: "",
  ...over,
});
const players12 = (): Player[] => Array.from({ length: 12 }, () => player());
const noExcl = (): Exclusions => ({ game: [], A: [], B: [], p: {} });
const rules = (over: Partial<Rules> = {}): Rules => ({
  roleMode: "off",
  uniquePerTeam: true,
  customRatio: { V: 2, D: 2, S: 2 },
  crossTeamDuplicates: true,
  ...over,
});
const ALL = Array.from({ length: 12 }, (_, i) => i);

// fills every active slot, unique per team
{
  const res = assign(players12(), heroes, noExcl(), rules(), ALL);
  assert.ok("picks" in res);
  assert.equal(Object.keys(res.picks).length, 12);
  for (const idxs of [ALL.slice(0, 6), ALL.slice(6)]) {
    const ids = idxs.map((i) => res.picks[i].id);
    assert.equal(new Set(ids).size, 6, "no duplicates within a team");
  }
}

// locked players are skipped and their hero counts toward team uniqueness
{
  const ps = players12();
  ps[0] = player({ hero: "v0", heroRole: "V", locked: true });
  const res = assign(ps, heroes, noExcl(), rules(), ALL);
  assert.ok("picks" in res);
  assert.equal(res.picks[0], undefined, "locked player not rerolled");
  for (let i = 1; i < 6; i++) assert.notEqual(res.picks[i].id, "v0", "locked hero not duplicated on team");
}

// exclusions: game-wide, per-team, per-player
{
  const excl = noExcl();
  excl.game = heroes.filter((h) => h.role === "V").map((h) => h.id);
  excl.A = ["m0"];
  excl.p = { 6: ["d0"] };
  const res = assign(players12(), heroes, excl, rules(), ALL);
  assert.ok("picks" in res);
  for (const i of ALL) assert.ok(!res.picks[i].id.startsWith("v"), "game exclusion respected");
  for (let i = 0; i < 6; i++) assert.notEqual(res.picks[i].id, "m0", "team exclusion respected");
  assert.notEqual(res.picks[6].id, "d0", "player exclusion respected");
}

// role preference pins a player's role
{
  const ps = players12();
  ps[3] = player({ rolePref: "S" });
  const res = assign(ps, heroes, noExcl(), rules(), ALL);
  assert.ok("picks" in res);
  assert.equal(res.picks[3].role, "S");
}

// 2-2-2 on a full team: exactly 2 of each role
{
  const res = assign(players12(), heroes, noExcl(), rules({ roleMode: "222" }), ALL);
  assert.ok("picks" in res);
  for (const idxs of [ALL.slice(0, 6), ALL.slice(6)]) {
    const count = { V: 0, D: 0, S: 0, M: 0 };
    for (const i of idxs) count[res.picks[i].role]++;
    assert.deepEqual(count, { V: 2, D: 2, S: 2, M: 0 });
  }
}

// custom ratio must total each rolled team's player count
{
  const res = assign(players12(), heroes, noExcl(), rules({ roleMode: "custom", customRatio: { V: 1, D: 1, S: 1 } }), ALL);
  assert.ok("error" in res && res.error.includes("CUSTOM RATIO"));
  const ok = assign(players12(), heroes, noExcl(), rules({ roleMode: "custom", customRatio: { V: 2, D: 2, S: 2 } }), ALL);
  assert.ok("picks" in ok);
  for (const idxs of [ALL.slice(0, 6), ALL.slice(6)]) {
    const count = { V: 0, D: 0, S: 0, M: 0 };
    for (const i of idxs) count[ok.picks[i].role]++;
    assert.deepEqual(count, { V: 2, D: 2, S: 2, M: 0 });
  }
}

// impossible constraints report instead of hanging
{
  const excl = noExcl();
  excl.game = heroes.map((h) => h.id);
  const res = assign(players12(), heroes, excl, rules(), ALL);
  assert.ok("error" in res && res.error.includes("NO VALID COMBINATION"));
}

// nothing to roll: all locked
{
  const ps = players12().map((p) => ({ ...p, hero: "v0", locked: true }));
  const res = assign(ps, heroes, noExcl(), rules(), ALL);
  assert.ok("error" in res && res.error.includes("NOTHING TO ROLL"));
}

console.log("roll.test.ts ok");
