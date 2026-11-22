# Conferência final da rodada ADR 0009

Data: 2026-11-22. Cliente de teste `adr9_conf` (plataforma `plataforma_teste_adr9_conf`), apagados no fim. Logs em
`/tmp/claude-1000/adr9/conf-*.log`.

## Avisos entre lotes resolvidos
| Pedido | De → para | Resolução |
|---|---|---|
| `PUT /api/precos-particulares/:id` (revisão com a versão) | telas → API | Publicada: `opRevisarRegraParticular` (valor, prioridade, vigência, situação, observação; recusa `conflito-versao`, `vigencia-invalida`, `regra-inexistente`, `fora-do-estabelecimento`) e `alterarRegraPrecoParticular` na persistência. Permissão `preco.regraParticular.editar`, auditada no executor. |
| `GET /api/atendimento/:reg/preco?procedimento=` | telas → API | Publicada: `precoDoAtendimento` resolve conta (ou cobertura), plano, tabela, profissional, agenda da marcação e "consulta" pelo catálogo de agendamento, os mesmos critérios do `lancarItem`. Permissão `atendimento.procedimento.lancar`. **Sem ela o botão Lançar ficava sempre desabilitado** (falha fechada). |
| `GET /api/credenciamentos` com um filtro só | telas → API | Profissional **ou** convênio (ao menos um); `listarCredenciamentosVigentes` na persistência. |
| `:id` do convênio = `codigo` da tela | telas → API | Conferido: o `codigo` do convênio na tela é o `fonte_pagadora.id` (`fonte-propria.ts`, `convenioDe`). Sem mudança. |
| Permissões novas do lote API | API → telas | Telas ligadas às permissões que a API exige: regra particular `preco.regraParticular.editar` (era `agenda.alterarAgenda`), credenciar na ficha do profissional e opções do convênio `convenio.credenciamento.editar` (eram `cadastro.profissional.editar` e `convenio.contrato.editar`). |
| `ROTAS_PENDENTES_API` do contrato de URLs | telas | Lista esvaziada: toda URL das telas existe no controller (o teste de contrato confere). |
| Decisão 26 no conector | API → conector | Já feita pelo conector: `fonte_pagadora.credencia_todos_ao_criar` ligado no cliente importado (`L5-06.tsv`). |

## Verificações (todas passaram)
- `validar_migracoes`: 3.682 tabelas, catálogo 3.676, 0 erros, 0 gatilhos.
- `tsc --noEmit`: persistência, contratos, api e worker sem erro; `vue-tsc` do `apps/web` (8 GB): 0 erros.
- `eslint` e `prettier` dos arquivos tocados: ok.
- Vitest unidade da API (precos, faturamento, atendimento, persistência agenda-preco): 8 arquivos, 75/75.
- Vitest da web (agenda, cadastro, atendimento, precos): 7 arquivos, 58/58.
- Integração (`agenda-preco.int.spec.ts` + `faturamento/porta-propria.int.spec.ts`): 35/35, 3 testes novos (prévia do
  atendimento, credenciamento por um filtro, revisão com versão).
- `conector/conector.sh testes`: 1.225 testes, OK (10 pulados, 2 falhas esperadas). `test_estrutura_agenda.py` à parte:
  17/17, **sem pulo** (o aceite e o Sincronizar no banco descartável rodaram).
- Teste de aceite da seção 6: API (aceite 6.1, 6.7/6.8, 6.10, 6.12 com o texto ao lado), conector (aceite e
  Sincronizar) e telas (15 casos do spec), todos verdes.
- `permissoes:verificar`: continua VERMELHO só pelos 4 achados antigos (`dominios.controller.ts:427`,
  `onboarding.controller.ts:85/100/111`), nenhum desta rodada.

## Pendências (fora do alcance da conferência)
1. Conector: preço particular da origem por fonte (`VLR_CONSULTA` da particular) não é carregado, porque a carga não
   sabe qual fonte é particular (tipo presumido "outro"). Precisa de carga condicional depois da classificação.
2. Repasse integral (marca da origem) como `regra_repasse_item` a 100%: falta o item ou grupo de consulta do cliente
   e o uso de `repasseIntegralVale` no cálculo do repasse.
3. "Valor do exame particular" sem item fica como trecho não interpretado: falta decidir o alvo "atendimento padrão
   da agenda" para exame (o CHECK de alvo só aceita consulta sem item).
4. Particular padrão: o módulo ainda não lê o parâmetro `faturamento.fontePagadoraParticularCodigo` (vale a única
   fonte particular ativa).
5. Decisão 26 na criação manual de convênio: não há operação de criar convênio na API; existe só
   `POST convenios/:id/credenciar-todos`.
6. Credenciamento na marcação e na abertura do atendimento (hoje só no lançamento e na prévia).
7. Teste de integração da regra da agenda no lançamento com marcação sintética.
8. Contratos sem nomes (plano, profissional, estabelecimento) em `esquemaAgendaEstruturada` e `esquemaCredenciamento`;
   edição de cobertura, restrição e preparo pela tela.
9. Ligar agenda a profissional pelo nome (seção 5.3, item 5) e medir o extrator na cópia real (só contagens).
10. `lancarProcedimentoExtra` não está entre as operações da porta própria do atendimento: a prévia funciona, o
    lançamento pela tela do atendimento no banco próprio depende dessa operação.
