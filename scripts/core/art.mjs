/**
 * Artes para os adversários da Forja: as do módulo Art for Daggerheart (Mordachai, CC0), descritas em
 * data/art-index.json (gerado por `npm run art-index`), e, dentro do Foundry, qualquer imagem de compêndios,
 * atores do mundo e arquivos dos módulos. Como as fichas da Forja estão em português, a sugestão compara as
 * estatísticas, não o nome.
 */
export const ART_MODULE = 'art-for-daggerheart';
export const ART_RAW = (index, ref = index?.art?.ref ?? 'main') => `https://media.githubusercontent.com/media/${index?.art?.repo ?? 'mordachai/art-for-daggerheart'}/${ref}/`;
export const ART_LOCAL = `modules/${ART_MODULE}/`;

export const TOKEN_MODES = {
    wildcard: 'Variações aleatórias',
    circle: 'Círculo',
    portrait: 'Igual ao retrato'
};

/** Chave de comparação de nomes, como o módulo de artes faz: sem caixa, acentos, pontuação e numeração. */
export const artKey = s =>
    String(s ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');

const STATS = [
    ['tier', a => a.tier, v => `${v}º patamar`],
    ['type', a => a.type, () => 'mesmo tipo'],
    ['difficulty', a => a.difficulty, v => `Dif ${v}`],
    ['major', a => a.major, v => `limiar maior ${v}`],
    ['severe', a => a.severe, v => `limiar grave ${v}`],
    ['hp', a => a.hp, v => `${v} PV`],
    ['stress', a => a.stress, v => `${v} PF`],
    ['attack', a => a.attack?.bonus, v => `ATQ ${v >= 0 ? '+' : ''}${v}`]
];

/** Palavras com o mesmo começo ("Minotauro"/"Minotaur", "Cultista"/"Cult") ajudam a desempatar. */
function cognates(a, b) {
    const words = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4);
    const other = words(b);
    return words(a).filter(w => other.some(o => o.slice(0, 4) === w.slice(0, 4))).length;
}

/** Quanto as estatísticas de `stats` (ficha da Forja) batem com as de `c` (valores soltos, como no índice). */
export function matchStats(stats, c) {
    const same = STATS.filter(([k, get]) => get(stats) === c[k]);
    if (same.length < 6 || !same.some(([k]) => k === 'tier')) return null;
    return {
        score: same.length + Math.min(cognates(stats.name, c.name), 2) * 0.5,
        exact: same.length === STATS.length,
        reason:
            same.length === STATS.length
                ? 'estatísticas idênticas'
                : `${same.length} de ${STATS.length} estatísticas iguais (${same.filter(([k]) => k !== 'type' && k !== 'tier').map(([k, , label]) => label(c[k])).join(', ')})`
    };
}

/**
 * Artes sugeridas para um adversário, da mais provável para a menos.
 * `stats` é a ficha cujas estatísticas valem para a comparação (a original da biblioteca, se a ficha mudou de patamar).
 */
export function suggestArt(adv, index, { stats = adv, limit = 6 } = {}) {
    if (!index?.images?.length) return [];
    const images = new Map(index.images.map(i => [artKey(i.name), i]));
    const out = new Map();
    const add = (image, entry) => {
        if (!image) return;
        const prev = out.get(image.name);
        if (!prev || prev.score < entry.score) out.set(image.name, { image, ...entry });
    };
    for (const name of [adv.name, stats.name]) add(images.get(artKey(name)), { score: 10, exact: true, compendium: name, reason: 'mesmo nome' });
    for (const c of index.adversaries ?? []) {
        const m = matchStats(stats, c);
        if (m) add(images.get(artKey(c.art ?? c.name)), { ...m, compendium: c.name });
    }
    return [...out.values()].sort((a, b) => b.score - a.score || a.image.name.localeCompare(b.image.name)).slice(0, limit);
}

/**
 * Sugestões entre imagens avulsas do Foundry (atores de compêndios e do mundo): `entries` como os de `host.foundryArt()`,
 * cada um com `name` e, se for adversário, `stats`.
 */
export function suggestImages(adv, entries, { stats = adv, limit = 6 } = {}) {
    const names = new Set([artKey(adv.name), artKey(stats.name)]);
    const out = [];
    for (const entry of entries ?? []) {
        const m = names.has(artKey(entry.name)) ? { score: 10, exact: true, reason: 'mesmo nome' } : entry.stats && matchStats(stats, { ...entry.stats, name: entry.name });
        if (m) out.push({ entry, ...m });
    }
    return out.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).slice(0, limit);
}

