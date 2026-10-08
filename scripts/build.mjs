import { build as vite } from 'vite';
import { build } from 'esbuild';
await vite({base:'./',build:{outDir:'dist'}});
await build({entryPoints:['src/extension/capture.ts','src/extension/bridge.ts','src/extension/background.ts'],outdir:'dist',bundle:true,format:'iife',target:'chrome111',minify:false});
