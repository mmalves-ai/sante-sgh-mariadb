# Análise cruzada 02: cadastros-base, recepção e agenda

Grupo: **CAD** (pessoas, profissionais, fontes pagadoras, estabelecimento), **REC** (recepção e
atendimento) e **AGE** (agenda). Data: 2026-11-20. Base: ADR 0001 (banco próprio em MariaDB, virada
por conector diferencial).

Fontes lidas (somente leitura):

- MV: `referencias/mv-tabelas.tsv`. Classificação por esquema, prefixo e descritivo, com conferência
  tabela a tabela. Só nomes e descritivos de tabela; nenhuma linha de dados foi lida.
- SPDATA: `new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`, módulos CAD (98),
  REC (44) e AGE (33).
- new-sgh: pacotes `dominio-cadastro`, `dominio-recepcao`, `dominio-agenda`, `dominio-atendimento`,
  `dominio-organizacao` e `dominio-rede`, as rotas de `apps/api/src/modulos` e as telas de
  `apps/web/src/modulos`, além de `planejamento/ESTADO.md` (marcos M11, M12, M17 a M20, M39, M50 e M57).

Convenções:

- "MV n/d": n tabelas do MV na funcionalidade, das quais d têm dados na cópia de referência.
  Exemplos de tabelas vêm entre parênteses e marcados com `*` quando têm dados.
- Coluna SPDATA: o volume de linhas da matriz é o indicador de uso real. A matriz conta até 1.001, então
  "≥1k" significa uso real pleno. "Só padrão" significa que a tabela só tem a linha "não informado" ou
  um valor fictício.
- Os nomes de tabela do MV e do SPDATA aparecem só nas colunas de evidência. As entidades próprias usam
  nomes nossos, em snake_case.
  Os nomes foram conferidos por script contra todos os nomes de tabela do MV e do SPDATA. Só
  `paciente` coincide, por ser o termo genérico adotado na convenção do projeto.
- Nenhuma regra de negócio fica em gatilho. O que o SPDATA faz por gatilho (o faturamento gerado na
  abertura, a gravação da unificação, o retrato do cadastro) passa a ser feito por serviço de domínio
  com evento na mesma transação. O retrato histórico pode usar o versionamento de sistema nativo do
  MariaDB (`WITH SYSTEM VERSIONING`), que é recurso do motor e não gatilho.

## Resumo numérico

| Conjunto | Funcionalidades | Tabelas MV | MV com dados | F3 | F7 | F8 | NAO |
|---|---:|---:|---:|---:|---:|---:|---:|
| CAD: cadastros-base | 29 | 223 | 73 | 21 | 3 | 5 | 0 |
| REC: recepção e atendimento | 10 | 69 | 22 | 7 | 2 | 1 | 0 |
| AGE: agenda | 16 | 112 | 28 | 8 | 0 | 8 | 0 |
| Técnico do fornecedor, transversal | 4 | 66 | 5 | 0 | 0 | 0 | 4 |
| **Total** | **59** | **470** | **128** | **36** | **5** | **14** | **4** |

Conta do total: 223 + 69 + 112 + 66 = 470 tabelas, das quais 73 + 22 + 28 + 5 = 128 têm dados. As
funcionalidades somam 29 + 10 + 16 + 4 = 59, e as decisões 36 + 5 + 14 + 4 = 59.

**Ficaram fora da contagem**: tabelas do MV que tocam o grupo, mas pertencem a outro (ver
"Fronteiras" no fim). São elas:

- classificação de risco do pronto atendimento: 93 tabelas, 29 com dados;
- portaria, visitantes e acompanhantes: 41 tabelas, 17 com dados;
- agenda do centro cirúrgico: 4 tabelas, 3 com dados;
- todo o esquema da operadora (`DBAPS`).

SPDATA no grupo: as 175 tabelas da matriz (CAD 98, REC 44, AGE 33) foram todas lidas. As de
referência clínica (CID, CIAP, DCB, alergias, princípios ativos, vias, unidades de medida) e os
cabeçalhos das tabelas de preço estão no módulo CAD, mas vão para os grupos de catálogos, PEP e preços.

Entidades próprias propostas para as funcionalidades F3 e F7: **115** nomes distintos (lista no fim).

## Matriz de cobertura

