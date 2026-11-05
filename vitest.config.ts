import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests-ui/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['app/shared/**/*.ts', 'app/main/archivos.ts'], exclude: ['app/shared/canales.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90 },
    },
  },
});
