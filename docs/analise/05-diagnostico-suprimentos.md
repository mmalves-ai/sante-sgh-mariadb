# Análise cruzada 05: diagnóstico (SADT) e suprimentos

Grupo: **SADT** (laboratório, imagem, métodos gráficos, agência transfusional) e **SUP** (farmácia,
estoque, compras, OPME, CME). Data: 2026-11-20. Base: ADR 0001 (banco próprio em MariaDB, virada
por conector diferencial).

Fontes lidas (somente leitura):

- MV: `referencias/mv-tabelas.tsv`. As tabelas foram classificadas por esquema, prefixo e descritivo,
  com regras ordenadas e conferência tabela a tabela. Em 11 casos ambíguos foram consultados só os
  metadados de coluna (`dba_tab_columns`). Nenhuma linha de dados foi lida.
- SPDATA: `new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`, módulos SADT (77) e
  SUP (104). Entram também as tabelas do grupo que a matriz põe em outros módulos: INTG (laboratório
  de apoio, interfaces, portais de cotação), CAD e FAT (Brasíndice, princípios ativos, DCB) e AGE
  (agenda de exames).
- new-sgh: pacotes `dominio-sadt` e `dominio-suprimentos` (e a parte de apoio de
  `dominio-integracao`), as rotas de `apps/api/src/modulos/{sadt,exames,farmacia,suprimentos}` e as
  telas de `apps/web/src/modulos/{sadt,farmacia,suprimentos}`. Também `planejamento/ESTADO.md`
  (marcos M26, M28, M29, M34, M41, M46.3, M46.4, M47.1 a M47.3, M48.3, M55.3 e M55.4) e a árvore
  `planejamento/fonte-pdf/arvore-menus.txt` (seções Diagnóstico, Suprimentos e Farmácia clínica).

Convenções:

- "MV n/d": a funcionalidade tem n tabelas do MV, das quais d têm dados na cópia de referência. Os
  exemplos vêm entre parênteses, com `*` quando a tabela tem dados. Como a cópia do MV é de
  referência, "0 com dados" não quer dizer "sem valor": quer dizer que o módulo não estava em uso ali.
- Coluna SPDATA: o volume de linhas da matriz indica o uso real. A matriz para de contar em 1.001,
  então "≥1k" quer dizer uso pleno. "Placeholder" é uma tabela com só a linha padrão ou um registro
  fictício.
- Os nomes de tabela do MV e do SPDATA só aparecem nas colunas de evidência. As entidades próprias
  usam nomes nossos, em snake_case. Um script conferiu as 232 entidades propostas contra todos os
  nomes de tabela do MV (8.867) e do SPDATA (1.503), e nenhuma coincide. Por isso alguns termos
  genéricos ganharam qualificador: `insumo` no lugar de "produto", `empresa_fornecedora`,
  `amostra_biologica`, `laudo_diagnostico` e `inventario_estoque`.
- Nenhuma regra de negócio fica em gatilho. Hoje o SPDATA mantém por gatilho o saldo por local, o
  item da conta gerado pela saída ao paciente e a baixa do lote (D-MOTOR-28 do new-sgh). No modelo
  novo, cada documento de estoque passa por um serviço de domínio (`registrarDocumentoEstoque`) que,
  na mesma transação, grava o documento, o movimento por lote, o saldo e o evento para a conta. O
  saldo é uma projeção, que pode ser recalculada a partir dos movimentos.

## Resumo numérico

| Item | SADT | SUP | Total |
|---|---:|---:|---:|
| Tabelas MV classificadas no grupo | 329 | 689 | 1.018 |
| ... com dados na cópia de referência | 71 | 106 | 177 |
| Funcionalidades (linhas da tabela) | 26 | 33 | 59 |
| Decisão F3 (paridade) | 17 | 19 | 36 |
| Decisão F7 (hospital do zero) | 3 | 7 | 10 |
| Decisão F8 (recurso novo) | 5 | 4 | 9 |
| Decisão NAO | 1 | 3 | 4 |
| Entidades próprias propostas (F3 e F7) | 96 | 136 | 232 |
| Tabelas SPDATA do grupo (módulos SADT + SUP) | 77 | 104 | 181 |

Distribuição das 1.018 tabelas MV por esquema:

| Esquema | Tabelas |
|---|---:|
| DBAMV | 876 |
| MVINTEGRA | 70 |
| MVCONT | 52 |
| DBADW | 20 |

Os 52 do MVCONT repetem a gestão de contratos que já está no DBAMV, num segundo esquema.

Fora do grupo ficaram 828 tabelas que o filtro por palavra trouxe, mas que são de outros grupos. A
prescrição e as alertas de exame na prescrição são do PEP. Laudos AIH/APAC/BPA, SISMAMA e SIH são do
faturamento SUS. Patrimônio, rouparia, lactário e cardápio são da hotelaria e do apoio. Caixa, notas
fiscais de saída e saldos contábeis são do financeiro. Equipe médica é de cadastros e repasse, e
pacotes de cobrança são do faturamento. O editor genérico de documentos (39 tabelas) é do PEP e do
documento. A agenda de exames propriamente dita está na análise 02 (agenda). Aqui fica só a escala
do executante.

Prefixos/famílias MV cobertos: `EXA_LAB`, `EXA_RX`, `SET_EXA`, `PED_LAB`, `PED_RX`, `ITPED_`,
`RES_EXA`, `VAL_EXA`, `VAL_REFERENCIA`, `AMOSTRA`, `SUB_AMOSTRA`, `POSTO_COLETA`, `TUBO_COLETA`,
`BANCADA`, `MODELO_MAPA_TRABALHO`, `RACK`, `SOROTECA`, `CULTURA`, `GERME`, `ANTIMICROB`, `LAUDO_RX`,
`IT_LAUDO`, `TEX_RX`, `LAUDO_MAMOGRAFIA`, `ENTREGA_EXA`, `PLAUDOS`, `BLOQUEIO_EXAME`,
`RESTRICAO_EXAME`, `COTA_EXA`, `DILIGENC`, `ENSAIO`/`PRODUTO_ANALISE`, `SANGUE`, `SOLIC_SANGUE`,
`PRODUTO`, `ESPECIE`, `CLASSE`, `SUB_CLAS`, `UNI_PRO`, `LAB_PRO`, `LABORATOR`, `ESTOQUE`,
`MVTO_ESTOQUE`, `ITMVTO_ESTOQUE`, `SOLSAI_PRO`, `ITSOLSAI_PRO`, `REQUISICAO_PRODUTO`, `ENT_PRO`,
`ITENT_PRO`, `SOL_COM`, `ITSOL_COM`, `COLETA` (coleta de preços), `COTADOR`, `ORD_COM`, `ITORD_PRO`,
`FORNECEDOR`, `LOTE`, `ETIQUETA`, `IDENTIFICADOR_ETIQUETA`, `CONTAGEM`, `INVENTARIO`, `KIT_ESTOQUE`,
`ITMVTO_KITS`, `FRACIONAMENTO`, `UNITARIZACAO`, `MANIPULA`, `ORDEM_PRODUCAO`, `CONSIG`, `OPMENEXO`,
`OPME`, `LICITACAO`, `PREGAO`, `EMPENHO`, `REGISTRO_PRECO`, `GCTO`, `BRASIND`, `SIMPRO`, `CME`,
`ESTERILIZACAO`, `CX_KIT`, `ENDERECO_NIVEL`, `ENDERECAMENTO`, `COTA_RESSUPRIMENTO`,
`INDICE_COBERTURA`, `PW_AVALIACAO_ITPRE_MED`, `PW_TIPO_INTERVENCAO`, `INTEGRA_BNEXO`,
`INTEGRA_ONEXO`, `IMV_`/`IMVAPP_`, `DI_`/`FA_` (DBADW) e `SCCOM`.

