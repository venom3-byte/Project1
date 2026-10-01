const path = require("node:path");
module.exports = {
  packagerConfig: {
    asar: true,
    name: "ForgeGame",
    executableName: "ForgeGame",
    extraResource: [path.resolve(__dirname, "../../dist/forge-web")]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "ForgeGame",
        setupExe: "ForgeGameSetup.exe",
        shortcutName: "Forge Game",
        description: "Forge Game Runtime",
        authors: "Forge Studio"
      }
    },
    { name: "@electron-forge/maker-zip", platforms: ["win32"] }
  ]
};
