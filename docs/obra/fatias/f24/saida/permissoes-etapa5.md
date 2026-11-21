# F2.4 — etapa final das permissões (padroes.md §5; ADR 0007, item 8)

## O que mudou
- `DeclaracaoPermissao` perdeu `opcoesLegado` e `flagsLegado`; o tipo `FlagLegado` saiu dos contratos. A procedência
  (opção do menu e marca de usuário de origem → permissão) vive só em `conector/mapa/permissoes.tsv` (10.811 linhas,
  sem mudança de conteúdo).
- `catalogo-legado.json/.ts` viraram `catalogo-base.json/.ts` (`@sgh/contratos/catalogo-base`, `CATALOGO_BASE`): 5.321
  permissões próprias do produto, sem opções; a "origem" do arquivo virou descrição + contagem.
- 72 arquivos de `packages/contratos/src/permissoes/` reescritos por codemod (AST): tiradas as propriedades, o
  parâmetro de opções dos ajudantes e o argumento nas chamadas; 102 constantes `OPCOES_*` sem outro uso apagadas, e as
  7 restantes também (fonte sintética passa a pedir ao mapa).
- `@sgh/dominio-acesso`: novo `mapa-origem.ts` (`lerMapaOrigem`, `opcoesPorPermissao`, `marcasDoMapa`, tipos
  `CorrespondenciaOrigem` e `MarcaUsuarioOrigem`, só interpretação de texto, sem I/O). `indexarCatalogo(catalogo,
  mapaPerfis, mapaOrigem)` monta `porOpcao`/`porFlag` a partir do mapa (só para permissão que existe: falha fechada);
  `conceder` aceita `mapaOrigem`. `PermissaoGerada` (gerador da árvore de origem) guarda as próprias opções.
- API: `autorizacao/catalogo.ts` lê o mapa uma vez (`SGH_MAPA_PERMISSOES` troca o caminho; sem arquivo, nada vem da
  origem), expõe `opcoesDasPermissoes(...)` e `marcasDeclaradas()` (troca `FLAGS_DECLARADAS`). Fonte sintética,
  fonte em memória e `permissoes.controller.ts` usam o mapa.
- Verificador `permissoes.ts`: "sem-mapeamento" lê o mapa do conector; nova regra `mapa-orfao` (linha que aponta
  permissão fora do catálogo); "catálogo em dia" virou `conferirOrigem` (todo código gerado do retrato existe no
  catálogo-base e toda opção dele tem linha no mapa); `--atualizar` não grava mais o catálogo. A prova dos 42 grupos
  usa `mapaDaProva` (mesmo resultado: 0 não justificada).
- `tools/obra/gerar_mapa_permissoes.ts` virou só conferidor do mapa (cabeçalho, ordem, sem repetição, sem órfã).
- `dominio-config/declaracao.ts`: a regra "permissão sem opção nem perfil" usa as opções do próprio domínio.
- Specs (contratos, dominio-acesso, api, verificadores, tools/db) leem as opções do mapa
  (`permissoes/mapa-origem-teste.ts` nos contratos; `MAPA_ORIGEM` de teste no domínio).

## Decisões pela melhor prática
- O mapa é a fonte única da procedência e passa a ser editado à mão com revisão; o gerador antigo (catálogo → mapa)
  deixou de existir porque o catálogo não tem mais a informação.
- A API só lê o mapa quando a origem é consultada (fontes sintética e de memória); na fonte própria o índice do cliente
  não usa origem.
- O catálogo-base continua sendo conferido contra o retrato da árvore de origem (cobertura), mas não é mais regravado
  pelo gerador.

## Pedidos / avisos
- `permissoes:verificar` tem 4 achados `acao-sem-auditoria` ANTERIORES a esta etapa (commits da trilha F4:
  `plataforma-onboarding/onboarding.controller.ts` 71/86/97 e `config/dominios.controller.ts` 427): faltam
  `@Auditar`/`@SemAuditoria`. Fora do escopo desta etapa.
- Comentários de cabeçalho de alguns arquivos de permissão ainda citam números de opção do menu de origem (sem nome de
  tabela; `divida_f24` não acusa). Podem ser enxugados numa passada de texto.
- `DominioPublico.opcoesLegado` (declaração dos domínios) e `RELATORIOS_CATALOGO.opcoesLegado` não fazem parte de
  `DeclaracaoPermissao` e ficaram como estão.