## Matriz de cobertura

### Diagnóstico (SADT)

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Catálogo de exames laboratoriais: exame, material biológico, recipiente, método, setor executante, orientações de preparo e procedimento operacional | MV 35/12 (EXA_LAB*, EXA_LAB_MATERIAL*, SET_EXA*, TUBO_COLETA*, MATERIAL*, ORIENTACAO_EXAME, POP) | SITABPRO ≥1k, SIMETODO 116, SIMATERI 20, SIESPEC 19, SIRECIPI 15, SIMODULO 8, SICOLETE 4: uso pleno | Feito: catálogo no M13 (Cadastros), `GET sadt/exames`, `ExamesSadtTela`; M26 aguardando validação | F3: base de todo o SADT, em uso diário | exame, setor_diagnostico, exame_setor_executante, material_biologico, recipiente_coleta, metodo_analitico, orientacao_preparo, exame_equivalencia_codigo |
| Catálogo de exames de imagem e métodos gráficos: modalidade, lateralidade, especialidade, exame secundário | MV 7/3 (EXA_RX*, ESPECIALID_EXA_RX*, EXA_RX_LATERALIDADE, FORMULA_EXAME_IMAGEM) | SITABPRO (catálogo único), SIPACSMODALID 81, SIPARRX 934: uso pleno | Feito: catálogo único com o laboratório; modalidades no M47.3 | F3: radiologia, tomografia e ultrassom em uso | modalidade_imagem, exame_lateralidade (as demais no catálogo único acima) |
| Analitos, campos de resultado, faixas de referência versionadas, fórmulas, respostas e textos padrão | MV 24/6 (VAL_EXA*, VAL_REFERENCIA*, FORMULA_EXAME_LABORATORIAL, RESPOSTA*, LIS_EXA*, MENSAGEM_PADRAO) | SITABELE 407, SIHISTVLREFEXAME ≥1k, SIHISTVLREF 659, SIHISTVLREFELEMENTO 354, SIRESPAD 214, SIPOSRES 92, SIOBSERV 47, SIVARFORMULA 19, SICTRPSR 17, SIFORMUL 10: uso pleno | Feito: `dominio-sadt/referencia` (faixa congelada pelo dia, sexo e idade), digitação com fórmula (M26 `parametrizado-formula`) | F3: o laudo emitido precisa preservar a faixa da época | analito, exame_analito, faixa_referencia, faixa_referencia_versao, formula_calculo, variavel_formula, grupo_resposta, resposta_padrao, texto_padrao_resultado, modelo_resultado |
| Requisição de exames: atendimento de diagnóstico, itens solicitados, kits/baterias e trilha de exclusão | MV 20/7 (PED_LAB*, ITPED_LAB*, PED_RX*, ITPED_RX*, AGRUPAMENTO_EXAME, LOG_EXC_PED_LAB*) | SICADATE ≥1k, SILANEXA ≥1k (~1,96 mi), SIKITITE ≥1k, SIKITHISTITE ≥1k, SIKITHISTEXA 203, SIKITEXA 77, SICADATE_EXCLUSAO 3: núcleo do SADT | Feito: `sadt/requisicoes`, `sadt/exames/lancar`, `AtendimentosSadtTela`, estados em `dominio-sadt/exame/estados` | F3: núcleo do diagnóstico | requisicao_exame, item_exame, item_exame_evento, kit_exame, kit_exame_versao, kit_exame_item |
| Restrições clínicas de solicitação: sexo, idade, material, horário e setor | MV 9/0 (BLOQUEIO_EXAME, BLOQUEIO_EXAME_MATERIAL, RESTRICAO_EXAME_MATERIAL, RESTRICAO_HORARIO, EXCECAO_SOLICITACAO_EXA_LAB) | HTNOTEXAMESEXO 754: em uso, só para sexo | Feito: `dominio-sadt/exame/restricoes` | F3: já em uso para sexo; a regra fica no domínio, com teste | restricao_exame, excecao_restricao_exame |
| Cotas e bloqueios por convênio, unidade ou último resultado; repetição proibida no mesmo dia | MV 10/0 (COTA_EXA_LAB, COTA_EXA_RX, COTA_EXA_UNID, BLOQUEIO_EXAME_CONVENIO, BLOQUEIO_EXAME_ULT_RESULT, EXA_RX_PROIB_MESMO_DIA, EXAME_PROTOCOLO) | Não tem | Não tem | F8: reduz glosa e exame repetido; pode esperar | — |
| Coleta e amostra: código da amostra, etiqueta, posto de coleta, recoleta com motivo, rastreio de passagens e sub-amostras | MV 29/11 (AMOSTRA*, AMOSTRA_EXA_LAB*, POSTO_COLETA*, MOTIVO_RECOLETA*, RECEPCAO_AMOSTRA*, REGRA_GERACAO_SUB_AMOSTRA, ETIQUETA_PSSD*) | SISTATUS_AMOSTRA 8, SIWSETIQUETA 72, SIWSLANCETQTA 128 (só 2023-24): uso parcial | Feito: `dominio-sadt/amostra/rastreio` (código com dígito, passagens válidas), `ColetaTela`, `AmostrasTela`, tabelas próprias do M26 | F3: coleta e etiqueta em uso; o rastreio novo já está desenhado | amostra_biologica, amostra_biologica_evento, ponto_coleta, motivo_nova_coleta, modelo_etiqueta_amostra_biologica |
| Mapa de trabalho e bancadas: distribuição dos exames por bancada, lote de trabalho, exames retidos | MV 8/1 (MODELO_MAPA_TRABALHO, BANCADA*, LOTE_BANCADA, LOTE_TRABALHO, MOVIMENTACAO_STANDBY_EXAME) | Sem tabela própria: sai do lançamento (SILANEXA) por setor (SIESPEC) | Feito: `GET sadt/mapa-trabalho` | F3: a bancada usa o mapa impresso hoje | modelo_mapa_bancada, modelo_mapa_bancada_exame, bancada_analitica |
| Soroteca, racks e expurgo de amostras armazenadas | MV 12/0 (SOROTECA_ACERVO, SOROTECA_CONGELADOR, SOROTECA_REGRA_EXP_RES, RACK_AMOSTRA) | Não tem | Não tem | F8: guarda e descarte rastreados; valor real, sem urgência | — |
| Resultado, conferência e liberação do laboratório: digitação/importação, observação, valor crítico com aviso, atraso, assinatura | MV 16/3 (RES_EXA*, LOG_RES_EXA*, NOTIFICACAO_ATRASO_LAB, ASSINATURA_DIGITAL_DIAGN, FILA_CARTORIO_DIGITAL, B_LABORA*) | SIRES01 ≥1k, SIRESOBS ≥1k, SIRESVAR ≥1k, SILIBERACAOEXAME ≥1k, SIRES01_DELETE ≥1k: uso pleno | Feito: `DigitacaoTela`, `LiberacaoTela`, `CriticosTela`, `dominio-sadt/critico/escalonamento`, `indicadores/tat`; assinatura ICP no M49 | F3: núcleo do laboratório | resultado_exame, resultado_analito, resultado_observacao, liberacao_exame, regra_valor_critico, aviso_valor_critico, resultado_exame_excluido |
| Autoliberação por regra e checagem de consistência (delta check, curva, substância interferente) | MV 6/0 (REGRA_CONTROLE_RESULTADO, CONDICAO_CONTROLE_RESULTADO, CONFIGURACAO_CURVA, PONTO_CURVA, SUBSTANCIA_INTERFERENCIA_RES) | Não tem | Não tem | F8: produtividade da bancada e segurança; depois da virada | — |
| Microbiologia estruturada: cultura, microrganismo isolado, antibiograma com CIM e interpretação | MV 28/8 (CULTURA*, GERMES*, ANTIMICROB*, ANTIMICROB_MIC*, TIPO_RESULTADO_ANTIMICROB*, ANALISE_CULTURA) | Não tem estrutura: cultura sai como texto do resultado (SIRES01) | Não tem; a CCIH do M48.3 depende disso para IRAS por germe | F7: hospital com CCIH e notificação de resistência precisa do antibiograma estruturado | microrganismo, antimicrobiano, painel_antibiograma, painel_antibiograma_item, resultado_cultura, isolado_microbiano, resultado_sensibilidade |
| Interface com equipamentos de laboratório: cadastro da interface, modelo de comunicação, de-para de exames | MV 14/0 (AMOSTRA_INTERFACE, CONFIG_INTERFACE_LIS, IMV_RESULTADO_PSSD, INTEGRA_SAIDA_SOLICITACAO_SADT) | SITPEQV 20, SITPEQVMODELO 4, SITPEQV_SITPEQVMODELO 6, SITBEXEQ 2 (módulo INTG): 20 interfaces ativas | Parcial: consulta das interfaces (`InterfacesEquipamentoTela`) e de-para no CRUD; o tráfego com o equipamento não está no new-sgh (no legado roda em programa à parte) | F3: os 20 equipamentos precisam continuar entregando resultado no dia da virada | interface_equipamento, modelo_comunicacao, equipamento_analitico, de_para_exame_equipamento, mensagem_equipamento |
| Laboratório de apoio: catálogo do apoio, de-para de exame, analito e material, envio e retorno | MV 8/2 (EXA_LAB_LABORATORIO*, LABORATORIO*, ETIQUETA_AMOSTRA_LAB_APOIO, REMESSA_AMOSTRA, PED_LAB_PRESTADOR_EXTERNO) | SITBEXHP ≥1k, SITBELHP ≥1k, SIMATHP 321 (módulo INTG): uso pleno | Feito: canal HL7 do pedido e do retorno (M34, `dominio-integracao/apoio`), de-para no CRUD | F3: parte dos exames sai para apoio todo dia | laboratorio_apoio, exame_apoio, de_para_analito_apoio, de_para_material_apoio, remessa_apoio, remessa_apoio_item |
| Laboratório analítico de produtos: ensaios, programas de análise, laudos de produto | MV 19/0 (ENSAIO_LABORATORIAL, PRODUTO_ANALISE, PROGRAMA_ANALISE, VERSAO_ENSAIO) | Não tem | Não tem | NAO: é para laboratório de controle de produtos, fora do hospital | — |
| Laudo de imagem e métodos gráficos: redação, modelos, palavras-chave, emissão com código de autenticação | MV 9/3 (LAUDO_RX*, IT_LAUDO_RX_CHAR*, TEX_RX*, PALAVRAS_CHAVE_LAUDO, LAUDO_ARQ) | SIASSLAUDO_IMPRESSAO ≥1k, SIASSLAUDO_IMP_SILANEXA ≥1k, SIRESPAD 214, SIPAROUT 806: uso pleno | Feito: `LaudoEditorTela`, `LaudosEmissaoTela`, `dominio-sadt/laudo/autenticacao`; a emissão (`sadt.emitirLaudo`) está desligada até a numeração (D-LAUDO-26) | F3: laudo emitido e autenticado todo dia | laudo_diagnostico, laudo_diagnostico_versao, modelo_laudo, emissao_laudo, emissao_laudo_exame |
| Laudo estruturado de métodos gráficos e hemodinâmica (ecocardiograma com grandezas, cateterismo) | MV 3/1 (VALOR_REFERENCIA_ECOCARD, CIRURGIA_EXAME_HEMODINAMICA*) | SITBGRAN 39, SIPARHEM 286, SIPAREND ≥1k: em uso (hospital cardiológico) | Feito: grandezas do eco no M26 (`laudo-imagem`) | F3: eco e hemodinâmica são o centro do ProntoCardio | secao_laudo_estruturado, grandeza_laudo, valor_grandeza_laudo |
| Laudo estruturado de mamografia (categoria de achado) e anatomia patológica (cito e histopatológico) | MV 7/1 (LAUDO_MAMOGRAFIA, LAUDO_MAMOGRAFIA_ACHADO_RAD, LAUDO_CITOPATOLOGICO, LAUDO_HISTOPATOLOGICO, GRAU_HISTOPATOLOGICO*) | SIPARANA 1 (parâmetros de anatomia; setor sem uso) | Não tem | F7: hospital geral com rastreio oncológico precisa do laudo estruturado para os sistemas do SUS | laudo_mama, achado_mama, laudo_anatomopatologico, grau_histologico |
| Escala de execução e prioridade: plantões do executante por setor, dias e exames atendidos; prioridade do paciente | MV 12/0 (ESCALA_EXA_RX, ESCALA_DIA_EXA_RX, SESC_DIA, SESCALA_EXA_LAB, PRIORID_PACIENTE_PED_RX) | SICTRAGE 26, SIAGENDA 40, SIPACAGD ≥1k (módulo AGE, ver análise 02) | Feito: agenda de exames no M18 (`exames/*`, desligada até a correção da sante-api, DP-8) | F3: a agenda de exames está em uso; aqui entra só a escala do executante | escala_execucao, escala_execucao_exame, prioridade_atendimento |
| Integração com PACS/RIS: lista de trabalho DICOM, número de acesso, status do exame, visualizador, laudo externo | MV 6/1 (MODALIDADE_EXAME*, ITPED_RX_MICRODATA_SITUACAO, IMV_LAUDO_PSDI, IMVMICRODATA_RETORNO) | SIPACSMODALID 81, SIPACSVISIMG 2, SIWEBVISULIMG 5, SIWEBCADPERFIL_SIPACSMODALID 43: em uso | Feito: M47.3 (worklist pela outbox, MPPS idempotente, `WorklistDicomTela`); a chave `imagem.worklist` está desligada até o PACS real | F3: as imagens já circulam pelo PACS hoje | item_lista_trabalho_imagem, evento_status_imagem, visualizador_imagem |
| Entrega de resultados e portal de laudos: prazo por setor e exame, protocolo de entrega, impressão, perfis do portal, auditoria de acesso | MV 19/4 (ENTREGA_EXA_LAB_SETOR*, PERIODO_ENTREGA_EXA_LAB*, PLAUDOS_CONFIGURACOES*, EXA_PROIBIDO_WEB*, ORDEM_IMPRESSAO_LAUDO) | SIWEBCADPERFIL 1, SIWEBPARPERFIL 1, SIMODULO_SIWEBATOS 8, SIWEBPARLAUDO 7, SILIBERACAOEXAME ≥1k (auditoria do portal): em uso | Feito: `portal.controller`, `PortalResultadosTela`, portais do M50.1 (paciente) e M50.3 (médico externo) | F3: o portal de resultados é usado por pacientes e médicos | prazo_entrega_exame, entrega_resultado, perfil_portal_resultado, perfil_portal_setor, acesso_portal_resultado |
| Consumo padrão de insumos e equipe por exame (contraste, kit do exame, baixa automática) | MV 4/0 (EXA_RX_FORMULA, ITPED_RX_PRODUTO, ITPED_RX_KIT, ITPED_RX_EQUIPE) | Não tem: o insumo sai do estoque para o paciente (GELANSAI/GELANPAC) | Não tem (a saída ao paciente cobre) | F8: automatiza a baixa e o lançamento na conta; a saída manual cobre a virada | — |
| Agência transfusional: requisição, amostra, imuno-hematologia, prova cruzada, estoque de bolsas, ato transfusional, reação | MV 11/6 (SOLIC_SANGUE*, IT_SOLIC_SANGUE*, SANGUE_DERIVADOS*, SANGUE_AVISO*, INTEGRA_ENT_HEMODERIVADO) | SHBOLSA, SHREQUISICAO, SHDOACAO (placeholders de 1899), SHMOV 10, SHTPTRANSF 4, TBTPSANGUINEO 4: módulo nunca usado | Feito e desligado: M47.1 e M47.2 (`dominio-sadt/transfusao`, `RequisicoesTransfusaoTela`, `ImunoHematologiaTela`, `EstoqueBolsasTela`, `HemovigilanciaTela`) | F7: exigência sanitária para hospital que transfunde; a Rede Santé não usa no sistema | requisicao_transfusao, amostra_pre_transfusional, bolsa_hemocomponente, movimento_bolsa, teste_imuno_hematologico, prova_compatibilidade, ato_transfusional, reacao_transfusional, servico_hemoterapia_fornecedor |
| Busca ativa de resultados: acompanhamento de exames pendentes ou alterados depois da alta, equipe e histórico | MV 11/0 (DILIGENCIAMENTO_DIAGN, EXAME_DILIGENCIA_DIAGN, SOLICITACAO_DILIGENCIA_DIAGN, FAIXA_PANICO_CULTURA_DILIG) | Não tem | Parcial: escalonamento do valor crítico (só durante o atendimento) | F8: segurança do paciente (cultura positiva após a alta); pode esperar | — |
| Parâmetros do diagnóstico por setor: numeração, impressão, responsável pelo laudo, obrigatoriedades | MV 2/2 (CONFIG_SADT*, CONFIG_PSSD*) | SIPARGER 1, SIPARLAB ≥1k, SIPARRX 934, SIPAROUT 806, SIPARHEM 286, SIPARTM, SIPARULT, SIPAREND ≥1k: por usuário, com senha gerencial | Feito: `GET sadt/parametros` | F3: necessário para operar; no modelo novo vira parâmetro por estabelecimento e setor, não por usuário | parametro_diagnostico |
| Orçamento de exames particulares e conversão em atendimento | Sem equivalente identificado no MV (o prefixo `ORCA` é de orçamento empresarial) | SIORCAME ≥1k, SIEXAORC ≥1k: uso pleno | Feito: `dominio-sadt/orcamento/conversao`, `OrcamentosTela` | F3: em uso no balcão do particular | orcamento_exame, orcamento_exame_item |

