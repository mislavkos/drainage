// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8137',
    // deny geolocation so the first-load auto-center never races the tests
    permissions: [],
    // MapLibre needs WebGL; headless Chromium only has the software rasterizer
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'python3 -m http.server 8137',
    port: 8137,
    reuseExistingServer: true,
  },
});
