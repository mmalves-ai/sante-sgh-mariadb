# Análise cruzada 07: financeiro, fiscal, contábil, custos, controladoria e gestão de pessoas

Grupo: **FIN** (financeiro, fiscal, contábil, custos, controladoria, patrimônio e repasse médico) e **RH** (gestão de
pessoas, folha, eSocial e SESMT).
Data: 2026-11-20. Fontes, todas só leitura:
- `referencias/mv-tabelas.tsv` e, para tirar dúvidas, só os metadados de colunas do Oracle de referência;
- a matriz de 1.503 tabelas do SPDATA (`new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`);
- `new-sgh/planejamento/ESTADO.md` e a árvore de menus (`planejamento/fonte-pdf/arvore-menus.txt`);
- o código do new-sgh: `packages/dominio-financeiro`, `dominio-contabil`, `dominio-custos`, `dominio-patrimonio`,
  `dominio-repasse` e `dominio-pessoas`, além de `apps/api/src/modulos` e `apps/web/src/modulos`.

Como ler:
- **MV (evidência):** tabelas do MV com "N tab / M com dados". Quando não há prefixo, vale o esquema principal. "ctl:"
  marca o esquema da controladoria, que duplica orçamento, contratos e alçadas. "int:" marca o esquema de integração e
  "por:" o do portal. Os nomes do MV só aparecem nesta coluna, como evidência.
- **SPDATA (evidência, uso):** tabelas da matriz com o volume de linhas. "1.000+" quer dizer que a contagem da matriz
  parou em 1.001. Também aqui os nomes só aparecem como evidência.
- **new-sgh (estado):** marco, tela ou rota e situação no ESTADO.md. Quase tudo está "aguardando validação", com a
  gravação desligada até a conferência dos usuários-chave (POL-3). No banco próprio, essas gravações passam a ser
  nativas.
- **Entidades próprias:** nomes nossos, em `snake_case`, só para F3 e F7. Nenhuma tabela do MV nem do SPDATA vira nome
  nosso.

## Resumo numérico

| Item | Valor |
|---|---|
| Tabelas do MV analisadas no grupo | **993** (114 com dados): 835 do esquema principal, 142 da controladoria (orçamento 73, contratos 56, alçadas 13), 11 de integração e 5 do portal |
| Tabelas do MV examinadas e excluídas por não serem do grupo | 14: 8 de técnicos da manutenção com valor-hora (o "funcionário" do MV nesta base) e 6 de benefícios concedidos a pacientes (serviço social) |
| Tabelas do SPDATA no grupo | 110 do módulo FIN, 231 do módulo RH, 24 do repasse médico (módulo de faturamento) e 5 do patrimônio (módulo de suprimentos) = **370** |
| Funcionalidades | **69** |
| Decisão F3 (paridade) | **20** |
| Decisão F7 (hospital do zero) | **26** |
| Decisão F8 (recurso novo) | **16** |
| Decisão NAO | **7** |
| Entidades próprias propostas (F3 + F7) | **228** (distintas, sem repetição entre linhas) |

Nota 1, sobre a contagem: o MV guarda orçamento, contratos e alçadas em dois esquemas, quase sempre com o mesmo nome.
A contagem soma os dois, porque são tabelas distintas no catálogo. Sem a duplicação, o grupo cai para cerca de 850
tabelas.

Nota 2, sobre o RH: nesta base, o MV não tem gestão de pessoas. A folha, o ponto e o eSocial do fornecedor são um
produto à parte, que não veio no catálogo. O que leva o nome de funcionário é o cadastro dos técnicos da manutenção,
com valor-hora e oficina (visto pelos metadados das colunas). Por isso, as linhas de RH têm o MV vazio ou quase
vazio, e a referência de recurso novo nesse grupo vem da lei e do próprio new-sgh, não do MV.

Nota 3, sobre o uso real: o SPDATA da Rede Santé usa de verdade contas a pagar e a receber, tesouraria, adiantamentos,
borderôs, apropriação gerencial, escrituração das entradas, retenções e repasse médico, todos com 1.000+ linhas. A
contabilidade, os custos, o patrimônio, a folha e o RH do SPDATA têm só domínios e parâmetros, sem movimento. A folha
nunca foi calculada (DP-10 do new-sgh), e a contabilidade é feita fora, pelo escritório, a partir de um arquivo
exportado.

Nota 4, sobre sobreposição: algumas tabelas de log, de configuração e de multiempresa do financeiro também entram no
recorte técnico da análise 01. Aqui, elas foram contadas pelo assunto. A gestão de contratos com fornecedores pode
aparecer também na análise de suprimentos.

## Matriz de cobertura

