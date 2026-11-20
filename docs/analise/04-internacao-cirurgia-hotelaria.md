# Análise cruzada 04: internação e leitos, centro cirúrgico e CME, hotelaria e apoio

Grupo: **INT** (internação, leitos, regulação), **CC** (centro cirúrgico e CME) e **HOT** (hotelaria,
higienização, rouparia, SAME, nutrição, portaria, manutenção e patrimônio).

Data da análise: 20/11/2026. Fontes: lista de tabelas do MV (`referencias/mv-tabelas.tsv`), matriz das
1.503 tabelas do SPDATA (`new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`), código
do new-sgh (`packages/dominio-*`, `apps/api/src/modulos`, `apps/web/src/modulos`) e
`new-sgh/planejamento/ESTADO.md` (posição de 18/11/2026).

Como ler:

- **MV (evidência):** quantas tabelas do MV formam a funcionalidade e quantas têm dados na base de
  referência, com exemplos. Os nomes do MV só aparecem nesta coluna.
- **SPDATA (evidência, uso):** tabelas da matriz com o volume de linhas. Na matriz, "1001" significa
  "mil linhas ou mais" (amostragem limitada). Volume alto indica uso real pela Rede Santé.
- **new-sgh (estado):** pacote de domínio, rota da API, tela e marco. Todos os marcos citados estão
  "aguardando validação": construídos, mas sem conferência dos chave-usuários (DP-3).
- **Decisão:** F3 (paridade, necessária para a virada), F7 (hospital do zero: fiscal, TISS,
  regulatório), F8 (recurso novo, pode esperar a virada), NAO (não fazer).
- **Entidades próprias:** nomes do modelo MariaDB, em snake_case e português, propostos só para F3 e
  F7. Nenhum repete nome de tabela do MV ou do SPDATA.

## Resumo numérico

| Item | Valor |
|---|---|
| Tabelas do MV analisadas no grupo (DBAMV, MVINTEGRA, DBAPORTAL, DBASGU, MVBIKE) | 567 |
| Tabelas do MV com dados na base de referência | 124 |
| Funcionalidades identificadas | 66 |
| Funcionalidades sem tabela própria no MV (só SPDATA e new-sgh) | 4 |
| Decisão F3, paridade | 30 |
| Decisão F7, hospital do zero | 17 |
| Decisão F8, recurso novo | 16 |
| Decisão NAO | 3 |
| Entidades próprias propostas (F3 e F7) | 186 |

Tabelas do MV por subgrupo:

| Subgrupo | Funcionalidades | Tabelas MV | Com dados |
|---|---|---|---|
| INT: internação, leitos, regulação | 21 | 153 | 37 |
| CC: centro cirúrgico | 19 | 165 | 37 |
| CME: central de material esterilizado | 5 | 47 | 8 |
| HOT: hotelaria, SAME, nutrição, portaria, manutenção, patrimônio | 21 | 202 | 42 |
| **Total** | **66** | **567** | **124** |

Conferência: 153 + 165 + 47 + 202 = 567 tabelas; 37 + 37 + 8 + 42 = 124 com dados;
21 + 19 + 5 + 21 = 66 funcionalidades; 30 + 17 + 16 + 3 = 66 decisões.

Do lado do SPDATA, a matriz classifica 30 tabelas no módulo INT, 18 no CC e 27 no HOT (75 no total).
Outras 30 tabelas, de PEP, FAT, SUP, SUS, SADT e INTG, também servem a este grupo e estão citadas
nas linhas.

Fora deste grupo, por fronteira: prescrição de dieta (análise do PEP), guia TISS de internação (análise
do faturamento), agência transfusional e hemodinâmica (análise do SADT), parto e recém-nascido
(análise das especialidades) e acesso restrito ao prontuário (análise do PEP).

## Matriz de cobertura