/** Uma sugestão só aparece sem pedir quando é a única com estatísticas idênticas (ou o mesmo nome). */
export function bestOf(list) {
    const [first, second] = list;
    if (!first?.exact) return null;
    return second?.exact && second.score === first.score ? null : first;
}
export const bestArt = (adv, index, opts) => bestOf(suggestArt(adv, index, opts));

const fileUrl = (base, folder, name) => `${base}adversaries/${folder}/${base.startsWith('http') ? encodeURIComponent(name) : name}.webp`;

/** Caminhos de retrato e token de uma arte. Curingas só funcionam com os arquivos do módulo instalado no Foundry. */
export function artFiles(image, base) {
    const local = !base.startsWith('http');
    return {
        portrait: fileUrl(base, 'portraits', image.name),
        circle: image.circle ? fileUrl(base, 'circle', image.name) : null,
        token: image.tokens ? fileUrl(base, 'tokens', `${image.name}-1`) : null,
        wildcard: local && image.tokens > 1 ? `${base}adversaries/tokens/${image.name}-*.webp` : null
    };
}

/** Aplica a arte à ficha: retrato em `img`, token em `token` e o que foi escolhido em `art` (para reaplicar). */
export function applyArt(adv, image, { base, token = 'wildcard', ring = false }) {
    const files = artFiles(image, base);
    const src =
        token === 'wildcard'
            ? files.wildcard ?? files.token ?? files.circle ?? files.portrait
            : token === 'circle'
              ? files.circle ?? files.portrait
              : files.portrait;
    adv.img = files.portrait;
    adv.token = { src, randomImg: src === files.wildcard, ring: Boolean(ring) };
    adv.art = { name: image.name, token, ring: Boolean(ring), base };
    return adv;
}

/** Ícones padrão do Foundry e do sistema, que não contam como arte. */
export const isDefaultImage = path => !path || /^icons\/svg\/|^systems\/daggerheart\/assets\/icons\//.test(path);

const safeDecode = s => {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
};

/** Nome legível a partir do arquivo: "tokens/Goblin_Archer-02.webp" → "Goblin Archer 02". */
export const nameFromPath = path =>
    safeDecode(String(path).split('/').pop())
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim();

/** Aplica uma imagem qualquer do Foundry: `entry` traz `img` e, se tiver, um token próprio. */
export function applyImage(adv, entry, { ring = false } = {}) {
    const src = entry.token || entry.img;
    adv.img = entry.img;
    adv.token = { src, randomImg: Boolean(entry.randomImg) || src.includes('*'), ring: Boolean(ring) };
    adv.art = { kind: 'image', name: entry.name, source: entry.source, img: entry.img, token: entry.token ?? null, randomImg: Boolean(entry.randomImg), ring: Boolean(ring) };
    return adv;
}

/** Só o retrato ou só o token, escolhidos no navegador de arquivos. */
export function setImagePart(adv, part, path, { ring = false } = {}) {
    const prev = adv.art;
    if (part === 'img') adv.img = path;
    // sem token próprio, o retrato novo também vira o token
    if (part === 'token' || !adv.token) adv.token = { src: path, randomImg: path.includes('*'), ring: Boolean(ring) };
    const keep = part === 'token' && prev;
    adv.art = {
        kind: 'image',
        name: keep ? prev.name : nameFromPath(path),
        source: keep ? (prev.source ?? 'Art for Daggerheart') : 'Arquivos',
        img: adv.img ?? null,
        token: adv.token?.src ?? null,
        randomImg: Boolean(adv.token?.randomImg),
        ring: Boolean(ring)
    };
    return adv;
}

export function clearArt(adv) {
    delete adv.img;
    delete adv.token;
    delete adv.art;
    return adv;
}

/** Endereço para mostrar uma imagem do módulo fora do Foundry (onde `modules/...` não existe); as artes ficam no Git LFS. */
export function previewUrl(path, index, { inFoundry = false } = {}) {
    if (!path) return '';
    if (inFoundry || !path.startsWith(ART_LOCAL)) return path;
    return ART_RAW(index) + path.slice(ART_LOCAL.length).split('/').map(encodeURIComponent).join('/');
}
