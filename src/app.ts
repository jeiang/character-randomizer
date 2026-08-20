import {
  assign,
  teamOf,
  type Exclusions,
  type Hero,
  type HeroRole,
  type Player,
  type Role,
  type RoleMode,
  type Rules,
} from "./roll.js";

const ROLE_NAMES: Record<HeroRole, string> = { V: "Vanguard", D: "Duelist", S: "Strategist", M: "Multi-Role" };
const ROLE_ORDER: Record<HeroRole, number> = { V: 0, D: 1, S: 2, M: 3 };
const STORAGE_KEY = "mr-hero-roulette";
const HELP_KEY = "rr-help-seen";
const CROSS_TEAM_DUPLICATES = true;
const REVEAL_SPIN = true;
const TEAM_A = [0, 1, 2, 3, 4, 5];
const TEAM_B = [6, 7, 8, 9, 10, 11];
const ALL = [...TEAM_A, ...TEAM_B];

interface RawHero {
  name: string;
  slug: string;
  roles: string[];
}

const ROLE_CODE: Record<string, Role> = { vanguard: "V", duelist: "D", strategist: "S" };
const raw: RawHero[] = await (await fetch("heroes.json")).json();
const meta: { season?: string } = await fetch("meta.json")
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}));
const heroes: Hero[] = raw.map((h) => ({
  id: h.slug,
  name: h.name,
  role: h.roles.length > 1 ? "M" : ROLE_CODE[h.roles[0]],
}));
const byId = new Map(heroes.map((h) => [h.id, h]));
// preload heads so the roll animation never shows a stale image
for (const h of heroes) new Image().src = `img/${h.id}-head.png`;

// --- state ---

interface State {
  players: Player[];
  excl: Exclusions;
  roleMode: RoleMode;
  uniquePerTeam: boolean;
  customRatio: Record<Role, number>;
}

function freshState(): State {
  return {
    players: ALL.map((i) => ({ name: `Player ${i + 1}`, active: true, hero: null, locked: false, rolePref: "" })),
    excl: { game: [], A: [], B: [], p: {} },
    roleMode: "off",
    uniquePerTeam: true,
    customRatio: { V: 2, D: 2, S: 2 },
  };
}

let state = freshState();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
  state = {
    ...state,
    ...saved,
    excl: { ...state.excl, ...(saved.excl ?? {}) },
    customRatio: { ...state.customRatio, ...(saved.customRatio ?? {}) },
  };
  state.players = ALL.map((i) => ({ ...freshState().players[i], ...(saved.players?.[i] ?? {}) }));
} catch {
  /* first visit or garbage; keep defaults */
}
// drop heroes that no longer exist in the data
const known = (ids: string[]) => ids.filter((id) => byId.has(id));
state.excl.game = known(state.excl.game);
state.excl.A = known(state.excl.A);
state.excl.B = known(state.excl.B);
for (const k of Object.keys(state.excl.p)) state.excl.p[+k] = known(state.excl.p[+k]);
for (const p of state.players) if (p.hero && !byId.has(p.hero)) (p.hero = null), (p.locked = false);

// transient ui state
const ui = {
  settings: false,
  drawer: false,
  help: false,
  scope: "game" as "game" | "A" | "B" | "p",
  scopePlayer: 0,
  search: "",
  spin: {} as Record<number, string>,
};

function save(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function rules(): Rules {
  return {
    roleMode: state.roleMode,
    uniquePerTeam: state.uniquePerTeam,
    customRatio: state.customRatio,
    crossTeamDuplicates: CROSS_TEAM_DUPLICATES,
  };
}

function totalExcl(): number {
  return (
    state.excl.game.length +
    state.excl.A.length +
    state.excl.B.length +
    Object.values(state.excl.p).reduce((n, a) => n + a.length, 0)
  );
}

function initials(name: string): string {
  const w = name.split(/[^A-Za-z0-9]+/).filter((x) => x && !["the", "of", "and"].includes(x.toLowerCase()));
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? w[0]?.[1] ?? "")).toUpperCase();
}

// --- toast ---

const toastEl = document.getElementById("toast")!;
let toastTimer = 0;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
}

// --- rolling ---