### Suprimentos (farmácia, estoque, compras, OPME, CME)

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Cadastro de produto (material e medicamento): grupo, subgrupo, unidades e conversão, apresentação comercial, fabricante e registro sanitário, princípio ativo, via, classificação fiscal, estabilidade | MV 27/14 (PRODUTO*, ESPECIE*, CLASSE*, SUB_CLAS*, UNI_PRO*, LAB_PRO*, LABORATOR*, PRODUTO_REGISTRO_ANVISA, PRODUTO_NCM, PRODUTO_ESTABILIDADE*, VIA_ADMINISTRACAO) | GEITENS ≥1k (8.406 itens), GEUNIPRESC ≥1k, GEVIASITEM ≥1k, GENOMCOM 440, GESUBGRU 251, GEBARRAS 230, GEITENS_TBPRINC 189, GEGRUPOS 43, GEREFER 26, TBUNICON 53, TBLABORA ≥1k, GETABDCB ≥1k, TBPRINC 138, GETABVIA 26: uso pleno | Feito: `ItensTela`, `GET suprimentos/itens`, catálogos do M13 | F3: base de estoque, prescrição e conta | insumo, grupo_insumo, subgrupo_insumo, categoria_contabil_insumo, unidade_medida, insumo_unidade, unidade_prescricao, apresentacao_comercial, fabricante, registro_sanitario, principio_ativo, insumo_principio_ativo, via_uso_medicamento, insumo_via, insumo_codigo_barras, classificacao_fiscal |
| Governança do cadastro: solicitação e aprovação de item novo, padronização, unificação, de-para e substituição | MV 24/0 (SOLICITACAO_CADASTRO_PRODUTO, LIBERACAO_PRODUTO, MODIFICA_PRODUTO, PRODUTO_UNIFICADO, DE_PARA_PRODUTO, SUBSTITUICAO_PRODUTOS) | Não tem: o item é incluído direto | Não tem (POL-3 desliga a inclusão de item não padronizado) | F8: comissão de padronização e cadastro único da Rede; depois da virada | — |
| Locais de estoque, parâmetros e permissões por usuário, local, classificação e centro de custo | MV 12/3 (ESTOQUE*, CONFIG_ESTOQUE*, USU_ESTOQUE*, USUARIO_MULTI_EMPRESA_ESTOQUE, USUARIOS_ESPECIE) | GELOCARM 23, GELOCUSU ≥1k, GEUSERS 432, GEUSERS_TBCLASSI 177, GEUSERS_TBCENCUS 66, GEPARAM 525 (~300 campos): uso pleno | Feito: `LocaisTela`, `UsuariosEstoqueTela`, `ParametrosTela` | F3: sem isso ninguém movimenta | local_estoque, local_estoque_usuario, usuario_estoque_classificacao, usuario_estoque_centro_custo, parametro_estoque |
| Endereçamento de armazém e separação (picking) | MV 17/0 (ENDERECO_NIVEL_1 a _8, ENDERECAMENTO, SEPARACAO, RESERVA_ENDERECO_PRODUTO) | Não tem | Não tem | F8: ganho em almoxarifado central grande; a Rede não usa | — |
| Documentos de movimentação de estoque: transferência entre locais, devolução interna, movimento direto, acerto com motivo, numeração | MV 12/2 (MVTO_ESTOQUE*, ITMVTO_ESTOQUE*, ESTOQUE_TRANSFERENCIA, MOTIVO_ACERTO_ESTOQUE, ALCADA_TRANSF, DEV_CENTRALIZADA) | GECADTRA ≥1k, GELANTRA ≥1k, GECADDEV ≥1k, GELANDEV ≥1k, GELANPAC ≥1k, GETPLANCTO 6, GEULTDOCGER ≥1k, GEGERSEQ 25: uso pleno | Parcial: `TransferenciasTela`, `DevolucoesTela`, `MovimentoDiretoTela`; os documentos têm assinatura verde, mas estão desligados até o cenário controlado (D-MOTOR-28) | F3: movimento diário de todos os setores | documento_estoque, documento_estoque_item, tipo_movimento_estoque, motivo_ajuste_estoque, sequencia_documento |
| Requisição ao estoque e atendimento: pedido do setor ou do paciente, atendimento parcial, sem saldo, romaneio, saída a terceiro | MV 25/6 (SOLSAI_PRO*, ITSOLSAI_PRO*, ITSOLSAI_PRO_ATENDIDO*, HRITSOLSAI_PRO*, REQUISICAO_PRODUTO, ROMANEIO_SOLICITACAO) | GECADSAI ≥1k, GELANSAI ≥1k (mais de 2 mi), GELANSAIREQ ≥1k, GEINFVENEXT 206, GECADTER 5: uso pleno | Feito: `RequisicoesTela`, `SaidasTela`, `POST suprimentos/requisicoes/atender`; a saída está desligada até o cenário controlado | F3: maior volume do módulo | requisicao_material, requisicao_material_item, atendimento_requisicao, terceiro_destinatario |
| Dispensação ao paciente: por horário da prescrição, etiqueta de dose, entrega ao setor, regra de integração prescrição-estoque | MV 6/2 (CONSUMO_PACIENTE*, ITCONSUMO_PACIENTE*, SOLSAI_PRO_KARDEX, CONFIGURACAO_FARMACIA_MOBILE, ARQUIVO_PRESCRICAO) | GECADDISPENSACAO ≥1k, GELANDISPENSACAO ≥1k, GEDISPHOR ≥1k, PRINTEGRACAOESTOQUE ≥1k, GECTRLENTREGADOCSAIDA ≥1k, PRPARINTEGEST 5, GEHORMED 1: uso pleno | Parcial: M29 (`DispensacaoTela`, `EntregasTela`, `WorklistFarmaciaTela`, `etiqueta-dose`, `fila-dispensacao`); a dispensação e a devolução da dose estão desligadas até o cenário controlado | F3: farmácia hospitalar 24 h | dispensacao, dispensacao_item, dose_dispensada, entrega_setor, regra_integracao_prescricao, horario_padrao_medicacao |
| Avaliação farmacêutica da prescrição: triagem, situação por horário, substituição, intervenção com tipo e desfecho | MV 12/2 (PW_AVALIACAO_ITPRE_MED*, PW_AVALIACAO_PRE_MED*, PW_TIPO_INTERVENCAO, PW_CONFIG_AVAL_FARMACIA_DIA, FARMACEUTICO_EMPRESA) | PREXTRATOITEM_TBSITFARM ≥1k, PREXTRATOITEM_SUBST ≥1k, TBSITUACAOFARMACIA 12, TBTP_ENV_LISTA_AVAL_FARM 6: uso pleno | Feito: `AvaliacaoTela`, `IntervencoesTela`, `avaliacao.spec`; a avaliação nova roda só no novo (DP-25) | F3: a trilha de situação farmacêutica é usada todo dia | avaliacao_farmaceutica, avaliacao_farmaceutica_item, situacao_farmaceutica, intervencao_farmaceutica, tipo_intervencao_farmaceutica |
| Controle de antimicrobianos: ficha de justificativa, liberação e auditoria do uso | MV 4/0 (AVALIACAO_ANTIMICROBIANO_PRSCT, AUDIT_ANTIMICROBIANO, PRES_ANTIMICROB, EMPRESA_ANTIMICROB) | GEANTIMI 72, GECADANTIMI 45 (até 11/2024): uso baixo, histórico | Feito: antimicrobianos restritos no M48.3 (fila de liberação, DDD e DOT); fichas antigas só em leitura | F3: exigência da CCIH; o histórico precisa migrar | ficha_antimicrobiano, liberacao_antimicrobiano |
| Medicamentos controlados: livro de registro, termos de abertura e encerramento, perda, conferência, envio ao sistema nacional | MV 1/0 (TERMO_LIVRO_PSICOTROPICO) | Sem tabela própria: o livro sai dos movimentos do estoque | Parcial: `ControladosTela`, `LivroTela`, livro em PDF em modo conferência (DP-47.14); envio da farmácia ambulatorial desligado | F3: obrigação sanitária em vigor (Portaria 344/1998) | livro_controlado, termo_livro_controlado, lancamento_controlado, envio_controlado_nacional |
| Fracionamento e unitarização de dose: ordem de unitarização, etiqueta por dose, rastreio do lote de origem | MV 12/1 (FRACIONAMENTO, PRODUTO_FRACIONADO, ORDEM_UNITARIZACAO_PRODUTO, ETIQUETA_UNITARIZACAO*, LOTE_AMPOLA) | Não tem: só a etiqueta de dose da dispensação (GEDISPHOR) | Parcial: etiqueta de dose (M29); fracionamento não tem | F7: a farmácia de dose unitária precisa do rastreio do lote de origem até a dose (exigência sanitária) | ordem_unitarizacao, ordem_unitarizacao_item, dose_unitarizada |
| Manipulação e produção interna: ordem de manipulação ou produção, insumos, lote produzido, kit montado | MV 12/2 (MANIPULA, ITMANIPULA, ORDEM_PRODUCAO, MVTO_KIT_PRODUZIDO*, PREPARACAO_LOTE) | GECAPELAMP 1, GEGRUPOMP 1, GECAPELAMP_GEGRUPOMP 1: módulo sem uso | Feito e desligado: M46.4 (`ManipulacaoTela`, `ordem-manipulacao.spec`) | F7: quimioterapia e nutrição parenteral exigem registro da manipulação | capela_manipulacao, ordem_manipulacao, ordem_manipulacao_insumo, lote_produzido |
| Kits e composição padrão: kit por procedimento ou cirurgia, kit rastreável e carrinho de emergência com saldo e reposição | MV 17/3 (KIT_ESTOQUE, ITKIT_ESTOQUE, ITMVTO_KITS*, DOCUMENTO_KIT*, CIRURGIA_KIT, ITEM_PROCEDIMENTO_MATERIAL) | GEKITITE ≥1k, GEITEMKITRAS ≥1k, GEITEMKITRAS_GELANSAI ≥1k, GEITEMKITRAS_GELANDEV ≥1k, GESALDOKITRAS ≥1k, GEKITRAS 766, GEKITS 45: uso pleno | Feito: `KitsTela`, `suprimentos/kits`, `kits-padrao`; a reposição do kit rastreável é P2, especificada | F3: os carrinhos de emergência são rastreados hoje | kit_material, kit_material_item, kit_rastreavel, kit_rastreavel_item, reposicao_kit_rastreavel |
| Lote, validade e identificação: lote por movimento, validade, etiqueta com código de barras ou DataMatrix, identificador único por unidade | MV 26/10 (LOTE*, HIST_LOTE_VALIDADE, ETIQUETA_ESTOQUE*, ETIQUETA_BARRA, IDENTIFICADOR_ETIQUETA*, MODELO_CODIGO_BARRAS_QR_CODE) | GEVALMEM ≥1k, GECTRVMM ≥1k, GERASVALNFS, GERASVALSAIDLOTE, GERASVALTRANSFLOTE, GERASVALDEVLOTE, GERASVALBAL, GEQTDELOTEVALLOTEDOCSAIDA ≥1k, GERASVALFINAL 843, GERASVALINICIAL 681, GEPADRAO_DATAMATRIX_QRCODE 2: uso pleno (datas inválidas a sanear) | Feito: `RastreioTela`, `lotes/rastreio`, `lote.spec`; a correção de validade é P2, especificada | F3: rastreio por lote em uso; o conector precisa sanear as datas | lote_insumo, movimento_lote, padrao_leitura_codigo, etiqueta_identificacao |
| Inventário e contagem: balanço por local, contagem cega e recontagem, divergência, conferência rotativa, estoque inicial | MV 20/6 (INVENTARIO, CONTAGEM*, ITCONTAGEM*, SEQUENCIA_CONTAGEM*, VERIFICACAO_ROTATIVA_SALDO, DIVERGENCIA_QUANT_PROD) | GECADBAL 251, GELANBAL ≥1k, GERASVALBAL ≥1k, GEESTINI 42, GELANESI 599, GERASVALESTINI 457: uso pleno | Parcial: `InventariosTela`; o registro do balanço é P2, especificado | F3: o balanço mensal fecha o estoque | inventario_estoque, inventario_estoque_contagem, inventario_estoque_item, inventario_estoque_divergencia |
| Saldo, custo médio, fechamento mensal, recálculo auditado e consumo por centro de custo | MV 18/4 (CUSTO_MEDIO_MENSAL*, ITMVTO_ESTOQUE_CUSTO*, VALOR_INICIAL_PRODUTO*, ITMVTO_SETOR*, ESTOQUE_PL_CONTAS, NATUREZA_DESPESA) | GESALDOS ≥1k, GEARMLOC ≥1k, GECONITL ≥1k, GEKONCDC ≥1k, GEFECMES 79, GEATUALIZASALDO 507: uso pleno | Parcial: `SaldosTela`, `FechamentosTela`, `ConsumoTela`, `RecalculosTela`; fechar e reabrir o mês são P2, especificados | F3: base do custo e da contabilidade | saldo_estoque, saldo_estoque_mensal, custo_medio_historico, fechamento_estoque, consumo_centro_custo |
| Reposição: estoque mínimo e máximo por local, nível de serviço, ponto de pedido, cobertura, cota de setor e sugestão de compra | MV 16/5 (COTA_RESSUPRIMENTO*, ITEM_COTA_RESSUPRIMENTO*, COTA_SETOR*, INDICE_COBERTURA_PRODUTO, PRAZO_DISPONIBILIDADE_ESTOQUE) | GELIMLOC 379, GENIVELSERV 18: em uso | Feito: `ponto-pedido.spec`, `SugestaoCompraTela`, `POST suprimentos/pontos-pedido` | F3: mínimo e máximo já em uso; a sugestão de compra é nova e já construída | parametro_reposicao, nivel_servico, cota_consumo_setor, sugestao_compra, sugestao_compra_item |
| Solicitação de compra com aprovação por alçada e rateio entre setores | MV 15/5 (SOL_COM*, ITSOL_COM*, AUTORIZADOR_SOL_COM, LOG_AUTORIZADOR_SOLIC_COMPRA*, RATEIO_SOL_COM*, REGRA_PARCELA_ITSOL_COM*) | GECADPED ≥1k (a necessidade nasce no pedido); flag de autorização em GEUSERS (4 usuários) | Feito: `AprovacoesTela`, `alcada.spec` | F3: a aprovação já existe, mesmo que informal | solicitacao_compra, solicitacao_compra_item, alcada_aprovacao, aprovacao_documento, rateio_solicitacao |
| Cotação: coleta de preços por fornecedor, mapa comparativo, vencedor por item, portal de cotação externo | MV 17/4 (COLETA*, COTADOR*, SOL_COM_FORNECEDOR*, MELHOR_FORNECEDOR, FORNEC_COTACAO_PROCES_CPR) | GELANPED ≥1k (cotações por fornecedor), GEINTAPOIOCOT 225, GEPORTALCOMPRAS 3 (módulo INTG): uso pleno | Feito: `CotacaoTela`, `cotacao.spec` | F3: o comprador cota todo dia, inclusive em portal | cotacao, cotacao_fornecedor, cotacao_resposta_item, portal_cotacao, vinculo_portal_cotacao |
| Pedido de compra: emissão, autorização, entregas programadas, acompanhamento, cancelamento justificado, histórico de compras | MV 22/4 (ORD_COM*, ITORD_PRO*, HIST_AUTORIZADOR_ORDEM_COMPRA*, ACOMPANHAMENTO_ORDEM_COMPRA, JUSTIFICA_CANCELAMENTO_ORD_CPR, PRODUTO_ULTIMAS_COMPRAS*) | GECADPED ≥1k, GELANPED ≥1k, GECOMPRA ≥1k, GELANPEDENTREGA 46, GESITUACAOPED 10, GEDESCOM 1: uso pleno | Feito: `PedidosTela`, `HistoricoComprasTela` | F3: núcleo de compras | pedido_compra, pedido_compra_item, pedido_compra_entrega, situacao_pedido_compra, destino_entrega_compra |
| Recebimento e entrada por nota fiscal: leitura do XML, conferência física e com o pedido, impostos, custo de entrada | MV 27/6 (ENT_PRO*, ITENT_PRO*, ITENT_PRO_IMPOSTO*, MVTO_ESTOQUE_NFE, CONFERENCIA_ENTRADA, MODELO_ENTRADA_PRODUTO*) | GECADNFS ≥1k, GELANNFS ≥1k, GERASVALNFS ≥1k: uso pleno | Parcial: `NotasTela`, `POST suprimentos/notas/xml`, `conferencia-nf.spec`; a entrada (`registrarEntradaNF`) está desligada até o cenário controlado | F3: toda entrada passa por nota | nota_entrada, nota_entrada_item, nota_entrada_imposto, conferencia_recebimento, conferencia_recebimento_item |
| Devolução ao fornecedor e notas de crédito ou débito de suprimentos | MV 10/0 (ORDEM_DEVOLUCAO, ITORDEM_DEVOLUCAO, NOTA_CRE_DEB_SUPRI, DEV_FOR_ITCON_PAG, TIP_DEV_FISCAL) | Não tem documento próprio: a devolução de estoque (GECADDEV) é interna | Não tem | F7: devolver com nota fiscal e abater no contas a pagar é obrigação fiscal de qualquer hospital | devolucao_fornecedor, devolucao_fornecedor_item, nota_credito_debito_fornecedor |
| Fornecedores: cadastro fiscal e bancário, contatos, categorias, autorização sanitária, avaliação e ocorrências | MV 20/3 (FORNECEDOR*, FORNECEDOR_LOGRADOURO*, FORNECEDOR_ANVISA, FORNECEDOR_CATEGORIA, HISTORICO_ISO_AVALIACAO, NOTIFICACAO_FORNECEDOR, LABORATOR_FORNECEDOR*) | TBFORNEC ≥1k, TBFORNECTEL 35, TBCATFOR 12, TBATIVID 214, GETABFUN 13, TBCATEGO 2, TBDISPON 2: uso pleno | Feito: `FornecedoresTela`; avaliação do fornecedor crítico no M55.3 | F3: compartilhado com o financeiro; tem que vir no dia 0 | empresa_fornecedora, empresa_fornecedora_contato, empresa_fornecedora_categoria, categoria_fornecimento, atividade_economica, empresa_fornecedora_autorizacao, avaliacao_fornecedor, ocorrencia_fornecedor |
| Consignação: saldo do fornecedor no hospital, consumo que gera reposição e compra, percentual por faixa | MV 5/4 (EST_CONSIG_FORN*, PERCENTUAL_CONSIGNADO*, FAIXA_PERCENTUAL_CONSIGNADO*, LOG_MVTO_CONSIGNADO*) | GESALCON 1, GETPSALDO 3, GEREFER (flag de consignado): praticamente sem uso | Feito e desligado: M46.4 (`ConsignadosTela`, `consignado.spec`) | F7: hospital com cirurgia e hemodinâmica trabalha com material consignado; a Rede não usa no sistema hoje | saldo_consignado, remessa_consignada, remessa_consignada_item, reposicao_consignada |
| OPME: solicitação ligada à cirurgia, autorização da operadora, cotação, consumo em sala com rastreio por lote e série, conciliação com a conta, reposição | MV 32/1 (OPMENEXO_ITEM, OPMENEXO_LOTE, CONF_FLUXO_GUIA_OPME, LOG_CONCILIACAO_OPME, TAXA_MANUSEIO_OPME, VAL_OPME_IT_GUIA*, PRE_OC) | Não tem fluxo próprio: o OPME sai do estoque como item comum | Feito e desligado: M46.3 (`OpmeSolicitacoesTela`, `OpmeConsumoTela`, `OpmeRastreioTela`, `OpmeConciliacaoTela`, etiqueta de três vias) | F7: rastreio do implante, autorização TISS e conciliação são exigidos de hospital cirúrgico | solicitacao_opme, solicitacao_opme_item, autorizacao_opme, consumo_opme, rastreio_implante, conciliacao_opme, taxa_manuseio_implante |
| Compras públicas: licitação, pregão, propostas, ata de registro de preço, empenho | MV 33/0 (LICITACAO, PREGAO, PROPOSTA_PREGAO, REGISTRO_PRECO, ITEM_REGISTRO_PRECO, NOTA_EMPENHO, PEDIDO_EMPENHO) | GEDESPDS 23 (pedidos marcados como licitação, 2020-24): uso residual | Feito e desligado: M55.4 (`LicitacoesTela`, `dominio-suprimentos/licitacao`) | F7: hospital público ou filantrópico com recurso público compra pela Lei 14.133/2021 | processo_licitatorio, processo_licitatorio_item, proposta_licitacao, ata_registro_preco, ata_registro_preco_item, empenho, empenho_item |
| Gestão de contratos com fornecedores: vigência, aditivo, reajuste, SLA, apontamentos, alertas de vencimento | MV 106/7 (54 no DBAMV e 52 repetidas no MVCONT: GCTO_CONTRATO*, GCTO_CONTRATO_SLA, GCTO_APONTAMENTO, GCTO_EVENTO*, GCTO_INDICADOR) | Não tem | Feito: M55.3 (`ContratosTela`, `dominio-suprimentos/contrato`) | F8: valor real (saldo do contrato, alertas), mas não é exigência; o modelo entra quando a fase chegar, já com o desenho do new-sgh | — |
| Tabelas de referência de preço de material e medicamento e vínculo do produto com elas | MV 9/6 (BRASIND, SIMPRO*, PRECOS_SIMPRO*, B_PRECOS*, LOG_BRASINDICE*) | TBMATMED ≥1k (~910 mil linhas), TBHISTBR ≥1k, TBVERSAOBRASIN 398, TBCTRMEM 78 (módulos FAT e CAD): uso pleno | Feito: `dominio-preco`, catálogos do M13 (DP-36 sobre a licença) | F3: o item da conta depende do vínculo; o preço em si fica na análise do faturamento | insumo_referencia_preco (as tabelas de preço ficam no grupo do faturamento) |
| CME: solicitação de material estéril, caixas e instrumental, ciclo de esterilização com indicadores, etiqueta, rastreio até o paciente | MV 34/3 (MVTO_CME, SOLICITACAO_CME, CX_KIT, IT_CX_KIT, MAQ_ESTERILIZADOR, TIPO_ESTERILIZACAO*, ETIQUETA_CME, FUNCIONAL_CME*) | Não tem | Não tem | F7: a RDC 15/2012 exige rastreio do processamento em hospital com centro cirúrgico | caixa_instrumental, caixa_instrumental_item, instrumental, equipamento_esterilizacao, ciclo_esterilizacao, ciclo_esterilizacao_item, indicador_ciclo, solicitacao_material_esteril, etiqueta_esteril |
| Gases medicinais: consumo por paciente e setor | MV 1/0 (MVTO_GASES) | Não tem | Não tem | F8: custo e conta mais precisos; pode esperar | — |
| Integrações específicas com portais de compra, de OPME e ERPs corporativos | MV 65/0 (INTEGRA_BNEXO_*, INTEGRA_ONEXO_*, IMVAPP_*, IMV_DATASUL_*, INTEGRA_SAIDA_ORD_COM_XML) | GEINTAPOIOCOT e GEPORTALCOMPRAS (contados na cotação) | Motor de integração genérico (M34: outbox, fila de mortos, HL7 e FHIR) | NAO: as tabelas de troca são do fornecedor; o canal de cada portal vira configuração do motor | — |
| Relatórios consolidados por empresa e rentabilidade de produto | MV 12/0 (PRODUTO_RELATORIO_SCCOM, ESTOQUE_RELATORIO_SCCOM, PRODUTO_RENTABILIDADE) | Não tem | Relatórios e BI próprios (M34, M57.3) | NAO: cópia de dados para relatório; o relatório sai de consulta sobre o modelo | — |
| Cubos analíticos de exames, estoque, compras e fornecedores | MV 20/3 (DBADW: DI_EXAME, FA_EXAME, FA_ESTOQUE, FA_SALDO, FA_ITENS_COMPRA, DI_FORNECEDOR*) | Não tem | Indicadores próprios (`dominio-sadt/indicadores/tat`, painel da onda 3, BI do M57.3) | NAO: o data mart é derivado e não entra no modelo transacional | — |