### Contas a pagar e pagamentos

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Títulos a pagar: parcelas, baixa, descontos e acréscimos, prorrogação e devolução ao fornecedor | 11 tab / 4 com dados: `CON_PAG`, `ITCON_PAG`, `PAGCON_PAG`, `PAG_DESC_ACRES`, `CON_PAG_DOCUMENTO`, `DEV_FOR_ITCON_PAG`, `MOTIVO_PRORROGACAO`, `PARCELA_COND_PAGAMENTO` | `MFCONPAG` 1.000+ (cerca de 71 mil títulos, 2019 a 2026), `MFDESACR` 1.000+, `MFCONPAG_TBCBOPRO` 1.000+, `MFCABECLANC` 1.000+, `MFTIPOLANC` 40; uso alto | M32 construído: `@sgh/dominio-financeiro`, `/financeiro/pagar/titulos`; receitas `criarTituloPagar` e `baixarTitulo` verdes; aguardando validação | **F3**: núcleo do financeiro em uso diário | `titulo_pagar`, `parcela_pagar`, `baixa_titulo`, `ajuste_titulo`, `tipo_credor`, `documento_origem_titulo`, `motivo_prorrogacao` |
| Aprovação de pagamentos por alçada (valor-limite por usuário e bloqueio) | 4 tab / 0: `ALCADA_GESTAO`, `ALCADA_USUARIO`, `ALCADA_TRANSF`, `BLOQUEIO_ALCADA_FINAN` | Não tem (a árvore marca como novo na F3); indicador do new-sgh mostra títulos pagos sem aprovação | M32: `/financeiro/pagar/aprovacao`, aprovação gravada à parte do título | **F3**: o new-sgh já prende o pagamento à aprovação; virar sem ela seria regredir o controle interno | `alcada_financeira`, `limite_alcada_usuario`, `pedido_aprovacao`, `decisao_aprovacao` |
| Fluxo de aprovação configurável por pontos, agrupadores e respostas, com aprovação pelo celular | 27 tab / 2: 14 `ALCA_*` no principal, 13 `ctl:ALCA_*` (`ALCA_PONTO`, `ALCA_DEMANDA`, `ALCA_APROVADOR_MOB`, `ALCA_PONTO_RESP`) | Não tem | Não tem (a aprovação do M32 é de um nível) | **F8**: valor real para compras e contratos, mas pode esperar | — |
| Borderô e pagamento eletrônico (remessa e retorno bancário, dados bancários e chave Pix do credor) | 9 tab / 5: `BORDERO`, `LOTE_PGTO_ITCON_PAG`, `LOTE_REM_ITCON_PAG`, `RETORNO_PAGCON_PAG`, `FORN_CONTA_CORRENTE`, `FORN_CC_CHAVE_PIX`, `CAMARA_FINA` | `MFBORDER` 1.000+, `TBTPOCORBANCOPGTO` 113, `TBTIPOPAGFOR` 21, `MFTPPGTOBANCO` 6, `MFTIPODOC` 6, `MFTIPOTED` 5; uso alto | M32: `/financeiro/pagar/borderos` e `/remessas`; remessa de 240 posições contra o simulador, sem envio ao banco | **F3**: em uso | `bordero_pagamento`, `item_bordero`, `remessa_bancaria`, `retorno_bancario`, `ocorrencia_bancaria`, `conta_bancaria_credor`, `forma_pagamento_credor` |
| Adiantamento a fornecedor e a médico, com compensação na baixa (e prestação de contas com anexos, no MV) | 12 tab / 1: `CCOR_FINANCEIRA` e 10 derivadas (`_LCTO`, `_PARC`, `_PRST`, `_RATE`, `_ARQU`), `FORMA_PAGTO_ADIANT` | `MFADIFOR` 1.000+, `MFPAGADF` 1.000+, `MFADIFOR_TBCBOPRO` 395; uso alto | M32: `/financeiro/pagar/adiantamentos` | **F3**: em uso. A prestação de contas com anexos fica para a F8 | `adiantamento`, `compensacao_adiantamento`, `beneficiario_adiantamento` |
| Previsão e provisão de pagamentos (despesa prevista, honorário provisionado como passivo) | 5 tab / 1: `PREVISAO`, `PREVISAO_MVTO`, `PROVISAO_DESC_ACRES`, `CONCILIACAO_CON_PAG_PREV_PROV`, `MOV_HONORARIO_PASSIVO` | Não tem | Parcial: o fluxo projetado usa os títulos em aberto; não há previsão avulsa | **F8** | — |
| Encontro de contas entre o que se paga e o que se recebe do mesmo parceiro | 2 tab / 0: `ENCONTRO_CONTAS_FNFI`, `NOTA_CREDITO_DEBITO_FNFI` | Não tem | Não tem | **F8** | — |
| Nota de crédito e de débito com tributos (fornecedor e cliente) | 6 tab / 0: `NOTA_CREDITO`, `NOTA_CREDITO_DEBITO`, `NOTA_CREDITO_DEBITO_TRIBUTO`, `NOTA_CRE_DEB_SUPRI`, `MOTIVO_LANC_NT_CRE_DEB_SUPRI` | Não tem | Não tem | **F8** | — |

### Contas a receber e cobrança

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Títulos a receber de convênio e de particular, com baixa por demonstrativo, glosa no item e renegociação | 14 tab / 5: `CON_REC`, `ITCON_REC`, `RECCON_REC`, `IT_RECEBIMENTO` (valor recebido, glosa e recurso por item), `CONREC_DESC_ACRES`, `DUPLICATA`, `LEGENDA_CURVA_ABCD`, `LOTE_IMPORTACAO_CON_REC` | `MFCTAREC` 1.000+ (cerca de 25 mil títulos), `MFCABECRENEGO` 2, `TBCLIENT` 1; uso alto | M32: `/financeiro/receber/titulos`, `/demonstrativos`, `/renegociacoes`; `criarTituloReceber` verde | **F3**: em uso | `titulo_receber`, `parcela_receber`, `recebimento`, `recebimento_item_conta`, `renegociacao`, `titulo_renegociado`, `cliente_financeiro` |
| Conta corrente do convênio (créditos recebidos antes de identificar a fatura) | Coberto pelos títulos a receber e pela tesouraria | `MFCCCONV` 1.000+; uso alto | M32: `/financeiro/receber/convenios` | **F3**: em uso | `credito_convenio`, `aplicacao_credito_convenio` |
| Cobrança bancária com boleto (carteira, remessa, retorno, ocorrências, tarifas e mensagens) | 16 tab / 0: `TITULO_BANCARIO`, `LOTE_REC_COBRANCA`, `LOTE_REM_ITCON_REC`, `RETORNO_COBRANCA`, `OCORRENCIA_RETORNO_COBRANCA`, `SEGMENTO_RETORNO_COBRANCA`, `TARIFA_BANCARIA_RET`, `CONVENIO_BANCARIO`, `CONCOR_MSG_BOLETO` | `TBBANCOS` 49 (carteiras com leiautes de cobrança e boleto), `MFTPCOBRANCA` 4; só cadastro, uso do boleto não comprovado | Só o cadastro de bancos e carteiras; não emite boleto nem lê retorno de cobrança | **F7**: um hospital novo cobra empresas, particulares parcelados e coparticipação por boleto | `carteira_cobranca`, `boleto`, `remessa_cobranca`, `retorno_cobranca`, `tarifa_bancaria` |
| Portador do título (carteira simples, desconto e cessão de recebíveis) | 4 tab / 0: `FINA_PORTADOR`, `FINA_CONTA`, `FINA_CONTA_APLICAR`, `FINA_CONTA_CONDICAO` | Não tem | Não tem | **F8**: antecipação de recebível de convênio tem valor, mas não é paridade | — |

