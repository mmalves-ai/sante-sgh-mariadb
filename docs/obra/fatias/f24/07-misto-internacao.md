# Fatia F2.4 07-misto-internacao (assunto: internacao+custos+contabil+preco+sadt+relatorio+documento+financeiro+repasse+adt; cliente de teste próprio: f24_07mistointernacao)

## packages/dominio-internacao/dist/massa.spec-util.d.ts
- vocab-antigo: linhas 3
    3: /** Relógio de parede (ms) de "AAAA-MM-DD HHMM". */

## packages/dominio-internacao/dist/painel.d.ts
- vocab-antigo: linhas 10
    10: readonly destino: 'legado' | 'memoria';
- nome-origem: linhas 2
    2: /** RILEITOS.STATUS: 'I' inativo; vazio ou 'A' ativo (como o legado trata). */

## packages/dominio-internacao/dist/tempo.d.ts
- vocab-antigo: linhas 4,6
    4: /** "HHMM" (ou "HH:MM") → minutos do dia; vazio ou inválido → 0 (meia-noite, como o legado lê). */
    6: /** Data de calendário (meia-noite UTC) + hora "HHMM" → instante do relógio de parede (ms). */

## packages/dominio-custos/dist/absorcao.d.ts  (só comentário)
- nome-origem: linhas 13
    13: /** Um valor de custo direto já pelo TBCENCUS.ID (null: sem centro de custo no movimento). */

## packages/dominio-custos/dist/apuracao.d.ts  (só comentário)
- nome-origem: linhas 4,23
    4: /** Um grupo agregado no banco pelo código do centro de custo do movimento (TBCENCUS.COD). */
    23: /** Proventos da folha da competência pela lotação (já pelo TBCENCUS.ID; null: sem lotação). */

## packages/dominio-custos/dist/custo-conta.d.ts  (só comentário)
- nome-origem: linhas 4,10
    4: /** FCCTAEXT.ID. */
    10: /** TBCENCUS.ID do item (null: o código do item não está no cadastro). */

## packages/dominio-custos/dist/estatistica.d.ts
- vocab-antigo: linhas 13,28
    13: /** Duração HHMM (como a cirurgia grava) em minutos; null quando o texto não é uma duração. */
    28: /** Cirurgias do mês pelo centro da sala, agrupadas pela duração gravada (HHMM). */
- nome-origem: linhas 15,36
    15: /** Um grupo agregado no banco: o código do centro de custo do movimento (TBCENCUS.COD) e a quantidade. */
    36: /** Colaboradores com vínculo no mês, já pelo TBCENCUS.ID da lotação (o cadastro de pessoas guarda o ID). */

## packages/dominio-custos/dist/exportacao.d.ts  (só comentário)
- nome-origem: linhas 6,8
    6: /** TBCENCUS.COD_APURASUS. */
    8: /** TBUNIMEN.COD_APURASUS da unidade de mensuração do centro. */

## packages/dominio-contabil/dist/depara.d.ts  (só comentário)
- nome-origem: linhas 5
    5: /** Conta do escritório (TBINTCRC.CTA_CONTABIL); null ou 0 = sem conta. */

## packages/dominio-contabil/dist/derivacao.d.ts  (só comentário)
- nome-origem: linhas 12
    12: /** Empresa contábil do estabelecimento (as fontes gravam a empresa de formas diferentes; FCCTAEXT.EMPRESA é texto). */

## packages/dominio-contabil/dist/registro.d.ts  (só comentário)
- nome-origem: linhas 15
    15: /** Item do de-para da exportação como a leitura do banco devolve (TBINTCRC). */

## packages/dominio-contabil/dist/sped.d.ts  (só comentário)
- nome-origem: linhas 23
    23: /** Código do plano referencial (COTIPOPLANOCONTAREFERENCIAL.CODIGO) dos vínculos das contas. */

## packages/dominio-preco/dist/comparacao-importacao.d.ts  (só comentário)
- nome-origem: linhas 48
    48: * Compara o arquivo com a vigência atual da tabela: código fora de TBTABTHM é `novo` (não publicado: o novo nunca grava TBTABTHM);

## packages/dominio-preco/dist/impacto.d.ts  (só comentário)
- nome-origem: linhas 5,7
    5: /** Tabela de honorários da conta de internação (TBCONVEN.THM). */
    7: /** Tabela de honorários da conta externa (TBCONVEN.THM_E). */