const spinTimers: number[] = [];
function roll(idxs: number[]): void {
  const roleLock: Record<number, Role> = {};
  if (idxs.length === 1) {
    // single reroll keeps the player's current role class (Multi-Role picks resolved to one)
    const p = state.players[idxs[0]];
    const h = p.hero ? byId.get(p.hero) : null;
    const r = p.heroRole || h?.role;
    if (r && r !== "M") roleLock[idxs[0]] = r;
  }
  const res = assign(state.players, heroes, state.excl, rules(), idxs, roleLock);
  if ("error" in res) {
    toast(res.error);
    return;
  }
  const keys = Object.keys(res.picks).map(Number);
  for (const i of keys) {
    state.players[i].hero = res.picks[i].id;
    state.players[i].heroRole = res.picks[i].role;
  }
  update();
  if (!REVEAL_SPIN) return;
  spinTimers.forEach(clearTimeout);
  spinTimers.length = 0;
  keys.forEach((i, k) => {
    const iv = setInterval(() => {
      ui.spin[i] = heroes[Math.floor(Math.random() * heroes.length)].id;
      renderRows();
    }, 65);
    spinTimers.push(
      iv,
      setTimeout(() => {
        clearInterval(iv);
        delete ui.spin[i];
        renderRows();
      }, 600 + k * 110),
    );
  });
}

// --- rendering ---

const rowsA = document.getElementById("rows-a")!;
const rowsB = document.getElementById("rows-b")!;
const overlayRoot = document.getElementById("overlay-root")!;

