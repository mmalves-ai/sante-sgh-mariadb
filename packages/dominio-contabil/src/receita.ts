// Regra 4 (cap-07 §7.2; cap-11): a receita é reconhecida no FECHAMENTO da conta; glosa e recurso são AJUSTES de
// receita, não exclusão. Semântica das colunas (ref 02 §2, FCCTAEXT.FECHADA; ref 01 §13 e tabela de colunas):
//   - FCCTAEXT.FECHADA: N = aberta, S = fechada (DATA_FEC preenchida em 100%), A = apresentada à operadora (também
//     reconhecida), F = 1 conta anômala no pc (tratada como erro de dado: sem fato). Valor: TOTAL_CONTA.
//   - FCLANEXT: glosa = VALOR_C − VLR_PG no item baixado (GLOSADO = 'T' é "baixado/conciliado", não glosa); recurso
//     acatado = VLR_RP, só quando DT_RP está gravada (só é gravada quando entra dinheiro).
// Conta reaberta (S/A → N) deixa de ter o fato de receita: a conciliação (derivacao.ts) gera o estorno no período aberto.
import type { LinhaFonte } from '@sgh/contratos';
import { paraCentavos } from './dinheiro.js';
import { dataValida, inteiroOuNulo, textoOuVazio, type Derivador, type FatoBase } from './derivacao.js';

/** Situações de conta que reconhecem a receita. */
export const FECHADA_RECONHECE = new Set(['S', 'A']);

export const derivarConta: Derivador = (l: LinhaFonte) => {
  const v = l.valores;
  const situacao = textoOuVazio(v['FECHADA']).toUpperCase();
  const data = dataValida(v['DATA_FEC']);
  if (!FECHADA_RECONHECE.has(situacao) || !data) return [];
  const f: FatoBase = {
    tipo: 'receitaConta',
    data,
    valorCentavos: paraCentavos(v['TOTAL_CONTA'] as number | string | null),
    centroCusto: inteiroOuNulo(v['CENCUS']),
    documento: `conta ${l.id}`,
    campos: {
      convenio: inteiroOuNulo(v['CON']),
      tipoConta: textoOuVazio(v['TIPO_CTA']) || null,
      situacaoConta: situacao,
    },
  };
  return [f];
};

export const derivarItemConta: Derivador = (l: LinhaFonte) => {
  const v = l.valores;
  const r: FatoBase[] = [];
  const comum = {
    centroCusto: inteiroOuNulo(v['CDC']),
    documento: `conta ${textoOuVazio(v['ID_FCCTAEXT'])} item ${l.id}`,
    campos: { convenio: inteiroOuNulo(v['CONVENIO']), conta: inteiroOuNulo(v['ID_FCCTAEXT']) },
  };
  const baixado = textoOuVazio(v['GLOSADO']).toUpperCase() === 'T';
  const dataPg = dataValida(v['DT_PG']);
  const cobrado = paraCentavos(v['VALOR_C'] as number | string | null);
  const pago = paraCentavos(v['VLR_PG'] as number | string | null);
  if (baixado && dataPg && cobrado > pago)
    r.push({ tipo: 'ajusteGlosa', data: dataPg, valorCentavos: cobrado - pago, ...comum });
  const dataRp = dataValida(v['DT_RP']);
  const recurso = paraCentavos(v['VLR_RP'] as number | string | null);
  if (dataRp && recurso > 0)
    r.push({ tipo: 'ajusteRecurso', data: dataRp, valorCentavos: recurso, ...comum });
  return r;
};
