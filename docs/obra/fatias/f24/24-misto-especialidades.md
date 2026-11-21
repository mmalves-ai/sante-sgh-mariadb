# Fatia F2.4 24-misto-especialidades (assunto: especialidades+nutricao+portaria+rouparia+sessoes+auditoria+formatacao+onda2+catalogo+pacote-ui+inicio+organizacao+liberacao+orcamento+prontidao+pacote-contratos+texto+hotelaria; cliente de teste próprio: f24_24mistoespecialidade)

## apps/api/src/modulos/especialidades/porta-propria.ts
- modelo-pendente: linhas 16,90
    16: // gravações recusam com 'modelo-pendente' (409), dizendo o que falta; nada é gravado pela metade.
    90: 'modelo-pendente',

## apps/api/src/modulos/nutricao/porta-propria.ts
- modelo-pendente: linhas 23,128
    23: // respondem "modelo-pendente" (409), sem gravar nada.
    128: 'modelo-pendente',

## apps/api/src/modulos/portaria/porta-propria.ts
- modelo-pendente: linhas 22,23,134
    22: // guarda e anonimização do visitante (o expurgo responde "modelo-pendente"); o visitante no acompanhante (hoje pelo
    23: // documento); o evento da catraca ligado ao terminal (hoje responde "modelo-pendente").
    134: 'modelo-pendente',

## apps/api/src/modulos/rouparia/porta-propria.ts
- modelo-pendente: linhas 17,113
    17: // porta usar o resto: até lá, o inventário, o kit e a perda de várias peças recusam com "modelo-pendente", e o envio que
    113: new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo do banco', detalhe);

## apps/web/src/modulos/sessoes/i18n-sessoes.ts
- vocab-antigo: linhas 55
    55: hora: 'Hora (HHMM)',

## packages/contratos/src/auditoria/eventos.ts
- nome-origem: linhas 3,4,10,12,16,23,35,111,112,477,480,537,832,956,1043,1044,1045,1046,1215,1285
    3: // TBCABTRILHA/TBLANTRILHASGH como o Delphi grava (trilha dupla): tipo de TBTPACAOAUDIT, criticidade de
    4: // TBNVLCRITICID e opção de TBOPCOES vistos no perfil passivo (06 a 07/2026). Tipos novos da SBIS v5.2
    10: /** Tipos de TBTPACAOAUDIT que o novo grava no legado (ficha do M06, seção 5). */
    12: // administração de acessos (TBCABTRILHA da cópia pc: 2.919, 4 e 811 eventos).
    16: /** Criticidades de TBNVLCRITICID usadas pelo legado na trilha (informativo, erro, alerta). */
    23: /** TBOPCOES.ID que o Delphi registra para o evento (a mais frequente na janela do perfil). */
    35: * Opções do perfil passivo (TBCABTRILHA, 2026-06-01 a 2026-07-05): login e fim de sessão pelo módulo de
    111: // dele como inclusão (tipo 2) e ação (tipo 24) na opção 5182 "Confirmar", com o registro em TBLANTRILHASGH
    112: // (PRCABEVOL.ID_CABEVOL); a suspensão como alteração (tipo 3, opção 3918). Rascunho, abertura do formulário e
    477: // TBCABTRILHA; a autoria das mudanças de preço e de convênio vai também à SGH_PRECO_AUTORIA).
    480: descricao: 'Convênio suspenso ou reativado (TBCONVEN.SITUACAO), com justificativa',
    537: // leva o ator real na ORIGEM ("SUPORTE:<tipo>:<conta>:S<sessão>"); o USUARIO é o alvo, como na TBCABTRILHA.