### Tesouraria, caixa e meios de pagamento

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Contas bancárias, movimento bancário, transferências, saldos diários e fechamento do período financeiro | 16 tab / 9: `CON_COR`, `LAN_CONCOR`, `MOV_CONCOR`, `EMPRESA_LAN_CONCOR`, `SALDO_DIA_DETALHE`, `SALDO_FINANCEIRO`, `MES_ANO_FECH_FINANC`, `ANO_FECH_FINANC`, `BANCO`, `CONFIG_FINANC` | `MFLANCTO` 1.000+, `MFSALDOS` 588, `MFSALATU` 392, `TBCTABAN` 489, `TBTABBCO` 497, `TBAGEBAN` 143, `TBTPCONTA` 3; uso alto | M32: `/financeiro/tesouraria/movimento`; `lancarMovimento` verde | **F3**: em uso | `banco`, `agencia_bancaria`, `conta_bancaria`, `movimento_bancario`, `transferencia_bancaria`, `saldo_diario_conta`, `periodo_financeiro` |
| Conciliação bancária pelo extrato importado (sugestão por regra, confirmação humana, crédito não identificado) | 1 tab / 0: `LCTO_EXTRATO_IMPORTADO` | Não tem (a árvore marca como novo na F3) | M32: `/financeiro/tesouraria/conciliacao`, leitura de extrato OFX e CSV, sugestão por regra | **F3**: já construído e planejado para a virada | `extrato_bancario`, `linha_extrato`, `conciliacao_bancaria`, `credito_nao_identificado` |
| Fluxo de caixa realizado e projetado (no MV, também com simulação de cenários) | 6 tab / 2: `SIMULACAO_FC`, `CENARIO_FINANC_VALOR`, `FINANC_CONTROLE_SALDO`, `FINAN_VARIAVEL`, `por:FLUXO_CAIXA`, `por:FLUXO_CAIXA_CONTAS` | Não tem (a árvore marca como novo na F3) | M32: `/financeiro/tesouraria/fluxo-caixa`, projetado com glosa e atraso médio do convênio; sem cenários | **F3**: já construído. Os cenários ficam para a F8 | `premissa_recebimento_convenio` (o resto é calculado sobre títulos, movimentos e saldos) |
| Caixa do balcão: abertura e fechamento por operador, recebimento do particular, troca de espécie e recibo | 16 tab / 9: `CAIXA`, `LOTE_CAIXA`, `ABRE_CAIXA`, `MOV_CAIXA`, `DOC_CAIXA`, `USUARIO_CAIXA`, `EXTRA_CAIXA`, `IMPORTA_MOV_CAIXA`, `RECIBO`, `RECIBO_PARAMETRO` | `FCRECIBO` 1.000+ (2020 a 05/2021, só leitura), `TBCADPAG` 22, `TBORIGEMRECEBIMENTO` 4; uso histórico | M30/M42: caixa e pagamentos do particular no faturamento (telas de caixa e de pagamentos), recibo | **F3**: o particular é recebido no balcão | `sessao_caixa`, `recebimento_balcao`, `forma_recebimento`, `recibo`, `sangria_caixa` |
| Cartão de débito e crédito: bandeira, parcelas, taxa da administradora e conciliação dos recebíveis | 10 tab / 4: `TEF_PARCEIRO`, `TEF_PARCEIRO_PARC`, `TEF_MOVIMENTO`, `TEF_MOVIMENTO_PARC`, `TEF_TIPOMVTO`, `FIN_CAR`, `FINCAR_PL_CONTAS`, `FINA_ADMINISTRADORA` | `TBOBSREC` 5 (bandeiras), `TBTIPOCARTAO` 2, `TBTIPOTAXACARTAO` 2; cadastro em uso | Conector de cartão simulado fora de produção; sem a agenda de recebíveis da administradora | **F3**: bandeira, parcela e taxa já existem no SPDATA. A conciliação com a adquirente fica para a F8 | `bandeira_cartao`, `administradora_cartao`, `taxa_administradora`, `transacao_cartao`, `parcela_recebivel_cartao` |
| Pix com cobrança, retorno e baixa automática | 9 tab / 0: `PIX_MOVIMENTO_ENVIO`, `PIX_MOVIMENTO_RETORNO`, `PIX_MOVIMENTO_FINAN`, `PIX_MOVIMENTO_ERRO`, `CON_COR_CHAVE_PIX` | Não tem | Conector de Pix simulado fora de produção | **F7**: um hospital novo espera Pix com baixa automática | `chave_pix_conta`, `cobranca_pix`, `retorno_pix` |
| Cheques (talão, emissão, devolução) | 6 tab / 0: `CHEQUE`, `CHEQUE_STATUS`, `CHE_DEVOL`, `TALAO`, `IMP_CHEQUE`, `MOT_DEV_CHEQUES` | `TBAGEBAN` guarda só o modelo do cheque | Não tem | **NAO**: meio em desuso; fica como forma de recebimento genérica, se aparecer | — |
| Caução e adiantamento do paciente particular, com contrato por procedimento | 4 tab / 1: `CAUCAO`, `CONTRATO_ADIANTAMENTO`, `CONTRATO_ADIANT_PARAMETRO`, `CONTRATO_ADIANT_PRO_FAT` | Não tem | Não localizado como recurso próprio | **F7**: comum no particular eletivo. Proibido como condição de atendimento de urgência (Lei 12.653/2012): a regra entra no domínio | `adiantamento_paciente`, `contrato_adiantamento_paciente`, `aplicacao_adiantamento_paciente` |

### Gerencial, permissões e integração

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Plano gerencial de receitas e despesas (grupo, subgrupo, item) e rateio do lançamento por centro de custo | 12 tab / 4: `CLASSIFICACAO_CONTA_FNFI`, `CONTA_FINANC`, `REGRA_RATEIO_FNFI`, `RATCON_PAG`, `RAT_PAGCON_PAG`, `RAT_CONREC`, `RAT_RECCON_REC`, `RATPAG_DESC_ACRES` | `MFLANGSI` 1.000+, `TBITEDES` 533, `TBGRUDES` 40; uso alto | M32: `/financeiro/gerencial`; editar a classificação e o rateio depois do lançamento ainda não tem rota (D-CLASSIF-32, parcial) | **F3**: em uso | `grupo_natureza_financeira`, `natureza_financeira`, `rateio_lancamento`, `regra_rateio_financeiro` |
| Permissões do financeiro por conta bancária, empresa e tipo de lançamento; empresa e competência de trabalho por usuário | 4 tab / 2: `FINA_PERMISSAO`, `FINAN_PERMISSAO`, `FUNCIONALIDADE_FNFI_USU` | `MFCTAUSU` 1.000+, `MFTIPOLANC_TBOPCOES` 1.000+, `MFPARUSU` 59, `MFPARAM` 2, `MFPARAM_MFTIPOLANC` 19; uso alto | M32: escopo por conta conferido na API, `/financeiro/parametros` | **F3**: em uso | `permissao_conta_bancaria`, `permissao_tipo_lancamento`, `parametro_financeiro`, `contexto_trabalho_usuario` |
| Exportação dos lançamentos ao escritório contábil, com de-para por evento e lote conferível | 21 tab / 0: `DE_PARA_CONTABIL`, `DE_PARA_CENTRO_CUSTO`, `DE_PARA_FORNECEDOR`, `IMP_CONTABIL`, `FINAN_EXTERNO`, `int:INTEGRA_SAIDA_CONTABIL`, `int:INTEGRA_SAIDA_MOV_FINANC` | `TBINTCRC` 1.000+, `TBINTIMP` 2, `RPINTEVE` 76, `TBTIPOLANCVLR` 7; uso alto | M32: `/financeiro/contabil/exportacao` (lote com contagem e soma, lista "sem de-para") | **F3**: é como a contabilidade da Rede funciona hoje | `depara_conta_externa`, `lote_exportacao_contabil`, `item_lote_exportacao` |
| Multimoeda, variação cambial e plano de contas internacional | 6 tab / 2: `MOEDA`, `MOEDA_MULTI_EMPRESA`, `INDICE_MOEDA`, `VARIACAO_CAMBIAL_INTER`, `PLANO_CONTAS_INTER` | Não tem | Não tem | **NAO**: fora do mercado-alvo | — |
| Técnico do fornecedor: logs, tempos de espera, controle de processamento | 33 tab / 6: `LOG_FNFI`, `FNFI_LOG`, `FINAN_CONTROLE`, `FNFI_TIMEOUT_BANCO`, `LOG_CONTABIL`, `LOG_REPASSE`, `LOG_GERAL_FCCT` | Não há equivalente no grupo | A trilha de auditoria é transversal (análise 01) | **NAO**: técnico do fornecedor | — |

