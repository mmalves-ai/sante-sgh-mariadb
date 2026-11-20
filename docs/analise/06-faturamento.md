# Análise cruzada 06: faturamento de convênios, TISS, repasse médico, preços e faturamento SUS

Grupo: **FAT** (contrato e preço, conta do paciente, convênios e TISS, glosa, particular, repasse médico)
e **SUS** (SIGTAP, CIHA, BPA, APAC, AIH e obrigações com o gestor). Data: 2026-11-20. Base: ADR 0001
(banco próprio em MariaDB, virada por conector diferencial).

Fontes lidas (somente leitura):

- MV: `referencias/mv-tabelas.tsv`, esquemas `DBAMV` e `MVINTEGRA`. As tabelas foram classificadas por
  prefixo e descritivo, com conferência tabela a tabela. Só nomes e descritivos de tabela entraram; nenhuma
  linha de dados foi lida e não houve consulta ao Oracle.
- SPDATA: `new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`, módulos FAT (177) e SUS
  (101), mais as tabelas de faturamento que a matriz põe em outros módulos (CAD, FIN, INTG, INT, ADM).
- new-sgh: os pacotes `dominio-faturamento` (`tiss/`, `sus/`, `conta/`, `glosa/`), `dominio-preco`,
  `dominio-repasse` e `dominio-catalogo`; as rotas de `apps/api/src/modulos` (`faturamento`, `tiss`,
  `sus`, `precos`, `repasse`, `financeiro`); as telas de `apps/web/src/modulos` (`faturamento`, `tiss`,
  `precos`, `repasse`, `catalogos`, `financeiro`); `planejamento/ESTADO.md` (marcos M09, M12, M13, M30,
  M31, M33, M42, M51.1 a M51.4 e M55.5); e `planejamento/fonte-pdf/arvore-menus.txt` (ramo
  FATURAMENTO).

Convenções:

- "MV n/d": a funcionalidade tem n tabelas do MV, e d delas têm dados na cópia de referência. Os exemplos
  vêm entre parênteses; o `*` marca tabela com dados.
- Coluna SPDATA: o volume de linhas da matriz indica o uso real. Como a matriz conta só até 1.001,
  "≥1k" quer dizer uso pleno.
- Coluna new-sgh: todos os marcos citados estão **construídos e aguardando validação**. Nenhuma operação
  do faturamento está liberada em produção (onda 4 do M42, DP-3). A persistência do new-sgh ainda lê e
  grava o Firebird pelas portas `porta-legado`; o modelo MariaDB substitui essas portas.
- Os nomes de tabela do MV e do SPDATA aparecem só nas colunas de evidência. As entidades próprias usam
  nomes nossos, em snake_case.
- **Nenhuma regra de negócio fica em gatilho.** O que hoje é gatilho ou procedimento armazenado no SPDATA
  (geração da conta na abertura do atendimento, recálculo do item, totais da conta) vira serviço de
  domínio com evento na mesma transação. Hoje as regras de conta do new-sgh ficam em
  `@sgh/contratos/regras-faturamento` e são reexportadas por `dominio-faturamento`; no modelo novo elas
  passam para dentro do domínio, e o contrato fica só com os tipos.
- Valores em dinheiro são `DECIMAL(15,2)`. Preço unitário, índice e fator ficam em `DECIMAL(15,6)`.
  Quantidades fracionadas de mat/med ficam em `DECIMAL(15,4)`. Toda tabela de preço tem vigência
  (`vigente_desde`, `vigente_ate`). O valor aplicado no item é gravado junto com a memória de cálculo,
  e o preço nunca é recalculado "por cima" depois do fechamento.

## Resumo numérico

| Conjunto | Funcionalidades | Tabelas MV | MV com dados | F3 | F7 | F8 | NAO |
|---|---:|---:|---:|---:|---:|---:|---:|
| FAT: contrato, preço e catálogos | 11 | 67 | 29 | 11 | 0 | 0 | 0 |
| FAT: conta do paciente | 12 | 117 | 30 | 9 | 0 | 3 | 0 |
| FAT: convênios, TISS e glosa | 15 | 274 | 49 | 10 | 4 | 0 | 1 |
| FAT: particular e gestão | 4 | 24 | 7 | 3 | 0 | 1 | 0 |
| FAT: repasse médico | 7 | 85 | 7 | 4 | 0 | 3 | 0 |
| SUS: faturamento SUS | 16 | 292 | 56 | 3 | 11 | 2 | 0 |
| **Total** | **65** | **859** | **178** | **40** | **15** | **9** | **1** |

Conta do total: 67 + 117 + 274 + 24 + 85 + 292 = 859 tabelas, das quais 29 + 30 + 49 + 7 + 7 + 56 = 178
têm dados. As funcionalidades somam 11 + 12 + 15 + 4 + 7 + 16 = 65, e as decisões 40 + 15 + 9 + 1 = 65.
Só o FAT: 567 tabelas (67 + 117 + 274 + 24 + 85), 122 com dados, 49 funcionalidades; o SUS: 292
tabelas, 56 com dados, 16 funcionalidades.

Leitura rápida:

- **A Rede Santé não fatura SUS.** O CNES público do ProntoCardio e do Serrano não tem leito nem
  habilitação SUS, e o SPDATA não tem nenhuma tabela de movimento de AIH, BPA ou APAC. O módulo SUS do
  SPDATA é quase só carga da SIGTAP. A exceção é a **CIHA**, obrigatória para todo hospital: o legado a
  alimenta com cerca de 660 mil itens de conta ligados à SIGTAP (2020 a 2026). Por isso a SIGTAP e a
  CIHA são F3, e o resto do SUS é F7.
- **O MV tem o TISS completo; o SPDATA usa só uma parte.** A Rede Santé usa guia, lote, protocolo,
  demonstrativo e glosa com recurso. Não usa elegibilidade, autorização prévia eletrônica, cancelamento
  de guia nem envio de documentos. Essas transações são F7: um hospital novo vai pedir.
- **O peso do MV está em leiautes que não servem mais.** São 67 tabelas de arquivos próprios de
  operadoras e de convênios estaduais, anteriores ao TISS ou feitos para um cliente: NAO.
- **A Rede Santé trabalha com contrato complexo e repasse simples.** A massa do SPDATA está na conta, no
  lançamento, nas tabelas de preço e no repasse por produção com RPA. O MV tem repasse por plantão,
  valor fixo, mínimo garantido e remuneração variável por resultado, sem dados na cópia: F8.

**Ficaram fora da contagem** as tabelas do MV que tocam o grupo, mas pertencem a outro:

- cadastro da fonte pagadora, planos, carteira e configuração TISS por convênio, já contados na
  análise 02 (linhas 9, 23, 24 e 25): 22 tabelas, 10 com dados (CONVENIO\*, TAB_CONVENIO\*,
  EMPRESA_CONVENIO\*, CON_PLA\*, CON_PLA_TETO, CARTEIRA\*, CONVENIO_CONF_TISS\*, FAIXA_GUIA_CONVENIO\*,
  SITE_INTEGRA_CONVENIO\*, OPERADORA_ANS, OPERADORA_CONVENIO);
- senha de autorização e elegibilidade na recepção (análise 02, linha 37): SENHA_AUTORIZACAO,
  CONVENIO_ORIGEM_SENHA_AUT, PW_CONFIG_TEMPO_AUTZ_CONVENIO;
- CNES, vínculos e CBO do profissional (análise 02, linhas 17, 18 e 29): VINCULO_CNES\*,
  TIPO_VINCULO_CNES\*, SUBTIPO_VINCULO_CNES\*, ORGAO_EMISSOR_CNES\*, PRESTADOR_CBO, PRESTADOR_SUS_CNS,
  PRESTADOR_DATASUS, LOG_PROCESSA_SCNES, CRITICA_PRESTADOR_SUS, EMPRESA_HABILITACOES_SUS, CBO\*, CBOS\*,
  TISS_VERSAO_CBOS\*, TISS_VERSAO_MOT_ALT\*, CARATER_ATENDIMENTO\*;
- financeiro: contas a receber, remessa bancária e lote de cobrança (LOTE_REMESSA\*, LOTE_REC_\*,
  ARQUIVO_REMESSA, descontos e acréscimos de título);
- OPME na cotação e na compra (OPMENEXO_\*, suprimentos), controle de infecção (\*PSIH\*), central de
  ambulâncias (gestão da frota e do chamado), cotas de ressuprimento e orçamento empresarial (ORCA_\*);
- todo o esquema da operadora (`DBAPS`, 2.038 tabelas), coberto pelo M56 do new-sgh; o data warehouse
  (`DBADW`) e o portal (`DBAPORTAL`).

SPDATA no grupo: as 278 tabelas da matriz (FAT 177, SUS 101) foram todas lidas. Também entraram as
tabelas de faturamento que a matriz põe em outros módulos: TBCONVEN, TBINTCRC, MFCCCONV, MFCTAREC,
NFSE\*, TBTISSWEBSERV, TBTISSSCHEMA, TBTISSURLWSSGH, RICGUIAS, RITRFCON, TBPERMISSAO_SUS e TBSUSCEP.

