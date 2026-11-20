# Análise cruzada 08: operadora própria (plano de saúde) e integrações

Grupo: **SGO** (operadora ou plano de saúde próprio do hospital) e **INTG** (integrações, interoperabilidade e portais
voltados para fora).
Data: 2026-11-20. Fontes, só leitura:
- `referencias/mv-tabelas.tsv`, mais metadados do Oracle (nenhuma linha de dado lida);
- a matriz das 1.503 tabelas do SPDATA (`new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`);
- do new-sgh: `planejamento/ESTADO.md`, a árvore de menus (`planejamento/fonte-pdf/arvore-menus.txt`) e o código
  (`packages/dominio-operadora`, `packages/dominio-integracao`, `apps/api/src/modulos/{operadora,integracao,tiss}`,
  `apps/web/src/modulos/{operadora,integracoes,portal,portal-medico,portal-prestador}`).

Como ler:
- **MV (evidência):** esquema, prefixos e tabelas de exemplo, com "N tab / M com dados". "Com dados" é a marca
  `tem_dados` da base de referência do MV, não uso em produção. Os nomes do MV só aparecem nesta coluna.
- **SPDATA (evidência, uso):** tabelas da matriz e o número de linhas. "1.000+" quer dizer que a contagem da matriz
  parou em 1.001. Os nomes do SPDATA só aparecem nesta coluna.
- **new-sgh (estado):** marco, pacote, rota ou tela. Tudo está "aguardando validação" no ESTADO.md, e quase tudo com a
  chave desligada por estabelecimento (POL-3).
- **Entidades próprias:** nomes nossos, em `snake_case` português, só para as decisões F3 e F7.

## Resumo numérico

| Item | Valor |
|---|---|
| Tabelas do MV analisadas | **2.368** (250 com dados) |
| Operadora própria (esquema inteiro, ver a base da contagem) | 2.038 (239 com dados) |
| Motor de integração (esquema inteiro) | 192 (0 com dados) |
| Recorte de integração do esquema hospitalar | 138 (11 com dados) |
| Tabelas do SPDATA no grupo | 84 da operadora + 50 de integrações = **134**. Também são citadas tabelas de faturamento, SADT, PEP e relatórios ligadas ao grupo. |
| Funcionalidades | **48**: 25 da operadora e 23 de integrações e portais |
| Decisão F3 (paridade) | **15**: 1 da operadora e 14 de integrações |
| Decisão F7 (hospital do zero) | **19**: 17 da operadora e 2 de integrações |
| Decisão F8 (recurso novo) | **6**: 3 da operadora e 3 de integrações |
| Decisão NAO | **8**: 4 da operadora e 4 de integrações |
| Entidades próprias propostas (F3 e F7) | **161** |

Base da contagem do MV (a coluna é de evidência):

| Esquema MV (evidência) | Tabelas | Com dados | O que entrou |
|---|---|---|---|
| DBAPS | 2.038 | 239 | o esquema inteiro, em 25 funcionalidades |
| MVINTEGRA | 192 | 0 | o esquema inteiro |
| DBAMV (recorte) | 138 | 11 | webservice TISS e autorizador (69), configuração de sistemas integrados e XML (13), ERP (22), RNDS e SUS (7), interfaces de laboratório (6), imagem (2), portal de laudos (2), cotação de OPME (16), regulação (1) |
| **Total** | **2.368** | **250** | 2.038 + 192 + 138 = 2.368; 239 + 0 + 11 = 250 |

As contas, com as parcelas:
- Decisões: 15 + 19 + 6 + 8 = 48.
  - Operadora: 1 + 17 + 3 + 4 = 25.
  - Integrações: 14 + 2 + 3 + 4 = 23.
- Entidades: 97 da operadora + 64 de integrações = 161. A conta linha a linha está no fim do documento.

Fora deste grupo, para não contar duas vezes:
- Já analisados no grupo 01: o portal corporativo do MV (estratégia, indicadores, BI, intranet), o login único, a
  assinatura digital, o servidor de e-mail, as notificações internas, a gerência de instalação e a atualização de
  versão.
- Já analisados no grupo 02: o painel de chamada e o totem, o contato ativo antes da consulta, o agendamento online e
  a teleconsulta.
- Ficam para o grupo de qualidade: ocorrências, riscos, gestão documental e auditorias do portal corporativo.

Leitura rápida:
- **A operadora é grande no MV e vazia no SPDATA.**
  - No MV: 2.038 tabelas, a maior parte em três blocos.
    - Intercâmbio entre cooperativas: 275, linha 17.
    - Troca TISS na visão da operadora: 184, linha 15.
    - Logs e importações de clientes: 337, linhas 24 e 25.
  - No SPDATA: o módulo nunca foi usado. São 84 tabelas, das quais 76 são domínios, e o beneficiário tem um único
    registro fictício. O new-sgh construiu a operadora assim mesmo, por decisão do dono (DP-11, marco M56, 8 etapas).
- **Por isso a operadora fica quase toda em F7.** A Rede Santé não usa a operadora, logo ela não pesa na virada. Mas é
  produto vendável e regulado pela ANS, e as regras já existem no new-sgh. Só as terminologias são F3, porque são
  compartilhadas com o faturamento.
  - Se o dono preferir tirar o plano próprio do pacote "hospital do zero", as 17 linhas F7 da operadora passam juntas
    para F8.
  - Nenhuma regra muda com isso.
- **As integrações são o contrário.** O motor do MV está vazio na base de referência (0 de 192 com dados). O SPDATA tem
  uso real:
  - laboratório de apoio, com mais de 1.000 exames e elementos no de-para;
  - etiquetas do sistema de laboratório;
  - portais de cotação, com 225 pedidos ligados;
  - a regulação estadual, com 42 serviços configurados;
  - o portal de resultados, com mais de 1.000 liberações auditadas.

  O new-sgh já tem o essencial: a fila de saída com retentativa e idempotência, o HL7 v2, o FHIR com a RNDS, o
  laboratório de apoio e a fachada da plataforma Hal-AI. Por isso 14 das 23 linhas de integração são F3.
- **Comunicação com o paciente:** nenhum canal próprio (DP-44 b). Toda mensagem ao paciente sai pela plataforma Hal-AI.
  O modelo guarda só o pedido de envio e o retorno, nunca um provedor de SMS ou de WhatsApp.

## Matriz de cobertura