### INT: internação, leitos e regulação

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Estrutura física: unidades de internação, acomodações e leitos, com característica, gênero e permissão por usuário | 14 tabelas (6 com dados): LEITO, UNID_INT, TIP_ACOM, EST_UNID_INT, INDICE_ACOMODACAO, USUARIO_UNID_INT | TBLEITO 134, RILEITOS 109, TBTIPOACOMOD 18, TBACOMODLEITO 12, RIACOMOD 9, RIBLOCOS 7, TBESPLEI 38; leitos de observação do PA: RELEITO 12, RELOCLEITO 2 | `dominio-internacao` (mapa operacional), `api/leitos`, CRUD genérico das tabelas; M16 (mapa e cadastro) | F3 | unidade_internacao, bloco_internacao, categoria_acomodacao, acomodacao, leito_hospitalar, especialidade_leito, caracteristica_leito, leito_observacao, local_observacao, permissao_unidade_usuario |
| Situação e bloqueio do leito: livre, ocupado, reservado, em limpeza, interditado, em manutenção | sem tabela própria; a situação fica no cadastro do leito e na limpeza (RESERVA_LEITO_LIMPEZA) | RILEITOS (situação, ocupação e reserva), HTLEITO 226 (retrato histórico) | `api/leitos/estados` (abrir, alterar, encerrar), `adt/os-leito.ts` (bloqueio pela OS da manutenção, desligado por parâmetro); M16, M21 | F3 | situacao_leito, periodo_situacao_leito, motivo_bloqueio_leito |
| Admissão do paciente internado: caráter, tipo, diagnóstico de entrada, acidente de trabalho e cancelamento | 7 tabelas (4 com dados): ATENDIME, CARATER_INTERNACAO, TIPO_INTERNACAO, DIAGNOSTICO_ATENDIME, ACIDENTE_TRABALHO, MOTIVO_CANC_INTC | RICADINT 1001 (os gatilhos dele abrem atendimento, conta, guia e ocupação), RIPARAM 1 (cerca de 154 parâmetros), RIEXCINT 30 (excluídas) | `dominio-internacao/adt.ts` (`admitir`), `POST internacao`, telas de `adt`; M21 | F3 | internacao, carater_admissao, modalidade_internacao, diagnostico_internacao, acidente_trabalho_internacao, cancelamento_internacao, parametro_internacao |
| Autorização da internação e prorrogação: guia, senha, diárias liberadas, validade e autorizadores | 2 tabelas (0 com dados): AUTORIZADOR_INTERNACAO, AUTORIZADOR_ACOMODACAO; a guia em si fica na análise do faturamento | RICGUIAS 1001 (guias de internação e prorrogação) | `POST :reg/guias`; M21 | F3 | autorizacao_internacao, prorrogacao_internacao, responsavel_autorizacao_internacao |
| Documentos impressos da internação: fichas, termos e guias por convênio e especialidade | sem tabela própria no grupo (o MV usa o editor genérico de documentos) | RICONFIC 760, RIESPFIC 1001, RIMODFIC 15, RITITFIC 24 | `GET/POST :reg/impressos`; M21 | F3 | modelo_documento_internacao, regra_documento_internacao |
| Pré-internação e reserva de leito: agendamento da internação com procedimentos, materiais, equipe e fila de espera | 8 tabelas (0 com dados): PRE_INTERNACAO, PRE_RESERVA_LEITO, RES_LEI_PROCEDIMENTO, IT_MATERIAL_PRE_INTERNACAO, PRE_INTERNACAO_PRESTADOR | RIPREINT 1001 (1.066 pré-internações, 811 pendentes) | `GET/POST pre`, `pre/:paciente/corrigir`, reservas do NIR (`reservas/*`); M21 e M44.2 | F3 | agendamento_internacao, agendamento_internacao_procedimento, agendamento_internacao_material, reserva_leito |
| Transferência de leito e histórico de ocupação, com motivo e solicitação | 8 tabelas (3 com dados): MOV_INT, MOV_LEITOS, SOLIC_TRANSFERENCIA_LEITO, MOTIVO_TRANSF_LEITO, LOG_TRANSF_PACIENTE, RECUSA_ACOMODA | RITRANSF 1001, RICTRLOC 1001 (períodos por leito) | `adt.ts` (`transferirLeito`), `POST transferencias`, trajetória e permanência no domínio; M21 | F3 | ocupacao_leito, transferencia_leito, motivo_troca_leito, solicitacao_transferencia_leito, recusa_acomodacao |
| Trocas durante a internação: convênio, clínica, especialidade e médico responsável | sem tabela dedicada (as trocas ficam no histórico da movimentação) | RITRFCON 121, RITRFCLI 19, RITRFESP 2, RITRFMED 2 | `POST :reg/trocas` (`trocarConvenio`, `trocarClinica`; especialidade e médico só em referência); M21 | F3 | troca_internacao, tipo_troca_internacao |
| Alta hospitalar: alta médica, alta administrativa, motivo, desfecho, previsão e cancelamento | 14 tabelas (3 com dados): MOT_ALT, PW_REGISTRO_ALTA, AVISO_ALTA_ADM, ALTAS_REVELIA, RISCO_ALTA, TISS_VERSAO_MOT_ALT | HTATENDALTA 1001 (alta médica), TBMOTALT 55, TBDESFECHO_INTERNACAO 9, TBALTARN 4, RIALTA_EXCLUSAO 75 | `POST :reg/alta`, `alta-medica`, `alta/cancelar`, `altas-previstas`; `motivo-alta.spec`; M21 e M44.2 | F3 | alta_hospitalar, alta_medica, motivo_saida_hospitalar, desfecho_internacao, previsao_alta, cancelamento_alta |
| Óbito: registro, numeração e cancelamento da declaração de óbito | 4 tabelas (0 com dados): CAD_OBITO, PACIENTE_OBITO, CANCELAMENTO_DECL_OBITO, GUIA_ATENDIME_OBITO_NORMA24 | só como desfecho (TBDESFECHO_INTERNACAO); sem controle da declaração | óbito como desfecho e indicador de mortalidade (`mortalidade.spec`); prazos de notificação no NSP (M48.1); sem controle da declaração | F7 | registro_obito, declaracao_obito, cancelamento_declaracao_obito |
| Isolamento e precauções do paciente internado, com auditoria do cumprimento | 5 tabelas (2 com dados): MOV_ISOLAMENTO, REG_ISO, TIPO_AUDITORIA_ISOLAMENTO, REGRA_TIPO_AUDITORIA_ISOLAMT | nenhuma tabela | atributo do leito (`atributos`), vigilância da CCIH (M48.3) | F7 | isolamento_paciente, tipo_precaucao, auditoria_isolamento |
| Censo diário e indicadores de leito: ocupação, permanência, giro, reinternação e mortalidade | sem tabela transacional (o MV calcula no esquema analítico) | derivado de RICTRLOC e RICADINT | `internacao/censo` (exportar, série, marcadas), painel de leitos, `censo.spec`, `permanencia.spec`, `reinternacao.spec`; M16 e M40 | F3 | fechamento_censo, fechamento_censo_unidade |
| Gestão de fluxo do paciente (NIR): quadro de leitos por etapa, fila priorizada, barreiras de alta e reunião de leitos | 3 tabelas (0 com dados): GF_DADOS_INTERNACAO, UNID_INT_CONTROLE_KANBAN, TROCPAC_GF_DADOS_INTERNACAO | RISITREGLEITO 23 (situações; "recurso a construir", sem uso) | `dominio-internacao/nir` (fila, máquina, reserva, permanência, calibragem), `nir.controller`; M44.2 | F8 | — |
| Regulação externa: solicitação à central reguladora com o quadro clínico (sensório, suporte de O2, germes, diurese) e a evolução | 15 tabelas (10 com dados): SOLIC_ATENDIMENTO_REGULACAO, EVOLUCAO_SOL_ATND_RGL, SERVICO_REGULADOR, LEITO_REGULACAO, CONDICAO_REGULACAO, SUPORTE_O2_REGULACAO | TBREGUL_SERVICO 42, TBREGUL_VLR_TABELAS 253, TBREGUL_TABELAS 20, TBREGUL_ENDPOINT 3, TBREGUL_SISTEMA 2 (configurados, sem movimento) | `regulacao.controller`, `nir/regulacao.ts`: número da regulação digitado, conector desligado; M44.3 | F7 | solicitacao_regulacao, evolucao_regulacao, central_reguladora, quadro_clinico_regulacao, servico_regulacao |
| Leitos SUS: capacidade instalada, habilitação, leitos de programa e diárias especiais | 16 tabelas (4 com dados): CAPACIDADE_UTI_SUS, TIP_ACOM_UTI_SUS, LEITO_PROGRAMA_SUS, PROCEDIMENTO_SUS_ESPEC_LEITO, DIARIA_UTI_SUS | FHLEITOUTI 12, FHLEITOUTITP 19, TBPROLEI 1001, TBTIPLEI 38 (carga do SIGTAP); a Rede Santé não atende SUS (DP-47.4) | `dominio-faturamento/sus` (AIH), M51 | F7 | habilitacao_leito_sus, capacidade_leito_sus, procedimento_especialidade_leito |
| Comunicação de internação e alta à operadora | 1 tabela (0 com dados): COMUNICACAO_BENEFICIARIO | nenhuma tabela | não encontrado | F7 | comunicacao_internacao_operadora |
| Diárias pela acomodação: geração automática, diária parcial, pacote, faixa etária e diferença de acomodação | 14 tabelas (4 com dados): CTRL_DIARIA_AUTOMATICA, DIARIA_PARCIAL, DIFER_ACOMOD, DIARIA_FAIXA_ETARIA, PACOTE_DIARIA | TBTABDTH 1001 (diárias, taxas e gases), TBTIPPLCONV 76, TBHISTTABDTH 95; no SPDATA a diária nasce dos gatilhos da internação | regra leito-dia no domínio (`leito-dia.spec`); o lançamento na conta (`lancarItem`) está desligado (D-REPRO-MM-30) | F3 | regra_diaria, diaria_lancada, diferenca_acomodacao |
| Gases medicinais por paciente: tempo de uso, regras por hora e uso simultâneo | 5 tabelas (1 com dados): MVTO_GASES, REGRA_GASES, REGRA_GASES_HORAS, REGRA_GASES_SIMULTANEO | gases na tabela de preço (TBTABDTH) e no lançamento cirúrgico (CCLANCIR 1001); oxigenoterapia no PEP (PROXIGENOTERAPIA 7) | gases na ficha anestésica (`dominio-cirurgia/ficha`); sem regra de cobrança por tempo | F3 | uso_gas_medicinal, regra_cobranca_gas |
| Transporte de pacientes: transporte interno (maqueiro) e ambulância, com trajeto e cobrança por quilômetro | 19 tabelas (0 com dados): TRANSPORTE_PACIENTE, PW_SOLICITACAO_TRANSPORTE, SOLICITACAO_AMBULANCIA, TRAJETO, REGRA_COBRANCA_AMBULANCIA_KM | nenhuma tabela | não encontrado | F8 | — |
| Internação domiciliar (home care): orçamento, transferência para casa e chamados | 13 tabelas (0 com dados): ORCAMENTO_HOCA, TRANSF_HOCA, PARAMETROS_HOCA, PW_CHAMADO_DOMICILIAR | nenhuma tabela | não encontrado | F8 | — |
| Integração de internação e movimento de leitos com sistemas externos pelo barramento do fornecedor | 5 tabelas (0 com dados), esquema MVINTEGRA: INTEGRA_ENTRADA_INTERNACAO, INTEGRA_SAIDA_MOVIM_LEITOS, IMV_LEITO | nenhuma tabela | eventos de domínio e API própria (`dominio-integracao`) | NAO | — |