Entidades próprias propostas para as funcionalidades F3 e F7: **227** nomes distintos (lista no fim).

## Matriz de cobertura

### FAT: contrato, preço e catálogos

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 1 | Contrato comercial com a fonte pagadora: qual tabela vale em cada vigência, percentuais sobre honorário e mat/med, desconto por grupo de despesa, regra por via de acesso, itens isentos, teto e alto custo | 11/1 (CONVENIO_PRO_FAT, CONVENIO_PRO_FAT_ISENTO, EXCECAO_PERCENTUAL_COBRANCA, TAB_FAT_GRU_PRO, GRUPO_VAL_CONVENIO\*, PRO_FAT_ALTO_CUSTO, CONV_PLAN_VAL_TETO) | TBHISTTABMM 135, TBHISTTABTHME 102, TBHISTTABTHMI 101, TBHISTTABDTH 95, TBPERMEM ≥1k, TBPERTHM ≥1k, TBSUBDES 166, TBEMIREF 165, TBTIPPLCONV 76, TBFORMULAPAGTO 16, TBENTCON 12, mais 9 enumerações de parâmetro; uso pleno | `dominio-preco` (vigência, modelo de valor); `PUT /cadastros/convenios/:cod/contrato`; ContratoTela (M12, M13) | **F3**: cada conta da Rede Santé é valorada por esse contrato | `contrato_pagador`, `contrato_tabela_vigencia`, `regra_percentual_cobranca`, `regra_desconto_grupo`, `regra_via_acesso`, `item_isento_cobranca`, `teto_cobranca`, `referencia_emissao_matmed`, `diaria_por_plano_local`, `calendario_entrega_fatura` |
| 2 | Catálogo dos itens faturáveis: grupo e subgrupo de faturamento, classificação de despesa, tipo de lançamento e local de cobrança | 14/8 (PRO_FAT\*, GRU_PRO\*, GRU_FAT\*, PRO_FAT_HIERARQUIZADO\*, INDICE_PRO_FAT\*, VAL_PRO_RELACIONADO\*, TIP_DETALHE_GRU_FAT) | TBTIPPRO 431, TBTABATO 29, TBITEATE 31, TBLOCCON 19, TBCLASSI 9, TBTPLANC 5, TBTPPROFPROC 5 | Catálogos do M13; `GET /precos/tabelas`; domínios no CRUD genérico | **F3**: todo item da conta aponta para o catálogo | `item_faturavel`, `grupo_faturamento`, `subgrupo_faturamento`, `classificacao_despesa`, `tipo_lancamento`, `local_cobranca`, `grupo_ato` |
| 3 | Tabelas de preço de procedimentos e honorários (AMB, CBHPM, TUSS, tabela própria e tabela da operadora), com versão, reajuste em lote e desfazer | 7/2 (TAB_FAT\*, VAL_PRO\*, VAL_HONO, FAIXA_FATORES_TABFAT, VAL_EXCED, VAL_TETO_CPM_EXCECAO) | TBPROCTO ≥1k, TBTABTHM ≥1k, TBVLRTHM ≥1k, HTPROCTO ≥1k, FCREFUND ≥1k (cerca de 1,08 mi), FCPROCUNIBHMED 760, TBCTRTHM 99 | HonorariosTela, ImportacoesTela (importação com comparação), proposta e aplicação de reajuste, `reajustes/:lote/desfazer` (M13) | **F3**: o coração da valoração | `tabela_preco`, `versao_tabela_preco`, `preco_procedimento`, `lote_reajuste`, `importacao_tabela`, `diferenca_importacao` |
| 4 | Diárias, taxas e gases por tabela e vigência, com centro de custo | 0/0 (no MV, ficam dentro do preço genérico de item) | TBTABDTH ≥1k, TBVLRDTH ≥1k, TBCTRDTH 75, TBDTHCDC 3 | `GET /precos/diarias/:tab/itens` e vigências (M13) | **F3**: toda internação cobra diária e taxa | `preco_diaria_taxa`, `diaria_taxa_centro_custo` |
| 5 | Índices de cobrança (CH, UCO, filme), porte médico e porte anestésico, com vigência | 11/7 (VAL_INDICE\*, VAL_INDICE_GRU_PRO\*, VAL_INDICE_SETOR, VAL_PORTE\*, VAL_PORTE_MEDICO\*, PORTE_MEDICO\*, PORTE_CIRURGIA\*, INDICE_ACOMODACAO\*, VAL_UCO) | TBINDICE 242, TBINDPRO 5, TBPORMED ≥1k (2015 a 2025), FCPORANE 213 | `GET /precos/portes`; modelo de valor (M13) | **F3**: o honorário sai de índice × quantidade | `indice_cobranca`, `valor_indice`, `valor_porte_medico`, `valor_porte_anestesico` |
| 6 | Materiais e medicamentos pela referência de mercado (Brasíndice, Simpro), com edição, PMC e PFB, equivalência por operadora e de-para com a TUSS | 8/5 (BRASIND, SIMPRO\*, PRECOS_SIMPRO\*, IMP_SIMPRO\*, LOG_BRASINDICE\*, LOG_SIMPRO\*, VAL_PROD_CONV) | TBMATMED ≥1k (cerca de 91 mil), TBVLRMEM ≥1k, TBREFUNI ≥1k, TBHISTBR ≥1k, TBREFMEMTUSS ≥1k, TBVERSAOBRASIN 398, TBCTRMEM 78 | `matmed/edicoes`, `matmed/:tab/itens` com vigências (M13); a licença das referências está pendente (DP-36) | **F3**: o mat/med é a maior parcela da conta | `edicao_referencia_matmed`, `item_referencia_matmed`, `preco_referencia_matmed`, `equivalencia_matmed_pagador`, `equivalencia_matmed_tuss` |
| 7 | Terminologias TISS/TUSS e versões do padrão (procedimentos, motivos de glosa, CBO, unidades, vias, forma de envio, tabelas de domínio) | 10/4 (TUSS\*, TIP_TUSS\*, IMP_TUSS, IMPORTACAO_TUSS, GRUPO_PROCEDIMENTO_TUSS, TISS_VERSAO\*, TISS_VERSAO_SERVICO\*) | Cerca de 45 tabelas de carga: TBTABTHMTUSS ≥1k, TBTISSFORMAENV ≥1k, TBTISSREFIND ≥1k, TBCBOANS_TBVERSAOTISS ≥1k, TBMOTGLO 677, TBCBOANS 277, TBTISSTERMO 76, TBVERSAOTISS 20 | CargaCatalogoTela, ConsultaCatalogoTela, `dominio-catalogo` (leiautes, carga, comparação) (M13) | **F3**: a guia e a glosa usam esses códigos | `terminologia_tiss`, `termo_tiss`, `versao_tiss`, `forma_envio_termo` |
| 8 | Credenciamento para cobrança: quem pode cobrar o quê em cada fonte pagadora, com exceção por procedimento e equipe | 6/2 (PRES_CON\*, PRES_CON_EXCECAO\*, PREST_CONV_CREDENC, PRESTADOR_CONVENIO_LIBERADO, PRO_FAT_SEM_PRESTADOR, EQUIPE_MEDICA) | FCCODCON 768, FCCPSCON 33, TBCREMED 185, TBCREPRS 44, TBCODATI 14, TBCODATI_TBUSERS ≥1k, TBMEDSOL_CODCON ≥1k | `GET /precos/credenciamento`, `credenciamento/complementar`, `codigos-prestador` (M12) | **F3**: sem credenciamento a guia sai recusada | `credenciamento_cobranca`, `excecao_credenciamento`, `codigo_prestador_pagador`, `usuario_codigo_prestador` |
| 9 | De-para do item do hospital para o código da fonte pagadora (exames e serviços) | 0/0 (no MV, dentro do item por convênio da linha 1) | SIREFCON ≥1k | `GET /precos/de-para-exames` (M12) | **F3**: em uso no SADT | `equivalencia_item_pagador` |
| 10 | Atributos próprios de uma operadora na guia (por exemplo, a classificação oncológica de uma Unimed: tratamento, perfil e fase) | 0/0 | TBTPCLASSIFUNIBH 18, TBTPFASEUNIBH 4, TBTPPERFILUNIBH 3, TBTPTRATUNIBH 3 | `GET /precos/unimed` (consulta, M12) | **F3**: modelado de forma genérica, sem tabela por operadora | `atributo_guia_pagador`, `valor_atributo_guia` |
| 11 | Simulador de preço: explicar o valor de um item e medir o impacto de um reajuste | 0/0 | Nada | SimuladorTela, `itens/:id/explicacao`, `dominio-preco/impacto.ts` e `proposta-reajuste.ts` (M13, M30) | **F3**: já construído; é cálculo sobre o motor, sem tabela própria | — |

