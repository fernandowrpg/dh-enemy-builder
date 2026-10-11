#!/usr/bin/env node
/** Grava versão e links do repositório no module.json: `node tools/stamp-manifest.mjs <versão> <url-do-repo> [tag]`. */
import { readFileSync, writeFileSync } from 'node:fs';

const [version, repo, tag] = process.argv.slice(2);
if (!version || !repo) {
    console.error('Uso: node tools/stamp-manifest.mjs <versão> <https://github.com/usuario/repo> [tag]');
    process.exit(1);
}
const file = new URL('../module.json', import.meta.url);
const manifest = JSON.parse(readFileSync(file, 'utf8'));
manifest.version = version;
manifest.url = repo;
manifest.manifest = `${repo}/releases/latest/download/module.json`;
manifest.download = tag ? `${repo}/releases/download/${tag}/module.zip` : `${repo}/releases/latest/download/module.zip`;
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`module.json: versão ${version}, repositório ${repo}`);
