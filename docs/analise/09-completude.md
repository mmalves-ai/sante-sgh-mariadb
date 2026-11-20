# Análise cruzada 09: crítica de completude

Papel: **crítico de completude** dos oito grupos da análise cruzada (01 a 08). O documento não reescreve
nenhum grupo. Aponta três coisas:
1. as áreas do MV que nenhum grupo cobriu, com a decisão proposta;
2. as contradições entre grupos (mesma funcionalidade com decisões diferentes, mesma entidade com dois donos,
   mesmo conceito com nomes diferentes);
3. a tabela-resumo consolidada.

Data: 2026-11-20. Fontes, só leitura:
- `referencias/mv-tabelas.tsv`: 8.867 tabelas;
- os oito arquivos `docs/analise/0[1-8]-*.md`;
- a matriz de 1.503 tabelas do SPDATA (`new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`);
- `new-sgh/planejamento/ESTADO.md` e `new-sgh/packages/`.

Nenhum conteúdo de linha do Oracle foi lido. Nomes do MV e do SPDATA aparecem só nas colunas de evidência. As
entidades propostas usam nomes nossos.

## Método

1. **Cobertura por nome.** Montei a lista de padrões a partir de três fontes:
   - os prefixos que o orquestrador atribuiu a cada grupo;
   - todo nome de tabela ou prefixo citado nos oito arquivos, com ou sem crase.

   Os esquemas atribuídos inteiros a um grupo saem da conta. São dez: DBAPS, MVINTEGRA, DBASGU, DBACP, DBADW,
   MVBIKE, DBATUALIZA, GCMMV, MVONEPASS e CARTORIO.
2. **Resíduo.** Sobraram **1.436 tabelas** (316 com dados) que nenhum padrão alcança: 1.277 do DBAMV e 159
   do DBAPORTAL. O MVCONT sai inteiro: as 142 tabelas estão no grupo 07.
3. **Agrupamento por assunto.** Agrupei o resíduo por prefixo e descritivo, e conferi cada área nos arquivos
   dos grupos (pela funcionalidade, não só pelo nome):
   - cerca de **550 tabelas** do resíduo formam as áreas da seção 1;
   - as outras, cerca de **890**, são tabelas subordinadas de funcionalidades que os grupos já contaram sem
     citar cada nome (itens, tipos, grupos, históricos e cópias), mais cerca de 70 tabelas técnicas do portal.
     Exemplos: itens de cotação, de entrada e de orçamento; tipos de laudo; grupos de procedimento.
4. **Fronteiras.** Duas áreas foram citadas por um grupo como "fronteira com o grupo X", mas o grupo X não
   existe nesta rodada:
   - a **classificação de risco do PA**: o grupo 02 a passou a um "grupo de urgência e PEP" que não existe;
   - a **qualidade**: os grupos 01 e 08 a passaram a um "grupo de qualidade" que não existe.

   Na seção 1, essas duas áreas entram com a contagem total, não só com o resíduo.

## 1. Áreas do MV sem cobertura

**29 áreas, 630 tabelas do MV, 157 com dados.** A soma é a da coluna de evidência da tabela abaixo. Ela
inclui as tabelas de classificação de risco e de qualidade que os grupos 02 e 01 citaram só como fronteira,
com a contagem total de cada área.

Decisões propostas:

| Decisão | Áreas |
|---|---:|
| F3 | 2 |
| F7 | 7 |
| F8 | 11 |
| NAO | 9 |
| **Total** | **29** |

As áreas F3 e F7 somam **28 entidades próprias**. A coluna "Dono sugerido" indica o grupo que deve absorver
a área na próxima rodada.

