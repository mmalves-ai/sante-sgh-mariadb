# Análise cruzada 03: prontuário eletrônico (PEP)

Grupo: **PEP**. Cobre o prontuário, a prescrição, os registros clínicos (evolução, anamnese,
admissão), a enfermagem à beira do leito, os documentos clínicos e a assinatura deles. Data: 2026-11-20.
Base: ADR 0001 (banco próprio em MariaDB 12.3, virada por conector diferencial a partir do SPDATA).

Fontes lidas (somente leitura):

- **MV:** `referencias/mv-tabelas.tsv`, classificado por esquema, prefixo e descritivo com um script de
  regras conferido tabela a tabela. Entram no grupo:
  - o prefixo do prontuário web (468 tabelas, todas classificadas);
  - os prefixos do editor de documentos, da prescrição e seus horários, do catálogo de itens
    prescritíveis, da SAE, dos sinais vitais, do balanço, dos objetos e fórmulas do prontuário e das
    notificações;
  - as tabelas avulsas de alergia, diagnóstico, parecer, receita, atestado, termo, óbito, anexo e
    dispositivo invasivo;
  - os esquemas `CARTORIO` (assinatura), `MVINTEGRA` (integração do PEP) e o prefixo de notificação
    inteligente de `DBACP`.

  Só foram lidos nomes e descritivos de tabela. Nenhuma linha de dados foi lida.
- **SPDATA:** `new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`. Inclui o módulo PEP
  inteiro (222 tabelas) e as tabelas de outros módulos ligadas ao prontuário: alergias e CID em CAD,
  termo de uso do PEP em ADM, ficha anestésica em CC e modelo de relatório em REL.
- **new-sgh:**
  - os pacotes `dominio-pep`, `dominio-enfermagem`, `dominio-documento` e `dominio-qualidade`;
  - as rotas de `apps/api/src/modulos/pep`, `enfermagem`, `assinatura` e `documento`;
  - as telas de `apps/web/src/modulos/pep` e `enfermagem`;
  - `docs/modulos/pep.md` e `planejamento/ESTADO.md`: marcos M15, M22 a M25, M29, M44, M45.1 a M45.6,
    M46, M49.1 a M49.3 e as decisões D-ALE-2, D-CRUD-1, D-LIB-2, D-REV-24, DP-19, DP-24 e DP-26.

Convenções:

- **Coluna MV, "n/d":** n tabelas do MV na funcionalidade, das quais d têm dados na cópia de referência.
  Os exemplos vêm entre parênteses, com `*` nos que têm dados. Cada tabela do MV conta numa única
  funcionalidade.
- **Coluna SPDATA:** o volume de linhas da matriz é o indicador de uso real. A matriz conta até 1.001,
  então "≥1k" significa uso real pleno; a descrição da matriz dá o volume quando ela o informa.
  - **"Domínio"**: tabela de valores possíveis, sem movimento.
  - **"Sem uso"**: a matriz registra o recurso como abandonado ou só com um valor fictício.
- Os nomes de tabela do MV e do SPDATA aparecem só nas colunas de evidência. As entidades próprias usam
  nomes nossos, em snake_case. Um script conferiu todos os 139 nomes contra todos os nomes de tabela
  do MV e do SPDATA: nenhum coincide.
- **Nenhuma regra de negócio fica em gatilho.** Hoje o SPDATA usa gatilho para:
  - exigir o conjunto completo de quem suspende a prescrição;
  - gravar a trilha documental de cada documento;
  - montar o retrato do atendimento.

  No modelo novo, cada uma dessas coisas é um serviço de domínio, com o evento na mesma transação.
  - **Trilha documental:** tabela de eventos com encadeamento por hash.
  - **Retrato do atendimento:** guardado no evento do documento que o usa. Não há tabela de retrato
    preenchida por gatilho.

## Resumo numérico

- **MV:** 771 tabelas no grupo, das quais 222 com dados, agrupadas em **61 funcionalidades**.
  - 58 funcionalidades têm evidência no MV.
  - 3 existem só no SPDATA ou no new-sgh: notificação de agravos, oftalmologia e os recursos de
    enfermagem próprios do new-sgh.
- **SPDATA:** 222 tabelas do módulo PEP. Destino na matriz:
  - 37 com movimento a migrar;
  - 147 cadastros;
  - 23 só para consulta;
  - 11 de carga de referência;
  - 4 a descartar.

  O uso real está concentrado nestas tabelas, todas com ≥1k linhas:
  - registros clínicos (cerca de 769 mil cabeçalhos);
  - trilha documental (cerca de 1,4 milhão de eventos);
  - prescrição (cabeçalho, linhas e os detalhes de cada tipo de item);
  - aprazamento e checagem (mais de 2 milhões de horários);
  - receitas, atestados, alergias e altas.
- **new-sgh:** o grupo está quase todo construído, nos marcos M15, M22 a M25, M45, M46 e M49. Está
  "aguardando validação", e várias operações seguem desligadas até a conferência dos chave-usuários
  (DP-3) ou até o cenário controlado (M36).

| Decisão | Funcionalidades | Tabelas MV (com dados) |
|---|---:|---:|
| F3 Paridade | 35 | 458 (162) |
| F7 Hospital do zero | 8 | 110 (40) |
| F8 Recurso novo | 15 | 157 (9) |
| NAO | 3 | 46 (11) |
| **Total** | **61** | **771 (222)** |

As 35 funcionalidades F3 e as 8 F7 somam **139 entidades próprias** (ver a última coluna da tabela).