### Fiscal e tributário

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Escrituração fiscal das entradas e EFD-Contribuições (CFOP, CST do PIS e da COFINS, natureza do crédito, dados fiscais do item) | 22 tab / 4: `CFOP`, `CST_DI`, `CSOSN`, `TIP_DETALHE_CST`, `EMPRESA_SPED_PIS_COFINS`, `SPED_FISCAL`, `ALIQUOTA_ICMS`, `INCIDENCIA_IPI`, `TIPO_ENTRADA_CFOP` | `SDGECADNFS` 1.000+, `SDGELANNFS` 1.000+, `SDMFCONPAG` 1.000+, `SDGEITENS` 1.000+, `SDCFOP` 553, `SDGENERO` 100, `SDCSTPIS` 33, `SDCSTCOFINS` 33, `SDNATCREDITO` 18, `SDPARAM` 1; uso alto | M32: `/financeiro/fiscal/entradas`; tabelas oficiais por importador | **F3**: em uso. O ICMS e o IPI ficam fora, salvo um cliente contribuinte | `escrituracao_entrada`, `escrituracao_item_entrada`, `dado_fiscal_item`, `tabela_fiscal_oficial`, `codigo_fiscal_oficial` |
| Retenções na fonte (IR, contribuição previdenciária, ISS, PIS, COFINS e CSLL) no pagamento, no serviço tomado e no recebimento | 14 tab / 3: `RETENCAO_TRIBUTO`, `ITRETENCAO_TRIBUTO`, `IMPOSTO_FORNECEDOR`, `INSS_ESPECIAL`, `PROVISAO_IMPOSTO_RETIDO`, `NAT_TIPDET_CON_PAG`, `TIP_DET_RECCON_REC`, `SERVICO_NTFS`, `TRIBUTO_MUNICIPAL` | `MFDESACR` 1.000+ (retenções no título), `MFREFDES` 24, `TBINTIMP` 2, `TBMUIBGE` 1.000+ (regras de ISS do município), `TBORGAOPUBLICO` 3, `MFTPCONTRIBUICAO` 4, `MFTPAPURACAO` 2; uso alto | M32: retenções no título e no repasse, entram na DMED e na REINF | **F3**: em uso | `tributo`, `aliquota_tributo_vigencia`, `regra_retencao`, `retencao_titulo`, `regra_iss_municipio`, `orgao_arrecadador` |
| Apuração dos tributos retidos e guia de recolhimento (DARF), com envio da DCTFWeb | 4 tab / 0: `FINAN_LOTE_TRIBUTO`, `FINAN_LOTE_TRIBUTO_IT`, `FINAN_VERSAO_TRIBUTO`, `ARQUIVO_REMESSA_TRIBUTO` (com `FINAN_LOTE_IMPOSTO` na linha anterior) | `TBFINCODRECOL` 1.000+ e `RPCODIGO_RECEITA` 1.000+ (códigos de receita); a geração da guia não aparece na matriz | Não localizado: o retido não vira título do recolhimento com o código de receita | **F7**: obrigação de qualquer hospital | `codigo_receita_federal`, `apuracao_retencao`, `guia_recolhimento` |
| EFD-REINF (séries R-2000 e R-4000), com processos, beneficiários e retorno | 30 tab / 2: `REINF`, `REINF_EVENTOS`, `REINF_BEN_PAG`, `REINF_SERVICO_TOMADO`, `REINF_PROCESSO_JUDICIAL`, `REINF_TABELA_01`, `REINF_TRANS_RETORNO`, `REINF_XML`, `CNO_FORNECEDOR` | `FPITENSNATRENDIMENTO` 246, `FPITENSNATREND_DEDUTIVEL` 186, `ESSERIE_R4000_TAGS` 170, `FPITENSNATREND_RENDISENTO` 64, `ESSERIE_R4000_GRUPOS` 44, `FPCLASSIFSERV` 31; tabelas em uso | M32: `/financeiro/fiscal/reinf`; R-2010 e R-4020 gerados, sem envio (DP-38) | **F3**: obrigação vigente da Rede | `natureza_rendimento`, `evento_reinf`, `lote_reinf`, `retorno_reinf`, `processo_tributario` |
| DMED (recebimentos de pessoa física por titular) | Não identificado nesta base | `DMCADLEIAUTE` 5 | M32: `/financeiro/fiscal/dmed`, arquivo gerado sem envio | **F3**: obrigação anual do prestador de saúde | `declaracao_dmed`, `item_dmed` |
| NFS-e dos serviços hospitalares: emissão, lote, cancelamento, substituição, deduções e IBS/CBS da reforma | 58 tab / 9: `NOTA_FISCAL`, `ITNOTA_FISCAL`, `ITFAT_NOTA_FISCAL`, `NOTA_FISCAL_TRIBUTO`, `CONFIG_NOTA_FISCAL_POR_TIPO`, `HISTORICO_SITUACAO_NOTA_FISCAL`, `DEDUCAO_NOTA_FISCAL`, 22 `NOTA_FISCAL_ELETRONICA_*` de um município, `NFSE_CONTROLE_CIDADE`, `int:IMV_NOTA_FISCAL_ELETRONICA` | `NFSEEMPDESENV` 38, `NFSEPARUSU` 38, `TBSERVICO_NFSE_ITENS` 23, `NFSECLASSIFICACAO_TRIBUTARIA` 13, `TBTRIBUTACAO_ISSQN` 4, `TBIMUNIDADE_ISSQN` 6, `FCTPPGTONFSE` 5; em uso | M32: `/financeiro/fiscal/nfse`, ISS e IBS/CBS destacados, simulador da prefeitura; emissão real depende da DP-38 | **F3**: o hospital emite nota por fatura | `nota_servico`, `item_nota_servico`, `tributo_nota_servico`, `lote_nota_servico`, `evento_nota_servico`, `provedor_nota_municipal`, `servico_municipal` |
| NF-e de mercadoria: simples remessa, devolução e venda a terceiro | 4 tab / 2: `PARAMETROS_NF_SIMPLES_REMESSA`, `FORMULARIO_NF_SIMPLES_REMESSA`, `MOTIVO_CANCELA_NFSR`, `NUMERACAO_NOTA` | `TBNATOPE` 29, `TBTPNATOPENF` 3, `GEINFVENEXT` 206 (saída a terceiro); emissão pelo SPDATA a confirmar | Cadastro de naturezas de operação e saída a terceiro no estoque; não emite NF-e | **F7**: devolução de consignado e envio para conserto exigem nota | `natureza_operacao`, `nota_mercadoria`, `item_nota_mercadoria`, `evento_nota_mercadoria` |
| LALUR e e-LALUR (partes A e B, provisão de IRPJ e CSLL) para o lucro real | 11 tab / 0: `DIGITACAO_PARTE_A_LALUR`, `DIGITACAO_PARTE_B_LALUR`, `CONFIGURACAO_PROVISAO_LALUR`, `ELALUR_PARTEA_SPED_ECF`, `VALORES_ELALUR_SPED_ECF` | Não tem (a Rede é imune ou isenta) | M54.3: ECF só das imunes e isentas | **F7**: um hospital com fins lucrativos no lucro real precisa | `ajuste_lalur`, `saldo_lalur_parte_b`, `apuracao_irpj_csll` |
| Declaração de importação (rateio de custos e duplicata em moeda) | 6 tab / 0: `DECLARACAO_IMPORTACAO`, `ITDECLARACAO_IMPORTACAO`, `RATEIO_DECLARACAO_IMPORTACAO`, `DUPLICATA_DI` | Não tem | Não tem | **NAO**: o hospital compra importado pelo distribuidor | — |