### FAT: conta do paciente

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 12 | Conta do paciente: abertura, contas parciais por período, dados do segurado, conferência, fechamento, reabertura e cancelamento com motivo | 16/2 (REG_FAT\*, REG_AMB\*, CANC_REG_FAT, CANC_REG_AMB, CID_REG_FAT, CONTA_UNIFICADA, CONFIG_FECHA_CONTA_AUT, SETOR_FATURAMENTO) | FCCTAEXT ≥1k (cerca de 214 mil contas, 2020 a 2026), RECONTAS ≥1k, RICONTAS ≥1k, FCFAIPAC ≥1k, FCDIAEXT ≥1k, FCDIAINT ≥1k; no SPDATA, a conta nasce por gatilho na abertura do atendimento | ContasTela, ContaTela, WorklistFaturamentoTela; fechar, reabrir, conferência e etapas (M30) | **F3**: a unidade de cobrança de tudo | `conta_paciente`, `periodo_conta`, `situacao_conta`, `diagnostico_conta`, `dados_segurado_conta`, `etapa_conta`, `motivo_cancelamento_conta` |
| 13 | Regras configuráveis de criação e quebra automática de contas (por origem, setor, fonte pagadora) | 4/1 (REGRA_CRIA_CONTA_FFCV, AGRUPA_REGRA_CRIA_CONTA_FFCV\*, EXCECAO_REGRA_CRIA_CONTA_FFCV, RELACIONADO_REGRA_CRIA_CONTA) | Regra fixa: parcial por competência na internação (RICONTAS) | Regra fixa no M30 | **F8**: a regra fixa da Rede Santé cabe na linha 12; a configuração por regra pode esperar | — |
| 14 | Transferência de conta e de itens entre contas, fontes pagadoras e estabelecimentos (troca de convênio) | 9/0 (TRANSFERE_CONTAS, TRANSFERE_EMPRESA_CONVENIO, TRANSFERE_EMPRESA_SETOR, ALT_CONTA_MOV, ORDEM_TRANSFERENCIA_REMESSA, MOTIVO_TRANSFERENCIA) | RITRFCON 121 (troca de convênio na internação, 2020 a 05/2026) | Troca de convênio no ADT (M21); transferência de item entre contas pela conta | **F3**: a troca de convênio move itens já lançados | `transferencia_conta`, `transferencia_item_conta` |
| 15 | Lançamento de itens na conta (procedimento, taxa, diária, mat/med, honorário), com equipe, grau de participação, sequencial e memória do preço | 4/4 (ITREG_FAT\*, ITREG_AMB\*, ITLAN_MED\*, ATI_MED\*) | FCLANEXT ≥1k, FCLANEXTSEQITEM ≥1k, REPROEXT ≥1k, RIPROEXT 103 | LancamentosTela, `POST /faturamento/contas/:id/itens`, explicador; `faturamento.lancarItem` completa e desligada: reprodução de 94,60% em diárias e taxas, 90,64% em honorários, 89,64% em SADT e 0,75% em mat/med (D-REPRO-MM-30) | **F3**: é a maior massa do faturamento | `item_conta`, `participante_item_conta`, `grau_participacao`, `memoria_preco_item` |
| 16 | Lançamento automático por regra: itens vindos da prescrição, do SADT, do centro cirúrgico e de kits, com exceção e item tardio | 14/5 (REGRA\*, ITREGRA\*, ITREGRA_EXCECAO\*, ITREGRA_EXCECAO_PRO_FAT\*, ITCOB_PRE\*, ITPRE_FAT, CONTA_KIT, REG_EXC_MATMED) | Sem tabela própria; no SPDATA, o lançamento vem das telas de origem e de gatilhos | LancamentoAutomaticoTela, `lancamentos/painel`, decisão sobre item tardio, RegrasTela (M30) | **F3**: na Rede Santé, a maioria dos itens nasce assim; no modelo novo, por evento de domínio e não por gatilho | `regra_lancamento`, `item_regra_lancamento`, `excecao_regra_lancamento`, `kit_cobranca`, `item_kit_cobranca`, `origem_lancamento` |
| 17 | Cobrança em horário especial (urgência, noturno, fim de semana, feriado), com acréscimo por procedimento | 4/2 (HORARIO_ESPECIAL\*, ITHORARIO_ESPECIAL\*, HORARIO_ESPECIAL_PROCED, CONTA_PROCED_HORARIO_ESPEC) | FCHORATE 7 (expediente por tabela), percentuais de horário em TBPERTHM | Lido do legado pela porta do motor de preço (M13, M30) | **F3**: mexe no valor do honorário de hoje | `horario_normal_tabela`, `acrescimo_horario_especial` |
| 18 | Acréscimos e descontos na conta, com motivo, alçada e exceção | 9/2 (ACRESC_DESCONTOS\*, DESCONTOS_ACRESCIMOS\*, DESC_ACRES_CONTA, CONTA_ACRES_DET, EXCECAO_ACRES_DESC, PERM_ACRES_DESCONTO) | Desconto por subgrupo no contrato (TBSUBDES 166); desconto no particular | Desconto no orçamento e no caixa do particular (M30) | **F3**: ajuste manual com trilha e alçada | `ajuste_conta`, `motivo_ajuste_conta`, `alcada_ajuste` |
| 19 | Descontos comerciais por volume de fatura e franquias | 9/2 (FRANQUIAS\*, FRANQUIA_VALOR_TOTAL\*, FRANQUIAS_EXCECAO, FAIXA_DESCONTO, ITFAIXA_DESCONTO, REG_DESC_EMP_CON_PLA, VAL_PONTO_FRANQUIA) | Coparticipação por valor ou percentual (TBTIPCOPART 2, TBTIPPLANO 2); quase sem uso | Nada | **F8**: acordo comercial de volume; a Rede Santé não usa | — |
| 20 | Pacotes: o que entra e o que fica fora, tetos, diária por acomodação, pacote na conta e descaracterização com motivo | 19/7 (PACOTE\*, PACOTE_PRO_FAT\*, PACOTE_EXCECAO\*, CONTA_PACOTE\*, DIARIA_TIPO_ACOMODACAO_PACOTE\*, MOTIVO_DESCARACT_PACOTE\*, LOG_DESCARACTERIZACAO_PACO\*, PACOTE_TETOS) | TBPACTHM 335, FCORCPAD 1, FCORLAME 1 | PacotesTela, `GET/POST /faturamento/pacotes`, regra de pacote no explicador (M30) | **F3**: cirurgias e exames da Rede Santé são cobrados em pacote | `pacote`, `versao_pacote`, `item_incluso_pacote`, `excecao_pacote`, `teto_pacote`, `pacote_conta`, `descaracterizacao_pacote` |
| 21 | Auditoria de contas (enfermeiro e médico auditor; auditoria externa da operadora), com retrato antes e depois e itens auditados | 17/3 (AUDITORIA_CONTA\*, AUDITORIA_PARCIAL, AUDITORIA_IN_LOCO, EMPRESA_AUDITORIA_FFCV, ITREG_FAT_ORIGINAL\*, ITREG_AMB_ORIGINAL\*, ITREG_FAT_ESPELHO, PRO_DSP_AUDIT_CONV) | FCCTAAUD ≥1k, FCLANAUD ≥1k, FCEMPAUDPLANSERV 9 | AuditoriaTela, `contas/:id/auditoria` e versões; `auditarConta` só especificada (P2) | **F3**: em uso diário; o retrato é por versão gravada, não por gatilho | `auditoria_conta`, `versao_auditoria_conta`, `item_auditoria_conta`, `empresa_auditoria_externa`, `item_dispensado_auditoria` |
| 22 | Pendências e irregularidades da conta (falta de CID, assinatura, guia) e protocolo de documentos entre setores | 7/2 (PENDENCIA_CONTA, TIPO_PENDENCIA, IT_PENDENCIA, TIPO_JUSTIFICATIVA_PENDENCIA, PROTOCOLO_DOC\*, IT_PROTOCOLO_DOC\*) | FCIRREGULARID 218, TBIRREGULARID 39, TBIRREGULARID_TBMODULO 43, TBIRREGCTRCTA 4 | PendenciasTiposTela, `contas/:id/pendencias`, `pendencias/:id/resolver` (M30) | **F3**: trava o fechamento da conta | `tipo_pendencia_conta`, `pendencia_conta`, `protocolo_documento`, `item_protocolo_documento` |
| 23 | Cobrança de serviços acessórios por regra (ambulância por km ou trajeto, ligação telefônica tarifada) | 5/0 (REGRA_COBRANCA_AMBULANCIA_KM, REGRA_COBRANCA_AMBULANCIA_TRAJ, REGRA_LIGACAO, TIPO_LIGACAO, TIPO_LIGACAO_TARIFADOR) | Nada | Nada | **F8**: o caso raro se resolve com lançamento manual | — |

