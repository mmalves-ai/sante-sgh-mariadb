# Fatia F2.4 08-cirurgia (assunto: cirurgia; cliente de teste próprio: f24_08cirurgia)

## apps/api/src/modulos/cirurgia/anestesia-porta-memoria.ts  (só comentário)
- nome-origem: linhas 42
    42: * Os registros profissionais (TBCBOPRO) dos logins sintéticos do bloco: o anestesista do agendamento sintético (5002),

## apps/api/src/modulos/cirurgia/anestesia-porta-propria.ts
- modelo-pendente: linhas 8,54,64
    8: // modelo-pendente — a ficha e o checklist exigem o ato cirúrgico (ato_cirurgico_id NOT NULL), que só nasce no registro;
    54: return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_ANESTESIA_PENDENTE };
    64: new ErroOperacao(409, 'modelo-pendente', 'Gravação aguardando o modelo', MOTIVO_ANESTESIA_PENDENTE),

## apps/api/src/modulos/cirurgia/anestesia-porta.ts  (só comentário)
- nome-origem: linhas 87
    87: /** O profissional da sessão (os registros TBCBOPRO ativos); null sem cadastro de profissional. */

## apps/api/src/modulos/cirurgia/anestesia.controller.ts
- nome-origem: linhas 359
    359: req.sghAlvo = { tabelaAlvo: 'CCAGENDA' };

## apps/api/src/modulos/cirurgia/banco-apoio.ts
- vocab-antigo: linhas 33
    33: /** "HHMM" ou "HH:MM" → "HH:MM". */

## apps/api/src/modulos/cirurgia/bloco-seguro-porta-propria.ts
- modelo-pendente: linhas 8,46,56
    8: // 409 modelo-pendente (o checklist exige o ato cirúrgico, que só nasce no registro; o rastreio exige a unidade cirúrgica
    46: return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_BLOCO_PENDENTE };
    56: new ErroOperacao(409, 'modelo-pendente', 'Gravação aguardando o modelo', MOTIVO_BLOCO_PENDENTE),

## apps/api/src/modulos/cirurgia/bloco-seguro-porta.ts  (só comentário)
- nome-origem: linhas 43
    43: /** A chave natural da cirurgia: liga o ato registrado (CCCADCIR pelo REG), quando há. */

## apps/api/src/modulos/cirurgia/cirurgia.controller.ts
- nome-origem: linhas 208
    208: req.sghAlvo = { tabelaAlvo: 'CCAGENDA', idAlvo: String(d.agendamento.id) };

## apps/api/src/modulos/cirurgia/operacoes.ts
- modelo-pendente: linhas 72
    72: new ErroOperacao(409, 'modelo-pendente', 'Operação aguardando o modelo', detalhe);
- vocab-antigo: linhas 654
    654: 'O registro do ato cirúrgico pela tela aguarda o mapeamento dos usos, dos tempos em HHMM e do porte/contaminação em letras do contrato para ato_cirurgico, ato_cirurgico_procedimento e participante_cir

## apps/api/src/modulos/cirurgia/porta-propria.ts
- modelo-pendente: linhas 14,142,155,734,746
    14: // e versões do pedido) e o registro do ato pela tela (registrarCirurgia) recusam com 409 modelo-pendente.
    142: if (pendente) return { pode: false, codigo: 'modelo-pendente', motivo: pendente };
    155: if (pendente) throw new ErroOperacao(409, 'modelo-pendente', 'Operação aguardando o modelo', pendente);
    734: 'modelo-pendente',
    746: 'modelo-pendente',

## apps/api/src/modulos/cirurgia/porta.ts  (só comentário)
- nome-origem: linhas 150
    150: /** M50 (etapa 3): a agenda do cirurgião (os registros dele em CCAGENDA.ID_CRM), no período. */

## packages/contratos/src/cirurgia/anestesia-entradas.ts  (só comentário)
- nome-origem: linhas 3,4,61,125,198,208
    3: // cirurgia.registrarSrpa. Validadas na tela, na API e no executor (o mesmo Zod). O agendamento é CCAGENDA.ID; o
    4: // profissional é o ID de TBCBOPRO com o código do par (o mesmo do M18); o medicamento é o item de GEITENS.
    61: /** Tipo de anestesia planejado (TBANESTESIA.COD; lido da tabela). */
    125: /** Item do estoque (GEITENS.ID). */
    198: /** Função na equipe (PRTIPO_PROFISSIONAL.ID; lida da tabela). */
    208: /** TBPROENF.COD quando o procedimento está no cadastro; null = descrito. */

## packages/contratos/src/cirurgia/anestesia-respostas.ts  (só comentário)
- nome-origem: linhas 61,95
    61: /** O anestesista do agendamento (ID de TBCBOPRO; null = sentinela, sem anestesista). */
    95: /** O formulário do prontuário (PRCABEVOL.ID) quando o formulário novo do M45 estiver publicado. */

