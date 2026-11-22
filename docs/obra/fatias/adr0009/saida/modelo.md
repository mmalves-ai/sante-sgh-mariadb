# ADR 0009, mudança compartilhada (modelo): mapa para os lotes seguintes

Rótulo `modelo`. Prova: `validar_migracoes` ok (3682 tabelas, 0 erros, 14112 FKs); `tsc` de `contratos`,
`persistencia` e `apps/api` ok; unidade da persistência 3/3; unidade dos contratos 829/829; integração 6/6 (duas rodadas seguidas) no cliente
`adr9_modelo` (plataforma de teste `plataforma_teste_adr9_modelo`, apagados no fim); conector: `verificar_mapa` ok e
`test_l8_01`, `test_l6_03`, `test_l6_04` ok.

## DDL (migrações novas, só para frente)

| Arquivo | O quê |
|---|---|
| `db/migracoes/03_CAD/41_tabelas.sql` | `fonte_pagadora` + `bloqueia_sem_credenciamento` (padrão falso = alerta), `credencia_todos_ao_criar` (padrão falso), `codigo_permissao_atendimento` (SMALLINT, o `permiteAtendimento` da API de compatibilidade, ex.: 3) |
| `db/migracoes/05_AGE/21_tabelas.sql` / `21_chaves.sql` | `agenda_servico` + `codigo_origem`, `sexo_atendido` (todos/feminino/masculino), `aceita_retorno`, `preparo` (TEXT); `observacao` virou MEDIUMTEXT (sem corte). Tabelas novas `texto_origem_agenda`, `trecho_texto_agenda`, `agenda_cobertura`, `agenda_restricao`, `agenda_preparo` |
| `db/migracoes/12_FAT/31_tabelas.sql` / `31_chaves.sql` | Tabela nova `regra_preco_particular`; copia os dois `valor_consulta` (só fonte de tipo `particular`) e REMOVE as colunas de `profissional_fonte_pagadora` e `codigo_prestador_fonte_pagadora`; `conta_hospitalar_item_memoria` + `regra_preco_particular_id` (FK) |

Já existiam e são reaproveitados: credenciamento = `profissional_fonte_pagadora` (profissional, fonte, estabelecimento
nulo = rede, plano nulo = todos, `credenciado`, vigência); subplano = `plano_fonte_pagadora.plano_superior_id`; vigência
da agenda = `agenda_servico.vigencia_inicio/fim`; idade, retorno e encaixe = `agenda_servico.idade_minima_anos`,
`idade_maxima_anos`, `dias_retorno`, `permite_encaixe`, `encaixes_por_dia`; convênio aceito pela agenda =
`agenda_fonte_pagadora`. **Repasse "particular integral ao médico":** coberto por `regra_repasse_item`
(`fonte_pagadora_id` = particular, item ou grupo de consulta, `percentual` 100): sem DDL novo.

### Tabelas novas (colunas principais; todas com auditoria, `versao`, `origem`)

- `regra_preco_particular`: `estabelecimento_id` (nulo = rede), `fonte_pagadora_id` NOT NULL (o domínio confere tipo
  particular), dono `profissional_id` XOR `agenda_servico_id` (CHECK `ck_..._dono`), `alvo` item|grupo|consulta com
  `item_faturavel_id` / `grupo_faturamento_id` (CHECK `ck_..._alvo`: exatamente o do alvo; `consulta` = qualquer
  consulta do dono, sem item, que é o que a origem tem), `valor` ≥ 0, `prioridade` (menor vence), vigência,
  `situacao_revisao` estimada|confirmada|recusada (estimada já vale; recusada não), `texto_origem_agenda_id`, `ativo`,
  `excluido_em`.
- `texto_origem_agenda`: `agenda_servico_id`, `fonte_pagadora_id` (só em `campo`=`observacao_convenio`), `campo`
  observacao|orientacao_marcacao|observacao_convenio, `texto` MEDIUMTEXT íntegro, `hash_texto` BINARY(16) =
  `UNHEX(LEFT(SHA2(texto,256),32))` (o mesmo em Node `hashTextoAgenda` e no conector: `sha256(utf8)[:16]`),
  `situacao_estruturacao` pendente|extraida|revisada|sem_regra, `versao_extrator`, `extraido_em`. UNIQUE (agenda, campo,
  fonte).
- `trecho_texto_agenda`: `texto_origem_agenda_id`, `posicao_inicio`/`posicao_fim` (caracteres, base 0, fim exclusivo),
  `interpretado` (falso = trecho não interpretado, vale pelo texto), `tipo_regra` preco|cobertura|restricao|preparo
  (nulo se não interpretado), `motivo`.