### CAD: cadastros-base

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 1 | Cadastro mestre da pessoa e do paciente (identificação, demografia, documentos, número de prontuário por estabelecimento) | 8/2 (PACIENTE\*, PACIENTE_ADICIONAL, PACIENTE_IDENTIDADE, CATEGORIA_PACIENTE\*, CONDICOES_ESPECIAIS_PAC) | RICADPAC ≥1k, TBPESSOA ≥1k (pessoa única por CPF/CNPJ), TBGERSEQ 8 (numeração); uso pleno | `dominio-cadastro` (CPF, CNS, busca fonética, mascaramento); FichaPacienteTela, BuscaPacientesTela, PessoasTela; M11 aguardando validação | **F3**: é o coração da virada | `pessoa_fisica`, `paciente`, `documento_pessoa`, `prontuario_estabelecimento`, `sequencia_prontuario` |
| 2 | Campos obrigatórios do cadastro por módulo e por contexto | 4/2 (CONFIGURACAO_PACIENTE\*, CONFIGURACAO_PACIENTE_AUX\*, CONFIGURA_PACIENTE, USUARIO_COLUNA_CAD_PACIENTE) | ATPARAMGERAL 3, REPARAM 1 (cerca de 250 obrigatoriedades); em uso | `dominio-recepcao/obrigatorios.ts`; ParametrosTela | **F3**: a recepção depende dessas regras | `regra_campo_cadastro` |
| 3 | Endereço, telefones e e-mails da pessoa | 4/3 (ENDERECO_PACIENTE\*, CONTATO_PACIENTE\*, OUTROS_CONTATOS_PACIENTE\*, CONTATO_PACIENTE_EXTERNO) | Campos do RICADPAC, HTPACTELEFONE ≥1k, TBTIPOTELEFONE 5; uso pleno | FichaPacienteTela (blocos de endereço e contato) | **F3**: o modelo próprio separa vários endereços e contatos por pessoa | `endereco_pessoa`, `telefone_pessoa`, `email_pessoa` |
| 4 | Responsável legal, familiares e dependentes | 2/1 (RESPONSAVEL\*, PW_FAMILIA_PACIENTE_ATN) | TBPARENTE 11; campos de responsável no RICADPAC; em uso | PortalResponsaveisTela, `dominio-acesso/portal/vinculo.ts` (M50.1) | **F3**: exigido para menor e incapaz | `vinculo_responsavel`, `tipo_parentesco` |
| 5 | Foto e biometria do paciente (identificação positiva) | 7/2 (FOTO_PACIENTE\*, BIOMETRIA_PACIENTE, BIOMETRIA_PACIENTE_IMG, PESSOA_BIOMETRIA, TIPO_AUTENTICACAO_BIOMETRIA\*) | Só a chave de biometria em ATPARAMGERAL; sem dado | Sem foto ou biometria do paciente (só a do visitante, na portaria) | **F8**: dá segurança na identificação e apoia a guia TISS com biometria; dado sensível (LGPD art. 11) | — |
| 6 | Pré-cadastro de quem agenda sem prontuário | 1/0 (PRE_PACIENTE) | REPACAGN ≥1k, SIPACAGN ≥1k; uso pleno no call center | `agenda.agendarSemProntuario` especificada (D-SPR-1, M17) | **F3**: o call center vive disso | `pre_cadastro` |
| 7 | Unificação de prontuários duplicados e fila de suspeitas | 4/2 (LOG_UNIFICA_PACIENTE_INTEGRA, LOG_EXCLUSAO_PACIENTE\*, LOG_DOC_ORFAO_PACIENTE\*, LOG_TRANSF_PACIENTE) | HTPRONTUNIF 6 (2020 a 2025); no SPDATA, a gravação é feita por gatilho | `duplicidade/escore.ts`, DuplicidadesTela, `cadastro.unificarPaciente` completa e desligada (M57.2), índice mestre em `dominio-rede/mpi` | **F3**: a carga vai trazer duplicatas; a unificação é serviço de domínio | `unificacao_prontuario`, `suspeita_duplicidade` |
| 8 | Retrato imutável do cadastro no momento do registro clínico | 3/2 (LOG_PACIENTE_ATENDIME\*, LOG_PRESTADOR\*, MVTO_PACIENTE) | HTPACIENTE ≥1k, HTPROFIS ≥1k, HTPACTELEFONE ≥1k, HTPROFISTEL 204, HTCONVEN 97 | `paciente/historico.ts`, HistoricoPacienteTela, HistoricoProfissionalTela | **F3**: prova legal do prontuário; versionamento de sistema no lugar do gatilho | `versao_paciente`, `versao_profissional` |
| 9 | Cobertura do paciente: fonte pagadora, plano, carteira, validade e titular | 7/1 (CARTEIRA\*, PACIENTE_CARTAO, PROIBICAO_CARTEIRA, SEGURO_SAUDE_PAC, APOLICE_ATENDIMENTO) | RICADPAC_TBCONVEN ≥1k, RESEGUR ≥1k (titular por atendimento) | Convênios na FichaPacienteTela; SeguradoTela, `alterarSegurado` (M20) | **F3**: sem cobertura não há atendimento por convênio | `cobertura_paciente`, `titular_cobertura` |
| 10 | Paciente confidencial ou VIP (acesso restrito ao prontuário) | 5/0 (PW_CENTRAL_PACIENTE_VIP, PW_SENHA_PACIENTE_VIP, ATENDIME_CASOS_CONFIDENCIAL, PRESTADOR_LIBERA_ATD_CAS_CONF) | Nada | Quebra de vidro (QuebrasVidroTela) e mascaramento existem, sem marcação de paciente restrito | **F8**: valor real (celebridade, caso judicial, funcionário), mas não trava a virada | — |
| 11 | Programas de saúde e linhas de cuidado do paciente | 6/0 (PACIENTE_PROGRAMA_SAUDE, HIST_PACIENTE_PROGRAMA_SAUDE, ESTADO_PACIENTE_PROG_SAUDE) | Nada | Nada | **F8**: gestão populacional; o MV não usa | — |
| 12 | Origem e indicação do paciente (quem indicou, captação) | 5/2 (INDICACAO_PACIENTE, PW_INDICACAO_PACIENTE\*, PW_CONFIG_INDICACAO_PACIENTE\*, TP_INDICACAO_AGENDA) | RETPINDATEND 7; usado na ficha | Domínio no CRUD genérico (M14) | **F3**: campo da ficha de hoje | `origem_indicacao` |
| 13 | Registro de óbito no cadastro (data, número da declaração, causa) | 3/0 (PACIENTE_OBITO, CAD_OBITO, CANCELAMENTO_DECL_OBITO) | Só o desfecho "óbito" da internação (grupo INT); sem cadastro próprio | Desfecho no atendimento e na internação; sem bloqueio do cadastro | **F7**: declaração de óbito e SIM, obrigatórios para hospital com internação | `registro_obito` |
| 14 | Referências geográficas: CEP, logradouro, município, UF, país, DDD | 22/8 (CEP_LOGRADOUROS\*, CEP_BAIRROS\*, CEP_SUS\*, CIDADE\*, PAIS\*, SIAFI_CIDADE\*, família ECT_LOG_\*) | TBCEP ≥1k (cerca de 860 mil), TBSUSCEP ≥1k, TBMUIBGE ≥1k, TBUF 30, TBPAISES 279, TBDDD 67, TBTIPLGR 239; carga de referência | `dominio-catalogo` (carga e consulta), CargaCatalogoTela | **F3**: carga pública pré-pronta | `municipio_ibge`, `unidade_federativa`, `pais_referencia`, `logradouro_cep`, `especie_logradouro`, `area_ddd` |
| 15 | Domínios demográficos: raça/cor, etnia, religião, escolaridade, estado civil, gênero e nome social, órgão emissor, nacionalidade, tipo de documento, ocupação, vulnerabilidade, capacidade civil | 10/6 (RACA_COR\*, ETNIA\*, PROFISSAO\*, ORGAO_EMISSOR\*, UF\*, IDENTIDADE_GENERO, RELIGIAO) | TBCOR 6, TBETNIA 1, TBRELIG 11, TBESCOLARIDADE 12, TBECIV 18, TBGENERO_SOCIAL 2, TBORGAOEMIS 32, TBNACION 384, TBTPDOCUMENTO 8, TBOCUPAC 354, TBVULNERABILIDADE_SOCIAL 1, TBCAPACIDADE_CIVIL 3, TBSEXO 3, TBUNID_IDADE 3 | CRUD genérico de domínios (DominioTela, M14) | **F3**: uma tabela de domínio com tipo, codificada pelos padrões IBGE e RNDS | `tipo_dominio`, `valor_dominio` |
| 16 | Cadastro do profissional: dados pessoais, fiscais, bancários, RQE, assinatura | 18/4 (PRESTADOR\*, PRESTADOR_DOCUMENTO, PRESTADOR_FOTO, RQE_PRESTADOR, PRESTADOR_ASSINATURA, MOV_PRESTADOR\*, PRESTADOR_AVISO\*) | TBPROFIS 871; uso pleno, inclusive no repasse | `profissional/categoria.ts`; ProfissionaisTela, ProfissionalTela (M11) | **F3**: sem ele não há atendimento nem repasse | `profissional`, `conta_bancaria_profissional`, `registro_especialista` |
| 17 | Conselho de classe, CBO e especialidade (e procedimentos por especialidade) | 19/10 (CONSELHO\*, CBO\*, CBOS\*, ESPECIALID\*, ESP_MED\*, ESPECIALIZACOES\*, PRESTADOR_CBO, TISS_VERSAO_CBOS\*) | TBCONSPROF 16, TBSIGLACONSPROF 8, TBCBOSUS ≥1k, FPCBO ≥1k, TBESPEC 100, TBMEDESP ≥1k, TBCBOSUS_TBESPEC 131, TBESPPRO ≥1k, TBCBOPRO ≥1k | ConselhosTela, rota de especialidades, cadastro do profissional | **F3**: base de TISS, CNES e agenda | `conselho_classe`, `ocupacao_cbo`, `especialidade_medica`, `especialidade_ocupacao`, `inscricao_conselho`, `profissional_especialidade`, `especialidade_procedimento` |
| 18 | Lotação do profissional na unidade: carga horária e tipo de vínculo | 11/6 (EMPRESA_PRESTADOR\*, PRESTADOR_TIPO_VINCULO\*, VINCULO_CNES\*, TIPO_VINCULO_CNES\*, SUBTIPO_VINCULO_CNES\*, ORGAO_EMISSOR_CNES\*) | TBCBOPRO_TBUNIDAD 637, HTTBCBOPRO ≥1k, HTTBCBOPRO_TBUNIDAD 647 | Carga horária no `profissionais.controller` | **F3**: em uso e base do CNES | `lotacao_profissional`, `tipo_vinculo_trabalho` |
| 19 | Credenciamento do profissional por fonte pagadora (código na operadora) | 1/0 (PRESTADOR_CONVENIO_LIBERADO) | TBCBOPRO_TBCONVEN ≥1k | Rota `/cadastros/convenios/codigos-prestador` (M12) | **F3**: sai na guia TISS | `credenciamento_pagadora` |
| 20 | Solicitante externo (médico de fora que pede exame ou consulta) | 6/0 (PRESTADOR_EXTERNO, ATENDIME_PRESTADOR_EXTERNO, PRESTADOR_REFERENCIA, HISTORICO_PRESTADOR_REF_PAC) | TBMEDSOL ≥1k, TBMEDSOL_CODCON ≥1k | SolicitantesTela, `solicitante/deduplicacao.ts` | **F3**: em uso no SADT e na agenda | `solicitante_externo`, `codigo_solicitante_pagadora` |
| 21 | Profissional provisório (atende antes de completar o cadastro e regulariza depois) | 6/0 (PRESTADOR_VINCULO, PRESTADOR_VINCULO_ATENDIME, PRESTADOR_VINCULO_PACIENTE, LOG_PRESTADOR_VINCULO) | Nada | Nada | **F8**: útil em plantão de emergência; contorna-se com cadastro mínimo | — |
| 22 | Equipes médicas e cooperativas do profissional | 9/0 (EQUIPE_PRESTADOR, EQUIP_PRESTADOR, COOPERATIVA_PRESTADOR, PW_EQUIPE_PRESTADOR_ATN, PW_PRESTADOR_RECURSO) | Nada no grupo (a pessoa jurídica do médico está no grupo de repasse) | Equipe cirúrgica no `dominio-cirurgia`; nada no cadastro | **F8**: a pessoa jurídica para repasse fica no grupo de repasse | — |
| 23 | Fonte pagadora: convênio, particular, SUS (cadastro e parâmetros) | 13/3 (CONVENIO\*, TAB_CONVENIO\*, EMPRESA_CONVENIO\*, OPERADORA_CONVENIO, TIPO_SEGURADORA_CONVENIO, DOCUMENTO_CONVENIO_PLANO) | TBCONVEN 77 (cerca de 385 parâmetros em colunas), TBGRUCONVEN 2, HTCONVEN 97 | Ficha do convênio em `/cadastros/convenios` (M12); `dominio-preco` | **F3**: decompor os 385 parâmetros por tema, sem copiar a tabela larga | `fonte_pagadora`, `parametro_fonte_pagadora`, `grupo_fonte_pagadora`, `logotipo_fonte_pagadora` |
| 24 | Planos e categorias da fonte pagadora, com regras próprias (teto, pendência, documentos exigidos) | 7/2 (CON_PLA\*, EMPRESA_CON_PLA\*, CON_PLA_TETO, CON_PLA_PENDENCIA, CON_PLA_OBS) | Nada (o SPDATA não separa plano do convênio) | Nada no hospital; existe só no lado da operadora (M56.2) | **F7**: hospital novo atende operadoras com planos de regras e tabelas diferentes | `plano_fonte_pagadora`, `regra_plano`, `documento_exigido_plano` |
| 25 | Configuração TISS por fonte pagadora: versão, numeração de guias, contratado, serviços web | 7/6 (CONVENIO_CONF_TISS\*, CONVENIO_CONF_TISS_CONTRATADO\*, FAIXA_GUIA_CONVENIO\*, ITEM_FAIXA_GUIA_CONVENIO\*, SITE_INTEGRA_CONVENIO\*) | Parâmetros TISS dentro de TBCONVEN; TBOPERSCHEMA 3 (grupo de integração) | `dominio-faturamento/tiss` (montagem, lote, operadora; M31) | **F3**: a Rede Santé fatura TISS hoje | `configuracao_tiss_pagadora`, `faixa_numeracao_guia` |
| 26 | Estabelecimento: mantenedora, hospital, unidades, logotipos, parâmetros e porte | 15/6 (MULTI_EMPRESAS\*, MULTI_EMPRESAS_LOGOMARCA\*, TIPO_EMPRESA\*, CONSTITUICAO_EMPRESA\*, USUARIO_MULTI_EMPRESA\*, HOSPITAL_UNIFICADO) | TBEMPHOS 1, TBEMPHOSLOGO 1, TBHOSPIT 1 (guarda credenciais), TBUNIDAD 6, TBTIPOATEUNIDADE 5, TBTPESTABELECIMENTO 26, TBESFERA_ADM 5, TBPORTE_HOSPITALAR 4, TBCOMPLEXIDADE_HOSPITALAR 3 | EmpresaTela, EstabelecimentosTela, EstruturaTela; `dominio-organizacao/hierarquia.ts` | **F3**: multiestabelecimento desde o início; credenciais vão para o cofre, nunca para coluna | `mantenedora`, `estabelecimento`, `unidade_assistencial`, `logotipo_estabelecimento`, `parametro_estabelecimento` |
| 27 | Setores, clínicas e centros de custo | 10/4 (SETOR\*, SITUACAO_SETOR\*, TURNO_SETOR\*, USUARIO_SETOR\*, RAMAIS_SETOR, UNIDADE_SETOR) | TBCENCUS 99, TBCLINICA 7 (com tipo TISS) | EstruturaTela, LocaisTela | **F3**: estrutura de custo, de faturamento e de acesso | `setor_funcional`, `clinica_assistencial`, `centro_custo_gerencial`, `ramal_setor` |
| 28 | Feriados e dias não úteis por abrangência (nacional, estadual, municipal, estabelecimento) | 3/1 (FERIADO\*, FERIADO_EMPRESA, MANUTENCAO_FERIADO) | TBFERIAD 11 (fixos, móveis e facultativos) | Usado em `dominio-agenda/grade.ts` e `estado-horario.ts` | **F3**: a geração da grade depende disso | `dia_nao_util` |
| 29 | Conferência e exportação com o CNES (habilitações, serviços e classificações, críticas) | 7/0 (LOG_PROCESSA_SCNES, CRITICA_PRESTADOR_SUS, PRESTADOR_SUS_CNS, PRESTADOR_DATASUS, EMPRESA_HABILITACOES_SUS, MULTI_EMPRESAS_SERVICO_CLASSIF, SETOR_SERVICO_CLASSIF_SUS) | Só o CNES do hospital e da unidade e a carga horária (TBHOSPIT, TBUNIDAD, TBCBOPRO_TBUNIDAD); não exporta | CNES em Parâmetros (M51.1, faturamento SUS) | **F7**: hospital novo que atende SUS precisa manter o CNES conferido | `habilitacao_estabelecimento`, `servico_classificacao_estabelecimento`, `remessa_cnes` |

