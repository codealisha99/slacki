{
  description = "slacki: Slack automation CLI for AI agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
      slacki = pkgs.callPackage ./nix/package.nix {};
    in {
      packages = {
        inherit slacki;
        default = slacki;
      };

      apps = {
        default = flake-utils.lib.mkApp {
          drv = slacki;
          name = "slacki";
        };
      };
    });
}