### CC: centro cirúrgico

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Cadastro cirúrgico: grupo, subgrupo, porte, especialidade, natureza, caráter e texto padrão | 16 tabelas (7 com dados): CIRURGIA, GRUPO_CIRURGIA, SUB_GRUPO_CIRURGIA, PORTE_CIRURGIA, ESPECIALID_CIRURGIA, CIRURGIA_TEXTO_PADRAO | CCTPURGENCIA 3 (caráter); procedimentos do catálogo com porte em CCLANCIR | catálogo de procedimentos (M13), domínios do bloco | F3 | procedimento_cirurgico, grupo_procedimento_cirurgico, porte_cirurgico, carater_cirurgia, texto_padrao_cirurgia |
| Salas cirúrgicas, grade de horários e permissão de uso por usuário | 10 tabelas (4 com dados): SALA_CIRURGIA, HR_SAL_CIR, RESERVA_SAL_CIR, CONF_HORARIO_SALA_CIR_USUARIO, RESERVA_HORARIOS_SCMA | CCSALAS 4, CCSALAS_TBUSERS 332, CCPARAM 97 (parâmetros por usuário) | `salas`, `salas/:sala/usuarios`, mapa de salas (`dominio-cirurgia/mapa.ts`); M18 | F3 | sala_cirurgica, grade_sala_cirurgica, permissao_sala_usuario, parametro_bloco_usuario |
| Pedido e agendamento da cirurgia: procedimentos, equipe prevista, pendências, histórico e pedido pelo portal do médico | 22 tabelas (6 com dados): AVISO_CIRURGIA, CIRURGIA_AVISO, PENDENCIA_AVISO, LOG_AVISO_CIRURGIA_EVOLUCAO, PRESTADOR_AVISO, PRAZO_AGENDAMENTO_AVISO | CCAGENDA 1001, CCHISAGE 1001, CCPROEXT 10 | `agendamentos` (criar, mover, cancelar), pedido pelo portal (`pedido-portal.ts`), sobreposição de horários; M18 | F3 | agendamento_cirurgico, agendamento_cirurgico_procedimento, agendamento_cirurgico_equipe, pendencia_agendamento_cirurgico, historico_agendamento_cirurgico |
| Suspensão, cancelamento e transferência de cirurgia, com motivo | 5 tabelas (1 com dados): LOG_AVISO_CIRURGIA_SUSPENSAO, SOLIC_CANCELAMENTO_CIRURGIA, MOTIVO_SUBSTITUICAO_CIRURGIA, TRANSFERENCIA_CIRURGIA | CCAGENDA_EXC_CANC 66 | `agendamentos/:id/cancelar`, `cancelamentos`; M18 | F3 | suspensao_cirurgia, motivo_suspensao_cirurgia |
| Equipe cirúrgica: participantes, função e tempos individuais | 4 tabelas (0 com dados): PRESTADOR_CIRURGIA, PAPEL_CENTRO_CIRURGICO, PW_PRESTADOR_PADRAO_CIRURGIA | CCLANCIR 1001 (procedimentos e equipe), PRTIPO_PROFISSIONAL 9 | `dominio-cirurgia/equipe.ts`, `profissionais`; M18 | F3 | participante_cirurgia, funcao_equipe_cirurgica |
| Registro do ato cirúrgico e descrição cirúrgica: horários, achados e intercorrências | 5 tabelas (3 com dados): DESCRICAO_AVISO_CIRURGIA, ACHADO_CIRURGICO, COMPLIC_INTRA_OPERATORIA, LOG_DESCRICAO_CIRURGIA | CCCADCIR 1001, CCCADCIR_EXCLUSAO 3 | `realizadas`, `registro.ts`, ligação com o agendamento (`ligacao.ts`); M18 | F3 | ato_cirurgico, ato_cirurgico_procedimento, descricao_cirurgica, intercorrencia_cirurgica |
| Avaliação pré-anestésica e ficha anestésica: tipo de anestesia, posição, monitoração, drogas e eventos | 14 tabelas (2 com dados): FICHA_PRE_ANESTESICA, PW_FICHA_ANESTESICA, PW_IT_FICHA_ANESTESICA, CONFIG_FICHA_MONITORAMENTO, TIP_ANEST | CCCADCIR (anestesia e sinais), TBANESTESIA 17, PRFA_CAD_POSICAO_CIR 9, PRFA_TIPO_SINAL 3, PRFA_CAD_MODO_RESPIR 3 | `dominio-cirurgia/apa` e `ficha`, `:agenda/apa`, `:agenda/ficha/*`; M46.1 | F3 | avaliacao_pre_anestesica, ficha_anestesica, lancamento_ficha_anestesica, marco_ficha_anestesica, tipo_anestesia, posicao_cirurgica, modo_ventilatorio |
| Movimento do paciente no bloco e recuperação pós-anestésica: local, situação em tempo real e aviso | 10 tabelas (6 com dados): MOV_CENTRO_CIRURGICO, MOV_CC_RPA, STATUS_CENTRO_CIRURGICO, NOTIFICACAO_CENTRO_CIRURGICO, MOV_SALA_CENTRO_CIRURGICO | CCTIPOLOCALBLC 5, CCTIPOMOVIMENTACAOPAC 5 | `rastreio`, `quadro`, `srpa`, painel da família pelo código; M46.1 e M46.2 | F3 | movimento_paciente_bloco, local_bloco, situacao_bloco, registro_recuperacao_anestesica |
| Checklist de cirurgia segura em três momentos, com trava da incisão | 1 tabela (0 com dados): CHECK_LIST | nenhuma tabela | `dominio-cirurgia/checklist`, `:agenda/checklist/*`, trava da incisão; M46.2 | F7 | checklist_cirurgia_segura, item_checklist_cirurgia, confirmacao_checklist_cirurgia |
| Consumo de materiais e medicamentos na cirurgia e gasto de sala, com débito na conta | 10 tabelas (0 com dados): DEBITO_MATMED_CIRURGIA, IMP_GASTO_SALA, CIRURGIA_KIT, CUSTO_SALA_CIRURGIA, CONTA_KIT | GEKITS 45, GEKITITE 1001 (kits padrão do estoque); saída a internado pelo estoque | `suprimentos.registrarSaida` (documentos de estoque desligados até o cenário controlado); M28 e M41 | F3 | consumo_cirurgia, consumo_cirurgia_item, lista_material_procedimento |
| OPME: solicitação, autorização por alçada, consumo em sala com etiqueta, consignado e conciliação | 15 tabelas (1 com dados): AUT_GUIA_OPME_ALCADA, CONF_FLUXO_GUIA_OPME, CONF_LIMITE_OPME_OC, TAXA_MANUSEIO_OPME, VAL_OPME_IT_GUIA, PRE_OC | TBCATEGO 2 (categoria OPME), TBTISSOPFABRIC 3; consumo pelo estoque | `suprimentos` (OPME e consignado), leitor GS1, etiqueta de três vias, rastreio reverso; M46.3 e M46.4 | F3 | solicitacao_opme, solicitacao_opme_item, autorizacao_opme, consumo_opme, conciliacao_opme, consignacao_material, alcada_aprovacao_opme |
| Fluxo de autorização prévia das cirurgias eletivas junto ao convênio | 1 tabela (1 com dados): FSCC_CONFIG_WORKFLOW_GUIAS | situação da agenda em CCAGENDA (convênio, autorização) | pendências do agendamento (`gravarPendencia`) | F7 | etapa_autorizacao_cirurgia |
| Equipamentos e hemocomponentes reservados para a cirurgia | 5 tabelas (3 com dados): AVISO_EQUIPAMENTOS, APARELHO_CIRURGIA, SANGUE_AVISO, KIT_SANGUE | nenhuma tabela | requisição transfusional pela prescrição (M47.1); sem reserva de equipamento | F8 | — |
| Documentos obrigatórios antes da cirurgia (termo de consentimento, exames), com bloqueio | 3 tabelas (2 com dados): DOCUMENTO_ANEXO_CIRURGICO, TIPO_DOCUMENTO_CIRURGICO, RESTRICAO_DOCUMENTO_CIRURGIA | nenhuma tabela | digitalização e anexos (`dominio-internacao/digitalizacao`); sem regra por cirurgia | F8 | — |
| Cartão de preferência do cirurgião (material, posição, equipamentos preferidos) | 1 tabela (0 com dados): AVISO_CIRURGIA_PREFERENCIA | nenhuma tabela | não encontrado | F8 | — |
| Auditoria da profilaxia antimicrobiana cirúrgica | 1 tabela (0 com dados): AUDIT_ANTIMICROBIANO | nenhuma tabela | antimicrobianos restritos da CCIH (M48.3), sem a regra cirúrgica | F8 | — |
| Exame de hemodinâmica feito no centro cirúrgico | 2 tabelas (1 com dados): CIRURGIA_EXAME_HEMODINAMICA, LOG_CIRURGIA_EXAME_HEMO | a hemodinâmica fica no SADT (SIPARHEM 286), fora do bloco | módulo de exames (análise do SADT) | F8 | — |
| Projetos e mutirões cirúrgicos do SUS | 2 tabelas (0 com dados): PROJETO_CIRURGICO_FFCV, IT_PROJETO_CIRURGIA | nenhuma tabela | não encontrado | F8 | — |
| Cotação eletrônica de OPME com portal de compras de terceiro (XML do fornecedor) | 38 tabelas (0 com dados): OPMENEXO_*, INTEGRA_ONEXO_*, SOL_COM_OPMENEXO | nenhuma tabela | compras próprias (M28) | NAO | — |

