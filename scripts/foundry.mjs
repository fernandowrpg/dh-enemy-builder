/** Ponto de entrada do módulo no Foundry VTT 13 (sistema Daggerheart 1.9.x). */
import { MODULE_ID } from './core/rules.mjs';
import { fromFoundryActor } from './core/foundry-data.mjs';
import { mountForge } from './app.mjs';
import { foundryHost } from './hosts.mjs';

const { ApplicationV2 } = foundry.applications.api;

class AntagonistForge extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: MODULE_ID,
        classes: ['dhf-window'],
        tag: 'div',
        window: { title: 'Forja de Antagonistas', icon: 'fa-solid fa-hammer', resizable: true },
        position: { width: 1280, height: 820 }
    };

    /** Adversário a carregar na próxima renderização (vindo do menu de contexto). */
    pending = null;
    api = null;

    async _renderHTML() {
        return null;
    }

    async _replaceHTML(_result, content) {
        if (this.api) {
            if (this.pending) this.api.load(this.pending);
            this.pending = null;
            return;
        }
        const root = document.createElement('div');
        content.replaceChildren(root);
        content.style.padding = '0';
        content.style.overflow = 'hidden';
        root.style.height = '100%';
        this.api = await mountForge(root, foundryHost(), { initial: this.pending ?? undefined });
        this.pending = null;
    }

    _onClose(options) {
        super._onClose(options);
        this.api = null;
    }
}

let forge;
function openForge(adversary) {
    forge ??= new AntagonistForge();
    forge.pending = adversary ?? null;
    forge.render({ force: true });
}

Hooks.once('init', () => {
    for (const key of ['library', 'mine', 'draft'])
        game.settings.register(MODULE_ID, key, { scope: 'world', config: false, type: Object, default: {} });
    game.modules.get(MODULE_ID).api = { open: openForge };
});

Hooks.on('renderActorDirectory', (_app, html) => {
    if (!game.user.isGM) return;
    const element = html instanceof HTMLElement ? html : html[0];
    if (element.querySelector('.dhf-open')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dhf-open';
    button.innerHTML = '<i class="fa-solid fa-hammer"></i> Forja de Antagonistas';
    button.addEventListener('click', () => openForge());
    (element.querySelector('.header-actions') ?? element.querySelector('.directory-header') ?? element).append(button);
});

function contextEntry(options) {
    if (options.some(o => o.dhForge)) return;
    const actorOf = li => game.actors.get((li instanceof HTMLElement ? li : li[0])?.dataset.entryId);
    options.push({
        dhForge: true,
        name: 'Abrir na Forja de Antagonistas',
        icon: '<i class="fa-solid fa-hammer"></i>',
        condition: li => game.user.isGM && actorOf(li)?.type === 'adversary',
        callback: li => openForge(fromFoundryActor(actorOf(li).toObject()))
    });
}
Hooks.on('getActorContextOptions', (_app, options) => contextEntry(options));
Hooks.on('getActorDirectoryEntryContext', (_html, options) => contextEntry(options));
