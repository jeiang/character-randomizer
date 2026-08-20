# Rivals Roulette

Static web app that assigns random [Marvel Rivals](https://www.marvelrivals.com) heroes to
two teams of up to 6 players. Per player: reroll (keeps role class), lock, ban, role
preference, team swap. Role-composition limits (2-2-2, 2 Strat + 4 Flex, or a custom
V-D-S ratio), unique-per-team, and hero exclusions scoped game-wide, per team, or per
player. Settings and the last roll persist in localStorage.

Hero data (`site/heroes.json` + portraits in `site/img/`) is scraped from the official
heroes page and committed. A weekly GitHub Actions run refreshes it; manually:

```bash
nix run .#update
```

(or `node scripts/update.ts` from the repo root). Roll-logic self-check:
`node scripts/roll.test.ts`.

## Development

```bash
nix develop        # node + tsc
tsc                # compiles src/ into site/
python3 -m http.server -d site
```

## NixOS

```nix
{
  inputs.rivals-randomizer.url = "github:jeiang/character-randomizer";

  # in a host, with the module imported:
  services.rivals-randomizer = {
    enable = true;
    domain = "rivals.example.com"; # existing Caddy setup gets a vhost serving the site
  };
}
```

Or skip the module and point any web server at `packages.<system>.default`.

Hero names and images belong to NetEase/Marvel; this is an unaffiliated fan tool.