### Operadora própria (SGO)

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 1 | Cadastro da operadora: razão social, registro na ANS, responsáveis, parâmetros gerais e várias operadoras numa instalação | 50 tab / 15 com dados. DBAPS `ME_*` (multiempresa), `CONFIG_*`, `MVS_CONFIGURACAO`, `ADMINISTRADOR_OPERADORA`, `DEPTO_OPERADORA*`, `FERIADO`, `ESCALA*`; domínios odontológicos `MVS_DENTES`, `MVS_REGIAO_DENTE` | Só parâmetros, sem uso: `CDPARDIGOBG` (4), `PSDOCIMPNOMESOCIAL` (8), `PSEMPEMITEOBS` (5). Módulo nunca usado | M56.1 e M56.2: `dominio-operadora` (`liberacao`, `produto`, `documentos`), operadora como empresa; chaves do módulo e das 10 fatias por estabelecimento | **F7**: base de todo o módulo; exigência para operar um plano registrado | `operadora_saude`, `parametro_operadora`, `responsavel_operadora`, `fatia_operadora_estabelecimento` |
| 2 | Produtos e planos registrados na ANS (segmentação, abrangência, acomodação, faixa de cobertura), contratos pessoa física e jurídica, contratante, aditivos e cancelamento | 82 tab / 12 com dados. DBAPS `PLANO*`, `MOD_PLANO*`, `CONTRATO*` (28), `EMPRESA*`, `ADITIVO*`, `SERVICOS*`, `ME_TIP_PLANO` | `CDPLANOCLASSIF` (3), `CDTPCONTRATO` (2), `CDTPCTRCONTRAT` (2), `CDACOMODTIPO` (3); `PSPLNASS` (1, fictício, descartar) | M56.2: `plano.ts` (RN 63, carências, cartão de desconto), `contrato.ts`; tela `/operadora/beneficiarios` | **F7**: sem produto registrado não há venda; RN 63 e regras de contratação são regulatórias | `produto_plano`, `plano_comercializado`, `segmentacao_assistencial`, `contrato_plano`, `contratante_plano`, `aditivo_contrato_plano`, `cancelamento_contrato_plano` |
| 3 | Beneficiários: titular e dependentes, grau de dependência, carências, cobertura parcial temporária e declaração de saúde, cartão do beneficiário com segunda via, inclusão, exclusão, reativação e elegibilidade | 106 tab / 18 com dados. DBAPS `USUARIO*` (24), `BENEFICIARIO_*`, `GRAU*`, `CARENCIA*`, `CARTEIRA*`, `CATEGORIA*`, `DESLIGA*`, `HIS_*`, `FAMILIA`, `MAIORIDADE_CONTRATUAL`, `CEP*` | `PSBENEFI` (1, fictício de 1899), `PSBENCPL` (1), `PSATVASS` (1), todas para descartar; domínios `CDSTATUSCAD` (4), `CDMOTMOVIMCAD` (12), `CDMOTIVOSOLCART` (3), `CDSTATUSSOLCART` (4), `CDTPENDERECO` (4), `PSMOTIVO` (1) | M56.2: `beneficiario.ts`, `carteirinha.ts`, `elegibilidade.ts`; titulares, dependentes, segunda via, exclusão e reativação | **F7**: núcleo da operadora; entra no cadastro de beneficiários enviado à ANS | `beneficiario_plano`, `vinculo_dependencia`, `carencia_aplicada`, `cobertura_parcial_temporaria`, `declaracao_saude`, `cartao_beneficiario`, `pedido_segunda_via_cartao`, `movimento_cadastral_beneficiario`, `consulta_elegibilidade_plano` |
| 4 | Tabela de preço por faixa etária (RN 63) e reajuste anual: teto da ANS no individual, agrupamento no coletivo pequeno, índice e estorno | 19 tab / 2 com dados. DBAPS `FAIXA_ETARIA`, `FAIXA_REAJUSTE`, `FAIXA_VIDAS`, `REAJUSTE*`, `INDICE_REAJUSTE*`, `ESTORNO_REAJUSTE` | `CDFAIXAETATP` (3), `CDTPMOVVALOR` (9) | M56.3: mensalidade pela faixa da RN 63 com os reajustes do contrato | **F7**: preço e reajuste são regulados; erro aqui vira multa | `tabela_preco_faixa_etaria`, `faixa_etaria_preco`, `reajuste_contrato_plano`, `indice_reajuste_vigente`, `agrupamento_reajuste_coletivo` |
| 5 | Mensalidade por competência e cobrança: boleto, débito automático, cartão, desconto em folha do contratante, retorno bancário, baixa com multa e juros, acréscimo e desconto | 98 tab / 7 com dados. DBAPS `MENS*`, `ITMENS*`, `LCTO*`, `BOLETO*`, `CFG_*` (retorno), `CONTA_CORRENTE*`, `MVS_ENVIO_FOLHA*`, `VALORES*`, `RECEITA*`, `BANCO*` | `CDDIAVENCCOB` (31), `CDTPCOBRANCA` (5), `CDMSGCOBRANCA` (9), `CDMSGLINHA` (7), `CDORIGEMCOBR` (4), `PSORIGEMCOBR` (7), `PSTIPMEN` (5), `CDTPEMISSAO` (8), `CDTPLANCAMEN` (4), `CDTPEVTCTAREC` (5), `CDTPCONTRCAIXA` (7), `CDTPDESCACR` (2), `TBTIPOCOBRANCASGO` (4), `TBENVCOBEMAIL` (5), `TBTPEMAILPLS` (9) | M56.3: `cobranca.ts`, tela `/operadora/cobranca`; boleto e retorno bloqueados (D-BOLETO-56); envio por e-mail desligado (DP-44 a) | **F7**: sem cobrança a operadora não fecha o mês | `mensalidade_competencia`, `item_mensalidade`, `cobranca_beneficiario`, `baixa_cobranca_beneficiario`, `convenio_cobranca_bancaria`, `arquivo_retorno_cobranca`, `desconto_folha_contratante`, `ajuste_cobranca_contrato` |
| 6 | Coparticipação e franquia: regra por produto e por tipo de guia, limite, acúmulo por período, pagamento no balcão | 16 tab / 0 com dados. DBAPS `GRUPO_FRANQUIA*`, `ITGRUPO_FRANQUIA*`, `FRANQUIA_EXCECAO`, `TETO_*`, `LIMITE_*` | `CDTPCOPART` (3), `CDPGTOCOOPART` (2), `CDPGTOBALCAOCP` (4), `PSCOPARTTPGUIAQNDO` (4), `CDTPFRANQUIA` (4), `CDTPACUMULPOR` (2), `PSTPACUMULPOR` (3), `PSTPPERIODO` (2), `CDTPPERIODO` (2) | M56.3: coparticipação pela regra do produto | **F7**: comum em todo plano coletivo; regra da ANS sobre fator moderador | `regra_coparticipacao`, `lancamento_coparticipacao`, `regra_franquia_plano`, `limite_utilizacao_periodo` |
| 7 | Inadimplência: notificação antes da suspensão (Lei 9.656, art. 13), acordo em parcelas, cobrança judicial e distribuição a cobradores | 19 tab / 0 com dados. DBAPS `INADIMPLENCIA*`, `REPACTUACAO*`, `DISTR_*`, `ACAO_JUDICIAL`, `COMARCA`, `VARA_CIVEL` | `CDMOTIVOBAIXA` (1) | M56.3: inadimplência com a notificação (RN 593) e acordo em parcelas | **F7**: a notificação é obrigatória antes de suspender ou rescindir. A cobrança judicial fica para depois | `ocorrencia_inadimplencia`, `notificacao_inadimplencia`, `acordo_parcelamento`, `parcela_acordo` |
| 8 | Comercial: proposta de adesão, corretores e equipes de venda, metas, campanhas de desconto e comissão com estorno | 29 tab / 3 com dados. DBAPS `PROPOSTA*`, `CAMPANHA*`, `CHEFIA_COMERCIAL*`, `CATEGORIA_VENDEDOR`, `META_VENDA`, `PENDENCIA_COMISSAO`, `BENEFICIARIO_ESTORNO_COMISSAO` | `CDVENDATPREP` (6), `CDINCIDECOMIS` (4); `PSVENDAS` (1, fictício, descartar) | Só os domínios no CRUD genérico (M56.1); nenhum fluxo de venda | **F8**: valor real para uma operadora em crescimento, mas não é exigência regulatória | — |
| 9 | Rede credenciada: credenciamento de pessoa física e jurídica, locais e especialidades, contratação indireta, descredenciamento com aviso e substituto, movimentos do registro de prestadores na ANS, qualificação divulgada | 114 tab / 7 com dados. DBAPS `PRESTADOR*` (46), `REST_*` (rede referenciada), `ESPECIALIDADE*`, `QUALIFICACAO*`, `SUSPENSAO*`, `DESLIGAMENTO*`, `CNES`, `CONSELHO_PROFISSIONAL*` | `TBTPPRESTADOR` (8), `TBSTATUSCREPLS` (4), `TBCLASSIFCREPLS` (3), `TBISENCAOONUS` (3), `TBDISPONIBILSERV` (2), `TBTPCONTRATOCREPLS` (2), `PSNATUREZAPS` (5) | M56.4: `rede.ts`, tela `/operadora/rede`, movimento do RPS na mesma transação | **F7**: rede e substituição de prestador são reguladas | `prestador_rede`, `contrato_rede_prestador`, `local_atendimento_rede`, `especialidade_atendida_rede`, `movimento_rede_ans`, `descredenciamento_prestador`, `qualificacao_prestador_rede` |
| 10 | Remuneração e pagamento do prestador: tabela negociada, regra de valoração, pacotes, reajuste contratual, calendário de pagamento, adiantamento e retenções | 76 tab / 2 com dados. DBAPS `TABELA*`, `VALOR*`, `ITREGRA*`, `MODELO*`, `ITMODELO*`, `PACOTE`, `CALENDARIO*`, `PGTO_PRESTADOR`, `ADIANTAMENTO`, `REPASSE*`, `KIT*` | `TBTISSREMUNERAOPERPS` (7), `TBTPFORMAREAJ` (8), `TBTPUNIDTEMPO` (5), `TBTPFAVORECIDO` (4), `TBTPVIGCONTRATO` (2), `TBREGIMEATEND` (3), `CDTPDESPCTAPG` (17), `CDTPDESPCTAPGCM` (2) | M56.4 (contrato com reajuste) e M56.6 (pagamento ao prestador só com os valores) | **F7**: sem pagamento a rede não se mantém; contratualização é regulada | `tabela_remuneracao_rede`, `regra_valoracao_item`, `pacote_remuneracao_rede`, `calendario_pagamento_rede`, `pagamento_rede`, `retencao_pagamento_rede`, `adiantamento_rede` |
| 11 | Autorização de guias e auditoria médica: pedido do prestador, protocolo e prazo pelo caráter, críticas automáticas, regras de cobertura do rol e diretrizes, negativa fundamentada, junta da divergência técnica, senha e validade | 127 tab / 22 com dados. DBAPS `GUIA*`, `ITGUIA*`, `AUTORIZACAO*`, `SOLICITACAO*`, `AUDITORIA`, `AUDITOR`, `RESTRICAO*`, `REGRA*`, `PROCED*`, `ROL_*`, `MOTIVO*`, `FATOR_URGENCIA` | `CDGUIASTATUS` (9), `CDORIGEMGUIA` (5), `PSORIGEMGUIA` (6), `CDTPGUIA` (4), `PSTIPOGUIA` (4), `PSCRITICA` (7), `CDTPRETCONS` (5), `PSTPRETORNO` (5), `PSFORNEMEMSIT` (6), `PSGRUPOCLASSIF` (5) | M56.5: `autorizacao.ts`, tela `/operadora/autorizacoes` | **F7**: prazos de atendimento e negativa por escrito são regulados | `pedido_autorizacao_plano`, `item_pedido_autorizacao`, `critica_pedido_autorizacao`, `decisao_auditoria_medica`, `junta_divergencia_tecnica`, `regra_cobertura_rol`, `auditor_designado`, `senha_autorizacao_plano` |
| 12 | Ações automáticas configuráveis: condições sobre registros que disparam ações, alertas e exclusões automáticas | 13 tab / 3 com dados. DBAPS `ACAO_AUTOMATICA*`, `ACAO_AUT_CONDICAO`, `AUTO_EXCLUDENTE*`, `AUTO_CADELETRONICO_*`, `ALERTA` | Não tem | As regras ficam no domínio, com teste; as filas de trabalho fazem o papel do alerta | **NAO**: contraria a premissa (regra de negócio fora do código e disparada por evento do banco) | — |
| 13 | Contas médicas recebidas da rede: lote em XML, protocolo, críticas e glosa automática, revisão, devolução, recurso de glosa e demonstrativo de análise | 130 tab / 5 com dados. DBAPS `CONTA*`, `ITCONTA*`, `REMESSA*`, `ITREMESSA*`, `LOTE*`, `PROTOCOLO*`, `RECURSO*`, `REVISAO*`, `ARQUIVO*`, `ANEXO_CONTA_MEDICA` | Não tem | M56.6: `conta.ts` (XML 04.03.00 conferido no XSD), tela `/operadora/contas` | **F7**: TISS 04.03.00 é a única versão aceita e o prazo de pagamento é regulado | `lote_conta_recebida`, `guia_conta_recebida`, `item_conta_recebida`, `glosa_conta_recebida`, `recurso_glosa_recebido`, `demonstrativo_analise_emitido` |
| 14 | Reembolso ao beneficiário: pedido com anexos, tabela de referência por município, análise com glosa por item e pagamento | 9 tab / 0 com dados. DBAPS `REEMBOLSO*`, `ITREEMBOLSO*`, `TABELA_REEMBOLSO_*` | `PSREEMBOLSOTP` (4: hospitalar, SP/SADT, materiais e medicamentos, transporte) | Só como natureza de protocolo no atendimento (M56.8); não há pedido nem pagamento | **F7**: a operadora deve reembolsar quando não garante a rede (RN 566) e nos planos de livre escolha | `pedido_reembolso`, `item_pedido_reembolso`, `tabela_reembolso_referencia`, `pagamento_reembolso` |
| 15 | Troca TISS na visão da operadora: recepção de pedidos de autorização e de lotes, cancelamento, comunicação de internação, demonstrativos de pagamento e de análise, mensagens à ANS | 184 tab / 6 com dados. DBAPS `TISS_*` (182: `TISS_AUTORIZACAO*`, `TISS_LOT_GUIA*`, `TISS_PROT_RECEB*`, `TISS_DEM_PGT*`, `TISS_DEM_ANA*`, `TISS_MSG_ENV_*`), `MV_TISS`, `GERA_XML_TISS_CM*` | Não tem (a troca do SPDATA é a do prestador, linha 31) | M56.6: XML recebido e demonstrativo de análise em XML; o validador do M31 | **F7**: obrigatório para qualquer operadora | `troca_tiss_operadora`, `demonstrativo_pagamento_emitido`, `cancelamento_guia_recebido`, `comunicacao_internacao_recebida` |
| 16 | Terminologias e tabelas de referência (TUSS, ANS, CBHPM, Brasíndice, CID, CBO, conselhos) | 79 tab / 49 com dados. DBAPS `TIPO_*`, `MOTIVO_*`, `STATUS_*`, `VIA_*`, `UNIDADE_*`, `MVS_TIPO_*`, `CBHPM_*`, `CID`, `CBO`, `EDICAO_BRASINDICE` | Faturamento: `TBTISSTERMO` (76) e cerca de 40 terminologias `TBTISS*`, `TBTISSREFIND` (1.000+), `TBTISSFORMAENV` (1.000+); `PSPRCANS` (305) | M31 e M56.1: terminologias carregadas pelo faturamento; catálogos ANS em `/cadastros/catalogos/ans` | **F3**: o mesmo catálogo serve ao faturamento da Rede Santé; a operadora só o lê | `terminologia`, `termo_terminologia`, `tabela_referencia_preco`, `vigencia_termo` |
| 17 | Intercâmbio entre operadoras do sistema cooperativo: atendimento de beneficiário de outra operadora, reciprocidade, faturamento e cobrança entre elas | 275 tab / 36 com dados. DBAPS `PTU_*` (262), `UNIMED*`, `*RECIPROCIDADE*`, `PLANO_INTERCAMBIO` | Não tem | Não tem | **NAO**: leiaute próprio de um sistema de cooperativas, fora do público-alvo | — |
| 18 | Obrigações com a ANS e a Receita: cadastro de beneficiários, informações assistenciais, informações econômico-financeiras, registro de prestadores, monitoramento TISS, taxa de saúde suplementar, ressarcimento ao SUS e declaração de serviços médicos | 105 tab / 14 com dados. DBAPS `SIB*`, `SIP*`, `DIOPS*`, `RPS*`, `MONIT*`, `MONITORAMENTO*`, `RESSARCIMENTO*`, `DMED*`, `RPC*`, `RADAR*`, `ANS*`, `EXPOSTOS_*` | `TBSIPANSPROC` (1.000+), `TBSIPANSATO` (75), `PSSIBCAMPOALT` (19), `PSTPSVIGENCIA` (2), `PSTPSMESRECOL` (6), `PSPRCANS` (305) | M56.7: `ans/sib`, `sip`, `diops`, `tps`, `monitoramento`; arquivo com SHA-256; recibo só em produção; tela `/operadora/ans`. A declaração à Receita da operadora não existe | **F7**: obrigação legal de toda operadora; a declaração à Receita também | `envio_ans`, `item_envio_ans`, `retorno_envio_ans`, `retrato_cadastral_ans`, `aviso_ressarcimento_sus`, `declaracao_servicos_medicos` |
| 19 | Contabilidade regulatória da operadora: provisões técnicas, plano de contas padrão da ANS para o balancete, livros auxiliares; atos cooperativos e escrituração fiscal da operadora | 59 tab / 2 com dados. DBAPS `CONFIG_CONTA*`, `CONSOLIDA_*`, `LIVRO_*`, `MVSAUDE_*`, `PROVISIONAMENTO_CONTAS`, `GERACAO_PROVISAO_RISCO_MVS`, `SPED_*`, `IVA*`, `TIMBRE*`, `ACIONISTAS_OPERADORA`, `ATIVOS_*` | Não tem | M56.7: o envio econômico-financeiro usa o balancete do contábil (M45); não há provisão técnica | **F7** (só provisões e mapa de contas): sem eles o balancete enviado à ANS não fecha. Atos cooperativos e escrituração própria não entram | `provisao_tecnica_competencia`, `mapa_conta_balancete_ans` |
| 20 | Atendimento ao beneficiário: protocolo com número da ANS, atendimento, ouvidoria e reclamação via ANS, prazos de resposta, central de atendimento com fases e acordo de nível de serviço | 40 tab / 15 com dados. DBAPS `ATEND_CALL_CENTER*`, `CALL_CENTER_*`, `TIP_*`, `MOT_*`, `SLA`, `CLASSIFICACAO_OCORRENCIA_GUIA`, `FASES_SAC`, `CHAT*`, `FAQ_GRUPO`, `CARTAS` | `SPORIGEM_ATEND` (6), `SPVINCULOTITULAR` (8), `SPMOTLIG` (1) | M56.8: `atendimento.ts`, bloco na tela `/operadora/autorizacoes` | **F7**: protocolo e prazos de resposta são regulados | `protocolo_beneficiario`, `andamento_protocolo`, `demanda_reclamacao_ans`, `resposta_conclusiva_protocolo` |
| 21 | Portal do prestador credenciado: pedido de autorização pela web, envio de arquivos, consulta de protocolo, pedido de cadastro e alteração do próprio prestador | 21 tab / 3 com dados. DBAPS `AUTWEB_*` (10), `SOLICITACAO_WEB_PREST*` (6), `PORTAL_TIPO_XML`, `PORTAL_CONFIG_VALIDA_XML`, `PORTAL_DOCUMENTO`, `PORTAL_LOGIN_TOKEN`, `PORTAL_TOKEN_SENHA` | Faturamento: `PFPORTALOPCAO` (8), `PFTPATEND` (5); logins do portal com 0 linhas | M56.8: `/prestador/*` (identidade própria, Argon2id e TOTP; pedido, cancelamento, consulta), contas em `/operadora/portal-prestador` | **F7**: é por onde a rede pede autorização e manda conta; sem ele, tudo vira papel | `conta_portal_prestador`, `permissao_portal_prestador`, `pedido_web_prestador`, `arquivo_enviado_prestador` |
| 22 | Portal do beneficiário e da empresa contratante, portal do corretor e mensagens eletrônicas: segunda via, cartão digital, pedido de reembolso, reativação, exclusão em lote, SMS | 18 tab / 3 com dados. DBAPS `PORTAL_CONFIG`, `PORTAL_CONFIG_CORRETOR`, `PORTAL_CONFIG_VENDA_DIA_VENC`, `SOLICITACAO_WEB*`, `SW_*`, `SMS_*`, `CANAL_MSG_RADAR`, `FORMA_ACESSO_RADAR_TISS` | Não tem | Não tem (as mensagens ao beneficiário estão desligadas até a DP-44 a) | **F8**: valor alto para a operadora, mas pode esperar; as mensagens vão pela plataforma Hal-AI | — |
| 23 | Programas de promoção da saúde e gestão de crônicos: grupos de risco, elegíveis, agenda de visitas, questionários e custo do crônico | 32 tab / 2 com dados. DBAPS `PROGRAMA*`, `ITPROGRAMA*`, `GRUPO_CONTROLE_CRONICO*`, `HISTORICO_ATENDIMENTO_CRONICO`, `PATOLOGIA*`, `AGENDA*`, `RATEIO*` | Não tem | Não tem | **F8**: reduz sinistralidade e dá desconto regulado; exige a operadora já rodando | — |
| 24 | Importação de dados de outros sistemas e adaptações para clientes específicos (órgãos públicos, guias de recolhimento, folhas de clientes) | 142 tab / 3 com dados. DBAPS `IMP_*` (78), `MVS_IMP_*`, `LAYOUT_*`, `POLIMED_*`, `LIDER_*`, `EMP_*`, `MVS_GR*`, `B_*`, `FA_PS_*`, `DI_PS_*` | Não tem | O conector e a carga do new-sgh cobrem a migração | **NAO**: ferramenta e customização do fornecedor | — |
| 25 | Logs, lotes de processamento, auditoria de tabelas, consultas dinâmicas e utilitários | 195 tab / 10 com dados. DBAPS `LOG_*` (101), `ITLOG_*`, `BATCH_*`, `ERRO_*`, `SEQ_*`, `AUDIT_TABELAS`, `QUERY_DINAMICA`, `CG_REF_CODES` | Não tem | Trilha de auditoria e observabilidade comuns (grupo 01) | **NAO**: técnico do fornecedor | — |

