# F2.4, 3ª etapa: DDL aplicado (pedidos da 2ª volta)

Pedidos de DDL lidos em `docs/obra/fatias/f24/saida/*.json` e `*.md`, sem os que têm `substituido_por` e sem os que
o `ddl-aplicado-v2.md` já fechou. As migrações seguem só para frente, no padrão do ADR 0002: PK `id`, auditoria, FK
`ON DELETE RESTRICT`, `CHECK` em vez de `ENUM` e nenhum gatilho.

- **Arquivos novos:** `db/migracoes/<módulo>/22_tabelas.sql` e `22_chaves.sql` em 03_CAD, 08_CC, 13_SUS, 14_FIN e
  15_RH. A tabela nova entrou em `docs/analise/rodada2/final/catalogo.tsv`.
- **Número 22:** não colide com a trilha F4 (`git diff main...f4-conector`). A F4 mexe em `vinculo_trabalho` e em
  `cadastro_empregador` só pelo CHECK do tipo de admissão e por `geracao_evento_pagamentos`, e no SUS só por
  `dominio_sus` e `conta_hospitalar_item.apac_id`. Nenhuma coluna ficou duplicada.
- **Dados existentes:** todas as tabelas com coluna `NOT NULL` nova sem DEFAULT, coluna apagada ou CHECK mais
  restrito estavam vazias nos 44 clientes de dev e teste. São elas: `lote_folha_intercambio`, `processamento_folha`
  e a linha dele, `conferencia_eventos_esocial_item`, `critica_sus`, `remessa_apac`, `conta_aih`, `retorno_sus` e
  `registro_recuperacao_anestesica`.
- **Prova:** ver "Prova" no fim.

## Aplicado