## Matriz de cobertura

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Painel de pacientes do profissional: lista de trabalho por unidade ou leito, filtros salvos, colunas escolhidas e pacientes acompanhados | 16/8 (PW_CENARIO\*, PW_FAVORITO_PACIENTE\*, PW_LISTA_EM_ATENDIMENTO, PEP_SETOR_LISTA_PACIENTE) | PRFAVORITO (672), PRFAVORITO_EXIBIR (≥1k), PRCAMPOSLOCALIZACAOPACIENTE (13) | Construído: Meus pacientes (`MeusPacientesTela`), worklist de pendências e de "sem evolução" (`dominio-pep/worklist`), M23 | F3: é a porta de entrada diária do médico e da enfermagem | painel_filtro_usuario, painel_coluna_usuario, paciente_acompanhado |
| Parâmetros e preferências do prontuário por estabelecimento, setor e usuário | 7/3 (PW_CONFIGURACAO_PADRAO_ITEM\*, PEPWEB_PARAMETROS, PW_SETOR_TIPO_ATENDIMENTO) | PRPARAM (1), PRLOCPACDEFAULT (524: retroativo, assinatura, permissões), PRLOCAL_ASSISTENCIA (44) | Parâmetros `pep.*` construídos; cadastros do PEP no CRUD genérico ainda pendentes (D-CRUD-1) | F3: a tolerância do retroativo e a assinatura exigida dependem disso | parametro_prontuario, preferencia_prontuario_usuario |
| Controle e trilha de acesso ao prontuário: vínculo assistencial, quebra de vidro com justificativa, aceite do termo de uso e registro de cada leitura | 6/1 (LOG_ACESSO_PEP, AUTORIZACAO_ACESSO_PRONTUARIO, PW_REGISTRO_AUDITORIA\*, REG_JUSTV_ACES_PAC_S_LEIT_PULS) | PRTERMOACEITE (814, ADM), PRTERMOCAD (1), PRLOCPACDEFAULT (permissões) | Construído: `AcessoPacientePep`, trilha dupla e alertas ao Auditor (M15/M22), `AcessosProntuarioTela`, consulta na rede (`acesso-rede`); ligar a consulta depende de DP-40 e do pentest | F3: obrigação da LGPD e do CFM; já é usado | acesso_prontuario_evento, quebra_sigilo_justificativa, termo_uso_aceite, restricao_sigilo_paciente |
| Prontuário de acesso restrito (paciente sigiloso), com pedido de acesso, autorização por equipe, senha do paciente e contagem de acessos | 13/1 (PW_CENTRAL_PACIENTE_VIP, PW_CENTRAL_ACESSO_SOLICITADO, PW_CONFIG_PADRAO_PRONT_VIP\*) | Não tem | Parcial: sigilo por categoria (psicologia, `sigilo-categoria`) e quebra de vidro; não há fluxo de pedido e autorização | F8: valor real para pacientes públicos, mas a quebra de vidro cobre a virada | — |
| Equipe assistencial do paciente: quem cuida, com função e especialidade, usada para liberar o acesso e as pendências | 7/0 (PW_EQUIPE_ASSISTENCIAL, PW_PRESTADOR_ASSISTENCIAL, PW_CAD_FUNCAO_MEDICA) | Profissionais gravados no retrato do atendimento (HTATENDIMENTO, ≥1k) | Construído: vínculo assistencial calculado no acesso (M15) | F3: o controle de acesso precisa do vínculo explícito | equipe_assistencial_paciente, equipe_assistencial_membro |
| Construtor de modelos de documento clínico: campos, opções, regras de habilitar e calcular, layout de tela e de impressão, versões publicadas | 72/39 (EDITOR_DOCUMENTO\*, EDITOR_CAMPO\*, EDITOR_REGRA\*, EDITOR_LAYOUT\*, EDITOR_VERSAO_DOCUMENTO\*, PW_TIPO_DOCUMENTO\*, PAGU_OBJETO\*) | PREVOLUCAO (67 modelos), PRPERGUNTA (1.514 perguntas), PRRESPOSTA (3.849 opções), PRPADEVOL (≥1k), PRFORMULCOMP (≥1k, layout em componentes Delphi), PREVOLESPEC (≥1k), PRTPCOMP (7), PRTPPERGUNTA (24) | Construído: renderizador do layout legado com regras em JSON Logic (M22) e o construtor novo com casos de teste, revisão por comissão e publicação imutável (M45.1, desligado) | F3: os 67 modelos em uso precisam ser convertidos para o formato próprio antes da virada | modelo_documento_clinico, modelo_documento_versao, modelo_campo, modelo_campo_opcao, modelo_regra, modelo_layout, tipo_documento_clinico |
| Registro clínico em modelo (evolução, anamnese, admissão, sumários), com rascunho, correção ligada ao original e suspensão pelo autor | 13/8 (EDITOR_REGISTRO\*, EDITOR_REGISTRO_CAMPO\*, EDITOR_HIST_REGISTRO\*, PW_DOCUMENTO_CLINICO\*) | PRCABEVOL (cerca de 769 mil), PREVOLPAC (≥1k), PRCONTEVOL (≥1k), rascunhos PRCABEVOLTMP e PREVOLPACTMP (≥1k) | Construído: `pep.registrarEvolucao` e rascunho com colisão 409 (M22). Só 3 modelos liberados; 7 ficam abaixo de 99,5% na conferência (D-LIB-2) | F3: é o maior volume clínico do SPDATA | registro_assistencial, registro_assistencial_resposta, registro_assistencial_versao, registro_assistencial_rascunho |
| Exame físico estruturado por sistema e região do corpo | 20/0 (PW_EXAME_FISICO, PW_EXA_FIS_PART_CORP_HUM, PW_ITEM_ORGAO_CORPO_HUMANO) | Não tem: o exame físico é feito por perguntas dos modelos | Não tem | F8: o construtor de modelos já atende; o mapa do corpo é melhoria | — |
| Nota clínica no formato subjetivo, objetivo, avaliação e plano, codificada pela CIAP | 18/0 (PW_SOAP, PW_CIAP_ATN, PW_CONFIG_SOAP) | Só a versão da CIAP (TBVERSAOCIAP, 1) | Catálogo CIAP carregado; não há nota estruturada | F8: útil no ambulatório e na atenção primária; dá para fazer como modelo | — |
| Escalas, índices prognósticos e questionários pontuados, com faixas versionadas e reavaliação | 24/6 (PAGU_FORMULA\*, PAGU_AVALIACAO\*, PW_QUESTIONARIO, PW_PONTUACAO_PACIENTE) | PRINDICEAGRUPAMENTO (21), PRINDICEVARIAVEL (109), PRINDICEPONTUACAO (121), PRGLASGOW (30), PRMANCHESTER (7) | Construído: M45.2 (NEWS2, Braden, Morse, Glasgow, RASS, CAM-ICU, dor, APACHE II, SOFA, Fugulin, NAS) e `indices-uti` | F3: os índices da UTI já são usados | escala_clinica, escala_clinica_versao, escala_clinica_faixa, aplicacao_escala, aplicacao_escala_item |
| Alergias e intolerâncias do paciente, com o princípio ativo, "nega alergias" e o histórico de mudanças | 16/10 (PW_ALERGIA_PAC\*, SUBS_PAC\*, SUBSTANCIA\*, HIST_SUBS_PAC\*) | PRALERGIAPAC (≥1k), PRALERGIAPAC_TBPRINC (≥1k), TBALERGIA (50, CAD), TBTPALERGIA (5), TBTPNOTIFICACAOALERGIA (3) | Construído: `pep.registrarAlergia` e `pep.inativarAlergia` (M23). A alergia registrada dentro do formulário não é gravada (D-ALE-2) | F3: alimenta o alerta da prescrição | alergeno, alergeno_principio_ativo, alergia_paciente, alergia_paciente_evento |
| Lista de problemas e diagnósticos do atendimento (principal e secundários, situação e quem é o sujeito do cuidado) | 16/5 (DIAGNOSTICO_ATENDIME\*, PW_PROBLEMA\*, CID_PEP_ATE, PW_PROBLEMA_PACIENTE) | Domínios TBLANC_DIAG_STATUS (7), TBLISTADIAGNOSTICOSITUACAO (7) e outros (2 cada); CID do atendimento no retrato (≥1k) | Construído: lista de problemas em versões (M23, só no novo) | F3: o CID do atendimento vai para a conta e para o sumário | problema_paciente, problema_paciente_versao, cid_atendimento |
| Notas e lembretes livres sobre o paciente | 4/0 (PW_OBSERVACAO_PACIENTE, PW_REGISTRO_OPINIAO_PACIENTE) | PRTPNOTALEMB (2, sem uso) | Não tem | F8: sem uso no SPDATA | — |
| Reações adversas a medicamento no paciente, com gravidade, item prescrito envolvido e evolução | 9/7 (PW_EVENTO_ADVERSO_PAC\*, PW_GRAU_EVENTO_ADVERSO\*, PW_HIST_EVENTO_ADVERSO_PAC\*) | Não tem | Núcleo de segurança do paciente (`dominio-qualidade/nsp`), com prazos da RDC 36/2013 e transcrição para o Notivisa | F7: a farmacovigilância é exigência sanitária para qualquer hospital | reacao_adversa_paciente, reacao_adversa_evento |
| Medicamentos de uso contínuo e reconciliação na admissão, na transferência e na alta | 2/0 (PW_MEDICAMENTO_USO, PRE_USO) | Não tem | Construído só no novo: `ReconciliacaoTela`, `pep.reconciliacao.registro` (M24) | F7: meta de segurança exigida pela acreditação | medicamento_uso_previo, reconciliacao_medicamentosa, reconciliacao_item |
| Prescrição médica eletrônica: vigência, itens por tipo (medicamento, solução, dieta, cuidado, ventilação, hemocomponente), cópia, renovação, adendo, suspensão e prescrição futura | 28/10 (PRE_MED\*, ITPRE_MED\*, HRITPRE_MED\*, LOG_PRESCRICAO\*) | PRPRESC, PRLANGERAL, PRPRESCMED, PRPRESCSOL, PRPRESCDIETA, PRPRESCPROCED, PRPRESCVI, PRPRESCVNI, PRVELOCINFUSAO (todas ≥1k), PRPRESCHEMO (910), PRPLANPRESC (15, abandonado) | Construído: M24, com impressão em PDF/A e `PrescricaoFuturaTela`. A chave `pep.prescricao.cpoe` aguarda a conferência; inclusão de item não padronizado desligada | F3: é o coração da internação | prescricao, prescricao_item, prescricao_item_medicamento, prescricao_item_solucao, prescricao_item_componente, prescricao_item_dieta, prescricao_item_cuidado, prescricao_item_ventilacao, prescricao_item_hemocomponente, prescricao_evento |
| Catálogo de itens prescritíveis, frequências, vias, unidades, condições "se necessário" e a grade de horários por unidade | 31/12 (TIP_PRESC\*, TIP_FRE\*, TIP_ESQ\*, FOR_APL\*) | PRTPLAN (19), PRFREQUENCIA (21), PRHRRELATIVA (13), TBHORARIODOSE (231), TBNUMDOSE (26), TBHORMED (3), PRSENECESSARIO (5), PRTPINFUSAO (8), PRUNIDINFUSAO (4), TBDIGITAL_VIAACESSO (64), PRITEMNAOPAD (29) | Construído: horários pela grade da unidade (`HorariosPadraoTela`). Frequências e itens não padronizados só em consulta | F3: sem o catálogo não há prescrição | item_prescritivel, frequencia_administracao, via_de_uso, unidade_prescricao, grade_horario_unidade, condicao_se_necessario |
| Protocolos de prescrição, kits de medicamentos e de soluções e favoritos do prescritor | 17/3 (PRE_PAD\*, ITPRE_PAD\*, PW_FAVORITO_PRESCRICAO) | PRPROTGERAL (377), PRKITMED (282), PRITENSKITMED (877), PRKITSOL (44), PRKITSOLITENS (169), PRPADRECEITA (628) | Só consulta (`CadastrosPrescricaoTela`). A receita padrão e os itens do protocolo ficam bloqueados (D-REV-24) | F3: os 377 protocolos são usados no dia a dia | protocolo_prescricao, protocolo_prescricao_item, kit_prescricao, kit_prescricao_item, favorito_prescritor |
| Apoio à decisão na prescrição: alergia, dose máxima, duplicidade, interação, ajuste renal, via e forma, alta vigilância, com a decisão registrada | 15/2 (PW_DOSE_MAXIMA, PW_RESTRICAO_POSOLOGIA, PW_CONFIG_ALERTAS_PRE_MED\*, PW_ITPRE_MED_ALERTA\*) | PRITEM_GEITENS (≥1k: dose mínima e máxima, alto risco), TBGRAUGRAVINT (3), TBTPINTMED (3), TBPROBOCINTMED (2), TBREFERENCIA (2), PRVALIDARMEDDUPLICPRESC (2) | Construído: motor de regras versionado com a decisão gravada (`dominio-pep/alertas`). Dose e interação aguardam a base contratada (DP-24) | F3: o SPDATA já alerta dose e duplicidade | regra_alerta_clinico, regra_alerta_versao, decisao_alerta, interacao_medicamentosa, limite_dose_principio |
| Avaliação farmacêutica da prescrição, com intervenção tipificada e troca de item | 13/3 (PW_AVALIACAO_PRE_MED\*, PW_AVALIACAO_ITPRE_MED\*, PW_TIPO_INTERVENCAO) | Situação "validado" no fluxo da ordem médica (TBSITUACAOMP, 7), TBMOTIVOMP (1) | Construído: `suprimentos.avaliacao` (M29), desligada até o plantão simulado | F3: a farmácia valida antes de dispensar | avaliacao_farmaceutica, intervencao_farmaceutica, tipo_intervencao_farmaceutica |
| Controle de antimicrobianos e auditoria da prescrição pelo controle de infecção | 10/0 (AVALIACAO_ANTIMICROBIANO_PRSCT, AUDIT_ANTIMICROBIANO, TIPO_AUDIT_PSIH) | Só o tipo de receita de antimicrobiano (PRTPRECMED, 5) | Construído: ficha de antimicrobiano (M24) e `dominio-qualidade/ccih` | F7: programa de uso racional de antimicrobianos exigido pela Anvisa | ficha_antimicrobiano, auditoria_prescricao_ccih |
| Oncologia: protocolo de quimioterapia, ciclos com dose calculada, sessões, reações e acompanhamento do tumor | 32/3 (PRE_MED_CICLO, CICLO_TRATAMENTO_PROTOCOLO\*, PW_ACPMT_PACIENTE_ONCO) | Só domínios: PRTPPROT (5), PRFINALIDADETRAT (9) | Construído e desligado (M45.6) | F8: a Rede Santé não trata câncer; vale para quem tem serviço de oncologia | — |
| Prescrição dietética e terapia nutricional enteral e parenteral | 4/0 (NPP_ADULTO, NPP_PEDIATRICO, PRESCRICAO_DIETA) | PRPRESCDIETA (≥1k), PRCARACTLAN (≥1k), PRCARACTDIE (19), PRVIAADMIN (8), PRHORPAD (8), PRTPREFEIC (7) | Construído: dieta na prescrição (M24) e nutrição clínica com EMTN (M45.5) | F3: a dieta é prescrita todo dia | terapia_nutricional (a dieta prescrita fica em prescricao_item_dieta) |
| Aprazamento, checagem e administração à beira do leito: horários previstos, dupla checagem, não administrado com motivo e fechamento do turno | 14/5 (HRITPRE_CONS\*, HRITPRE_CONS_DUPLA_CHECAGEM, PW_FECHAMENTO_HORARIO_CHECAGEM\*) | PRCHKGERAL (mais de 2 milhões), HTCHKGERAL (≥1k), PREXTRATOITEM_PRCHKGERAL (≥1k), PRSITCHECAGEM (14), PRSITAPRAZAM (5), PRPARAM_CHECAGEM (1) | Construído: M25 (nove certos, pulseira, tolerância). Aprazar e estornar ficam desligados até o cenário controlado; a leitura obrigatória da dose aguarda DP-26 | F3: maior volume de movimento do PEP | horario_administracao, horario_administracao_evento, administracao_dupla_checagem, motivo_nao_administracao |
| Glicemia capilar com escala de insulina por faixa | 2/0 (ITCOLETA_GLICEMIA_CAPILAR) | PRITENSGLICEMIA (≥1k) | Construído (`dominio-enfermagem/checagem/glicemia`) | F3: em uso na internação | escala_insulina, escala_insulina_faixa |
| Sinais vitais e medidas antropométricas, com limites de alerta, instrumento, posição e local da aferição | 22/11 (COLETA_SINAL_VITAL\*, ITCOLETA_SINAL_VITAL\*, PW_TIPO_SINAL_VITAL\*, PW_LIMITE_SINAL_VITAL\*) | PRSINAIS (1, a construir). Hoje os sinais são respostas dos modelos (PREVOLPAC, ≥1k); PRUNIDRESPOSTA (6), PRCABEC_MONITORIZACAO (2) | Construído: `enfermagem.sinaisVitais` (M25), com NEWS2 a cada aferição (M45.2) | F3: o conector extrai os sinais das respostas dos modelos | afericao, afericao_valor, parametro_vital, limite_parametro_vital |
| Balanço hídrico: ganhos, perdas por tipo e intensidade, fechamento parcial e de 24 horas | 14/10 (PW_BALANCO_HIDRICO\*, PW_ITBALANCO_HIDRICO\*, PW_GRUPO_BALANCO_HIDRICO\*) | Domínios PRAGRUPBALANCO (4), PRBHTPELIMINA (6), PRBHINTENSIDADE (4), PRBHTIPOFECHAMENTO (2); os lançamentos ficam nos modelos | Construído: M45.3, com o ganho vindo da checagem e a diurese dos sinais | F3: usado na UTI | balanco_lancamento, balanco_fechamento, tipo_ganho_perda |
| Processo de enfermagem: histórico, diagnóstico, resultados esperados, intervenções e avaliação, com terminologia padronizada | 51/17 (SAE_DIAGNOSTICO_PACIENTE\*, SAE_HISTORICO_ENFERMAGEM\*, PW_SAE_INTERVENCAO_ENFERMAGEM, PW_CONFIG_SAE_RESULTADO_ENFER\*) | PRSAE_LIKERT (6), PRSAE_CLASSIF_META (3): "módulo SAE a construir". Os cuidados prescritos vêm de TBPROENF (200) e TBKITPRO (13) | Construído: M45.4 (cinco etapas; prescrição de enfermagem aprazada e checada); terminologia sintética até a licenciada (DP-19) | F7: a resolução do COFEN obriga; na Rede Santé hoje é feito em modelos livres | processo_enfermagem, diagnostico_enfermagem_paciente, plano_intervencao_enfermagem, avaliacao_resultado_enfermagem, terminologia_enfermagem |
| Dispositivos invasivos: inserção, local, troca e retirada de cateter, sonda e via aérea | 5/3 (PRO_INVASIVO\*, MOV_INV\*, HISTORICO_TROCA_PRO_INV) | PRLOCALINVASIVO (10), PRVIAAEREA (4), PROXIGENOTERAPIA (7) | Construído: dispositivos no bundle e nos denominadores do CCIH (`dominio-qualidade/ccih`) e na prescrição de ventilação | F3: os dias de dispositivo entram nos indicadores de infecção | dispositivo_invasivo_paciente, local_acesso_invasivo |
| Passagem de plantão com aceite de quem recebe | 1/1 (PASSAGEM_PLANTAO\*) | Não tem tabela própria (é feita em modelo) | Construído: `enfermagem.plantao` (M25, aceite) | F3: a tela já existe e entra na onda da enfermagem | passagem_turno, passagem_turno_paciente |
| Parecer, interconsulta e encaminhamento para outra especialidade | 11/5 (PAR_MED\*, SOLIC_PARECER, PW_ENCAMINHAMENTO\*) | O pedido e a resposta vão dentro do registro clínico (PRCABEVOL); TBTABENC (1) | Construído: fila de interconsulta (`InterconsultasTela`, M23) | F3: em uso, hoje dentro dos modelos | interconsulta, interconsulta_resposta, encaminhamento_paciente |
| Receituário: receita simples, de controle especial e de antimicrobiano, com modelo e via | 9/0 (PW_RECEITA, PW_ITEM_RECEITA, RECEITA_ATD) | PRRECEITA (≥1k), PRITEMRECEITA (≥1k), PRPADRECEITA (628), PRTPRECMED (5), PRPARRECMED (2) | Construído: emissão (M23) e assinatura (M49.2); numeração SNCR construída e desligada | F3: em uso | receita_medica, receita_medica_item, modelo_receita |
| Atestados, declarações e requerimentos ao paciente | 2/0 (ATESTADOS, DECLARACAO_COMPARECIMENTO_ACOM) | PRATESTREQIMP (≥1k) | Construído (M23 e M49.2) | F3: em uso | documento_emitido, documento_emitido_versao |
| Termo de consentimento: modelo por procedimento e o termo do paciente ou do responsável, com revogação | 8/0 (PW_TERMO_CONSENTIMENTO_ATND, TERMO_CONSENTIMENTO_PROCED) | PRTPTCLE (5), PRASSINANTE (2), tipo de impressão TCLE (PRMODELOREL) | Construído só no novo (M23) | F3: o SPDATA já registra quem assina | termo_consentimento_modelo, termo_consentimento_paciente |
| Alta médica e sumário de alta, com seções configuráveis, motivo e modalidade | 2/1 (PW_REGISTRO_ALTA\*, PEP_JUSTIFICATIVA_CANCEL_ALT) | HTATENDALTA (≥1k), PRSUMARIO_ALTA_COMP (14), PRPARAMSUMARIOALTA (1), TBMOTALT (55), TBMODALIDADE_ASSIST (5), TBSTATUSPROCEDIMENTO (8) | Construído: `pep.finalizarSumarioAlta` (M23), com o sumário estruturado e FHIR no novo | F3: em uso | alta_medica, sumario_alta, sumario_alta_secao |
| Pedido de transporte do paciente na alta ou na transferência | 2/0 (PW_SOLICITACAO_TRANSPORTE) | Não tem | Relatório de transferência (M23); não há pedido de transporte | F8: logística que pode esperar | — |
| Declaração de óbito, com cancelamento | 2/0 (CAD_OBITO, CANCELAMENTO_DECL_OBITO) | Condição do recém-nascido (TBTPRN, 3); data do óbito no cadastro | Construído só no novo: `pep.declaracaoObito.emitir` (D-OBITO-1) | F3: obrigatória quando há óbito | declaracao_obito |
| Anexos e documentos digitalizados no prontuário | 5/1 (DOCUMENTO_ANEXO, ARQUIVO_DOCUMENTO, STATUS_ARQUIVO_ATENDIMENTO\*) | PRGEDIMP (9, 2025 a 2026), PRTIPODOCANEXO (20) | Construído: `pep.anexarDocumento` (PDF) e o módulo de digitalização | F3: em uso | anexo_prontuario, tipo_anexo |
| Resultados de exames no prontuário: grupos comparativos, tendência, faixa de normalidade e ciência do valor crítico | 6/0 (PW_GRUPO_EXAME_COMPARATIVO, PW_RES_TRANSC_EXAMES) | PRLANCAMENTOEXAME (20), PRLANCEXAMEESTRUTURADO (36), PRFILTROUSUARIO (140), PREXAMEASSINATURA (≥1k) | Construído: resultados com faixa, crítico e tendência; ciência do crítico (M23). O pedido de exame é do grupo SADT | F3: o médico consulta os resultados todos os dias | ciencia_resultado_critico, painel_resultado_grupo |
| Linha do tempo e trilha documental do prontuário: cada documento, versão e mudança de situação, com fluxo por tipo | 7/1 (PW_LINHA_TEMPO, PW_MARCO_LINHA_TEMPO, PW_AGRUPADOR_HISTORICO\*) | PRASSINATURA_CAB (≥1k), PRASSINATURA_DOC (cerca de 1,4 milhão), PRTPASSINATURA (84 tipos), PRSITDOCUMENTO (34), PRTPASSINATURA_PRSITDOC (31), PRPROCESSOPEP (3) | Construído: linha do tempo (M15 e M23) e cadeia por hash dos documentos do novo | F3: é a espinha do prontuário legal | documento_prontuario, documento_prontuario_evento |
| Assinatura digital ICP-Brasil e pendências de assinatura, com política por tipo de documento | 24/5 (ASSINATURA_DIGITAL, DOCUMENTO_DIGITAL, PW_DOCUMENTO_AUTENTICADO, SIGNATURE) | TBOID (85), TBTIPOOID (10), TBTIPOCERTIFICADO (3), TBFORMA_ASSINATURA_ICP (2), PRSITDOCUMENTOASSINADO (4), PRTPASSINATURA_TBOID (19), PRTPDOCUMENTO (3) | Construído: M49.1 a M49.3 (nuvem e token, lote, PAdES, carimbo do tempo, verificador público) | F3: o prontuário sem papel exige | assinatura_documento, pendencia_assinatura, politica_assinatura_tipo, certificado_profissional |
| Impressão, cópia e exportação do prontuário, com cabeçalho por tipo de documento e registro de quem recebeu a cópia | 9/0 (PW_PRONTUARIO, PW_SOLICITACAO_IMPRES_PRON_PAC, PW_RECEPTOR_PRONTUARIO) | PRFICHAREL (678 layouts Delphi), PRMODELOREL (18), PRPARAMORIGEMCABIMP (79), PRCAB_IDENTIFIC_PAC (2), PRLAYIMPPRESC (4), PRPARTAMPADPRESC (3) | Construído: PDF/A pelo serviço de emissão, `pep.prontuario.exportar`, `AdminImpressaoTela`. Os 678 layouts ainda precisam ser refeitos | F3: o paciente tem direito à cópia; o faturamento e a auditoria usam a impressão | solicitacao_copia_prontuario, modelo_impressao, regra_cabecalho_impressao |
| Obrigatoriedade de documentos por diagnóstico, idade ou setor, com a pendência mostrada ao profissional | 6/2 (DOCUMENTO_OBRIGATORIO\*, PW_CONFIG_DOCUMENTO_OBGT_CID, PW_TIPO_PENDENCIA_PRONTUARIO) | Não tem (só o comportamento do aviso, PRTIPONOTIFICACAO, 3) | Construído: alertas de completude e pendências (`dominio-pep/alertas-completude`, worklist) | F7: a acreditação audita a completude do prontuário | regra_obrigatoriedade_documento, pendencia_prontuario |
| Avisos clínicos ao profissional: regra por evento, por setor, especialidade ou tipo de profissional, e o canal (interno ou e-mail) | 25/9 (NOTIFICACAO\*, CONFIG_NOTIFICACAO\*, MVPEP_NOTIFICACAO\*, NI_REGRA_ENVIO) | PREMAILOPCAO (10: ciclos, acesso de emergência e outros), PRTPNOTIFEMAIL (3) | Construído em parte: avisos ao autor e à direção técnica (M49.2) e a fila de trabalho. Não há uma central de regras única | F3: o aviso de acesso de emergência por e-mail é usado | regra_aviso_clinico, aviso_clinico |
| Protocolos clínicos gerenciados (sepse, dor torácica, AVC): critérios de entrada, etapas, metas de tempo, saída e descarte | 27/11 (PW_CASO_PROTOCOLO, PW_ALERTA_PROTOCOLO\*, PW_ETAPA_PROTOCOLO\*, PROTOCOLO\*) | Não tem | Construído: protocolos do PA com o relógio das metas (M44.3) e protocolo do internado (`dominio-enfermagem/protocolos`) | F7: a acreditação exige; para o ProntoCardio a dor torácica tem valor direto | protocolo_gerenciado, protocolo_gerenciado_criterio, protocolo_gerenciado_etapa, inclusao_protocolo_paciente, inclusao_protocolo_evento |
| Registro das vacinas aplicadas, com envio à rede nacional | 5/3 (PW_DOSE_VACINA\*, PW_VACINA_DOSE_PACIENTE, VACINA\*) | Não tem | Construído e desligado: `VacinasTela` com o evento de envio à RNDS (M45.4) | F7: a vacina aplicada tem de ir para a RNDS | vacina_aplicada, vacina_aplicada_envio |
| Ficha anestésica: técnica, agentes, eventos e sinais do intraoperatório | 5/0 (PW_FICHA_ANESTESICA, PW_IT_FICHA_ANESTESICA) | Registro de cirurgia com ficha anestésica (CCCADCIR, ≥1k, módulo CC) | Construído: M46, com a trava da incisão ligada ao checklist | F3: em uso. Os detalhes ficam com o grupo do centro cirúrgico | registro_anestesico, registro_anestesico_evento |
| Notificação compulsória de agravos, com a ficha do agravo e os prazos | Não identificado no grupo | PRAGRAVOPERGUNTA (≥1k, carga de referência), PRAGRAVOTPARQUETIPO (53), TBTPNOTIFCID10 (4), TBTPSURTO (4), TBTPAUTORIDADE (3), TBTPNOTAGRAVO (3) | Construído: `dominio-qualidade/vigilancia` (ficha, prazos, gatilho pelo CID) | F3: a lista de agravos está em uso e é obrigação legal | agravo_notificavel, notificacao_agravo, notificacao_agravo_resposta |
| Recursos de enfermagem próprios do new-sgh: contenção, lesão de pele, time de resposta rápida, profilaxia de TEV, classificação de pacientes | Não identificado como tabela própria | Não tem | Construído: telas `ContencaoTela`, `FeridasTela`, `TrrTela`, `ProfilaxiaTevTela`, `ClassificacaoPacientesTela` | F7: são metas de segurança cobradas na acreditação; as telas já existem | contencao_paciente, lesao_pele_paciente, acionamento_resposta_rapida |
| Oftalmologia: exames, acuidade visual e prescrição de lentes | Não identificado no grupo | PROFTEXAME (35), PROFTGABARITO (144), PROFTTPACUID (24) e outras: "módulo sem uso" | Construído e desligado (M45.6) | F8: sem uso na Rede Santé | — |
| Obstetrícia e recém-nascido: partograma e registro do nascimento | 2/0 (RECEM_NASCIDO, CAD_RECEM_NASCIDO) | TBTPPARTO (4), TBTPRN (3): só domínios | Construído e desligado (M45.6) | F8: o ProntoCardio não tem maternidade | — |
| Curvas de crescimento e gráficos clínicos de referência | 9/1 (PW_GRAFICO_CURVA_CRESCIMENTO, PW_CURVA_REFERENCIA, PW_GRAFICO_PADRAO_CURVA_CRESC\*) | Não tem | Não tem | F8: valor na pediatria | — |
| Atenção primária e gestão de crônicos: programas de saúde, família, equipe de referência, plano de cuidado e risco | 17/0 (PW_PROGRAMA_SAUDE_ATN, PW_FAMILIA_ATN, PW_PLANO_CUIDADO_ATP) | Não tem | Não tem | F8: valor real para a operadora própria (gestão de crônicos); não é da virada | — |
| Atenção domiciliar: áreas, escala dos profissionais, chamados e agenda de visitas | 15/0 (PW_AGENDA_DOMICILIAR, PW_CHAMADO_DOMICILIAR) | Não tem | Não tem | F8: linha de serviço nova | — |
| Pesquisa clínica: critérios de elegibilidade, triagem automática e acompanhamento dos pacientes incluídos | 12/4 (PW_PESQUISA_CIENTIFICA\*, PW_PACIENTE_PESQ, PW_ITEM_PESQUISA_CIENTIFICA\*) | Não tem | Não tem | F8: interessa a hospital de ensino | — |
| Doação e transplante de órgãos: doador, receptor, preservação e sintomas depois do transplante | 6/0 (PW_CADASTRO_DOADOR, PW_DOADOR_RECEPTOR) | Não tem | Não tem | F8: só para quem tem comissão de transplante | — |
| Reuso de dialisador na hemodiálise | 2/0 (PW_CAPILAR, PW_REUSO_CAPILAR) | Parâmetros de diálise (DIPARAM, 2, a descartar, sem uso) | Não tem | F8: só para quem tem serviço de diálise | — |
| Evolução administrativa do caso (anotações não clínicas da equipe) | 5/0 (EVOL_ADMIN, REGISTRO_EVOL_ADMIN) | Não tem | Parcial: parecer do serviço social com sigilo (M45.5) | F8: o serviço social e o NIR já cobrem o essencial | — |
| Replicação do prontuário entre bases de unidades diferentes | 8/0 (PW_PRONTUARIO_DISTRIBUIDO, PW_CONTROLE_SINC_PRONT_PAC) | Não tem | A consulta na rede é feita sem replicar (`acesso-rede`) | NAO: mecanismo do fornecedor; no banco próprio a consulta entre unidades é uma regra de acesso | — |
| Integrações técnicas e tabelas de conversão do prontuário com sistemas de terceiros | 16/6 (PW_SISTEMA_INTEGRADO\*, PW_DEPARA, PW_DE_PARA_TIP_PRESC) | PRDADOSENVIOOPERADORA (15) e PRINFOPERGOPERADORA (28), envio à operadora, tratados no grupo de integração | Módulo `integracao` | NAO: técnico; as conversões ficam no conector e no grupo de integração | — |
| Infraestrutura do fornecedor: agendador de tarefas, temporárias, correções e migração entre editores | 22/5 (PW_QRTZ_TRAVAS\*, EDITOR_MAPEAMENTO_DOCUMENTO, EDITOR_PATCH\*) | Índices de busca PRMAQUINABUSCA (cerca de 25 milhões) e PRMAQBUSCAPRESC (a descartar e regenerar) | Busca própria (`dominio-pep/prontuario/busca`, `prescricao/busca`) | NAO: sem valor de negócio; a busca é regenerada no banco novo | — |