### CME: central de material esterilizado

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Cadastro de instrumentais, caixas cirúrgicas e kits, com composição, foto e fases de processamento | 11 tabelas (2 com dados): KIT, DET_KIT, CX_KIT, IT_CX_KIT, IMG_CX_KIT, ITCAIXA_CIRURGICA, PRODUTO_FASES_CME | nenhuma (GEKITRAS 766 é carrinho de parada do estoque, outro recurso) | não encontrado | F7 | produto_reprocessavel, caixa_instrumental, caixa_instrumental_item, fase_reprocessamento |
| Ciclo de esterilização: equipamento, carga e lote, indicadores biológico, químico e físico, liberação e rejeição | 8 tabelas (1 com dados): ESTERILIZACAO, MAQ_ESTERILIZADOR, MAQ_ESTER_CICLO, TIPO_ESTERILIZACAO, REJEICAO_ESTERILIZACAO, PREPARACAO_LOTE | nenhuma tabela | não encontrado | F7 | equipamento_esterilizacao, metodo_esterilizacao, ciclo_esterilizacao, ciclo_esterilizacao_item, teste_ciclo_esterilizacao, rejeicao_reprocessamento |
| Solicitação, recolhimento e entrega de material esterilizado aos setores e ao bloco | 13 tabelas (1 com dados): SOLICITACAO_CME, COMPOSICAO_SOLICITACAO_CME, MVTO_CME, IT_MVTO_CME, USUARIO_MOV_CME_SETOR | nenhuma tabela | não encontrado | F7 | solicitacao_material_esteril, solicitacao_material_esteril_item, movimento_material_esteril, movimento_material_esteril_item |
| Rastreabilidade por etiqueta: código do pacote, validade e uso no paciente e na cirurgia | 13 tabelas (4 com dados): ETIQUETA_CME, IDENTIFICADOR_ETIQUETA_CME, MVTO_KIT_PRODUZIDO, ITMVTO_KITS, IMPRIME_ETIQUETA_KIT | nenhuma tabela | etiqueta ZPL genérica (`dominio-documento/zpl`), sem CME | F7 | pacote_esteril, uso_pacote_esteril |
| Material de terceiros e consignado processado pela CME | 2 tabelas (0 com dados): BEM_TERCEIRO_CME, IT_AV_BEM_FORN_EXT_UTIL | nenhuma tabela | consignado do OPME (M46.4), sem o reprocessamento | F7 | material_terceiro_cme, recebimento_material_terceiro |