| Tabela | Colunas / mudança | Pedido | Arquivo que destrava |
|---|---|---|---|
| lote_folha_intercambio | `numero` INT NOT NULL, com UNIQUE (estabelecimento, numero) pela sequência `lote_folha_intercambio`; o CHECK da situação aceita `substituido` | 03-pessoas | api/pessoas/folha/porta-folha-propria.ts:8,112 |
| avaliacao_desempenho | `marco_experiencia_chave`, gerada (0 fora da experiência). `uq_avaliacao_desempenho_versao` sai e entra `uq_avaliacao_desempenho_versao_marco`, que conta o marco de 45 ou 90 dias | 03-pessoas (baixa) | api/pessoas (avaliação): a porta deixa de contornar com o "próximo número livre" |
| cadastro_empregador_motivo_afastamento (nova) | cadastro do empregador (a vigência), motivo de afastamento, `codigo_esocial` CHAR(2) com CHECK de 2 dígitos; UNIQUE (cadastro, motivo) | 03-pessoas | api/pessoas/esocial/porta-esocial-propria.ts:22-27,93-109 (empregador) |
| vinculo_trabalho | `regime_controle_jornada` (`submetido_horario`, `atividade_externa`, `cargo_confianca`, `teletrabalho`) e `indicativo_admissao` (`normal`, `acao_fiscal`, `decisao_judicial`), NOT NULL com DEFAULT | 03-pessoas (f22 03-05, ficha) | api/pessoas/esocial/porta-esocial-propria.ts:116,480,805 (ficha e gravarFicha) |
| conferencia_eventos_esocial_item | CHECK da situação: `conciliado`, `dois_transmissores`, `repasse_no_periodico`, `repasse_no_externo`, `so_contagem`, `sem_transmissor` (com UPDATE de `conciliada` para `conciliado`) | 03-pessoas | api/pessoas/esocial/porta-esocial-propria.ts:27 (conferência com linha divergente) |
| processamento_folha | CHECK da situação aceita `substituida`. Saem `fora_da_folha`, `tabela_legal` e `parametros`, que eram JSON. Entram `quantidade_fora_da_folha` SMALLINT NOT NULL DEFAULT 0, `tabela_legal_inicio` DATE e `parametros_inicio` DATE | 03-pessoas | api/pessoas/folha/porta-calculo-propria.ts:13,101,248 (11 leituras, o gravador, férias e rescisão) |
| processamento_folha_linha | `unidade` VARCHAR(12) NOT NULL (`dias`, `minutos`, `dependentes`, `percentual`, `valor`) e `memoria_calculo` VARCHAR(400) NOT NULL DEFAULT '' | 03-pessoas | idem |
| integracao_folha_financeiro_destino | `conta_contabil_id` (FK `conta_contabil`) | 03-pessoas | api/pessoas/folha/porta-integracao-propria.ts (contaContabil) |
| cota_depreciacao | `vida_util_meses`, `coeficiente_turno`, `centro_custo_id` (FK) e `valor_residual_bem`, todos anuláveis e com CHECK de positivos | 05-misto-agenda (baixa) | api/patrimonio/porta-propria.ts (retrato do cálculo na cota) |
| avaliacao_pre_anestesica | `ultimo_liquido_claro_em`, `ultimo_leite_materno_em`, `ultima_refeicao_leve_em`, `ultima_refeicao_gordurosa_em` | 05-misto-agenda | api/cirurgia (porta da avaliação pré-anestésica: jejum por tipo) |
| avaliacao_recuperacao_anestesica | `pressao_sistolica`, `pressao_diastolica`, `frequencia_cardiaca`, `saturacao_oxigenio` e `regra_alta_versao`, com CHECKs de faixa | 05-misto-agenda | api/cirurgia (porta da recuperação pós-anestésica: avaliação e alta) |
| registro_recuperacao_anestesica | CHECK `nausea_vomito_alta <= 3`, como na avaliação | 05-misto-agenda | idem (a alta com 3 deixa de gravar nulo) |
| lancamento_ficha_anestesica | `procedimento_cirurgico_id` (FK), só na parte `procedimento` | 05-misto-agenda (baixa) | api/cirurgia (ficha anestésica, lançamento de procedimento) |
| fonte_pagadora | `unidade_federativa_id` e `nota_fiscal_unidade_federativa_id` (FK `unidade_federativa`) | 08-misto-assinatura (fonte_pagadora para preços) | api/precos/fonte-propria.ts:103,909 (`uf` e `nfUf` em `COLUNA_FONTE`) |
| competencia_sus | `criticada_em` | 23-misto-coexistencia e 08-misto-assinatura (SUS) | api/sus/porta-propria.ts:121 e 754 (gravarCriticas) |
| critica_sus | CHECK do alvo aceita a crítica com atendimento e a crítica da competência inteira, sem conta (a montagem gera `conta: null`), desde que tenha regra e chave. O texto da crítica vai em `descricao` e o JSON em `detalhe` | idem | api/sus/porta-propria.ts:754,758 (gravarCriticas, justificar) |
| remessa_bpa, remessa_ciha, remessa_sisaih | CHECK do arquivo gerado: hash e (`arquivo_id` ou `chave_objeto`). O arquivo fica no armazenamento pela chave e pela versão (ADR 0004) | idem | api/sus/porta-propria.ts:762,766,770,902 (proximoArquivo, gravarArquivo, gravarArquivoBpa, gravarArquivoSisaih) |
| remessa_apac | `quantidade_procedimentos`, `gerador_usuario_id` (FK) e `substituta_remessa_apac_id` (FK). A situação aceita `conferida` e `substituida`. O CHECK do arquivo segue o dos outros instrumentos | idem | api/sus/porta-propria.ts:782 (gravarArquivoApac) |
| autorizacao_apac | `tipo_apac` (`inicial`, `unica`), `cns_autorizador`, `ultima_competencia`, `motivo_saida_dominio_sigtap_id` (FK), `data_encerramento` e `motivo_cancelamento`. A situação aceita `encerrada`. CHECKs: a negada exige motivo, a encerrada exige motivo de saída e data, e a cancelada exige motivo | idem | api/sus/porta-propria.ts:774,778 (incluirApac, mudarApac: autorizar, negar, cancelar, continuar, corrigir, encerrar) |
| apac_procedimento | `conta_hospitalar_id` (FK) | idem | api/sus/porta-propria.ts:782 (linha da APAC com a conta) |
| autorizacao_internacao_sus | `conta_hospitalar_id` (FK) e `cns_autorizador`. CHECK: negada, cancelada ou devolvida exigem motivo | idem | api/sus/porta-propria.ts:878-894 (inserirAih, autorizarAih, negarAih, cancelarAih) |
| conta_aih | `competencia_sus_id` passa a anulável, nula até o arquivo. Entram `numero_fechamento` (UNIQUE com a autorização), `diarias_uti`, `diarias_uti_mes_anterior` e `motivo_situacao`. A situação aceita `reaberta`. CHECKs: apresentada, aprovada ou rejeitada exigem competência e remessa; reaberta ou cancelada exigem motivo | idem | api/sus/porta-propria.ts:886,898,902,910 (reabrirAih, fecharAih, gravarArquivoSisaih, aplicarRetornoNaAih) |
| conta_aih_procedimento | `tipo_leito_uti` e o tipo `diaria_uti` (CHECK: só a diária de UTI tem o tipo de leito, e ela sempre tem) | idem | api/sus/porta-propria.ts:898 (itens do fechamento) |
| conta_aih_opm | `conta_hospitalar_item_id` (FK) | idem | idem (OPM, que é órtese, prótese e material especial, com o item da conta) |
| retorno_sus | `arquivo_id` passa a anulável: o retorno é identificado pelo nome e pelo SHA-256, que é UNIQUE por estabelecimento | idem | api/sus/porta-propria.ts:906,910,914 (inserirRetornoSus, tratarRetornoSus) |
| retorno_sus_item | `motivo` VARCHAR(500), como veio no arquivo, e UNIQUE (retorno, identificação), que dá a idempotência da linha | idem | idem |

