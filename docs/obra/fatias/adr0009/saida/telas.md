# ADR 0009, lote TELAS (apps/web)

## O que mudou
- **Agenda do profissional** (`AgendaDetalheTela` → `AgendaEstruturadaPainel`): preço particular (regras vigentes por
  prioridade; recusadas à parte), convênios e planos atendidos (subplanos agrupados pelo plano superior; aceita/exclui),
  restrições (padrão da agenda e por convênio/plano/procedimento), preparo e documentos; cabeçalho com código de origem
  e vigência da agenda. **Texto original inteiro ao lado** (`TextoOriginalAgenda`): trecho não interpretado em `<mark>`
  com o motivo, contagem dos não interpretados, "Ver o texto de origem" destaca o texto da regra. Regra estimada já vale
  e aparece marcada.
- **Edição da regra** (`RegraPrecoForm`): inclusão (dono agenda ou profissional; alvo consulta, procedimento ou grupo;
  sempre do particular da agenda) e edição com a versão lida; confirmar ou recusar a estimada. Permissão
  `agenda.alterarAgenda`.
- **Credenciamento** (`CredenciamentoConvenios`): na ficha do profissional (aba Convênios) e no cadastro do convênio;
  lista com plano, estabelecimento, vigência e situação; inclusão e descredenciamento.
- **Cadastro do convênio** (`ContratoTela` → `OpcoesCredenciamentoConvenio`): `bloqueiaSemCredenciamento` e
  `credenciaTodosAoCriar` (gravar com `convenio.contrato.editar`; lista com `convenio.credenciamento.ler`).
- **Lançamento do atendimento** (`ProcedimentosTela` → `OrigemPrecoAviso`): prévia do preço com a origem, a explicação e
  o aviso de estimada; alerta de não credenciado; com bloqueio, o botão Lançar fica desabilitado.
- Textos em `agenda/i18n-estruturada.ts` (chave `estruturada` no `pt-BR.ts`); cliente em `agenda/api-estruturada.ts`;
  regras puras em `agenda/estruturada-tela.ts`.

## Correção da revisão (2026-11-22)
- **URLs alinhadas ao `AgendaPrecoController`** (prefixo `api`): `/api/agendas/:id/estruturada`,
  `/api/precos-particulares`, `/api/credenciamentos?profissional&convenio&data` (lista pura, data de hoje por padrão),
  `/api/convenios/:id/opcoes-credenciamento` (GET/PUT). A gravação aceita o `{ id }` que o controller devolve (e o
  envelope da agenda). **Teste de contrato** no spec: cada URL chamada pelo cliente tem de existir nos decoradores do
  controller ou estar em `ROTAS_PENDENTES_API`; o teste falha quando uma pendente passa a existir.
- **Lançamento falha fechado:** o botão Lançar fica desabilitado enquanto a prévia carrega, quando ela dá erro (aviso
  `preco-indisponivel`) e com efeito `bloqueio`.
- **Regras vigentes** filtradas pela data e ordenadas por `compararEspecificidade` do `@sgh/dominio-preco` (teste com
  regra da agenda no item, prioridade 100, acima da do profissional na consulta, prioridade 10; vencida, futura e
  recusada fora).
- **Trecho não interpretado tem precedência** na sobreposição: aninhado num interpretado, sai em três pedaços e continua
  marcado (teste novo).
- Prova: `vitest` de agenda, cadastro, atendimento e precos: 7 arquivos, 58/58; `vue-tsc` do `apps/web`: 0 erros;
  `eslint` dos arquivos tocados: ok.

## Pendências para o lote API (fora dos arquivos deste lote)
- `PUT /api/precos-particulares/:id` (revisão com a versão: confirmar, recusar, editar a estimada).
- `GET /api/atendimento/:reg/preco?procedimento=`: a ficha do atendimento só tem `convenio.codigo` e `profissional.crm`,
  então a prévia tem de ser resolvida no servidor (ids de profissional, plano, agenda e item). Até existir, o Lançar
  fica desabilitado com o aviso (falha fechada).
- **Credenciamento no servidor:** `atendimento.lancarProcedimentoExtra` tem de aplicar `verificarCredenciamento` e
  recusar com efeito `bloqueio`. Hoje a trava é só da tela.
- `GET /api/credenciamentos` exige profissional **e** convênio; as telas listam só por um deles (ficha do profissional
  ou do convênio). Tornar os dois opcionais (ao menos um).
- `:id` de convênio nas opções: a tela passa o `codigo` do cadastro; a API espera o id da fonte pagadora.

## Rotas que as telas esperavam na 1ª versão (substituídas acima)
| Método | Caminho | Corpo / resposta |
|---|---|---|
| GET | `/api/agenda/consultas/agendas/:id/estruturada[?data=]` | `esquemaAgendaEstruturada` |
| POST | `/api/agenda/consultas/precos-particulares` | `EntradaRegraPrecoParticular` → `esquemaResultadoAgenda` |
| PUT | `/api/agenda/consultas/precos-particulares/:id` | `{versao, valores:{valor?,prioridade?,vigenciaInicio?,vigenciaFim?,situacaoRevisao?,observacao?}}` → `esquemaResultadoAgenda` |
| GET | `/api/cadastros/credenciamentos?profissionalId=|fontePagadoraId=` | `{itens: Credenciamento[]}` |
| POST | `/api/cadastros/credenciamentos` | `EntradaCredenciamento` → `esquemaResultadoAgenda` |
| GET/PUT | `/api/cadastros/convenios/:cod/credenciamento` | `OpcoesCredenciamentoConvenio` / `{bloqueiaSemCredenciamento, credenciaTodosAoCriar}` |
| GET | `/api/atendimento/:reg/preco?procedimento=` | `esquemaResultadoCalculoPreco` |

## Prova
- `vitest` do spec novo: 15/15 (aceite da seção 6: valor particular, convênio e subplano, preparo, idade de 5 anos
  contra mínima de 12; texto de 2.800 caracteres inteiro; trecho não interpretado destacado; PUT com versão; POST do
  particular; credenciamento; opções do convênio com e sem permissão; alerta, bloqueio e origem do preço).
- `vitest` dos módulos agenda, cadastro, atendimento e precos: 7 arquivos, 54/54. `vue-tsc` do `apps/web`: 0 erros.
  `eslint` e `stylelint` dos arquivos tocados: ok.

## Pendências
- Rotas da API acima (lote API). Convênio no cadastro é pelo `codigo` da tela atual; a tela supõe `codigo` = id da
  fonte pagadora nas opções da agenda (nomes dos convênios).
- Nomes de plano, profissional e estabelecimento: o contrato só traz ids; a tela mostra o nome quando receber o mapa
  (`nomesPlano`) e, sem ele, o código. Seria bom o `esquemaAgendaEstruturada` e o `esquemaCredenciamento` trazerem nomes.
- Edição de cobertura, restrição e preparo pela tela (só leitura nesta rodada; as portas existem).
