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

## 2ª volta (conferência final, 2026-11-22)

Cliente de teste `adr9c_conf` (plataforma `plataforma_teste_adr9c_conf`). Logs em `/tmp/claude-1000/adr9/conf2-*.log`.
Integração com `SGH_CLIENTE_TESTE`, `SGH_BANCO_PLATAFORMA` e `PLATAFORMA_BANCO` apontando para esse cliente.

### Avisos entre lotes resolvidos
- Cliente de teste `adr9c_api` (só dados sintéticos) removido: banco `cliente_adr9c_api`, a linha da plataforma e o
  único evento dela (0 execuções do conector, 0 origens). Não sobra registro órfão.
- Revisão (PUT com a versão) de cobertura, restrição e preparo: a API já tinha as rotas; faltava a tela. Feita nesta
  conferência: `revisarCobertura/Restricao/Preparo` em `api-estruturada.ts`, botão "Revisar" por regra no
  `AgendaEstruturadaPainel` e `RegraEstruturadaForm` preenchido pela regra lida, gravando com a versão. Teste novo em
  `estruturada-edicao.spec.ts` (restrição "criança de 5 anos" e cobertura do subplano, corpo com `versao`).
- Erro não tratado antigo (`nextSibling`) em `estruturada-telas.spec.ts`: corrigido com `enableAutoUnmount(afterEach)`
  registrado depois da limpeza do body (desmonta antes de limpar). O vitest da web volta a sair com código 0.
- O prettier nos arquivos do repasse (aviso do lote domínio-API) e a contagem renomeada `padrao_com_evidencia` (aviso
  do conector) não pedem ação.

### As 10 pendências da 1ª volta
| # | Pendência | Situação |
|---|---|---|
| 1 | Preço particular da origem por fonte | Feita (conector, `79666f0`/`ef7cc38`): só a fonte classificada como particular; outra fonte vira pendência; vigência sem evidência vira pendência. |
| 2 | Repasse integral como regra a 100% | Feita (`713a936`, `92318bc`, `2061264`): no motor do repasse, só na fonte particular (API, domínio e conector). |
| 3 | Valor do exame particular sem item | Feita (`dc5c91c` e conector): alvo `exame` = exame padrão da agenda; no lançamento só para o exame da agenda. Falta: a prévia `precoDoAtendimento` calcula só consulta. |
| 4 | Particular padrão pelo parâmetro | Feita (`713a936`): `faturamento.fontePagadoraParticularCodigo`; sem ele, a única fonte particular ativa. |
| 5 | Decisão 26 ao criar convênio | Feita: `POST /api/convenios` credencia todos os ativos quando a opção está ligada; tela `NovoConvenioForm`. |
| 6 | Credenciamento na marcação e na abertura | Feita (`conferirCredenciamentoNoFluxo` em agenda e atendimento, com testes de integração). Falta: o plano do paciente na marcação (hoje "plano desconhecido só alerta"; pede mudar `esquemaAgendarConsulta`/`esquemaEncaixar` e a tela). |
| 7 | Integração da regra da agenda com marcação sintética | Feita (`92318bc`). |
| 8 | Nomes nos contratos e edição pela tela | Feita (`acd70e8`, `dc5c91c`); a revisão (PUT) pela tela foi completada nesta conferência. |
| 9 | Agenda ligada ao profissional pelo nome e medida | Feita (`79666f0`); medidas abaixo. |
| 10 | `lancarProcedimentoExtra` na porta própria | Feita (`713a936`). |

### Medidas na cópia real (só contagens, `medidas-conector.md`)
Fontes 77 (1 particular estimada); valores de consulta por médico 113 (13 valores distintos; 0 em convênio);
marca de repasse integral em 2 fontes; agendas 178 (174 sem profissional na origem; 134 ligadas pelo nome, 7
ambíguas, 33 sem correspondência); textos lidos 174 (116 com valor em reais); preços extraídos 44 de consulta e 0 de
exame; trechos interpretados 110 e não interpretados 1.006 (valem pelo texto, marcados); coberturas 6, restrições 58,
preparos 1; textos sem regra 92.

### Verificações
- `validar_migracoes`: ok. `tsc --noEmit` de api, worker, contratos, persistência, dominio-preco, dominio-agenda,
  dominio-repasse, dominio-atendimento e dominio-faturamento: 0 erros (os domínios pelo `tsconfig.json`; o
  `tsconfig.lib.json` lê o `dist` antigo dos contratos). `vue-tsc` da web (8 GB): 0 erros. `eslint` e `prettier` dos
  arquivos tocados: ok.
- Vitest de unidade: API inteira 325 arquivos, 2.149 testes (19 pulados); web (agenda, preços, atendimento,
  cadastro) 8 arquivos, 76/76, sem erro não tratado; domínios e contratos tocados: verdes.
- Integração no `adr9c_conf`: API (preços, faturamento, repasse, agenda, atendimento) 82/82; persistência
  `agenda-preco` 8/8.
- Teste de aceite da seção 6: API (`agenda-preco.int.spec.ts`), telas (`estruturada-telas.spec.ts`, 19/19) e conector
  (`test_estrutura_agenda.py`): verdes.
- `conector/conector.sh testes`: 1.230 testes, OK (10 pulados, 2 falhas esperadas).
- `permissoes:verificar`: verde (código 0).
- O cliente `adr9c_conf` e a plataforma de teste `plataforma_teste_adr9c_conf` foram apagados no fim.

### O que continua pendente (fora desta rodada)
- A prévia `precoDoAtendimento` não calcula o alvo `exame` (o lançamento calcula).
- O plano do paciente na marcação (contrato da marcação e tela); hoje, sem plano, o credenciamento só alerta.
- Teste HTTP ponta a ponta de `agenda.agendarConsulta` recusando por bloqueio (a função é testada direto).
- Os 1.006 trechos não interpretados da cópia real e a carga completa num cliente de teste, na próxima importação
  pelo painel; os textos por convênio não foram medidos na imagem.
