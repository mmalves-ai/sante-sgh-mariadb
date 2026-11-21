# Fatia F2.4 20-misto-preco (assunto: preco+relatorio+exames+assinatura; cliente de teste próprio: f24_20mistopreco)

## packages/contratos/src/preco/constantes.ts  (só comentário)
- nome-origem: linhas 8,11,26,35
    8: /** Tabelas cujo preço final passa por percentual em TBPERTHM (alerta com confirmação; ref 05 §1.3). */
    11: /** Percentual da tabela 625 em TBPERTHM: significado não confirmado (DP-33, regra 7). */
    26: /** Maior valor aceito nas colunas NUMERIC(10,2) de TBVLRTHM (VALOR_ANES, VALOR_FILME). */
    35: /** Situações de convênio que o legado usa (TBCONVEN.SITUACAO, 44 A e 33 I na cópia). */

## packages/contratos/src/preco/credenciais.ts  (só comentário)
- nome-origem: linhas 6
    6: /** Colunas de credencial (TBTISS, TBTISSWEBSERV, TBCONVEN e TBCODATI), só os nomes das colunas. */

## packages/contratos/src/preco/entradas.ts  (só comentário)
- nome-origem: linhas 2,258
    2: // convênio (parte pública: nomes no vocabulário do novo; as colunas de TBCONVEN ficam em @sgh/legado).
    258: // ── Reajuste e desfazer (TBVLRTHM) ─────────────────────────────────────────────────────────────────────

## packages/contratos/src/preco/respostas.ts  (só comentário)
- nome-origem: linhas 1,234,355
    1: // Respostas da API do M12 (validadas pela tela). Nenhum nome de tabela do legado; as colunas de TBCONVEN que
    234: /** Vigências de diária/taxa (TBVLRDTH) ou de mat/med (TBVLRMEM): o valor de cada data, sem autoria do novo. */
    355: /** Regra da sante-api (valores.js): soma dos 5 componentes de TBVLRTHM na vigência; igual à grade. */

## packages/dominio-preco/src/comparacao-importacao.ts  (só comentário)
- nome-origem: linhas 5,179
    5: // aparecem na comparação e não são publicados (o novo nunca grava TBTABTHM; operação ainda não disponível).
    179: * Compara o arquivo com a vigência atual da tabela: código fora de TBTABTHM é `novo` (não publicado: o novo nunca grava TBTABTHM);

## packages/dominio-preco/src/impacto.ts  (só comentário)
- nome-origem: linhas 11,13
    11: /** Tabela de honorários da conta de internação (TBCONVEN.THM). */
    13: /** Tabela de honorários da conta externa (TBCONVEN.THM_E). */

## packages/dominio-preco/src/modelo-valor.ts
- nome-origem: linhas 3,5,7,9,25,28,39,68,70,72,74,81,83,85,111
    3: //   - VALOR: dos cinco componentes datados de TBVLRTHM (VALOR_CH, VALOR_CO, VALOR_FILME, VALOR_ANES,
    5: //   - PORTE (CBHPM): do valor do porte do convênio (TBPORMED) vezes a fração do porte do item (PPORTE), mais
    7: //   - CH (AMB): do coeficiente CH do item (TBTABTHM.CH ≠ 0) vezes o valor do CH do convênio (TBINDICE), mais
    9: // `TBTABTHM.CH` muda de sentido conforme a tabela: no modelo VALOR é 0 e o preço está em TBVLRTHM.VALOR_CH.
    25: /** Os cinco componentes, na ordem de TBVLRTHM. */
    28: /** Soma dos cinco componentes (total de TBVLRTHM), sem arredondar (arredondar é da apresentação). */
    39: /** Itens da tabela em TBTABTHM. */
    68: /** Valor do CH (TBINDICE IND 1/2 ou IND = ATO do item). */
    70: /** Valor do m² de filme (TBINDICE IND 4). */
    72: /** Valor da UCO (TBINDICE IND 5). */
    74: /** Valor do porte do convênio (TBPORMED) para o porte do item. */
    81: /** Fração do porte (TBTABTHM.PPORTE: 0,01 / 0,04 / 0,10…); null = porte inteiro. */