## packages/dominio-preco/dist/modelo-valor.d.ts  (só comentário)
- nome-origem: linhas 10,12,17,33,35,37,39,45,47,49
    10: /** Os cinco componentes, na ordem de TBVLRTHM. */
    12: /** Soma dos cinco componentes (total de TBVLRTHM), sem arredondar (arredondar é da apresentação). */
    17: /** Itens da tabela em TBTABTHM. */
    33: /** Valor do CH (TBINDICE IND 1/2 ou IND = ATO do item). */
    35: /** Valor do m² de filme (TBINDICE IND 4). */
    37: /** Valor da UCO (TBINDICE IND 5). */
    39: /** Valor do porte do convênio (TBPORMED) para o porte do item. */
    45: /** Fração do porte (TBTABTHM.PPORTE: 0,01 / 0,04 / 0,10…); null = porte inteiro. */
    47: /** Custo operacional em UCO (TBTABTHM.COPE). */
    49: /** Filme em m² (TBTABTHM.FILME). */

## packages/dominio-preco/dist/proposta-reajuste.d.ts  (só comentário)
- nome-origem: linhas 6,8,13
    6: /** TBTABTHM.SITUACAO (A = ativo). */
    8: /** TBTABTHM.CH (≠ 0: modelo AMB, veto). */
    13: /** Maior DATA do item em TBVLRTHM (inclui vigência futura). */

## apps/api/src/modulos/sadt/porta-propria.ts
- modelo-pendente: linhas 115
    115: 'modelo-pendente',

## packages/dominio-sadt/dist/transfusao/ato-transfusional.d.ts  (só comentário)
- nome-origem: linhas 33
    33: /** Situação do horário no outro sistema (PRCHKGERAL), quando nasceu; null = o item não tem horário. */

## packages/dominio-relatorio/dist/agendamento.d.ts
- vocab-antigo: linhas 4
    4: /** HHMM. */

## packages/dominio-relatorio/dist/triagem.d.ts  (só comentário)
- nome-origem: linhas 5
    5: /** Módulo do editor de origem (TBEDITREL.MODULO: -1 abertura, 4 faturamento de convênios, 22 folha…). */

## packages/dominio-documento/dist/assinatura/selo.d.ts  (só comentário)
- nome-origem: linhas 22
    22: * TBCONSPROF.COD_CONSELHO_PROF): o primeiro OID do certificado (otherName do SubjectAltName) que o cadastro liga a um

## packages/dominio-documento/dist/zpl/modelos.d.ts  (só comentário)
- nome-origem: linhas 19
    19: /** RICADPAC.ID (paciente) e prontuário do legado. */

## packages/dominio-documento/dist/zpl/opme.d.ts  (só comentário)
- nome-origem: linhas 4
    4: /** O consumo (SGH_SUP_OPME_RASTREIO.ID) e o lançamento da saída do estoque (GELANSAI.ID_GELANSAI). */

## packages/dominio-financeiro/dist/dre.d.ts  (só comentário)
- nome-origem: linhas 13
    13: /** Grupo gerencial (TBGRUDES) para a abertura da DRE. */

## packages/dominio-financeiro/dist/lote-contabil.d.ts  (só comentário)
- nome-origem: linhas 3
    3: /** Chave do de-para: o tipo de lançamento (MFTIPOLANC) ou o item gerencial. */

## packages/dominio-financeiro/dist/orcamento.d.ts  (só comentário)
- nome-origem: linhas 8,141
    8: /** IDs dos centros de custo do cadastro (TBCENCUS.ID). */
    141: * Leva o realizado do banco à chave do orçamento: o código do centro (CDC = TBCENCUS.COD) vira o ID; o documento com

## packages/dominio-repasse/dist/calculo.d.ts  (só comentário)
- nome-origem: linhas 28
    28: /** Itens já integrados (FCINTEGRPA) não entram de novo (ficha, seção 5, repasse.integrarItens). */

## packages/dominio-repasse/dist/credor.d.ts  (só comentário)
- nome-origem: linhas 11
    11: /** Lançamento já em RPA (RPLANRPA) não entra em outro RPA (cenário recusa-ja-em-rpa). */

## packages/dominio-repasse/dist/rpa.d.ts  (só comentário)
- nome-origem: linhas 41
    41: /** Base de INSS já usada no mês nas outras empresas que somam impostos (RPEMPCALCIMP). */

## apps/api/src/modulos/adt/porta-propria.ts
- modelo-pendente: linhas 1173
    1173: new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo', `${o} aguarda a estrutura no modelo do banco.`);