## packages/contratos/src/cirurgia/anestesia-vocabulario.ts  (só comentário)
- nome-origem: linhas 7,8,9,11,74
    7: // diferir, por isso a tela lê a tabela e não fixa o ID): tipo de anestesia (TBANESTESIA, 17 na cópia pc), posição
    8: // cirúrgica (PRFA_CAD_POSICAO_CIR, 9), modo respiratório (PRFA_CAD_MODO_RESPIR, 3), função na equipe
    9: // (PRTIPO_PROFISSIONAL, 9) e utilização (PRFA_UTILIZACAO, 3). Os cadastros de gás (PRFA_CAD_GAS), de incidente
    11: // sinais da ficha são vocabulário do novo, com a sigla do cadastro antigo quando ele existe (PRFA_TIPO_SINAL: FC,
    74: * cobra o sinal (obrigatório). A sigla do cadastro antigo (PRFA_TIPO_SINAL) vai junto quando existe.

## packages/contratos/src/cirurgia/bloco-seguro-entradas.ts  (só comentário)
- nome-origem: linhas 4
    4: // (o mesmo Zod). O agendamento é CCAGENDA.ID; o local e o tipo de movimentação são os IDs do cadastro do bloco.

## packages/contratos/src/cirurgia/entradas.ts
- vocab-antigo: linhas 4
    4: // cadastro único (RICADPAC), o atendimento é o REG. Datas AAAA-MM-DD e horas HHMM (a tela converte de HH:MM);
- nome-origem: linhas 2,3,4,26,75,78,86,177,244
    2: // tela, na API e no executor (o mesmo Zod). Vocabulário do novo: o agendamento é o ID de CCAGENDA, a sala é o código
    3: // de CCSALAS, o profissional é o ID de TBCBOPRO com o código (COD) que o par do gatilho exige, o paciente é o ID do
    4: // cadastro único (RICADPAC), o atendimento é o REG. Datas AAAA-MM-DD e horas HHMM (a tela converte de HH:MM);
    26: /** Profissional escolhido: o ID (TBCBOPRO) e o código do par. */
    75: /** Tipo de anestesia (TBANESTESIA.COD; 0 = não informado). */
    78: /** Pediatra (TBCBOPRO.ID); null = sem pediatra (o par fica no sentinela 1). */
    86: /** Caráter (CCTPURGENCIA) e a solicitação que é confirmada (vão ao estado do novo). */
    177: /** O agendamento (CCAGENDA.ID) de que o ato nasceu; null = registro sem agendamento (urgência). */
    244: /** TBUSERS.NOME (login do outro sistema; sensível a maiúsculas como lá). */

## packages/contratos/src/cirurgia/respostas.ts  (só comentário)
- nome-origem: linhas 33
    33: /** CCAGENDA.ID; null para a solicitação que ainda não ocupa a sala. */

## packages/contratos/src/cirurgia/vocabulario.ts  (só comentário)
- nome-origem: linhas 3,4,71,78
    3: // legado não guarda motivo do cancelamento: CCAGENDA_EXC_CANC.JUSTIF vazia em 100%), quem pediu, pendências
    4: // pré-operatórias e os recursos da sala que a agenda marca (as colunas T/F de CCAGENDA: CTI, microscópio,
    71: /** Caráter da cirurgia (CCTPURGENCIA na cópia pc: 1 Urgência, 2 Eletiva, 3 Acidente; a tela lê a tabela). */
    78: /** CCAGENDA.ATEND: I paciente internado (820 de 821), E externo. */

## packages/dominio-cirurgia/src/checklist/trava.ts
- vocab-antigo: linhas 67
    67: /** A incisão do registro do ato (HHMM no dia do ato) como instante local. */

## packages/dominio-cirurgia/src/equipe.ts  (só comentário)
- nome-origem: linhas 1,2,3,4,6,11,37,60
    1: // Equipe cirúrgica (ficha do M18, regra 6; cap-05a §5.5). CCAGENDA guarda sete pares (código do profissional, ID em
    2: // TBCBOPRO) mais o pediatra (só o ID); o gatilho TRG_CCAGENDA_BIU confere cada par contra TBCBOPRO e recusa o par que
    3: // não casa (E_GERAL_ID_PROFIS_INVALIDO). Profissional ausente = par (0, 1): TBCBOPRO ID 1 tem COD 0 (690 de 830
    4: // agendamentos desde 10/2025 com os seis apoios em 1 e o pediatra 1). O par (0, 488) é o da trilha (CCHISAGE.ID_CRM
    6: // CCLANCIR (registro) tem oito pares: cirurgião, três auxiliares, instrumentador, anestesista, pediatra e circulante,
    11: /** IDs de TBCBOPRO que significam "não informado" (COD 0). */
    37: /** Profissional escolhido na tela: o ID de TBCBOPRO e o código (COD) que o par exige. */
    60: /** Pares do registro (CCLANCIR); o quarto auxiliar só por ID (1 = ausente). */

## packages/dominio-cirurgia/src/estados.ts  (só comentário)
- nome-origem: linhas 2,3,4,5,50
    2: // de CCAGENDA (ID_TBSITAGE nulo em 100% em 2025): "solicitado" vive só no novo e não ocupa a sala; confirmar grava a
    3: // CCAGENDA (o outro sistema passa a ver a cirurgia); cancelar e suspender tiram a linha pelo caminho auditável
    4: // (cópia em CCAGENDA_EXC_CANC e exclusão); "no bloco" e "em sala" são marcações do novo; "realizado" nasce do
    5: // registro do ato (CCCADCIR).
    50: /** O agendamento ocupa a sala no legado (tem linha em CCAGENDA)? */