## Recursos novos do MV que valem a pena

Em ordem de valor para um hospital que não é a Rede Santé. Nenhum deles atrasa a virada.

1. **CME com rastreio do processamento (F7).** Cobre caixas e instrumental, o ciclo de esterilização
   com indicador químico e biológico, a etiqueta e o vínculo da caixa com o paciente e a cirurgia. O
   SPDATA não tem nada disso, e a RDC 15/2012 exige para qualquer hospital com centro cirúrgico. É a
   maior lacuna regulatória do grupo e não existe no new-sgh.
2. **Microbiologia estruturada com antibiograma (F7).** Microrganismo isolado, CIM e interpretação
   por antimicrobiano. Com isso a CCIH do M48.3 calcula a resistência por germe, e o laudo sai
   padronizado. Hoje a cultura vira texto livre no resultado.
3. **Unitarização e fracionamento com rastreio do lote de origem até a dose (F7),** junto com o
   identificador único por dose que a enfermagem lê na checagem à beira do leito. Reforça a leitura
   obrigatória da dose prevista no M25 (DP-26).
4. **Autoliberação por regra e checagem de consistência do resultado (F8).** Delta check contra o
   resultado anterior, curva e substância interferente. Libera o normal automaticamente e retém o
   suspeito, o que aumenta a produtividade da bancada.
