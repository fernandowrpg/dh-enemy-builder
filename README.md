# Forja de Antagonistas — Daggerheart

Ferramenta para **criar adversários e ambientes** de Daggerheart, **reaproveitar ou inventar habilidades** e **mudar o patamar**
de qualquer ficha com um clique. O resultado sai no formato do sistema
[Foundryborne Daggerheart](https://github.com/Foundryborne/daggerheart) **1.9.14** para **Foundry VTT 13** (verificado na 13.351).

Funciona de dois jeitos, com o mesmo código:

- **Módulo do Foundry** — botão *Forja de Antagonistas* na aba de Atores; cria o adversário direto no mundo.
- **Página avulsa** — abre no navegador e exporta um JSON para *Importar Dados* no Foundry.

> Projeto de fã, não oficial. Este repositório **não contém texto dos livros**: a biblioteca de fichas e habilidades
> é gerada no seu computador, a partir dos PDFs que você já possui (veja [Biblioteca dos livros](#biblioteca-dos-livros)).

## O que ela faz

- **Criar do zero**: escolha tipo e patamar e a ficha já nasce com os valores típicos (Dificuldade, limiares, PV, PF,
  ataque e dano). Lacaios e hordas recebem automaticamente *Lacaio (X)*, *Ataque em Grupo* e *Horda (X)*.
- **Partir de uma ficha pronta**: busque na biblioteca por nome, patamar, tipo ou fonte e carregue como base.
- **Habilidades**: pesquise todas as habilidades dos livros (por nome, texto, forma, patamar, tipo) e adicione à sua
  ficha — com o dano e a Dificuldade já ajustados ao patamar dela. Crie as suas e guarde em *Minhas habilidades*.
- **Mudar de patamar**: recalcula Dificuldade, limiares, PV, PF, ataque, dano, Experiências e os números dentro do
  texto das habilidades, mostrando o antes e depois, com *Desfazer*.
- **Comparação com o típico**: indica se cada estatística está abaixo, dentro ou acima do esperado para o tipo e patamar,
  e quantos Pontos de Batalha o adversário custa.
- **Foundry**: cada habilidade vira um item *feature* com ação, custo (Fadiga/Medo), dano, alcance e teste de reação
  deduzidos do texto — e ajustáveis à mão em “No Foundry”.
- **Ambientes**: crie, edite e mude o patamar de ambientes (Exploração, Social, Travessia, Evento), com impulsos,
  adversários sugeridos, habilidades com perguntas de inspiração e incidente incitante. Saem como ator *Ambiente*;
  as perguntas vão em bloco secreto (só o mestre vê) e o incidente vai para as Notas.
- **Artes**: escolha retrato e token entre as artes do módulo [Art for Daggerheart](https://github.com/mordachai/art-for-daggerheart)
  (Mordachai, CC0). A Forja sugere a arte comparando as estatísticas da ficha com as do compêndio do sistema, então
  funciona com os nomes em português. O token pode ser de variações aleatórias, em círculo ou igual ao retrato, com ou sem anel.
- **Editar fichas que já estão no Foundry**: botão direito num adversário ou ambiente → *Abrir na Forja de Antagonistas*.

## Instalação no Foundry

1. Em *Add-on Modules → Install Module*, cole a URL do manifesto:
   `https://github.com/fernandowrpg/dh-enemy-builder/releases/latest/download/module.json`
2. Ative o módulo no mundo (sistema Daggerheart).
3. Abra a aba **Atores** e clique em **Forja de Antagonistas**.

Também dá para abrir por macro: `game.modules.get('dh-antagonist-forge').api.open()`.

## Uso fora do Foundry

```bash
npm start
```

Abra `http://localhost:5173`. Para levar a ficha ao Foundry: **Baixar JSON do Foundry**, crie um Ator do tipo
*Adversário*, clique nele com o botão direito → **Importar Dados** e escolha o arquivo.

A página também pode ser publicada pelo GitHub Pages (Settings → Pages → branch `main`, pasta `/`).

## Biblioteca dos livros

A biblioteca (adversários, ambientes e habilidades do *Livro Básico* e do *Bestiário do Medo*) é extraída dos **seus** PDFs e fica só
na sua máquina, em `data/library.json` — arquivo ignorado pelo Git, pois contém texto protegido por direitos autorais.

```bash
npm run extract -- "Livro Básico=C:/caminho/DH-Livro-Basico.pdf" "Bestiário do Medo=C:/caminho/DH-Bestiario-do-Medo.pdf"
```

Requer Node 18+ e o `pdftotext` (poppler). No Windows ele já vem com o Git for Windows.

- **Página avulsa**: a biblioteca é carregada sozinha ao abrir.
- **Foundry**: clique em **Importar biblioteca** e escolha o `data/library.json`. Ela fica guardada no mundo.

Sem biblioteca a Forja continua funcionando: você cria antagonistas do zero e salva suas próprias habilidades.
*Exportar meus dados* / *Importar meus dados* levam suas criações de um lugar para outro.

## Como o patamar é recalculado

A Forja guarda, para cada tipo e patamar, os valores típicos de Dificuldade, limiares, PV, PF, ataque e dano médio
(medianas das fichas publicadas). Ao mudar de patamar ela **preserva o quanto a ficha foge do típico**:

| Estatística | Regra |
| --- | --- |
| Dificuldade, PV, PF, ATQ | mesma diferença em relação ao típico (um Solo com +2 PV continua com +2 PV) |
| Limiares e dano | mesma proporção em relação ao típico |
| Dados de dano | um dado a mais ou a menos por patamar (1d → 2d → 3d → 4d), com o bônus fixo completando a média |
| Lacaio (X) | X segue o valor típico do patamar (3 / 6 / 8 / 13) |
| Horda (X) | recalculada como cerca de metade do novo dano |
| Experiências | +2 nos patamares 1–2, +3 nos patamares 3–4 |
| Texto das habilidades | só fórmulas ligadas a “dano” e Dificuldades explícitas de testes são alteradas |

**Ambientes** seguem a tabela do livro (*Adaptando Ambientes*): a Dificuldade muda 3 pontos por patamar
(11 / 14 / 17 / 20, mantendo o desvio que a ficha já tinha), as Dificuldades citadas nas habilidades acompanham e o
dano das habilidades é levado para a faixa do novo patamar. A Forja lembra de trocar os adversários sugeridos ou
invocados e de acrescentar uma habilidade de Medo ao subir.

Depois vêm os lembretes do livro (*Improvisando Adversários*): somar 1–3 PV/PF ao subir para o 3º/4º patamar e
acrescentar ou remover uma habilidade em vez de só mexer em números. Condições, alcances e efeitos sem números
**não** mudam sozinhos — revise as habilidades.

## Desenvolvimento

```bash
npm test
```

| Caminho | Conteúdo |
| --- | --- |
| `scripts/core/rules.mjs` | tipos, alcances, tabela de valores típicos, modelos de habilidades |
| `scripts/core/dice.mjs` | leitura e ajuste de fórmulas de dano |
| `scripts/core/scale.mjs` | mudança de patamar e adaptação de habilidades |
| `scripts/core/foundry-data.mjs` | conversão para/de Actor `adversary` do sistema 1.9.14 |
| `scripts/app.mjs` | interface (sem dependências) |
| `scripts/foundry.mjs`, `scripts/hosts.mjs` | integração com o Foundry e com o navegador |
| `scripts/core/art.mjs` | sugestão e aplicação das artes do Art for Daggerheart |
| `tools/extract-pdf.mjs` | extrator dos PDFs |
| `tools/build-art-index.mjs` | gera `data/art-index.json` (`npm run art-index [tag-das-artes] [versão-do-sistema]`) |

Para publicar uma versão: crie uma tag `vX.Y.Z`. O workflow em `.github/workflows/release.yml` roda os testes, grava a
versão e os links do repositório no `module.json` e anexa `module.json` e `module.zip` à release.

## Licença e créditos

Código sob licença [MIT](LICENSE).

Daggerheart é uma marca da Darrington Press / Critical Role. Edição brasileira e *Bestiário do Medo*: Jambô Editora.
Este projeto não é afiliado nem endossado por elas.

This product includes materials from the Daggerheart System Reference Document 1.0, © Critical Role, LLC. under the
terms of the Darrington Press Community Gaming (DPCGL) License. More information can be found at
https://www.daggerheart.com. There are no previous modifications by others.
