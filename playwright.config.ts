import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-ui/e2e',
  timeout: 120_000,
  // Cada prueba lanza su propia app; en serie para no medir mal en un CPU de 4 núcleos.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
});