### HOT: hotelaria, SAME, nutrição, portaria, manutenção e patrimônio

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Higienização de leitos e áreas: solicitação na alta, execução, profissional, criticidade, tipo de limpeza e material consumido | 4 tabelas (1 com dados): SOLIC_LIMPEZA, TIPO_LIMPEZA, RESERVA_LEITO_LIMPEZA, LOG_REPROVACAO_LIMPEZA | CHEXECLIMPEZA 1001, CHSOLICITLIMP 1001, CHSOLICITLIMP_TBLEITO 1001, CHAREA_CHPROFISLIMP 1001, CHAREA 110, TBLEITO_CHPROFISLIMP 136, CHTPLIMPEZA_GEITENS 19, CHPROFISLIMP 17 | `dominio-hotelaria/limpeza.ts`, `higienizacao.controller`, indicadores de giro; M21 (`liberarLeito` desligada, D-SIT-21) | F3 | area_higienizavel, criticidade_area, modalidade_limpeza, material_modalidade_limpeza, profissional_higienizacao, escala_higienizacao, solicitacao_limpeza, solicitacao_limpeza_local, execucao_limpeza, situacao_limpeza, ocorrencia_limpeza, parametro_higienizacao |
| SAME: guarda física do prontuário, local no arquivo e movimentação entre setores | 14 tabelas (7 com dados): SAME, CAD_SAME, IT_SAME, SALA_SAME, ARMARIO_SAME, TIPO_DOCUMENTO_SAME | GDPRONTMOVIM 1001 (cerca de 729 mil movimentos), GDPRONTCADOPER 6, RISETOR 11 | `dominio-hotelaria/same.ts`, `same.controller`, tela `same`; M21 | F3 | volume_prontuario, local_arquivo, movimento_prontuario, operacao_movimento_prontuario, setor_tramite |
| SAME: protocolo de envio de prontuários e contas entre setores (lote com itens) | 6 tabelas (2 com dados): IT_SAME_PROTOCOLOS, LOG_IT_SAME_PROTOCOLOS, DOCUMENTO_KIT, DOCUMENTO_PASTA_PARCIAL | RIPROTOC 1 (obsoleta, absorvida por GDPRONTMOVIM), RISETOR 11 | `same.controller` (movimentos) | F3 | protocolo_tramite, protocolo_tramite_item |
| SAME: solicitação e empréstimo de prontuário, com prazo e devolução atrasada | 5 tabelas (1 com dados): SOLICITACAO_SAME, ITSOLICITACAO_SAME, MOTIVO_SOL_SAME, EMPRESTIMO, SOL_PRONT | saída e devolução em GDPRONTMOVIM | `devolucoes-atrasadas`; M21 | F3 | solicitacao_prontuario, emprestimo_prontuario, motivo_solicitacao_prontuario |
| Cópia e impressão do prontuário a pedido, com justificativa e quem recebeu | 5 tabelas (0 com dados): PW_SOLICITACAO_IMPRES_PRON_PAC, PW_PRONTUARIO, PW_ITPRONTUARIO, PW_RECEPTOR_PRONTUARIO | PRJUSTIF_IMP_EXPORTACAO 1001, PRTIPO_JUSTIF_EXPORTACAO 4 | justificativa de impressão e exportação no PEP; M15 e M23 | F3 | solicitacao_copia_prontuario, entrega_copia_prontuario, justificativa_impressao |
| Pendências do prontuário (falta de CID, assinatura, documento) e digitalização | 6 tabelas (1 com dados): PW_TIPO_PENDENCIA_PRONTUARIO, PW_AUTORIZA_PENDENCIA_ASSINAT, ARQUIVO_ATENDIMENTO, STATUS_ARQUIVO_ATENDIMENTO | TBIRREGULARID 39, FCIRREGULARID 218, TBIRREGULARID_TBMODULO 43, PRGEDIMP 9 | `dominio-internacao/digitalizacao`, irregularidades no faturamento; M30 | F3 | tipo_pendencia_prontuario, pendencia_prontuario, documento_digitalizado |
| Nutrição: tipos de dieta, refeições e horários, mapa de dietas por corte e etiqueta da bandeja | 14 tabelas (2 com dados): TIPO_DIETA, PRESCRICAO_DIETA, REFEICAO_DIETA, TIPO_REFEICAO, ORIENTACAO_DIETA, COPA | TBDIETAS 6, TBTPDIETA 7, PRTPREFEIC 7, PRHORPAD 8, PRCARACTDIE 19, PRVIAADMIN 8; prescrição: PRPRESCDIETA 1001 | `nutricao/mapa` (fechar, etiquetas), jejum do bloco e dos exames; M45.5 | F3 | modalidade_dieta, via_dieta, caracteristica_dieta, refeicao_do_dia, horario_refeicao, mapa_dieta, mapa_dieta_item |
| Triagem nutricional e terapia nutricional (EMTN): metas, acompanhamento e avaliação da parenteral | 1 tabela (0 com dados): FICHA_NUTRICAO | nenhuma tabela | `nutricao/triagens`, `nutricao/terapias/*`; M45.5 | F7 | triagem_nutricional, terapia_nutricional, meta_terapia_nutricional, acompanhamento_terapia_nutricional |
| Refeição do acompanhante pelo direito legal e pelas regras do convênio | 5 tabelas (1 com dados): REGRA_CARDAPIO_ACOMPANHANTE, REGRA_CARDAPIO_IDADE_ACOMPANH, ATENDIMENTO_AUTORIZA_CRDP_ACOM | nenhuma tabela | `nutricao/acompanhantes`; M45.5 | F7 | direito_refeicao_acompanhante, refeicao_acompanhante |
| Declaração de comparecimento e de acompanhante | 2 tabelas (0 com dados): DECLARACAO_COMPARECIMENTO_ACOM, CONFIG_DECLARACAO | atestados e requerimentos no PEP (PRATESTREQIMP 1001) | documentos do PEP (`pep/documentos`) | F3 | declaracao_emitida |
| Manutenção corretiva: ordem de serviço, oficina, aprovação, retirada do equipamento e aceite | 19 tabelas (4 com dados): SOLICITACAO_OS, ITSOLICITACAO_OS, OFICINA, APROVA_AVALIACAO_OS, RETIRO_EQUIPAMENTO_OS, MANU_ESPEC | nenhuma tabela | `dominio-manutencao` (OS, ciclo de vida, tecnovigilância, indicadores), telas `manutencao`; M55.1 | F7 | equipamento_saude, ordem_servico, ordem_servico_evento, oficina_manutencao, especialidade_manutencao, aceite_ordem_servico |
| Manutenção preventiva, calibração, segurança elétrica e plano de ar-condicionado | 4 tabelas (0 com dados): PLANO_MANUTENCAO, PLANO_MANUTENCAO_PROD, PLANO_MANUTENCAO_OFICINA | nenhuma tabela | `preventiva.ts`, `pmoc.ts`, laudos em PDF/A; M55.1 | F7 | plano_preventivo, execucao_preventiva, laudo_calibracao |
| Patrimônio: bem, plaqueta, transferência com aceite, empréstimo, baixa, inventário e depreciação | 23 tabelas (0 com dados): BENS, BEM_PATRIMONIAL_PLACA, MOV_BENS, INVENTARIO_PATRIMONIO, BENS_REAVALIACAO | GPORIGEM 5, GPTP_RESPONSAVEL 4, GPCOEFICIENTE_DEPREC 3, GPPARAMG 1 ("módulo sem uso") | `dominio-patrimonio`, telas `patrimonio`; M54.6 (fronteira com a controladoria) | F7 | bem_patrimonial, plaqueta_bem, movimento_bem, inventario_bem, cota_depreciacao, baixa_bem |
| Rouparia e lavanderia: enxoval, cotas por setor, coleta, envio, retorno em quilo e peças, perdas | 7 tabelas (0 com dados): ENT_ROUPA, ROUPA_ESTOQUE, LAVANDERIA, LAVAGEM_ROUPA_CLIENTE | nenhuma tabela | `dominio-hotelaria/rouparia.ts`, `/hotelaria/rouparia`; M55.2 | F8 | — |
| Portaria: visitante, visita com crachá, regras por unidade, bloqueio, acompanhante e catraca | 46 tabelas (22 com dados): PT_PESSOA, PT_PORTARIA, PT_CONFIG_UNID_INTERNAC_VISITT, PT_CRACHA, MVTO_VISITA_ACOM, INTEGRA_CRACHA | só parâmetros e domínios, sem movimento: CVPARAM 1, CVTPVISITANTE 8, CVTPTERMINAL 6, CVTPVISITADO 6 | `dominio-internacao/portaria`, `portaria.controller`, telas `portaria`; M50.5 | F8 | — |
| Contratos de manutenção e serviços terceirizados | 7 tabelas (1 com dados): CONTRATO_MANUTENCAO, ITCONTRATO_MANUTENCAO, MANU_SERV, MANU_SERV_NIVEL | nenhuma tabela | contratos de manutenção no M55.1 e contratos gerais no M55.3 | F8 | — |
| Cardápio, pratos, ficha técnica e planejamento da produção | 21 tabelas (0 com dados): PLANO_CARDAPIO, OPCAO_CARDAPIO, PRATO, MOV_CARDAPIO, SOLICITACAO_CARDAPIO | nenhuma tabela | não encontrado | F8 | — |
| Composição nutricional dos alimentos (macro e micronutrientes) | 5 tabelas (0 com dados): ALIMENTO, NUTRIENTE, NUTRIENTE_ALIMENTO, UNIDADE_ALIMENTO | nenhuma tabela | alergias alimentares no PEP, sem tabela de composição | F8 | — |
| Ocorrências na entrega da refeição | 2 tabelas (0 com dados): OCORRENCIA_DIETA, LOG_OCORRENCIA_DIETA | nenhuma tabela | não encontrado | F8 | — |
| Lactário: fórmulas, preparo e etiqueta | 4 tabelas (0 com dados): FICHA_NUTRICAO_LACTARIO, ITMOV_LACTARIO, ETIQUETA_LACTARIO_EMPRESA | nenhuma tabela | construído e desligado no M45.6 | F8 | — |
| Integração de nutrição com sistemas externos pelo barramento do fornecedor | 2 tabelas (0 com dados), esquema MVINTEGRA: IMV_NUTRICAO, INTEGRA_SAIDA_NUTRICAO | nenhuma tabela | eventos e API próprios | NAO | — |