### FAT: convênios, TISS e glosa

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 24 | Guias do convênio no hospital: número da guia e da senha, anexos, pendência, histórico, usuário responsável e fluxo de guias do centro cirúrgico | 26/9 (GUIA\*, IT_GUIA\*, ANEXOS_GUIA\*, LOG_GUIA\*, LOG_GUIA_OBS\*, MOTIVO_PENDENCIA_GUIA\*, FSCC_CONFIG_WORKFLOW_GUIAS\*, CONVENIO_INTEGRA_SOL_GUIA\*, USUARIO_RESP_GUIA, CONTROLE_SLA_GUIA_FFCV) | FCGUIAS ≥1k, RICGUIAS ≥1k (internação), TBSEGUIA 41; senha do SADT em SICADATE ≥1k | `GET /tiss/guias`, impressão da guia, GuiasTela (M31); senha no atendimento (M20) e na internação (M21) | **F3**: toda conta de convênio carrega guia e senha | `guia_pagador`, `item_guia_pagador`, `anexo_guia`, `pendencia_guia`, `historico_guia`, `sequencial_guia`, `responsavel_guia` |
| 25 | OPME na guia: solicitação, cotação, alçada de aprovação e valor autorizado por item | 7/1 (VAL_OPME_IT_GUIA\*, VAL_OPME_IT_GUIA_MGCO, AUT_GUIA_OPME_ALCADA, CAT_PROD_OPME_ALCADA, CONF_LIMITE_OPME_OC, CONF_FLUXO_GUIA_OPME, LOG_ITEM_GUIA_OPME) | Nada no faturamento (a Rede Santé cobra OPME como mat/med) | ConsignadosTela (suprimentos); nada na guia | **F7**: hospital cirúrgico novo depende da autorização de OPME | `solicitacao_opme`, `item_solicitacao_opme`, `aprovacao_opme`, `limite_opme_procedimento` |
| 26 | Elegibilidade do beneficiário e comunicação de internação e alta à operadora (TISS) | 7/0 (TISS_SOL_ELEG, TISS_RETORNO_ELEG, TISS_RETORNO_ELEG_G, TISS_COMUNICACAO_BENEFICIARIO, TISS_RECIBO_COMUNICACAO_BENFC, COMUNICACAO_BENEFICIARIO) | Nada (a árvore de menus marca como novo) | Só o lado da operadora própria (portal do prestador, M56); nada do lado do hospital | **F7**: transação TISS que a operadora cobra do hospital novo | `consulta_elegibilidade`, `comunicacao_beneficiario`, `recibo_comunicacao` |
| 27 | Solicitação eletrônica de autorização prévia (SP/SADT, internação, prorrogação, quimioterapia, radioterapia, OPME) e consulta do andamento | 22/3 (TISS_SOL_GUIA\*, TISS_ITSOL_GUIA\*, TISS_ITSOL_OP_GUIA, TISS_RETORNO_SOLICITACAO, TISS_RETORNO_SOLICITACAO_PR_GL, TISS_RET_SOL_QUIMIO, TISS_SOLICITA_STATUS_AUTORIZ, INTEGRA_TISS_SOLICITACAO\*, AUTORIZADOR_ELETRONICO) | Nada; a senha é digitada depois de obtida no portal da operadora | Nada do lado do hospital (o M56.5 é o lado da operadora) | **F7**: reduz glosa e tempo de recepção; o hospital novo espera ter | `solicitacao_autorizacao`, `item_solicitacao_autorizacao`, `resposta_autorizacao`, `item_resposta_autorizacao`, `consulta_situacao_autorizacao` |
| 28 | Cancelamento de guia enviada e envio de documentos anexos (TISS) | 6/0 (TISS_SOL_CANCELA_GUIA, TISS_ITSOL_CANCELA_GUIA, TISS_RETORNO_CANCELA_GUIA, TISS_ENVIO_DOCUMENTOS, TISS_RETORNO_DOCUMENTOS) | TBTISSSITCANC 6 e TBTISSSCHEMA 25 (domínios e transações, sem movimento) | Nada | **F7**: transações do padrão que a operadora pode exigir | `cancelamento_guia`, `envio_documento_tiss` |
| 29 | Montagem e emissão da guia TISS (consulta, SP/SADT, resumo de internação, honorário, outras despesas), com equipe, CID, OPME e regras de montagem | 16/5 (TISS_GUIA\*, TISS_ITGUIA\*, TISS_ITGUIA_EQU\*, TISS_ITGUIA_OUT\*, TISS_CONFIG_ATEND\*, TISS_ITGUIA_CID, TISS_ITGUIA_OP, TISS_NR_GUIA, TISS_CONV_IMPRESSAO_GUIA) | TBTISSPARDEF 48, TBTISSTPGUIA_TBTISSPARDEF 69, TBCONVEN_TBTISSPARDEF ≥1k, TBTISSTERMO_TBTPLANC 24, TBTISSGERSPSADTPS 5 | `dominio-faturamento/tiss` (montagem, montador, XML 04.03.00 conferido no XSD oficial), guia de prova (M09, M31) | **F3**: o envio de toda conta de convênio passa por ela | `guia_tiss`, `procedimento_guia_tiss`, `profissional_guia_tiss`, `despesa_guia_tiss`, `opme_guia_tiss`, `diagnostico_guia_tiss`, `regra_montagem_guia` |
| 30 | Regras de apresentação TISS por fonte pagadora e serviço (o que vai em cada guia, valor padrão de campo) | 2/1 (CONFIG_TISS_CONV_APRS_PCD\*, TISS_CONF_SERVICO_CONV) | TBTISS 76, TBTISSEMIEXP 4 | `GET /tiss/configuracao` (M31) | **F3**: cada operadora da Rede Santé tem a sua | `regra_apresentacao_tiss`, `valor_padrao_campo_tiss` |
| 31 | Lote e remessa TISS: geração do XML com hash, envio por portal ou serviço web, protocolo de recebimento e consulta de situação | 36/5 (TISS_LOTE\*, TISS_LOTE_GUIA\*, TISS_MENSAGEM\*, REMESSA_FATURA\*, FATURA\*, TISS_PROTOCOLO, TISS_RETORNO_PROTOCOLO, TISS_RETORNO_STATUS, PRE_REMESSA_FFCV, ITEM_FATURA) | FCTISSLOTEPROT ≥1k, FCCTAEXT_FCTISSLOTEPROT ≥1k, TBSEGUIA 41, TBTISSWEBSERV 2, TBTISSURLWSSGH 11, TBTISSSCHEMA 25 | LotesTela, LoteTela, ProtocoloTela, WebservicesTela; contas prontas, protocolo e envio (M31). O envio real só acontece com a credencial no cofre e a autorização do dono (D-ENVIO-31) | **F3**: rotina mensal de remessa | `fatura_pagador`, `lote_tiss`, `conta_lote_tiss`, `arquivo_lote_tiss`, `protocolo_recebimento`, `situacao_protocolo`, `endpoint_tiss_pagador` |
| 32 | Fechamento de competência por fonte pagadora e a competência de trabalho do faturista | 4/2 (LOG_COMPETENCIA_FATURAMENTO\*, USU_PERMISSAO_COMPETENCIA\*, CRONOGRAMA_RECEB_CONV_FFCV, CONTAS_FORMACAO_FFCV) | FCFECMES 678 (2022 a 2026), FCPARUSU 403 | CompetenciasTela (TISS), painel da competência e conferência (M31); `reabrirCompetencia` só especificada (P2) | **F3**: fecha o mês de faturamento | `competencia_faturamento`, `fechamento_competencia_pagador`, `competencia_usuario` |
| 33 | Demonstrativo de pagamento e de análise de conta, com conciliação item a item contra o faturado | 17/0 (TISS_RETORNO_DEMON_CONTA, TISS_RETORNO_DEMON_CONTA_PROC, TISS_RETORNO_DEMON_PAG, TISS_RETORNO_DEMON_PAG_DA, TISS_SOL_DEMON, DEMONSTRATIVO_RETORNO_LOTE, RETORNO_FATURA) | Valor pago gravado no item (FCLANEXT); MFCCCONV ≥1k (crédito do convênio); TBTISSTPDEMONS 3, TBTISSCATDESP 5, TBTISSTPDEBCRE 9 | DemonstrativosTela, `dominio-faturamento/tiss/demonstrativo.ts`, conciliação (M31) | **F3**: a baixa do recebível depende dela | `demonstrativo_pagamento`, `item_demonstrativo_pagamento`, `deducao_demonstrativo`, `demonstrativo_analise_conta`, `conciliacao_item` |
| 34 | Glosa e recurso de glosa: motivo, aceite, recurso com justificativa, reapresentação, prazo e desfecho | 31/10 (GLOSAS\*, MOV_GLOSAS\*, ITMOV_GLOSAS\*, MOTIVO_GLOSA\*, MOTIVO_ITEM_GLOSA\*, REMESSA_GLOSA\*, JUSTIFICA_GLOSA\*, TISS_GUIA_JUSTIFICA_GLOSA\*, TISS_RETORNO_RECURSO, TISS_GUIA_REAPRESENTACAO, MOTIVO_RECURSO_GLOSA) | FCLANEXT (valor pago, motivo, recursado e repago no item), TBMOTGLO 677, FCTPMOTGLOSA 20, recurso em FCTISSLOTEPROT | GlosasTela, PainelGlosasTela, PrazosTela; baixa, recurso, desfecho e decisão (M31); `gerarLoteRecurso` só especificado (P2) | **F3**: recuperação de receita | `glosa`, `item_glosa`, `motivo_glosa`, `recurso_glosa`, `item_recurso_glosa`, `desfecho_glosa`, `prazo_recurso_pagador` |
| 35 | Arquivos em leiaute próprio de operadoras e de convênios estaduais (meio magnético anterior ao TISS, Planserv, IPE, IPASGO, intercâmbio PTU, leiautes estrangeiros) | 67/4 (APR_CONTA_MEIO_MAG\*, FFCV_ARQ_MAG_ESPEC\*, TIP_ACO_MEIO_MAG\*, GERA_ARQMAG_PLANSERV, GERA_ARQMAG_IPE, PTU_A450_R459, VAL_PRO_CONVENIO_ESTADO, GUIA_ATENDIMENTO_NORMA24) | Nada (a Rede Santé fatura tudo em TISS) | Nada | **NAO**: feito para um cliente ou anterior ao TISS; se uma operadora exigir leiaute próprio, ele entra como exportador sobre a guia TISS | — |
| 36 | Nota fiscal de serviço da fatura do convênio e do particular | 15/2 (ITFAT_NOTA_FISCAL\*, ITFAT_NOTA_FISCAL_CANC\*, FATURA_FISCAL, ITFATURA_FISCAL, NOTA_FISCAL_FFCV_RPS, FILA_ESPERA_NFE) | FCPARAM (numeração da NFS-e), FCTPPGTONFSE 5; NFSEEMPDESENV 38, NFSEPARUSU 38 e TBSERVICO_NFSE_ITENS 23 no financeiro | NfseTela (financeiro, M32) | **F3**: obrigação fiscal; o dono é o grupo financeiro, aqui fica só o vínculo da fatura com a nota | `nota_fatura` |
| 37 | Integração contábil da receita faturada, glosada e recebida | 7/1 (FFCV_CLASS_CONTABIL, CONFIG_FFCV_CLASS_CONTABIL\*, CONTA_GRU_FAT, CONVENIO_PL_CONTAS, INTEGRA_SAIDA_FATURAMENTO) | TBINTCRC ≥1k, TBTIPOLANCVLR 7 | ExportacaoContabilTela (financeiro), `dominio-contabil` (M32) | **F3**: a contabilidade recebe a receita do faturamento | `regra_contabil_receita`, `lancamento_contabil_receita` |
| 38 | Parâmetros, preferências e alçadas do faturamento | 11/6 (CONFIG_FFCV\*, CONFIG_FATURAMENTO\*, CONFIG_FFAG\*, USUARIOS_FFCV\*, MENSAGEM_CONFIG_FATURAMENTO\*, ALCADA_FFCV) | FCPARAM 1 (numeração, competência, NFS-e), FCPARUSU 403 | Parâmetros (M08), chaves por estabelecimento (POL-3) | **F3**: parâmetros tipados, sem colunas soltas | `parametro_faturamento`, `alcada_faturamento`, `preferencia_faturista` |