| # | Área (funcionalidade) | MV (evidência: esquema, prefixos, n tab / com dados) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão e justificativa | Dono sugerido | Entidades próprias (F3/F7) |
|---:|---|---|---|---|---|---|---|
| 1 | Classificação de risco no pronto atendimento: protocolo, perguntas e discriminadores, nível de prioridade com cor, aferição, reclassificação e auditoria | DBAMV `SACR_*`, `SCR_*`, `TRIAGEM_ATENDIMENTO*`, `TRIAG_*`, `CLASSRISCO_LOGS`, `ASSIN_DIGITAL_CLASRISCO`: 104 / 34 (o grupo 02 contou 93/29 como fronteira) | `PRMANCHESTER` (7), perguntas do formulário de triagem do PEP | M44.1, `dominio-recepcao/classificacao`: motor, classificar e reclassificar, quadro com cor, painel de TV. Aguardando validação | **F3**: o ProntoCardio é pronto atendimento e classifica todo paciente. Sem isso não há virada | 03 (com o 02 na recepção) | `protocolo_classificacao_risco`, `discriminador_classificacao_risco`, `nivel_prioridade`, `classificacao_risco`, `classificacao_risco_resposta`, `reclassificacao_risco` |
| 2 | Notificação de incidentes e eventos adversos, com triagem pelo núcleo de segurança do paciente, análise de causa, plano de ação e envio ao sistema nacional | DBAPORTAL `OCORRENCIA*`, `REGISTRO_OCORRENCIA*`, `REG_OCORRENCIA_*`, `EVENTO_SENTINELA`, `REG_EVENTO_SENT`, `CAUSA_RAIZ*`, `ISHIKAWA*`, `ANALISE_5W2H*`, `ANALISE_PDCA`, `ACAO_IMEDIATA_*`, `WORKFLOW_OCORRENCIA`: 42 / 3 | Não tem | M48.1 e M48.2, `dominio-qualidade/nsp`: notificação anônima ou identificada, triagem, prazos, envio ao Notivisa, 5W2H e Ishikawa. Aguardando validação | **F7**: a RDC 36/2013 exige o núcleo e a notificação de todo hospital. A Rede Santé não tem isso no legado, então não é paridade | novo grupo de qualidade (ou 03) | `notificacao_incidente`, `classificacao_incidente`, `analise_incidente`, `plano_acao_qualidade`, `acao_plano_qualidade`, `notificacao_incidente_envio` |
| 3 | Gestão da qualidade para acreditação: documentos controlados com versão e ciência, auditoria interna por checklist, matriz de riscos, não conformidade, prática de controle | DBAPORTAL `DOCUMENTO*`, `REPOSITORIO_DOCTO*`, `FLUXO_DOC*`, `CA_*`, `AUDITORIA*`, `ACHADO*`, `RISCO`, `MATRIZ_RISCO`, `MAPA_RISCO*`, `FATOR_RISCO`, `PRATICA_CONTROLE*`, `PROCESSO*`: cerca de 67 / 25. DBAMV `NAO_CONFORMIDADE`, `GED_*`: 6 / 5 | Não tem | M48.5, `dominio-qualidade/gestao`: gestão documental, auditorias, comissões, matriz GUT, não conformidade. Aguardando validação | **F8**: a acreditação é voluntária. As telas já existem, e a tabela entra quando a fase chegar | novo grupo de qualidade | — |
| 4 | Homologação de fornecedor por questionário pontuado, com ranking e exceções | DBAMV `ISO_*`: 9 / 0 | Não tem | Avaliação simples do fornecedor no grupo 05 (F3) e no 07 (F7) | **F8**: o questionário pontuado vai além da avaliação básica, que já está coberta | 05 | — |
| 5 | SAC e ouvidoria do hospital (chamado, setor responsável, parecer, prazo, resposta) e pesquisa de satisfação | DBAMV `SAC_*`, `MEIO_SAC_*`, `ORIGEM_SAC_*`, `PESQUISA_SATISFACAO`, `AVALIACAO_SERVICO`, `ENCERRAMENTO_SOLICITACAO`: 20 / 4 | Só o SAC da operadora (`SPMOTLIG`, 1) | Contratos `qualidade/ouvidoria-indicadores` no new-sgh | **F8**: valor real, sem obrigação legal para o hospital privado | novo grupo de qualidade | — |
| 6 | Vigilância de infecção hospitalar: caso de IRAS por critério e topografia, denominadores, relatório mensal e análise de culturas | DBAMV `INFECCAO*`, `CLASSIFICACAO_IRAS`, `COMPONENTE_NNISS`, `RESUMO_NNISS`, `GRAFICO_EVO_INFEC`, `MES_ANO_PSIH`, `NATUREZA_PSIH`, `ANALISE_CULTURA_ACAO`, `ACAO_ANALISE_CULTURA*`, `AGRUPA_GERMES`, `ITEM_PRECAUCAO`: 19 / 5 | Não tem tabela de vigilância (só o tipo de receita de antimicrobiano) | M48.3, `dominio-qualidade/ccih` e `vigilancia`: ficha de IRAS, denominadores, precauções, surtos. Aguardando validação | **F7**: o programa de controle de infecção (Portaria 2.616/1998) e a notificação mensal de IRAS à Anvisa são obrigatórios. O grupo 03 cobriu antimicrobianos e dispositivos, mas não o caso de infecção | 03 | `caso_infeccao`, `criterio_infeccao`, `sitio_infeccao`, `denominador_vigilancia`, `notificacao_iras_envio` |
| 7 | Registro oncológico e radioterapia: estadiamento, topografia e morfologia do tumor, metástase, aparelho e área irradiada, sessões do tratamento | DBAMV `ESTADIAMENTO`, `ESTADIO*`, `GRUPAMENTO_ESTADIO`, `METASTASE*`, `TOPOGRAFIA*`, `LOCALIZACAO_PRIMARIA`, `CIDO`, `AREA_IRRADIADA`, `APARELHO_ONCOLOGIA`, `SESSAO_TRATAMENTO`, `TRATAMENTO*`, `REGISTRO_FLUXO_ONCOLOGIA`: 23 / 8 | Só carga de referência: `TBLOCPRI` (49), `TBTISSESTTUMOR` (6) | Não tem (a quimioterapia está no grupo 03, F8; a APAC oncológica, no 06, F7) | **F8**: serve a centro de oncologia habilitado. O estadiamento que a guia e a APAC exigem já entra como carga de terminologia nos grupos 06 e 08 | 03 | — |
| 8 | Plano de cuidados por problema com conteúdo licenciado de terceiro (intervenções, objetivos, educação) | DBAMV `PL_CUID*`, `PL_CUIDADO*`: 21 / 0 | Não tem | Processo de enfermagem no grupo 03 (F7) | **NAO**: o conteúdo é de terceiro e não tem dados; o processo de enfermagem do grupo 03 já cobre a função | — | — |
| 9 | Construtor genérico de formulários e questionários (perguntas, respostas possíveis, fórmulas, efeito das respostas) | DBAMV `PERGUNTA*`, `RESPOSTA*`, `GRUPO_PERGUNTA*`, `QUESTIONARIO*`, `PADRAO_FORMULA*`, `EFEITO_ACAO_GRUPO_PERGUNTA`: 17 / 4 | Coberto pelo grupo 03 (índices e escalas) | Construtor de modelos do PEP | **NAO**: duplica o construtor de modelos e as escalas pontuadas do grupo 03 (F3) | — | — |
| 10 | Prontuário antigo do fornecedor: evolução médica e de enfermagem em texto, textos padrão, exame físico e anamnese fora do construtor | DBAMV `EVO_*`, `EVOLUCAO_MEDICA`, `EVOLUCAO_ADMINISTRATIVA`, `TEX_EVO*`, `TEXTOS_ATD`, `TEXTO_PADRAO_EDITOR*`, `EXAME_FISICO`, `CORPO_ANAMNESE`, `CASOS_ATD`, `XML_*RESUMO_CLINICO`: 21 / 7 | Coberto pelo registro clínico do PEP | Registro clínico em modelo | **NAO**: substituído pelo registro clínico em modelo do grupo 03 (F3) | — | — |
| 11 | Atributos sociodemográficos exigidos pelo cadastro nacional: orientação sexual, povo e língua indígena, nacionalidade, situação familiar, doença crônica, vulnerabilidade | DBAMV `ORIENTACAO_SEXUAL`, `LINGUA_INDIGENA`, `CIDADANIAS`, `SITUACAO_FAMILIAR`, `DOENCA_CRONICA`, `VULNERABILIDADE_SOCIAL`, `CONTRACEPTIVO`, `FORCA_MILITAR`, `POSTO_MILITAR`: 9 / 4 | `TBVULNERABILIDADE_SOCIAL` (1), `TBETNIA` (1): só domínio com valor padrão (o grupo 02 já apontou) | Cadastro do paciente | **F7**: o CADSUS e a RNDS pedem esses campos, e o hospital do zero precisa da carga pública pronta | 02 | `povo_indigena`, `lingua_indigena`, `orientacao_sexual`, `nacionalidade` |
| 12 | Registro civil e funerária do óbito, colônia | DBAMV `REGISTRO_CIVIL`, `FUNERARIA`, `COLONIA`: 3 / 0 | Não tem | Não tem | **F8**: apoio administrativo ao óbito, sem obrigação | 04 | — |
| 13 | Agenda antiga por serviço, escala e marcação (antes da agenda central) | DBAMV `SER_DIS*`, `MARCACAO*`, `P_ESCALA*`, `SESCALA*`, `SESC_DIA*`, `ESC_DIA_EXT`, `IT_AGENDA`, `ITEM_AGDM_*`, `INDICACAO_AGENDA`: 32 / 1 | Coberto pela agenda do SPDATA | Agenda do new-sgh | **NAO**: modelo substituído pela agenda central, já coberta pelo grupo 02 | — | — |
| 14 | Restrição de cobertura por fonte pagadora (procedimento proibido por plano, setor, idade, horário ou prestador, com exceção justificada) e compatibilidade entre procedimentos | DBAMV `PROIBICAO*`, `IT_PROIBICAO_EXCEPCIONAL`, `PREST_GRU_PRO_PROIBIDO`, `PREST_ORI_PROIBIDO`, `COMPAT_PROCEDIMENTO`, `INCOMPAT_PROCEDIMENTO`: 13 / 1 | Só restrições clínicas por sexo e idade (`TBPROENF`, 200), que o grupo 05 já cobriu | Não tem | **F7**: o hospital novo precisa bloquear antes do lançamento o item que a fonte pagadora não cobre, para evitar glosa certa | 06 | `restricao_cobertura_pagador`, `compatibilidade_procedimento` |
| 15 | Logística entre unidades: romaneio de entrega, transportadora, motorista, veículo e frete | DBAMV `ROMANEIO*`, `DESTINO_ROMANEIO`, `TRANSPORTADOR*`, `MOTORISTA*`, `VEICULO_ROMANEIO`, `FRETE*`: 11 / 0 | Não tem | Não tem (o grupo 05 cita o romaneio só na requisição) | **F8**: ajuda quando a Rede tiver central de abastecimento; não pesa na virada | 05 | — |
| 16 | Entrada de serviço tomado: registro da nota de serviço contra o pedido, conclusão, impostos retidos e moeda | DBAMV `ENT_SERV*`, `ITENT_SERV*`: 6 / 3 | Classificação de serviços com retenção (`FPCLASSIFSERV`, 31) | Escrituração e REINF no grupo 07 | **F7**: as retenções do serviço tomado alimentam a EFD-REINF. O grupo 07 tem a nota de serviço do lado do evento, mas falta a entrada ligada ao pedido | 07 | `entrada_servico`, `entrada_servico_item`, `retencao_entrada_servico` |
| 17 | Doação recebida de produtos | DBAMV `DOA_PRO`, `ITDOA_PRO`: 2 / 0 | Não tem | Não tem | **F8**: comum em filantrópico; a entrada comum já cobre o caso | 05 | — |
| 18 | Consumo médio e cotas de estoque calculadas (fotos de consumo por empresa e setor) | DBAMV `C_CONEST*`, `C_CONSET*`, `ACRO_*`, `COTA*`, `GABARITO*`, `ORD_DUPL*`: 24 / 1 | Coberto pelo saldo e custo médio do grupo 05 | Suprimentos | **NAO**: são dados derivados; a cota de ressuprimento do grupo 05 já cobre a função | — | — |
| 19 | Compras públicas, partes não citadas: coleta de preços para licitação, adesão a pregão, pedido de empenho, fonte de recurso | DBAMV `ITEM_COLETA_*`, `PEDIDO_EMPENHO*`, `ITEM_PREGAO`, `ADESAO_PROCESSO_PREGAO`, `MODALIDADE_LICITACAO`, `FONTE_RECURSO*`: 24 / 0 | Não tem | Não tem | **F7**: segue a decisão do grupo 05 para compras públicas; a função não muda e não surge entidade nova | 05 | — |
| 20 | Rede regional pública: diretoria regional, divisão, município, percentual por unidade | DBAMV `DIRETORIA_REGIONAL`, `DIVISAO_UNIDADE_REGIONAL`, `MUNICIPIO_UNIDADE_REGIONAL`, `PERCENTUAL_UNID_REG`, `LOCALIDADE`: 8 / 0 | Não tem | `dominio-rede` (rede própria) | **NAO**: é gestão de secretaria de saúde; a rede própria já está no grupo 01 | — | — |
| 21 | Hierarquia da CID: capítulos, grupos e subgrupos, CID auxiliar | DBAMV `CAPITULO_CID`, `GRUPO_CID*`, `GRU_CID`, `SGRU_CID*`, `SUBGRUPO_CID_AUXILIAR`, `CID_AUX`: 9 / 2 | `TBCID10` (1.000+), sem capítulos | Catálogo | **F7**: carga pública do DATASUS. Os relatórios epidemiológicos e os indicadores do hospital novo agrupam por capítulo | 08 (terminologias) | `capitulo_cid`, `grupo_cid` |
| 22 | SNOMED CT, regiões e localizações anatômicas, lateralidade | DBAMV `SNOMEDCT*`, `TERMINOLOGIA_CLINICA`, `REGIAO_ANATOMICA*`, `LOCALIZACAO_ANATOMICA`, `SUBLOCALIZACAO_ANATOMICA`, `LATERALIDADE_EXAME`: 14 / 2 | Não tem | Não tem | **F8**: valor para a interoperabilidade; a RNDS de hoje não exige | 08 | — |
| 23 | Catálogo farmacêutico: interação entre substâncias, substância por produto, forma farmacêutica, via, medida caseira | DBAMV `SUBS_INTERACAO`, `SUBS_PRO`, `FORMA_FARMACEUTICA`, `PRESCRICAO_MEDICA_VIA`, `MEDIDA_CASEIRA`, `LISTA_CODIGO_MEDICAMENTO`: 6 / 4 | Coberto pelo catálogo prescritível do grupo 03 | Apoio à decisão do grupo 03 (F3) | **F3**: já tem dono (03, apoio à decisão e catálogo). Só falta a evidência; nenhuma entidade nova além de `interacao_medicamentosa` | 03 | — |
| 24 | Auditoria das checagens de enfermagem (amostra, auditor, justificativa) | DBAMV `AUDITORIA_CHECAGEM_PRESCRICAO`, `AUDITORIA_CHEC_PRESC_USUARIOS`, `ITEM_CHECAGEM*`, `GRUPO_CHECAGEM`, `JUSTIFICATIVA_CHECAGEM`, `ESPELHO_AUDITORIA_PRESCRICAO`: 13 / 3 | Não tem | A checagem está no grupo 03 (F3); a auditoria, não | **F8**: controle de qualidade sobre a checagem, que já é F3 | 03 | — |
| 25 | Categoria clínica do paciente com valor e produção hospitalar mensal (movimento, produtividade, pontualidade) | DBAMV `MOV_CATEGORIA_CLINICA`, `IT_VALOR_CATEGORIA_CLINICA`, `MOV_HOSP`, `PRODUCAO_MENSAL`, `IND_PRODUTIVIDADE`, `IND_ONTIME`: 17 / 1 | Coberto pelo censo (grupo 04) | Classificação de pacientes (03) e indicadores (01) | **F8**: indicador derivado. A classificação de pacientes e o censo já estão cobertos | 01 | — |
| 26 | Acordo de nível de serviço por modelo, faixa e horário | DBAMV `SLA_*`, `ITEM_CONFIGURACAO_SLA`: 7 / 0 | Não tem | Não tem | **F8**: o grupo 07 já põe o SLA de contrato na F8, e aqui a decisão é a mesma | 07 | — |
| 27 | Localização para outros países (catálogos do México, Chile e República Dominicana; orçamento em espanhol) | DBAMV `CLUES`, `MEDICAMENTO_MEXICO`, `CATTIPO*`, `CATMOTEGRESO`, `COD_PRO_FONASA`, `COD_PRO_CPT`, `CITIES`, `SERVICIO`, `ITEM_PRESUPOSTARIO`, `RETORNO_XML_ARS_UNIV`, `IMPORTA_RECHARZO`: 17 / 5 | Não tem | Não tem | **NAO**: fora do mercado-alvo | — | — |
| 28 | Tradução de telas e mensagens em tempo de execução | DBAMV `RMI_*`: 13 / 11 | Não tem | i18n no código | **NAO**: segue o grupo 01 (o texto da tela fica no código) | — | — |
| 29 | Técnico do fornecedor: sessão única do servidor de autenticação, travas, erros de SQL, exportadores, gerador de relatório, temporárias, coletor portátil | DBAMV `TICKETGRANTINGTICKET`, `SERVICETICKET`, `PROXYGRANTINGTICKETSTORAGE`, `LOCKS`, `CHAINED_ROWS`, `ERROS_SQL`, `EXPORT*`, `IMPORT_TABLE`, `RB_*`, `MVTEMP_*`, `PALM*`, `LIMPA_BASE`, `ROTINAS_*`, `DISPOSITIVO_USU*`: 53 / 24 | Não tem | Não tem | **NAO**: infraestrutura do fornecedor | — | — |

