# Fatia F2.4 06-faturamento (assunto: faturamento; cliente de teste próprio: f24_06faturamento)

## apps/api/src/modulos/faturamento/porta-propria.ts
- modelo-pendente: linhas 16,118
    16: // tela da conta e a nota de sala: até lá, as leituras saem vazias e as gravações recusam com "modelo-pendente".
    118: new ErroOperacao(409, 'modelo-pendente', titulo, detalhe);

## apps/web/src/modulos/faturamento/i18n-contratualizacao.ts
- nome-origem: linhas 232,233,234,235,236,237,238,239,240,241,242
    232: CMPERIODO: 'Periodicidades das metas',
    233: CMTPINDICADOR: 'Grupos de indicadores',
    234: CMTIPOCOMPLEXIDADESP: 'Blocos de financiamento',
    235: CMTPITEMINDIC: 'Formatos da resposta do indicador',
    236: CMREDEASSIST: 'Redes de atenção',
    237: CMESCORE: 'Escores',
    238: CMTPAFERICAO: 'Fontes da aferição',
    239: CMTPCONTRATO: 'Esferas do gestor',
    240: CMTPDADOS: 'Tipos de dado',
    241: CMTPORCAMENTO: 'Partes do orçamento',
    242: CMINCENTIVO: 'Incentivos',

