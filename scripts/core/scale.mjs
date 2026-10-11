import { BENCH, ENV_BENCH, HORDE_RATIO, MINION_VALUE, TEMPLATES, bench, isEnvironment } from './rules.mjs';
import { FORMULA_IN_TEXT, average, fitFormula, scaleFormula } from './dice.mjs';

const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);

export function blankAdversary(type = 'standard', tier = 1) {
    const adv = {
        id: `meu:${uid()}`,
        name: 'Novo antagonista',
        source: 'Meus antagonistas',
        tier,
        type,
        hordeHp: 1,
        description: '',
        motives: '',
        difficulty: 0,
        major: 0,
        severe: 0,
        hp: 1,
        stress: 1,
        attack: { bonus: 0, name: 'Ataque', range: 'melee', damage: '1d6', damageType: 'physical' },
        experiences: [],
        features: []
    };
    return applyBenchmark(adv);
}

/** Preenche as estatísticas com os valores típicos do tipo/patamar e garante as habilidades obrigatórias. */
export function applyBenchmark(adv) {
    const b = bench(adv.type, adv.tier);
    Object.assign(adv, { difficulty: b.difficulty, major: b.major, severe: b.severe, hp: b.hp, stress: b.stress });
    adv.attack.bonus = b.attack;
    adv.attack.damage = adv.type === 'minion' ? String(Math.round(b.damage)) : fitFormula(`${adv.tier}d8`, b.damage);
    ensureTypeFeatures(adv);
    return adv;
}

/** Lacaios e hordas sempre carregam suas habilidades características. */
export function ensureTypeFeatures(adv) {
    const has = re => adv.features.some(f => re.test(f.name));
    if (adv.type === 'minion') {
        if (!has(/^Lacaio/i)) adv.features.unshift(newFeature(TEMPLATES.minionPassive(MINION_VALUE[adv.tier])));
        if (!has(/^Ataque em Grupo/i)) adv.features.push(newFeature(TEMPLATES.groupAttack(adv.attack.damage, adv.attack.damageType)));
    }
    if (adv.type === 'horde' && !has(/^Horda/i)) {
        const alt = scaleFormula(adv.attack.damage, HORDE_RATIO, 0);
        adv.features.unshift(newFeature(TEMPLATES.horde(alt, adv.attack.damageType)));
    }
    return adv;
}

export function newFeature(data = {}) {
    return { name: 'Nova habilidade', form: 'action', text: '', ...data, key: uid() };
}

/** Dano reduzido da horda, lido da habilidade "Horda (X)". */
export function hordeDamage(adv) {
    const f = adv.features.find(x => /^Horda\s*\(/i.test(x.name));
    const m = f && /\(([^)]+)\)/.exec(f.name);
    return m ? m[1].replace(/\s/g, '') : null;
}

/* -------------------------------------------- */
/*  Mudança de patamar                          */
/* -------------------------------------------- */

const DAMAGE_NEAR = new RegExp(`(${FORMULA_IN_TEXT})`, 'g');

/**
 * Ajusta os números dentro do texto de uma habilidade para outro patamar.
 * Só mexe em fórmulas que estão claramente ligadas a dano e em Dificuldades explícitas de testes.
 */
export function scaleFeatureText(text, ctx) {
    const { ratio, diceDelta, difficultyDelta } = ctx;
    let out = text.replace(DAMAGE_NEAR, (match, formula, offset) => {
        const before = text.slice(Math.max(0, offset - 28), offset).toLowerCase();
        const after = text.slice(offset + match.length, offset + match.length + 30).toLowerCase();
        const isDamage = /^\s*(pontos? )?de dano/.test(after) || /dano[^.]{0,20}$/.test(before) || /(causa|causam|causando|sofre|sofrem)\s$/.test(before);
        return isDamage ? scaleFormula(formula.replace(/\s/g, ''), ratio, diceDelta) : match;
    });
    // dano fixo: "causa 2 pontos de dano"
    out = out.replace(/(?<![\dd+\-] ?)\b(\d+)( pontos? de dano (?:f[íi]sico|m[áa]gico))/g, (m, n, rest) => `${Math.max(1, Math.round(Number(n) * ratio))}${rest}`);
    // Dificuldade explícita: "teste de reação de Agilidade (14)" e "Dificuldade 11 +"
    if (difficultyDelta) {
        out = out.replace(/(teste[^.()]{0,80}\()(\d{1,2})(?=[) ])/gi, (m, pre, n) => `${pre}${Number(n) + difficultyDelta}`);
        // "Dificuldade 11 + ..." e "a Dificuldade do ambiente aumenta para 14"
        // (bônus como "Dificuldade aumenta em +3" ficam como estão)
        out = out.replace(/(Dificuldade (?:[^.\d()+]{0,40}? para )?)(\d{1,2})\b/g, (m, pre, n) => `${pre}${Number(n) + difficultyDelta}`);
    }
    return out;
}