## Recursos novos do MV que valem a pena

Em ordem de valor para depois da virada (F8). Os F7 citados aqui são os que o MV tem e o SPDATA não, e
que vendem para um hospital novo.

1. **Protocolos clínicos gerenciados** (F7): o paciente é incluído por critério automático, a partir
   do diagnóstico, do sinal vital ou do resultado de exame. Depois disso, as etapas e as metas de tempo
   são acompanhadas, e a saída e o descarte têm motivo. O new-sgh já tem a base no PA (M44.3). O
   modelo próprio deve trazer o critério de entrada como regra versionada, para valer também na
   internação.
2. **Reações adversas a medicamento ligadas ao item prescrito** (F7): têm grau, evolução e histórico.
   O MV liga a reação ao item da prescrição e à lista de problemas, o que alimenta o alerta das
   prescrições seguintes. Basta ligar o núcleo de segurança do new-sgh ao motor de alertas.
3. **Obrigatoriedade de documentos por diagnóstico, idade e setor** (F7): a pendência aparece para o
   profissional e é cobrada na alta. O new-sgh tem os alertas de completude. Falta deixar a regra
   configurável por diagnóstico e faixa etária.
4. **Prontuário de acesso restrito** (F8): pedido de acesso com motivo, autorização pela equipe
   responsável, senha do paciente e contagem de acessos por profissional. Vai além da quebra de vidro
   e serve para pacientes públicos e para os próprios colaboradores internados.
