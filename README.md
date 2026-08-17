# Rivals Randomizer

Static web app that rolls random [Marvel Rivals](https://www.marvelrivals.com) teams.
Set Vanguard / Duelist / Strategist / Flex counts per team (team size is the sum, up to 6),
ban heroes from the pool, pin specific heroes to a team, re-roll single slots. Settings and
the last roll persist in localStorage.

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