Observações:
- **Novo grupo de qualidade.** As áreas 2, 3 e 5 somam 135 tabelas (37 com dados) e têm módulo construído no
  new-sgh (M48). Proponho um grupo 10 de qualidade e segurança do paciente na próxima rodada, com a área 6
  (IRAS) e a fronteira de antimicrobianos (ver D4).
- **Cobertas sem citação.** Algumas funções aparecem no resíduo só porque o grupo dono não citou cada tabela.
  Não são lacunas:
  - as vacinas aplicadas e as curvas de crescimento: 9 tabelas, cobertas pelo grupo 03;
  - a devolução ao fornecedor: 10 tabelas, coberta pelo grupo 05;
  - a avaliação de antimicrobiano: coberta pelos grupos 03 e 05.
- **Recém-nascido.** A declaração de nascido vivo e o seu cancelamento ficaram dentro da obstetrícia do grupo
  03, na F8. Ver D13.

## 2. Contradições entre grupos

### 2.1 Mesma funcionalidade com decisões diferentes

| # | Funcionalidade | Decisões encontradas | Evidência que decide | Arbitragem proposta |
|---:|---|---|---|---|
| D1 | OPME: solicitação, autorização, consumo em sala, rastreio e conciliação | **04: F3** (linha "OPME", sem justificativa); **05: F7** (rastreio e autorização exigidos de hospital cirúrgico); **06: F7** (OPME na guia) | O SPDATA só tem a categoria de fornecimento e a opção de fabricante da TISS (`TBCATEGO` 2, `TBTISSOPFABRIC` 3). Não há movimento de OPME na matriz | **F7** nos três grupos. Um só fluxo do pedido à guia: o 05 é dono da solicitação, do consumo e do rastreio, e o 06 da guia. Se o ProntoCardio usar OPME hoje fora do sistema, o dono decide se sobe para F3 |
| D2 | Cotação eletrônica em portal de compras, inclusive de OPME | **05: F3** (o comprador cota todo dia, também em portal); **08: F3** (o vínculo do pedido ao portal está em uso); **04: NAO** (cotação de OPME em portal de terceiro); **05: NAO** (integrações específicas com portais) | O uso está documentado nos grupos 05 e 08 | **F3** para o vínculo do pedido ao portal e para a resposta da cotação. **NAO** só para as tabelas de troca do fornecedor. A linha NAO do grupo 04 tem de ser lida como "tabelas de troca do fornecedor", não como "não fazer cotação de OPME". Dono: 05 |
| D3 | Declaração de óbito: registro, numeração, cancelamento | **03: F3** (obrigatória quando há óbito); **02: F7** (no cadastro); **04: F7** (registro, numeração e cancelamento) | O SPDATA tem o desfecho "óbito" na internação (`TBDESFECHO_INTERNACAO`, 9) e no recém-nascido (`TBALTARN`, 4). Há internação e óbito na Rede hoje | **F3**. Dono: 03 (documento clínico). O cadastro (02) só marca o paciente como falecido, a partir da declaração. A numeração dos formulários fica com o 04 |
| D4 | Controle de antimicrobianos: ficha de justificativa, liberação pela farmácia, auditoria pela CCIH | **03: F7** (programa da Anvisa); **05: F3** (o histórico precisa migrar); **04: F8** (só a profilaxia cirúrgica) | O SPDATA tem fichas e pedidos de antimicrobiano de 2020 a 11/2024 (`GEANTIMI` 72, `GECADANTIMI` 45), com destino "migrar-leitura" | **F3** para a ficha e a liberação, pelo histórico que migra. A auditoria da profilaxia cirúrgica fica na F8. Uma só `ficha_antimicrobiano`, com dono no 03 (prescrição). A liberação fica no 05 |
| D5 | Terapia nutricional | **03: F3** (a dieta é prescrita todo dia); **04: F7** (triagem e terapia nutricional da equipe multiprofissional) | A dieta é prescrita no SPDATA todos os dias | Separar em duas: a **prescrição** da dieta e da terapia nutricional é **F3** (03); a triagem, as metas e o acompanhamento da equipe são **F7** (04). A entidade `terapia_nutricional` fica com o 03, e o 04 acrescenta a meta e o acompanhamento |
| D6 | Caução e adiantamento do paciente particular | **06: F3** (o particular paga no caixa do hospital, com `caucao` e `adiantamento_paciente`); **07: F7** (comum no particular eletivo; proibido como condição na urgência) | A matriz do SPDATA não tem caução de paciente. O adiantamento que existe é a fornecedor e a médico (`MFADIFOR`) | **F7** para a caução e o adiantamento do paciente. O caixa e o recebimento do particular continuam **F3**. Dono: 07, com a regra da Lei 12.653/2012 no domínio |
| D7 | Gestão de contratos com fornecedores | **05: F8**; **07: F7** (auditoria e acreditação cobram); **04: F8** (contratos de manutenção) | Não há contrato de fornecedor no SPDATA | **F7** para o núcleo do contrato: vigência, aditivo, reajuste, saldo, ocorrência e avaliação. SLA e apontamento ficam na F8. Dono: 07. O contrato de manutenção do 04 vira um tipo de contrato, não uma entidade à parte |
| D8 | Empenho (compras públicas e orçamento público) | **05: F7** (licitação, pregão, ata e empenho, com `empenho`); **07: F8** (orçamento público com programa, função, teto e empenho) | Não há uso na Rede | Decidir uma vez se o alvo inclui filantrópico com recurso público. Se incluir, as duas linhas vão para **F7**, com um só `empenho` no 05 e a parte orçamentária no 07. Se não incluir, as duas vão para F8 |
| D9 | Regulação de leitos e de consultas pela central estadual | **08: F3** (configurada no SPDATA, e o hospital recebe pacientes regulados); **02: F7** (recepção de pedidos da central); **04: F7** (solicitação à central com o quadro clínico) | O SPDATA tem serviços e tabelas de regulação estadual em uso (`TBREGUL_SERVICO` 42, `TBREGUL_VLR_TABELAS` 253, `RISITREGLEITO` 23) | **F3** nos três grupos. Dono do fluxo: 04 (internação), com o 08 na integração e o 02 na entrada do paciente regulado |
| D10 | Elegibilidade e autorização eletrônica com a operadora (TISS) | **08: F3** (o faturamento da Rede Santé usa); **02: F7** (crítica de elegibilidade na recepção); **06: F7** (elegibilidade e comunicação de internação e alta) | O SPDATA tem operação de serviço web de elegibilidade (`TBOPERSCHEMA`, 3) e o tipo de anexo "elegibilidade" (`PRTIPODOCANEXO`, 20) | **F3** para a consulta e a autorização eletrônica que a Rede já faz. A regra que bloqueia o atendimento sem elegibilidade fica **F7**. Dono: 06 |
| D11 | Data mart analítico | **01: F3** (os painéis leem dele, fora do banco transacional); **02: NAO** e **05: NAO** (dimensões e cubos do fornecedor) | — | Não há conflito de mérito: os três dizem que o data mart nasce do nosso modelo. Só o rótulo diverge. Basta registrar: "data mart próprio F3 (grupo 01); cópia do data mart do fornecedor NAO" |
| D12 | Painel do pronto atendimento e classificação externa | **08: F3** (perfis de prioridade enviados ao sistema de triagem externo) | A classificação interna não tinha dono | Coerente com a área 1 da seção 1 (F3). Dono da classificação: 03, com o 08 na troca externa |
| D13 | Declarações legais do nascimento e do óbito | Óbito: F3 ou F7 (ver D3). Declaração de nascido vivo: **F8**, dentro de "Obstetrícia e recém-nascido" (03) | O SPDATA tem o tipo de recém-nascido (`TBTPRN`, 3) e o desfecho do RN (`TBALTARN`, 4) | Aplicar o mesmo princípio aos dois documentos. A declaração de nascido vivo é obrigação legal de quem faz parto (Lei 12.662/2012): **F7**, ou F3 se o ProntoCardio fizer partos. O partograma continua F8 |

