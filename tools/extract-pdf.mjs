#!/usr/bin/env node
/**
 * Extrai fichas de adversários (e suas habilidades) dos PDFs em português de Daggerheart
 * e gera a biblioteca local usada pela Forja de Antagonistas.
 *
 * Uso:
 *   node tools/extract-pdf.mjs "Livro Básico=C:/caminho/DH-Livro-Basico.pdf" "Bestiário do Medo=C:/caminho/DH-Bestiario-do-Medo.pdf"
 *
 * Requer o `pdftotext` (poppler). No Windows ele já vem junto com o Git for Windows.
 * A saída (data/library.json) contém texto dos livros e NÃO deve ser publicada: ela está no .gitignore.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPE_MAP = {
    Assistente: 'support',
    Atirador: 'ranged',
    Brutamonte: 'bruiser',
    Brutamontes: 'bruiser',
    Comum: 'standard',
    Horda: 'horde',
    Lacaio: 'minion',
    Líder: 'leader',
    Manipulador: 'social',
    Oportunista: 'skulk',
    Solo: 'solo'
};

const RANGE_MAP = [
    [/^muito distante/i, 'veryFar'],
    [/^distante/i, 'far'],
    [/^muito pr[óo]ximo/i, 'veryClose'],
    [/^pr[óo]ximo/i, 'close'],
    [/^(corpo a corpo|cac)/i, 'melee']
];

const FORM_MAP = { passiva: 'passive', ação: 'action', reação: 'reaction', montaria: 'passive', familiar: 'passive' };

const ANCHOR = new RegExp(
    `^(${Object.keys(TYPE_MAP).join('|')}) \\((\\d)\\s?[°ºªo]? ?patamar\\)(?: ?\\((\\d*)\\s?/\\s?PV\\))?\\s*(.*)$`
);
const FEATURE_START =
    /(^|[.!?”"…] )([A-ZÀ-ÖØ-Ý0-9][^:\n.!?]{0,70}?) \((passiva|ação|reação|montaria|familiar)\):\s*/g;

function findPdftotext() {
    const candidates = [
        'pdftotext',
        'C:/Program Files/Git/mingw64/bin/pdftotext.exe',
        'C:/Program Files (x86)/Git/mingw64/bin/pdftotext.exe'
    ];
    for (const bin of candidates) {
        try {
            execFileSync(bin, ['-v'], { stdio: 'ignore' });
            return bin;
        } catch (err) {
            if (err.code !== 'ENOENT') return bin; // `-v` sai com código != 0 em algumas versões
        }
    }
    throw new Error('pdftotext não encontrado. Instale o poppler ou o Git for Windows.');
}