### REC: recepção e atendimento

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 30 | Abertura do atendimento (ambulatório, pronto atendimento, externo): cabeçalho único, tipo, origem, caráter, procedência, regime, procedimento inicial | 21/9 (ATENDIME\*, ATENDIME_INFO\*, ORI_ATE\*, TIP_ATE\*, CARATER_ATENDIMENTO\*, MODALIDADE_ATENDIMENTO\*, CONFIGURA_ATENDIMENTO\*, USU_ORIGEM\*, REGRA_ATENDIMENTO, PROIB_ORIG_ATENDIME) | RECADATE ≥1k (o faturamento é gerado por gatilho), ATCABECATEND ≥1k, ATCONTA ≥1k, TBPROCED 1, TBPROCEDPADRAO 4, TBCADGRUPOATEN 1, TBTIPO_ATENDIMENTO 2, TBTIPO_PROCEDIMENTO 4, TBMODULO_RECEPCAO 3 | AbrirAtendimentoTela, AtendimentosDiaTela, CorrigirFichaTela, ProcedimentosTela; `dominio-atendimento` (caráter, conta aberta, impressos); M20 | **F3**: centro da recepção; a conta nasce por evento do domínio, não por gatilho | `atendimento`, `cobertura_atendimento`, `vinculo_atendimento_conta`, `procedencia_paciente`, `regra_origem_atendimento` |
| 31 | Herança dos dados do atendimento anterior e valores padrão do usuário | 2/0 (CONFIG_USUARIO_ATENDIME, IT_CONFIG_USUARIO_ATENDIME) | REPARATE 1 (campos copiados) | HerancaTela, `dominio-atendimento/heranca.ts` | **F3**: agiliza a recepção de hoje | `regra_heranca_campo` |
| 32 | Encerramento, alta e cancelamento do atendimento, com motivo e trilha | 8/5 (MOT_ALT\*, MOT_CANC\*, MOT_CANCEL\*, LOG_EXCL_ATENDIME\*, TISS_VERSAO_MOT_ALT\*, PENDENCIA_ATENDIMENTO) | REALTA 782 (só jan. a abr. de 2020), TBMOTEXC 10, TBMOTCANCMOD 3, TBMOTCANCTP 2, TBREFCANCMODTP 5 | EncerrarTela, DesfechoPaTela, `desfecho.ts`; `atendimento.cancelar` só na Fase 4 | **F3**: cancelamento com motivo é auditável e mexe na conta | `encerramento_atendimento`, `motivo_cancelamento_operacao` |
| 33 | Senha, fila, guichê, totem e painel de chamada (com voz e prioridade legal) | 12/6 (FILA_SENHA\*, FILA_SENHA_MULTI_EMPRESAS\*, ATENDIME_CHAMADA_PAINEL\*, SACR_MAQUINA_FILA\*, SACR_CONFIGURACAO_MVTOTEM\*, SACR_SENHA_TRIAGEM\*, MVPAINEL_CFG_VOZ, SACR_BALANCEADOR_CHAMADA) | TBSENHAATEND ≥1k, TBFLUXOATEND ≥1k, TBGERASENHA 36, TBRECEPCAO 11, TBGUICHE 9, TBSTATUSGUICHE 4, TBGRUPOPRIORIDADE 10, TBACAOFLUXOSENHA 10, PNCONFIG 5, PNTIPO 3, vínculos da senha com a marcação e com o atendimento ≥1k; TBULTSENHATEND descartável | GuicheTela, TotemTela, PainelChamadaTela, PainelTvTela, GeradoresTela, RecepcoesTela, SupervisorTela, IndicadoresRecepcaoTela; `dominio-recepcao` (fluxo, painel, prioridade); M19 | **F3**: rotina diária da recepção; o contador do dia é derivado, sem tabela | `ponto_recepcao`, `guiche_recepcao`, `gerador_senha`, `senha_emitida`, `evento_senha`, `grupo_prioridade_legal`, `painel_chamada`, `chamada_painel` |
| 34 | Locais de atendimento (consultórios e salas): horário, encaminhamento entre locais e visibilidade | 0/0 (no MV, isso fica dentro de setor e de unidade da central de marcação) | TBLOCAL 31, TBLOCALHORA 31, TBLOCALENCATE 3, TBLOCALPESATE 16 | LocaisTela, `dominio-atendimento/fila-consultorio.ts`, FilaConsultorioTela | **F3**: a fila do consultório usa os locais | `local_atendimento`, `horario_local`, `encaminhamento_local`, `visibilidade_local` |
| 35 | Fichas, guias e comprovantes impressos na recepção (por fonte pagadora, especialidade, grupo e unidade) e declaração de comparecimento | 3/0 (CONFIG_DECLARACAO, DECLARACAO_COMPARECIMENTO_ACOM, CONFIGURACAO_COMPROVANTE_SETOR) | RECONFIC 317, REESPFIC 600, REGRPFIC 20, REUNIFIC 36, REMODFIC 6, RETITFIC 5 | ImpressosTela, `dominio-atendimento/impressos.ts` | **F3**: as regras de impressão estão em uso | `modelo_impresso`, `regra_impressao`, `emissao_declaracao` |
| 36 | Termos e consentimentos assinados na recepção (LGPD, consentimento livre e esclarecido) | 1/1 (TERMOS_MULTI_EMP\*) | Chave do termo em ATPARAMGERAL | TermosTela (recepção) | **F3**: a LGPD exige o registro do aceite | `modelo_termo`, `aceite_termo` |
| 37 | Senha de autorização e elegibilidade da operadora na recepção (regras por fonte pagadora, especialidade, serviço e setor; consulta em linha) | 12/0 (SENHA_AUTORIZACAO, CONTROLE_SENHA_AUT, ORIGEM_SENHA_AUT, CONVENIO_ORIGEM_SENHA_AUT, ELEGIBILIDADE_PACIENTE, PW_CONFIG_TEMPO_AUTZ_CONVENIO) | Número da senha nos campos do atendimento; TBOPERSCHEMA 3 (elegibilidade por serviço web, grupo de integração) | Autorização e elegibilidade só do lado da operadora (M56.5); a recepção guarda a senha | **F7**: hospital novo exige a crítica de elegibilidade antes de atender; o número da senha já entra no F3 do item 30 | `autorizacao_operadora`, `consulta_elegibilidade`, `regra_exigencia_autorizacao` |
| 38 | Regulação: recepção de pedidos da central de regulação, aceite e recusa com motivo | 7/1 (SOLIC_ATENDIMENTO_REGULACAO, SOLICITACAO_ATENDIMENTO, SOLICITACAO_ATENDIMENTO_SIDRA, PW_HISTORICO_ENCAMNH_PAC\*, PW_HISTORICO_REJEICAO_ATND_PAC) | Nada | Fila da rede (FilaRedeTela) entre estabelecimentos da própria rede; sem regulação externa | **F7**: hospital que atende SUS recebe pacientes regulados | `pedido_regulacao`, `evento_regulacao` |
| 39 | Contato ativo com o paciente: ligações, e-mail e mensagem antes da consulta | 3/0 (LIGACAO_PACIENTE, FSCC_CONFIG_EMAIL_SMS, LOG_ENVIO_EMAIL_SMS_PRE_AGE) | Canal de marcação por WhatsApp em RETIPAGE (só o canal, sem registro do contato) | Confirmação e lembretes pela Hal-AI previstos para a Fase 3 do M17 | **F8**: ganho de absenteísmo; integra com a Hal-AI | — |