### FAT: particular e gestão

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 39 | Caixa do faturamento, caução, adiantamento e conta corrente do paciente particular | 16/3 (CAUCAO\*, MOT_CAUCAO\*, CCOR_FINANCEIRA_CFIG\*, CCOR_FINANCEIRA, CCOR_FINANCEIRA_LCTO, CONTRATO_ADIANTAMENTO, CH_CAUCAO) | Títulos do particular em MFCTAREC ≥1k (financeiro) | CaixaTela, PagamentosTela, caixas, recebimentos e pagamentos (M30); AdiantamentosTela (M32); o provedor de Pix e cartão está pendente (passo M30-16) | **F3**: o particular paga no caixa do hospital | `caixa`, `movimento_caixa`, `recebimento_particular`, `caucao`, `adiantamento_paciente` |
| 40 | Orçamento de particular e modelos de orçamento padrão por procedimento e acomodação | 2/2 (VAL_PROC_ORCAMENTO\*, ITVAL_PROC_ORCAMENTO\*) | FCORCAME 1, FCORCPAD 1, FCORLAME 1 (quase sem uso) | OrcamentosTela, `particular/orcamentos` (M30) | **F3**: já construído e pedido pela recepção | `orcamento_particular`, `item_orcamento_particular`, `modelo_orcamento` |
| 41 | Recibos de pagamento | 4/2 (RECIBO\*, RECIBO_PARAMETRO\*, RECIBO_RESPONSAVEL, LOG_RECIBO) | FCRECIBO ≥1k (2020 a 05/2021, só leitura) | `particular/recibos` (M30) | **F3**: o histórico migra só para leitura | `recibo`, `item_recibo` |
| 42 | Resultado por fonte pagadora (receita contra custo) | 2/0 (CONFIG_RELATORIO_CONVENIO, ITEM_CUSTO_DETALHE) | Nada | Margem por custeio no M54.5 (controladoria) | **F8**: indicador gerencial, sai do custeio | — |

### FAT: repasse médico

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 43 | Regras de repasse por produção: fonte pagadora, procedimento, especialidade, função na equipe, grupo de repasse, vigência e versão | 17/2 (REG_REPASSE\*, ITREG_REPASSE\*, ITREG_REPASSE_VIGENCIA, REG_REP_EQP, REG_REP_GRUPO, GRUPO_REPASSE, PRESTADOR_GRUPO_REPASSE, ACORDO_EQUIPE_MEDICA, REG_REP_SUBCONTRATADA) | TBREPGER ≥1k, TBREPGER_TBCBOPRO ≥1k | RegrasTela, simulação, versões e decisão (M33); `incluirRegra` desligada até a conferência (D-REGRA-33) | **F3**: paga os médicos da Rede Santé | `regra_repasse`, `versao_regra_repasse`, `profissional_regra_repasse`, `grupo_repasse` |
| 44 | Apuração do repasse: itens faturados enviados ao repasse, base de cálculo, lançamentos de evento, estorno em glosa, demonstrativo e extrato do médico | 27/4 (REPASSE, IT_REPASSE, REPASSE_CONTA, REPASSE_CONSOLIDADO, REPASSE_PRESTADOR, GERACAO_REPASSE\*, CTRL_ALTERA_REGRA_REPASSE\*, MULTI_EMPRESAS_REPASSE\*, MOV_HONORARIO_PASSIVO) | FCINTEGRPA ≥1k (10/2023 a 06/2026), RPLANEVE ≥1k, RPLANEVE_COMPOSICAOBASE ≥1k, RPLANEVE_TBCBOPRO ≥1k, RPEVENTO 93, RPINTEVE 76 | ApuracaoTela, LancamentosTela, DemonstrativoTela, MeuExtratoTela (M33); teste dourado em 51,00% contra a meta de 97% (D-DOURADO-33); `integrarItens` só especificada | **F3**: em uso mensal | `apuracao_repasse`, `item_repasse`, `lancamento_repasse`, `base_calculo_repasse`, `evento_repasse`, `estorno_repasse`, `integracao_contabil_evento` |
| 45 | RPA do autônomo com retenção de INSS e IRRF, natureza do rendimento e eSocial | 0/0 (no MV, fica no módulo de pessoal) | RPRPA ≥1k (5,2 mil RPAs), RPLANRPA ≥1k, RPRPA_TBCBOPRO ≥1k, RPEVENTOESOC 36, RPRENDISENTO 11, RPDEDUTIVEL 7, RPPARAM 1, RPEMPCALCIMP 1 | RpaTela, prévia e PDF (M33); `emitirRpa` desligada até o lote do eSocial (M53, D-RPA-33) | **F3**: obrigação fiscal do repasse a pessoa física | `rpa`, `lancamento_rpa`, `retencao_rpa`, `natureza_rendimento`, `deducao_irrf` |
| 46 | Cooperativas médicas, pessoa jurídica do médico e prestadores terceiros (favorecido do repasse, dados bancários, alíquotas) | 0/0 (no MV, dentro das regras: REG_REP_SUBCONTRATADA) | TBCOOPER 242, TBCRECOO 345, TBPRESER 164, FCCRECUN 12, RPTIPOPRESTADOR 6, TBRPATPREPASSE 2 | Favorecido e credor (`beneficiario.ts`, `credor.ts`), terceiros (M13, M33) | **F3**: boa parte do repasse vai para cooperativa | `cooperativa_medica`, `membro_cooperativa`, `prestador_terceiro`, `favorecido_repasse` |
| 47 | Repasse por plantão, por valor fixo e com mínimo garantido | 17/0 (REPASSE_PLANTAO, REPASSE_PLANTAO_VALOR_HORA, REPASSE_VALOR_FIXO, REPASSE_VALOR_MINIMO, ESCALA_REP_PLANTAO, REG_REPASSE_PLANTAO_SETOR, REGISTRO_PLANTOES_FNRM) | Nada | Valor fixo só por item | **F8**: modelo de remuneração comum em PA e UTI; não trava a virada | — |
| 48 | Remuneração variável por produtividade, faixa e resultado | 15/0 (REG_REP_VARIAVEL, EQUIPE_REP_VARIAVEL, FAIXA_REP_VARIAVEL, REG_REPASSE_PROD, REPASSE_PERC_RESULTADO, ITREG_REP_ESCALONAMENTO) | Nada | Nada | **F8**: valor real para a gestão médica | — |
| 49 | Rateio do repasse por setor e custos do prestador (despesas descontadas do médico) | 9/1 (REPASSE_GCTO_CONTRATO\*, REPASSE_CUSTOS, REPASSE_CUSTOS_PREST, REPASSE_PRESTADOR_RATEIO_SETOR, REG_REPASSE_RATEIO) | Impostos na composição da base (RPLANEVE_COMPOSICAOBASE) | Custeio por absorção (M54) | **F8**: refinamento do custeio | — |

