# Fatia F2.4 23-misto-coexistencia (assunto: coexistencia+contratualizacao+sus+parametros+suporte+portal-paciente+precos+portal+documento+documento-assinatura; cliente de teste próprio: f24_23mistocoexistencia)

## packages/contratos/src/coexistencia/desligamento.ts
- nome-origem: linhas 135,144,157,170,179
    135: tabelas: ['TBSGHCONEXAO'],
    144: tabelas: ['SILIBERACAOEXAME', 'SIWEBCADPERFIL', 'SIMODULO_SIWEBATOS', 'SIWEBPARLAUDO', 'SICADATE'],
    157: tabelas: ['PNCONFIGPORTAL'],
    170: tabelas: ['TBEDITREL_AGENDA', 'TBEDITREL_AGENDA_LOG'],
    179: tabelas: ['TBEDITREL'],

## packages/contratos/src/coexistencia/ensaio-firebird5.ts  (só comentário)
- nome-origem: linhas 118
    118: /** O prefixo das visões (V_EPIMED_, V_FIRST_…) ou `banco-externo` (gatilhos com ON EXTERNAL e TBINFBANCO). */

## packages/contratos/src/coexistencia/ensaio-utf8.ts  (só comentário)
- nome-origem: linhas 31
    31: /** Colunas que já guardam UTF-8 dentro de NONE (`PRCONTEVOL.EVOLUCAO_XML`): sem nova transliteração (passo 4). */

## packages/contratos/src/coexistencia/fim.ts  (só comentário)
- nome-origem: linhas 14,239
    14: /** Login da tabela de usuários (TBUSERS.NOME, VARCHAR(31)). */
    239: /** Grupos especiais da tabela de grupos (TBGRUUSU.NOME): usuário sem grupo e logins de TV (regras 4 e 5). */

## apps/api/src/modulos/contratualizacao/contratualizacao.controller.ts
- nome-origem: linhas 147,148,149,150,151,152,153,154,155,156,157,719
    147: periodicidade: 'CMPERIODO',
    148: tipo_indicador: 'CMTPINDICADOR',
    149: complexidade: 'CMTIPOCOMPLEXIDADESP',
    150: tipo_item_indicador: 'CMTPITEMINDIC',
    151: rede_assistencial: 'CMREDEASSIST',
    152: escore: 'CMESCORE',
    153: tipo_afericao: 'CMTPAFERICAO',
    154: esfera: 'CMTPCONTRATO',
    155: tipo_dado: 'CMTPDADOS',
    156: componente_orcamento: 'CMTPORCAMENTO',
    157: incentivo: 'CMINCENTIVO',
    719: req.sghAlvo = { tabelaAlvo: 'TBPROSUS' };

## apps/api/src/modulos/contratualizacao/porta-propria.ts
- modelo-pendente: linhas 19,141,909
    19: // campos responde "modelo-pendente" (nada é gravado) e a produção das contas SUS também, sem contorno.
    141: 'modelo-pendente',
    909: 'modelo-pendente',

## apps/api/src/modulos/sus/porta-propria.ts
- modelo-pendente: linhas 17,81
    17: // essas leituras saem vazias e as gravações recusam com "modelo-pendente". A montagem a partir da conta própria
    81: 'modelo-pendente',

## apps/api/src/modulos/sus/tipos.ts
- vocab-antigo: linhas 2
    2: // de origem (sem S/N, hora HHMM, sentinela nem código antigo). Datas em ISO (AAAA-MM-DD), competência AAAAMM, ids

## packages/contratos/src/parametros/definicoes.ts
- vocab-antigo: linhas 771,774,989,992
    771: descricao: 'Início do turno diurno de 12 horas da enfermagem (HHMM; o noturno começa 12 horas depois)',
    774: formato: { expressao: '^([01][0-9]|2[0-3])[0-5][0-9]$', mensagem: 'Hora no formato HHMM.' },
    989: 'Hora de corte do balanço hídrico de 24 horas (HHMM): a janela vai da hora de corte de um dia à do dia seguinte',
    992: formato: { expressao: '^([01][0-9]|2[0-3])[0-5][0-9]$', mensagem: 'Hora no formato HHMM.' },
- nome-origem: linhas 5,1350,1379,1514,1532,1678,2317
    5: // LEGADO (GEPARAM, REPARAM, PRPARAM) são só lidos (declarações em @sgh/legado, config/parametros); a edição
    1350: // M51 (etapa 1): faturamento SUS próprio, CIHA. O CNES vem do parâmetro (no dev, TBEMPHOS.CNES está zerado; ele fica
    1379: origem: 'ficha do M51, regra 1 (TBCONVEN 1 nos dois hospitais)',
    1514: // M51 (etapa 4): AIH. O tipo de UTI do SIH (FHLEITOUTITP) e o procedimento da diária por tipo de acomodação da
    1532: 'ficha do M51, regra 6 (diárias de UTI pela trajetória); tabela de tipos de UTI do SIH (FHLEITOUTITP)',
    1678: // da fila humana, regras automáticas, local da dispensação e a decisão da DP-25). Nada em PRPARAM (compartilhado).
    2317: /** Alvo do nível: código da rede, empresa (TBEMPHOS.COD), estabelecimento, unidade, perfil ou login. */