### AGE: agenda

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 40 | Cadastro de agendas (profissional, serviço ou exame), escala semanal, fontes pagadoras aceitas, especialidades e usuários permitidos | 20/13 (AGENDA_CENTRAL\*, AGENDA_CENTRAL_CONVENIO\*, AGENDA_CENTRAL_ITEM_AGENDA\*, ESCALA_CENTRAL_HORARIO\*, ESCALA_CENTRAL_CONVENIO\*, USUARIO_AGENDA_CENTRAL\*, UNIDADE_ATENDIMENTO) | REAGENDA 138, RECTRAGE 218, REAGENDA_TBCONVEN ≥1k, REAGENDA_TBESPEC 995, AGTPAGENDA 8, SIAGENDA 40, SIAGENDA_TBCONVEN 968, SICTRAGE 26 | AgendasTela, AgendaDetalheTela, EscalasTela; `dominio-agenda` (`nome-agenda`, `cobertura`); M17 e M18 | **F3**: agenda ambulatorial e de exames num modelo único, com o tipo | `agenda_servico`, `escala_semanal`, `pagadora_aceita_agenda`, `especialidade_agenda`, `categoria_agenda`, `permissao_agenda` |
| 41 | Geração da grade de horários por período, com feriados | 6/4 (GERACAO_AGENDA\*, IT_GERACAO_AGENDA\*, AGENDA_GERADA\*, PW_PESQUISA_AGENDA_CRITERIO\*) | REAGECRI ≥1k, SIAGECRI ≥1k (2020 a 2026) | GerarGradeTela, GradeTela, `dominio-agenda/grade.ts` | **F3**: rotina mensal do call center | `lote_geracao_grade`, `horario_disponivel` |
| 42 | Marcação, encaixe, remarcação, situação e confirmação do horário | 10/3 (IT_AGENDA_CENTRAL\*, MOVIMENTO_AGENDA_CENTRAL\*, IT_MOVIMENTO_AGENDA_CENTRAL\*, COTA_PACIENTE, IT_AGENDA_CENTRAL_EQUIPTO) | REPACAGD ≥1k, REPACAGI ≥1k, SIPACAGD ≥1k, SIPACAGI ≥1k, RESITAGE 14, TBSITAGE 16, RETIPAGE 4, TBESTADOCONFIRMACAO 4, AGCADMOTIVO 1 | MarcarTela, MarcacaoTela, PainelDiaTela; `encaixe.ts`, `estado-horario.ts`, `dia.ts` | **F3**: maior volume do grupo; situação, canal e confirmação ficam como domínio | `marcacao_horario`, `historico_marcacao`, `motivo_marcacao` |
| 43 | Bloqueio e desbloqueio da agenda, cancelamento de marcação com motivo e trilha das operações | 5/1 (LOG_OPERA_AGENDA_CENTRAL\*, OPERA_AGENDA, LOG_EXCLUSAO_AGENDAMENTO, LOG_REAGENDAMENTO, JUSTIFICATIVA_AGENDAMENTO) | RECANAGE ≥1k, SICANAGE ≥1k, SIPACAGD_EXCLUSAO 1; AGDIASINDISP descartável (só linha fictícia) | BloqueiosTela, CancelamentosTela | **F3**: em uso diário | `bloqueio_agenda`, `cancelamento_marcacao` |
| 44 | Agenda de exames do diagnóstico (salas e equipamentos como recurso) | 1/0 (AGE_RX) | SIAGENDA 40, SIPACAGD ≥1k, SIPACAGI ≥1k, SIPACAGN ≥1k | `dominio-agenda/exame.ts`; `agenda.exame` desligada até a DP-8 (M18) | **F3**: mesmo modelo do item 40, com a sala ou o equipamento como recurso | `recurso_fisico`, `recurso_agenda` |
| 45 | Itens agendáveis: procedimento ou exame com preparo, pré-requisito, conflito entre itens, composição e equipamento exigido | 12/4 (ITEM_AGENDAMENTO\*, ITEM_AGENDAMENTO_PRESTADOR\*, ITEM_AGENDAMENTO_RECURSO\*, EMPRESA_ORIENTACOES_EXA_RX\*, ITEM_AGENDAMENTO_CONFLITO, ITEM_AGENDAMENTO_PRE_REQ, ORIENTACAO_CONVENIO_ITEM_AGE) | Nada equivalente (a agenda de exames liga o setor, não o item) | Nada além do exame da agenda | **F8**: valor alto para o diagnóstico por imagem (preparo, jejum, contraste); o preparo por item é o primeiro passo | — |
| 46 | Perfis de agendamento: quem pode marcar o quê, por fonte pagadora, especialidade, setor, serviço e unidade | 17/3 (PERFIL_AMBULATORIAL_SETOR\*, PERFIL_AMBULATORIAL_SEGMENTO\*, PERFIL_AMBULATORIAL_TIP_PREST\*, PERFIL_AGENDAMENTO, USUARIO_PERFIL_AGENDAMENTO) | Nada (permissão geral por tela) | Escopo da agenda em `apps/api/src/modulos/agenda/escopo.ts` | **F8**: refina o escopo que já existe; vale para call center grande | — |
| 47 | Restrições e cotas de marcação por fonte pagadora e especialidade, prazos de aviso | 2/0 (RESTRICAO_AGENDAMENTO, PRAZO_AGENDAMENTO_AVISO) | Só a lista de pagadoras aceitas por agenda (item 40) | `dominio-agenda/cobertura.ts` (cobertura, sem cota) | **F8**: controle de cota contratual com operadora | — |
| 48 | Lista de espera por vaga | 3/0 (AGENDA_FILA_ESPERA, FILA_ESPERA_AGENDAMENTO, LOG_FILA_ESPERA_FSCC) | Nada | EsperaTela (`/agenda/espera`), construída no M17 | **F3**: a tela já existe na onda 1 e precisa de tabela na virada | `pedido_lista_espera` |
| 49 | Prioridade legal do paciente na marcação | 3/0 (PRIORID_PACIENTE, PRIORID_PACIENTE_IT_AGEN_CTRAL, PRIORID_PACIENTE_PED_RX) | TBGRUPOPRIORIDADE 10 (usada na senha) | `dominio-recepcao/prioridade.ts` | **F3**: obrigação legal (idoso, gestante, pessoa com deficiência, TEA); reusa a entidade do item 33 | `grupo_prioridade_legal` (compartilhada), `prioridade_marcacao` |
| 50 | Agenda de grupos e turmas (atividade coletiva com vários pacientes) | 13/0 (AGENDA_TURMA, AGENDA_TURMA_PACIENTE, ESCALA_TURMA_HORARIO, GRUPO_AGENDA, GRUPO_AGENDA_PAC) | Só o tipo "grupos" em AGTPAGENDA | Nada específico | **F8**: reabilitação e educação em saúde | — |
| 51 | Agenda de sessões e tratamento seriado (cadeiras e salas, plano terapêutico, quimioterapia e terapias) | 7/0 (AGENDAMENTO_ONCOLOGICO, AGENDA_ONCOLOGICA, HISTORICO_AGENDA_ONCOLOGICA, INTERDICAO_AGENDAMENTO_ONCO, SOLIC_AGENDAMENTO, ATENDIME_SESSAO) | AGCADAGENDA 1, AGCADEIRA 1, AGDURACAO 4, AGCOMPLEXIDADE 4, AGGRPFASEEVOL 4, AGPARAM 1: só padrão, sem uso real | AgendaSessoesTela, `dominio-agenda/sessoes/serie.ts` (M50.6, Fase 5) | **F8**: tela pronta, sem uso na Rede Santé; entra quando houver cliente oncológico | — |
| 52 | Agenda de atendimento domiciliar (escala por área e por profissional) | 7/0 (PW_AGENDA_DOMICILIAR, PW_GERACAO_AGENDA_DOMICILIAR, PW_AREA_PRESTADOR_DOMICILIAR) | Nada | Nada | **F8**: linha de negócio nova (atendimento domiciliar) | — |
| 53 | Pedido de marcação gerado pelo médico ou pela regulação, aguardando vaga | 2/0 (SOLICITACAO_AGENDAMENTO, IT_SOLICITACAO_AGENDAMENTO) | Nada | Nada (a lista de espera cobre em parte) | **F8**: fundir com a lista de espera do item 48 quando entrar | — |
| 54 | Agendamento online, pré-check-in e confirmação pelo paciente | 4/0 (SITE_AGENDAMENTO, SITE_AGENDAMENTO_PROJETO_SERV, REGISTRO_FLUXO_AGENDA, AGENDA_REMESSA) | RETP_INTEG_AGENDA_ONLINE 4, TBSITAGE 16 (situações com integração online), TBESTADOCONFIRMACAO 4, observação para o online em REAGENDA_TBCONVEN | AgendaOnlineTela, PortalAgendarTela, PortalPreCheckinTela, ConferenciaPreCheckinTela; `dominio-agenda/online` (M50.2) | **F3**: a Rede Santé já recebe marcação online e confirmação; o portal próprio completo pode vir depois | `modo_agendamento_online`, `pre_checkin`, `confirmacao_marcacao` |
| 55 | Teleconsulta a partir de agenda que oferece atendimento remoto | 0/0 (nenhuma tabela própria no grupo) | Nada | TelemedicinaTela, TeleconsultaMedicoTela, PortalTeleconsultaTela; `dominio-atendimento/teleconsulta` (M50.4) | **F8**: tela pronta; liga depois da virada, com o termo próprio | — |