const clean = s =>
    s
        .replace(/[−–]/g, '-')
        .replace(/\u00ad/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();

const isCaps = s => /[A-ZÀ-Ý]/.test(s) && !/[a-zà-ÿ]/.test(s) && s.length >= 2 && !/^\d+$/.test(s);
const isJunk = s => s === '' || /^\d{1,3}$/.test(s) || isCaps(s) || /^\d+ Capítulo \d|^Capítulo \d.* \d+$/.test(s);
const endsSentence = s => /[.!?”")…]$/.test(s);

function slug(s) {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function titleCase(s) {
    const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'com']);
    return s
        .toLowerCase()
        .split(' ')
        .map((w, i) =>
            i > 0 && small.has(w)
                ? w
                : w
                      .split('-')
                      .map(p => (p ? p[0].toUpperCase() + p.slice(1) : p))
                      .join('-')
        )
        .join(' ');
}

function parseRange(s) {
    for (const [re, id] of RANGE_MAP) if (re.test(s.trim())) return id;
    return 'melee';
}

// "+2d4" (bônus rolado) vira a média do dado, pois o sistema guarda um bônus fixo
function parseBonus(s) {
    const m = /^([+-]?)(\d+)(?:d(\d+))?$/.exec(s.replace(/\s/g, ''));
    const n = m[3] ? Math.round((Number(m[2]) * (Number(m[3]) + 1)) / 2) : Number(m[2]);
    return m[1] === '-' ? -n : n;
}

function parseFeatures(lines, warnings, who) {
    // Junta as linhas em parágrafos de habilidade, descartando cabeçalhos, legendas e números de página.
    const chunks = [];
    let gap = false; // houve linha em branco/cabeçalho desde o último trecho de habilidade
    for (const raw of lines) {
        const line = raw.text;
        FEATURE_START.lastIndex = 0;
        const startsFeature = FEATURE_START.test(line) && line.search(/\((passiva|ação|reação|montaria|familiar)\):/) < 90;
        FEATURE_START.lastIndex = 0;
        const m = FEATURE_START.exec(line);
        const startsAtZero = m && m.index === 0;
        FEATURE_START.lastIndex = 0;
        if (startsFeature && startsAtZero) {
            chunks.push(line);
            gap = false;
            continue;
        }
        if (isJunk(line)) {
            gap = true;
            continue;
        }
        const last = chunks[chunks.length - 1];
        if (last === undefined) continue;
        const listItem = /^(\d+[.)]|[•●▪-]) /.test(line);
        if (!gap || !endsSentence(last) || listItem || /:$/.test(last)) {
            chunks[chunks.length - 1] = `${last} ${line}`;
            gap = false;
            continue;
        }
        break; // texto que não pertence mais à ficha (barra lateral, próximo grupo etc.)
    }

    const features = [];
    for (const chunk of chunks) {
        FEATURE_START.lastIndex = 0;
        const marks = [...chunk.matchAll(FEATURE_START)];
        marks.forEach((mk, i) => {
            const start = mk.index + mk[1].length;
            const bodyStart = mk.index + mk[0].length;
            const end = i + 1 < marks.length ? marks[i + 1].index + marks[i + 1][1].length : chunk.length;
            const name = chunk.slice(start, bodyStart).replace(/ \((passiva|ação|reação|montaria|familiar)\):\s*$/, '');
            const text = chunk.slice(bodyStart, end).trim();
            const kind = mk[3];
            const feature = { name: name.trim(), form: FORM_MAP[kind], text: text.charAt(0).toUpperCase() + text.slice(1) };
            if (kind === 'montaria' || kind === 'familiar') feature.tag = kind;
            if (!text) warnings.push(`${who}: habilidade "${name}" sem texto`);
            features.push(feature);
        });
    }
    return features;
}