## packages/contratos/src/parametros/pessoas.ts
- nome-origem: linhas 125
    125: origem: 'ficha do M52, regra 13 (PETP_INTEGR_EVENTO; acordo coletivo)',

## apps/api/src/modulos/suporte/plataforma.controller.ts
- nome-origem: linhas 523
    523: @Publica('auditoria (R3): TBCABTRILHA × "como"; conferido no serviço')

## apps/api/src/modulos/suporte/servico-como.ts  (só comentário)
- nome-origem: linhas 196,705
    196: * modal (existe, ativa, não bloqueada, de grupo ativo do TBGRUUSU), e o login fora dela é recusado sem
    705: /** R3: a TBCABTRILHA da janela da sessão, com o autor real. */

## packages/contratos/src/suporte/suporte.ts  (só comentário)
- nome-origem: linhas 2,104,133,249,365
    2: // como). Contas PRÓPRIAS do Sante SGH (separadas do TBUSERS do legado): PLATAFORMA (o dono) e SUPORTE
    104: * "em nome de quem gravar" (TBUSERS.NOME nas colunas de usuário, na trilha e nos gatilhos do legado); a
    133: /** Grupo ativo do TBGRUUSU com a contagem de logins não bloqueados. */
    249: /** Linha do relatório que cruza a TBCABTRILHA com a auditoria do "como" (R3). */
    365: /** TBUSERS.ID_TBUSERS do alvo. */

## apps/api/src/modulos/portal-paciente/agenda/servico.ts
- vocab-antigo: linhas 193,194
    193: * A hora no formato do contrato do portal e das regras do domínio da agenda (HHMM): a porta da agenda de consultas
    194: * devolve HH:MM e a de exames, HHMM. Pedido na saída do lote: unificar o formato no contrato e no domínio.

## apps/api/src/modulos/portal-paciente/aplicacao/servico.ts  (só comentário)
- nome-origem: linhas 2
    2: // SBIS-24): um domínio de identidade separado dos usuários internos (SGH_POR_CONTA, nunca TBUSERS).

## apps/api/src/modulos/precos/fonte-memoria.ts  (só comentário)
- nome-origem: linhas 1072
    1072: /** Para os testes: um lançamento de conta do item (FCLANEXT) na vigência. */

## apps/api/src/modulos/precos/fonte-propria.ts
- modelo-pendente: linhas 976
    976: new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo do banco', `${o} aguarda a coluna ou tabela no modelo do banco (pedido registrado): nada foi gravado.`);

## packages/contratos/src/portal/agenda-online.ts
- vocab-antigo: linhas 8,31,152
    8: import { FORMATO_HHMM } from '../formatacao/hora-legada.js';
    31: const hhmm = z.string().regex(FORMATO_HHMM, 'Hora no formato HHMM.');
    152: /** HHMM. */
- nome-origem: linhas 18,216
    18: /** Convênio particular (TBCONVEN 10): o único cobrado pelo portal. */
    216: /** ID da marcação (REPACAGD ou SIPACAGD) como texto. */

## packages/contratos/src/portal/vocabulario.ts  (só comentário)
- nome-origem: linhas 2,141
    2: // 18; SBIS-24): conta própria com segundo fator (identidade separada dos usuários internos, nunca TBUSERS), responsável
    141: * Signatário do consentimento no domínio do cadastro (TBTIPOREPRE, lido ao vivo pela descrição: na cópia do pc, 1

## packages/dominio-documento/src/assinatura/selo.ts  (só comentário)
- nome-origem: linhas 62
    62: * TBCONSPROF.COD_CONSELHO_PROF): o primeiro OID do certificado (otherName do SubjectAltName) que o cadastro liga a um

## packages/dominio-documento/src/zpl/modelos.ts  (só comentário)
- nome-origem: linhas 55
    55: /** RICADPAC.ID (paciente) e prontuário do legado. */

## packages/dominio-documento/src/zpl/opme.ts  (só comentário)
- nome-origem: linhas 18
    18: /** O consumo (SGH_SUP_OPME_RASTREIO.ID) e o lançamento da saída do estoque (GELANSAI.ID_GELANSAI). */

## packages/contratos/src/documento-assinatura/vocabulario.ts  (só comentário)
- nome-origem: linhas 92,94
    92: * Ponte de cada tipo da política com o tipo de ato da trilha documental do legado (PRTPASSINATURA.ID, lido na cópia do
    94: * PRASSINATURA_DOC → PRASSINATURA_CAB.ID_PRTPASSINATURA → tipo da política). O primeiro ID de cada lista é o que o
