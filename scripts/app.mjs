/**
 * Interface da Forja de Antagonistas. Roda tanto dentro do Foundry (janela do módulo)
 * quanto como página avulsa; o `host` isola o que muda entre os dois ambientes.
 */
import { DAMAGE_ABBR, DAMAGE_TYPES, ENV_BENCH, ENV_TYPES, FORMS, IMPROVISED, RANGES, TEMPLATES, TIERS, TIER_LEVELS, TRAITS, TYPES, bench, isEnvironment } from './core/rules.mjs';
import { average } from './core/dice.mjs';
import { adaptFeature, applyBenchmark, blankAdversary, blankEnvironment, compareToBenchmark, ensureTypeFeatures, newFeature, scaleEntity } from './core/scale.mjs';
import { deriveFx, toFoundryActor } from './core/foundry-data.mjs';
import { ART_LOCAL, ART_MODULE, ART_RAW, TOKEN_MODES, applyArt, applyImage, artFiles, bestOf, clearArt, isDefaultImage, nameFromPath, previewUrl, setImagePart, suggestArt, suggestImages } from './core/art.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = o => JSON.parse(JSON.stringify(o));
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const options = (map, selected, label = v => v) =>
    Object.entries(map)
        .map(([id, v]) => `<option value="${esc(id)}" ${String(id) === String(selected) ? 'selected' : ''}>${esc(label(v))}</option>`)
        .join('');
const uid = () => Math.random().toString(36).slice(2, 10);
const PAGE = 60;

