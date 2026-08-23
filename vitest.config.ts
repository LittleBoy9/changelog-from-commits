import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __CFC_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // cli.ts is a 13-line wiring shim, covered by the subprocess suite;
      // types.ts and globals.d.ts are types only.
      exclude: ['src/types.ts', 'src/globals.d.ts', 'src/cli.ts'],
      reporter: ['text', 'html'],
    },
  },
});
