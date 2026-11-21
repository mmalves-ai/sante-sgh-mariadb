# Fatia F2.4 14-contabil (assunto: contabil; cliente de teste próprio: f24_14contabil)

## apps/api/src/modulos/contabil/porta-memoria.ts
- nome-origem: linhas 94,126
    94: tabela: 'FCCTAEXT',
    126: tabela: 'FCCTAEXT',

## apps/api/src/modulos/contabil/porta-propria.ts
- modelo-pendente: linhas 25,27,170,564
    25: // (regras() e publicarRegra recusadas com "modelo-pendente": a contabilização automática, o reprocessamento, a
    27: // do arquivo SPED (gravarArquivoSped e conteudoSped com "modelo-pendente"); a regra e a versão que geraram o
    170: 'modelo-pendente',
    564: * com "modelo-pendente" em vez de lista vazia: com zero regras a contabilização marcaria todo fato como "sem regra" e o

## packages/contratos/src/contabil/entradas.ts  (só comentário)
- nome-origem: linhas 44,47
    44: /** ID do tipo de plano referencial (COTIPOPLANOCONTAREFERENCIAL.ID) e o código da conta referencial. */
    47: /** Conta contábil do de-para da exportação (TBINTCRC.CTA_CONTABIL), quando a conta corresponde a uma de lá. */

## packages/contratos/src/contabil/rotas.ts
- nome-origem: linhas 32,33,34,35,36,37,38
    32: FCCTAEXT: 'Contas dos pacientes (receita)',
    33: FCLANEXT: 'Itens das contas (glosa e recurso)',
    34: MFCONPAG: 'Contas a pagar',
    35: MFCTAREC: 'Contas a receber',
    36: MFLANCTO: 'Movimento bancário',
    37: GELANSAI: 'Saídas de estoque',
    38: GECADNFS: 'Notas fiscais de entrada',

## packages/contratos/src/contabil/vocabulario.ts
- nome-origem: linhas 2,9,69,77,85,93,101,109,117,200
    2: // outro sistema grava em COTP_ORIGEM_LANCAMENTO (11 linhas na cópia pc, conferidas em 24/10/2026, só configuração):
    9: /** Origem do lançamento (COTP_ORIGEM_LANCAMENTO.ID → rótulo de produto). */
    69: tabela: 'FCCTAEXT',
    77: tabela: 'FCLANEXT',
    85: tabela: 'MFCONPAG',
    93: tabela: 'MFCTAREC',
    101: tabela: 'MFLANCTO',
    109: tabela: 'GELANSAI',
    117: tabela: 'GECADNFS',
    200: * Tipo de plano referencial (COTIPOPLANOCONTAREFERENCIAL: 14 linhas no pc; CODIGO e PLANOECF). O código "10" aparece

## packages/dominio-contabil/src/depara.ts  (só comentário)
- nome-origem: linhas 2,3,7,8,15
    2: // O de-para do banco (TBINTCRC, chave EMPRESA + CONV + TIPO_CONTA + TIPO_LANC + TIPO_ATO + SUBTIPO_DIARIA →
    3: // CTA_CONTABIL inteiro; RPINTEVE para o repasse; TBINTIMP para os impostos) fala de "conta contábil do escritório", um
    7: // Achado do preparo (cópia pc, 24/10/2026): as 2.422 linhas de TBINTCRC estão SEM conta contábil (CTA_CONTABIL nulo ou
    8: // zero) e nenhum dos 99 centros de custo tem a conta contábil (TBCENCUS.CONTABIL). Sem de-para preenchido, o fato fica
    15: /** Conta do escritório (TBINTCRC.CTA_CONTABIL); null ou 0 = sem conta. */

## packages/dominio-contabil/src/derivacao.ts  (só comentário)
- nome-origem: linhas 28
    28: /** Empresa contábil do estabelecimento (as fontes gravam a empresa de formas diferentes; FCCTAEXT.EMPRESA é texto). */

## packages/dominio-contabil/src/dinheiro.ts  (só comentário)
- nome-origem: linhas 2
    2: // NUMERIC(15,2); FCLANEXT.VALOR_D é NUMERIC(10,5) e TOTAL_CONTA é DOUBLE PRECISION: tudo passa por `paraCentavos`, que

## packages/dominio-contabil/src/fatos.ts  (só comentário)
- nome-origem: linhas 5
    5: // banco), e ~2 a 73% das linhas de algumas fontes não têm carimbo (MFLANCTO: 26.571 de 36.385 no pc). Então:

## packages/dominio-contabil/src/fontes.ts
- nome-origem: linhas 3,6,7,8,10,12,13,296,297,298,299,300,301,302
    3: // pessoa ou credor por nome (MFCTAREC.NOME e MFCONPAG.FAVORECIDO ficam fora da leitura).
    6: //   - MFCONPAG: lançamento pela EMISSAO e VALOR; baixa por DT_PGTO e PAGO.
    7: //   - MFCTAREC: lançamento pela APRES e VALOR; baixa por PGTO e VLR_PAG.
    8: //   - MFLANCTO: DATA e VALOR; transferência entre contas próprias (TIPO_TRF T e F) é um fato como os demais (a regra
    10: //   - GELANSAI: competência por ANO e MES; valor QTDE × VLRMED (preço médio dos gatilhos, regra 9). A linha não tem
    12: //   - GECADNFS: DATA e TOTAL.
    13: //   - RPRPA: EMISSAO e o valor dos títulos do recibo (MFCONPAG.ID_RPRPA), somado na leitura (VALOR_TITULOS);
    296: FCCTAEXT: derivarConta,
    297: FCLANEXT: derivarItemConta,
    298: MFCONPAG: derivarTituloPagar,
    299: MFCTAREC: derivarTituloReceber,
    300: MFLANCTO: derivarMovimentoBancario,

## packages/dominio-contabil/src/receita.ts  (só comentário)
- nome-origem: linhas 2,3,5
    2: // receita, não exclusão. Semântica das colunas (ref 02 §2, FCCTAEXT.FECHADA; ref 01 §13 e tabela de colunas):
    3: //   - FCCTAEXT.FECHADA: N = aberta, S = fechada (DATA_FEC preenchida em 100%), A = apresentada à operadora (também
    5: //   - FCLANEXT: glosa = VALOR_C − VLR_PG no item baixado (GLOSADO = 'T' é "baixado/conciliado", não glosa); recurso

## packages/dominio-contabil/src/registro.ts  (só comentário)
- nome-origem: linhas 6,70
    6: //   - `contextoDeAplicacao`: o de-para da exportação (TBINTCRC, o MESMO do M32; regra 6) como mapa para `contabilizar`;
    70: /** Item do de-para da exportação como a leitura do banco devolve (TBINTCRC). */

## packages/dominio-contabil/src/regra.ts  (só comentário)
- nome-origem: linhas 1
    1: // Regra 2 (cap-07 §7.2): regra de contabilização VERSIONADA por origem (COTP_ORIGEM_LANCAMENTO) e tipo de fato.

## packages/dominio-contabil/src/sped.ts  (só comentário)
- nome-origem: linhas 49
    49: /** Código do plano referencial (COTIPOPLANOCONTAREFERENCIAL.CODIGO) dos vínculos das contas. */
