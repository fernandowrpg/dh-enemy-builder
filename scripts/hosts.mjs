/** Adaptadores de ambiente: onde guardar dados, como avisar o usuário e como criar o ator. */
import { MODULE_ID } from './core/rules.mjs';

/** Página avulsa (GitHub Pages ou `npm start`): guarda tudo no navegador. */
export function browserHost() {
    const key = k => `${MODULE_ID}.${k}`;
    return {
        kind: 'browser',
        libraryUrl: 'data/library.json',
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
        async createActor(data) {
            const actor = await Actor.implementation.create(data);
            actor?.sheet?.render(true);
            return actor;
        }
    };
}