5. **Busca ativa de resultados depois da alta (F8).** Cultura positiva ou exame alterado que chega
   com o paciente já em casa vira tarefa para uma equipe, com histórico até o contato. É segurança
   do paciente que vai além do valor crítico.
6. **Central de compras e cadastro único da Rede (F8).** Governança do cadastro (solicitação,
   padronização, unificação e de-para), cotação consolidada entre estabelecimentos e comprador por
   classe de produto. Faz sentido para a Rede Santé, que tem vários hospitais.
7. **Cotas e regras de solicitação por convênio, unidade e último resultado (F8).** Bloqueia a
   repetição indevida e o exame fora da cobertura antes da coleta, o que reduz glosa.
8. **Soroteca e consumo padrão por exame (F8).** Guarda e expurgo rastreados da amostra. Baixa
   automática do contraste e do kit do exame, com o lançamento na conta.

Recursos do MV que o new-sgh já construiu (desligados) e que o modelo novo herda prontos: agência
transfusional, OPME, consignação, manipulação, licitação e contratos. A decisão de fase deles (F7 ou
F8) acima vale para o momento de ligar. O desenho das entidades já existe.

## Lacunas do new-sgh frente ao SPDATA

O que o SPDATA tem em uso e o new-sgh ainda não entrega por completo. Pelas premissas do ADR 0001,
cada item é pré-requisito da virada (F3).

