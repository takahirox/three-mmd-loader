import { readFile } from 'node:fs/promises';

export interface AssetManifest { commit: string; files: { path: string; sha: string }[] }
export const assetManifest: AssetManifest = JSON.parse( await readFile( new URL( '../examples/assets-manifest.json', import.meta.url ), 'utf8' ) );