## SUS: o que as 18 operações usam e que já existia (sem DDL)

- **Faixa de AIH** (inserirFaixaAih, mudarFaixaAih): `faixa_numeracao_aih` com `instrumento = 'aih'`,
  `orgao_emissor`, `data_liberacao`, `quantidade_usada`, `recebida_em`, `recebida_por_usuario_id` e
  `motivo_situacao`, que o CHECK exige no cancelamento.
- **AIH** (inserirAih):
  - a raiz é `autorizacao_internacao_sus`, que aponta o `laudo_internacao_sus`;
  - o laudo guarda a justificativa em `sinais_sintomas` e o solicitante em `solicitante_profissional_id` ou
    `solicitante_externo_id`;
  - a situação da tela é a da autorização até o primeiro fechamento e, depois dele, a da última `conta_aih`;
  - a reabertura marca o fechamento como `reaberta`, e o fechamento seguinte abre `numero_fechamento + 1`;
  - as reapresentações são contadas pelas linhas de retorno tratadas com `reapresentar`.
- **CIHA** (gravarArquivo): `remessa_ciha` + `registro_ciha` + `registro_ciha_procedimento`.
- **BPA** (gravarArquivoBpa):
  - as linhas vão para `producao_ambulatorial_sus` e `producao_ambulatorial_sus_item`. A folha é única por
    competência;
  - a nova geração passa as folhas para a remessa nova, troca os itens e marca a anterior como `substituida`, com
    `substituta_remessa_bpa_id`. O conteúdo do arquivo antigo continua no armazenamento.
- **Número do arquivo** (proximoArquivo): é a sequência de negócio comum aos quatro instrumentos, gravada em
  `remessa_*.numero`, que é UNIQUE por estabelecimento. A leitura `arquivo(id)` procura pelo número nas quatro
  remessas.
- **APAC:**
  - a raiz é o `laudo_apac`. A tela tem 5 situações e o laudo tem 6 (rascunho, solicitado, autorizado, negado,
    cancelado e encerrado);
  - o laudo de nefrologia vai para `laudo_apac_nefrologia`;
  - a produção de cada competência fica em `apac` + `apac_procedimento`. O tipo no arquivo (1, 2 ou 3) é o
    `apac.tipo_apac`.

## Decisões pela melhor prática (para o dono ver)