5. **Atenção primária e gestão de crônicos** (F8): programas de saúde, núcleo familiar, plano de cuidado
   e estratificação de risco, com o aviso quando o risco muda. Tem valor direto para a operadora
   própria (M56), que precisa acompanhar os beneficiários crônicos.
6. **Captura automática de sinais vitais por setor** (F8, dentro da funcionalidade de sinais vitais): a
   importação vem dos monitores, configurada por setor. Elimina a redigitação na UTI e alimenta o NEWS2
   sem atraso.
7. **Exame físico estruturado pelo mapa do corpo** (F8): sistemas, órgãos e regiões, com achado por
   região. Melhora a qualidade do dado e a busca. Pode ser um componente do construtor de modelos, sem
   tabela própria.
8. **Pesquisa clínica com triagem automática de elegíveis** (F8): critérios de entrada e saída
   rodados sobre o prontuário, com aceite registrado. É diferencial para hospital de ensino e de
   pesquisa.

Também foram observados, com menos prioridade:

- curvas de crescimento (pediatria);
- atenção domiciliar;
- transplante;
- reuso de dialisador;
- nota no formato subjetivo, objetivo, avaliação e plano, com a CIAP.

## Lacunas do new-sgh frente ao SPDATA

O que o SPDATA tem em uso e o new-sgh ainda não entrega por inteiro. Tudo entra na F3:

