import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['cjs', 'esm'],
  target: 'node18',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: false,
  shims: false,
  treeshake: true,
  define: {
    __CFC_VERSION__: JSON.stringify(pkg.version),
  },
});