### SUS: faturamento SUS

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 50 | Tabela unificada SIGTAP por competência: procedimentos, valores (SH, SP, SADT), grupos, financiamento e compatibilidades com CID, CBO, habilitação, leito, serviço, instrumento e OPM | 84/40 (PROCEDIMENTO_SUS\*, PROCEDIMENTO_SUS_VALOR\*, PROCEDIMENTO_SUS_CID\*, PROCEDIMENTO_SUS_CBO\*, PROCEDIMENTO_SUS_COMPAT\*, PROCEDIMENTO_SUS_HABILITACAO\*, TAB_SIASUS\*, CARGA_SUS_SIGTAP, RUBRICA_SUS\*, INSTRUMENTO_REGISTRO_SUS\*) | Cerca de 60 tabelas de carga: TBPROSUS ≥1k, TBVLRSUS ≥1k, TBSUSCID ≥1k, TBSUSCBO ≥1k, TBPROHAB ≥1k, TBPROREG ≥1k, TBSUSOPM ≥1k, HTPROSUS ≥1k, TBCIDSEC 607, TBHABSUS 260; o histórico anterior a 2008 fica só para leitura | SigtapTela, HistoricoSigtapTela, `sus/sigtap-competencia.ts`, `sus/compatibilidade.ts` (M51.1, M51.2); a cópia da SIGTAP é de 2013 e precisa de carga nova | **F3**: a CIHA exige SIGTAP vigente | `competencia_sigtap`, `procedimento_sigtap`, `valor_procedimento_sigtap`, `grupo_sigtap`, `compatibilidade_sigtap`, `dominio_sigtap`, `atributo_procedimento_sigtap` |
| 51 | Equivalência SIGTAP dos itens da conta e geração da CIHA (comunicação de internação e atendimento custeados fora do SUS) | 13/1 (CRITICA_CIHA\*, GERACAO_CIHA, PRODUCAO_CIHA, PRODUCAO_CONVENIO_CIHA, REGRA_GERACAO_CIHA, CIHA_DE_PARA_CID, CONTROLE_PERIODO_CIHA, LANCAMENTO_MANUAL_CIHA) | FCCTRLANCIHA ≥1k (cerca de 660 mil itens, 2020 a 2026) | CihaTela, `sus/ciha.ts` e leiaute 1.0.4.0 com SHA-256 (M51.1); na coexistência, o legado segue gerando a CIHA | **F3**: obrigatória para todo hospital (Portaria GM/MS 1.171/2011) | `equivalencia_sigtap_item`, `remessa_ciha`, `registro_ciha`, `critica_ciha` |
| 52 | Identificação SUS do paciente (CNS, CPF como identificador principal, CEP e DDD da base do SUS) | 4/1 (AUXILIA_SUS_PACIENTE, CEP_LOGRADOUROS_SUS, LISTA_DDD_SUS\*) | TBSUSCEP ≥1k (cerca de 877 mil, cadastro) | `sus/identificacao-sus.ts`; CNS conferido pelo dígito; consulta ao CADSUS pela RNDS (DP-47.12) | **F3**: a CIHA leva o CNS ou o CPF | `identificacao_sus_paciente` |
| 53 | Competência SUS, crítica prévia, parâmetros do instrumento e permissões por usuário e setor | 15/0 (COMPETENCIA, CAD_EXCECOES_FAT_SIASUS, CONFIG_SIASUS_SSM, SETOR_USUARIO_FATURAMENTO_SUS, REGRA_EXPORTACAO_SUS, MOTIVO_DESCARTE_SUS, DATASUS_BASE) | FAPARAM 1, FAPARAMA 1, FIPARAM 1, FAPARUSU 1, FIPARUSU 2, TBPERMISSAO_SUS ≥1k (permissões, sem produção) | CompetenciasSusTela, `sus/competencia.ts` (M51.1) | **F7**: base do BPA, da APAC e da AIH | `competencia_sus`, `critica_sus`, `parametro_sus`, `permissao_setor_sus` |
| 54 | Programação físico-orçamentária (FPO), tetos financeiros e cotas por município e setor | 9/0 (FPO, IMPORTACAO_FPO, TETO_ORCAMENTARIO_SETOR, PROCEDIMENTO_SUS_TETO_UPS, COTA_COMPETENCIA, COTA_MUNICIPIO, TRANSFERENCIA_COTA) | TBITEPRO 30 e TBFAETAR 19 (legado de antes de 2008) | Metas da contratualização (M55.5); nada de FPO | **F7**: o hospital com contrato SUS fatura dentro do teto | `programacao_orcamentaria_sus`, `teto_financeiro_sus`, `cota_procedimento_sus` |
| 55 | Produção ambulatorial: BPA consolidado e individualizado, com folha, crítica e exportação do arquivo | 20/0 (EVE_SIASUS, FAT_SIA, REMESSA_BPA, FOLHA_BPA, CRITICA_SIA_BPA, LAUDO_BPAI, PRODUCAO_BPA, IMP_BPA_EXTERNO) | Nada de movimento; FAMEDSOL 1 (solicitante) | BpaTela, `sus/bpa.ts` e o leiaute do BPA-Mag, construídos e desligados na chave `faturamento.susBpa` (M51.2) | **F7**: sem contrato SUS não há BPA | `producao_ambulatorial_sus`, `item_producao_ambulatorial`, `remessa_bpa`, `solicitante_sus` |
| 56 | APAC: laudo (oncologia, nefrologia, saúde auditiva, medicamentos), autorização, continuidade, encerramento, crítica e remessa | 57/6 (LAUDO_APAC, LAUDO_SIA_APAC, ITEM_LAUDO_SIA_APAC_NEFROLOGIA, LAUDO_APAC_METASTASE, AUTORIZACAO_APAC, APAC, APAC_SESSAO, REMESSA_APAC, CRITICA_APAC, TIPO_LAUDO_APAC\*, MOTIVO_COBRANCA_SUS\*) | FAHEMOCARTRAT 4, FAHEMOCONTRAN 4, FAHEMOSITTRAN 4, FAHEMOACEVASC 3, TBMOTCOB 39, TBTPAPAC 5, TBLOCPRI 49, TBAPACS ≥1k (compatibilidade); sem movimento | ApacTela, `sus/apac.ts` e o leiaute da APAC-Mag, construídos e desligados na chave `faturamento.susApac` (M51.3) | **F7**: exigida em oncologia e diálise SUS | `laudo_apac`, `laudo_apac_oncologia`, `laudo_apac_nefrologia`, `laudo_apac_auditiva`, `autorizacao_apac`, `apac`, `procedimento_apac`, `remessa_apac` |
| 57 | Laudo de internação SUS e autorização pelo gestor (emissão, impressão, devolução, faixa de numeração) | 22/1 (LAUDO_AIH, LAUDO_AIH_ESPECIAL, ITEM_LAUDO_AIH_ESPECIAL, CONTROLE_AUTORIZACAO_AIH, DEVOLUCAO_AUTORIZACAO_AIH, AUTORIZACAO_GESTOR\*, LAUDOS_SIH, LOTE_LAUDOS_SIH, PRODUCAO_LAUDOS_SUS) | FHJUSTPACDESC 3 (domínio); sem movimento | AihTela: faixa, laudo e autorização (M51.4) | **F7**: porta de entrada da AIH | `laudo_internacao_sus`, `autorizacao_internacao_sus`, `faixa_numeracao_aih` |
| 58 | Conta AIH: procedimentos, equipe, OPM, CID secundário, incrementos, espelho, crítica e arquivo SISAIH01 | 29/0 (VALOR_AIH, VALOR_AIH_EQUIPE, VALOR_AIH_INCREMENTO, CID_CONTA_SUS, CRITICA_AIH, PROTOCOLO_REMESSA_AIH, PRODUCAO_AIH, FFIS_ITENS_ATENDIMENTO, REG_FAT_INCENTIVO_SUS) | FHCLASSIFDIAG 3, TBTIPLEI 38 (domínios); sem movimento | AihTela, `sus/aih.ts`, `sus/sisaih-leiaute.ts`, desligados na chave `faturamento.susAih` (M51.4) | **F7**: faturamento da internação SUS | `conta_aih`, `procedimento_conta_aih`, `profissional_conta_aih`, `opm_conta_aih`, `diagnostico_conta_aih`, `remessa_sisaih` |
| 59 | Diárias de UTI SUS e leitos de UTI habilitados por tipo e competência | 9/2 (CAPACIDADE_UTI_SUS, DIARIA_UTI_SUS, CORTE_DIARIA_UTI_SUS, ESPECIALIDADE_UTI_SUS\*, TIP_ACOM_UTI_SUS\*, REGISTRO_UTI_SUS) | FHLEITOUTI 12, FHLEITOUTITP 19 | LeitosUtiSusTela, diárias de UTI pela trajetória no espelho da AIH (M51.4) | **F7**: a UTI SUS é cobrada por diária habilitada | `leito_uti_habilitado`, `diaria_uti_sus` |
| 60 | Retorno do processamento, glosa e rejeição do gestor SUS, com reapresentação | 6/1 (GLOSAS_SUS, GLOSAS_SIA_SUS, JUSTIFICA_GLOSA_SUS\*, MOTIVO_GLOSA_BPA, LOG_GLOSA_AIH) | Nada | RetornoSusTela, `sus/retorno.ts` (M51.4) | **F7**: fecha o ciclo da produção SUS | `retorno_sus`, `rejeicao_sus`, `reapresentacao_sus` |
| 61 | Habilitações e serviços SUS do estabelecimento e regras por tipo de prestador | 10/4 (HABILITACOES_SUS\*, GRUPO_HABILITACOES_SUS\*, SERVICO_SUS\*, TIPO_PREST_SIA\*, PRO_FAT_HABILITACOES_SUS, MULTI_EMPRESAS_CBO, ESPEC_SERV_PAC_SUS) | TBHABSUS 260, TBGRUHAB 19, TBPRESUS 8, FGTBTPCREDOR 4 (catálogos); o hospital não tem habilitação | CNES em Parâmetros; o validador do M51.2 confere a habilitação | **F7**: a compatibilidade da SIGTAP depende disso | `habilitacao_estabelecimento_sus`, `servico_estabelecimento_sus` |
| 62 | Repasse da produção SUS aos profissionais (ambulatorial e hospitalar) | 9/0 (REG_REPASSE_SIA, REG_REPASSE_SIH, IT_REPASSE_SIA, IT_REPASSE_SIH, RATEIO_SADT_SIH) | Nada | O motor do M33 não lê a produção SUS | **F7**: o hospital SUS que paga médico por produção precisa | `regra_repasse_sus`, `item_repasse_sus` |
| 63 | Contratualização SUS: contrato com o gestor, metas quantitativas e qualitativas, indicadores, aferição e incentivos | 0/0 (não identificado no MV) | CMPERIODO 16, CMTPINDICADOR 8, CMTIPOCOMPLEXIDADESP 7, CMTPITEMINDIC 7, CMREDEASSIST 6, CMESCORE 4, CMTPAFERICAO 4, CMINCENTIVO 1 (só domínios) | ContratualizacaoTela (M55.5) | **F7**: exigida do hospital filantrópico ou contratado | `contrato_gestor_sus`, `meta_contratual_sus`, `indicador_contratual_sus`, `afericao_meta_sus`, `incentivo_contratual_sus` |
| 64 | RAAS: registro das ações de atenção psicossocial e de atenção domiciliar | 2/0 (RAAS, CRITICA_RAAS) | O instrumento RAAS aparece só no domínio TBREGSUS | Nada | **F8**: só para hospital com CAPS ou atenção domiciliar SUS | — |
| 65 | Cadastro de transplante para a central estadual (doador e receptor) | 3/0 (CADASTRO_TRANSPLANTE_CMN, CADASTRO_TRANSPLANTE_RGCT, LOG_ALT_CAD_TRANSPLAN_RGCT) | Nada | Nada | **F8**: só para hospital transplantador | — |