### Integrações, interoperabilidade e portais (INTG)

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 26 | Motor de integração: catálogo de sistemas externos, pontos de entrada e saída, credenciais, filas com retentativa e ordem, de-para de códigos, monitor de falhas e destinatários do erro | 47 tab / 6 com dados. MVINTEGRA (34): `CONFIG_MVINTEGRA`, `SISTEMA_TERCEIRO`, `PROCESSO_INTEGRACAO`, `IMV_CONFIGURACAO_*`, `IMV_MENSAGEM_SAIDA_*`, `DEPARA`, `ERRO_PROCESSO`, `JOB_INTEGRACAO`; DBAMV (13): `SISTEMA_INTEGRADO`, `PW_INTEGRACAO`, `PW_SISTEMA_INTEGRADO`, `PW_DE_PARA_*`, `XML_SCHEMA`, `XML_TAG`, `XML_VERSAO` | `TBIDENTIFICACAOENDPOINT` (57), `TBENDPOINTURI` (30), `TBENDPOINT` (2), `TBOPERSCHEMA` (3), `TBTPWEBSERV` (2); configuração em uso | M34: `dominio-integracao` (`retentativa`, `idempotencia`), fila de saída na API (`integracao/infra`), telas Endpoints e Monitor de integrações | **F3**: toda integração da Rede Santé passa por aqui | `sistema_externo`, `ponto_integracao`, `credencial_integracao`, `mensagem_saida`, `mensagem_entrada`, `tentativa_entrega`, `mapeamento_codigo_externo`, `falha_integracao` |
| 27 | Eventos publicados a terceiros: cadastro de pessoa, atendimento, agenda, internação e leito, evolução, prescrição, sinais vitais, unificação de paciente | 37 tab / 0 com dados. MVINTEGRA `INTEGRA_ENTRADA_*`, `INTEGRA_SAIDA_*` (atendimento, agendamento, internação, evolução, leitos), `IMV_ATENDIMENTO`, `IMV_LEITO`, `IMV_PRESCRICAO`, `IMV_COLETA_SINAL_VITAL`, `IMV_UNIFICA_PACIENTE` | `TBSGHINTEGRADOR_PARAM` (1), `TBSGHINTEGRADOR_TABELA` (3: paciente, internação, atendimento); `INTEGRA_BI` (573, descartar) | M34: fatos de domínio na fila de saída; mapeadores FHIR; pacotes aos parceiros | **F3**: o integrador do SPDATA replica paciente, internação e atendimento para terceiros | `tipo_evento_publicado`, `assinatura_evento_parceiro` |
| 28 | Mensageria HL7 v2: canais, eventos, segmentos e mapeamento por parceiro, confirmação de recebimento | 14 tab / 0 com dados. MVINTEGRA `HL7_*` (10), `AGFA_ADT`, `AGFA_ORM_IN`, `AGFA_ORU`, `AGFA_DFT` | Filas de admissão vazias; interfaces em `SITPEQV` (20, linha 29) | M34: `hl7/mensagem`, `hl7/canais` (MLLP e ACK), tela Motor HL7 | **F3**: laboratório de apoio e classificação externa falam HL7 | `canal_hl7`, `perfil_mensagem_hl7` |
| 29 | Laboratório de apoio e interfaces de equipamento: catálogo de exames do laboratório, de-para de elementos e materiais, pedido, retorno estruturado, etiqueta de amostra | 17 tab / 1 com dados. MVINTEGRA `CONFIG_INTERFACE_LIS`, `IMV_AMOSTRA`, `IMV_CONTROLE_AMOSTRA`, `IMV_RESULTADO_PSSD`, `IMV_SOLICITACAO_SADT`, `INTEGRA_SAIDA_EXAMES`; DBAMV `AMOSTRA_INTERFACE`, `IMV_INTEGRA_EQUIPAMENTO`, `LIS_EXA`, `ETIQUETA_AMOSTRA_LAB_APOIO` | `SITBEXHP` (1.000+), `SITBELHP` (1.000+), `SIMATHP` (321), `SITPEQV` (20, com senhas de FTP), `SITPEQVMODELO` (4), `SITPEQV_SITPEQVMODELO` (6), `SITBEXEQ` (2), `SIWSETIQUETA` (72), `SIWSLANCETQTA` (128); uso alto | M34: `apoio.ts` (retorno estruturado, conferência pelo responsável técnico), telas Laboratório de apoio e Interfaces de equipamento | **F3**: uso diário; sem isso o laboratório para | `interface_equipamento`, `modelo_comunicacao_interface`, `laboratorio_apoio`, `exame_apoio_catalogo`, `mapa_elemento_exame_apoio`, `mapa_material_apoio`, `pedido_apoio`, `resultado_apoio_recebido`, `layout_etiqueta_apoio` |
| 30 | Imagem: lista de trabalho DICOM, status da execução e retorno de laudo de sistema externo de imagem | 2 tab / 0 com dados. DBAMV `IMVMICRODATA_RETORNO`, `ITPED_RX_MICRODATA_SITUACAO` (as mensagens do PACS estão na linha 28) | SADT: `SIPACSMODALID` (81), `SIPACSVISIMG` (2) | M47.3: lista de trabalho com número de acesso único pela fila de saída e status recebido | **F3**: as modalidades estão cadastradas e em uso | `modalidade_imagem`, `item_lista_trabalho_imagem`, `status_execucao_imagem`, `visualizador_imagem` |
| 31 | Troca eletrônica com as operadoras, lado do prestador: elegibilidade, autorização, envio de lote, situação do protocolo, cancelamento, demonstrativos e recurso por webservice, credenciais por convênio | 72 tab / 3 com dados. DBAMV `AUTORIZADOR*` (14), `ELEGIBILIDADE_PACIENTE`, `SITE_INTEGRA_CONVENIO`, `CONVENIO_INTEGRA_SOL_GUIA`, `INTEGRA_TISS_*`, `TISS_RETORNO_*` (41), `TISS_SOLICITA_STATUS_AUTORIZ`, `DEMONSTRATIVO_RETORNO_*`; MVINTEGRA `IMV_AUTORIZADOR`, `IMV_AUTORIZADOR_TISS`, `IMV_PRODUTO_ANS` | `TBTISSSCHEMA` (25), `TBTISSURLWSSGH` (11), `TBTISSWEBSERV` (2, com credencial), `TBCODATI` (14, login de portal por convênio), `TBTISS` (76 parâmetros por convênio) | M31: webservices por operadora no `tiss.controller` (parcial na árvore); remessa, protocolo e glosa construídos | **F3**: o faturamento da Rede Santé usa; fronteira com o grupo de faturamento | `transacao_tiss`, `servico_tiss_convenio`, `credencial_convenio`, `troca_tiss_prestador`, `consulta_elegibilidade_convenio` |
| 32 | Regulação estadual de leitos e consultas: serviços (bloqueio, internação, transferência), tabelas de códigos exigidas e solicitação ao regulador | 3 tab / 0 com dados. MVINTEGRA `LOG_ERROS_JOBS_GSH`, `IMV_LAUDO_AIH`; DBAMV `INTEGRA_SOLICITACAO_AGENDMTO` | `TBREGUL_SERVICO` (42), `TBREGUL_VLR_TABELAS` (253), `TBREGUL_TABELAS` (20), `TBREGUL_ENDPOINT` (3), `TBREGUL_SISTEMA` (2) | M44.3: regulação com o número digitado; conector desligado (DP-29); tela `/internacao/nir/regulacao` | **F3**: está configurada no SPDATA e o hospital recebe pacientes regulados | `sistema_regulacao`, `servico_regulacao`, `tabela_codigo_regulacao`, `valor_codigo_regulacao`, `solicitacao_regulacao_externa` |
| 33 | Rede Nacional de Dados em Saúde: registro de vacina aplicada, sumário e resultados em FHIR, identificação por CPF e CNS, consulta de cartão nacional, repositório e assinantes | 3 tab / 0 com dados. DBAMV `CNS_CADSUS`, `PW_ASSINANTE`, `PW_TIPO_REPOSITORIO` | `TBDIGITAL_INTEG_TYPE` (60), `TBDIGITAL_INTEG_FIELD` (191, fila vazia), `TBDIGITAL_ESPECIALIDADE` (113), `TBTPDOCUMENTO_PIXPDQ` (6), `TBSEXO_PIXPDQ` (3) | M34 e W0-03: `rnds.ts`, `ria.ts`, `fhir/perfis` (BR Core), `fhir/ips`; tela FHIR/RNDS; envio real só com credenciamento | **F7**: obrigação nacional crescente; a fila do SPDATA nunca enviou | `envio_rnds`, `versao_documento_rnds`, `identificador_paciente_externo`, `perfil_fhir_fixado` |
| 34 | Webservices e arquivos do SUS: rastreamento de câncer, cadastro de prestador, tabela de procedimentos, metadados dos arquivos de produção | 8 tab / 0 com dados. DBAMV `PROTOCOLO_SISCAN`, `RESPOSTA_SISCAN`, `PRESTADOR_DATASUS`, `SIGTAP_SUS`; MVINTEGRA `DATASUS_*` (4) | Módulo SUS (fora deste grupo) | Módulo `sus` da API (outro grupo) | **F7**: exigência para hospital que atende o SUS; fronteira com o grupo SUS | `envio_webservice_sus`, `retorno_webservice_sus` |
| 35 | Prescrição digital por plataforma externa: envio do documento e retorno da receita validável | Nenhuma no recorte | `PRCABNEXODATA` (1), `PRLANCNEXODATA` (1); só um teste de 2022 | Tela Prescrição digital (parcial) | **F8**: nunca usada; a assinatura própria (grupo 01) já cobre a receita válida | — |
| 36 | Comunicação com o paciente por plataforma de mensagens: confirmação, lembrete e aviso, com o retorno de entrega | 2 tab / 0 com dados. MVINTEGRA `IMV_MENSAGEM_SMS`, `IMV_CONFIG_ALERTA_EMAIL` | `TBSMSTPAGENDA` (4), `TBSMSTPERRO` (6), `TBSMSTPRETMSG` (4) | M34: `sem-canal-proprio.ts` (DP-44 b), tela Mensagens ao paciente; envio pela plataforma Hal-AI | **F3**: a confirmação de agenda já existe; sem canal próprio | `pedido_mensagem_paciente`, `retorno_mensagem_paciente`, `modelo_mensagem_paciente` |
| 37 | Parceiros que leem dados e exportações agendadas: índices de UTI, BI do faturamento, exportação de custos para bases externas | Nenhuma no recorte (o BI é do grupo 01) | `CTWGRUPOEXPORTACAO` (3: próprio e duas bases externas de custo); visões lidas por parceiros | M34: `pacotes-parceiros.ts` (API do parceiro, arquivo agendado ou consulta), tela Parceiros | **F3**: parceiros leem hoje e não podem parar na virada | `parceiro_dados`, `pacote_parceiro`, `entrega_pacote_parceiro`, `finalidade_compartilhamento` |
| 38 | API de integração para a plataforma Hal-AI: operações por escopo, escrita em dois tempos, registro de chamadas | Nenhuma no recorte | Não tem (o serviço externo atual lê o Firebird direto) | M58.4: fachada `/api/fachada/sante-api/pc/…`, contrato 0.23.0 com 78 operações; `dominio-integracao/fachada` | **F3**: a comunicação com o paciente depende dela no dia 1 | `cliente_api`, `escopo_cliente_api`, `chave_api`, `chamada_api_registro`, `proposta_escrita_api` |
| 39 | Integração com ERP corporativo: contas a pagar e a receber, estoque, compras, contabilidade e faturamento exportados ou importados por fila | 66 tab / 0 com dados. MVINTEGRA `INTEGRA_*` financeiro, contábil, compras, materiais e movimentos (44), `IMV_CONTABIL`, `IMV_FINANCEIRO`, `IMV_DATASUL_*`; DBAMV `IMVSAP_*` (10), `IMVAPP_*` (7), `INTEGRA_C_*`, `INTEGRA_FF*` | Não tem (contabilidade e financeiro são internos) | Exportação contábil ao sistema atual (financeiro, parcial); fachada para o resto | **F8**: comum em grupos hospitalares com ERP; a Rede Santé não precisa | — |
| 40 | Cotação eletrônica e portais de compras, inclusive OPME: vínculo do pedido ao portal, cotação, resposta e confirmação | 54 tab / 0 com dados. MVINTEGRA `INTEGRA_BNEXO_*` (17), `INTEGRA_ONEXO_*` (21); DBAMV `OPMENEXO_*` (15), `CNDC_PGMNT_BIONEXO`, `PRODUTOS_NOVOS_OPME` | `GEINTAPOIOCOT` (225), `GEPORTALCOMPRAS` (3 portais) | M28: cotação com vencedor; vínculo com o portal migrado | **F3** (vínculo do pedido): está em uso. A troca completa de arquivos com o portal fica para depois. Fronteira com suprimentos | `portal_cotacao`, `vinculo_pedido_portal` |
| 41 | Portal de resultados para o paciente e o médico externo: setores publicados, perfis, imagens, leiaute do laudo na web, registro de quem viu | 2 tab / 1 com dados. DBAMV `PLAUDOS_CONFIGURACOES`, `PLAUDOS_LOG_EXCLUSAO` | SADT: `SIWEBCADPERFIL_SIPACSMODALID` (43), `SIMODULO_SIWEBATOS` (8), `SIWEBPARLAUDO` (7), `SIWEBPARDATA` (5), `SIWEBVISULIMG` (5), `SIWEBPARTPATU` (3), `SIWEBCADPERFIL` (1), `SILIBERACAOEXAME` (1.000+) | M50.1: conta do paciente com segundo fator, resultados liberados e documentos assinados; relatório de quem acessou | **F3**: em uso, com auditoria de acesso | `conta_portal_paciente`, `perfil_portal_resultado`, `setor_publicado_portal`, `liberacao_resultado_portal`, `acesso_resultado_registro` |
| 42 | Portal do médico externo e solicitante: autocadastro conferido pelo hospital, extrato de produção, agenda cirúrgica e pedido de cirurgia | Nenhuma no recorte (os usuários de portal estão no grupo 01) | `TBMEDSOLWEBCAD` (5) | M50.3: conta ligada ao profissional por uma pessoa do hospital, extrato e pedido de cirurgia | **F3**: o autocadastro existe e o extrato substitui pedidos por e-mail | `conta_portal_medico`, `pedido_vinculo_medico_externo` |
| 43 | Classificação de risco externa: perfis de prioridade enviados ao sistema de triagem e a classificação recebida | Nenhuma no recorte | `RETPPROTOLIFE` (6: gestante, cadeirante e outros) | M34: tela Classificação externa | **F3**: configurada e em uso no pronto atendimento | `perfil_prioridade_externa`, `classificacao_externa_recebida` |
| 44 | Catraca de portaria ligada ao crachá do visitante e do colaborador | 1 tab / 0 com dados. MVINTEGRA `INTEGRA_CRACHA` | Não tem | M50.5: crachá com validade e ZPL, sem catraca | **F8**: útil, depende do equipamento de cada hospital | — |
| 45 | Tarifador telefônico e central telefônica | 2 tab / 0 com dados. MVINTEGRA `IMV_TARIFADOR`, `INTEGRA_ENTRADA_TARIFADOR` | Não tem | Não tem | **NAO**: fora do sistema hospitalar | — |
| 46 | Leiaute posicional de importação da base de CEP | Nenhuma no recorte (a base de CEP da operadora está na linha 3) | `TBCEPPARAMCAB` (4), `TBCEPPARAMPOS` (16) | Leiaute de importação na árvore | **NAO**: a base de CEP vira carga de referência do cadastro, sem leiaute configurável | — |
| 47 | Arquivo de integração da quimioterapia | Nenhuma no recorte | `PRCABEARQINTEGRAQT` (1, só configuração) | Não encontrado | **NAO**: nenhum envio registrado; reabrir se a oncologia pedir | — |
| 48 | Configuração técnica do fornecedor: endereços de serviços internos, credencial de banco externo usada por gatilho | Nenhuma no recorte | `TBENDPOINTINTERNALSERVICE` (39), `TBINFBANCO` (2, descartar) | Configuração da aplicação e cofre | **NAO**: técnico; credencial vai para o cofre, nunca para tabela | — |

