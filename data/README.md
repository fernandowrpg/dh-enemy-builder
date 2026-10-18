# data/

`library.json` é gerado localmente por `npm run extract` a partir dos **seus** PDFs e fica fora do Git
(veja o `.gitignore`): ele contém texto dos livros, que é protegido por direitos autorais.

`art-index.json` vai para o Git: lista as artes do módulo Art for Daggerheart e as estatísticas (só números e nomes em
inglês) dos adversários do compêndio do sistema, usadas para sugerir a arte. Para atualizar: `npm run art-index`.

A Forja procura o `library.json` ao abrir. Se ele não existir, use o botão **Importar biblioteca**.