### Contabilidade e controladoria

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Plano de contas versionado e plano referencial da Receita | 10 tab / 3: `PLANO_CONTAS`, `PLANO_CONTABIL`, `PLANO_CONTAS_DE_PARA`, `PLANO_CONTAS_WIZARD`, `CONFIG_FCCT` | `COTIPOPLANOCONTAREFERENCIAL` 14, `COTIPOITEM` 13, `COPARAM` 10; só domínios (o plano real fica no escritório) | M54.1: `/contabil/plano` | **F7**: a Rede vira com o contador externo; um hospital novo pede contabilidade própria | `plano_contas`, `conta_contabil`, `conta_referencial`, `vinculo_conta_referencial` |
| Lançamentos contábeis (automáticos, manuais e estornos), razão, saldos mensais, conciliação de contas e encerramento do período | 20 tab / 1: `LCTO_CONTABIL`, `LCTO_SETOR`, `SALDO_CONTABIL`, `SALDO_MENSAL`, `SALDO_MENSAL_SETOR`, `MOTIVO_LCTO`, `MVTO_AJUSTE_CONTABIL`, `FECHAMENTO_DO_MES` | `COTP_ORIGEM_LANCAMENTO` 11, `COPERIODESCRIT` 4, `COTIPOSOLICITACAOSENHA` 4; só domínios | M54.2: `/contabil/lancamentos` com 5 abas; chave desligada até o contador conferir uma competência | **F7** | `lote_contabil`, `lancamento_contabil`, `partida_contabil`, `saldo_contabil_mensal`, `periodo_contabil`, `conciliacao_conta_contabil`, `historico_padrao` |
| Regras de contabilização automática dos módulos (faturamento, financeiro, estoque, patrimônio, folha, repasse) | 24 tab / 4: `MODELO_CONTABIL`, `MODELO_CONTABIL_EVENTO`, `MODELO_CONTABIL_MATRICIAL`, `CONFIG_LCTO_AUT`, `FFCV_CLASS_CONTABIL`, `LCTO_FINANCEIRO`, `LANCAMENTO_PATRIMONIO_CTB`, `PL_INT_FOLHA`, `DEDUCAO_RECEITA` | `TBINTCRC` 1.000+, `RPINTEVE` 76, `FPINTROTINA` 19 (hoje alimentam a exportação) | M54.1: regras versionadas com simulação, leitura incremental dos fatos dos módulos, reprocessamento idêntico | **F7**: a exportação (F3) cobre a virada | `regra_contabilizacao`, `versao_regra_contabilizacao`, `fato_contabil`, `leitura_fato_contabil` |
| Demonstrações: balancete, diário, DRE e balanço, com apuração do resultado | 12 tab / 0: `DADOS_BALANCETE`, `DADOS_BALANCETE_SETOR`, `DRE`, `DRE_COLUNA`, `DRE_SOMA`, `VISAO_CONTABIL` | Não tem | M54.3: `/contabil/demonstracoes`, PDF/A e planilha; DRE gerencial em duas réguas no M32 | **F7** | `modelo_demonstracao`, `linha_modelo_demonstracao`, `apuracao_resultado` |
| SPED contábil (ECD) e ECF, com termos, signatários e situação especial | 13 tab / 4: `PLANO_CONTAS_SPED`, `PLANO_CONTAS_REF_SPED`, `AUDITORES_INDEPENDENTES_SPED`, `SPED_ECF_IRPJ_CSLL`, `SPED_ECF_IDENT_SOCIOS_TITULAR`, `TABELA_REGISTRO_U180` | `CONIRE` 27, `COSPEDHSTSEMP` 8, `COSPEDSITEMP` 7, `COSPEDTPDOC` 8, `COINDICNATPJ` 7, `COTPSUBSTECD` 6 | M54.3: ECD e ECF das imunes e isentas construídos e desligados | **F7**: obrigação de quem faz a contabilidade | `arquivo_sped_contabil`, `signatario_escrituracao`, `registro_empresa_junta`, `situacao_especial_empresa` |
| Consolidação gerencial de várias empresas (plano gerencial comum, eliminação das transações entre empresas, DRE consolidada) | 26 tab / 3: `PLANO_CONTAS_GERENCIAL`, `SETOR_GERENCIAL`, `LCTO_CONTABIL_GERENCIAL`, `LOTE_GERENCIAL`, `DRE_GERENCIAL`, `SALDO_MENSAL_GERENCIAL`, `CON_COR_EMP_TRANSACAO`, `PLANO_CONTAS_EMP_TRANSACAO` | Não tem | Não tem: o multi-inquilino separa as redes, mas não consolida | **F8**: valor alto para a própria Rede Santé, que tem vários hospitais | — |
| Projetos como centro de resultado (etapas, setores, produtos, modelo contábil próprio) | 7 tab / 0: `PROJETO`, `PROJETO_ETAPA`, `PROJETO_SETOR`, `PROJETO_EMP`, `PROJETO_PRODUTO` | Não tem | Não tem | **F8**: útil para obras, pesquisa e convênios com verba carimbada | — |
| Orçamento empresarial: versões do ano, premissas, cenários, grade por centro e conta, aprovação | 130 tab / 2: `ctl:BASE_ORCA*`, `ctl:ORCA_PLANO*`, `ORCA_PECA*`, `PECA_ORCAMENTARIA*`, `PLANO_ORCAMENTARIO`, `IT_PLANO_ORCAMENTARIO*`, `PREMISSA`, `CENARIO_ORCAMENTARIO`, `VERBA_ORCAMENTARIA`, `PROJECAO_ORCAMENTARIA` (cópias nos dois esquemas) | `MOPARAM` 1 (módulo sem uso) | M54.7: `/financeiro/orcamento`, versões, grade de 12 meses, aprovação por outra pessoa, orçado × realizado | **F7**: item de RFP hospitalar e já construído no new-sgh | `versao_orcamento`, `linha_orcamento`, `valor_orcado_mes`, `aprovacao_orcamento` |
| Controle orçamentário na compra e no pagamento (saldo conferido, bloqueio, exceção justificada, ajuste da nota) | 49 tab / 0: `ORCA_CONTROLE`, `ORCA_CONTROLE_CONTA`, `ORCA_CONTROLE_MOV`, `ORCA_CONTROLE_PENDENCIAS`, `ORCA_AJUSTE_NF`, `ORCA_EXCECAO`, `ORCA_REALIZADO`, `JUSTIFICATIVA_VARIACAO` | Não tem | Parcial: orçado × realizado só como consulta, sem bloqueio | **F8** | — |
| Orçamento estatístico e indicadores orçamentários por setor | 24 tab / 0: `ORCA_CONTROLE_IND`, `ORCA_CONTROLE_ESTATISTICO`, `INDICADOR_ORCAMENTARIO`, `BASE_ORCA_ITEM_ESTATISTICO`, `ORCA_GRUPO_INDICADOR` | Não tem | Não tem | **F8** | — |
| Orçamento público: programa de trabalho, função orçamentária, teto e empenho | 12 tab / 0: `ORCAMENTO_HOSPITALAR`, `PROGRAMA_TRABALHO`, `FUNCAO_ORCAMENTARIA`, `TETO_ORCAMENTARIO_UPS`, `NOTA_EMPENHO`, `PEDIDO_EMPENHO_FORNECEDOR` | Não tem | Não tem (as compras públicas do M55 não fazem execução orçamentária) | **F8**: só se o alvo incluir hospital público | — |
| Gestão de contratos com fornecedores: vigência, aditivo, reajuste, saldo, ocorrências e avaliação (no MV, também SLA, fórum e apontamento de produção) | 115 tab / 8: 59 `GCTO_*` no principal e 56 `ctl:GCTO_*` (`GCTO_CONTRATO`, `GCTO_CONTRATO_ITEM`, `GCTO_CONTRATO_SLA`, `GCTO_INDICADOR`, `GCTO_FORUM`, `GCTO_APONTAMENTO`), `REPASSE_GCTO_CONTRATO` | Não tem | M55.3: `/suprimentos/contratos`, saldo com as parcelas e alertas de 90, 60 e 30 dias | **F7**: auditoria e acreditação cobram. O SLA e o apontamento ficam para a F8 | `contrato_fornecedor`, `parte_contrato`, `aditivo_contrato`, `reajuste_contrato`, `ocorrencia_contrato`, `anexo_contrato`, `avaliacao_fornecedor` |

