{
  description = "Marvel Rivals team randomizer (static site)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = f: nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
        (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.stdenvNoCC.mkDerivation {
          pname = "rivals-randomizer";
          version = "0.1.0";
          src = ./.;
          nativeBuildInputs = [ pkgs.typescript ];
          buildPhase = "tsc";
          # Fingerprint mutable assets so CDN/browser caches can never pair a
          # fresh index.html with a stale script or stylesheet.
          installPhase = ''
            cp -r site $out
            chmod -R u+w $out

            fingerprint() {
              local file=$1 hash renamed
              hash=$(sha256sum "$out/$file" | cut -c1-8)
              renamed="''${file%.*}.$hash.''${file##*.}"
              mv "$out/$file" "$out/$renamed"
              echo "$renamed"
            }

            roll=$(fingerprint roll.js)
            sed -i "s|\./roll\.js|./$roll|" $out/app.js

            app=$(fingerprint app.js)
            css=$(fingerprint style.css)
            sed -i "s|app\.js|$app|; s|style\.css|$css|" $out/index.html
          '';
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.typescript ];
        };
      });

      apps = forAllSystems (pkgs: {
        # run from the repo root: refreshes site/heroes.json and site/img/
        update = {
          type = "app";
          program = toString (pkgs.writeShellScript "update-heroes" ''
            exec ${pkgs.nodejs_24}/bin/node ${./scripts/update.ts}
          '');
        };
      });

      nixosModules.default = { config, lib, pkgs, ... }:
        let cfg = config.services.rivals-randomizer;
        in {
          options.services.rivals-randomizer = {
            enable = lib.mkEnableOption "Marvel Rivals team randomizer behind Caddy";
            domain = lib.mkOption {
              type = lib.types.str;
              description = "Caddy virtual host serving the site";
              example = "rivals.example.com";
            };
          };
          config = lib.mkIf cfg.enable {
            services.caddy.virtualHosts.${cfg.domain}.extraConfig = ''
              root * ${self.packages.${pkgs.stdenv.hostPlatform.system}.default}
              file_server
            '';
          };
        };
    };
}