## packages/dominio-cirurgia/src/ficha/balanco-assinatura.ts  (só comentário)
- nome-origem: linhas 3,4
    3: //   - De-para (D-BAL-46): o balanço classifica o ganho pelo grupo (PRAGRUPBALANCO) e a perda pelo tipo de eliminação
    4: //     (PRBHTPELIMINA), domínios do estabelecimento lidos do banco, sem ID fixo no código. O fluido e a perda da ficha

## packages/dominio-cirurgia/src/ficha/ficha-anestesica.ts  (só comentário)
- nome-origem: linhas 267
    267: * (PRTIPO_PROFISSIONAL achado pelo nome; o ID é do estabelecimento) e quem teve a responsabilidade na ficha.

## packages/dominio-cirurgia/src/ficha/montar.ts  (só comentário)
- nome-origem: linhas 150
    150: * `sessao` são os registros profissionais (TBCBOPRO) de quem está na sessão.

## packages/dominio-cirurgia/src/ligacao.ts  (só comentário)
- nome-origem: linhas 2
    2: // a cirurgia realizada (CCCADCIR) casa com o agendamento (CCAGENDA) pelo REG da internação, pela sala e pela data.

## packages/dominio-cirurgia/src/mapa.ts  (só comentário)
- nome-origem: linhas 3
    3: // outro sistema gravou) e de data impossível. Sem banco: a API lê CCAGENDA e as SGH_ e a tela desenha.

## packages/dominio-cirurgia/src/pedido-portal.ts  (só comentário)
- nome-origem: linhas 6,8
    6: /** O registro (TBCBOPRO.ID): o cirurgião na agenda do bloco. */
    8: /** O código do registro (TBCBOPRO.COD): o prestador no repasse e o número do conselho. */

## packages/dominio-cirurgia/src/registro.ts
- vocab-antigo: linhas 3,4,30,39
    3: // 15, C contaminada; I infectada é a quarta classe clássica, nunca vista: recusada), a duração em HHMM e as horas de
    4: // início e fim (HORA_I/HORA_T) e de anestesia (HORA_IA/HORA_TA) em HHMM. O que o legado não tem coluna (entrada e
    30: /** HHMM. */
    39: /** Confere os tempos do ato: horas HHMM válidas, anestesia envolvendo a cirurgia; devolve a duração em minutos. */
- nome-origem: linhas 1,22
    1: // Registro do ato cirúrgico (ficha do M18, `cirurgia.registrarCirurgia`; Anexo A). CCCADCIR guarda o porte em TIPO_CIR
    22: /** Técnica do procedimento (CCLANCIR.TECNICA: 0 510, 1 50, 2 35 desde 10/2025; rótulos a confirmar com o bloco, DP-3). */

## packages/dominio-cirurgia/src/sobreposicao.ts  (só comentário)
- nome-origem: linhas 5,14
    5: // intervalo de preparo (o do agendamento, CCAGENDA.INTERVALO, e o mínimo do parâmetro do estabelecimento).
    14: /** CCAGENDA.INTERVALO em minutos (0 em 100% hoje). */

## packages/dominio-cirurgia/src/tempo.ts
- vocab-antigo: linhas 3,4,12,14,20,23,28,31,39,45
    3: // 02:30 = 150 minutos; 830 de 830 linhas desde 10/2025); CCCADCIR guarda a duração como texto HHMM ("0130") e as
    4: // horas de início e fim como HHMM. A tela trabalha em minutos. Instantes como texto "AAAA-MM-DD HH:MM" (sem fuso: o
    12: const HHMM = /^([01]\d|2[0-3])([0-5]\d)$/;
    14: /** Minutos desde a meia-noite → "HHMM" (dentro do dia). */
    20: /** "HHMM" → minutos; "0000", vazio ou inválido → null. */
    23: const m = HHMM.exec(s);
    28: /** "HHMM" → "HH:MM" para a tela. */
    31: return HHMM.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : '';
    39: /** Duração em minutos → texto HHMM de CCCADCIR.DURACAO (90 → "0130"). */
    45: /** Duração em minutos entre duas horas HHMM do mesmo ato (o fim pode passar da meia-noite). */
- nome-origem: linhas 1,3,39,103
    1: // Tempos do centro cirúrgico (ficha do M18, regra 7; Anexo A): CCAGENDA guarda o início em DATA_HORA (TIMESTAMP) e a
    3: // 02:30 = 150 minutos; 830 de 830 linhas desde 10/2025); CCCADCIR guarda a duração como texto HHMM ("0130") e as
    39: /** Duração em minutos → texto HHMM de CCCADCIR.DURACAO (90 → "0130"). */
    103: * Data impossível do legado (ex.: ano 3203 numa linha de CCAGENDA, 1899 noutra): fora de 1990–2099 é mostrada com
