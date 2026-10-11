/**
 * Conversão entre o modelo da Forja e os dados de Actor "adversary" do sistema
 * Foundryborne Daggerheart 1.9.14 (Foundry VTT 13).
 */
import { ENV_BENCH, MODULE_ID, RANGES, TRAITS, isEnvironment } from './rules.mjs';
import { formatFormula, parseFormula } from './dice.mjs';
import { hordeDamage } from './scale.mjs';

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const randomID = () => Array.from({ length: 16 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = text =>
    String(text ?? '')
        .split(/\n+/)
        .filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`)
        .join('');
const plain = h =>
    String(h ?? '')
        .replace(/<\/p>\s*<p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/@Template\[[^\]]*\]/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();

const TRAIT_BY_LABEL = Object.fromEntries(Object.entries(TRAITS).map(([id, label]) => [label.toLowerCase(), id]));
const RANGE_PATTERNS = [
    [/muito distante/i, 'veryFar'],
    [/muito pr[óo]xim/i, 'veryClose'],
    [/distante/i, 'far'],
    [/pr[óo]xim/i, 'close'],
    [/corpo a corpo/i, 'melee']
];
const NUM = { um: 1, uma: 1, dois: 2, duas: 2, três: 3 };
const num = s => NUM[s.toLowerCase()] ?? Number(s);

/* -------------------------------------------- */
/*  Leitura mecânica do texto da habilidade     */
/* -------------------------------------------- */

/**
 * Deduz do texto o que a habilidade precisa virar no Foundry: custo, rolagem, dano, alcance e teste de reação.
 * O resultado pode ser sobrescrito campo a campo por `feature.fx`.
 */
export function deriveFx(feature, adv) {
    const text = feature.text ?? '';
    const fx = { kind: 'none', stress: 0, fear: 0, damage: '', damageType: adv?.attack?.damageType ?? 'physical', range: '', save: '', direct: false };

    const stress = /marque (\d+|uma?|dois|duas|três) (?:pontos? de fadiga|PF)\b/i.exec(text);
    if (stress) fx.stress = num(stress[1]);
    const fear = /gaste (\d+|uma?|dois|duas|três) pontos? de medo/i.exec(text);
    if (fear) fx.fear = num(fear[1]);

    const dmg = /(\d+d\d+(?:\s?[+-]\s?\d+)?|\b\d+)\s+pontos? de dano(?: (f[íi]sico|m[áa]gico))?( direto)?/i.exec(text);
    if (dmg) {
        fx.damage = dmg[1].replace(/\s/g, '');
        if (dmg[2]) fx.damageType = /^f/i.test(dmg[2]) ? 'physical' : 'magical';
        fx.direct = !!dmg[3];
    }
    const save = /teste de reação de (\p{L}+)/iu.exec(text);
    if (save) fx.save = TRAIT_BY_LABEL[save[1].toLowerCase()] ?? '';
    for (const [re, id] of RANGE_PATTERNS)
        if (re.test(text)) {
            fx.range = id;
            break;
        }

    const rollsAttack = /\b(?:faça|fazer|fazem|faz) um ataque(?! padrão)/i.test(text);
    if (rollsAttack) fx.kind = 'attack';
    else if (fx.save) fx.kind = 'save';
    else if (fx.damage && !/^(Horda|Lacaio)\s*\(/i.test(feature.name)) fx.kind = 'damage';
    else if (fx.stress || fx.fear) fx.kind = 'effect';
    if (/^Ataque em Grupo/i.test(feature.name)) Object.assign(fx, { kind: 'attack', damage: '' });

    return { ...fx, ...(feature.fx ?? {}) };
}

/* -------------------------------------------- */
/*  Forja -> Foundry                            */
/* -------------------------------------------- */

const emptyAlt = () => ({ multiplier: 'prof', flatMultiplier: 1, dice: 'd6', bonus: null, custom: { enabled: false } });

function damageValue(formula) {
    const f = parseFormula(formula);
    if (!f) return { custom: { enabled: true, formula: String(formula || '0') }, multiplier: 'flat', flatMultiplier: 1, dice: 'd6', bonus: null };
    if (!f.n || ![4, 6, 8, 10, 12, 20].includes(f.faces))
        return { custom: { enabled: true, formula: formatFormula(f) }, multiplier: 'flat', flatMultiplier: 1, dice: 'd6', bonus: null };
    return { custom: { enabled: false }, multiplier: 'flat', flatMultiplier: f.n, dice: `d${f.faces}`, bonus: f.bonus || null };
}

function damagePart(formula, type, altFormula) {
    return {
        value: damageValue(formula),
        applyTo: 'hitPoints',
        type: [type],
        base: false,
        resultBased: false,
        valueAlt: altFormula ? damageValue(altFormula) : emptyAlt()
    };
}

const rollData = (type, bonus = null) => ({
    type,
    trait: null,
    difficulty: null,
    bonus,
    advState: 'neutral',
    diceRolling: { multiplier: 'prof', flatMultiplier: 1, dice: 'd6', compare: null, treshold: null },
    useDefault: false
});

const costs = fx =>
    [
        ['stress', fx.stress],
        ['fear', fx.fear]
    ]
        .filter(([, v]) => v > 0)
        .map(([key, value]) => ({ scalable: false, key, value, keyIsID: false, step: null, consumeOnSuccess: false }));

function featureAction(feature, fx, img) {
    if (fx.kind === 'none') return null;
    const base = {
        _id: randomID(),
        systemPath: 'actions',
        description: '',
        chatDisplay: true,
        actionType: feature.form === 'passive' ? 'passive' : 'action',
        cost: costs(fx),
        uses: { value: null, max: '', recovery: null },
        target: { type: 'any', amount: null },
        effects: [],
        name: feature.name,
        img,
        range: fx.range || ''
    };
    const parts = fx.damage ? [damagePart(fx.damage, fx.damageType)] : [];
    const damage = { parts, includeBase: false, direct: !!fx.direct };
    const save = { trait: fx.save || null, difficulty: null, damageMod: 'none' };
    if (fx.kind === 'attack') return { ...base, type: 'attack', damage, roll: rollData('attack'), save };
    if (fx.kind === 'save') return { ...base, type: 'attack', damage, roll: rollData(null), save };
    if (fx.kind === 'damage') return { ...base, type: 'damage', damage };
    return { ...base, type: 'effect' };
}

const FEATURE_ICON = {
    passive: 'icons/magic/perception/eye-ringed-glow-angry-small-teal.webp',
    action: 'icons/skills/melee/strike-sword-slashing-red.webp',
    reaction: 'icons/skills/movement/arrow-upward-yellow.webp'
};

/** Perguntas de inspiração do ambiente: só o mestre vê (bloco "secret"), como nos compêndios do sistema. */
const questionsHtml = q => (q ? `<section class="secret"><p><em>${esc(q)}</em></p></section>` : '');

function featureItem(feature, adv, sort) {
    const fx = deriveFx(feature, adv);
    const img = FEATURE_ICON[feature.form] ?? FEATURE_ICON.passive;
    const action = featureAction(feature, fx, img);
    return {
        _id: randomID(),
        name: feature.name,
        type: 'feature',
        img,
        system: {
            description: html(feature.text) + questionsHtml(feature.questions),
            resource: null,
            actions: action ? { [action._id]: action } : {},
            originItemType: null,
            originId: null,
            featureForm: feature.form
        },
        effects: [],
        sort,
        flags: {}
    };
}

/** Monta os dados completos de um Actor do tipo "adversary", prontos para Actor.create() ou "Importar Dados". */
export function toFoundryActor(entity) {
    return isEnvironment(entity) ? toFoundryEnvironment(entity) : toFoundryAdversary(entity);
}

/** Dados de um Actor do tipo "environment". */
export function toFoundryEnvironment(env) {
    const ctx = { attack: { damageType: 'physical' } };
    const notes = [];
    if (env.difficulty === null && env.difficultyNote) notes.push(`<p><strong>Dificuldade:</strong> ${esc(env.difficultyNote)}</p>`);
    if (env.incident?.text) notes.push(`<h3>${esc(env.incident.name || 'Incidente incitante')}</h3>${html(env.incident.text)}`);
    return {
        name: env.name,
        type: 'environment',
        img: env.img || 'systems/daggerheart/assets/icons/documents/actors/forest.svg',
        system: {
            tier: env.tier,
            type: env.type,
            description: html(env.description),
            impulses: env.impulses ?? '',
            difficulty: Number.isInteger(env.difficulty) ? env.difficulty : ENV_BENCH[env.tier].difficulty,
            potentialAdversaries: env.adversaries ? { [randomID()]: { label: env.adversaries, adversaries: [] } } : {},
            notes: notes.join('')
        },
        items: env.features.map((f, i) => featureItem(f, ctx, (i + 1) * 100000)),
        effects: [],
        flags: { [MODULE_ID]: { model: env, version: 1 } }
    };
}

function toFoundryAdversary(adv) {
    const isMinion = adv.type === 'minion';
    const alt = adv.type === 'horde' ? hordeDamage(adv) : null;
    const experiences = {};
    for (const e of adv.experiences) if (e.name) experiences[randomID()] = { name: e.name, value: Number(e.value) || 0, description: '' };
    const { fx: _fx, ...clean } = adv;

    return {
        name: adv.name,
        type: 'adversary',
        img: adv.img || 'systems/daggerheart/assets/icons/documents/actors/dragon-head.svg',
        system: {
            tier: adv.tier,
            type: adv.type,
            description: html(adv.description),
            motivesAndTactics: adv.motives ?? '',
            notes: '',
            difficulty: adv.difficulty,
            hordeHp: adv.type === 'horde' ? Math.max(1, Number(adv.hordeHp) || 1) : 1,
            damageThresholds: { major: isMinion ? 0 : adv.major, severe: isMinion ? 0 : adv.severe },
            resources: {
                hitPoints: { value: 0, max: adv.hp, isReversed: true },
                stress: { value: 0, max: adv.stress, isReversed: true }
            },
            attack: {
                _id: randomID(),
                name: adv.attack.name || 'Ataque',
                img: 'icons/skills/melee/blood-slash-foam-red.webp',
                systemPath: 'attack',
                type: 'attack',
                description: '',
                chatDisplay: false,
                actionType: 'action',
                range: adv.attack.range,
                cost: [],
                uses: { value: null, max: null, recovery: null },
                target: { type: 'any', amount: 1 },
                effects: [],
                roll: rollData('attack', adv.attack.bonus),
                damage: { parts: [damagePart(adv.attack.damage, adv.attack.damageType, alt)], includeBase: false },
                save: { trait: null, difficulty: null, damageMod: 'none' }
            },
            experiences
        },
        prototypeToken: { name: adv.name, disposition: -1, actorLink: false },
        items: adv.features.map((f, i) => featureItem(f, adv, (i + 1) * 100000)),
        effects:
            adv.type === 'horde'
                ? [{ _id: randomID(), type: 'horde', name: 'Horda', img: 'icons/magic/movement/chevrons-down-yellow.webp', disabled: true, transfer: false }]
                : [],
        flags: { [MODULE_ID]: { model: clean, version: 1 } }
    };
}

/* -------------------------------------------- */
/*  Foundry -> Forja                            */
/* -------------------------------------------- */

function partFormula(value) {
    if (!value) return '';
    if (value.custom?.enabled) return String(value.custom.formula ?? '');
    const n = Number(value.flatMultiplier) || 1;
    const faces = Number(String(value.dice ?? '').replace('d', '')) || 0;
    return formatFormula({ n: faces ? n : 0, faces, bonus: Number(value.bonus) || 0 });
}

/** Lê um Actor "adversary" (objeto vindo de actor.toObject()) para o modelo da Forja. */
export function fromFoundryActor(actor) {
    return actor.type === 'environment' ? fromFoundryEnvironment(actor) : fromFoundryAdversary(actor);
}

function fromFoundryEnvironment(actor) {
    const saved = actor.flags?.[MODULE_ID]?.model;
    const sys = actor.system ?? {};
    const features = (actor.items ?? [])
        .filter(i => i.type === 'feature')
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map(i => {
            const raw = String(i.system?.description ?? '');
            // a última seção "secret" em itálico guarda as perguntas; o resto é texto da habilidade
            const secrets = [...raw.matchAll(/<section[^>]*class="secret"[^>]*>([\s\S]*?)<\/section>/gi)];
            const last = secrets[secrets.length - 1];
            const isQuestions = last && /<em>/i.test(last[1]) && /\?\s*(<\/em>)?\s*(<\/p>)?\s*$/i.test(last[1]);
            const body = isQuestions ? raw.replace(last[0], '') : raw;
            return {
                key: randomID().slice(0, 8),
                name: i.name,
                form: i.system?.featureForm ?? 'passive',
                text: plain(body)
                    .replace(/@Lookup\[@name\]/g, actor.name)
                    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
                    .replace(/\s*\n+\s*/g, ' '),
                questions: isQuestions ? plain(last[1]) : ''
            };
        });
    const env = {
        kind: 'environment',
        id: `foundry:${actor._id ?? randomID()}`,
        name: actor.name,
        source: 'Foundry',
        img: actor.img,
        tier: Number(sys.tier) || 1,
        type: sys.type || 'exploration',
        description: plain(sys.description),
        impulses: sys.impulses ?? '',
        difficulty: Number(sys.difficulty) || 0,
        difficultyNote: '',
        adversaries: Object.values(sys.potentialAdversaries ?? {}).map(g => g.label).filter(Boolean).join('; '),
        features
    };
    if (saved?.kind === 'environment' && saved.name === env.name) {
        env.adversaries ||= saved.adversaries ?? '';
        if (saved.incident) env.incident = saved.incident;
        if (saved.difficultyNote && saved.difficulty === null) Object.assign(env, { difficulty: null, difficultyNote: saved.difficultyNote });
        if (saved.features?.length === features.length) features.forEach((f, i) => saved.features[i].fx && (f.fx = saved.features[i].fx));
    }
    return env;
}

function fromFoundryAdversary(actor) {
    const saved = actor.flags?.[MODULE_ID]?.model;
    const sys = actor.system ?? {};
    const part = sys.attack?.damage?.parts?.find(p => p.applyTo === 'hitPoints') ?? sys.attack?.damage?.parts?.[0];
    const name = actor.name;
    const lookup = s =>
        plain(s)
            .replace(/@Lookup\[@name\]/g, name)
            .replace(/@Lookup\[@system\.attack\.altDamageFormula\]/g, partFormula(part?.valueAlt))
            .replace(/@Lookup\[@system\.attack\.damageFormula\]/g, partFormula(part?.value))
            .replace(/@Lookup\[[^\]]*\]/g, '');
    const adv = {
        id: `foundry:${actor._id ?? randomID()}`,
        name,
        source: 'Foundry',
        img: actor.img,
        tier: Number(sys.tier) || 1,
        type: sys.type ?? 'standard',
        hordeHp: Number(sys.hordeHp) || 1,
        description: plain(sys.description),
        motives: sys.motivesAndTactics ?? '',
        difficulty: Number(sys.difficulty) || 0,
        major: Number(sys.damageThresholds?.major) || 0,
        severe: Number(sys.damageThresholds?.severe) || 0,
        hp: Number(sys.resources?.hitPoints?.max) || 1,
        stress: Number(sys.resources?.stress?.max) || 0,
        attack: {
            bonus: Number(sys.attack?.roll?.bonus) || 0,
            name: sys.attack?.name ?? 'Ataque',
            range: sys.attack?.range in RANGES ? sys.attack.range : 'melee',
            damage: partFormula(part?.value) || '1',
            damageType: part?.type?.[0] === 'magical' ? 'magical' : 'physical'
        },
        experiences: Object.values(sys.experiences ?? {}).map(e => ({ name: e.name, value: Number(e.value) || 0 })),
        features: (actor.items ?? [])
            .filter(i => i.type === 'feature')
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
            .map(i => ({
                key: randomID().slice(0, 8),
                name: i.name,
                form: i.system?.featureForm ?? 'passive',
                text: lookup(i.system?.description)
            }))
    };
    // se a ficha saiu da Forja e não foi alterada no Foundry, o modelo salvo preserva ajustes manuais das habilidades
    if (saved && saved.name === adv.name && saved.features?.length === adv.features.length) {
        adv.features.forEach((f, i) => {
            if (saved.features[i].fx) f.fx = saved.features[i].fx;
        });
    }
    return adv;
}