### Custos hospitalares

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Custeio por absorção: classificação dos centros, estatísticas do mês, rateio sequencial, custo e margem por conta, exportação ApuraSUS | 39 tab / 4: `CUSTO_PRIMARIO`, `CUSTO_ABSORVIDO`, `CUSTO_FINAL`, `RATEIO_PADRAO`, `RATEIO_PONDERADO`, `REGRA_RATEIO_SETOR`, `ITEM_RES_PROCEDIMENTO_SUS`, `GRUPO_DE_CUSTO`, `ROTINAS_CUSTO`, `VARIAVEIS_PADRAO`, `por:CENTRO_CUSTO` | `CTPARAM` 2, `CTTIPODADO` 2, `CTWTPREGRA` 2, `CTCTARECEITANCI` 4, `CTWGRUPOEXPORTACAO` 3, `TBUNIMEN` 1; só parâmetros, sem apuração | M54.4 e M54.5: `/custos/centros`, `/custos/apuracao`, `/custos/resultado` | **F7**: item de venda e exigência do SUS (ApuraSUS) para os contratualizados | `classificacao_centro_custo`, `criterio_rateio`, `estatistica_centro_mes`, `apuracao_custo`, `parcela_apuracao_custo`, `custo_conta_paciente`, `exportacao_custo` |
| Custo-padrão por procedimento (ficha técnica de insumos, sala, gases e diária) | 8 tab / 0: `CUSTO_FICHA`, `CUSTO_FICHA_ITEM`, `CUSTO_PRO_FAT`, `CUSTO_SALA_CIRURGIA`, `CUSTO_MINUTO_GAS`, `CUSTO_DIARIA_CENCIR` | Não tem | Não tem ficha técnica; o custo da conta vem da absorção | **F8**: base para precificar pacote | — |
| Plano de apuração de um sistema estrangeiro de seguridade | 3 tab / 2: `FFCH_CCSS`, `FFCH_SETOR_CCSS`, `FFCH_ITEM_RES_CCSS` | Não tem | Não tem | **NAO**: regra de outro país | — |

### Patrimônio

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Bens: cadastro a partir da nota ou da doação, plaqueta, transferência com aceite, comodato, baixa e inventário | 16 tab / 0: `BENS`, `BEM_PATRIMONIAL_PLACA`, `PLAQUETA_SECUNDARIA_BEM`, `MOV_BENS`, `MOT_BAIXA`, `INVENTARIO_PATRIMONIO`, `CONTAGEM_PATRIMONIO`, `ENTIDADE`, `SITUACAO_BENS` | `GPORIGEM` 5, `GPTP_RESPONSAVEL` 4, `GPPARAMG` 1, `GPPARAMU` 3; só parâmetros | M54.6: `/patrimonio/bens`, `/movimentos`, `/inventario` | **F7**: o imobilizado é obrigação contábil | `bem_patrimonial`, `grupo_bem`, `plaqueta`, `movimentacao_bem`, `baixa_bem`, `inventario_patrimonial`, `item_inventario`, `comodato_bem` |
| Depreciação mensal com coeficiente por turno e rateio por centro de custo | 4 tab / 0: `DEPRECIA`, `ITDEPRECIA`, `ITDEPRECIA_SETOR`, `BENS_DEPREC_SETOR` | `GPCOEFICIENTE_DEPREC` 3 | M54.6: `/patrimonio/depreciacao`, cota imutável e fato contábil | **F7** | `cota_depreciacao`, `rateio_depreciacao`, `coeficiente_turno` |
| Reavaliação, agregação de valor, imobilizado em andamento e seguro dos bens | 7 tab / 0: `BENS_REAVALIACAO`, `BENS_AGREGADOS`, `BENS_AGREGACAO_EXTRA`, `IMOB_AND_BEM`, `BENS_SEGURADOS`, `SEGUROS` | Não tem | Parcial: ajustes do bem na ficha | **F8** | — |