### 2.2 Mesma entidade proposta por mais de um grupo

**49 nomes** aparecem em dois grupos ou mais. `solicitacao_opme` aparece em três: 04, 05 e 06. Isso não é erro
de nome, mas o DDL precisa de um só dono por entidade.

| Entidade | Grupos | Dono proposto | Motivo |
|---|---|---|---|
| `estabelecimento`, `logotipo_estabelecimento` | 01, 02 | 02 | cadastro-base; o 01 só lê pelo escopo de acesso |
| `alcada_aprovacao` | 01, 05 | 01 | mecanismo transversal (ver 2.3) |
| `assinatura_documento` | 01, 03 | 01 | serviço transversal; o 03 guarda a pendência |
| `declaracao_obito` | 03, 04 | 03 | D3 |
| `registro_obito` | 02, 04 | — (some) | fica como atributo do paciente, derivado da `declaracao_obito` |
| `alta_medica`, `pendencia_prontuario`, `solicitacao_copia_prontuario` | 03, 04 | `alta_medica`: 03; as duas outras: 04 (SAME) | o documento é do PEP; a guarda física e a cópia são do SAME |
| `terapia_nutricional` | 03, 04 | 03 | D5 |
| `avaliacao_farmaceutica`, `intervencao_farmaceutica`, `tipo_intervencao_farmaceutica`, `ficha_antimicrobiano`, `unidade_prescricao` | 03, 05 | 03 (prescrição); 05 só na liberação e na dispensação | D4 |
| `ciclo_esterilizacao`, `ciclo_esterilizacao_item`, `equipamento_esterilizacao`, `caixa_instrumental`, `caixa_instrumental_item`, `solicitacao_material_esteril` | 04, 05 | 04 (CME) | o 05 só fornece o insumo |
| `solicitacao_opme`, `solicitacao_opme_item`, `autorizacao_opme`, `consumo_opme`, `conciliacao_opme` | 04, 05 (06 só em `solicitacao_opme`) | 05 | D1 |
| `bem_patrimonial`, `baixa_bem`, `cota_depreciacao` | 04, 07 | 07 | patrimônio é contábil; o 04 usa o bem na manutenção |
| `apuracao_repasse`, `base_calculo_repasse`, `evento_repasse`, `lancamento_repasse`, `regra_repasse`, `versao_regra_repasse`, `cooperativa_medica`, `natureza_rendimento`, `recibo` | 06, 07 | 06 (repasse); 07 (`recibo`, `natureza_rendimento`) | o repasse nasce do faturado; o pagamento é do financeiro |
| `adiantamento_paciente` | 06, 07 | 07 | D6 |
| `avaliacao_fornecedor` | 05, 07 | 05 | cadastro de fornecedor; o 07 só referencia pelo contrato |
| `consulta_elegibilidade` | 02, 06 | 06 | D10 |
| `servico_regulacao` | 04, 08 | 04 | D9 |
| `interface_equipamento`, `laboratorio_apoio`, `modalidade_imagem`, `item_lista_trabalho_imagem`, `visualizador_imagem`, `perfil_portal_resultado`, `portal_cotacao` | 05, 08 | 05 (negócio); o 08 só no canal e no mapeamento | a regra do exame é do diagnóstico; a mensagem é da integração |

