/**
 * Artes do módulo Art for Daggerheart (Mordachai, CC0) para os adversários da Forja.
 * O índice (data/art-index.json, gerado por `npm run art-index`) traz as artes disponíveis e as estatísticas do
 * compêndio do sistema; como as fichas da Forja estão em português, a sugestão compara as estatísticas, não o nome.
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
        const same = STATS.filter(([k, get]) => get(stats) === c[k]);
        if (same.length < 6 || !same.some(([k]) => k === 'tier')) continue;
        const score = same.length + Math.min(cognates(stats.name, c.name), 2) * 0.5;
        const reason =
            same.length === STATS.length
                ? 'estatísticas idênticas'
                : `${same.length} de ${STATS.length} estatísticas iguais (${same.filter(([k]) => k !== 'type' && k !== 'tier').map(([k, , label]) => label(c[k])).join(', ')})`;
        add(images.get(artKey(c.art ?? c.name)), { score, exact: same.length === STATS.length, compendium: c.name, reason });
    }
    return [...out.values()].sort((a, b) => b.score - a.score || a.image.name.localeCompare(b.image.name)).slice(0, limit);
}

/** Uma sugestão só aparece sem pedir quando é a única com estatísticas idênticas (ou o mesmo nome). */
export function bestArt(adv, index, opts) {
    const [first, second] = suggestArt(adv, index, opts);
    if (!first?.exact) return null;
    return second?.exact && second.score === first.score ? null : first;
}

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