## Recursos novos do MV que valem a pena

Em ordem de valor. Nenhum deles atrasa a virada da Rede Santé.

1. **Reembolso completo ao beneficiário** (linha 14, F7). O MV tem o pedido com anexos e uma tabela de referência por
   município. Tem também a glosa por item e o pagamento. O new-sgh só registra o reembolso como natureza de protocolo.
   É o recurso de operadora que mais falta e é exigência da ANS.
2. **Portal do beneficiário e da empresa contratante** (linha 22, F8). Segunda via e cartão digital, pedido de
   reembolso, reativação e exclusão em lote pela empresa. Tira trabalho da central de atendimento. As mensagens saem
   pela plataforma Hal-AI.
3. **Programas de promoção da saúde e gestão de crônicos** (linha 23, F8). Grupos de risco, elegíveis e agenda de
   visitas, com o custo do crônico apurado. Reduz a sinistralidade e entra no incentivo regulado da ANS.
4. **Comercial com proposta digital, corretores e comissão** (linha 8, F8). Inclui o estorno da comissão quando o
   beneficiário sai cedo e as campanhas com desconto por parcela.
5. **Motor de integração configurável por ponto de saída** (linha 26, F3 no núcleo). Do MV vale copiar a ideia, não o
   desenho:
   - cada sistema externo tem os seus pontos de saída;
   - cada ponto tem os tipos de documento, os filtros e os destinatários próprios para o erro.

   No nosso modelo isso cabe em `ponto_integracao` e `falha_integracao`, sem gatilho.