### Técnico do fornecedor, transversal ao grupo

| # | Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|---|
| 56 | Cópias espelho do cadastro para a troca de paciente e o histórico do fornecedor | 23/0 (família TROCPAC_ do paciente, da carteira, da biometria, da foto e da agenda de turmas) | Nada (o retrato do SPDATA está no item 8) | Não se aplica | **NAO**: substituído pelo versionamento do item 8 | — |
| 57 | Filas de entrada e saída de integração do fornecedor (agendamento, atendimento, unificação) | 16/0 (IMV_AGENDAMENTO, IMV_ATENDIMENTO, IMV_UNIFICA_PACIENTE, INTEGRA_ENTRADA_AGENDAMENTO, INTEGRA_SAIDA_ATENDIMENTO) | Nada no grupo | `dominio-integracao` com saída por evento | **NAO**: integração pelo nosso barramento (outbox, HL7 FHIR e RNDS), sem tabela por mensagem do fornecedor | — |
| 58 | Personalizações de clientes específicos do fornecedor (conversão de cadastro de outro hospital, convênios estaduais com cálculo próprio, módulo de orçamento) | 14/1 (PRESTADOR_DE_PARA, CONFIG_CONVENIO_ESTADO, VAL_PRO_CONVENIO_ESTADO, PACIENTE_RGHC, FILA_ESPERA_SERVICO, MULTI_EMPRESAS_MV_SAUDE\*) | Nada | Não se aplica | **NAO**: legado de clientes do fornecedor; a parte de operadora vai para o grupo dela | — |
| 59 | Dimensões e fatos de BI do fornecedor sobre paciente, atendimento, fonte pagadora, profissional e empresa | 13/4 (DI_PACIENTE\*, DI_ATENDIMENTO\*, DI_MULTI_EMPRESA\*, DI_TP_ATENDIMENTO\*, FA_ATENDIMENTO, FA_PACIENTE_DIA) | Nada | Data mart próprio (M57.3) e `dominio-relatorio` | **NAO**: o BI nasce do nosso modelo, não de cópia do fornecedor | — |

