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

## Rotas da API que as telas esperam (lote API)
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