function parseSource(label, file, bin) {
    const text = execFileSync(bin, ['-enc', 'UTF-8', file, '-'], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
    const lines = [];
    text.split('\f').forEach((page, p) => {
        for (const l of page.split(/\r?\n/)) lines.push({ text: clean(l), page: p + 1 });
    });

    const anchors = [];
    lines.forEach((l, i) => {
        const m = ANCHOR.exec(l.text);
        if (!m) return;
        // nome: linhas em maiúsculas imediatamente acima
        let j = i - 1;
        while (j >= 0 && lines[j].text === '' && i - j <= 2) j--;
        const nameLines = [];
        const joins = (above, below) => /(,|-| (DE|DA|DO|DAS|DOS|E|A|O))$/.test(above) || /^(\(|(DE|DA|DO|DAS|DOS|E) )/.test(below);
        while (j >= 0 && isCaps(lines[j].text) && nameLines.length < 3) {
            if (nameLines.length && !joins(lines[j].text, nameLines[0])) break;
            nameLines.unshift(lines[j--].text);
        }
        if (!nameLines.length) return;
        anchors.push({ i, nameStart: j + 1, name: nameLines.join(' ').replace(/- -/g, '-'), m });
    });

    const out = [];
    const warnings = [];
    anchors.forEach((a, k) => {
        const limit = k + 1 < anchors.length ? anchors[k + 1].nameStart : Math.min(lines.length, a.i + 120);
        const who = `${label} p.${lines[a.i].page} ${a.name}`;
        let i = a.i;
        const intro = [a.m[4]];
        i++;
        while (i < limit && !/Dificuldade:/.test(lines[i].text) && i - a.i < 25) intro.push(lines[i++].text);
        if (i >= limit || !/Dificuldade:/.test(lines[i].text)) return; // não é uma ficha (ex.: lista)

        let stats = '';
        const statsStart = i;
        while (i < limit && i - statsStart < 4 && !/HABILIDADES|^Experiências?:/.test(lines[i].text)) stats += ` ${lines[i++].text}`;
        const diff = /Dificuldade: (\d+)/.exec(stats);
        const thr = /Limiar(?:es)?: (\d+)\s?\/\s?(\d+|None|nenhum)/i.exec(stats);
        const hp = /(\d+) PV|PV (\d+)/.exec(stats);
        const stress = /(\d+) PF|PF (\d+)/.exec(stats);
        const atk = /ATQ: ([+-]?\s?\d+(?:d\d+)?) \| ([^|:]+): ([^|]+) \| (\d+d\d+(?:\s?[+-]\s?\d+)?|\d+)\s*(f[íi]s|m[áa]g)/i.exec(stats);
        if (!diff || !hp || !atk) {
            warnings.push(`${who}: linha de estatísticas não reconhecida -> ${stats.trim().slice(0, 140)}`);
            return;
        }

        let expText = '';
        while (i < limit && !/^HABILIDADES/.test(lines[i].text) && i - statsStart < 12) expText += ` ${lines[i++].text}`;
        const experiences = [];
        const em = /Experiências?: (.*)$/.exec(expText.trim());
        if (em)
            for (const part of em[1].split(/,\s*/)) {
                const pm = /^(.+?)\s*([+-]\d+)$/.exec(part.trim());
                if (pm) experiences.push({ name: pm[1].trim(), value: Number(pm[2]) });
            }

        let features = [];
        if (i < limit && /^HABILIDADES/.test(lines[i].text)) {
            const first = { ...lines[i], text: lines[i].text.replace(/^HABILIDADES\s*/, '') };
            features = parseFeatures([first, ...lines.slice(i + 1, limit)], warnings, who);
        }
        else warnings.push(`${who}: seção HABILIDADES não encontrada`);

        const introText = intro.join(' ').replace(/\s+/g, ' ').trim();
        const [description, motives = ''] = introText.split(/Motivações e táticas:\s*/);
        const type = TYPE_MAP[a.m[1]];
        const name = titleCase(a.name);
        out.push({
            id: `${slug(label)}:${slug(name)}`,
            name,
            source: label,
            page: lines[a.i].page,
            tier: Number(a.m[2]),
            type,
            hordeHp: type === 'horde' ? Number(a.m[3]) || 1 : undefined,
            description: description.trim(),
            motives: motives.trim(),
            difficulty: Number(diff[1]),
            major: thr ? Number(thr[1]) : 0,
            severe: thr && /^\d+$/.test(thr[2]) ? Number(thr[2]) : 0,
            hp: Number(hp[1] ?? hp[2]),
            stress: stress ? Number(stress[1] ?? stress[2]) : 0,
            attack: {
                bonus: parseBonus(atk[1]),
                name: atk[2].trim(),
                range: parseRange(atk[3]),
                damage: atk[4].replace(/\s/g, ''),
                damageType: /^f/i.test(atk[5]) ? 'physical' : 'magical'
            },
            experiences,
            features
        });
    });

    // fichas repetidas (exemplos arquetípicos reaparecem na lista): mantém a mais completa
    const byId = new Map();
    for (const adv of out) {
        const prev = byId.get(adv.id);
        if (!prev || adv.features.length >= prev.features.length) byId.set(adv.id, adv); // empate: fica a da lista de fichas
    }
    return { adversaries: [...byId.values()], warnings };
}

function main() {
    const args = process.argv.slice(2);
    if (!args.length) {
        console.error('Uso: node tools/extract-pdf.mjs "Nome da Fonte=caminho/arquivo.pdf" [...]');
        process.exit(1);
    }
    const bin = findPdftotext();
    const library = { format: 1, generatedAt: new Date().toISOString(), sources: [], adversaries: [] };
    for (const arg of args) {
        const eq = arg.indexOf('=');
        const label = eq > 0 ? arg.slice(0, eq) : arg.replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
        const file = eq > 0 ? arg.slice(eq + 1) : arg;
        if (!existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
        const { adversaries, warnings } = parseSource(label, file, bin);
        library.sources.push(label);
        library.adversaries.push(...adversaries);
        const nFeat = adversaries.reduce((n, a) => n + a.features.length, 0);
        console.log(`${label}: ${adversaries.length} adversários, ${nFeat} habilidades`);
        for (const w of warnings) console.warn(`  aviso: ${w}`);
    }
    const outFile = resolve(ROOT, 'data', 'library.json');
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(library, null, 1), 'utf8');
    console.log(`Biblioteca gravada em ${outFile}`);
}

main();