1. **Jejum por tipo em colunas, e não em JSON.** O pedido trazia `jejum_por_tipo` em JSON. Os tipos são quatro e
   fixos, os mesmos do CHECK de `tipo_ultima_ingestao`. Por isso viraram quatro colunas de data e hora, que dão para
   consultar e conferir. `ultima_ingestao_em` e `tipo_ultima_ingestao` continuam com a mais recente.
2. **Ficha do eSocial do vínculo, estruturada e não cifrada à parte.** O pedido f22 03-05 dizia que esses dados são
   cadastro da pessoa e do vínculo. Quase tudo já existia:
   - **na pessoa:** sexo, raça e cor, estado civil, escolaridade, nome social, nascimento, país de nascimento,
     nacionalidade e NIS (`pis_pasep`);
   - **em outras tabelas:** o endereço (`endereco_pessoa`) e o estágio (`estagio_colaborador`);
   - **no vínculo:** categoria, natureza da atividade, tipo e término do contrato, tipo de admissão e sindicato;
   - **no regime de jornada:** tipo de jornada, tempo parcial e descrição da jornada;
   - **no cargo e na função:** o CBO, que é a Classificação Brasileira de Ocupações.

   Faltavam só o controle da jornada (tabela oficial de regime de jornada) e o indicativo de admissão. **A porta
   hoje grava a ficha como um texto cifrado (`dadosCifrados`).** Passar a ler e gravar o cadastro estruturado é
   mudança de contrato da porta, de lote.
3. **CNS do autorizador guardado como veio**, na AIH e na APAC (`cns_autorizador`, ao lado de
   `autorizador_sus_id`). O CNS é o Cartão Nacional de Saúde. A tela recebe o CNS digitado e não exige que o
   autorizador do gestor esteja cadastrado. A FK é preenchida quando ele está.
4. **Arquivo do faturamento SUS:** o CHECK aceita a chave do objeto no lugar de `arquivo_id`, pelo ADR 0004 (disco
   da máquina com chave e versão). O hash continua obrigatório.
5. **Unicidade da avaliação de desempenho:** uma coluna gerada (`IFNULL(marco, 0)`) evita que o NULL fure a chave das
   avaliações fora da experiência.
6. **Conta contábil sugerida como FK** (`conta_contabil_id`), e não como texto: o pedido aceitava os dois.
7. **Crítica prévia:** o texto da crítica vai em `descricao` (VARCHAR 1000). `detalhe` continua JSON, para dados
   estruturados.
8. **`fonte_pagadora.senhaObrigatoria` não entrou.** Os valores 1 e 4 vêm do legado e o significado deles está "a
   confirmar" (DP-33). Uma coluna sem significado definido seria inventada. O campo segue recusando com
   `modelo-pendente` até a decisão do faturamento.

## Não aplicado

| Pedido | Por quê |
|---|---|
| 21-misto-farmacia `ato_conta_portal_profissional_externo` | Já existe, com ato, situação anterior, motivo, decisão dos pedidos e pendentes, em 17_INTG/04. |
| `fonte_pagadora` senha obrigatória (`senhaObrigatoria`) | Decisão 8: falta o significado (DP-33). |
| 04-pep-1 e 08-misto-assinatura (coordenadas e implementações) | Não são DDL: são troca de vocabulário e portas a escrever. |

## Prova

- `python3 -I tools/db/validar_migracoes.py` terminou com 0 erros, 3660 tabelas, 13985 FKs e nenhum gatilho.
- As migrações 22 foram aplicadas, sem erro e duas vezes (a segunda prova a idempotência), aos 44 clientes de dev e
  teste: `teste_*`, `demo`, `f22_o*` e `f24_*`. Os bancos da F4 (`cliente_cfl*` e `conector_ctl_*`) não foram
  tocados.
- Nas 28 tabelas criadas ou alteradas, colunas, tipos, nulidade e CHECKs são idênticos nos 44 clientes (879 colunas
  e 202 CHECKs).
- As FKs dessas tabelas também são iguais nos clientes, com uma exceção anterior a esta etapa: o
  `cliente_f24_conferir` tem 13 FKs nessas tabelas, contra 198 nos outros 43. As chaves antigas dele não foram
  aplicadas na criação, e as novas entraram.
