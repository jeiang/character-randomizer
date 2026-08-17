import {
  canFill,
  fillTeam,
  rerollSlot,
  ROLES,
  SLOT_ROLES,
  type Hero,
  type Role,
  type Slot,
  type SlotRole,
} from "./roll.js";

const MAX_TEAM = 6;
const STORAGE_KEY = "rivals-randomizer";

interface Team {
  counters: Record<SlotRole, number>;
  slots: Slot[];
}

interface State {
  teams: [Team, Team];
  banned: string[];
}

const heroes: Hero[] = await (await fetch("heroes.json")).json();
const bySlug = new Map(heroes.map((h) => [h.slug, h]));

function emptyTeam(): Team {
  return { counters: { vanguard: 0, duelist: 0, strategist: 0, flex: 0 }, slots: [] };
}

let state: State = { teams: [emptyTeam(), emptyTeam()], banned: [] };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
  if (Array.isArray(saved.teams) && saved.teams.length === 2) state = saved;
} catch {
  /* first visit or garbage; keep defaults */
}
// drop heroes that no longer exist in the data
state.banned = state.banned.filter((s) => bySlug.has(s));
for (const t of state.teams)
  for (const s of t.slots) if (s.hero && !bySlug.has(s.hero)) (s.hero = null), (s.pinned = false);

const banned = new Set(state.banned);
const rng = Math.random;

function save(): void {
  state.banned = [...banned];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function teamSize(t: Team): number {
  return SLOT_ROLES.reduce((n, r) => n + t.counters[r], 0);
}

/** Make slots match counters, preferring to keep filled/pinned slots. */
function reconcile(t: Team): void {
  const next: Slot[] = [];
  for (const role of SLOT_ROLES) {
    const existing = t.slots
      .filter((s) => s.role === role)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.hero !== null) - Number(a.hero !== null));
    for (let i = 0; i < t.counters[role]; i++) next.push(existing[i] ?? { role, hero: null, pinned: false });
  }
  t.slots = next;
}

/** Pin a hero onto a team: reuse a free compatible slot or grow the team. */
function pin(team: Team, hero: Hero): void {
  const already = team.slots.find((s) => s.hero === hero.slug);
  if (already) {
    already.hero = null;
    already.pinned = false;
    return;
  }
  const free = team.slots
    .filter((s) => !s.hero && canFill(hero, s.role))
    .sort((a, b) => Number(a.role === "flex") - Number(b.role === "flex"))[0];
  if (free) {
    free.hero = hero.slug;
    free.pinned = true;
    return;
  }
  if (teamSize(team) >= MAX_TEAM) return;
  const role: SlotRole = hero.roles.length > 1 ? "flex" : hero.roles[0];
  team.counters[role]++;
  reconcile(team);
  const slot = team.slots.find((s) => s.role === role && !s.hero)!;
  slot.hero = hero.slug;
  slot.pinned = true;
}

function toggleBan(hero: Hero): void {
  if (banned.has(hero.slug)) {
    banned.delete(hero.slug);
  } else {
    banned.add(hero.slug);
    for (const t of state.teams)
      for (const s of t.slots) if (s.hero === hero.slug) (s.hero = null), (s.pinned = false);
  }
}

// --- rendering ---

const teamsEl = document.getElementById("teams")!;
const gridEl = document.getElementById("grid")!;

function slotCard(team: Team, slot: Slot): HTMLElement {
  const el = document.createElement("div");
  el.className = `slot ${slot.role}` + (slot.pinned ? " pinned" : "");
  const hero = slot.hero ? bySlug.get(slot.hero) : undefined;
  if (hero) {
    el.innerHTML = `
      <img src="img/${hero.slug}-portrait.png" alt="${hero.name}">
      <span class="name">${hero.name}</span>
      <span class="role">${slot.pinned ? "📌 " : ""}${slot.role}</span>
      <span class="actions">
        <button class="reroll" title="Re-roll this slot">🎲</button>
        <button class="clear" title="Clear this slot">✕</button>
      </span>`;
    el.querySelector<HTMLButtonElement>(".reroll")!.onclick = () => {
      rerollSlot(slot, team.slots, heroes, banned, rng);
      update();
    };
    el.querySelector<HTMLButtonElement>(".clear")!.onclick = () => {
      slot.hero = null;
      slot.pinned = false;
      update();
    };
  } else {
    el.classList.add("empty");
    el.innerHTML = `<span class="placeholder">?</span><span class="role">${slot.role}</span>`;
  }
  return el;
}

function counterRow(team: Team): HTMLElement {
  const row = document.createElement("div");
  row.className = "counters";
  for (const role of SLOT_ROLES) {
    const label = document.createElement("label");
    label.className = role;
    label.textContent = role.slice(0, 4);
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_TEAM);
    input.value = String(team.counters[role]);
    input.onchange = () => {
      const v = Math.max(0, Math.floor(Number(input.value) || 0));
      const others = teamSize(team) - team.counters[role];
      team.counters[role] = Math.min(v, MAX_TEAM - others);
      reconcile(team);
      update();
    };
    label.appendChild(input);
    row.appendChild(label);
  }
  return row;
}

function renderTeams(): void {
  teamsEl.replaceChildren();
  state.teams.forEach((team, i) => {
    const panel = document.createElement("div");
    panel.className = "team";
    const h2 = document.createElement("h2");
    h2.textContent = `Team ${i + 1}`;
    panel.append(h2, counterRow(team));
    const slots = document.createElement("div");
    slots.className = "slots";
    for (const slot of team.slots) slots.appendChild(slotCard(team, slot));
    panel.appendChild(slots);
    teamsEl.appendChild(panel);
  });
}

function renderGrid(): void {
  gridEl.replaceChildren();
  const groups: [string, Hero[]][] = [
    ...ROLES.map((r): [string, Hero[]] => [r, heroes.filter((h) => h.roles.length === 1 && h.roles[0] === r)]),
    ["flex", heroes.filter((h) => h.roles.length > 1)],
  ];
  for (const [title, group] of groups) {
    const section = document.createElement("section");
    section.innerHTML = `<h3 class="${title}">${title}</h3>`;
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const hero of group) {
      const card = document.createElement("div");
      card.className = "card" + (banned.has(hero.slug) ? " banned" : "");
      card.innerHTML = `
        <img src="img/${hero.slug}-head.png" alt="${hero.name}" title="${hero.name}">
        <span class="name">${hero.name}</span>
        <span class="pins"><button>1</button><button>2</button></span>`;
      card.querySelector("img")!.onclick = () => {
        toggleBan(hero);
        update();
      };
      card.querySelectorAll("button").forEach((btn, i) => {
        btn.onclick = () => {
          pin(state.teams[i], hero);
          update();
        };
      });
      cards.appendChild(card);
    }
    section.appendChild(cards);
    gridEl.appendChild(section);
  }
}

function update(): void {
  save();
  renderTeams();
  renderGrid();
}

document.getElementById("roll")!.onclick = () => {
  for (const team of state.teams) fillTeam(team.slots, heroes, banned, rng);
  update();
};
document.getElementById("clear")!.onclick = () => {
  for (const team of state.teams)
    for (const s of team.slots) (s.hero = null), (s.pinned = false);
  update();
};

for (const t of state.teams) reconcile(t);
update();
