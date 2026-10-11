#!/usr/bin/env node
/** Testes das regras de escala e do formato exportado: `npm test`. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { average, fitFormula, parseFormula, scaleFormula } from '../scripts/core/dice.mjs';
import { BENCH, ENV_TYPES, TYPES } from '../scripts/core/rules.mjs';
import { blankAdversary, blankEnvironment, scaleAdversary, scaleEntity, scaleFeatureText } from '../scripts/core/scale.mjs';
import { deriveFx, fromFoundryActor, toFoundryActor } from '../scripts/core/foundry-data.mjs';

let count = 0;
const test = (name, fn) => {
    fn();
    count++;
    console.log(`ok  ${name}`);
};

test('fórmulas de dano', () => {
    assert.deepEqual(parseFormula('2d8+3'), { n: 2, faces: 8, bonus: 3 });
    assert.deepEqual(parseFormula('7'), { n: 0, faces: 0, bonus: 7 });
    assert.equal(parseFormula('abc'), null);
    assert.equal(average('2d8+3'), 12);
    assert.equal(fitFormula('1d8+2', 12, 1), '2d8+3');
    assert.equal(scaleFormula('3', 2), '6');
    for (const f of ['1d4', '1d12+4', '2d6+3', '4d12+15', '3d20'])
        for (const r of [0.3, 0.5, 1, 2, 4]) {
            const out = scaleFormula(f, r);
            assert.ok(Math.abs(average(out) - Math.max(1, average(f) * r)) <= 3.5, `${f} x${r} -> ${out}`);
            assert.ok(parseFormula(out).bonus >= 0);
        }
});

test('tabela de referência cobre todos os tipos e patamares e cresce com o patamar', () => {
    for (const type of Object.keys(TYPES))
        for (let t = 1; t <= 4; t++) {
            const b = BENCH[type][t];
            assert.ok(b && b.difficulty > 0 && b.damage > 0, `${type} T${t}`);
            if (t > 1)
                for (const k of ['difficulty', 'major', 'severe', 'attack', 'damage'])
                    assert.ok(b[k] >= BENCH[type][t - 1][k], `${type} ${k} T${t}`);
        }
});

test('escala de patamar: ida e volta fica perto do original', () => {
    for (const type of Object.keys(TYPES)) {
        const base = blankAdversary(type, 1);
        const up = scaleAdversary(base, 4).adversary;
        assert.equal(up.tier, 4);
        assert.ok(up.difficulty > base.difficulty);
        assert.ok(average(up.attack.damage) > average(base.attack.damage));
        const back = scaleAdversary(up, 1).adversary;
        assert.equal(back.difficulty, base.difficulty);
        assert.equal(back.hp, base.hp);
        assert.ok(
            Math.abs(average(back.attack.damage) - average(base.attack.damage)) <= 1.5,
            `${type}: ${base.attack.damage} -> ${up.attack.damage} -> ${back.attack.damage}`
        );
        if (type === 'minion') assert.ok(up.features.some(f => /^Lacaio \(13\)/.test(f.name)));
        if (type === 'horde') assert.ok(up.features.some(f => f.name.startsWith('Horda (') && f.text.includes(f.name.slice(7, -1))));
    }
});

test('texto de habilidade: só números de dano e Dificuldade mudam', () => {
    const ctx = { ratio: 2, diceDelta: 1, difficultyDelta: 3 };
    const out = scaleFeatureText(
        'Role 1d6. Se rolar 4 ou mais, cause 1d8+2 pontos de dano físico. Teste de reação de Agilidade (14). Contagem (1d8).',
        ctx
    );
    assert.match(out, /^Role 1d6\. Se rolar 4 ou mais, cause 2d8\+4 pontos de dano físico\./);
    assert.match(out, /Agilidade \(17\)/);
    assert.match(out, /Contagem \(1d8\)/);
    assert.equal(scaleFeatureText('cada um causa 2 pontos de dano físico', ctx), 'cada um causa 4 pontos de dano físico');
});

test('leitura mecânica das habilidades', () => {
    const adv = blankAdversary('standard', 1);
    const fx = deriveFx(
        {
            name: 'Garras',
            form: 'action',
            text: 'Marque 1 Ponto de Fadiga para fazer um ataque contra um alvo muito próximo. Se acertar, cause 2d6+3 pontos de dano mágico direto.'
        },
        adv
    );
    assert.deepEqual(
        { kind: fx.kind, stress: fx.stress, damage: fx.damage, type: fx.damageType, range: fx.range, direct: fx.direct },
        { kind: 'attack', stress: 1, damage: '2d6+3', type: 'magical', range: 'veryClose', direct: true }
    );
    const save = deriveFx(
        {
            name: 'Grito',
            form: 'action',
            text: 'Gaste 2 Pontos de Medo. Todos os alvos próximos devem passar em um teste de reação de Presença ou sofrem 3d10 pontos de dano mágico.'
        },
        adv
    );
    assert.deepEqual(
        { kind: save.kind, fear: save.fear, save: save.save, range: save.range },
        { kind: 'save', fear: 2, save: 'presence', range: 'close' }
    );
    assert.equal(deriveFx({ name: 'Escalador', form: 'passive', text: 'Escala tão facilmente quanto corre.' }, adv).kind, 'none');
    assert.equal(deriveFx({ name: 'X', form: 'action', text: 'Marque 1 PF.', fx: { kind: 'damage' } }, adv).kind, 'damage');
});

function checkActor(actor, adv) {
    assert.equal(actor.type, 'adversary');
    const s = actor.system;
    assert.ok(Number.isInteger(s.tier) && s.tier >= 1 && s.tier <= 4);
    assert.ok(s.type in TYPES);
    for (const v of [
        s.difficulty,
        s.hordeHp,
        s.damageThresholds.major,
        s.damageThresholds.severe,
        s.resources.hitPoints.max,
        s.resources.stress.max,
        s.attack.roll.bonus
    ])
        assert.ok(Number.isInteger(v), `${adv.name}: número inteiro esperado, veio ${v}`);
    assert.ok(['melee', 'veryClose', 'close', 'far', 'veryFar'].includes(s.attack.range));
    const part = s.attack.damage.parts[0];
    assert.ok(part.value.custom.enabled ? part.value.custom.formula : /^d(4|6|8|10|12|20)$/.test(part.value.dice), `${adv.name}: dano`);
    assert.equal(actor.items.length, adv.features.length);
    for (const item of actor.items) {
        assert.equal(item.type, 'feature');
        assert.ok(['passive', 'action', 'reaction'].includes(item.system.featureForm));
        for (const [id, action] of Object.entries(item.system.actions)) {
            assert.equal(id, action._id);
            assert.match(id, /^[A-Za-z0-9]{16}$/);
            assert.ok(['attack', 'damage', 'effect'].includes(action.type));
            for (const c of action.cost) assert.ok(['stress', 'fear'].includes(c.key) && c.value > 0);
        }
    }
    assert.equal(actor.effects.length, s.type === 'horde' ? 1 : 0);
}

test('exportação para o Foundry e leitura de volta', () => {
    for (const type of Object.keys(TYPES)) {
        const adv = blankAdversary(type, 2);
        adv.experiences.push({ name: 'Emboscada', value: 2 });
        const actor = toFoundryActor(adv);
        checkActor(actor, adv);
        const back = fromFoundryActor(JSON.parse(JSON.stringify(actor)));
        for (const k of ['name', 'tier', 'type', 'difficulty', 'major', 'severe', 'hp', 'stress']) assert.equal(back[k], adv[k], `${type}.${k}`);
        assert.deepEqual(back.attack, adv.attack);
        assert.deepEqual(back.experiences, adv.experiences);
        assert.deepEqual(
            back.features.map(f => [f.name, f.form, f.text]),
            adv.features.map(f => [f.name, f.form, f.text])
        );
    }
});

function checkEnvironment(actor, env) {
    assert.equal(actor.type, 'environment');
    const s = actor.system;
    assert.ok(Number.isInteger(s.tier) && s.tier >= 1 && s.tier <= 4);
    assert.ok(s.type in ENV_TYPES, `${env.name}: tipo ${s.type}`);
    assert.ok(Number.isInteger(s.difficulty), `${env.name}: Dificuldade`);
    for (const group of Object.values(s.potentialAdversaries)) assert.ok(typeof group.label === 'string' && Array.isArray(group.adversaries));
    assert.equal(actor.items.length, env.features.length);
    for (const item of actor.items) {
        assert.ok(['passive', 'action', 'reaction'].includes(item.system.featureForm));
        for (const action of Object.values(item.system.actions)) assert.ok(['attack', 'damage', 'effect'].includes(action.type));
    }
}

test('ambientes: escala pela tabela do livro, exporta e lê de volta', () => {
    const env = blankEnvironment('traversal', 1);
    Object.assign(env, { name: 'Rio de Teste', impulses: 'arrastar', adversaries: 'feras', difficulty: 10 });
    env.features.push({
        name: 'Corrente',
        form: 'action',
        text: 'Gaste 1 Ponto de Medo. O alvo deve fazer um teste de reação de Agilidade (12). Se falhar, sofre 1d6+1 pontos de dano físico. A Dificuldade do ambiente aumenta para 12. Contagem de Progresso (4).',
        questions: 'O que há no fundo do rio?'
    });
    const { adversary: up, changes } = scaleEntity(env, 3);
    assert.equal(up.tier, 3);
    assert.equal(up.difficulty, 16); // +3 por patamar, mantendo o desvio de -1
    assert.match(up.features[0].text, /Agilidade \(18\)/);
    assert.match(up.features[0].text, /aumenta para 18/);
    assert.match(up.features[0].text, /Contagem de Progresso \(4\)/);
    const dmg = /sofre (\S+) pontos/.exec(up.features[0].text)[1];
    assert.ok(/^3d/.test(dmg) && Math.abs(average(dmg) - 4.5 * (17 / 6)) <= 2, dmg);
    assert.ok(changes.length >= 2);
    assert.equal(scaleEntity(up, 1).adversary.difficulty, 10);

    const actor = toFoundryActor(up);
    checkEnvironment(actor, up);
    assert.match(actor.items[0].system.description, /class="secret"/);
    const action = Object.values(actor.items[0].system.actions)[0];
    assert.equal(action.save.trait, 'agility');
    assert.equal(action.cost[0].key, 'fear');
    const back = fromFoundryActor(JSON.parse(JSON.stringify(actor)));
    for (const k of ['kind', 'name', 'tier', 'type', 'difficulty', 'impulses', 'adversaries']) assert.equal(back[k], up[k], k);
    assert.deepEqual(
        back.features.map(f => [f.name, f.form, f.text, f.questions]),
        up.features.map(f => [f.name, f.form, f.text, f.questions])
    );

    const special = blankEnvironment('event', 2);
    Object.assign(special, { difficulty: null, difficultyNote: 'igual à do adversário' });
    assert.equal(scaleEntity(special, 4).adversary.difficulty, null);
    assert.equal(toFoundryActor(special).system.difficulty, 14);
});

const libFile = new URL('../data/library.json', import.meta.url);
if (existsSync(libFile)) {
    test('biblioteca local: toda ficha exporta e escala para os 4 patamares', () => {
        const { adversaries, environments = [] } = JSON.parse(readFileSync(libFile, 'utf8'));
        assert.ok(adversaries.length > 0);
        for (const adv of adversaries) {
            checkActor(toFoundryActor(adv), adv);
            let prev = null;
            for (let t = 1; t <= 4; t++) {
                const { adversary } = scaleAdversary(adv, t);
                checkActor(toFoundryActor(adversary), adversary);
                assert.ok(adversary.hp >= 1 && adversary.difficulty >= 5, adv.name);
                if (prev)
                    assert.ok(
                        adversary.difficulty >= prev.difficulty && average(adversary.attack.damage) >= average(prev.attack.damage) - 0.5,
                        `${adv.name} T${t}: ${prev.attack.damage} -> ${adversary.attack.damage}`
                    );
                prev = adversary;
            }
        }
        for (const env of environments) {
            let prev = null;
            for (let t = 1; t <= 4; t++) {
                const { adversary } = scaleEntity(env, t);
                checkEnvironment(toFoundryActor(adversary), adversary);
                if (prev && env.difficulty !== null) assert.equal(adversary.difficulty - prev.difficulty, 3, env.name);
                prev = adversary;
            }
        }
        console.log(`    ${adversaries.length} adversários e ${environments.length} ambientes verificados`);
    });
} else console.log('--  data/library.json ausente: teste da biblioteca local pulado');

console.log(`\n${count} testes passaram.`);