## Observações de modelagem para o MariaDB

1. **A admissão faz o que hoje os gatilhos fazem.** No SPDATA, gravar a internação dispara gatilhos
   que abrem o atendimento, a conta, a guia e a ocupação do leito. No modelo novo não há gatilho com
   regra de negócio. Um único serviço de domínio, `admitir`, grava `internacao`, `ocupacao_leito`,
   `autorizacao_internacao` e a conta numa só transação, com teste. O mesmo vale para a alta, que
   encerra a ocupação, solicita a limpeza e fecha a diária.
2. **A ocupação do leito é um período, não um campo.** O SPDATA mantém a situação no leito e o período
   noutra tabela. O modelo novo guarda só `ocupacao_leito` (início, fim) e `periodo_situacao_leito`
   (bloqueio, limpeza, reserva). A situação atual sai por consulta, e o censo vem daí, fechado por dia
   em `fechamento_censo`.
3. **Trocas numa tabela só.** As quatro tabelas de troca do SPDATA (convênio, clínica, especialidade e
   médico) viram `troca_internacao` com `tipo_troca_internacao`, valor anterior e valor novo.
4. **A diária é derivada.** `diaria_lancada` nasce da `ocupacao_leito` e da `regra_diaria`
   (acomodação, convênio, faixa etária, diária parcial), por rotina idempotente. Nunca por gatilho.