function playerRow(i: number): HTMLElement {
  const p = state.players[i];
  if (!p.active) {
    const btn = document.createElement("button");
    btn.className = "add-player";
    btn.textContent = "+ ADD PLAYER";
    btn.onclick = () => {
      p.active = true;
      update();
    };
    return btn;
  }
  const spinId = ui.spin[i];
  const h = spinId != null ? byId.get(spinId)! : p.hero ? byId.get(p.hero)! : null;
  const er = h ? (spinId == null && h.role === "M" && p.heroRole ? p.heroRole : h.role) : null;

  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <div class="icon"></div>
    <div class="mid">
      <input class="pname" placeholder="Player name">
      <div class="sub"></div>
    </div>
    <div class="controls">
      <select class="ctl" title="Role preference for this player">
        <option value="">ANY</option><option value="V">VANG</option><option value="D">DUEL</option><option value="S">STRAT</option>
      </select>
      <button class="ctl glyph reroll" title="Reroll this player (same class)">&#10227;</button>
      <button class="ctl glyph move" title="Move to other team">&#8644;</button>
      <button class="ctl lock" title="Lock this pick"></button>
      <button class="ctl ban" title="Ban this hero for this player and reroll">BAN</button>
      <button class="ctl rm" title="Remove player">&#215;</button>
    </div>`;

  const icon = row.querySelector<HTMLElement>(".icon")!;
  const sub = row.querySelector<HTMLElement>(".sub")!;
  if (h) {
    const init = document.createElement("div");
    init.className = "initials";
    init.textContent = initials(h.name);
    const head = document.createElement("div");
    head.className = "head";
    head.role = "img";
    head.ariaLabel = h.name;
    head.style.backgroundImage = `url('img/${h.id}-head.png')`;
    icon.append(init, head);
    sub.className = "hero-line";
    const name = document.createElement("div");
    name.className = "hero-name";
    name.textContent = h.name;
    const tag = document.createElement("div");
    tag.className = `role-tag rc-${er}`;
    tag.textContent = ROLE_NAMES[er!].toUpperCase();
    sub.append(name, tag);
  } else {
    icon.innerHTML = `<div class="q">?</div>`;
    sub.className = "awaiting";
    sub.textContent = "AWAITING ASSIGNMENT";
  }

  const nameInput = row.querySelector<HTMLInputElement>(".pname")!;
  nameInput.value = p.name;
  nameInput.onchange = () => {
    p.name = nameInput.value;
    save();
  };
  const pref = row.querySelector<HTMLSelectElement>("select")!;
  pref.value = p.rolePref;
  pref.onchange = () => {
    p.rolePref = pref.value as Player["rolePref"];
    save();
  };
  row.querySelector<HTMLButtonElement>(".reroll")!.onclick = () => roll([i]);
  row.querySelector<HTMLButtonElement>(".move")!.onclick = () => {
    const other = i < 6 ? TEAM_B : TEAM_A;
    const j = other.find((k) => !state.players[k].active);
    if (j == null) {
      toast("OTHER TEAM IS FULL");
      return;
    }
    state.players[j] = { ...p };
    state.players[i] = { name: `Player ${i + 1}`, active: false, hero: null, locked: false, rolePref: "" };
    if (state.excl.p[i]) {
      state.excl.p[j] = state.excl.p[i];
      delete state.excl.p[i];
    }
    update();
  };
  const lock = row.querySelector<HTMLButtonElement>(".lock")!;
  lock.textContent = p.locked ? "LOCKED" : "LOCK";
  lock.classList.toggle("locked", p.locked);
  lock.onclick = () => {
    if (!p.hero) {
      toast("ROLL A HERO FIRST");
      return;
    }
    p.locked = !p.locked;
    update();
  };
  row.querySelector<HTMLButtonElement>(".ban")!.onclick = () => {
    if (!p.hero) {
      toast("NO HERO TO BAN");
      return;
    }
    state.excl.p[i] = [...new Set([...(state.excl.p[i] ?? []), p.hero])];
    save();
    roll([i]);
  };
  row.querySelector<HTMLButtonElement>(".rm")!.onclick = () => {
    p.active = false;
    p.hero = null;
    p.locked = false;
    update();
  };
  return row;
}

function renderRows(): void {
  rowsA.replaceChildren(...TEAM_A.map(playerRow));
  rowsB.replaceChildren(...TEAM_B.map(playerRow));
}

function roleModeShort(): string {
  const c = state.customRatio;
  return { off: "OFF", "222": "2-2-2", "2s": "2 STRAT + 4 FLEX", custom: `${c.V}-${c.D}-${c.S} CUSTOM` }[state.roleMode];
}

function renderStatus(): void {
  document.getElementById("roster-info")!.textContent =
    (meta.season ? `S${meta.season} ROSTER · ` : "") + `${heroes.length} HEROES`;
  document.getElementById("status-lobby")!.textContent = `${state.players.filter((p) => p.active).length} / 12`;
  document.getElementById("status-roles")!.textContent = roleModeShort();
  document.getElementById("status-excl")!.textContent = String(totalExcl());
}

function segBtn(label: string, active: boolean, onclick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "seg-btn" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function drawerShell(title: string, cls: string, onClose: () => void): [HTMLElement, HTMLElement] {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.onclick = onClose;
  const drawer = document.createElement("div");
  drawer.className = `drawer ${cls}`;
  drawer.innerHTML = `
    <div class="drawer-head">
      <div class="drawer-title"></div>
      <button class="drawer-close">&#215;</button>
    </div>`;
  drawer.querySelector(".drawer-title")!.textContent = title;
  drawer.querySelector<HTMLButtonElement>(".drawer-close")!.onclick = onClose;
  overlayRoot.append(overlay, drawer);
  return [overlay, drawer];
}

function renderSettings(): void {
  const close = () => {
    ui.settings = false;
    renderOverlays();
  };
  const [, drawer] = drawerShell("SETTINGS", "settings", close);
  const secs = document.createElement("div");
  secs.className = "secs";

  const sec = (title: string): HTMLElement => {
    const s = document.createElement("div");
    s.className = "sec";
    if (title) s.innerHTML = `<div class="sec-title"></div>`;
    if (title) s.querySelector(".sec-title")!.textContent = title;
    return s;
  };
  const hint = (text: string): HTMLElement => {
    const d = document.createElement("div");
    d.className = "hint";
    d.textContent = text;
    return d;
  };

  const roleSec = sec("ROLE LIMIT");
  const seg = document.createElement("div");
  seg.className = "seg";
  const modes: [RoleMode, string][] = [["off", "OFF"], ["222", "2-2-2"], ["2s", "2S + 4F"], ["custom", "CUSTOM"]];
  for (const [k, label] of modes)
    seg.appendChild(
      segBtn(label, state.roleMode === k, () => {
        state.roleMode = k;
        update();
        renderOverlays();
      }),
    );
  roleSec.appendChild(seg);
  if (state.roleMode === "custom") {
    const ratio = document.createElement("div");
    ratio.className = "ratio";
    const labels: [Role, string][] = [["V", "VANGUARD"], ["D", "DUELIST"], ["S", "STRATEGIST"]];
    for (const [k, label] of labels) {
      const cell = document.createElement("div");
      cell.innerHTML = `<div class="ratio-label"></div><input type="number" min="0" max="6">`;
      cell.querySelector(".ratio-label")!.textContent = label;
      const input = cell.querySelector("input")!;
      input.value = String(state.customRatio[k]);
      input.onchange = () => {
        state.customRatio[k] = Math.max(0, Math.min(6, Math.floor(+input.value || 0)));
        update();
        renderOverlays();
      };
      ratio.appendChild(cell);
    }
    roleSec.appendChild(ratio);
    const sum = state.customRatio.V + state.customRatio.D + state.customRatio.S;
    roleSec.appendChild(hint(`Totals ${sum} — must match each team's player count when rolling.`));
  }
  roleSec.appendChild(hint("2-2-2 keeps exactly 2 strategists (teams of 4–6); the rest flex, max 2 per role."));

  const uniqueSec = sec("UNIQUE PER TEAM");
  const uniqueBtn = document.createElement("button");
  uniqueBtn.className = "toggle-btn" + (state.uniquePerTeam ? " active" : "");
  uniqueBtn.textContent = state.uniquePerTeam ? "ON" : "OFF";
  uniqueBtn.onclick = () => {
    state.uniquePerTeam = !state.uniquePerTeam;
    update();
    renderOverlays();
  };
  uniqueSec.append(uniqueBtn, hint("No duplicate heroes within the same team."));

  const exclSec = sec("EXCLUSIONS");
  const manage = document.createElement("button");
  manage.className = "manage-btn";
  manage.textContent = `MANAGE EXCLUSIONS (${totalExcl()})`;
  manage.onclick = () => {
    ui.settings = false;
    ui.drawer = true;
    renderOverlays();
  };
  exclSec.append(manage, hint("Ban heroes game-wide, per team, or per player."));

  const picksSec = sec("PICKS");
  const clear = document.createElement("button");
  clear.className = "outline-btn wide";
  clear.textContent = "CLEAR ALL PICKS";
  clear.onclick = () => {
    for (const p of state.players) (p.hero = null), (p.locked = false);
    update();
  };
  picksSec.appendChild(clear);

  const helpSec = document.createElement("div");
  helpSec.className = "sec-divider";
  const helpBtn = document.createElement("button");
  helpBtn.className = "instructions-btn";
  helpBtn.textContent = "VIEW INSTRUCTIONS";
  helpBtn.onclick = () => {
    ui.help = true;
    renderOverlays();
  };
  helpSec.appendChild(helpBtn);

  secs.append(roleSec, uniqueSec, exclSec, picksSec, helpSec);
  drawer.appendChild(secs);
}

