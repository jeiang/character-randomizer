// Scrapes the official heroes page into site/heroes.json + site/img/.
// Run from the repo root: node scripts/update.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const PAGE = "https://www.marvelrivals.com/heroes";
const ROLES = ["vanguard", "duelist", "strategist"];

if (!existsSync("site")) {
  console.error("run from the repo root (site/ not found)");
  process.exit(1);
}

const res = await fetch(PAGE);
if (!res.ok) throw new Error(`GET ${PAGE} -> ${res.status}`);
const html = await res.text();

interface Hero {
  name: string;
  slug: string;
  roles: string[];
  head: string;
  portrait: string;
}

const heroes: Hero[] = [];
for (const [, attrs, body] of html.matchAll(/<a\b([^>]*\bdata-name="[^>]*)>(.*?)<\/a>/gs)) {
  const rawName = attrs.match(/data-name="([^"]+)"/)?.[1];
  const tag = attrs.match(/data-tag="([^"]+)"/)?.[1];
  // the site flips between src="..." and src='...' between deploys; accept both
  const imgs = [...body.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
  if (!rawName || !tag || imgs.length < 2) throw new Error(`bad hero block: ${attrs}`);

  const roles = tag.toLowerCase().split(/\s+/).filter((r) => ROLES.includes(r));
  if (!roles.length) throw new Error(`no known role for ${rawName}: ${tag}`);

  // data-name casing is inconsistent ("IRON MAN", "The Hood"); title-case the all-caps ones
  const name =
    rawName === rawName.toUpperCase()
      ? rawName.toLowerCase().replace(/(^|[\s\-&(.])\w/g, (c) => c.toUpperCase())
      : rawName;
  const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  heroes.push({ name, slug, roles, head: imgs[0], portrait: imgs[1] });
}

// guard against a silent markup change producing a garbage roster
if (heroes.length < 40) throw new Error(`only ${heroes.length} heroes parsed, markup changed?`);
if (new Set(heroes.map((h) => h.slug)).size !== heroes.length) throw new Error("duplicate slugs");

mkdirSync("site/img", { recursive: true });
for (const h of heroes) {
  for (const [url, file] of [
    [h.head, `site/img/${h.slug}-head.png`],
    [h.portrait, `site/img/${h.slug}-portrait.png`],
  ]) {
    const img = await fetch(url);
    if (!img.ok) throw new Error(`GET ${url} -> ${img.status}`);
    writeFileSync(file, Buffer.from(await img.arrayBuffer()));
  }
}

heroes.sort((a, b) => a.name.localeCompare(b.name));
const json = heroes.map(({ name, slug, roles }) => ({ name, slug, roles }));
writeFileSync("site/heroes.json", JSON.stringify(json, null, 2) + "\n");
console.log(`wrote ${heroes.length} heroes`);

// season label for the site header: highest "Season N" mentioned in the homepage news feed.
// cosmetic, so a failed scrape only warns and keeps the committed site/meta.json
try {
  const home = await (await fetch("https://www.marvelrivals.com/")).text();
  const seasons = [...home.matchAll(/Season (\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
  if (!seasons.length) throw new Error("no season found on homepage");
  const season = String(Math.max(...seasons));
  writeFileSync("site/meta.json", JSON.stringify({ season }) + "\n");
  console.log(`season ${season}`);
} catch (e) {
  console.warn(`season scrape failed, keeping site/meta.json: ${e}`);
}
