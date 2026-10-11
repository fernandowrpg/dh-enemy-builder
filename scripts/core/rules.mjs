/**
 * Regras e números de referência para adversários de Daggerheart.
 * Os ids (tipos, alcances, atributos) são os mesmos usados pelo sistema Foundryborne Daggerheart 1.9.x.
 */

export const MODULE_ID = 'dh-antagonist-forge';
export const SYSTEM_VERSION = '1.9.14';

export const TIERS = [1, 2, 3, 4];
export const TIER_LEVELS = { 1: 'nível 1', 2: 'níveis 2 a 4', 3: 'níveis 5 a 7', 4: 'níveis 8 a 10' };

/** bp = custo em Pontos de Batalha ao montar um encontro. */
export const TYPES = {
    standard: { label: 'Comum', bp: 2, hint: 'Estatísticas na média do patamar; as habilidades definem o papel na cena.' },
    support: { label: 'Assistente', bp: 1, hint: 'Parecido com o Comum ou um pouco abaixo; dano baixo, PV médio e mais PF para pagar ações.' },
    ranged: { label: 'Atirador', bp: 2, hint: 'Ataque acima da média e dano alto à distância; limiares e PV baixos.' },
    bruiser: { label: 'Brutamonte', bp: 4, hint: 'Ataque e Dificuldade na média ou abaixo; dano, PV e limiares acima da média.' },
    horde: { label: 'Horda', bp: 2, hint: 'Dificuldade e ataque baixos; dano alto que cai mais ou menos pela metade com metade dos PV marcados.' },
    minion: { label: 'Lacaio', bp: 1, hint: '1 PV, 1 PF, Dificuldade baixa e dano fixo. Sempre tem Lacaio (X) e Ataque em Grupo.' },
    leader: { label: 'Líder', bp: 3, hint: 'Estatísticas acima do patamar; a força vem de comandar, reforçar ou invocar aliados.' },
    social: { label: 'Manipulador', bp: 1, hint: 'Estatísticas físicas baixas; defende-se com passivas e desafia o grupo no diálogo.' },
    skulk: { label: 'Oportunista', bp: 2, hint: 'Ataque e Dificuldade na média ou acima; limiares baixos; dano alto contra alvos isolados ou prejudicados.' },
    solo: { label: 'Solo', bp: 5, hint: 'Muito dano e PV, com Inclemente, várias reações ou dano em área para agir mais vezes.' }
};

export const RANGES = {
    melee: 'corpo a corpo',
    veryClose: 'muito próximo',
    close: 'próximo',
    far: 'distante',
    veryFar: 'muito distante'
};

export const TRAITS = {
    agility: 'Agilidade',
    strength: 'Força',
    finesse: 'Acuidade',
    instinct: 'Instinto',
    presence: 'Presença',
    knowledge: 'Conhecimento'
};

export const DAMAGE_TYPES = { physical: 'físico', magical: 'mágico' };
export const DAMAGE_ABBR = { physical: 'fís', magical: 'mág' };
export const FORMS = { passive: 'passiva', action: 'ação', reaction: 'reação' };

/** Tabela "Estatísticas improvisadas por patamar" (Livro Básico, Improvisando Adversários). */
export const IMPROVISED = {
    1: { attack: 1, damage: '1d6+2 até 1d12+4', difficulty: 11, major: 7, severe: 12 },
    2: { attack: 2, damage: '2d6+3 até 2d12+4', difficulty: 14, major: 10, severe: 20 },
    3: { attack: 3, damage: '3d8+3 até 3d12+5', difficulty: 17, major: 20, severe: 32 },
    4: { attack: 4, damage: '4d8+10 até 4d12+15', difficulty: 20, major: 25, severe: 45 }
};

const row = ([difficulty, major, severe, hp, stress, attack, damage]) => ({ difficulty, major, severe, hp, stress, attack, damage });
const table = rows => Object.fromEntries(rows.map((r, i) => [i + 1, row(r)]));

/**
 * Valores típicos por tipo e patamar: [Dificuldade, limiar maior, limiar grave, PV, PF, ATQ, dano médio do ataque padrão].
 * São medianas das fichas publicadas (Livro Básico + Bestiário do Medo), suavizadas onde há poucas amostras.
 */