function scaleFeature(feature, adv, ctx) {
    const f = clone(feature);
    if (/^Lacaio\s*\(/i.test(f.name)) {
        const old = Number(/\((\d+)\)/.exec(f.name)?.[1]) || MINION_VALUE[ctx.from];
        const next = Math.max(1, Math.round((old * MINION_VALUE[ctx.to]) / MINION_VALUE[ctx.from]));
        f.name = `Lacaio (${next})`;
        f.text = f.text.replace(new RegExp(`cada ${old} pontos`, 'i'), `cada ${next} pontos`);
        return f;
    }
    if (/^Horda\s*\(/i.test(f.name)) {
        const alt = scaleFormula(adv.attack.damage, HORDE_RATIO, 0);
        const old = /\(([^)]+)\)/.exec(f.name)?.[1];
        f.name = `Horda (${alt})`;
        if (old) f.text = f.text.split(old).join(alt);
        return f;
    }
    f.text = scaleFeatureText(f.text, ctx);
    if (f.fx?.damage) f.fx.damage = scaleFormula(f.fx.damage, ctx.ratio, ctx.diceDelta);
    return f;
}

/**
 * Devolve uma cópia do adversário em outro patamar e a lista de mudanças.
 * A posição dele em relação ao típico do tipo é preservada: quem era mais duro que a média continua sendo.
 */
export function scaleAdversary(source, to) {
    const adv = clone(source);
    const from = adv.tier;
    if (from === to) return { adversary: adv, changes: [], notes: [] };
    const a = bench(adv.type, from);
    const b = bench(adv.type, to);
    const changes = [];
    const set = (label, before, after, apply) => {
        if (String(before) !== String(after)) changes.push({ label, before, after });
        apply(after);
    };
    const shift = key => adv[key] + (b[key] - a[key]);
    const mult = key => (a[key] ? Math.round((adv[key] * b[key]) / a[key]) : b[key]);

    set('Dificuldade', adv.difficulty, Math.max(5, shift('difficulty')), v => (adv.difficulty = v));
    if (adv.type !== 'minion') {
        const major = adv.major ? Math.max(1, mult('major')) : 0;
        let severe = adv.severe ? Math.max(1, mult('severe')) : 0;
        if (severe && severe <= major) severe = major + 1;
        set('Limiar maior', adv.major, major, v => (adv.major = v));
        set('Limiar grave', adv.severe, severe, v => (adv.severe = v));
        set('PV', adv.hp, Math.max(1, shift('hp')), v => (adv.hp = v));
        set('PF', adv.stress, Math.max(1, shift('stress')), v => (adv.stress = v));
    }
    set('ATQ', adv.attack.bonus, adv.attack.bonus + (b.attack - a.attack), v => (adv.attack.bonus = v));

    const ratio = b.damage / a.damage;
    const diceDelta = to - from;
    set('Dano', adv.attack.damage, scaleFormula(adv.attack.damage, ratio, diceDelta), v => (adv.attack.damage = v));

    // Experiências: +2 nos patamares 1–2, +3 nos patamares 3–4 (em média)
    const expBump = Math.floor((to - 1) / 2) - Math.floor((from - 1) / 2);
    if (expBump)
        adv.experiences.forEach(e => {
            const v = Math.max(1, e.value + expBump);
            set(`Experiência ${e.name}`, e.value, v, x => (e.value = x));
        });

    adv.tier = to;
    const ctx = { from, to, ratio, diceDelta, difficultyDelta: b.difficulty - a.difficulty };
    adv.features = adv.features.map(f => {
        const g = scaleFeature(f, adv, ctx);
        if (g.name !== f.name) changes.push({ label: 'Habilidade', before: f.name, after: g.name });
        else if (g.text !== f.text) changes.push({ label: f.name, before: 'números do texto', after: 'ajustados' });
        return g;
    });

    const notes = [];
    if (from <= 2 && to >= 3 && adv.type !== 'minion')
        notes.push('Do 1º/2º para o 3º/4º patamar o livro sugere somar de 1 a 3 PV e PF, conforme a duração desejada e quantas habilidades gastam Fadiga.');
    if (to > from) notes.push('Ao subir de patamar, considere acrescentar uma habilidade nova em vez de só aumentar números.');
    else notes.push('Ao descer de patamar, considere remover a habilidade mais poderosa ou complicada.');
    if (adv.type === 'solo') notes.push('Solo com Inclemente (3) deve causar menos dano por ataque do que um com Inclemente (2).');
    notes.push('Revise as habilidades: condições, alcances e efeitos sem números não são alterados automaticamente.');
    return { adversary: adv, changes, notes };
}

/** Ajusta uma habilidade vinda de outro adversário para o patamar/dano do adversário atual. */
export function adaptFeature(feature, origin, target) {
    const f = newFeature(clone(feature));
    delete f.origin;
    if (!isEnvironment(target)) delete f.questions;
    if (!origin || /^(Lacaio|Horda)\s*\(/i.test(f.name)) return f;
    if (origin.tier === target.tier) return f;
    // referência de dano e Dificuldade de quem cede e de quem recebe a habilidade
    const ref = e => (isEnvironment(e) ? ENV_BENCH[e.tier] : { difficulty: bench(e.type, e.tier).difficulty, damage: bench('standard', e.tier).damage });
    const a = ref(origin);
    const b = ref(target);
    f.text = scaleFeatureText(f.text, {
        ratio: b.damage / a.damage,
        diceDelta: target.tier - origin.tier,
        difficultyDelta: b.difficulty - a.difficulty
    });
    return f;
}

/* -------------------------------------------- */
/*  Ambientes                                   */
/* -------------------------------------------- */

export function blankEnvironment(type = 'exploration', tier = 1) {
    return {
        kind: 'environment',
        id: `meu:${uid()}`,
        name: 'Novo ambiente',
        source: 'Meus antagonistas',
        tier,
        type,
        description: '',
        impulses: '',
        difficulty: ENV_BENCH[tier].difficulty,
        difficultyNote: '',
        adversaries: '',
        features: []
    };
}

/**
 * Muda o patamar de um ambiente como o livro orienta (Adaptando Ambientes): ajusta a Dificuldade padrão,
 * as Dificuldades citadas nas habilidades e o dano que elas causam.
 */
export function scaleEnvironment(source, to) {
    const env = clone(source);
    const from = env.tier;
    if (from === to) return { adversary: env, changes: [], notes: [] };
    const a = ENV_BENCH[from];
    const b = ENV_BENCH[to];
    const changes = [];
    const difficultyDelta = b.difficulty - a.difficulty;
    if (env.difficulty !== null && env.difficulty !== undefined) {
        const next = Math.max(5, env.difficulty + difficultyDelta);
        changes.push({ label: 'Dificuldade', before: env.difficulty, after: next });
        env.difficulty = next;
    }
    env.tier = to;
    const ctx = { from, to, ratio: b.damage / a.damage, diceDelta: to - from, difficultyDelta };
    env.features = env.features.map(f => {
        const g = clone(f);
        g.text = scaleFeatureText(f.text, ctx);
        if (g.fx?.damage) g.fx.damage = scaleFormula(g.fx.damage, ctx.ratio, ctx.diceDelta);
        if (g.text !== f.text) changes.push({ label: f.name, before: 'números do texto', after: 'ajustados' });
        return g;
    });

    const notes = [];
    if (env.adversaries) notes.push(`Adversários sugeridos (${env.adversaries}): troque por outros do ${to}º patamar ou mude o patamar dos originais na Forja.`);
    if (env.features.some(f => /invo(car|que|ca)\b/i.test(f.text))) notes.push('Há habilidades que invocam adversários: substitua o adversário citado por um adequado ao novo patamar.');
    const hasFear = env.features.some(f => /gaste \d+ pontos? de medo/i.test(f.text));
    if (to > from && !hasFear) notes.push('Ao subir de patamar, considere adicionar uma habilidade de Medo: este ambiente ainda não tem nenhuma.');
    if (to < from) notes.push('Ao descer de patamar, considere remover a habilidade mais poderosa ou impactante.');
    notes.push('Contagens, condições e efeitos sem dano não são alterados automaticamente.');
    return { adversary: env, changes, notes };
}

/** Muda o patamar de qualquer ficha da Forja (adversário ou ambiente). */
export const scaleEntity = (entity, to) => (isEnvironment(entity) ? scaleEnvironment(entity, to) : scaleAdversary(entity, to));

/** Compara as estatísticas com o típico do tipo/patamar: devolve -1 (abaixo), 0 (na faixa) ou 1 (acima) por campo. */
export function compareToBenchmark(adv) {
    const b = bench(adv.type, adv.tier);
    const band = (value, ref, tol) => (value > ref + tol ? 1 : value < ref - tol ? -1 : 0);
    return {
        difficulty: band(adv.difficulty, b.difficulty, 2),
        major: band(adv.major, b.major, Math.max(2, b.major * 0.3)),
        severe: band(adv.severe, b.severe, Math.max(3, b.severe * 0.3)),
        hp: band(adv.hp, b.hp, 2),
        stress: band(adv.stress, b.stress, 2),
        attack: band(adv.attack.bonus, b.attack, 2),
        damage: band(average(adv.attack.damage), b.damage, Math.max(2, b.damage * 0.35))
    };
}

export { BENCH };
