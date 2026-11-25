/**
 * C2-122: os prazos regulatórios da resposta ao pedido de autorização lidos do cadastro (prazo_atendimento_regulatorio,
 * RN 395 e RN 566) e a alçada do autorizador (alcada_autorizador_plano) conferida na decisão.
 *
 * O prazo da resposta vem da linha vigente do cadastro pelo código: `resposta_padrao` (pedido eletivo comum) e
 * `resposta_complexa` (alta complexidade e internação eletiva). A urgência e a emergência são sempre imediatas (a norma
 * não dá prazo). Sem a linha vigente, vale o padrão da norma (PARAMETROS_AUTORIZACAO), dito no resultado.
 */
import { type CaraterAtendimento, TIPO_GUIA, type TipoPrazo } from '@sgh/contratos';
import { PARAMETROS_AUTORIZACAO, type Problema, somarDiasUteis } from './autorizacao.js';
import { somarDias } from './carteirinha.js';

export const CODIGO_PRAZO_RESPOSTA = { padrao: 'resposta_padrao', complexo: 'resposta_complexa' } as const;

export type UnidadePrazoRegulatorio = 'hora' | 'dia' | 'dia_util';

export interface PrazoRegulatorio {
  readonly codigo: string;
  readonly prazo: number;
  readonly unidade: UnidadePrazoRegulatorio;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface PrazoCalculado {
  readonly tipo: TipoPrazo;
  readonly prazoEm: string;
  /** O código da linha do cadastro que deu o prazo (null: imediato ou o padrão da norma). */
  readonly origem: string | null;
}

/** A linha vigente no dia (a de início mais recente), ou null. */
export function prazoRegulatorioVigente(
  linhas: readonly PrazoRegulatorio[],
  codigo: string,
  hoje: string,
): PrazoRegulatorio | null {
  return (
    linhas
      .filter(
        (l) =>
          l.codigo === codigo &&
          l.ativo &&
          l.vigenciaInicio <= hoje &&
          (l.vigenciaFim === null || l.vigenciaFim >= hoje),
      )
      .sort((a, b) => (a.vigenciaInicio < b.vigenciaInicio ? 1 : -1))[0] ?? null
  );
}

/** Soma o prazo na unidade do cadastro: horas a partir do instante; dias corridos e úteis até o fim do dia. */
export function vencimentoDoPrazo(instante: string, prazo: number, unidade: UnidadePrazoRegulatorio): string {
  const i = instante.slice(0, 19).replace(' ', 'T');
  if (unidade === 'hora') {
    const d = new Date(`${i}Z`);
    d.setUTCHours(d.getUTCHours() + prazo);
    return d.toISOString().slice(0, 19);
  }
  const dia = unidade === 'dia' ? somarDias(i.slice(0, 10), prazo) : somarDiasUteis(i, prazo);
  return `${dia}T23:59:59`;
}

/** O prazo da resposta ao pedido pelo cadastro regulatório vigente no dia do pedido. */
export function prazoDaRespostaRegulatorio(
  p: { readonly carater: CaraterAtendimento; readonly tipoGuia: number; readonly altaComplexidade: boolean },
  agora: string,
  linhas: readonly PrazoRegulatorio[],
): PrazoCalculado {
  const instante = agora.slice(0, 19).replace(' ', 'T');
  if (p.carater === 'U') return { tipo: 'imediato', prazoEm: instante, origem: null };
  const complexo = p.altaComplexidade || p.tipoGuia === TIPO_GUIA.internacao;
  const codigo = complexo ? CODIGO_PRAZO_RESPOSTA.complexo : CODIGO_PRAZO_RESPOSTA.padrao;
  const tipo: TipoPrazo = complexo ? 'complexo' : 'padrao';
  const linha = prazoRegulatorioVigente(linhas, codigo, instante.slice(0, 10));
  if (linha)
    return { tipo, prazoEm: vencimentoDoPrazo(instante, linha.prazo, linha.unidade), origem: codigo };
  const dias = complexo ? PARAMETROS_AUTORIZACAO.diasUteisComplexo : PARAMETROS_AUTORIZACAO.diasUteisPadrao;
  return { tipo, prazoEm: vencimentoDoPrazo(instante, dias, 'dia_util'), origem: null };
}

/** Os dias úteis vigentes (padrão e complexo) para a tela, quando o cadastro está em dias úteis. */
export function parametrosDosPrazos(
  linhas: readonly PrazoRegulatorio[],
  hoje: string,
): { diasUteisPadrao: number; diasUteisComplexo: number; diasValidadeSenha: number } {
  const dias = (codigo: string, padrao: number) => {
    const l = prazoRegulatorioVigente(linhas, codigo, hoje);
    return l && l.unidade === 'dia_util' ? l.prazo : padrao;
  };
  return {
    diasUteisPadrao: dias(CODIGO_PRAZO_RESPOSTA.padrao, PARAMETROS_AUTORIZACAO.diasUteisPadrao),
    diasUteisComplexo: dias(CODIGO_PRAZO_RESPOSTA.complexo, PARAMETROS_AUTORIZACAO.diasUteisComplexo),
    diasValidadeSenha: PARAMETROS_AUTORIZACAO.diasValidadeSenha,
  };
}

// ── Alçada do autorizador ────────────────────────────────────────────────────────────────────────

export interface AlcadaAutorizador {
  readonly nivel: number;
  /** Valor máximo por guia (null: sem limite). */
  readonly valorLimite: number | null;
  readonly autorizaGuia: boolean;
  readonly autorizaProcedimento: boolean;
  readonly autorizaProrrogacao: boolean;
  readonly negaItem: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface DecisaoParaAlcada {
  readonly situacao: 'autorizada' | 'parcial' | 'negada';
  /** Os itens decididos com a quantidade autorizada e o valor unitário de referência (null: sem valor). */
  readonly itens: readonly { readonly quantidade: number; readonly valorUnitario: number | null }[];
  /** O pedido é prorrogação de internação (tem guia principal de internação). */
  readonly prorrogacao: boolean;
}

/** O valor autorizado da guia: a soma das quantidades autorizadas pelo valor de referência (sem valor não soma). */
export function valorAutorizado(itens: DecisaoParaAlcada['itens']): number {
  return Math.round(itens.reduce((s, i) => s + i.quantidade * (i.valorUnitario ?? 0), 0) * 100) / 100;
}

/**
 * A alçada do autorizador na decisão. Sem alçada ligada ao auditor, só valem a categoria e o limite do próprio auditor.
 * Com alçada: precisa estar vigente; autorizar (total ou parcial) exige autorizar guia ou procedimento; negar item
 * (negativa ou parcial) exige negar item; a prorrogação exige autorizar prorrogação; o valor autorizado não passa do
 * menor limite (o da alçada e o do auditor).
 */
export function problemasDaAlcada(
  alcada: AlcadaAutorizador | null,
  limiteDoAuditor: number | null,
  d: DecisaoParaAlcada,
  hoje: string,
): Problema[] {
  const p: Problema[] = [];
  if (alcada) {
    const vigente =
      alcada.ativo &&
      alcada.vigenciaInicio <= hoje &&
      (alcada.vigenciaFim === null || alcada.vigenciaFim >= hoje);
    if (!vigente) return [{ codigo: 'alcada-fora-da-vigencia', campo: 'auditor' }];
    if (d.situacao !== 'negada' && !alcada.autorizaGuia && !alcada.autorizaProcedimento)
      p.push({ codigo: 'alcada-nao-autoriza', campo: 'decisao' });
    if (d.situacao !== 'autorizada' && !alcada.negaItem)
      p.push({ codigo: 'alcada-nao-nega', campo: 'decisao' });
    if (d.prorrogacao && d.situacao !== 'negada' && !alcada.autorizaProrrogacao)
      p.push({ codigo: 'alcada-nao-prorroga', campo: 'decisao' });
  }
  const limites = [alcada?.valorLimite ?? null, limiteDoAuditor].filter((x): x is number => x !== null);
  if (d.situacao !== 'negada' && limites.length && valorAutorizado(d.itens) > Math.min(...limites))
    p.push({ codigo: 'alcada-valor-acima', campo: 'itens' });
  return p;
}