## packages/dominio-preco/src/proposta-reajuste.ts
- nome-origem: linhas 2,4,26,28,33,287,293
    2: // src/services/acoes-precos.js): o reajuste é uma LINHA NOVA datada em TBVLRTHM, nunca a alteração da que
    4: // alertas (os que exigem confirmação explícita: tabela compartilhada e tabela com percentual em TBPERTHM).
    26: /** TBTABTHM.SITUACAO (A = ativo). */
    28: /** TBTABTHM.CH (≠ 0: modelo AMB, veto). */
    33: /** Maior DATA do item em TBVLRTHM (inclui vigência futura). */
    287: `A tabela ${ctx.tabela} tem percentual por procedimento em TBPERTHM: o preço final passa por ele e o reajuste só do valor pode não dar o aumento pretendido.`,
    293: `O significado do percentual da tabela ${ctx.tabela} em TBPERTHM está "a confirmar" com o faturamento (DP-33).`,

## packages/dominio-preco/src/saneamento.ts  (só comentário)
- nome-origem: linhas 2
    2: // inválidas em regras datadas (TBPERMEM: 448 linhas, com anos como 0218 e 2201; TBINDICE: 2; TBPERTHM: 2)

## apps/api/src/modulos/relatorio/porta-propria.ts
- vocab-antigo: linhas 130
    130: 

## apps/api/src/modulos/relatorio/tipos.ts
- vocab-antigo: linhas 109
    109: /** Os dados de um envio agendado (hora no formato da tela: HHMM, de 0 a 2359). */

## packages/contratos/src/relatorio/gestao.ts
- vocab-antigo: linhas 183
    183: /** Hora no formato HHMM (0 a 2359). */

## packages/dominio-relatorio/src/agendamento.ts
- vocab-antigo: linhas 10
    10: /** HHMM. */

## packages/dominio-relatorio/src/triagem.ts  (só comentário)
- nome-origem: linhas 11
    11: /** Módulo do editor de origem (TBEDITREL.MODULO: -1 abertura, 4 faturamento de convênios, 22 folha…). */

## apps/api/src/modulos/exames/porta-propria.ts
- modelo-pendente: linhas 170
    170: 'modelo-pendente',
- vocab-antigo: linhas 52
    52: /** TIME do banco ("HH:MM:SS") → "HHMM". */

## apps/api/src/modulos/exames/porta.ts
- vocab-antigo: linhas 47
    47: /** Todos os horários de início já ocupados na agenda ("AAAA-MM-DD HHMM"), sem teto: a prévia não os repete. */

## apps/api/src/modulos/exames/relogio.ts
- vocab-antigo: linhas 1,30,36,42,48
    1: // Relógio civil do estabelecimento (data ISO e hora "HHMM" do contrato), pelo fuso do cadastro do estabelecimento
    30: /** "HHMM" → minutos desde a meia-noite (ou duração em minutos). */
    36: /** Minutos → "HHMM". */
    42: /** Data civil e hora "HHMM" de um instante, no fuso do estabelecimento. */
    48: /** Instante (UTC) da data civil e hora "HHMM" no fuso do estabelecimento. */

## apps/api/src/modulos/exames/tipos.ts
- vocab-antigo: linhas 3,9,24,43,61
    3: // Horas e durações seguem o formato do contrato da tela (`esquemaHhmm` de @sgh/contratos, "HHMM"), que o motor da
    9: /** Relógio do estabelecimento (data ISO e hora "HHMM" do contrato). */
    24: /** Duração padrão do horário ("HHMM"). */
    43: /** Pausa dentro da faixa (HHMM), sem horários; null = sem pausa. */
    61: /** Data e hora ("HHMM") do pedido. */

## apps/api/src/modulos/assinatura/porta-propria.ts
- modelo-pendente: linhas 15,122
    15: // têm tabela; essas gravações respondem 503 "modelo-pendente" (indisponível, com o motivo) e as leituras voltam vazias. A parte pública do
    122: 'modelo-pendente',

## packages/contratos/src/assinatura/assinatura.ts
- vocab-antigo: linhas 32
    32: 'HHMM',

## packages/contratos/src/assinatura/resultado.ts  (só comentário)
- nome-origem: linhas 23
    23: /** Caminho estável do elemento (ex.: `SIPACAGD.colunas.ID_RICADPAC`). */