export async function mountForge(root, host, { initial } = {}) {
    const state = {
        library: { adversaries: [], environments: [], sources: [] },
        mine: { adversaries: [], environments: [], features: [] },
        current: null,
        undo: null,
        lastScale: null,
        tab: 'adversaries',
        query: '',
        filters: { tier: '', type: '', source: '', form: '' },
        limit: PAGE,
        adapt: true,
        artIndex: null,
        artOpen: false,
        artQuery: '',
        artSource: '',
        artLimit: 120,
        foundryArt: null,
        artFiles: null,
        artScan: null,
        artPrefs: { token: 'wildcard', ring: false, source: 'module' }
    };

    /* ---------- dados ---------- */

    const stored = await host.storage.get('library');
    const fixLibrary = () => (state.library.environments ??= []); // bibliotecas geradas antes dos ambientes
    if (stored?.adversaries?.length) state.library = stored;
    else if (host.libraryUrl) {
        try {
            const res = await fetch(host.libraryUrl);
            if (res.ok) state.library = await res.json();
        } catch {
            /* sem biblioteca local: a ferramenta funciona só com as criações do usuário */
        }
    }
    fixLibrary();
    try {
        const res = host.artIndexUrl && (await fetch(host.artIndexUrl));
        if (res?.ok) state.artIndex = await res.json();
    } catch {
        /* sem índice de artes: a galeria fica indisponível */
    }
    if (host.kind === 'browser') Object.assign(state.artPrefs, (await host.storage.get('art')) ?? {});
    state.mine = { adversaries: [], environments: [], features: [], ...((await host.storage.get('mine')) ?? {}) };
    state.current = initial ?? (await host.storage.get('draft')) ?? blankAdversary();
    normalize(state.current);

    function normalize(adv) {
        adv.features ??= [];
        adv.features.forEach(f => (f.key ??= uid()));
        if (isEnvironment(adv)) {
            adv.incident ??= { name: '', text: '' };
            adv.adversaries ??= '';
            adv.difficultyNote ??= '';
            return adv;
        }
        adv.experiences ??= [];
        adv.hordeHp ??= 1;
        return adv;
    }

    let draftTimer;
    const saveDraft = () => {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => host.storage.set('draft', state.current), 400);
    };
    const saveMine = () => host.storage.set('mine', state.mine);

    const allAdversaries = () => [...state.mine.adversaries, ...state.library.adversaries];
    const allEnvironments = () => [...state.mine.environments, ...state.library.environments];
    /* ---------- artes: Art for Daggerheart e, no Foundry, qualquer imagem ---------- */

    const inFoundry = host.kind === 'foundry';
    /** No Foundry decide pelo módulo estar ativo; na página avulsa, o usuário escolhe. */
    const artBase = () => ((inFoundry ? host.artModuleActive : state.artPrefs.source === 'module') ? ART_LOCAL : ART_RAW(state.artIndex));
    const shown = path => previewUrl(path, state.artIndex, { inFoundry });
    /** Estatísticas para comparar: as da ficha original da biblioteca, se a atual mudou de patamar ou foi editada. */
    const artStats = adv => state.library.adversaries.find(a => a.id === adv.baseId) ?? adv;
    const artImage = name => state.artIndex?.images.find(i => i.name === name);
    const ART_PAGE = 120;

    /** Lista única de artes (Art for Daggerheart, compêndios, atores do mundo e arquivos varridos), por chave. */
    let artList = [];
    let artMap = new Map();
    function rebuildArtList() {
        const thumbBase = inFoundry && host.artModuleActive ? ART_LOCAL : ART_RAW(state.artIndex);
        const afd = (state.artIndex?.images ?? []).map(image => {
            const files = artFiles(image, thumbBase);
            return { key: `afd:${image.name}`, kind: 'afd', name: image.name, source: 'Art for Daggerheart', thumb: files.circle ?? files.portrait };
        });
        // a arte de compêndio do próprio Art for Daggerheart já está na lista acima
        const foundryArt = (state.foundryArt ?? []).filter(e => !e.img.includes(`/${ART_MODULE}/`)).map(e => ({ ...e, kind: 'image', thumb: e.img }));
        const known = new Set(foundryArt.map(e => e.img));
        const files = (state.artFiles ?? [])
            .filter(f => !known.has(f.path) && !f.path.includes(`/${ART_MODULE}/`))
            .map(f => ({ key: `file:${f.path}`, kind: 'image', name: nameFromPath(f.path), source: f.source, img: f.path, token: null, thumb: f.path, file: true }));
        artList = [...afd, ...foundryArt, ...files];
        artMap = new Map(artList.map(e => [e.key, e]));
    }

    /** Sugestões de todas as fontes, da mais provável para a menos. */
    function artSuggestions(a) {
        const stats = artStats(a);
        const afd = suggestArt(a, state.artIndex, { stats }).map(s => ({
            ...s,
            entry: artMap.get(`afd:${s.image.name}`),
            label: s.compendium === s.image.name ? s.reason : `${s.compendium} · ${s.reason}`
        }));
        const others = suggestImages(a, artList.filter(e => e.stats), { stats }).map(s => ({ ...s, label: `${s.entry.source} · ${s.reason}` }));
        return [...afd, ...others].filter(s => s.entry).sort((x, y) => y.score - x.score).slice(0, 8);
    }

    function useArt(key) {
        const entry = artMap.get(key);
        if (!entry) return;
        if (entry.kind === 'afd') applyArt(state.current, artImage(entry.name), { base: artBase(), token: state.artPrefs.token, ring: state.artPrefs.ring });
        else applyImage(state.current, entry, { ring: state.artPrefs.ring });
        state.artOpen = false;
        setCurrent(state.current, { keepUndo: true });
        renderArt();
    }

    /** Reaplica a arte atual com as opções novas de token e anel. */
    function reapplyArt() {
        const art = state.current.art;
        if (!art) return;
        if (art.kind === 'image') {
            art.ring = state.artPrefs.ring;
            if (state.current.token) state.current.token.ring = art.ring;
        } else {
            const image = artImage(art.name);
            if (!image) return;
            applyArt(state.current, image, { base: artBase(), token: state.artPrefs.token, ring: state.artPrefs.ring });
        }
        setCurrent(state.current, { keepUndo: true });
    }

    function artCard(entry, extra = '') {
        const a = state.current.art;
        const on = a && (entry.kind === 'afd' ? a.kind !== 'image' && a.name === entry.name : a.kind === 'image' && a.img === entry.img);
        const title = `${entry.name} — ${entry.source}${entry.file ? `\n${entry.img}` : ''}`;
        return `<button class="dhf-art-card ${on ? 'on' : ''}" data-act="art-pick" data-key="${esc(entry.key)}" title="${esc(title)}">
            <img loading="lazy" src="${esc(shown(entry.thumb))}" alt="">
            <span>${esc(entry.name)}</span>${extra || `<small>${esc(entry.source)}</small>`}</button>`;
    }

    function artMatches() {
        const q = fold(state.artQuery);
        const src = state.artSource;
        return artList.filter(e => (!src || e.source === src) && (!q || fold(`${e.name} ${e.source} ${e.file ? e.img : ''}`).includes(q)));
    }

    function artGrid() {
        const list = artMatches();
        if (!list.length) return '<p class="dhf-muted">Nenhuma arte encontrada.</p>';
        const page = list.slice(0, state.artLimit);
        return `${page.map(e => artCard(e)).join('')}
            ${list.length > page.length ? `<button class="dhf-more" data-act="art-more">Mostrar mais (${list.length - page.length})</button>` : ''}`;
    }

    function renderArtGrid() {
        const grid = root.querySelector('[data-art-grid]');
        if (grid) grid.innerHTML = artGrid();
        const count = root.querySelector('[data-art-count]');
        if (count) count.textContent = `${artMatches().length} artes`;
    }

    function foundrySources() {
        if (!inFoundry)
            return '<p class="dhf-muted">Fora do Foundry só as artes do Art for Daggerheart estão disponíveis. Dentro do Foundry a Forja também procura nos compêndios, nos atores do mundo e nos arquivos dos módulos.</p>';
        const files =
            state.artScan !== null
                ? `<span class="dhf-muted" data-art-scan>Procurando… ${state.artScan} imagens</span>`
                : state.artFiles
                  ? `<span class="dhf-muted">${state.artFiles.length} imagens nos arquivos</span> <button data-act="art-scan">Procurar de novo</button>`
                  : '<button data-act="art-scan" title="Módulos ativos, pasta do mundo e suas pastas em Data">Procurar nos arquivos dos módulos</button>';
        return `<div class="dhf-art-opts">
            ${state.foundryArt ? '' : '<span class="dhf-muted">Lendo compêndios…</span>'}
            ${files}
            <span class="dhf-spacer"></span>
            <span class="dhf-muted">Navegador de arquivos:</span>
            <button data-act="art-file" data-part="img">Retrato…</button>
            <button data-act="art-file" data-part="token">Token…</button>
          </div>`;
    }

    function renderArt() {
        const region = root.querySelector('[data-region="art"]');
        if (!state.artOpen || isEnvironment(state.current)) return void (region.innerHTML = '');
        const a = state.current;
        const idx = state.artIndex;
        const suggestions = artSuggestions(a);
        const p = state.artPrefs;
        const sourceNote = inFoundry
            ? host.artModuleActive
                ? ''
                : '<p class="dhf-muted">O módulo <em>Art for Daggerheart</em> não está ativo neste mundo: as artes dele serão ligadas pelo GitHub (precisam de internet) e o token usa uma única variação. Instale e ative o módulo para usar os arquivos locais.</p>'
            : `<label>Imagens do Art for Daggerheart<select data-art-opt="source">${options({ module: 'Arquivos do módulo (instalado no Foundry)', url: 'Links do GitHub (sem instalar o módulo)' }, p.source)}</select></label>`;
        const sources = [...new Set(artList.map(e => e.source))];
        region.innerHTML = `<div class="dhf-modal" data-act="art-close">
            <div class="dhf-modal-box">
              <header><h3>Arte de “${esc(a.name)}”</h3><span class="dhf-spacer"></span><button data-act="art-close" title="Fechar (Esc)">✕</button></header>
              <div class="dhf-art-opts">
                <label title="Vale para as artes do Art for Daggerheart; as outras usam o token que já têm, ou o retrato">Token do Art for Daggerheart<select data-art-opt="token">${options(TOKEN_MODES, p.token)}</select></label>
                <label class="dhf-check"><input type="checkbox" data-art-opt="ring" ${p.ring ? 'checked' : ''}> anel de token do Foundry</label>
                ${inFoundry ? '' : sourceNote}
                ${a.art || !isDefaultImage(a.img) || a.token ? '<button data-act="art-clear">Remover arte</button>' : ''}
              </div>
              ${inFoundry ? sourceNote : ''}
              ${foundrySources()}
              ${
                  suggestions.length
                      ? `<h4>Sugestões</h4>
                         <div class="dhf-art-grid">${suggestions.map(s => artCard(s.entry, `<small>${esc(s.label)}</small>`)).join('')}</div>`
                      : '<p class="dhf-muted">Nenhum adversário conhecido tem estatísticas parecidas com esta ficha. Procure pelo nome (as artes estão em inglês).</p>'
              }
              <h4>Todas as artes
                <input type="search" data-art-query placeholder="Buscar por nome, fonte ou pasta (ex.: skeleton, goblin)…" value="${esc(state.artQuery)}">
                <select data-art-source><option value="">Todas as fontes</option>${options(Object.fromEntries(sources.map(x => [x, x])), state.artSource)}</select>
                <span class="dhf-muted" data-art-count>${artMatches().length} artes</span>
              </h4>
              <div class="dhf-art-grid" data-art-grid>${artGrid()}</div>
              <p class="dhf-muted">Artes do módulo <a href="https://github.com/mordachai/art-for-daggerheart" target="_blank" rel="noopener">Art for Daggerheart</a> ${esc(idx?.art?.ref ?? '')} (Mordachai, geradas por IA, domínio público CC0). As demais pertencem aos módulos de onde vêm.</p>
            </div></div>`;
    }

    function artRow(a) {
        if (!state.artIndex && !inFoundry) return '';
        const hint = !a.art && isDefaultImage(a.img) ? bestOf(artSuggestions(a)) : null;
        const label = a.art ? (a.art.kind === 'image' ? `${a.art.name} · ${a.art.source}` : `${a.art.name} · token: ${TOKEN_MODES[a.art.token]}`) : '';
        return `<div class="dhf-art-row" data-art-row>
            ${isDefaultImage(a.img) ? '<div class="dhf-portrait dhf-portrait-empty">?</div>' : `<img class="dhf-portrait" src="${esc(shown(a.img))}" alt="">`}
            <div>
              <button data-act="art-open">${a.art || !isDefaultImage(a.img) ? 'Trocar arte…' : 'Escolher arte…'}</button>
              ${label ? `<span class="dhf-muted">${esc(label)}${a.art.ring ? ' · com anel' : ''}</span>` : ''}
              ${
                  hint
                      ? `<div class="dhf-art-hint"><img src="${esc(shown(hint.entry.thumb))}" alt="">
                         <span>Sugestão: <strong>${esc(hint.entry.name)}</strong> <span class="dhf-muted">(${esc(hint.label)})</span></span>
                         <button class="dhf-primary" data-act="art-pick" data-key="${esc(hint.entry.key)}">Usar</button></div>`
                      : ''
              }
            </div>
          </div>`;
    }

    function refreshArtRow() {
        const row = root.querySelector('[data-art-row]');
        if (row && !isEnvironment(state.current)) row.outerHTML = artRow(state.current);
    }

    const typeLabel = e => (isEnvironment(e) ? ENV_TYPES[e.type]?.label : TYPES[e.type]?.label) ?? e.type;

    /** Habilidades únicas (nome + texto), com a origem de onde foram tiradas. */
    function allFeatures() {
        const map = new Map();
        for (const f of state.mine.features)
            map.set(`meu|${f.key}`, { ...f, origin: { kind: f.kind, name: 'Minhas habilidades', tier: f.tier ?? 1, type: f.type ?? 'standard', source: 'Meus antagonistas' }, mine: true, count: 1 });
        for (const adv of [...allAdversaries(), ...allEnvironments()])
            for (const f of adv.features) {
                const key = `${fold(f.name)}|${fold(f.text)}`;
                const prev = map.get(key);
                if (prev) prev.count++;
                else map.set(key, { ...f, origin: { kind: adv.kind, name: adv.name, tier: adv.tier, type: adv.type, source: adv.source }, count: 1 });
            }
        return [...map.values()];
    }

    /* ---------- biblioteca (coluna esquerda) ---------- */

    function filtered() {
        const q = fold(state.query);
        const { tier, type, source, form } = state.filters;
        if (state.tab === 'environments')
            return allEnvironments().filter(
                e =>
                    (!tier || e.tier === Number(tier)) &&
                    (!type || e.type === type) &&
                    (!source || e.source === source) &&
                    (!q || fold(`${e.name} ${e.impulses} ${e.adversaries} ${e.features.map(f => f.name).join(' ')}`).includes(q))
            );
        if (state.tab === 'adversaries')
            return allAdversaries().filter(
                a =>
                    (!tier || a.tier === Number(tier)) &&
                    (!type || a.type === type) &&
                    (!source || a.source === source) &&
                    (!q || fold(`${a.name} ${a.motives} ${a.features.map(f => f.name).join(' ')}`).includes(q))
            );
        return allFeatures().filter(
            f =>
                (!tier || f.origin.tier === Number(tier)) &&
                (!type || f.origin.type === type) &&
                (!source || f.origin.source === source) &&
                (!form || f.form === form) &&
                (!q || fold(`${f.name} ${f.text} ${f.origin.name}`).includes(q))
        );
    }

    function renderLibrary() {
        const sources = [...new Set(['Meus antagonistas', ...(state.library.sources ?? []), ...state.library.adversaries.map(a => a.source)])];
        const items = filtered();
        const shown = items.slice(0, state.limit);
        const list =
            state.tab === 'environments'
                ? shown
                      .map(
                          e => `<li class="dhf-item" data-act="load" data-id="${esc(e.id)}" title="Carregar como base">
                            <div class="dhf-item-head"><strong>${esc(e.name)}</strong><span class="dhf-tier">${e.tier}º</span></div>
                            <div class="dhf-meta">${esc(typeLabel(e))} · Dif ${e.difficulty ?? 'especial'} · ${e.features.length} habilidades · ${esc(e.source)}</div>
                          </li>`
                      )
                      .join('')
                : state.tab === 'adversaries'
                ? shown
                      .map(
                          a => `<li class="dhf-item" data-act="load" data-id="${esc(a.id)}" title="Carregar como base">
                            <div class="dhf-item-head"><strong>${esc(a.name)}</strong><span class="dhf-tier">${a.tier}º</span></div>
                            <div class="dhf-meta">${esc(TYPES[a.type]?.label ?? a.type)} · Dif ${a.difficulty} · ${a.hp} PV · ${esc(a.attack.damage)} · ${esc(a.source)}</div>
                          </li>`
                      )
                      .join('')
                : shown
                      .map(
                          (f, i) => `<li class="dhf-item dhf-feat">
                            <div class="dhf-item-head"><strong>${esc(f.name)}</strong><span class="dhf-form dhf-form-${f.form}">${FORMS[f.form]}</span></div>
                            <div class="dhf-text">${esc(f.text)}</div>
                            <div class="dhf-meta">${esc(f.origin.name)} · ${f.origin.tier}º patamar${f.count > 1 ? ` · em ${f.count} fichas` : ''}
                              <span class="dhf-spacer"></span>
                              ${f.mine ? `<button data-act="del-my-feature" data-key="${esc(f.key)}" title="Excluir de Minhas habilidades">✕</button>` : ''}
                              <button class="dhf-primary" data-act="add-feature" data-i="${i}">+ Adicionar</button></div>
                          </li>`
                      )
                      .join('');
        const empty = !state.library.adversaries.length
            ? `<div class="dhf-empty"><p><strong>Biblioteca dos livros não carregada.</strong></p>
               <p>Gere o arquivo <code>data/library.json</code> a partir dos seus PDFs com <code>npm run extract</code> (veja o README) e clique em <em>Importar biblioteca</em>.</p>
               <p>Enquanto isso você pode criar antagonistas do zero e salvar suas próprias habilidades.</p></div>`
            : '';
        root.querySelector('[data-region="library"]').innerHTML = `
            <div class="dhf-tabs">
              <button class="${state.tab === 'adversaries' ? 'on' : ''}" data-act="tab" data-tab="adversaries">Adversários</button>
              <button class="${state.tab === 'environments' ? 'on' : ''}" data-act="tab" data-tab="environments">Ambientes</button>
              <button class="${state.tab === 'features' ? 'on' : ''}" data-act="tab" data-tab="features">Habilidades</button>
            </div>
            <input class="dhf-search" type="search" placeholder="Buscar por nome, texto, origem…" value="${esc(state.query)}" data-filter="query">
            <div class="dhf-filters">
              <select data-filter="tier"><option value="">Patamar</option>${options(Object.fromEntries(TIERS.map(t => [t, `${t}º`])), state.filters.tier)}</select>
              <select data-filter="type"><option value="">Tipo</option>${options(state.tab === 'environments' ? ENV_TYPES : TYPES, state.filters.type, t => t.label)}</select>
              ${state.tab === 'features' ? `<select data-filter="form"><option value="">Forma</option>${options(FORMS, state.filters.form)}</select>` : ''}
              <select data-filter="source"><option value="">Fonte</option>${options(Object.fromEntries(sources.map(s => [s, s])), state.filters.source)}</select>
            </div>
            ${state.tab === 'features' ? `<label class="dhf-check"><input type="checkbox" data-filter="adapt" ${state.adapt ? 'checked' : ''}> ajustar dano e Dificuldade ao patamar da ficha ao adicionar</label>` : ''}
            <div class="dhf-count">${items.length} resultado${items.length === 1 ? '' : 's'}</div>
            ${empty}
            <ul class="dhf-list" data-list>${list}</ul>
            ${items.length > shown.length ? `<button class="dhf-more" data-act="more">Mostrar mais (${items.length - shown.length})</button>` : ''}`;
        libraryCache = shown;
    }
    let libraryCache = [];

    /* ---------- editor (coluna central) ---------- */

    function chips(feature) {
        const fx = deriveFx(feature, state.current);
        const out = [];
        if (fx.kind === 'none') out.push('<span class="dhf-chip dhf-muted">só texto</span>');
        else out.push(`<span class="dhf-chip">${{ attack: 'ataque', save: 'teste de reação', damage: 'dano', effect: 'efeito' }[fx.kind]}</span>`);
        if (fx.stress) out.push(`<span class="dhf-chip">${fx.stress} Fadiga</span>`);
        if (fx.fear) out.push(`<span class="dhf-chip dhf-fear">${fx.fear} Medo</span>`);
        if (fx.kind !== 'none' && fx.kind !== 'effect') {
            if (fx.damage) out.push(`<span class="dhf-chip">${esc(fx.damage)} ${DAMAGE_ABBR[fx.damageType]}${fx.direct ? ' direto' : ''}</span>`);
            if (fx.save) out.push(`<span class="dhf-chip">${TRAITS[fx.save]}</span>`);
            if (fx.range) out.push(`<span class="dhf-chip">${RANGES[fx.range]}</span>`);
        }
        return out.join('');
    }

    function featureCard(f, i, total) {
        const fx = deriveFx(f, state.current);
        return `<div class="dhf-feature" data-fi="${i}">
            <div class="dhf-row">
              <input class="dhf-grow" data-ff="name" value="${esc(f.name)}" placeholder="Nome da habilidade">
              <select data-ff="form">${options(FORMS, f.form)}</select>
              <button data-act="feat-up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-act="feat-down" title="Descer" ${i === total - 1 ? 'disabled' : ''}>↓</button>
              <button data-act="feat-save" title="Guardar em Minhas habilidades">★</button>
              <button data-act="feat-del" title="Remover">✕</button>
            </div>
            <textarea data-ff="text" rows="3" placeholder="Texto da habilidade. Custos como “marque 1 Ponto de Fadiga”, danos como “2d6+3 pontos de dano físico” e testes de reação são reconhecidos automaticamente.">${esc(f.text)}</textarea>
            ${isEnvironment(state.current) ? `<textarea data-ff="questions" rows="2" placeholder="Perguntas de inspiração (opcional): O que há no fundo do rio? Quem já passou por aqui?">${esc(f.questions ?? '')}</textarea>` : ''}
            <details ${f.fx ? 'open' : ''}>
              <summary>No Foundry: <span data-chips>${chips(f)}</span></summary>
              <div class="dhf-fx">
                <label>Ação<select data-fx="kind">${options({ none: 'só texto', effect: 'efeito (custo)', damage: 'dano', attack: 'ataque', save: 'teste de reação' }, fx.kind)}</select></label>
                <label>Fadiga<input type="number" min="0" data-fx="stress" value="${fx.stress}"></label>
                <label>Medo<input type="number" min="0" data-fx="fear" value="${fx.fear}"></label>
                <label>Dano<input data-fx="damage" value="${esc(fx.damage)}" placeholder="2d6+3"></label>
                <label>Tipo<select data-fx="damageType">${options(DAMAGE_TYPES, fx.damageType)}</select></label>
                <label>Alcance<select data-fx="range"><option value="">—</option>${options(RANGES, fx.range)}</select></label>
                <label>Teste<select data-fx="save"><option value="">—</option>${options(TRAITS, fx.save)}</select></label>
                <label class="dhf-check"><input type="checkbox" data-fx="direct" ${fx.direct ? 'checked' : ''}> dano direto</label>
                ${f.fx ? '<button data-act="fx-reset">Voltar ao automático</button>' : ''}
              </div>
            </details>
          </div>`;
    }

    function renderEnvironmentEditor() {
        const e = state.current;
        const b = ENV_BENCH[e.tier];
        root.querySelector('[data-region="editor"]').innerHTML = `
            <section>
              <div class="dhf-row">
                <label class="dhf-grow">Nome do ambiente<input data-f="name" value="${esc(e.name)}"></label>
                <label>Patamar<select data-f="tier" data-num data-rerender>${options(Object.fromEntries(TIERS.map(t => [t, `${t}º (${TIER_LEVELS[t]})`])), e.tier)}</select></label>
                <label>Tipo<select data-f="type" data-rerender>${options(ENV_TYPES, e.type, t => t.label)}</select></label>
              </div>
              <div class="dhf-hint">
                <p><strong>${esc(ENV_TYPES[e.type].label)}:</strong> ${esc(ENV_TYPES[e.type].hint)}</p>
                <p>Ambientes do ${e.tier}º patamar (tabela do livro): Dificuldade ${b.difficulty} · dano das habilidades de ${b.damageRange}.</p>
                <button data-act="benchmark">Aplicar Dificuldade típica</button>
              </div>
              <label>Descrição<textarea data-f="description" rows="2">${esc(e.description)}</textarea></label>
              <label>Impulsos<input data-f="impulses" value="${esc(e.impulses)}" placeholder="arrastar despreparados, dividir a terra…"></label>
              <div class="dhf-row">
                <label class="dhf-narrow">Dificuldade<input type="number" data-f="difficulty" data-nullable value="${e.difficulty ?? ''}" placeholder="—"></label>
                <label class="dhf-grow">Dificuldade especial (se não for um número)<input data-f="difficultyNote" value="${esc(e.difficultyNote)}" placeholder="Ex.: igual à do adversário com a Dificuldade mais alta"></label>
              </div>
              <label>Adversários sugeridos<input data-f="adversaries" value="${esc(e.adversaries)}" placeholder="feras (urso, cobra-de-vidro), bandidos…"></label>
            </section>

            <section>
              <h3>Habilidades <button data-act="feat-add">+ Nova habilidade</button></h3>
              <p class="dhf-muted">Use a aba <em>Habilidades</em> da biblioteca para reaproveitar habilidades de outros ambientes ou de adversários.</p>
              ${e.features.map((f, i) => featureCard(f, i, e.features.length)).join('')}
            </section>

            <section>
              <h3>Incidente incitante <span class="dhf-muted">(opcional — vai para as Notas no Foundry)</span></h3>
              <label>Título<input data-f="incident.name" value="${esc(e.incident.name)}"></label>
              <label>Gancho de aventura<textarea data-f="incident.text" rows="5">${esc(e.incident.text)}</textarea></label>
            </section>`;
    }

    function renderEditor() {
        if (isEnvironment(state.current)) return renderEnvironmentEditor();
        const a = state.current;
        const b = bench(a.type, a.tier);
        const imp = IMPROVISED[a.tier];
        const isMinion = a.type === 'minion';
        root.querySelector('[data-region="editor"]').innerHTML = `
            <section>
              ${artRow(a)}
              <div class="dhf-row">
                <label class="dhf-grow">Nome<input data-f="name" value="${esc(a.name)}"></label>
                <label>Patamar<select data-f="tier" data-num data-rerender>${options(Object.fromEntries(TIERS.map(t => [t, `${t}º (${TIER_LEVELS[t]})`])), a.tier)}</select></label>
                <label>Tipo<select data-f="type" data-rerender>${options(TYPES, a.type, t => t.label)}</select></label>
                ${a.type === 'horde' ? `<label title="Quantas criaturas cada PV representa">Criaturas/PV<input type="number" min="1" data-f="hordeHp" data-num value="${a.hordeHp}"></label>` : ''}
              </div>
              <div class="dhf-hint">
                <p><strong>${esc(TYPES[a.type].label)}:</strong> ${esc(TYPES[a.type].hint)}</p>
                <p>Típico no ${a.tier}º patamar: Dif ${b.difficulty}${isMinion ? '' : ` · limiares ${b.major}/${b.severe} · ${b.hp} PV · ${b.stress} PF`} · ATQ ${signed(b.attack)} · dano médio ${b.damage}.
                   <span class="dhf-muted">Tabela de improviso do livro: ATQ ${signed(imp.attack)}, dano ${imp.damage}, Dif ${imp.difficulty}, limiares ${imp.major}/${imp.severe}.</span></p>
                <button data-act="benchmark">Aplicar valores típicos</button>
              </div>
              <label>Descrição<textarea data-f="description" rows="2">${esc(a.description)}</textarea></label>
              <label>Motivações e táticas<input data-f="motives" value="${esc(a.motives)}" placeholder="emboscar, fugir, proteger…"></label>
            </section>

            <section>
              <h3>Estatísticas</h3>
              <div class="dhf-grid">
                <label>Dificuldade<input type="number" data-f="difficulty" data-num value="${a.difficulty}"></label>
                <label>Limiar maior<input type="number" data-f="major" data-num value="${a.major}" ${isMinion ? 'disabled' : ''}></label>
                <label>Limiar grave<input type="number" data-f="severe" data-num value="${a.severe}" ${isMinion ? 'disabled' : ''}></label>
                <label>PV<input type="number" min="1" data-f="hp" data-num value="${a.hp}"></label>
                <label>PF<input type="number" min="0" data-f="stress" data-num value="${a.stress}"></label>
              </div>
              <h3>Ataque padrão</h3>
              <div class="dhf-row">
                <label class="dhf-narrow">ATQ<input type="number" data-f="attack.bonus" data-num value="${a.attack.bonus}"></label>
                <label class="dhf-grow">Nome<input data-f="attack.name" value="${esc(a.attack.name)}"></label>
                <label>Alcance<select data-f="attack.range">${options(RANGES, a.attack.range)}</select></label>
                <label class="dhf-narrow">Dano<input data-f="attack.damage" value="${esc(a.attack.damage)}" placeholder="1d8+2"></label>
                <label>Tipo<select data-f="attack.damageType">${options(DAMAGE_TYPES, a.attack.damageType)}</select></label>
              </div>
            </section>

            <section>
              <h3>Experiências <button data-act="exp-add">+ Experiência</button></h3>
              ${a.experiences
                  .map(
                      (e, i) => `<div class="dhf-row" data-ei="${i}">
                        <input class="dhf-grow" data-ef="name" value="${esc(e.name)}" placeholder="Ex.: Emboscada">
                        <input class="dhf-narrow" type="number" data-ef="value" value="${e.value}">
                        <button data-act="exp-del" title="Remover">✕</button></div>`
                  )
                  .join('')}
            </section>

            <section>
              <h3>Habilidades
                <button data-act="feat-add">+ Nova habilidade</button>
                <button data-act="feat-tpl" data-tpl="relentless">+ Inclemente</button>
                <button data-act="feat-tpl" data-tpl="momentum">+ Impulso</button>
              </h3>
              <p class="dhf-muted">Para reaproveitar habilidades dos livros, use a aba <em>Habilidades</em> da biblioteca à esquerda.</p>
              ${a.features.map((f, i) => featureCard(f, i, a.features.length)).join('')}
            </section>`;
    }

    /* ---------- prévia e exportação (coluna direita) ---------- */

    function environmentStatblock(e) {
        return `<article class="dhf-sheet">
            <h2>${esc(e.name)}</h2>
            <div class="dhf-sub">${esc(ENV_TYPES[e.type].label)} (${e.tier}º patamar)</div>
            ${e.description ? `<p class="dhf-desc">${esc(e.description)}</p>` : ''}
            ${e.impulses ? `<p><strong>Impulsos:</strong> ${esc(e.impulses)}</p>` : ''}
            <div class="dhf-stats">
              <div><strong>Dificuldade:</strong> ${e.difficulty ?? esc(e.difficultyNote || 'especial')}</div>
              <div><strong>Adversários:</strong> ${esc(e.adversaries || 'quaisquer')}</div>
            </div>
            ${e.features.length ? '<h4>Habilidades</h4>' : ''}
            ${e.features.map(f => `<p class="dhf-ability"><strong>${esc(f.name)} (${FORMS[f.form]}):</strong> ${esc(f.text)}${f.questions ? ` <em>${esc(f.questions)}</em>` : ''}</p>`).join('')}
            ${e.incident?.text ? `<h4>${esc(e.incident.name || 'Incidente incitante')}</h4>${e.incident.text.split(/\n+/).map(par => `<p>${esc(par)}</p>`).join('')}` : ''}
          </article>`;
    }

    function environmentComparison(e) {
        const b = ENV_BENCH[e.tier];
        const mark = e.difficulty === null ? '<span class="dhf-muted">especial</span>' : e.difficulty > b.difficulty + 1 ? '<span class="dhf-high">▲ acima</span>' : e.difficulty < b.difficulty - 1 ? '<span class="dhf-low">▼ abaixo</span>' : '<span class="dhf-ok">● típico</span>';
        const fear = e.features.filter(f => /gaste \d+ pontos? de medo/i.test(f.text)).length;
        return `<table class="dhf-cmp">
              <tr><td>Dificuldade</td><td>${e.difficulty ?? '—'}</td><td>${mark}</td></tr>
              <tr><td>Dano típico</td><td colspan="2">${b.damageRange}</td></tr>
              <tr><td>Habilidades de Medo</td><td>${fear}</td><td>${fear ? '' : '<span class="dhf-muted">nenhuma</span>'}</td></tr>
            </table>`;
    }

    function statblock(a) {
        if (isEnvironment(a)) return environmentStatblock(a);
        const isMinion = a.type === 'minion';
        const thresholds = isMinion || (!a.major && !a.severe) ? 'nenhum' : `${a.major}/${a.severe || '—'}`;
        return `<article class="dhf-sheet">
            ${isDefaultImage(a.img) ? '' : `<img class="dhf-sheet-img" src="${esc(shown(a.img))}" alt="">`}
            <h2>${esc(a.name)}</h2>
            <div class="dhf-sub">${esc(TYPES[a.type].label)} (${a.tier}º patamar)${a.type === 'horde' ? ` (${a.hordeHp}/PV)` : ''}</div>
            ${a.description ? `<p class="dhf-desc">${esc(a.description)}</p>` : ''}
            ${a.motives ? `<p><strong>Motivações e táticas:</strong> ${esc(a.motives)}</p>` : ''}
            <div class="dhf-stats">
              <div><strong>Dificuldade:</strong> ${a.difficulty} | <strong>Limiares:</strong> ${thresholds} | <strong>${a.hp} PV</strong> | <strong>${a.stress} PF</strong></div>
              <div><strong>ATQ:</strong> ${signed(a.attack.bonus)} | <strong>${esc(a.attack.name)}:</strong> ${RANGES[a.attack.range]} | ${esc(a.attack.damage)} ${DAMAGE_ABBR[a.attack.damageType]}</div>
            </div>
            ${a.experiences.length ? `<p><strong>Experiências:</strong> ${a.experiences.map(e => `${esc(e.name)} ${signed(Number(e.value) || 0)}`).join(', ')}</p>` : ''}
            ${a.features.length ? '<h4>Habilidades</h4>' : ''}
            ${a.features.map(f => `<p class="dhf-ability"><strong>${esc(f.name)} (${FORMS[f.form]}):</strong> ${esc(f.text)}</p>`).join('')}
          </article>`;
    }

    function renderOutput() {
        const a = state.current;
        const env = isEnvironment(a);
        const cmp = env ? {} : compareToBenchmark(a);
        const mark = { '-1': '<span class="dhf-low">▼ abaixo</span>', 0: '<span class="dhf-ok">● típico</span>', 1: '<span class="dhf-high">▲ acima</span>' };
        const rows = env ? [] : [
            ['Dificuldade', a.difficulty, cmp.difficulty],
            ...(a.type === 'minion' ? [] : [['Limiares', `${a.major}/${a.severe}`, Math.sign(cmp.major + cmp.severe)], ['PV', a.hp, cmp.hp], ['PF', a.stress, cmp.stress]]),
            ['ATQ', signed(a.attack.bonus), cmp.attack],
            ['Dano médio', average(a.attack.damage).toFixed(1).replace('.0', ''), cmp.damage]
        ];
        const scale = state.lastScale;
        root.querySelector('[data-region="output"]').innerHTML = `
            <section>
              <h3>Mudar de patamar</h3>
              <div class="dhf-tiers">
                ${TIERS.map(t => `<button class="${t === a.tier ? 'on' : ''}" data-act="scale" data-tier="${t}" ${t === a.tier ? 'disabled' : ''}>${t}º</button>`).join('')}
                ${state.undo ? '<button data-act="undo">↶ Desfazer</button>' : ''}
              </div>
              ${
                  scale
                      ? `<div class="dhf-changes"><strong>${scale.from}º → ${scale.to}º patamar</strong>
                         <ul>${scale.changes.map(c => `<li>${esc(c.label)}: <s>${esc(c.before)}</s> → <b>${esc(c.after)}</b></li>`).join('')}</ul>
                         ${scale.notes.map(n => `<p class="dhf-note">${esc(n)}</p>`).join('')}</div>`
                      : env
                        ? '<p class="dhf-muted">Ajusta a Dificuldade padrão, as Dificuldades citadas nas habilidades e o dano que elas causam, como orienta o livro em “Adaptando Ambientes”.</p>'
                        : '<p class="dhf-muted">Recalcula Dificuldade, limiares, PV, PF, ataque, dano e os números das habilidades, preservando o quanto a ficha foge do típico do seu tipo.</p>'
              }
            </section>
            <section>
              <h3>Comparação com o típico</h3>
              ${env ? environmentComparison(a) : `<table class="dhf-cmp">${rows.map(([l, v, c]) => `<tr><td>${l}</td><td>${v}</td><td>${mark[c]}</td></tr>`).join('')}</table>`}
              ${env ? '' : `<p class="dhf-muted">Custa ${TYPES[a.type].bp} Ponto${TYPES[a.type].bp > 1 ? 's' : ''} de Batalha${a.type === 'minion' ? ' por grupo de lacaios do tamanho do grupo de personagens' : ''}.</p>`}
            </section>
            <section>
              <h3>Ficha</h3>
              ${statblock(a)}
              <div class="dhf-actions">
                ${host.createActor ? '<button class="dhf-primary" data-act="create">Criar no Foundry</button>' : ''}
                <button class="${host.createActor ? '' : 'dhf-primary'}" data-act="download">Baixar JSON do Foundry</button>
                <button data-act="copy">Copiar JSON</button>
                <button data-act="save-mine">Salvar em ${env ? 'Meus ambientes' : 'Meus antagonistas'}</button>
              </div>
              ${host.createActor ? '' : `<p class="dhf-muted">No Foundry: crie um Ator do tipo ${env ? 'Ambiente' : 'Adversário'}, clique nele com o botão direito → <em>Importar Dados</em> e escolha o arquivo baixado.</p>`}
            </section>`;
    }

    /* ---------- ações ---------- */

    const renderAll = () => {
        renderLibrary();
        renderEditor();
        renderOutput();
    };
    const touched = () => {
        saveDraft();
        renderOutput();
    };
    function setCurrent(adv, { keepUndo = false } = {}) {
        state.current = normalize(adv);
        if (!keepUndo) {
            state.undo = null;
            state.lastScale = null;
        }
        saveDraft();
        renderEditor();
        renderOutput();
    }
    const setPath = (obj, path, value) => {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => o[k], obj)[last] = value;
    };
    function download(name, data) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const slug = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'antagonista';
    function pickFile() {
        return new Promise(resolve => {
            const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
            input.onchange = async () => {
                try {
                    resolve(JSON.parse(await input.files[0].text()));
                } catch {
                    host.notify('Arquivo JSON inválido.', 'error');
                    resolve(null);
                }
            };
            input.click();
        });
    }

    const actions = {
        tab: el => {
            state.tab = el.dataset.tab;
            state.filters.type = '';
            state.limit = PAGE;
            renderLibrary();
        },
        more: () => {
            state.limit += PAGE * 2;
            renderLibrary();
        },
        load: el => {
            const src = [...allAdversaries(), ...allEnvironments()].find(a => a.id === el.dataset.id);
            if (!src) return;
            const adv = clone(src);
            if (!String(adv.id).startsWith('meu:')) {
                adv.basedOn = `${adv.name} (${adv.source}${adv.page ? `, p. ${adv.page}` : ''})`;
                adv.baseId = src.id;
                adv.id = `meu:${uid()}`;
            }
            setCurrent(adv);
        },
        'add-feature': el => {
            const f = libraryCache[Number(el.dataset.i)];
            if (!f) return;
            const { origin, count, mine, kind, tier, type, ...data } = f;
            state.current.features.push(state.adapt ? adaptFeature(data, origin, state.current) : newFeature(clone(data)));
            setCurrent(state.current, { keepUndo: true });
            host.notify(`“${f.name}” adicionada à ficha.`);
        },
        'del-my-feature': el => {
            state.mine.features = state.mine.features.filter(f => f.key !== el.dataset.key);
            saveMine();
            renderLibrary();
        },
        new: () => setCurrent(isEnvironment(state.current) ? blankAdversary('standard', state.current.tier) : blankAdversary(state.current.type, state.current.tier)),
        'new-env': () => setCurrent(blankEnvironment('exploration', state.current.tier)),
        benchmark: () => {
            if (isEnvironment(state.current)) Object.assign(state.current, { difficulty: ENV_BENCH[state.current.tier].difficulty, difficultyNote: '' });
            else applyBenchmark(state.current);
            setCurrent(state.current, { keepUndo: true });
        },
        'exp-add': () => {
            state.current.experiences.push({ name: '', value: state.current.tier >= 3 ? 3 : 2 });
            setCurrent(state.current, { keepUndo: true });
        },
        'exp-del': el => {
            state.current.experiences.splice(Number(el.closest('[data-ei]').dataset.ei), 1);
            setCurrent(state.current, { keepUndo: true });
        },
        'feat-add': () => {
            state.current.features.push(newFeature());
            setCurrent(state.current, { keepUndo: true });
        },
        'feat-tpl': el => {
            const tpl = el.dataset.tpl === 'relentless' ? TEMPLATES.relentless(2) : TEMPLATES.momentum();
            state.current.features.push(newFeature(tpl));
            setCurrent(state.current, { keepUndo: true });
        },
        'feat-del': el => {
            state.current.features.splice(Number(el.closest('[data-fi]').dataset.fi), 1);
            setCurrent(state.current, { keepUndo: true });
        },
        'feat-up': el => moveFeature(el, -1),
        'feat-down': el => moveFeature(el, 1),
        'feat-save': el => {
            const f = state.current.features[Number(el.closest('[data-fi]').dataset.fi)];
            state.mine.features.unshift({ ...clone(f), key: uid(), tier: state.current.tier, type: state.current.type, kind: state.current.kind });
            saveMine();
            renderLibrary();
            host.notify(`“${f.name}” guardada em Minhas habilidades.`);
        },
        'fx-reset': el => {
            delete state.current.features[Number(el.closest('[data-fi]').dataset.fi)].fx;
            setCurrent(state.current, { keepUndo: true });
        },
        scale: el => {
            const to = Number(el.dataset.tier);
            const from = state.current.tier;
            const { adversary, changes, notes } = scaleEntity(state.current, to);
            state.undo = clone(state.current);
            state.lastScale = { from, to, changes, notes };
            setCurrent(adversary, { keepUndo: true });
        },
        undo: () => {
            if (state.undo) setCurrent(state.undo);
        },
        'save-mine': () => {
            const adv = clone(state.current);
            adv.source = 'Meus antagonistas';
            const list = isEnvironment(adv) ? state.mine.environments : state.mine.adversaries;
            const i = list.findIndex(a => a.id === adv.id);
            if (i >= 0) list[i] = adv;
            else list.unshift(adv);
            saveMine();
            renderLibrary();
            host.notify(`“${adv.name}” salvo em ${isEnvironment(adv) ? 'Meus ambientes' : 'Meus antagonistas'}.`);
        },
        download: () => download(`fvtt-Actor-${slug(state.current.name)}.json`, toFoundryActor(state.current)),
        copy: async () => {
            await navigator.clipboard.writeText(JSON.stringify(toFoundryActor(state.current), null, 2));
            host.notify('JSON copiado.');
        },
        create: async () => {
            const actor = await host.createActor(toFoundryActor(state.current));
            if (actor) host.notify(`“${state.current.name}” criado no Foundry.`);
        },
        'art-open': () => {
            state.artOpen = true;
            renderArt();
            root.querySelector('[data-art-query]')?.focus();
        },
        'art-close': (el, ev) => {
            if (el.classList.contains('dhf-modal') && ev.target !== el) return; // clique dentro da caixa
            state.artOpen = false;
            renderArt();
        },
        'art-pick': el => useArt(el.dataset.key),
        'art-more': () => {
            state.artLimit += ART_PAGE * 2;
            renderArtGrid();
        },
        'art-scan': async () => {
            state.artScan = 0;
            renderArt();
            let last = 0;
            try {
                state.artFiles = await host.scanImages(n => {
                    state.artScan = n;
                    if (Date.now() - last < 300) return;
                    last = Date.now();
                    const el = root.querySelector('[data-art-scan]');
                    if (el) el.textContent = `Procurando… ${n} imagens`;
                });
            } catch (err) {
                host.notify(`Não foi possível ler os arquivos: ${err.message ?? err}`, 'error');
            }
            state.artScan = null;
            rebuildArtList();
            renderArt();
        },
        'art-file': async el => {
            const part = el.dataset.part;
            const path = await host.pickImage(part === 'img' ? state.current.img : state.current.token?.src);
            if (!path) return;
            setImagePart(state.current, part, path, { ring: state.artPrefs.ring });
            setCurrent(state.current, { keepUndo: true });
            renderArt();
        },
        'art-clear': () => {
            clearArt(state.current);
            state.artOpen = false;
            setCurrent(state.current, { keepUndo: true });
            renderArt();
        },
        'import-library': async () => {
            const data = await pickFile();
            if (!data) return;
            if (!Array.isArray(data.adversaries)) return host.notify('Este arquivo não é uma biblioteca da Forja (data/library.json).', 'error');
            state.library = data;
            fixLibrary();
            await host.storage.set('library', data);
            renderLibrary();
            host.notify(`Biblioteca importada: ${data.adversaries.length} adversários e ${data.environments.length} ambientes.`);
        },
        'export-mine': () => download('forja-meus-dados.json', { format: 1, mine: state.mine }),
        'import-mine': async () => {
            const data = await pickFile();
            if (!data?.mine) return data && host.notify('Este arquivo não contém dados exportados pela Forja.', 'error');
            const ids = new Set([...state.mine.adversaries, ...state.mine.environments].map(a => a.id));
            const keys = new Set(state.mine.features.map(f => f.key));
            state.mine.adversaries.push(...(data.mine.adversaries ?? []).filter(a => !ids.has(a.id)));
            state.mine.environments.push(...(data.mine.environments ?? []).filter(a => !ids.has(a.id)));
            state.mine.features.push(...(data.mine.features ?? []).filter(f => !keys.has(f.key)));
            saveMine();
            renderLibrary();
            host.notify('Dados importados.');
        }
    };

    function moveFeature(el, dir) {
        const i = Number(el.closest('[data-fi]').dataset.fi);
        const list = state.current.features;
        [list[i], list[i + dir]] = [list[i + dir], list[i]];
        setCurrent(state.current, { keepUndo: true });
    }

    root.addEventListener('click', ev => {
        const el = ev.target.closest('[data-act]');
        if (!el || !root.contains(el)) return;
        if (el.tagName === 'BUTTON') ev.preventDefault();
        actions[el.dataset.act]?.(el, ev);
    });

    root.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && state.artOpen) {
            state.artOpen = false;
            renderArt();
        }
    });

    root.addEventListener('input', ev => {
        const el = ev.target;
        if (el.dataset.artQuery !== undefined || el.dataset.artSource !== undefined) {
            if (el.dataset.artQuery !== undefined) state.artQuery = el.value;
            else state.artSource = el.value;
            state.artLimit = ART_PAGE;
            return renderArtGrid();
        }
        if (el.dataset.artOpt) {
            state.artPrefs[el.dataset.artOpt] = el.type === 'checkbox' ? el.checked : el.value;
            if (host.kind === 'browser') host.storage.set('art', state.artPrefs);
            if (el.dataset.artOpt === 'source') rebuildArtList();
            // a arte já escolhida acompanha as novas opções
            reapplyArt();
            return renderArt();
        }
        const value =
            el.type === 'checkbox'
                ? el.checked
                : el.dataset.nullable !== undefined && el.value === ''
                  ? null
                  : el.type === 'number' || el.dataset.num !== undefined
                    ? Number(el.value) || 0
                    : el.value;
        if (el.dataset.filter) {
            if (el.dataset.filter === 'query') state.query = el.value;
            else if (el.dataset.filter === 'adapt') return void (state.adapt = el.checked);
            else state.filters[el.dataset.filter] = el.value;
            state.limit = PAGE;
            if (el.dataset.filter === 'query') {
                // mantém o foco na busca: troca só a lista
                const pos = el.selectionStart;
                renderLibrary();
                const again = root.querySelector('[data-filter="query"]');
                again.focus();
                again.setSelectionRange(pos, pos);
            } else renderLibrary();
            return;
        }
        if (el.dataset.f) {
            setPath(state.current, el.dataset.f, value);
            if (el.dataset.rerender !== undefined) {
                if (el.dataset.f === 'type' && !isEnvironment(state.current)) ensureTypeFeatures(state.current);
                state.lastScale = null;
                return setCurrent(state.current, { keepUndo: true });
            }
            return touched();
        }
        const exp = el.closest('[data-ei]');
        if (exp && el.dataset.ef) {
            state.current.experiences[Number(exp.dataset.ei)][el.dataset.ef] = value;
            return touched();
        }
        const card = el.closest('[data-fi]');
        if (card) {
            const feature = state.current.features[Number(card.dataset.fi)];
            if (el.dataset.ff) feature[el.dataset.ff] = value;
            if (el.dataset.fx) feature.fx = { ...(feature.fx ?? {}), [el.dataset.fx]: value };
            card.querySelector('[data-chips]').innerHTML = chips(feature);
            touched();
        }
    });

    /* ---------- estrutura ---------- */

    root.classList.add('dhf');
    root.innerHTML = `
        <header class="dhf-top">
          <div class="dhf-brand"><span>⚔</span> Forja de Antagonistas <small>e Ambientes · Daggerheart</small></div>
          <div class="dhf-toolbar">
            <button data-act="new">Novo antagonista</button>
            <button data-act="new-env">Novo ambiente</button>
            <button data-act="import-library" title="Carrega o data/library.json gerado a partir dos seus PDFs">Importar biblioteca</button>
            <button data-act="export-mine" title="Baixa seus antagonistas e habilidades salvos">Exportar meus dados</button>
            <button data-act="import-mine">Importar meus dados</button>
          </div>
        </header>
        <div class="dhf-cols">
          <aside class="dhf-col dhf-lib" data-region="library"></aside>
          <main class="dhf-col dhf-edit" data-region="editor"></main>
          <aside class="dhf-col dhf-out" data-region="output"></aside>
        </div>
        <div data-region="art"></div>`;
    rebuildArtList();
    renderAll();
    if (inFoundry)
        host.foundryArt().then(
            list => {
                state.foundryArt = list;
                rebuildArtList();
                refreshArtRow();
                renderArt();
            },
            () => (state.foundryArt = [])
        );

    return {
        load: adv => {
            state.artOpen = false;
            renderArt();
            setCurrent(adv);
        },
        state
    };
}