1. **Motor de estoque sem gatilho.** No SPDATA, o saldo por local, o lote e o item da conta são
   mantidos por gatilho. No new-sgh, os documentos de estoque (`registrarSaida`,
   `registrarDevolucao`, `transferir`, `registrarEntradaNF`) têm assinatura verde, mas estão
   desligados até o cenário controlado (D-MOTOR-28). No banco próprio, esse motor vira serviço de
   domínio, e é o item mais crítico do grupo.
2. **Operações P2 de estoque só especificadas:** movimento direto, registro do balanço, fechar e
   reabrir o mês, repor kit rastreável, desconsolidar documento e corrigir validade de lote. Todas
   têm uso real no SPDATA (GELANPAC, GELANBAL, GEFECMES, GEITEMKITRAS, GEVALMEM).
3. **Dispensação e devolução da dose desligadas** até o cenário controlado. A confirmação de entrega
   é verde, mas ainda não foi conferida no outro sistema (D-ENTREGA-29).
4. **Emissão do laudo** (`sadt.emitirLaudo`) desligada até a numeração do laudo com o fornecedor
   (D-LAUDO-26). O SPDATA emite e autentica mais de mil laudos (SIASSLAUDO_IMPRESSAO).
5. **Comunicação com os 20 equipamentos de laboratório** (SITPEQV): o new-sgh só consulta as
   interfaces e mantém o de-para. O tráfego de pedido e resultado com o equipamento ainda corre pelo
   programa de interface do legado, que precisa ser ligado ao banco novo ou substituído pelo motor
   de integração.
6. **Livro de controlados em modo conferência** (DP-47.14) e envio da farmácia ambulatorial ao
   sistema nacional desligado (regra 10).
7. **Agenda de exames desligada** até a correção da sante-api (DP-8). O SPDATA a usa com volume
   pleno (SIPACAGD, SIPACAGI).
8. **Saneamento de datas de lote e validade.** GEVALMEM e GERASVALNFS têm datas inválidas, e o
   conector do dia 0 precisa de regra explícita para elas antes da carga.
9. **Parâmetros por usuário.** SIPAR* e GEPARAM guardam parâmetros por usuário, com senha gerencial
   dentro. O modelo novo precisa de um de-para para parâmetro por estabelecimento e setor, e a senha
   vai para o cofre, nunca para a tabela.
10. **Conferência numérica da onda 3** (estoque, dispensação e compras) com zero divergência, e o
    item na conta depois da dispensação: ambos ainda bloqueados ou dependentes de validação humana
    (M41).