### Repasse médico

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Repasse médico: regras por convênio, procedimento e profissional; apuração do faturado; lançamento de eventos; recibo de autônomo com INSS e IRRF; cooperativas | 35 tab / 6: `REG_REPASSE`, `IT_REPASSE`, `REPASSE`, `REPASSE_PRESTADOR`, `REPASSE_PRESTADOR_CON_PAG`, `REPASSE_CONTA`, `RATEIO_REPASSE`, `GRUPO_REPASSE`, `REG_REPASSE_SIA`, `REG_REPASSE_SIH`, `MULTI_EMPRESAS_REPASSE`, `MOV_PRESTADOR` | `TBREPGER` 1.000+, `TBREPGER_TBCBOPRO` 1.000+, `FCINTEGRPA` 1.000+, `RPLANEVE` 1.000+, `RPLANEVE_COMPOSICAOBASE` 1.000+, `RPRPA` 1.000+ (5,2 mil recibos), `RPEVENTO` 93, `TBCOOPER` 242, `TBCRECOO` 345, `TBCREMED` 185; uso alto | M33 e M42: `/repasse/regras`, `/apuracao`, `/lancamentos`, `/rpa`, `/meu-extrato`; a emissão do recibo está desligada, e a integração do faturado com o repasse só foi especificada | **F3**: em uso mensal | `regra_repasse`, `versao_regra_repasse`, `apuracao_repasse`, `item_apuracao_repasse`, `lancamento_repasse`, `base_calculo_repasse`, `recibo_autonomo`, `evento_repasse`, `cooperativa_medica`, `cooperado` |
| Repasse de plantão pela escala e pelo valor-hora, com revisão do plantão realizado | 15 tab / 0: `REPASSE_PLANTAO`, `REPASSE_PLANTAO_VALOR_HORA`, `ESCALA_REP_PLANTAO`, `REG_REPASSE_PLANTAO_SETOR`, `REG_REVISA_PLANTAO_SETOR`, `REGRA_VALOR_PLANTAO_SETOR`, `REGISTRO_PLANTAO` | Não tem (o plantão é pago como evento do recibo) | M52.6: plantão realizado valorado por tarifa e lançado ao repasse, pronto e desligado (DP-33) | **F8**: já existe no new-sgh e se liga depois da virada | — |
| Remuneração variável: produtividade, valor mínimo garantido, valor fixo, percentual do resultado e custo do prestador | 16 tab / 0: `REG_REPASSE_PROD`, `REG_REP_VARIAVEL`, `FAIXA_REP_VARIAVEL`, `EQUIPE_REP_VARIAVEL`, `REPASSE_VALOR_MINIMO`, `REPASSE_VALOR_FIXO`, `REPASSE_PERC_RESULTADO`, `REPASSE_CUSTOS_PREST` | Não tem | Não tem | **F8**: modelo de remuneração médica moderno | — |

### Gestão de pessoas

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Colaborador: admissão ligada ao profissional e ao usuário, vínculos, lotação, dependentes, desligamento e validade do conselho | Não há nesta base (o cadastro com o nome de funcionário é da manutenção) | `FPSIT_FUNC` 16, `FPTP_FUNC` 16, `FPTIPORESC` 8, `FPRESP` 1, `FPLOTTRIBCAD` 1 e mais 15 domínios (112 linhas); `GETABFUN` 13; sem cadastro de colaborador com movimento | M52.1: `/pessoas/colaboradores`, admissão e ficha; CPF cifrado | **F7**: o legado não tem RH; a lei exige o cadastro para o eSocial | `colaborador`, `vinculo_trabalho`, `lotacao`, `dependente`, `desligamento`, `cargo`, `validade_conselho` |
| Escala de trabalho: regimes de jornada, montagem e publicação, plantão, sobreaviso, troca e cessão, "quem está de plantão agora" | Não há nesta base | `POTPTRABFOLGA` 12, `POTPHORA` 9, `PODIA` 8, `POTPJORNADA` 6 e mais 7 domínios (61 linhas); sem escala montada | M52.2 e M52.3: `/pessoas/escala`, `/trocas`, `/plantao-agora`, `/regimes` | **F7**: o hospital novo precisa da escala de enfermagem. A Rede pode ligar depois | `regime_jornada`, `vigencia_regime_colaborador`, `escala`, `plantao`, `troca_plantao`, `acionamento_sobreaviso` |
| Dimensionamento de enfermagem pela resolução do COFEN, com as parcelas | Não há | Não tem | M52.3: `/pessoas/dimensionamento` | **F7**: exigência regulatória da enfermagem | `dimensionamento_enfermagem`, `parcela_dimensionamento` |
| Ponto eletrônico: arquivo do relógio (AFD), ajustes aprovados por outra pessoa, apuração contra a escala, banco de horas, espelho e AEJ | Não há | `PEPERIOD_JUSTIF` 23, `PETP_MOVIM` 15, `PETP_INTEGR_EVENTO` 13, `PEJUSTIF` 3, `PEPARAM` 1 (61 linhas); só domínios | M52.4: `/pessoas/ponto`, `/ponto/meu` | **F7**: Portaria 671/2021 | `arquivo_ponto`, `marcacao_ponto`, `ajuste_ponto`, `justificativa_ponto`, `apuracao_ponto`, `movimento_banco_horas`, `fechamento_ponto` |
| Folha de pagamento: rubricas e incidências, cálculo mensal, férias, 13º, rescisão, holerite e paralelo com a folha externa | Não há (só a regra contábil da folha, contada na linha de regras de contabilização) | `FPEVENTO` 108, `FPRUBRICAINSS_FPEVENTO` 22, `FPRUBRICAIRRF_FPEVENTO` 22, `FPRUBRICAFGTS_FPEVENTO` 22, `FPMOTAFAST` 21, `TBTABIRR` 15, `FPREMESSA` 3 (252 linhas); a folha nunca foi calculada | M53.1 a M53.5: `/pessoas/folha` com abas de cálculo, férias, 13º e rescisão; `/pessoas/meu/holerite` | **F7**: o hospital novo precisa de folha; a Rede segue com a folha externa e a interface do M53.1 | `rubrica`, `incidencia_rubrica`, `tabela_legal_vigencia`, `competencia_folha`, `calculo_folha`, `item_calculo_folha`, `afastamento`, `periodo_aquisitivo`, `programacao_ferias`, `recibo_ferias`, `parcela_decimo_terceiro`, `rescisao`, `lote_folha_externa` |
| eSocial: eventos de tabela, não periódicos e periódicos, lotes, retorno e conciliação com o repasse | Não há | 104 tabelas de domínio e configuração (3.886 linhas): `FPSUBRISCOCUP` 1.000+, `FPCATEGTRAB_FPCLASSIFTRIB` 457, `FPESOCARQXSD` 373, `FPNATRUBRICA` 203; `FPESOCPENDDET` 1.000+ (pendências do fornecedor, a descartar) | M53.6 e M53.7: `/pessoas/esocial`, prévia conferida no XSD oficial, transmissor construído e desligado | **F7** | `parametro_empregador`, `evento_esocial`, `lote_esocial`, `retorno_esocial`, `tabela_esocial` |
| Obrigações trabalhistas: FGTS Digital, SEFIP, CAGED e RAIS | Não há | 27 tabelas (920 linhas): `FPFPAS_FPCLASSIFTRIB` 262, `FPCODALIQFPAS` 247, `FPCOD_GPS` 69, `FPALIQRATCNAE` 51 | M53.8: `/pessoas/obrigacoes`, entrega só com o leiaute conferido | **F7** | `obrigacao_trabalhista`, `arquivo_obrigacao`, `guia_fgts` |
| Integração da folha com o financeiro, a contabilidade e o custo de pessoal por centro | Ver a linha de regras de contabilização (regra contábil da folha) | `FPINTROTINA` 19, `FPINTAGRUP` 5 | M53.9: `/pessoas/folha/integracao`, títulos a pagar e fato do custo de pessoal na mesma transação | **F7** | `depara_folha_financeiro`, `titulo_folha`, `custo_pessoal_centro` |
| SESMT: prontuário ocupacional, ASO, PCMSO, CAT, EPI por função, riscos, vacinas e acidente com material biológico | Não há | ASO 7, CAT 16, riscos e EPI 12, vacina 1 (36 tabelas, cerca de 2 mil linhas, só domínios): `FPCATFATRISCO` 1.000+, `FPAGEACIDTRAB` 246, `FPCATCAUSACD` 247 | M52.5: telas do SESMT, com o prontuário ocupacional separado do PEP | **F7**: NR-7, NR-32 e eSocial de SST | `prontuario_ocupacional`, `aso`, `exame_ocupacional`, `comunicacao_acidente`, `entrega_epi`, `risco_funcao`, `vacina_colaborador`, `exposicao_biologica` |
| Treinamentos e POP: cursos, turmas, presença e ciência por versão | Não há (as habilidades do prestador estão em outra linha) | `FPTP_TREINAMENTO_CAPACITACAO` 21 (domínio do eSocial) | M52.6: `/pessoas/treinamentos` | **F7**: a NR-32 e a acreditação cobram o registro | `curso`, `turma_treinamento`, `presenca_treinamento`, `ciencia_procedimento` |
| Cargos, faixas salariais e vagas; avaliação de desempenho e de experiência | Não há | Não tem | Telas e API de cargos e de avaliação (`/pessoas/cargos`, `/pessoas/avaliacoes`) | **F8**: gestão, não paridade nem obrigação | — |
| Autosserviço do colaborador (holerite, férias, ponto, solicitações) e indicadores de pessoas | Não há | Não tem | M52.6 e M53: "Meu espaço", `/pessoas/meu/*`, `/pessoas/indicadores` | **F8**: liga junto com a folha própria | — |
| Desconto em folha do consumo do colaborador (refeição, saldo devedor) | 3 tab / 0: `FUNCIONARIO_SALDO` (customização de um cliente do fornecedor), `VALE_RANCHO`, `VALE_RANCHO_CAIXA` | `FPVALE` 1 | Não tem | **NAO**: customização de cliente, baixo valor | — |
| Habilidades do prestador para alocação | 2 tab / 0: `HABILIDADE`, `HABILIDADE_PRESTADOR` | Não tem | Coberto pelas especialidades e habilitações do corpo clínico | **NAO**: duplica o cadastro do profissional | — |