## Recursos novos do MV que valem a pena

Em ordem de valor para vender e operar. Nenhum deles atrasa a virada.

1. **Itens agendáveis com preparo, pré-requisito e conflito** (item 45). O MV diz o que se agenda, além
   de quem atende: preparo do exame por fonte pagadora, itens que não podem cair no mesmo período e
   equipamento exigido. Para o diagnóstico por imagem, reduz falta e exame perdido. Primeiro passo
   barato: orientação de preparo por item.
2. **Elegibilidade e regra de exigência de senha na recepção** (item 37, F7). O MV diz por regra (fonte
   pagadora, especialidade, serviço, setor) quando a senha da operadora é obrigatória e quanto tempo vale.
   Isso reduz glosa já na porta. No nosso modelo, fica como regra de domínio e consulta TISS em linha.
3. **Planos da fonte pagadora com regras próprias** (item 24, F7). Teto, pendência e documento exigido
   por plano: é o que hospital novo encontra em operadora grande.
4. **Perfis e cotas de agendamento** (itens 46 e 47). Controle de quem marca o quê e de cota contratual
   mensal por operadora e especialidade. Vale para call center centralizado de rede.
5. **Paciente confidencial** (item 10). Marcação de paciente com acesso restrito e liberação nominal ao
   profissional. Encaixa no mascaramento e na quebra de vidro que o new-sgh já tem.
