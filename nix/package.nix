{lib, fetchurl, stdenvNoCC}:
let
  sources = builtins.fromJSON (builtins.readFile ./sources.json);

  assetBySystem = {
    aarch64-darwin = "slacki-darwin-arm64";
    x86_64-darwin = "slacki-darwin-x64";
    aarch64-linux = "slacki-linux-arm64";
    x86_64-linux = "slacki-linux-x64";
  };

  system = stdenvNoCC.hostPlatform.system;

  asset =
    assetBySystem.${system}
    or (throw "slacki: unsupported system '${system}'");

  hash =
    sources.hashes.${system}
    or (throw "slacki: missing hash for system '${system}' in nix/sources.json");
in
  stdenvNoCC.mkDerivation {
    pname = "slacki";
    inherit (sources) version;

    src = fetchurl {
      url = "https://github.com/codealisha99/slacki/releases/download/v${sources.version}/${asset}";
      inherit hash;
    };

    dontUnpack = true;

    installPhase = ''
      runHook preInstall
      install -Dm755 "$src" "$out/bin/slacki"
      runHook postInstall
    '';

    meta = {
      description = "Slack automation CLI for AI agents";
      homepage = "https://github.com/codealisha99/slacki";
      license = lib.licenses.mit;
      platforms = builtins.attrNames assetBySystem;
      mainProgram = "slacki";
      sourceProvenance = with lib.sourceTypes; [binaryNativeCode];
    };
  }