1. **Modelos de registro clínico abaixo da conferência:** só 3 dos 10 modelos medidos estão liberados.
   Os outros 7 ficam abaixo de 99,5% na conferência cruzada (D-LIB-2). O SPDATA tem 67 modelos ativos,
   com cerca de 769 mil registros. No banco próprio, a conversão para o formato do construtor novo
   (M45.1) precisa cobrir todos.
2. **Alergia registrada dentro do formulário clínico:** não é gravada (D-ALE-2), e os modelos com
   componente de alergia ficam desligados. No SPDATA, a alergia nasce no registro clínico, inclusive
   no rascunho.
3. **Cadastros do PEP no CRUD genérico:** estão pendentes (D-CRUD-1), cinco deles de chave composta.
   Também só aparecem em consulta, sem edição:
   - protocolos de prescrição (377);
   - kits de medicamentos e de soluções;
   - receitas padrão (628, bloqueadas pela D-REV-24);
   - frequências;
   - itens não padronizados.
4. **Base de doses e interações (DP-24):** o alerta de dose e o de interação estão desligados. O SPDATA
   já usa:
   - os parâmetros clínicos do item (dose mínima e máxima, alto risco), em mais de mil itens;
   - os domínios de interação: gravidade, tipo, probabilidade e referência de dose.