5. **A CME liga o pacote ao paciente.** `uso_pacote_esteril` aponta para `ato_cirurgico` ou para o
   atendimento. Isso fecha a rastreabilidade do instrumental, do ciclo à cirurgia.
6. **Os domínios pequenos não ganham tabela própria.** Situação da limpeza, criticidade de área, caráter
   da cirurgia, tipo de troca e operação do SAME entram no catálogo de domínios do modelo, numa tabela
   genérica de valores com código e vigência. A entidade continua listada acima para manter o
   vocabulário, mas o DDL pode juntá-las.

## Recursos novos do MV que valem a pena

Em ordem de valor para um hospital que não é a Rede Santé:

1. **CME com rastreabilidade completa (F7).** O MV tem 47 tabelas: caixas com composição e foto, ciclo
   com indicadores biológico, químico e físico, rejeição, etiqueta com validade e vínculo do pacote ao
   atendimento e à cirurgia. Nem o SPDATA nem o new-sgh têm isso. É exigência sanitária para qualquer
   hospital com bloco. É o maior buraco funcional deste grupo.
2. **Regulação externa com quadro clínico estruturado (F7).** A solicitação à central leva sensório,
   suporte de oxigênio, germes, diurese e procedência, e registra a evolução. O new-sgh só guarda o
   número digitado, com o conector desligado.
