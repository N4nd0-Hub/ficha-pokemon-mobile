# Ficha Pokémon Heaven & Hell — Mobile V5.0

[Abrir ficha mobile](https://n4nd0-hub.github.io/ficha-pokemon-mobile/)

A edição Mobile mantém navegação inferior de cinco itens, Box, personalização em tela própria, painéis recolhíveis e leitor de regras para celular. As melhorias da ficha PC até o commit `10b8e5b` foram incorporadas sem substituir essa interface.

- Save completo em IndexedDB, com artes do Pokémon, treinador e formas, histórico de versões, verificação de gravação e recuperação após fechar a página.
- Proteção contra sobrescritas entre abas, migração dos saves antigos e exportação/importação de JSON completo.
- Menu **Seus saves** e indicador acima da navegação inferior.
- Menu **Pokémon extras**, conectado às consultas públicas da Pokédex GM no Supabase e às criações publicadas nos arquivos do repositório.
- Espécies por número da Dex e linha evolutiva; Megas e outras formas em seção separada. Criação de ficha com stats, Abilities e Moves publicados.
- Miscelânea com treinamento, equipamento, Abilities extras, PPg, histórico e anotações em painéis recolhíveis; fonte Arcade atualizada.

## Dados locais e catálogo

`scripts/local-save-v5.js` e `scripts/local-save-ui-v5.js` são os mesmos módulos de save da ficha PC. Os dados anteriores (`pokemon_rpg_sheet_v13`, recuperação e antigo IndexedDB) são lidos sem apagar as cópias originais. PC e Mobile usam o mesmo banco `pokemon_hh_v5_local_database` quando abertos no mesmo navegador e origem GitHub Pages, mantendo as fichas em comum. Em aparelhos ou navegadores diferentes, use o JSON para transferir as fichas.

`scripts/pokedex-gm-bridge.js` consulta apenas os registros publicados em `pokedex_public_species`, `pokedex_public_forms` e `pokedex_public_custom_megas`, com a chave pública do projeto. O catálogo também inclui `Pok-dex-GM/pokemons/catalogo.json` pelo módulo público `repository-catalog.js`, dando prioridade aos registros do banco. O cache permite consultar o último catálogo carregado quando a conexão falha. Esse acesso ao catálogo não envia os saves locais ao servidor.

Os bancos de regras, Abilities e Moves adaptados ao H&H permanecem na ficha, com nomes em inglês e efeitos em português. O catálogo aplica os dados publicados sem exigir digitação manual.

## Desenvolvimento

Site estático, sem dependências de execução. Para verificar:

```sh
npm ci --ignore-scripts
npm test
node scripts/check-mobile.cjs
```

As dependências npm são apenas de teste. O workflow verifica o código sem reescrever o HTML nem reinstalar uma ponte remota antiga. `styles/mobile-updates-v5.css` contém apenas as adaptações das novas funcionalidades ao celular.