## packages/contratos/src/faturamento/contratualizacao.ts  (só comentário)
- nome-origem: linhas 7,8,9,23,31,38,56,64,77,88,97,106,117,262
    7: // CMTPCONTRATO, orçamento = CMTPORCAMENTO, periodicidade = CMPERIODO, indicador = CMTPINDICADOR, formato =
    8: // CMTPITEMINDIC, aferição = CMTPAFERICAO, escore = CMESCORE, rede = CMREDEASSIST, complexidade = CMTIPOCOMPLEXIDADESP,
    9: // incentivo = CMINCENTIVO), lidos onde estão. As tabelas de domínio têm gatilho que recusa toda gravação (D-DOM-555): o
    23: /** CMTPCONTRATO: a esfera do gestor contratante. */
    31: /** CMTPORCAMENTO: as duas partes do orçamento do contrato. */
    38: * CMPERIODO: a periodicidade da meta. `meses` é o tamanho do período em competências; as submensais (diária, semanal,
    56: /** Os códigos de CMPERIODO que não servem para meta (diária 4, quinzenal 7, semanal 8). */
    64: /** CMTPINDICADOR: o grupo do indicador qualitativo (o 0 "não informado" do domínio não é aceito numa meta). */
    77: * CMTPITEMINDIC: o formato da resposta do indicador. Só os mensuráveis entram numa meta: sim ou não (2), valor decimal
    88: /** CMTPAFERICAO: de onde vem o dado que comprova o indicador (rótulo do produto no código 1, D-AFER-555). */
    97: /** CMESCORE: o escore do período, da faixa de cumprimento (4 é o melhor). */
    106: /** CMREDEASSIST: a rede de atenção do contrato (0 = não informada). */

## packages/contratos/src/faturamento/entradas.ts
- vocab-antigo: linhas 39
    39: /** HHMM. */
- nome-origem: linhas 72,97,141
    72: /** Tipo de TBIRREGULARID (0 = tipo do novo: regra de faturabilidade, item sem preço). */
    97: /** RECADATE.REG da ficha com ATU_FAT='F'. */
    141: /** Prontuário (RICADPAC.PRONT) ou 0 quando ainda sem cadastro. */

## packages/contratos/src/faturamento/regras/escopo.ts  (só comentário)
- nome-origem: linhas 2
    2: // dos convênios do seu escopo (TBUSERS_TBCONVEN e TBUSERCON do outro sistema, lidos pelo M06). Lista vazia = sem

## packages/contratos/src/faturamento/regras/explicador.ts  (só comentário)
- nome-origem: linhas 47,57,63
    47: /** Valor por componente (TBVLRTHM: VALOR_CH, VALOR_CO, VALOR_FILME), modelo VALOR. */
    57: /** Referência de mat/med (TBVLRMEM: VALOR) e, quando houver, PMC e PF do Brasíndice. */
    63: /** Diária ou taxa (TBVLRDTH: VALOR). */

## packages/contratos/src/faturamento/regras/fechamento.ts  (só comentário)
- nome-origem: linhas 9
    9: /** Valores de FCCTAEXT.PACOTE já vistos (Anexo A); P, D e F "a confirmar" (DP-46.5). */

## packages/contratos/src/faturamento/regras/onda4.ts
- nome-origem: linhas 284,285,286,287,288,289,290,291,329
    284: { coluna: 'MFCONPAG.STATUS', dp: 'DP-46.3', pergunta: 'FIS-08', citados: [] },
    285: { coluna: 'MFCONPAG.TP_PGTO', dp: 'DP-46.3', pergunta: 'FIS-08', citados: [] },
    286: { coluna: 'MFCTAREC.ORIGEM', dp: 'DP-46.4', pergunta: 'FIS-09', citados: ['F', 'E'] },
    287: { coluna: 'MFLANCTO.TIPO_TRF', dp: 'DP-46.4', pergunta: 'FIS-09', citados: ['I', 'T', 'C', 'D'] },
    288: { coluna: 'FCCTAEXT.TIPO_NOTA', dp: 'DP-46.5', pergunta: 'FIS-10', citados: [] },
    289: { coluna: 'FCCTAEXT.PACOTE', dp: 'DP-46.5', pergunta: 'FIS-10', citados: ['P', 'D', 'F'] },
    290: { coluna: 'FCLANEXT.FPA', dp: 'DP-46.5', pergunta: 'FIS-10', citados: [] },
    291: { coluna: 'FCLANEXT.VEIO', dp: 'DP-46.5', pergunta: 'FIS-10', citados: ['B', 'P', 'D'] },
    329: /** Situação da conta no outro sistema (FCCTAEXT.FECHADA): N aberta, S fechada, A apresentada (em lote). */

## packages/contratos/src/faturamento/regras/pacote.ts  (só comentário)
- nome-origem: linhas 1
    1: // Pacote (ficha do M30, regra 10; Anexo A; cap-06b §6.5): FCCTAEXT.PACOTE C = conta por pacote (o total é o do pacote,

## packages/contratos/src/faturamento/regras/particular.ts  (só comentário)
- nome-origem: linhas 15
    15: * O convênio do particular (TBCONVEN 10 na rede, o mesmo da agenda e do orçamento de exames). O recebimento do caixa

## packages/contratos/src/faturamento/regras/situacao.ts  (só comentário)
- nome-origem: linhas 1,76
    1: // Situação da conta (ficha do M30, regras 2 e 3; Anexo A, A.5). FCCTAEXT.FECHADA: N aberta, S fechada e não
    76: /** A conta está em algum lote TISS (FCCTAEXT_FCTISSLOTEPROT). */

## packages/contratos/src/faturamento/regras/tipo-item.ts  (só comentário)
- nome-origem: linhas 1,48
    1: // Grupo do item da conta (ficha do M30, regra 6; ref 01 §2.3; Anexo A): FCLANEXT.TIPO é o único separador confiável da
    48: /** Origem do item (FCLANEXT.VEIO; Anexo A): só valores já vistos; B, P e D com a legenda "a confirmar" (DP-46.5). */

## packages/contratos/src/faturamento/regras/tiss.ts  (só comentário)
- nome-origem: linhas 5,18,21,32,36,309
    5: //   - regra 2: numeração pelos contadores do outro sistema (TBSEGUIA, tipo de guia 0), 12 dígitos com zeros à esquerda;
    18: /** Tipos de guia do outro sistema (TBTISSTPGUIA) que o lote do novo monta. */
    21: /** Tipo de guia do recurso de glosa (TBTISSTPGUIA 8). */
    32: /** Transação do outro sistema (TBTISSSCHEMA.ID) gravada no lote: 4 envio de lote de guias, 5 recurso de glosa. */
    36: /** Contador do outro sistema para os lotes de guia e de recurso (TBSEGUIA.TIPO_GUIA = 0; 36 de 37 convênios conferem). */
    309: /** Motivo que não admite reapresentação (TBMOTGLO.REAPRESENTA='F'): alerta, nunca bloqueio. */

## packages/contratos/src/faturamento/respostas.ts  (só comentário)
- nome-origem: linhas 53,303
    53: /** "novo" (SGH_FAT_PENDENCIA) ou "outro" (FCIRREGULARID, até 03/2022, só leitura). */
    303: /** "novo" (SGH_FAT_RECIBO) ou "antigo" (FCRECIBO, 2020 a 05/2021, só leitura). */

## packages/contratos/src/faturamento/sus-aih.ts  (só comentário)
- nome-origem: linhas 30,108,114,126,261,263
    30: /** Caráter da internação na tabela do SIH (RICADINT.CARINT guarda 1 e 2: eletivo e urgência). */
    108: /** O registro da internação (RICADINT.REG). */
    114: /** O médico solicitante SUS (FAMEDSOL: a chave é o CPF dele, como no cadastro). */
    126: /** O item da conta (FCLANEXT.ID) com o vínculo SIGTAP do grupo 07. */
    261: /** O item da conta (FCLANEXT.ID); null na diária de UTI. */
    263: /** O tipo de UTI do SIH (FHLEITOUTITP) na diária. */

## packages/contratos/src/faturamento/sus-apac.ts  (só comentário)
- nome-origem: linhas 91,98,270
    91: /** O registro do atendimento ambulatorial do laudo (RECADATE.REG). */
    98: /** O médico solicitante SUS (FAMEDSOL), pela chave opaca que a busca dos solicitantes devolve. */
    270: /** O médico solicitante SUS achado para o laudo (FAMEDSOL): a chave opaca, o nome, o CRM e se o CNS é válido. */

## packages/contratos/src/faturamento/sus-bpa.ts  (só comentário)
- nome-origem: linhas 60,64
    60: /** Busca de médico solicitante no cadastro geral (TBMEDSOL, 7.660 na cópia): conselho ou nome, 2 a 60 caracteres. */
    64: /** Um médico solicitante do cadastro geral (TBMEDSOL): número do conselho, nome, UF, CBO e situação. */

## packages/contratos/src/faturamento/sus.ts  (só comentário)
- nome-origem: linhas 210,242,252,262,371
    210: * faturamento.registrarEquivalenciaSus: o procedimento do hospital (FCLANEXT.ID_TBPROCTO, o procedimento unificado de
    242: /** Busca no servidor (lista grande: TBPROSUS e o cadastro de procedimentos do hospital), de 2 a 60 caracteres. */
    252: /** Um procedimento SIGTAP achado na busca (TBPROSUS). */
    262: /** Um procedimento do hospital (TBPROCTO: o código na tabela do convênio, o nome e a tabela). */
    371: /** O procedimento do hospital (TBPROCTO.ID). */

## packages/contratos/src/faturamento/tiss-entradas.ts  (só comentário)
- nome-origem: linhas 3,31,50,109
    3: // (TBSEGUIA, sob trava) e o banco fazem. A versão de cada item é o carimbo DATA_HORA_ULTIMA_ATUALIZACAO como a tela leu
    31: /** Data do protocolo informada (a do comprovante), a recibo e a situação TISS (TBTISSSITPROT, 1..10). */
    50: /** TBMOTGLO.CODIGO (tabela 38 da TISS); 0 = não informado (só sem glosa). */
    109: /** faturamento.fecharCompetencia: CONVENIO + ANO + MES em FCFECMES. */

## packages/contratos/src/faturamento/tiss-lote.ts
- vocab-antigo: linhas 34
    34: readonly atendimentoRN: 'S' | 'N';
- nome-origem: linhas 18
    18: /** FCLANEXT.TIPO: 1 diárias e taxas, 2 honorários, 3 SADT, 4 mat/med. */

## packages/contratos/src/faturamento/tiss-respostas.ts  (só comentário)
- nome-origem: linhas 161
    161: /** O sequencial do item na guia enviada (FCLANEXTSEQITEM): é por ele que o demonstrativo casa. */

## packages/dominio-faturamento/src/sus/aih.ts  (só comentário)
- nome-origem: linhas 7,8,134,137,238,270,279,287,293,304
    7: //     permanência coerente; as diárias de UTI vêm da trajetória (RICTRLOC nas acomodações de UTI), pelo tipo de UTI do
    8: //     SIH e com leito habilitado (FHLEITOUTI).
    134: /** Acomodações de UTI do outro sistema (TBTIPOACOMOD): UTI, CTI, unidade coronária, CTI cardiovascular, UTI neonatal. */
    137: /** Uma passagem da trajetória (RICTRLOC): datas AAAA-MM-DD e o tipo de acomodação. */
    238: /** Um item da conta da internação (FCLANEXT) com o vínculo SIGTAP e o executante. */
    270: /** A internação (RICADINT) com a conta, o paciente e a especialidade do leito. */
    279: /** Especialidade do leito (TBESPLEI.COD), para o validador. */
    287: /** O procedimento SIGTAP pelo ID (TBPROSUS), com os atributos na competência da alta. */
    293: /** Leitos de UTI habilitados por tipo do SIH (FHLEITOUTI: soma de QTDE_LEITO). */
    304: /** TBPROSUS.ID (para os valores da competência); null quando o código não está no catálogo. */

## packages/dominio-faturamento/src/sus/apac.ts  (só comentário)
- nome-origem: linhas 184
    184: /** A APAC gravada no Sante como a montagem a lê (o solicitante com o CNS e o nome do cadastro FAMEDSOL). */

## packages/dominio-faturamento/src/sus/bpa.ts  (só comentário)
- nome-origem: linhas 3,29,38,41
    3: // 1). Cada procedimento vai ao instrumento de registro que a SIGTAP da competência permite (TBPROREG):
    29: /** O profissional executante do item (FCLANEXT.ID_TBCBOPRO_TITULAR × TBCBOPRO × TBPROFIS). */
    38: /** TBPROSUS.ID do vínculo do gatilho (FCCTRLANCIHA); null sem equivalente. */
    41: /** O procedimento unificado do item (FCLANEXT.ID_TBPROCTO): a chave da equivalência do Sante. */

## packages/dominio-faturamento/src/sus/ciha.ts  (só comentário)
- nome-origem: linhas 4,39,42,45,62,82,84,86,88,143,153,156,159,174
    4: // FCCTRLANCIHA para cada item lançado, ou a equivalência registrada no Sante), o CID principal e os dados que o leiaute
    39: /** Um item da conta com o vínculo SIGTAP (FCLANEXT × FCCTRLANCIHA). */
    42: /** TBPROSUS.ID do vínculo; null quando o gatilho não achou equivalente. */
    45: /** O procedimento do item na tabela do hospital (FCLANEXT.PROCTO): a chave da equivalência registrada no Sante. */
    62: /** Número do prontuário (RICADPAC.PRONT). */
    82: /** Motivo da alta na tabela do SIH (RICADINT.MOTIVO; a internação exige). */
    84: /** Código do beneficiário na operadora (FCCTAEXT.MATRICULA; a fonte "plano privado" exige). */
    86: /** Número da guia TISS (FCCTAEXT.GUIA; só vai na fonte "plano privado"). */
    88: /** Registro ANS e CNPJ da operadora do convênio (TBCONVEN.REG_ANS e CGC). */
    143: /** Instrumentos de registro do procedimento na competência (TBPROREG); vazio = não conhecido. */
    153: /** O procedimento SIGTAP pelo ID (TBPROSUS) e os atributos na competência (regra 2); null se não existe. */
    156: /** CID-10 existente (TBCID10); a forma é conferida aqui. */

## packages/dominio-faturamento/src/sus/compatibilidade.ts  (só comentário)
- nome-origem: linhas 5,6,7,9,10,21,113
    5: //   - TBSUSCID (procedimento × CID): com lista vigente, o CID principal tem de estar nela;
    6: //   - TBSUSCBO (procedimento × CBO): com lista vigente, o CBO do executante tem de estar nela;
    7: //   - TBPROHAB (procedimento × habilitação): com lista vigente, o estabelecimento precisa de uma das habilitações (as do
    9: //   - TBPROLEI (procedimento × especialidade do leito): com lista, o leito da internação tem de estar nela (AIH);
    10: //   - TBPROREG (procedimento × instrumento de registro): o instrumento de saída tem de ser um dos registros;
    21: /** TBPROSUS.ID. */
    113: /** Especialidade do leito (TBESPLEI.COD) na internação; null fora dela. */

## packages/dominio-faturamento/src/sus/identificacao-sus.ts  (só comentário)
- nome-origem: linhas 53
    53: /** CNES do estabelecimento: 7 dígitos, nunca zero (no banco de dev, TBEMPHOS.CNES está zerado: vem do parâmetro). */

## packages/dominio-faturamento/src/sus/instrumento.ts  (só comentário)
- nome-origem: linhas 2,27,31,33
    2: // é escolhido pelo financiador e pelo instrumento de registro do procedimento na SIGTAP (TBPROREG, a
    27: /** O financiador da conta: o convênio SUS (TBCONVEN 1 nos dois hospitais), o particular (10) ou outro convênio. */
    31: /** Códigos de TBCONVEN do SUS (parâmetro por estabelecimento; padrão [1]). */
    33: /** Códigos de TBCONVEN do particular (padrão [10], o mesmo do M30). */

## packages/dominio-faturamento/src/sus/meta.ts  (só comentário)
- nome-origem: linhas 5
    5: //     indicador, cada uma com periodicidade (CMPERIODO, mensal ou maior), pontos e escore (CMESCORE);

## packages/dominio-faturamento/src/sus/producao-ambulatorial.ts  (só comentário)
- nome-origem: linhas 2,6,8
    2: // (RECADATE com LAB='S' e ESPEC=0) não é atendimento e não entra na CIHA nem no BPA. A consulta no banco já filtra
    6: /** RECADATE.LAB ('S' na requisição de laboratório). */
    8: /** RECADATE.ESPEC (0 na requisição). */

## packages/dominio-faturamento/src/sus/sigtap-competencia.ts  (só comentário)
- nome-origem: linhas 2,3,4,22,25,33,39,62,85,86
    2: // nunca a vigente hoje. O legado guarda o procedimento atual em TBPROSUS (com COMP_INICIAL e COMP_FINAL), os
    3: // atributos de competências anteriores em HTPROSUS (ANO_MES_COMPETENCIA + ID_TBPROSUS) e os valores datados em
    4: // TBVLRSUS (DATA). O importador do M13 (`catalogo.importarSigtap`) é quem mantém as três.
    22: /** O procedimento atual (TBPROSUS). */
    25: /** Código SIGTAP de 10 dígitos (TBPROSUS.CODSUS ou CODSUS10). */
    33: /** Uma linha de HTPROSUS: os atributos como eram na competência. */
    39: /** Uma linha de TBVLRSUS (valores em reais; DATA é o início da vigência). */
    62: * O limite de idade do outro sistema em meses. TBPROSUS.IDMIN/IDMAX e HTPROSUS.IDADE_MINIMA/MAXIMA guardam ANOS (na
    85: * Os atributos que valiam na competência (regra 2). Linha de HTPROSUS com ANO_MES_COMPETENCIA = X é o retrato do
    86: * procedimento durante X. Decisão do preparo (POL-5): depois do último retrato vale o atual (TBPROSUS), porque o

## packages/dominio-faturamento/src/tiss/lote.ts
- vocab-antigo: linhas 27
    27: readonly atendimentoRN: 'S' | 'N';