6. **Foto e biometria do paciente** (item 5). Identificação positiva na recepção e no leito, e a guia
   TISS com biometria. Dado sensível: entra com base legal e retenção definidas.
7. **Agenda de grupos e agenda domiciliar** (itens 50 e 52). Abrem linhas de negócio (reabilitação,
   educação em saúde, atendimento domiciliar) sem mexer no núcleo da agenda.
8. **Regulação e exportação do CNES** (itens 38 e 29, F7). São obrigações para hospital que atende SUS.
   O MV mostra o desenho: pedido regulado com aceite e recusa motivados, e críticas do CNES antes da
   remessa.

## Lacunas do new-sgh frente ao SPDATA

O que o SPDATA tem, com uso real, e o new-sgh ainda não fecha. Em quase tudo a regra existe no new-sgh
e falta a tabela própria. Os pontos abaixo pedem decisão ou construção.

1. **Unificação de prontuários desligada.** `cadastro.unificarPaciente` está completa, mas desligada
   (M57.2, D-UNIF-57). No SPDATA, a gravação é feita por gatilho (HTPRONTUNIF). Sem ela, a carga do
   dia 0 traz as duplicatas sem caminho de correção. No banco próprio, vira serviço de domínio com
   desfazer.
2. **Pré-cadastro do agendado sem prontuário só especificado.** `agenda.agendarSemProntuario` e a versão
   para exames estão especificadas (D-SPR-1), não ligadas. No SPDATA, há mais de 1.000 linhas de uso
   (REPACAGN, SIPACAGN).
3. **Agenda de exames desligada** até a correção externa (DP-8, M18). No SPDATA, há uso pleno
   (SIAGENDA, SIPACAGD, SIPACAGI).
4. **Cancelamento do atendimento só na Fase 4** (D-EXC-AGE-20). No SPDATA, está em uso, com motivos
   por módulo e por tipo (TBMOTEXC, TBMOTCANCMOD, TBMOTCANCTP, TBREFCANCMODTP).
5. **Os 385 parâmetros da fonte pagadora** (TBCONVEN) estão na ficha, mas a tabela compartilhada não
   foi separada (D8 e D19 do M12). No modelo próprio, é preciso decompor esses parâmetros por tema e
   decidir, com o faturamento, o destino de cada grupo.
6. **Abertura que gera a conta por gatilho.** No SPDATA, o lançamento do faturamento sai da ficha por
   gatilho (RECADATE), e o new-sgh depende desse gatilho. No banco próprio, a abertura emite o evento
   que cria a conta: comportamento novo, com teste próprio.
7. **Retrato imutável do cadastro.** O SPDATA guarda versões de paciente, profissional, telefones e
   fonte pagadora (família HT\*, mais de 1.000 linhas cada). O new-sgh só lê essas versões. O modelo
   próprio precisa gravá-las sem gatilho (versionamento de sistema ou serviço de domínio).
8. **Credenciais dentro do cadastro do hospital** (TBHOSPIT). O new-sgh não as migra. No modelo
   próprio, ficam no cofre e o conector as descarta.
9. **Contas bancárias e dados fiscais do profissional** (TBPROFIS), que alimentam o repasse. O new-sgh
   usa esses dados no repasse, mas o cadastro do profissional (M11) não os edita. É preciso um dono de
   tela no modelo próprio.