3. **Declaração de óbito controlada (F7).** Numeração, cancelamento e vínculo com a internação. Hoje o
   óbito é só um desfecho.
4. **Isolamento com auditoria das precauções (F7).** O tipo de precaução fica no paciente, não só no
   leito, e há regras de auditoria do cumprimento. Completa a CCIH que o new-sgh já tem.
5. **Comunicação de internação e alta à operadora (F7).** Mensagem TISS que o hospital novo precisará
   mandar.
6. **Cobrança de gases por tempo de uso, com regra por hora e uso simultâneo (F3 com ganho).** Tira o
   cálculo da mão do faturista.
7. **Transporte interno de pacientes, com maqueiro e tempo de resposta (F8).** Dá ao NIR e à hotelaria
   o tempo de transporte, que hoje não aparece em lugar nenhum.
8. **Cartão de preferência do cirurgião, reserva de equipamento e de hemocomponente no pedido da
   cirurgia (F8).** Reduz suspensão por falta de material, sobretudo em cirurgia cardíaca, que é o
   perfil do ProntoCardio.
9. **Documentos obrigatórios por cirurgia, com bloqueio do início (F8).** Termo de consentimento e
   exames exigidos antes da sala.
10. **Unidade de alimentação: cardápio, ficha técnica e composição nutricional (F8).** Útil para quem
    produz refeição dentro do hospital. Pode esperar.

Descartados (NAO): o barramento de integração do fornecedor (esquema MVINTEGRA), que no modelo novo
são eventos de domínio e API própria; e a integração de cotação de OPME com um portal de compras
específico (38 tabelas de XML de terceiro).

## Lacunas do new-sgh frente ao SPDATA

O new-sgh cobre todo o grupo que o SPDATA usa. Todas as tabelas do SPDATA com movimento neste grupo
(RICADINT, RICGUIAS, RIPREINT, RITRANSF, RICTRLOC, CCAGENDA, CCCADCIR, CCLANCIR, CHEXECLIMPEZA,
CHSOLICITLIMP, GDPRONTMOVIM) têm leitura, rota e tela. As lacunas são de operação ligada e de regra
que hoje mora no SPDATA:

1. **Geração da conta, da guia e da diária na admissão.** No SPDATA são gatilhos do banco. O new-sgh
   grava no Firebird e herda esses gatilhos. No banco novo, essa regra precisa existir no domínio, e
   hoje ela não está escrita lá. É a maior lacuna para a virada.
2. **Lançamento de item na conta desligado** (`lancarItem`, D-REPRO-MM-30). Sem ele, a diária
   automática e o débito de material da cirurgia não fecham a conta.
3. **Liberação do leito pela higienização desligada** (`liberarLeito`). Os valores 3 e 4 da situação
   da limpeza estão sem definição (D-SIT-21).
4. **Operações só em referência até o cenário controlado:** `cancelarAlta`, `excluirInternacao`,
   `trocarEspecialidade` e `trocarMedico` (M21).
5. **Documentos de estoque desligados** (`registrarSaida` e afins, M28 e M41). Isso afeta o consumo
   de material na cirurgia e o material da limpeza (CHTPLIMPEZA_GEITENS).
6. **De-para das 23 situações de regulação de leito** pendente (M44.2-14).
7. **Integração com a regulação estadual** configurada no SPDATA (42 serviços, 253 valores de tabela)
   e com o conector desligado no new-sgh (M44.3).
8. **Nenhuma operação da onda 2 conferida pelos chave-usuários** (DP-3): internação, centro cirúrgico,
   higienização e SAME estão construídos, sem aceite.
9. **Cobrança de gases por tempo de uso:** o SPDATA cobra pela tabela de preço e pelo lançamento
   cirúrgico. O new-sgh registra os gases na ficha anestésica, mas não tem regra própria de cobrança.
10. **Modos ventilatórios da ficha anestésica:** o domínio existe no SPDATA sem uso. O new-sgh criou a
    parte na ficha. Falta confirmar com os anestesistas antes de entrar no modelo.

A Rede Santé também não registra CME, transporte, óbito controlado nem isolamento no SPDATA. Vale
perguntar ao dono como isso é feito hoje (planilha ou livro). Se houver registro fora do sistema, a
CME pode subir de F7 para F3 por exigência sanitária, mesmo sem dado a migrar.