- `agenda_cobertura`: `agenda_servico_id`, `fonte_pagadora_id`, `plano_fonte_pagadora_id` (nulo = convênio inteiro),
  `aceita` (falso = exclui), vigência, `texto_origem_agenda_id`, `situacao_revisao`. Regra: sem linha vale o convênio da
  agenda; com `aceita` só esses planos; `aceita`=falso exclui.
- `agenda_restricao`: agenda + `fonte_pagadora_id`/`plano_fonte_pagadora_id`/`item_agendavel_id` opcionais;
  `sexo_atendido`, `idade_minima_anos`, `idade_maxima_anos`, `aceita_retorno`, `dias_retorno`, `permite_encaixe`
  (nulo herda da agenda; ao menos um preenchido), vigência, texto, situação.
- `agenda_preparo`: agenda, `item_agendavel_id` opcional, `tipo` preparo|documento|orientacao, `descricao` TEXT,
  `jejum_horas`, vigência, texto, situação.

Catálogo: 6 linhas novas em `docs/analise/rodada2/final/catalogo.tsv`.

## Conector (ajustado)

- `conector/mapa/declarado/colunas.d/L8-01.tsv`: `FCCODCON.VLR_CONSULTA` passa a **não carregada** (coluna saiu).
  `conector/testes/test_l8_01.py` ajustado.
- `L6-03.tsv` (`REAGENDA.OBS` → regra `texto`) e `L6-04.tsv` (`SIAGENDA.OBSERVACAO` → `texto_longo`): sem o corte de
  2.000.

## Contratos (`@sgh/contratos`)

- `packages/contratos/src/faturamento/preco-particular.ts`: `esquemaEntradaRegraPrecoParticular`,
  `esquemaRegraPrecoParticular`, `esquemaFiltroRegrasPrecoParticular`, `esquemaCredenciamento`,
  `esquemaEntradaCredenciamento`, `esquemaOpcoesCredenciamentoConvenio`, `esquemaVerificacaoCredenciamento` (efeito
  nenhum|alerta|bloqueio), `esquemaResultadoCalculoPreco` (valor, `origem` em `ORIGENS_PRECO`, ids da regra e da
  tabela, `textoOrigemId`, `estimada`, credenciamento, explicação, recusa item-sem-preco|profissional-nao-credenciado);
  constantes `ALVOS_REGRA_PRECO`, `DONOS_REGRA_PRECO`, `SITUACOES_REVISAO_REGRA`, `ORIGENS_REGRA_AGENDA_PRECO`.
- `packages/contratos/src/agenda/estruturada.ts`: `esquemaTextoOrigemAgenda` (+ trechos), entradas de texto,
  cobertura, restrição e preparo, as formas lidas e `esquemaAgendaEstruturada` (padrão da agenda, convênios,
  coberturas, restrições, preparos, preços particulares e textos originais).
- Parâmetro novo `faturamento.fontePagadoraParticularCodigo` (texto, estabelecimento/rede; vazio = a única fonte ativa
  de tipo particular) em `packages/contratos/src/parametros/definicoes.ts`.

## Portas (`@sgh/persistencia`, pacote novo `packages/persistencia`, alias em `tsconfig.base.json`)

`packages/persistencia/src/agenda-preco/porta.ts`, funções sobre `Leitor`/`Escritor` do `@sgh/nucleo` (a API passa a
`TxOperacao` do executor para ter trilha e idempotência):
`incluirRegraPrecoParticular`, `revisarRegraPrecoParticular` (versão), `listarRegrasPrecoParticular`,
`candidatasPrecoParticular` (vigentes, ativas, não recusadas, do profissional OU da agenda, estabelecimento ou rede; a
escolha da mais específica é do domínio), `fonteParticularPadrao`, `opcoesCredenciamentoConvenio`,
`definirOpcoesCredenciamentoConvenio`, `credenciamentosVigentes`, `incluirCredenciamento`, `credenciarTodosAtivos`
(idempotente), `gravarTextoOrigemAgenda` (hash; mudou → pendente e `mudou: true`), `gravarTrechosTexto`,
`retirarEstimadasDoTexto` (só estimadas; confirmadas ficam), `incluirCoberturaAgenda`, `incluirRestricaoAgenda`,
`incluirPreparoAgenda`, `lerAgendaEstruturada(l, agendaId, data?)`. Conversões puras em `linhas.ts`
(`hashTextoAgenda` etc.). Integração: `vitest.integracao.config.ts` com `SGH_BANCO_PLATAFORMA` e `SGH_CLIENTE_TESTE`.

## Volta 2 (mudança compartilhada, rótulo `adr9b_modelo`)