## packages/contratos/src/formatacao/hora-legada.ts
- vocab-antigo: linhas 1,6,12,24,34,58,62
    1: // Hora legada (regra 8 do M07; cap-10 §10.2; porta de toHHMM e formatHora da sante-api, src/utils/sgh.js).
    6: export const FORMATO_HHMM = /^([01]\d|2[0-3])[0-5]\d$/;
    12: /** Aceita "HH:MM", "HHMM", "H:MM" e "HMM"; devolve sempre "HHMM" (quatro dígitos) ou lança. */
    24: if (!FORMATO_HHMM.test(hhmm)) {
    34: /** "HHMM" do legado → "HH:MM" para a tela. Vazio ou nulo → null; já formatado passa como está. */
    58: if (hhmm === null || !FORMATO_HHMM.test(hhmm)) return { tipo: 'invalida', bruto: valor };
    62: /** Contrato: hora trafega como "HHMM"; a entrada aceita os formatos da tela e é convertida. */

## packages/contratos/src/onda2/onda2.ts
- nome-origem: linhas 389,396,403,410,426,427,428,429,430,431,432,433,434,451,457,463,469,476,483,490
    389: tabela: 'RECADATE',
    396: tabela: 'SILANEXA',
    403: tabela: 'SILIBERACAOEXAME',
    410: tabela: 'ATCABECATEND',
    426: 'TBLEITO',
    427: 'TBACOMODLEITO',
    428: 'TBSGHCONEXAO',
    429: 'ATCONTA',
    430: 'RICONTAS',
    431: 'RICGUIAS',
    432: 'RECONTAS',
    433: 'FCCTAEXT',

## packages/dominio-catalogo/src/carga/janela.ts
- vocab-antigo: linhas 12,15,23
    12: const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
    15: const m = HHMM.exec(hhmm);
    23: if (!m || !HHMM.test(m[1] as string) || !HHMM.test(m[2] as string)) return JANELA_PADRAO;

## packages/ui/catalogo/historias.ts
- vocab-antigo: linhas 180
    180: titulo: 'Hora legada HHMM',

## packages/contratos/src/inicio/comunicacao.ts  (só comentário)
- nome-origem: linhas 3,65,191,249
    3: // anterior (só consulta, `TBMENSAG`, parada desde 2024); e o dicionário ortográfico pessoal (`TBDICIONARIO_TBUSERS`,
    65: /** Link de contexto: o atendimento (ATCABECATEND.ID); abre pela autorização normal do prontuário. */
    191: /** Mensagem do sistema anterior (TBMENSAG; só consulta; 98 linhas de 2020 a 2024 na cópia `pc`). */
    249: // ── Dicionário ortográfico pessoal (TBDICIONARIO_TBUSERS) ────────────────────────────────────────────────────

## packages/contratos/src/inicio/worklist.ts  (só comentário)
- nome-origem: linhas 267
    267: /** Grupo legal (TBGRUPOPRIORIDADE), quando o novo o registrou; null nas que o outro sistema emitiu. */

## packages/dominio-organizacao/src/conferencia-leitos.ts  (só comentário)
- nome-origem: linhas 2,3,13,22,158
    2: // cadastro que o novo grava (RIBLOCOS, RIACOMOD, RILEITOS) e o espelho que os triggers do legado mantêm
    3: // (TBACOMODLEITO, TBLEITO). O novo nunca grava o espelho; a conferência mostra, leito a leito pela chave
    13: /** RILEITOS.STATUS = 'A' (ou vazio, que o legado trata como ativo). */
    22: /** TBACOMODLEITO.TP_ATENDIMENTO: 'I' internação (espelho do RILEITOS) ou 'E' externo. */
    158: /** RILEITOS.STATUS: 'A' ativo, 'I' inativo; vazio conta como ativo (como o trigger do espelho trata). */

## packages/dominio-organizacao/src/hierarquia.ts  (só comentário)
- nome-origem: linhas 84
    84: /** Ocupação (RILEITOS.REG > 0): só leitura no cadastro (regra 14). */

## packages/contratos/src/liberacao/onda4.ts  (só comentário)
- nome-origem: linhas 46,434
    46: /** Grupos funcionais (TBGRUUSU.NOME) acompanhados em "quem ainda usa o outro sistema". */
    434: /** Movimento bancário do mês por `MFLANCTO.TIPO_TRF` cru; a legenda é "a confirmar" (regra 9). */

## packages/contratos/src/orcamento/orcamento.ts  (só comentário)
- nome-origem: linhas 3,4,5,7,8,135,200
    3: //   - Linha do orçamento: centro de custo (TBCENCUS.ID; 0 = o hospital inteiro, sem centro) × natureza × item gerencial
    4: //     (TBITEDES: GRUPO, SUBGRUPO, ITEM) × 12 meses, em centavos (inteiros; nenhum arredondamento de ponto flutuante).
    5: //   - Naturezas: `despesa` (MFLANGSI TP_LAN 0, a apropriação gerencial dos documentos a pagar), `receita` (MFLANGSI
    7: //     custo de destino, GEKONCDC; sem item gerencial: GRUPO/SUBGRUPO/ITEM = 0).
    8: //   - Realizado pela competência (MFLANGSI.DATA, a emissão; GEKONCDC.ANO/MES). O MFLANGSI grava CDC 0 em 100% do
    135: /** Recorte por centro de custo (TBCENCUS.ID; 0 é o "sem centro"); sem ele, todos. */
    200: /** R receita, D despesa (TBGRUDES.CLASSIF); a natureza da linha segue a do grupo. */

## packages/contratos/src/prontidao/catalogo.ts  (só comentário)
- nome-origem: linhas 28
    28: /** Grupos funcionais (TBGRUUSU.NOME, chave sem acento) que compõem o papel. */

## packages/contratos/src/sessao.ts  (só comentário)
- nome-origem: linhas 1,67,69,71,85,95,99,103,113
    1: // Contrato da sessão (M05): login no TBUSERS do estabelecimento escolhido, sessão no servidor (BFF) e o que a
    67: /** TBUSERS.ID_TBUSERS como texto. */
    69: /** Nome de exibição (TBUSERS.NOMEC, ou o login quando vazio). */
    71: /** Login exato (TBUSERS.NOME, maiúsculas contam): é o que o executor grava nas colunas USUARIO*. */
    85: /** Unidades (TBUNIDAD) a que o usuário tem acesso; com mais de uma, a casca pede a escolha. */
    95: * M38 (regra 3): grupo do legado do usuário (TBGRUUSU.NOME): o escopo `grupo` das chaves de liberação (a onda 0
    99: /** M06: PRPARAM.REST_ACESS_PACI_NAO_ESTE_ATEND do banco da sessão (vínculo sobre dados do legado). */
    103: /** Bloqueio por inatividade, em segundos (menor entre TBCFGLOGIN e o padrão do perfil; 0 = desligado). */
    113: /** Sem aceite da versão vigente do termo de uso (PRTERMOACEITE): rotas do PEP fechadas. */

## packages/contratos/src/texto/fonetica.ts  (só comentário)
- nome-origem: linhas 1,12,20
    1: // Fonética do dicionário ortográfico pessoal (M27; TBDICIONARIO_TBUSERS.FONETICA, o mesmo dicionário nos dois
    12: /** Tamanho de TBDICIONARIO_TBUSERS.PALAVRA e .FONETICA (VARCHAR(50)). */
    20: /** A fonética da palavra (TBDICIONARIO_TBUSERS.FONETICA). */

## packages/dominio-hotelaria/src/limpeza.ts  (só comentário)
- nome-origem: linhas 5
    5: // CCIH antes da liberação. A situação do legado (CHSITUACAO: 1 Alta hospitalar, 2 Aguardando higienização, 3 Em
