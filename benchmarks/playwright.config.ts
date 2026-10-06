import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './browser', timeout: 30_000, workers: 1, reporter: 'list',
  use: { baseURL:'http://127.0.0.1:4180', viewport:{width:1440,height:900}, deviceScaleFactor:1,
    launchOptions: { executablePath:process.env.BENCH_BROWSER_PATH, args:['--enable-gpu'] } },
  webServer: { cwd:fileURLToPath(new URL('../', import.meta.url)), command:'npx vite benchmarks --config benchmarks/vite.config.ts --host 127.0.0.1 --port 4180 --strictPort', url:'http://127.0.0.1:4180', reuseExistingServer:false },
});