10. **Domínios só com valor padrão** (AGTPAGENDA e RETPAGEN duplicados, agenda de cadeiras só com o
    padrão, TBETNIA com 1 linha, TBVULNERABILIDADE_SOCIAL com 1 linha). Não são lacuna de função, mas
    de carga. A carga pública (etnias indígenas, CBO, CNES) tem de vir pronta no hospital do zero.

## Fronteiras (tocam o grupo, analisadas em outro)

| Tema | MV n/d | Onde fica |
|---|---:|---|
| Classificação de risco no pronto atendimento (protocolos, perguntas, cores, auditoria) | 93/29 | Grupo de urgência e PEP. No new-sgh, está em `dominio-recepcao/classificacao` (M44.1) |
| Portaria, visitantes, acompanhantes e crachá | 41/17 | Grupo de hotelaria e portaria. No SPDATA, família CV\* (HOT); no new-sgh, portaria (M50.5) |
| Agenda do centro cirúrgico | 4/3 | Grupo de centro cirúrgico (`cirurgia.agenda`, M18) |
| Referências clínicas do módulo CAD do SPDATA (CID-10, CIAP, DCB, alergias, princípios ativos, vias, unidades de medida) | — | Grupos de catálogos e PEP |
| Cabeçalhos das tabelas de preço (diárias e taxas, materiais e medicamentos, honorários) | — | Grupo de preços e faturamento |
| Esquema da operadora (`DBAPS`) | — | Grupo da operadora |

## Entidades próprias propostas (F3 e F7)

115 nomes distintos (25 + 6 + 17 + 10 + 13 + 24 + 20). `grupo_prioridade_legal` aparece nos itens 33 e 49, mas conta uma vez.

- **Pessoa e paciente** (25): `pessoa_fisica`, `paciente`, `documento_pessoa`,
  `prontuario_estabelecimento`, `sequencia_prontuario`, `regra_campo_cadastro`, `endereco_pessoa`,
  `telefone_pessoa`, `email_pessoa`, `vinculo_responsavel`, `tipo_parentesco`, `pre_cadastro`,
  `unificacao_prontuario`, `suspeita_duplicidade`, `versao_paciente`, `versao_profissional`,
  `cobertura_paciente`, `titular_cobertura`, `origem_indicacao`, `registro_obito`, `tipo_dominio`,
  `valor_dominio`, `modelo_termo`, `aceite_termo`, `emissao_declaracao`.
- **Referências geográficas** (6): `municipio_ibge`, `unidade_federativa`, `pais_referencia`, `logradouro_cep`,
  `especie_logradouro`, `area_ddd`.
- **Profissional** (17): `profissional`, `conta_bancaria_profissional`, `registro_especialista`,
  `conselho_classe`, `ocupacao_cbo`, `especialidade_medica`, `especialidade_ocupacao`,
  `inscricao_conselho`, `profissional_especialidade`, `especialidade_procedimento`,
  `lotacao_profissional`, `tipo_vinculo_trabalho`, `credenciamento_pagadora`, `solicitante_externo`,
  `codigo_solicitante_pagadora`, `autorizacao_operadora`, `consulta_elegibilidade`.
- **Fonte pagadora** (10): `fonte_pagadora`, `parametro_fonte_pagadora`, `grupo_fonte_pagadora`,
  `logotipo_fonte_pagadora`, `plano_fonte_pagadora`, `regra_plano`, `documento_exigido_plano`,
  `configuracao_tiss_pagadora`, `faixa_numeracao_guia`, `regra_exigencia_autorizacao`.
- **Estabelecimento** (13): `mantenedora`, `estabelecimento`, `unidade_assistencial`,
  `logotipo_estabelecimento`, `parametro_estabelecimento`, `setor_funcional`, `clinica_assistencial`,
  `centro_custo_gerencial`, `ramal_setor`, `dia_nao_util`, `habilitacao_estabelecimento`,
  `servico_classificacao_estabelecimento`, `remessa_cnes`.
- **Recepção e atendimento** (24): `atendimento`, `cobertura_atendimento`,
  `vinculo_atendimento_conta`, `procedencia_paciente`, `regra_origem_atendimento`,
  `regra_heranca_campo`, `encerramento_atendimento`, `motivo_cancelamento_operacao`, `ponto_recepcao`,
  `guiche_recepcao`, `gerador_senha`, `senha_emitida`, `evento_senha`, `grupo_prioridade_legal`,
  `painel_chamada`, `chamada_painel`, `local_atendimento`, `horario_local`, `encaminhamento_local`,
  `visibilidade_local`, `modelo_impresso`, `regra_impressao`, `pedido_regulacao`, `evento_regulacao`.
- **Agenda** (20): `agenda_servico`, `escala_semanal`, `pagadora_aceita_agenda`,
  `especialidade_agenda`, `categoria_agenda`, `permissao_agenda`, `lote_geracao_grade`,
  `horario_disponivel`, `marcacao_horario`, `historico_marcacao`, `motivo_marcacao`, `bloqueio_agenda`,
  `cancelamento_marcacao`, `recurso_fisico`, `recurso_agenda`, `pedido_lista_espera`,
  `prioridade_marcacao`, `modo_agendamento_online`, `pre_checkin`, `confirmacao_marcacao`.

Notas de desenho para o modelo MariaDB:

- **Pessoa única.** `pessoa_fisica` é a pessoa única: paciente, responsável, profissional e solicitante
  apontam para ela. `paciente` e `profissional` são papéis. O número de prontuário é por
  estabelecimento (`prontuario_estabelecimento`), o que prepara o índice mestre da rede.
- **Domínios num par de tabelas.** Os domínios simples (situação, canal, caráter, regime, motivo de alta,
  sexo, raça/cor e afins) ficam em `tipo_dominio` e `valor_dominio`, cada valor com o código do padrão
  público (IBGE, RNDS, TISS). Ganham tabela própria só quando têm atributos ou regras.
- **Um atendimento para todos os tipos.** `atendimento` é o cabeçalho único (ambulatório, pronto
  atendimento, internação, exame externo). A conta nasce por evento do domínio, e
  `vinculo_atendimento_conta` registra o resultado.
- **Uma agenda para consulta e exame.** `agenda_servico` atende os dois, com a categoria da agenda e o
  recurso (`recurso_agenda`). Some a separação física entre agenda ambulatorial e agenda de exames.
- **Sem tabela larga de parâmetros.** `parametro_fonte_pagadora` e `parametro_estabelecimento` são
  chave e valor tipados e versionados, com catálogo de chaves validado no domínio.