5. **Aprazamento e estorno da checagem:** as duas operações ficam desligadas até o cenário controlado
   (M36). A leitura obrigatória da dose aguarda a etiqueta (DP-26). No SPDATA, o reaprazamento e a
   mudança de situação da checagem estão em uso, com mais de 2 milhões de horários.
6. **Coassinatura do residente no campo de supervisão:** desligada (D-PREC-2). O SPDATA usa a supervisão
   na trilha documental.
7. **Layouts de impressão:** o SPDATA tem 678 layouts em componentes Delphi, mais o cabeçalho por tipo
   de documento (79). O new-sgh imprime pelos modelos novos em PDF/A, e os layouts em uso ainda
   precisam ser refeitos e conferidos um a um.
8. **Envio de informações clínicas à operadora:** são 28 informações em 15 formatos de envio. Hoje
   estão só no cadastro, sem a rotina de envio. O caso deve ser confirmado com o grupo de integração e
   faturamento.
9. **Avisos por e-mail do prontuário:** ciclos de tratamento, acesso de emergência e outros, 10 opções.
   O new-sgh não tem uma central de regras de aviso. Hoje os avisos estão espalhados pelos módulos de
   assinatura e da fila de trabalho.
10. **Sinais vitais e balanço registrados dentro dos modelos:** o conector precisa extrair esses valores
    das respostas dos formulários e levá-los para as entidades estruturadas (`afericao`,
    `balanco_lancamento`). Sem isso, o NEWS2 e o balanço do banco novo começam vazios no dia 0.
