#!/usr/bin/env node
/**
 * Gera data/art-index.json: a lista de artes do módulo Art for Daggerheart e as estatísticas dos
 * adversários do compêndio do sistema, para a Forja sugerir a arte certa mesmo com nomes em português.
 * Só guarda nomes em inglês e números; nenhum texto dos livros. Uso: `npm run art-index`.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART_REPO = 'mordachai/art-for-daggerheart';
const ART_REF = process.argv[2] || 'v1.1.4';
const SYSTEM_REPO = 'Foundryborne/daggerheart';
const SYSTEM_REF = process.argv[3] || '1.9.14';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../data/art-index.json');

async function json(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'dh-antagonist-forge' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}
const tree = (repo, ref) => json(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`).then(t => t.tree.map(x => x.path));

async function systemRef() {
    const tags = (await json(`https://api.github.com/repos/${SYSTEM_REPO}/tags?per_page=100`)).map(t => t.name);
    return tags.find(t => t === SYSTEM_REF || t === `v${SYSTEM_REF}`) ?? 'main';
}

const artPaths = await tree(ART_REPO, ART_REF);
const art = new Map();
for (const path of artPaths) {
    const m = path.match(/^adversaries\/(portraits|circle|tokens)\/(.+?)(?:-(\d+))?\.webp$/);
    if (!m) continue;
    const [, kind, name, n] = m;
    const entry = art.get(name) ?? { name, portrait: false, circle: false, tokens: 0 };
    if (kind === 'tokens') entry.tokens = Math.max(entry.tokens, Number(n) || 1);
    else entry[kind === 'portraits' ? 'portrait' : kind] = true;
    art.set(name, entry);
}

const ref = await systemRef();
const packFiles = (await tree(SYSTEM_REPO, ref)).filter(p => /^src\/packs\/adversaries\/adversary_.*\.json$/.test(p));
const adversaries = [];
for (let i = 0; i < packFiles.length; i += 16) {
    const batch = await Promise.all(packFiles.slice(i, i + 16).map(p => json(`https://raw.githubusercontent.com/${SYSTEM_REPO}/${ref}/${p}`)));
    for (const a of batch) {
        const s = a.system ?? {};
        adversaries.push({
            id: a._id,
            name: a.name,
            tier: Number(s.tier) || 1,
            type: s.type ?? 'standard',
            difficulty: Number(s.difficulty) || 0,
            major: Number(s.damageThresholds?.major) || 0,
            severe: Number(s.damageThresholds?.severe) || 0,
            hp: Number(s.resources?.hitPoints?.max) || 0,
            stress: Number(s.resources?.stress?.max) || 0,
            attack: Number(s.attack?.roll?.bonus) || 0
        });
    }
}
adversaries.sort((a, b) => a.name.localeCompare(b.name));

// o módulo de artes compara nomes sem caixa, acentos e pontuação ("Fallen Warlord: Realm-Breaker" = "Fallen Warlord Realm Breaker")
const key = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const byKey = new Map([...art.values()].map(e => [key(e.name), e.name]));
for (const a of adversaries) a.art = byKey.get(key(a.name)) ?? null;

const index = {
    format: 1,
    art: { repo: ART_REPO, ref: ART_REF, module: 'art-for-daggerheart' },
    system: { repo: SYSTEM_REPO, ref },
    images: [...art.values()].filter(e => e.portrait).sort((a, b) => a.name.localeCompare(b.name)),
    adversaries
};
// uma entrada por linha: o arquivo fica pequeno e os diffs legíveis
const rows = list => `[\n${list.map(e => `  ${JSON.stringify(e)}`).join(',\n')}\n ]`;
const head = JSON.stringify({ format: index.format, art: index.art, system: index.system }).slice(1, -1);
await writeFile(OUT, `{${head},\n "images": ${rows(index.images)},\n "adversaries": ${rows(index.adversaries)}\n}\n`);
const matched = adversaries.filter(a => a.art).length;
console.log(`${index.images.length} artes (${ART_REF}), ${adversaries.length} adversários do compêndio (${ref}), ${matched} com arte.`);