export const BENCH = {
    bruiser: table([[13, 8, 14, 6, 3, 1, 8.5], [15, 13, 24, 7, 5, 2, 14], [17, 22, 40, 8, 4, 3, 19], [19, 33, 67, 9, 5, 5, 31]]),
    horde: table([[11, 6, 11, 6, 3, 0, 6.5], [14, 10, 20, 6, 3, 1, 11.5], [16, 17, 32, 7, 4, 2, 22], [18, 26, 45, 8, 5, 3, 27]]),
    leader: table([[14, 7, 14, 6, 3, 3, 8.5], [16, 13, 26, 6, 4, 4, 15], [18, 20, 38, 8, 5, 5, 20.5], [20, 33, 66, 8, 6, 6, 32]]),
    minion: table([[10, 0, 0, 1, 1, 0, 2], [13, 0, 0, 1, 1, 1, 4], [15, 0, 0, 1, 1, 2, 7], [18, 0, 0, 1, 1, 3, 11]]),
    ranged: table([[12, 4, 7, 3, 3, 2, 7.5], [13, 7, 14, 5, 4, 3, 14], [17, 17, 30, 6, 5, 4, 19], [19, 25, 45, 6, 5, 5, 26]]),
    skulk: table([[12, 6, 11, 3, 3, 2, 6.5], [14, 8, 17, 4, 4, 3, 12], [17, 18, 34, 6, 5, 4, 16], [19, 24, 42, 7, 5, 5, 26]]),
    social: table([[12, 5, 9, 3, 3, -1, 4.5], [15, 8, 17, 3, 3, 0, 9], [17, 16, 32, 4, 4, 2, 13], [19, 25, 45, 5, 5, 3, 18]]),
    solo: table([[14, 8, 15, 8, 3, 3, 8.5], [15, 13, 25, 9, 5, 4, 15], [18, 21, 40, 10, 6, 6, 22], [20, 34, 63, 11, 7, 8, 31.5]]),
    standard: table([[12, 6, 10, 4, 3, 1, 5.5], [14, 9, 18, 5, 3, 2, 11.5], [16, 18, 35, 6, 4, 3, 15.5], [19, 25, 45, 6, 4, 4, 23]]),
    support: table([[12, 6, 11, 4, 5, 1, 5.5], [14, 9, 18, 4, 5, 2, 9], [16, 17, 33, 5, 5, 3, 12.5], [19, 27, 45, 5, 6, 4, 19]])
};

/** Valor típico de X em Lacaio (X) por patamar (o livro sugere entre 3 e 15). */
export const MINION_VALUE = { 1: 3, 2: 6, 3: 8, 4: 13 };

/** Fração do dano que a horda mantém depois de marcar metade dos PV. */
export const HORDE_RATIO = 0.5;

export const bench = (type, tier) => (BENCH[type] ?? BENCH.standard)[tier];

/** Pontos de Batalha de um encontro: (3 × personagens) + 2. */
export const battlePoints = partySize => 3 * partySize + 2;

/** Textos-modelo das habilidades obrigatórias de cada tipo. */
export const TEMPLATES = {
    minionPassive: (x, dano) => ({
        name: `Lacaio (${x})`,
        form: 'passive',
        text: `Este adversário é derrotado quando sofre qualquer dano. Para cada ${x} pontos de dano causados por um personagem a este adversário, um lacaio adicional no alcance, e que seria atingido pelo ataque, é derrotado.`
    }),
    groupAttack: (dano, tipo) => ({
        name: 'Ataque em Grupo',
        form: 'action',
        text: `Gaste 1 Ponto de Medo para escolher um alvo e pôr em foco todos os adversários com o mesmo nome deste lacaio próximos dele. Esses lacaios ficam corpo a corpo do alvo e fazem um teste de ataque compartilhado. Se acertarem, cada um causa ${dano} pontos de dano ${DAMAGE_TYPES[tipo]}. Os danos são somados.`
    }),
    horde: (dano, tipo) => ({
        name: `Horda (${dano})`,
        form: 'passive',
        text: `Quando a horda tiver marcado metade de seus Pontos de Vida ou mais, seu ataque padrão causa ${dano} pontos de dano ${DAMAGE_TYPES[tipo]}, em vez do valor original.`
    }),
    relentless: x => ({
        name: `Inclemente (${x})`,
        form: 'passive',
        text: `Este adversário pode ser posto em foco até ${x} vezes por turno do mestre. Gaste Pontos de Medo normalmente para colocá-lo em foco.`
    }),
    momentum: () => ({
        name: 'Impulso',
        form: 'reaction',
        text: 'Quando este adversário acertar um ataque contra um personagem, receba 1 Ponto de Medo.'
    })
};
