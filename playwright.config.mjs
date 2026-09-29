import{defineConfig,devices}from"@playwright/test";
export default defineConfig({
  fullyParallel:true,
  workers:4,
  reporter:[["list"],["html",{outputFolder:"playwright-report",open:"never"}]],
  testDir:"./tests",
  timeout:60000,
  use:{baseURL:"http://127.0.0.1:4173",trace:"retain-on-failure",screenshot:"only-on-failure"},
  webServer:{command:"node server.mjs",url:"http://127.0.0.1:4173",reuseExistingServer:true,timeout:30000},
  projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:900}}},{name:"mobile",use:{...devices["Pixel 7"]}}]
});