## Recursos novos do MV que valem a pena

São recursos que o SPDATA não tem, ou tem só em parte, com valor para a Rede Santé ou para um hospital
novo. A ordem segue o valor que entregam.

1. **Autorização prévia eletrônica no padrão TISS** (linha 27, F7): o pedido sai do sistema com os itens,
   o CID e o OPME, a resposta volta por item com a glosa prévia, e a consulta do andamento é automática.
   Hoje a Rede Santé digita a senha depois de obtê-la no portal de cada operadora. O ganho vem em tempo de
   recepção e em glosa evitada.
2. **Elegibilidade e comunicação de internação e alta** (linha 26, F7): a carteira é conferida no ato, e o
   aviso de internação sai sem portal.
3. **Descaracterização de pacote com motivo e trilha** (linha 20): quando o caso sai do pacote, por
   intercorrência ou permanência maior, o MV registra o motivo e cobra pelo aberto. Entra no modelo do
   pacote já na F3, com a entidade `descaracterizacao_pacote`.
4. **Fluxo de guias com prazo de atendimento (SLA), responsável por guia e alerta** (linha 24): a fila de
   guias do centro cirúrgico ganha prazo e dono. Ele cabe na F3 como estado e responsável da guia; o
   alerta automático é F8.
5. **OPME na guia com cotação, alçada e limite por procedimento** (linha 25, F7): o valor autorizado fica
   amarrado ao item da guia e à consignação.
6. **Cancelamento de guia e envio de documentos pelo TISS** (linha 28, F7): fecha as transações do padrão
   que a Rede Santé hoje resolve por fora.
7. **Repasse por plantão, valor fixo e mínimo garantido** (linha 47, F8), mais a **remuneração variável
   por produtividade e resultado** (linha 48, F8): são os modelos que o PA e a UTI usam para fixar médico.
8. **Faturamento SUS completo com FPO e repasse da produção SUS** (linhas 54 e 62, F7): o new-sgh já tem
   BPA, APAC e AIH; o MV acrescenta o teto da FPO por competência e o repasse sobre a produção SUS. É isso
   que torna o produto vendável a hospital filantrópico.

Recursos do MV descartados:

- leiautes de operadora anteriores ao TISS ou feitos para um cliente (linha 35);
- cópias "espelho" e "original" de cada tabela de item, que o MV mantém para a auditoria. No modelo
  novo, a versão da auditoria é gravada pelo serviço, ou pelo versionamento de sistema do MariaDB, sem
  tabela duplicada;
- as tabelas de log por tela (LOG_\* de cada cadastro): a trilha é única e transversal;
- os controles de usuário por tela do faturamento (USUARIOS_FFCV, CONTROLE_USUARIO_FFCV): ficam no
  modelo de acesso.

## Lacunas do new-sgh frente ao SPDATA

São itens que o SPDATA tem e usa, mas que o new-sgh ainda não entrega por completo. Todos precisam estar
prontos antes da virada.

1. **Lançamento de itens desligado** (linha 15): `faturamento.lancarItem` está completa, mas a reprodução
   do valor do legado não chega à meta em nenhum grupo: 94,60% em diárias e taxas, 90,64% em honorários,
   89,64% em SADT e 0,75% em mat/med (D-REPRO-MM-30). É a lacuna mais grave, porque toda a conta depende
   dela. A causa do mat/med (referência Brasíndice e Simpro, edição e equivalência por operadora) precisa
   de diagnóstico antes do modelo da linha 6.
2. **Repasse abaixo da meta** (linhas 44 e 45): o teste dourado está em 51,00% contra 97% (D-DOURADO-33).
   `integrarItens` só está especificada, `emitirRpa` espera o lote do eSocial (M53) e `incluirRegra` está
   desligada.
3. **Operações do faturamento só especificadas** (P2): `auditarConta`, `excluirItem`,
   `atualizarBeneficiario`, `emitirConta`, `reabrirCompetencia` e `gerarLoteRecurso`. O SPDATA faz todas
   hoje.
4. **Envio TISS real** (linha 31): o lote é gerado e conferido no XSD, mas o envio à operadora espera a
   credencial no cofre e a autorização do dono (D-ENVIO-31). TBTISSWEBSERV tem só 2 convênios por serviço
   web; os demais vão por portal.
5. **CIHA ainda no legado** (linha 51): na coexistência, o SPDATA continua gerando. A SIGTAP da cópia é de
   2013 e precisa de carga nova antes da primeira CIHA do sistema novo.
6. **Licença das referências de mat/med** (linha 6): Brasíndice, Simpro e CBHPM dependem da DP-36.
7. **Pagamento por Pix e cartão no caixa** (linha 39): o provedor ainda não foi escolhido (passo M30-16).
8. **Regras de conta fora do domínio**: as regras do M30 moram em `@sgh/contratos/regras-faturamento`.
   Para o modelo novo, elas vão para `dominio-faturamento`, e o contrato fica só com os tipos.
9. **Conta nascida por gatilho no SPDATA** (linhas 12 e 16): no legado, a abertura do atendimento cria a
   conta e lança itens por gatilho. O conector diferencial precisa reproduzir esse efeito como evento de
   domínio. Sem isso, a conta de um atendimento aberto no legado durante a coexistência chega vazia ao
   banco novo.
10. **Parâmetros do convênio em colunas** (linhas 1 e 30): as cerca de 385 colunas de TBCONVEN e as
    9 enumerações de parâmetro (TBCONVCOBTXPA, TBCONSIDCALCVLR, TBCONVCONSMAT e outras) ainda são lidas
    como estão. No modelo novo, elas viram regras tipadas por tema (contrato, apresentação TISS,
    consistência de material).