### 2.3 Mesmo conceito com nomes diferentes

Estes casos não aparecem como repetição exata, mas descrevem a mesma coisa. Para cada um proponho um nome só.

| Conceito | Nomes propostos pelos grupos | Nome único proposto |
|---|---|---|
| Declaração de óbito | `registro_obito` (02, 04), `declaracao_obito` (03, 04), `cancelamento_declaracao_obito` (04) | `declaracao_obito` (com situação e cancelamento) |
| Unificação de cadastro duplicado | `unificacao_cadastro`, `unificacao_item` (01); `unificacao_prontuario`, `suspeita_duplicidade` (02) | `unificacao_cadastro`, `unificacao_cadastro_item`, `suspeita_duplicidade` (dono 02) |
| Feriado e dia não útil | `feriado` (01); `dia_nao_util` (02) | `dia_nao_util` com abrangência (dono 02) |
| Unidade do estabelecimento | `unidade_atendimento` (01); `unidade_assistencial` (02); `unidade_internacao` (04) | `unidade_assistencial` (02), com `unidade_internacao` como especialização no 04 |
| Grupo econômico acima do hospital | `rede`, `empresa` (01); `mantenedora` (02) | `mantenedora` e `rede`, sem `empresa` solta |
| Centro de custo | `centro_custo_gerencial` (02); os grupos 05, 06 e 07 referenciam `centro_custo`, mas nenhum propõe a entidade | `centro_custo` (dono 07), com `classificacao_centro_custo` |
| Fonte pagadora | `plano_fonte_pagadora`, `parametro_fonte_pagadora` (02); `contrato_pagador`, `guia_pagador`, `endpoint_tiss_pagador` (06); `credito_convenio`, `premissa_recebimento_convenio` (07); `consulta_elegibilidade_convenio`, `credencial_convenio` (08) | um termo só, `fonte_pagadora`, como no ADR (vocabulário neutro): `contrato_fonte_pagadora`, `credito_fonte_pagadora` etc. |
| Elegibilidade | `consulta_elegibilidade` (02, 06); `consulta_elegibilidade_convenio` (08); `consulta_elegibilidade_plano` (08, lado da operadora) | `consulta_elegibilidade` (hospital) e `consulta_elegibilidade_recebida` (operadora) |
| Autorização da operadora, lado do hospital | `autorizacao_operadora` (02); `solicitacao_autorizacao`, `resposta_autorizacao`, `item_solicitacao_autorizacao` (06); `autorizacao_internacao` (04); `etapa_autorizacao_cirurgia` (04) | `solicitacao_autorizacao` com tipo (consulta, SADT, internação, prorrogação, cirurgia, OPME) e `resposta_autorizacao` (dono 06) |
| Regulação | `pedido_regulacao`, `evento_regulacao` (02); `solicitacao_regulacao`, `evolucao_regulacao`, `central_reguladora` (04); `solicitacao_regulacao_externa`, `sistema_regulacao` (08) | `solicitacao_regulacao`, `evento_regulacao`, `central_reguladora` (dono 04) |
| Item da solicitação de OPME | `solicitacao_opme_item` (04, 05); `item_solicitacao_opme` (06) | `solicitacao_opme_item` |
| Aprovação de OPME | `autorizacao_opme` (04, 05: da operadora); `aprovacao_opme` (06); `alcada_aprovacao_opme` (04) | `autorizacao_opme` (operadora) e a alçada pelo mecanismo comum |
| Alçada de aprovação | `alcada_aprovacao` (01, 05); `alcada_aprovacao_opme` (04); `alcada_ajuste`, `alcada_faturamento` (06); `alcada_financeira`, `limite_alcada_usuario`, `pedido_aprovacao`, `decisao_aprovacao` (07) | um mecanismo só: `alcada_aprovacao` (regra por tipo de documento e valor), `pedido_aprovacao` e `decisao_aprovacao` (dono 01) |
| Caixa do particular | `caixa`, `movimento_caixa`, `recebimento_particular` (06); `sessao_caixa`, `recebimento_balcao`, `sangria_caixa` (07) | `caixa`, `sessao_caixa`, `movimento_caixa`, `recebimento_particular` (dono 07) |
| Caução e adiantamento do paciente | `caucao`, `adiantamento_paciente` (06); `adiantamento_paciente`, `contrato_adiantamento_paciente`, `aplicacao_adiantamento_paciente` (07) | sem `caucao` à parte: a caução é um `adiantamento_paciente` de tipo caução (dono 07) |
| Item da apuração de repasse | `item_repasse` (06); `item_apuracao_repasse` (07) | `item_apuracao_repasse` |
| Membro de cooperativa | `membro_cooperativa` (06); `cooperado` (07) | `membro_cooperativa` |
| Patrimônio | `movimento_bem`, `inventario_bem`, `plaqueta_bem` (04); `movimentacao_bem`, `inventario_patrimonial`, `plaqueta` (07) | `movimento_bem`, `inventario_bem`, `plaqueta_bem` (dono 07) |
| Rastreio do material esterilizado | `pacote_esteril`, `uso_pacote_esteril`, `metodo_esterilizacao` (04); `etiqueta_esteril`, `kit_rastreavel`, `kit_rastreavel_item`, `indicador_ciclo` (05) | `pacote_esteril` (o que é processado) e `uso_pacote_esteril` (o uso no paciente), dono 04. O `kit_rastreavel` do 05 serve só a kits de material não estéril |
| Protocolo de envio de documentos entre setores | `protocolo_tramite`, `protocolo_tramite_item` (04, SAME); `protocolo_documento`, `item_protocolo_documento` (06, conta) | `protocolo_tramite` com o tipo de conteúdo (prontuário, conta, documento) |
| Pendência de documento | `pendencia_prontuario`, `tipo_pendencia_prontuario` (03, 04); `pendencia_conta`, `tipo_pendencia_conta` (06); `pendencia_assinatura` (03) | uma `pendencia` com o tipo e o alvo, ou as três mantidas com tipo comum. É preciso decidir antes do DDL |
| Regras de alerta | `regra_alerta`, `alerta_gatilho` (01); `regra_alerta_clinico`, `regra_alerta_versao` (03, apoio à decisão); `regra_aviso_clinico`, `aviso_clinico` (03, avisos) | um motor de regra só: `regra_alerta` com versão (dono 01), e `aviso_clinico` como saída no 03 |
| Política de assinatura | `politica_assinatura` (01); `politica_assinatura_tipo` (03) | `politica_assinatura` por tipo de documento (dono 01) |
| Termo de uso e de consentimento | `aceite_termo_uso`, `termo_uso_versao`, `termo_consentimento` (01); `termo_uso_aceite`, `termo_consentimento_modelo`, `termo_consentimento_paciente` (03); `modelo_termo`, `aceite_termo` (02) | `termo_uso_versao` e `aceite_termo_uso` (01); `termo_consentimento_modelo` e `termo_consentimento_paciente` (03); sem `modelo_termo` genérico |
| Terminologias e tabelas de referência | `terminologia`, `termo_terminologia`, `tabela_referencia_preco` (08); `terminologia_tiss`, `termo_tiss` (06); `edicao_referencia_matmed`, `item_referencia_matmed` (06) | `terminologia` e `termo_terminologia` (dono 08), com a TISS como uma das terminologias; a referência de preço de mat/med fica no 06 |
| Comunicação com o equipamento e a imagem | `modelo_comunicacao`, `evento_status_imagem` (05); `modelo_comunicacao_interface`, `status_execucao_imagem` (08) | `modelo_comunicacao` e `evento_status_imagem` (dono 05) |
| Orçamento ao particular | `orcamento_exame`, `orcamento_exame_item` (05); `orcamento_particular`, `item_orcamento_particular`, `modelo_orcamento` (06) | `orcamento_particular` com item de qualquer tipo (dono 06) |
| Parâmetros | mecanismo genérico `parametro_definicao`, `parametro_valor`, `parametro_valor_historico` (01) e, ao mesmo tempo, tabelas por módulo: `parametro_estabelecimento` (02), `parametro_prontuario` (03), `parametro_internacao` (04), `parametro_estoque` (05), `parametro_faturamento` (06), `parametro_financeiro` (07), `parametro_operadora` (08) e outras | decidir no ADR: ou o mecanismo genérico do 01 com o catálogo de chaves por módulo (recomendado), ou uma tabela por módulo, sem os dois |

