/** Adaptadores de ambiente: onde guardar dados, como avisar o usuário e como criar o ator. */
import { MODULE_ID } from './core/rules.mjs';
import { ART_MODULE, isDefaultImage } from './core/art.mjs';

/** Página avulsa (GitHub Pages ou `npm start`): guarda tudo no navegador. */
export function browserHost() {
    const key = k => `${MODULE_ID}.${k}`;
    return {
        kind: 'browser',
        libraryUrl: 'data/library.json',
        artIndexUrl: 'data/art-index.json',
        storage: {
            async get(k) {
                try {
                    return JSON.parse(localStorage.getItem(key(k)));
                } catch {
                    return null;
                }
            },
            async set(k, value) {
                try {
                    localStorage.setItem(key(k), JSON.stringify(value));
                } catch {
                    /* armazenamento cheio ou bloqueado: a sessão continua funcionando em memória */
                }
            }
        },
        notify(message, type = 'info') {
            document.querySelector('.dhf-toast')?.remove();
            const toast = Object.assign(document.createElement('div'), { className: `dhf-toast ${type}`, textContent: message });
            document.body.append(toast);
            setTimeout(() => toast.remove(), 2600);
        }
    };
}

/** Dentro do Foundry: dados ficam em configurações do mundo e o ator é criado direto. */
export function foundryHost() {
    return {
        kind: 'foundry',
        libraryUrl: `modules/${MODULE_ID}/data/library.json`,
        artIndexUrl: `modules/${MODULE_ID}/data/art-index.json`,
        /** Com o Art for Daggerheart ativo, usa os arquivos dele; sem ele, as imagens vêm do GitHub. */
        artModuleActive: Boolean(game.modules.get(ART_MODULE)?.active),
        storage: {
            async get(k) {
                const value = game.settings.get(MODULE_ID, k);
                return value && Object.keys(value).length ? value : null;
            },
            async set(k, value) {
                if (!game.user.isGM) return;
                await game.settings.set(MODULE_ID, k, value);
            }
        },
        notify(message, type = 'info') {
            ui.notifications[type === 'error' ? 'error' : 'info'](message);
        },
        /**
         * Imagens de atores de todos os compêndios e do mundo, com a arte de compêndio de módulos (Compendium Art)
         * já aplicada. Adversários vêm com as estatísticas, para a sugestão.
         */
        async foundryArt() {
            const out = [];
            const seen = new Set();
            const push = (doc, source, art) => {
                const img = art?.actor ?? doc.img;
                if (isDefaultImage(img) || seen.has(img)) return;
                seen.add(img);
                const token = typeof art?.token === 'string' ? art.token : (art?.token?.texture?.src ?? doc.prototypeToken?.texture?.src);
                const s = doc.system ?? {};
                out.push({
                    key: `${source}|${img}`,
                    name: doc.name,
                    source,
                    img,
                    token: isDefaultImage(token) ? null : token,
                    randomImg: Boolean(art?.token?.randomImg ?? doc.prototypeToken?.randomImg),
                    stats:
                        doc.type === 'adversary'
                            ? {
                                  tier: Number(s.tier) || 1,
                                  type: s.type ?? 'standard',
                                  difficulty: Number(s.difficulty) || 0,
                                  major: Number(s.damageThresholds?.major) || 0,
                                  severe: Number(s.damageThresholds?.severe) || 0,
                                  hp: Number(s.resources?.hitPoints?.max) || 0,
                                  stress: Number(s.resources?.stress?.max) || 0,
                                  attack: Number(s.attack?.roll?.bonus) || 0
                              }
                            : null
                });
            };
            const fields = [
                'img',
                'type',
                'prototypeToken.texture.src',
                'prototypeToken.randomImg',
                'system.tier',
                'system.type',
                'system.difficulty',
                'system.damageThresholds',
                'system.resources.hitPoints.max',
                'system.resources.stress.max',
                'system.attack.roll.bonus'
            ];
            const useArt = game.compendiumArt?.enabled !== false;
            for (const pack of game.packs.filter(p => p.documentName === 'Actor')) {
                try {
                    const index = await pack.getIndex({ fields });
                    for (const e of index) push(e, pack.metadata.label, useArt ? game.compendiumArt?.get?.(e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`) : null);
                } catch {
                    /* compêndio que não abre: segue com os outros */
                }
            }
            for (const actor of game.actors) push(actor, 'Atores do mundo', null);
            return out;
        },
        /**
         * Varre as pastas de imagens dos módulos ativos, do mundo e as pastas próprias do usuário em Data.
         * `onProgress(n)` recebe quantas imagens já foram achadas.
         */
        async scanImages(onProgress = () => {}, limit = 30000) {
            const FP = foundry.applications.apps.FilePicker.implementation;
            const exts = Object.keys(CONST.IMAGE_FILE_EXTENSIONS).map(e => `.${e}`);
            const files = [];
            const browse = async dir => {
                try {
                    return await FP.browse('data', dir, { extensions: exts });
                } catch {
                    return { dirs: [], files: [] };
                }
            };
            const root = await browse('');
            const queue = [
                ...game.modules.filter(m => m.active && m.id !== MODULE_ID).map(m => [`modules/${m.id}`, m.title]),
                [`worlds/${game.world.id}`, game.world.title],
                ...root.dirs.filter(d => !/^(modules|systems|worlds)$/.test(d)).map(d => [d, 'Data'])
            ].map(([dir, source]) => ({ dir, source, depth: 0 }));
            while (queue.length && files.length < limit) {
                const batch = queue.splice(0, 8);
                const results = await Promise.all(batch.map(b => browse(b.dir)));
                results.forEach((r, i) => {
                    const { source, depth } = batch[i];
                    for (const f of r.files) files.push({ path: f, source });
                    if (depth < 8) for (const d of r.dirs) queue.push({ dir: d, source, depth: depth + 1 });
                });
                onProgress(files.length);
            }
            return files.slice(0, limit);
        },
        /** Abre o navegador de arquivos do Foundry e devolve o caminho escolhido (ou null). */
        pickImage(current) {
            const FP = foundry.applications.apps.FilePicker.implementation;
            return new Promise(resolve => {
                const picker = new FP({ type: 'imagevideo', current: current || '', callback: path => resolve(path) });
                picker.addEventListener?.('close', () => setTimeout(() => resolve(null), 0), { once: true });
                picker.render(true);
            });
        },
        async createActor(data) {
            const actor = await Actor.implementation.create(data);
            actor?.sheet?.render(true);
            return actor;
        }
    };
}