Prova: `validar_migracoes` ok (3683 tabelas, 0 erros, 14117 FKs); `tsc` de `contratos`, `persistencia`,
`dominio-preco`, `dominio-agenda` e `apps/api` ok; `vue-tsc` da web ok; unidade: contratos 829/829, persistência 3/3,
`dominio-preco` 54/54, `dominio-agenda` 129/129, web (agenda) 22/22; integração da persistência 8/8, duas rodadas
seguidas, no cliente `adr9b_modelo` (plataforma `plataforma_teste_adr9b_modelo`, os dois bancos apagados no fim).

- **Pendência 3 (exame sem item):** `db/migracoes/12_FAT/32_tabelas.sql` troca o CHECK `ck_regra_preco_particular_alvo`:
  alvo novo `exame` = o exame padrão da agenda, sem item e sem grupo, **só com dono agenda**. Contrato:
  `ALVOS_REGRA_PRECO` + `exame`, alvo `{ tipo: 'exame' }`, a entrada recusa `exame` com dono profissional. Domínio
  (`dominio-preco`): `AlvoPreco.exame?` (opcional), peso igual ao da consulta (item e grupo vencem), explicação "do
  exame da agenda". Tela: rótulo `estruturada.preco.alvoExame`.
- **Pendência 8 (nomes):** `esquemaCredenciamento` + `profissionalNome`, `fontePagadoraNome`, `estabelecimentoNome`
  (nulo = rede), `planoNome` (nulo = todos). `esquemaAgendaEstruturada` + `estabelecimentoId`/`estabelecimentoNome`,
  `profissionalNome`, `conveniosAceitos` [{ `fontePagadoraId`, `nome` }] (o `convenios` de ids continua);
  cobertura + `fontePagadoraNome`, `planoNome`, `planoSuperiorNome`; restrição + `fontePagadoraNome`, `planoNome`. A
  persistência lê os nomes por junção (profissional = nome de exibição ou nome civil; estabelecimento = nome
  fantasia; plano = descrição).
- **Pendência 1 (preço particular da origem por fonte):** tabela provisória `preco_consulta_origem` (12_FAT/32;
  catálogo + 1 linha): valor de consulta do profissional por fonte, `situacao` pendente|aplicada|descartada, CHECK
  aplicada ⇔ regra ligada, pendente ⇔ sem `decidido_em`; UNIQUE (fonte, profissional, vigência, estabelecimento).
  Porta `aplicarPrecosConsultaOrigem(e, fonteId, usuario)`: fonte `outro` não decide; `particular` cria
  `regra_preco_particular` (alvo consulta, dono profissional, origem migracao) e marca aplicada; outro tipo marca
  descartada (decisão 24), com o valor guardado para a conciliação. Idempotente.

### Pendências da volta 2 para os outros lotes
- Conector: gravar `FCCODCON.VLR_CONSULTA` em `preco_consulta_origem` (fonte, profissional, código do prestador,
  vigência da carga) e chamar a aplicação depois da classificação do tipo da fonte (tela ou Sincronizar).
- API: passar `alvo.exame` ao domínio quando o item lançado é o exame padrão da agenda (hoje só `consulta`); o
  extrator do texto pode gerar a regra `exame` para "valor do exame particular" sem item.
- Telas: usar os nomes novos (credenciamento, coberturas, restrições, convênios da agenda) no lugar da busca por id;
  `RegraPrecoForm` ainda não oferece o alvo `exame`.

## Pendências para os lotes seguintes

1. Domínio (`dominio-preco`): escolher a regra (item > grupo > consulta; estabelecimento > rede; prioridade; vigência
   mais recente; id) e ligar no cálculo do particular ANTES da tabela; gravar `regra_preco_particular_id` na memória.
2. Domínio da agenda/atendimento: credenciamento com alerta ou bloqueio (`bloqueia_sem_credenciamento`) e o
   `credenciarTodosAtivos` no "criar convênio" quando `credencia_todos_ao_criar`.
3. Conector: carregar `FCCODCON.VLR_CONSULTA` do particular como `regra_preco_particular` (alvo consulta, origem
   migracao); `texto_origem_agenda` dos três campos; `agenda_servico.codigo_origem`;
   `fonte_pagadora.codigo_permissao_atendimento` (TBCONVEN.PERMITE_ATEND); `credencia_todos_ao_criar` ligado no cliente
   importado (decisão 26); regra de repasse 100% da consulta particular (`TBCONVEN.VLR_CONSULTA_MEDICO`); o extrator e
   o Sincronizar (texto mudou → `retirarEstimadasDoTexto` + nova extração).
4. Telas e rotas (API) sobre os contratos acima; teste de aceite completo da seção 6 no domínio (a integração já
   prova as quatro perguntas de exemplo na leitura da agenda estruturada).