### 2.4 Tabelas do MV contadas mais de uma vez

A soma das tabelas que os grupos declararam é **8.682**:

| Grupo | Tabelas declaradas |
|---|---:|
| 01 | 1.636 |
| 02 | 470 |
| 03 | 771 |
| 04 | 567 |
| 05 | 1.018 |
| 06 | 859 |
| 07 | 993 |
| 08 | 2.368 |
| **Total** | **8.682** |

O número parece perto do total do MV (8.867), mas inclui contagens duplas. Por isso a seção 1 ainda encontra
630 tabelas sem dono. As duplas conhecidas:

| Recorte | Contado em | Observação |
|---|---|---|
| Data mart (dimensões e fatos) | 01 (210, esquema inteiro), 02 (paciente, atendimento, convênio), 05 (20: exame, estoque, compras) | contar só no 01 |
| Cópias espelho da troca de paciente | 01 (35, unificação) e 02 (23, NAO) | contar só no 02; a decisão do 01 (unificação F3) não muda |
| OPME e integrações de portal de OPME | 04, 05 e 08 | contar no 05 |
| CME | 04 e 05 | contar no 04 |
| Repasse médico | 06 e 07 | contar no 06 |
| Patrimônio | 04 e 07 | contar no 07 |
| Caução e recibo | 06 e 07 | contar no 07 |
| Contratos com fornecedores | 05 e 07 | contar no 07 |
| Painel de chamada e painéis de TV | 01 e 02 | contar no 02 (chamada) e no 01 (TV) |
| Antimicrobianos | 03, 04 e 05 | contar no 03 |