6. **Troca completa com portais de cotação e de OPME** (linha 40). Cotação, resposta, confirmação, lotes e campos
   extras por item. Hoje a Rede Santé só liga o pedido ao portal.
7. **Integração com ERP corporativo por fila** (linha 39, F8). Exporta e importa contas a pagar e a receber, estoque e
   lançamentos contábeis. Pesa na venda a grupos hospitalares que já têm ERP.
8. **Retorno estruturado do laudo de imagem de terceiros** (linha 30). O laudo volta para o pedido com a situação,
   ligado à lista de trabalho DICOM que o new-sgh já tem.

Recursos do MV que **não** valem a pena:
- as ações automáticas configuráveis no banco (linha 12), porque contrariam a premissa de regra no código;
- o intercâmbio do sistema cooperativo (linha 17);
- as cerca de 340 tabelas de importação, adaptações para clientes e logs (linhas 24 e 25).

## Lacunas do new-sgh frente ao SPDATA

O que o SPDATA tem, no grupo, e o new-sgh ainda não implementou por inteiro:

1. **Webservice TISS por convênio** (linha 31). O SPDATA tem o catálogo de transações, o endereço por transação e a
   credencial por convênio. No new-sgh a parte está marcada como parcial. Falta confirmar, convênio a convênio, que
   elegibilidade, autorização, lote, situação do protocolo e cancelamento saem e voltam pelo serviço. As credenciais do
   SPDATA estão em claro e vão para o cofre.
