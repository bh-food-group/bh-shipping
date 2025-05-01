// build.js
require('esbuild')
  .build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    format: 'esm',
    target: ['esnext'],
    platform: 'browser',
    sourcemap: false,
    minify: true,
  })
  .catch(() => process.exit(1));