## 3. Tabela-resumo consolidada

Fonte: as linhas das matrizes de cobertura de cada arquivo, contadas por mim. Elas batem com o resumo numérico
de cada grupo. "Entidades" são as propostas nas linhas F3 e F7, distintas dentro do grupo.

| Grupo | Tabelas MV declaradas | Funcionalidades | F3 | F7 | F8 | NAO | Entidades (F3+F7) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 01 Administração, segurança, BI | 1.636 | 55 | 33 | 2 | 8 | 12 | 110 |
| 02 Cadastro, recepção e agenda | 470 | 59 | 36 | 5 | 14 | 4 | 115 |
| 03 Prontuário | 771 | 61 | 35 | 8 | 15 | 3 | 139 |
| 04 Internação, cirurgia, CME e hotelaria | 567 | 66 | 30 | 17 | 16 | 3 | 186 |
| 05 Diagnóstico e suprimentos | 1.018 | 59 | 36 | 10 | 9 | 4 | 232 |
| 06 Faturamento | 859 | 65 | 40 | 15 | 9 | 1 | 227 |
| 07 Financeiro, fiscal, contábil e pessoas | 993 | 69 | 20 | 26 | 16 | 7 | 228 |
| 08 Operadora e integrações | 2.368 | 48 | 15 | 19 | 6 | 8 | 161 |
| **Subtotal dos oito grupos** | **8.682** | **482** | **245** | **102** | **93** | **42** | **1.398** |
| 09 Áreas sem dono (esta análise) | 630 | 29 | 2 | 7 | 11 | 9 | 28 |
| **Total** | — | **511** | **247** | **109** | **104** | **51** | **1.426** |