2. **Conector da regulação estadual** (linha 32). São 42 serviços e 253 valores de tabela configurados. O new-sgh só
   registra o número digitado à mão, e o conector está desligado até a DP-29.
3. **Envio real à RNDS** (linha 33). O mapeamento e os perfis estão prontos. O envio depende do credenciamento com o
   certificado do estabelecimento. A fila do SPDATA também nunca enviou, então isso não bloqueia a paridade.
4. **HL7 v2 e interfaces de equipamento** (linhas 28 e 29). As duas estão marcadas como parciais na árvore. A troca da
   interface em uso para o conector novo é feita por estabelecimento, de forma reversível. Cada uma precisa ser
   homologada com o parceiro antes da virada.
5. **Confirmações por mensagem** (linha 36). Os domínios de status e de erro do envio existem. O envio depende das APIs
   da plataforma Hal-AI, sem canal próprio por decisão do dono.
6. **Prescrição digital externa** (linha 35). Está parcial no new-sgh, mas o SPDATA só tem um teste.
7. **Arquivo de integração da quimioterapia** (linha 47). Não foi encontrado no new-sgh. Tem uma linha de
   configuração e nenhum envio.
8. **Exportação no leiaute de um convênio estadual.** O domínio dos tipos de prestador desse leiaute foi migrado, mas o
   arquivo não foi construído. É um item do faturamento por convênio que o SPDATA guarda no menu da operadora.