## Entidades próprias propostas (F3 e F7)

São 227 nomes distintos, agrupados por subdomínio. Os nomes são nossos e não seguem o MV nem o SPDATA.

- **Contrato e preço (F3)**: `contrato_pagador`, `contrato_tabela_vigencia`, `regra_percentual_cobranca`,
  `regra_desconto_grupo`, `regra_via_acesso`, `item_isento_cobranca`, `teto_cobranca`,
  `referencia_emissao_matmed`, `diaria_por_plano_local`, `calendario_entrega_fatura`, `item_faturavel`,
  `grupo_faturamento`, `subgrupo_faturamento`, `classificacao_despesa`, `tipo_lancamento`,
  `local_cobranca`, `grupo_ato`, `tabela_preco`, `versao_tabela_preco`, `preco_procedimento`,
  `lote_reajuste`, `importacao_tabela`, `diferenca_importacao`, `preco_diaria_taxa`,
  `diaria_taxa_centro_custo`, `indice_cobranca`, `valor_indice`, `valor_porte_medico`,
  `valor_porte_anestesico`, `edicao_referencia_matmed`, `item_referencia_matmed`,
  `preco_referencia_matmed`, `equivalencia_matmed_pagador`, `equivalencia_matmed_tuss`,
  `terminologia_tiss`, `termo_tiss`, `versao_tiss`, `forma_envio_termo`, `credenciamento_cobranca`,
  `excecao_credenciamento`, `codigo_prestador_pagador`, `usuario_codigo_prestador`,
  `equivalencia_item_pagador`, `atributo_guia_pagador`, `valor_atributo_guia`.
- **Conta do paciente (F3)**: `conta_paciente`, `periodo_conta`, `situacao_conta`, `diagnostico_conta`,
  `dados_segurado_conta`, `etapa_conta`, `motivo_cancelamento_conta`, `transferencia_conta`,
  `transferencia_item_conta`, `item_conta`, `participante_item_conta`, `grau_participacao`,
  `memoria_preco_item`, `regra_lancamento`, `item_regra_lancamento`, `excecao_regra_lancamento`,
  `kit_cobranca`, `item_kit_cobranca`, `origem_lancamento`, `horario_normal_tabela`,
  `acrescimo_horario_especial`, `ajuste_conta`, `motivo_ajuste_conta`, `alcada_ajuste`, `pacote`,
  `versao_pacote`, `item_incluso_pacote`, `excecao_pacote`, `teto_pacote`, `pacote_conta`,
  `descaracterizacao_pacote`, `auditoria_conta`, `versao_auditoria_conta`, `item_auditoria_conta`,
  `empresa_auditoria_externa`, `item_dispensado_auditoria`, `tipo_pendencia_conta`, `pendencia_conta`,
  `protocolo_documento`, `item_protocolo_documento`.
- **Convênios e TISS (F3)**: `guia_pagador`, `item_guia_pagador`, `anexo_guia`, `pendencia_guia`,
  `historico_guia`, `sequencial_guia`, `responsavel_guia`, `guia_tiss`, `procedimento_guia_tiss`,
  `profissional_guia_tiss`, `despesa_guia_tiss`, `opme_guia_tiss`, `diagnostico_guia_tiss`,
  `regra_montagem_guia`, `regra_apresentacao_tiss`, `valor_padrao_campo_tiss`, `fatura_pagador`,
  `lote_tiss`, `conta_lote_tiss`, `arquivo_lote_tiss`, `protocolo_recebimento`, `situacao_protocolo`,
  `endpoint_tiss_pagador`, `competencia_faturamento`, `fechamento_competencia_pagador`,
  `competencia_usuario`, `demonstrativo_pagamento`, `item_demonstrativo_pagamento`,
  `deducao_demonstrativo`, `demonstrativo_analise_conta`, `conciliacao_item`, `glosa`, `item_glosa`,
  `motivo_glosa`, `recurso_glosa`, `item_recurso_glosa`, `desfecho_glosa`, `prazo_recurso_pagador`,
  `nota_fatura`, `regra_contabil_receita`, `lancamento_contabil_receita`, `parametro_faturamento`,
  `alcada_faturamento`, `preferencia_faturista`.
- **TISS completo para hospital novo (F7)**: `solicitacao_opme`, `item_solicitacao_opme`,
  `aprovacao_opme`, `limite_opme_procedimento`, `consulta_elegibilidade`, `comunicacao_beneficiario`,
  `recibo_comunicacao`, `solicitacao_autorizacao`, `item_solicitacao_autorizacao`,
  `resposta_autorizacao`, `item_resposta_autorizacao`, `consulta_situacao_autorizacao`,
  `cancelamento_guia`, `envio_documento_tiss`.
- **Particular (F3)**: `caixa`, `movimento_caixa`, `recebimento_particular`, `caucao`,
  `adiantamento_paciente`, `orcamento_particular`, `item_orcamento_particular`, `modelo_orcamento`,
  `recibo`, `item_recibo`.
- **Repasse médico (F3)**: `regra_repasse`, `versao_regra_repasse`, `profissional_regra_repasse`,
  `grupo_repasse`, `apuracao_repasse`, `item_repasse`, `lancamento_repasse`, `base_calculo_repasse`,
  `evento_repasse`, `estorno_repasse`, `integracao_contabil_evento`, `rpa`, `lancamento_rpa`,
  `retencao_rpa`, `natureza_rendimento`, `deducao_irrf`, `cooperativa_medica`, `membro_cooperativa`,
  `prestador_terceiro`, `favorecido_repasse`.
- **SUS para a Rede Santé (F3)**: `competencia_sigtap`, `procedimento_sigtap`,
  `valor_procedimento_sigtap`, `grupo_sigtap`, `compatibilidade_sigtap`, `dominio_sigtap`,
  `atributo_procedimento_sigtap`, `equivalencia_sigtap_item`, `remessa_ciha`, `registro_ciha`,
  `critica_ciha`, `identificacao_sus_paciente`.
- **SUS para hospital novo (F7)**: `competencia_sus`, `critica_sus`, `parametro_sus`,
  `permissao_setor_sus`, `programacao_orcamentaria_sus`, `teto_financeiro_sus`, `cota_procedimento_sus`,
  `producao_ambulatorial_sus`, `item_producao_ambulatorial`, `remessa_bpa`, `solicitante_sus`,
  `laudo_apac`, `laudo_apac_oncologia`, `laudo_apac_nefrologia`, `laudo_apac_auditiva`,
  `autorizacao_apac`, `apac`, `procedimento_apac`, `remessa_apac`, `laudo_internacao_sus`,
  `autorizacao_internacao_sus`, `faixa_numeracao_aih`, `conta_aih`, `procedimento_conta_aih`,
  `profissional_conta_aih`, `opm_conta_aih`, `diagnostico_conta_aih`, `remessa_sisaih`,
  `leito_uti_habilitado`, `diaria_uti_sus`, `retorno_sus`, `rejeicao_sus`, `reapresentacao_sus`,
  `habilitacao_estabelecimento_sus`, `servico_estabelecimento_sus`, `regra_repasse_sus`,
  `item_repasse_sus`, `contrato_gestor_sus`, `meta_contratual_sus`, `indicador_contratual_sus`,
  `afericao_meta_sus`, `incentivo_contratual_sus`.

Observações de modelagem:

- **Fonte pagadora e plano** vêm da análise 02 (`fonte_pagadora`, `plano_fonte_pagadora`,
  `cobertura_paciente`). Aqui, `contrato_pagador` aponta para eles, e nenhum cadastro é duplicado.
- **O item da conta é imutável depois do fechamento.** Correção depois do fechamento entra como
  `ajuste_conta` ou como `estorno`, com a memória de preço original preservada em `memoria_preco_item`.
- **Uma tabela de domínio com tipo, em vez de dezenas de tabelas pequenas**, para as terminologias TISS
  (`termo_tiss`) e os domínios SIGTAP (`dominio_sigtap`). Cada termo tem código, descrição, vigência e
  versão de origem. Isso cobre cerca de 45 tabelas de carga do SPDATA e cerca de 30 do MV.
- **O XML gerado é guardado como artefato**, no armazenamento de objetos, com SHA-256 em
  `arquivo_lote_tiss`, `remessa_ciha`, `remessa_bpa`, `remessa_apac` e `remessa_sisaih`. O banco guarda
  o hash, o caminho e a situação; o conteúdo do arquivo não fica em coluna.
- **Repasse ligado ao item da conta** (`item_repasse` → `item_conta`): a glosa do item gera
  `estorno_repasse` no serviço de domínio, sem gatilho.
- **Na migração**, a carga do dia 0 traz o contrato, o preço, o catálogo e as contas abertas. O histórico
  de contas fechadas (cerca de 214 mil desde 2020), os lotes, as glosas e os RPAs vêm como movimento. Os
  recibos de 2020 a 2021 e as tabelas SUS anteriores a 2008 vêm só para leitura.
