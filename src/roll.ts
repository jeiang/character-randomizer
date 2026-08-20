export type Role = "V" | "D" | "S";
export type HeroRole = Role | "M";
export type RoleMode = "off" | "222" | "2s" | "custom";
export type TeamId = "A" | "B";

export interface Hero {
  id: string;
  name: string;
  role: HeroRole;
}

export interface Player {
  name: string;
  active: boolean;
  hero: string | null;
  heroRole?: HeroRole;
  locked: boolean;
  rolePref: "" | Role;
}

export interface Exclusions {
  game: string[];
  A: string[];
  B: string[];
  p: Record<number, string[]>;
}

export interface Rules {
  roleMode: RoleMode;
  uniquePerTeam: boolean;
  customRatio: Record<Role, number>;
  crossTeamDuplicates: boolean;
}

export interface Pick {
  id: string;
  role: HeroRole;
}

export type AssignResult = { picks: Record<number, Pick> } | { error: string };

export const ROLES: Role[] = ["V", "D", "S"];

export function teamOf(i: number): TeamId {
  return i < 6 ? "A" : "B";
}

type Targets = Record<string, number>;
type Counts = Record<Role, number>;

function roleTargets(n: number, mode: RoleMode, custom: Record<Role, number>): Targets {
  if (mode === "custom") return { V: custom.V, D: custom.D, S: custom.S };
  if (mode === "2s") {
    const s = n >= 5 ? 2 : Math.floor(n / 3);
    return { S: s, F: n - s };
  }
  // 222: exactly 2 strategists (scaled down for tiny teams), vanguard/duelist flex but capped at 2 each
  const s = n >= 4 ? 2 : n >= 2 ? 1 : 0;
  return { S: s, F: n - s, capV: 2, capD: 2 };
}

function roleFits(c: Counts, tg: Targets, r: HeroRole, mode: RoleMode): boolean {
  if (mode === "222") {
    if (r === "S") return c.S < tg.S;
    if (r === "M") return c.S < tg.S || (c.V + c.D < tg.F && (c.V < tg.capV || c.D < tg.capD));
    return c[r] < (r === "V" ? tg.capV : tg.capD) && c.V + c.D < tg.F;
  }
  if (mode === "2s") {
    const remS = tg.S - c.S,
      remF = tg.F - (c.V + c.D);
    if (r === "M") return remS > 0 || remF > 0;
    return r === "S" ? remS > 0 : remF > 0;
  }
  if (r === "M") return c.V < tg.V || c.D < tg.D || c.S < tg.S;
  return c[r] < tg[r];
}

function countRole(c: Counts, tg: Targets, r: HeroRole, mode: RoleMode, rng: () => number): void {
  if (mode === "222") {
    let k: Role;
    if (r === "M") {
      const opts = ROLES.filter((x) => roleFits(c, tg, x, mode));
      k = opts.length ? opts[Math.floor(rng() * opts.length)] : "D";
    } else k = r;
    c[k]++;
    return;
  }
  if (mode === "2s") {
    if (r === "M") {
      const remS = tg.S - c.S,
        remF = tg.F - (c.V + c.D);
      if (remS >= remF) c.S++;
      else c.V++;
    } else c[r]++;
    return;
  }
  if (r === "M") {
    let best: Role = "V";
    for (const k of ROLES) if (tg[k] - c[k] > tg[best] - c[best]) best = k;
    c[best]++;
  } else c[r]++;
}

/**
 * Assign heroes to the given player indexes (skipping locked/inactive ones).
 * Randomized retry: each attempt shuffles the order and picks uniformly from
 * the valid pool per player; fixed picks (locked or outside the roll) count
 * toward uniqueness and role targets.
 */
export function assign(
  players: Player[],
  heroes: Hero[],
  excl: Exclusions,
  rules: Rules,
  targetIdxs: number[],
  roleLock: Record<number, Role> = {},
  rng: () => number = Math.random,
): AssignResult {
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const gameEx = new Set(excl.game);
  const teamEx = { A: new Set(excl.A), B: new Set(excl.B) };
  const targets = targetIdxs.filter((i) => players[i].active && !players[i].locked);
  if (!targets.length) return { error: "NOTHING TO ROLL — SLOTS LOCKED OR EMPTY" };
  const fixed = players
    .map((_, i) => i)
    .filter((i) => players[i].active && !targets.includes(i) && players[i].hero);
  const mode = rules.roleMode,
    useMode = mode !== "off";
  const activeOn = (t: TeamId) => players.filter((p, i) => p.active && teamOf(i) === t).length;
  if (mode === "custom") {
    const cr = rules.customRatio,
      sum = cr.V + cr.D + cr.S;
    for (const t of new Set(targets.map(teamOf))) {
      const n = activeOn(t);
      if (sum !== n)
        return {
          error: `CUSTOM RATIO ${cr.V}-${cr.D}-${cr.S} TOTALS ${sum} — TEAM ${t === "A" ? "1" : "2"} HAS ${n} PLAYERS`,
        };
    }
  }
  // ponytail: randomized retry over exact solving; 400 attempts is plenty for 12 slots
  for (let a = 0; a < 400; a++) {
    const used = { A: new Set<string>(), B: new Set<string>() };
    const rc: Record<TeamId, Counts> = { A: { V: 0, D: 0, S: 0 }, B: { V: 0, D: 0, S: 0 } };
    const tg = {
      A: roleTargets(activeOn("A"), mode, rules.customRatio),
      B: roleTargets(activeOn("B"), mode, rules.customRatio),
    };
    for (const i of fixed) {
      const h = byId.get(players[i].hero!);
      if (!h) continue;
      const t = teamOf(i);
      used[t].add(h.id);
      if (useMode) countRole(rc[t], tg[t], players[i].heroRole || h.role, mode, rng);
    }
    const res: Record<number, Pick> = {};
    let ok = true;
    const order = [...targets].sort(() => rng() - 0.5);
    for (const i of order) {
      const t = teamOf(i);
      const pEx = new Set(excl.p[i] || []);
      const rl = players[i].rolePref || roleLock[i] || "";
      const pool = heroes.filter(
        (h) =>
          !gameEx.has(h.id) &&
          !teamEx[t].has(h.id) &&
          !pEx.has(h.id) &&
          (!rules.uniquePerTeam || !used[t].has(h.id)) &&
          (rules.crossTeamDuplicates || (!used.A.has(h.id) && !used.B.has(h.id))) &&
          (!rl || h.role === rl || h.role === "M") &&
          (!useMode || roleFits(rc[t], tg[t], h.role, mode)),
      );
      if (!pool.length) {
        ok = false;
        break;
      }
      const h = pool[Math.floor(rng() * pool.length)];
      let ar: HeroRole = h.role;
      if (h.role === "M") {
        if (rl) ar = rl;
        else if (useMode) {
          const opts = ROLES.filter((r) => roleFits(rc[t], tg[t], r, mode));
          ar = opts.length ? opts[Math.floor(rng() * opts.length)] : "D";
        } else ar = ROLES[Math.floor(rng() * 3)];
      }
      used[t].add(h.id);
      if (useMode) countRole(rc[t], tg[t], ar, mode, rng);
      res[i] = { id: h.id, role: ar };
    }
    if (ok) return { picks: res };
  }
  return { error: "NO VALID COMBINATION — LOOSEN EXCLUSIONS OR TOGGLES" };
}