Leitura das entidades:
- As 1.398 entidades dos oito grupos são **1.348 nomes distintos**: 49 nomes repetem em dois grupos, e
  `solicitacao_opme` em três (ver 2.2).
- Os nomes diferentes para o mesmo conceito (2.3) reduzem ainda mais o número real. Contei 28 conceitos, e
  cada um junta de dois a oito nomes.
- Com as 28 entidades novas das áreas sem dono, o total distinto antes da unificação de nomes é
  **1.376** (1.348 + 28).

Efeito das arbitragens da seção 2.1, se aceitas:

| Arbitragem | De | Para |
|---|---|---|
| D1 OPME (grupo 04) | F3 | F7 |
| D3 óbito (grupos 02 e 04) | F7 | F3 |
| D4 antimicrobianos (grupo 03) | F7 | F3 |
| D6 caução (grupo 06) | F3 | F7; o caixa fica F3 |
| D7 contratos com fornecedores (grupo 05) | F8 | F7 |
| D9 regulação (grupos 02 e 04) | F7 | F3 |
| D10 elegibilidade e autorização (grupos 02 e 06) | F7 | F3 (a regra de bloqueio fica F7) |
| D13 nascido vivo (grupo 03) | F8 | F7 |

A paridade (F3) cresce em cerca de seis funcionalidades. Isso pesa na ordem de construção, porque **regulação,
elegibilidade, óbito e antimicrobianos** passam a ser condição da virada.

## Próximos passos sugeridos

1. Abrir o **grupo 10, qualidade e segurança do paciente**, com as áreas 2, 3, 5 e 6. Elas somam 154 tabelas e
   já têm módulo no new-sgh (M48).
2. O dono do projeto valida as arbitragens D1 a D13, principalmente D8: se o alvo inclui hospital com recurso
   público.
3. Fechar no ADR o **vocabulário único**:
   - "fonte pagadora" no lugar de convênio, pagador e plano no lado do hospital;
   - o mecanismo único de parâmetros, de alçada, de pendência e de regra de alerta.
4. Antes do DDL, aplicar a coluna "dono proposto" de 2.2 e 2.3, para que cada entidade nasça uma vez só.