function scopeList(): string[] {
  return ui.scope === "p" ? (state.excl.p[ui.scopePlayer] ?? []) : state.excl[ui.scope];
}

function renderExclusions(): void {
  const close = () => {
    ui.drawer = false;
    ui.search = "";
    renderOverlays();
  };
  const [, drawer] = drawerShell("EXCLUSIONS", "excl", close);

  const note = document.createElement("div");
  note.className = "drawer-note";
  note.textContent = "Excluded heroes are never assigned within the selected scope. Click a hero to toggle.";

  const seg = document.createElement("div");
  seg.className = "seg";
  seg.style.padding = "0 20px 10px";
  const scopes: [typeof ui.scope, string][] = [["game", "GAME"], ["A", "TEAM 1"], ["B", "TEAM 2"], ["p", "PLAYER"]];
  for (const [k, label] of scopes)
    seg.appendChild(
      segBtn(label, ui.scope === k, () => {
        ui.scope = k;
        renderOverlays();
      }),
    );

  drawer.append(note, seg);

  if (ui.scope === "p") {
    const wrap = document.createElement("div");
    wrap.style.padding = "0 20px 10px";
    const sel = document.createElement("select");
    sel.className = "dark-input";
    state.players.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${p.name} — Team ${i < 6 ? "1" : "2"}${p.active ? "" : " (removed)"}`;
      sel.appendChild(o);
    });
    sel.value = String(ui.scopePlayer);
    sel.onchange = () => {
      ui.scopePlayer = +sel.value;
      renderOverlays();
    };
    wrap.appendChild(sel);
    drawer.appendChild(wrap);
  }

  const searchWrap = document.createElement("div");
  searchWrap.style.padding = "0 20px 12px";
  const search = document.createElement("input");
  search.className = "dark-input";
  search.placeholder = "Search heroes…";
  search.value = ui.search;
  searchWrap.appendChild(search);

  const scroll = document.createElement("div");
  scroll.className = "chips-scroll";
  const chips = document.createElement("div");
  chips.className = "chips";
  scroll.appendChild(chips);

  const foot = document.createElement("div");
  foot.className = "drawer-foot";
  const count = document.createElement("div");
  count.className = "excl-count";
  const clearBtn = document.createElement("button");
  clearBtn.className = "outline-btn";
  clearBtn.textContent = "CLEAR SCOPE";
  foot.append(count, clearBtn);

  const renderChips = () => {
    const exSet = new Set(scopeList());
    const q = ui.search.trim().toLowerCase();
    chips.replaceChildren(
      ...heroes
        .filter((h) => !q || h.name.toLowerCase().includes(q))
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
        .map((h) => {
          const chip = document.createElement("button");
          chip.className = "chip" + (exSet.has(h.id) ? " excluded" : "");
          const dot = document.createElement("span");
          dot.className = `dot rc-${h.role}`;
          chip.append(dot, document.createTextNode(h.name));
          chip.onclick = () => {
            const list = scopeList();
            const next = list.includes(h.id) ? list.filter((x) => x !== h.id) : [...list, h.id];
            if (ui.scope === "p") state.excl.p[ui.scopePlayer] = next;
            else state.excl[ui.scope] = next;
            update();
            renderChips();
          };
          return chip;
        }),
    );
    count.textContent = `${scopeList().length} EXCLUDED IN THIS SCOPE`;
  };
  // re-render only the chip grid on input so the search box keeps focus
  search.oninput = () => {
    ui.search = search.value;
    renderChips();
  };
  clearBtn.onclick = () => {
    if (ui.scope === "p") state.excl.p[ui.scopePlayer] = [];
    else state.excl[ui.scope] = [];
    update();
    renderChips();
  };
  renderChips();
  drawer.append(searchWrap, scroll, foot);
}

function renderHelp(): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const steps = [
    "Add up to 6 players per team and type their names on each card.",
    "Hit ROLL ALL TEAMS — or a team's ROLL TEAM — to assign random heroes.",
    "Per player: pick a role preference, ⟳ reroll, ⇄ swap teams, LOCK to keep a pick through rerolls, or BAN a hero for that player.",
    "Open SETTINGS for role limits (2-2-2 or 2 Strat + 4 Flex), unique-per-team, and hero exclusions.",
    "Everything is saved in your browser — CLEAR ALL PICKS in settings resets the board.",
  ];
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">HOW TO USE</div>
        <div class="modal-chip">RIVALS ROULETTE</div>
      </div>
      <div class="steps">${steps.map((_, i) => `<div class="step"><div class="num">${i + 1}</div><div class="step-text"></div></div>`).join("")}</div>
      <div class="modal-foot"><button class="gotit">GOT IT</button></div>
    </div>`;
  overlay.querySelectorAll<HTMLElement>(".step-text").forEach((el, i) => (el.textContent = steps[i]));
  overlay.querySelector<HTMLButtonElement>(".gotit")!.onclick = () => {
    localStorage.setItem(HELP_KEY, "1");
    ui.help = false;
    renderOverlays();
  };
  overlayRoot.appendChild(overlay);
}

function renderOverlays(): void {
  overlayRoot.replaceChildren();
  if (ui.settings) renderSettings();
  if (ui.drawer) renderExclusions();
  if (ui.help) renderHelp();
}

function update(): void {
  save();
  renderStatus();
  renderRows();
}

// --- wire up ---

document.getElementById("roll-all")!.onclick = () => roll(ALL);
document.getElementById("roll-a")!.onclick = () => roll(TEAM_A);
document.getElementById("roll-b")!.onclick = () => roll(TEAM_B);
document.getElementById("open-settings")!.onclick = () => {
  ui.settings = true;
  renderOverlays();
};

update();
if (!localStorage.getItem(HELP_KEY)) {
  ui.help = true;
  renderOverlays();
}
