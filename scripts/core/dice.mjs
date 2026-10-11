/** Utilitários para fórmulas simples de dano: "2d8+3", "1d12", "4". */

const DIE_STEPS = [4, 6, 8, 10, 12, 20];
const MAX_STEP_UP = 4; // d12
const FORMULA = /^\s*(?:(\d+)d(\d+))?\s*(?:([+-])?\s*(\d+))?\s*$/;

/** Trecho de regex (sem flags) que reconhece uma fórmula de dados dentro de um texto. */
export const FORMULA_IN_TEXT = '\\d+d\\d+(?:\\s?[+-]\\s?\\d+)?';

export function parseFormula(formula) {
    const m = FORMULA.exec(String(formula ?? '').replace(/−/g, '-'));
    if (!m || (!m[1] && !m[4])) return null;
    const bonus = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
    return { n: m[1] ? Number(m[1]) : 0, faces: m[1] ? Number(m[2]) : 0, bonus };
}

export function formatFormula({ n, faces, bonus }) {
    if (!n) return String(bonus);
    const dice = `${n}d${faces}`;
    if (!bonus) return dice;
    return `${dice}${bonus > 0 ? '+' : '-'}${Math.abs(bonus)}`;
}

export function average(formula) {
    const f = typeof formula === 'string' ? parseFormula(formula) : formula;
    if (!f) return 0;
    return (f.n * (f.faces + 1)) / 2 + f.bonus;
}

/**
 * Reescreve uma fórmula para que a média fique o mais perto possível de `target`,
 * mudando a quantidade de dados em `diceDelta` e mantendo o "jeito" da fórmula original.
 */
export function fitFormula(formula, target, diceDelta = 0) {
    const f = parseFormula(formula);
    if (!f) return formula;
    target = Math.max(1, target);
    if (!f.n) return String(Math.max(1, Math.round(target)));

    let n = Math.max(1, f.n + diceDelta);
    // dado fora do padrão: usa o mais próximo
    let step = DIE_STEPS.reduce((best, d, i) => (Math.abs(d - f.faces) < Math.abs(DIE_STEPS[best] - f.faces) ? i : best), 0);
    const diceAvg = () => (n * (DIE_STEPS[step] + 1)) / 2;

    // dados grandes demais para a média pedida: reduz o dado e depois a quantidade
    while (target - diceAvg() < 0 && step > 0) step--;
    while (target - diceAvg() < 0 && n > 1) n--;
    // bônus fixo desproporcional: aumenta o dado (nunca até d20) e depois a quantidade
    while (target - diceAvg() > diceAvg() * 1.25 && step < MAX_STEP_UP) step++;
    while (target - diceAvg() > diceAvg() * 1.5 && n < 8) n++;

    return formatFormula({ n, faces: DIE_STEPS[step], bonus: Math.max(0, Math.round(target - diceAvg())) });
}

/** Escala a média de uma fórmula por `ratio`. */
export function scaleFormula(formula, ratio, diceDelta = 0) {
    const avg = average(formula);
    if (!avg) return formula;
    return fitFormula(formula, avg * ratio, diceDelta);
}