## Recursos novos do MV que valem a pena

Em ordem de valor para o produto. Nenhum deles atrasa a virada da Rede Santé.

1. **Controle orçamentário que age na operação.** O saldo do orçamento é conferido na solicitação de compra, na nota e
   no título. Quando falta saldo, a operação é bloqueada ou passa por uma exceção justificada. O new-sgh só compara o
   orçado com o realizado depois do fato.
2. **Consolidação gerencial da rede.** Um plano gerencial comum às empresas, a eliminação das transações entre elas e
   a DRE consolidada. É o recurso de maior valor para a própria Rede Santé, que tem vários hospitais.
3. **Remuneração médica variável.** Produtividade por faixa e por equipe, valor mínimo garantido, valor fixo e
   percentual do resultado, com o custo do prestador abatido. Vem junto do repasse de plantão, que o new-sgh já tem
   pronto e desligado.
4. **Fluxo de aprovação configurável.** Pontos de aprovação com agrupadores, respostas fixas e aprovação pelo
   celular, para compras, contratos e pagamentos. O M32 tem alçada de um nível.
5. **Custo-padrão por procedimento.** A ficha técnica com insumos, minutos de sala, gases e diária. Ajuda a precificar
   pacotes e a comparar com o custo real que sai da absorção.
6. **Conciliação dos recebíveis de cartão e o Pix com baixa automática.** O MV registra cada parcela da administradora
   e a taxa, e o retorno do Pix baixa o título. O Pix entra na F7; a agenda da administradora, na F8.
7. **Encontro de contas e notas de crédito e débito.** O hospital compensa o que paga e o que recebe do mesmo
   parceiro, comum com cooperativas, laboratórios de apoio e convênios que também são fornecedores.
8. **Gestão de contratos ampliada.** Acordo de nível de serviço, apontamento de produção do terceiro e indicadores do
   contrato, sobre o cadastro de contratos que o M55.3 já tem.

Também valem, com menos peso: o cenário no fluxo de caixa, a prestação de contas do adiantamento com anexos, a
reavaliação e o seguro dos bens, o orçamento estatístico e a execução orçamentária do hospital público.

## Lacunas do new-sgh frente ao SPDATA

O new-sgh já passou do SPDATA em quase todo o grupo. O que segue é o que o SPDATA tem, ou o que a virada precisa, e o
new-sgh ainda não fecha:

1. **Integração do faturamento com o repasse.** O SPDATA leva mais de mil itens faturados por mês ao repasse. No
   new-sgh, essa operação só foi especificada. Sem ela, o repasse não roda no sistema novo.
2. **Emissão do recibo de autônomo.** Está construída e desligada até o cenário controlado e o lote do eSocial. O
   SPDATA emitiu cerca de 5,2 mil recibos desde 2020.
3. **Classificação gerencial e rateio depois do lançamento.** O SPDATA permite reclassificar a apropriação de um
   título já lançado. No new-sgh, falta a rota (achado parcial do M32).
4. **Guia de recolhimento dos tributos retidos.** O SPDATA guarda os códigos de receita federal por tributo e os usa
   nas retenções. O new-sgh calcula o retido, mas não gera o título nem a guia do recolhimento com o código de
   receita.
5. **Envio real das obrigações fiscais.** A NFS-e, a DMED e a EFD-REINF são geradas e conferidas, mas não saem: a
   emissão e o envio dependem da DP-38. A virada precisa de pelo menos a NFS-e real.
6. **Cobrança bancária.** O SPDATA tem as carteiras de cobrança com os leiautes do boleto. O new-sgh só cadastra os
   bancos e as carteiras. Antes de decidir se isso é paridade, falta medir se a Rede emite boleto hoje.
7. **NF-e de saída de mercadoria.** O SPDATA tem as naturezas de operação de simples remessa e de venda, e o estoque
   registra a saída a terceiro. O new-sgh cadastra as naturezas, mas não emite a nota. Falta confirmar se o SPDATA
   emite ou se a nota sai de outro sistema.
8. **Recebíveis de cartão.** O SPDATA configura a taxa por tipo de cartão e o parcelamento na forma de pagamento. O
   new-sgh recebe por um conector simulado e não registra a parcela da administradora nem a taxa descontada.

No RH, não há lacuna de paridade: o SPDATA só tem domínios, e o new-sgh construiu colaborador, escala, ponto, SESMT,
treinamento, folha, eSocial e obrigações (M52 e M53, todos aguardando validação e com as chaves desligadas).
