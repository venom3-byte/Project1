const { app, BrowserWindow } = require("electron");
const path = require("node:path");
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: "#06101d",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "forge-web")
    : path.resolve(__dirname, "../../dist/forge-web");
  win.loadFile(path.join(base, "index.html"));
  win.once("ready-to-show", () => win.show());
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