9. **Operadora:**
   - boleto e retorno bancário bloqueados (D-BOLETO-56);
   - envio de cobrança por e-mail desligado (DP-44 a);
   - reembolso só como natureza de protocolo (linha 14);
   - venda e comissão só com os domínios (linha 8).

   Nada disso pesa na virada, porque o módulo nunca foi usado.

## Conta das entidades propostas

Operadora, linha a linha:

| Linha | Entidades |
|---|---|
| 1 | 4 |
| 2 | 7 |
| 3 | 9 |
| 4 | 5 |
| 5 | 8 |
| 6 | 4 |
| 7 | 4 |
| 9 | 7 |
| 10 | 7 |
| 11 | 8 |
| 13 | 6 |
| 14 | 4 |
| 15 | 4 |
| 16 | 4 |
| 18 | 6 |
| 19 | 2 |
| 20 | 4 |
| 21 | 4 |
| **Total** | **97** |

Integrações, linha a linha:

| Linha | Entidades |
|---|---|
| 26 | 8 |
| 27 | 2 |
| 28 | 2 |
| 29 | 9 |
| 30 | 4 |
| 31 | 5 |
| 32 | 5 |
| 33 | 4 |
| 34 | 2 |
| 36 | 3 |
| 37 | 4 |
| 38 | 5 |
| 40 | 2 |
| 41 | 5 |
| 42 | 2 |
| 43 | 2 |
| **Total** | **64** |
