// Comuns das telas de férias e 13º (M53.4, etapa F3): as contas de data da tela (fim do gozo e pagamento previstos,
// intervalo padrão da escala), as opções de dias e de abono a partir do saldo do período, as recusas que o servidor
// devolve na programação, o que cada fração deixa fazer e as datas padrão do 13º. O servidor confere tudo de novo (a
// regra da CLT está em @sgh/dominio-pessoas); aqui é só a previsão que a tela mostra antes de enviar.
import {
  type ApoioFeriasDecimo,
  type FeriasDoVinculo,
  type PeriodoAquisitivo,
  RECUSAS_PROGRAMACAO_FERIAS,
  type RecusaProgramacaoFerias,
} from '@sgh/contratos';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { dataBr } from '../../pessoas/comum.js';

/** AAAA-MM-DD + n dias (n pode ser negativo), em UTC. */
export function somarDias(data: string, n: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const x = new Date(Date.UTC(a!, m! - 1, d! + n));
  return x.toISOString().slice(0, 10);
}

/** "01/12/2026 – 20/12/2026" (o intervalo de datas da tela). */
export const faixa = (de: string, ate: string) => `${dataBr(de)} – ${dataBr(ate)}`;

/** Último dia do gozo: o início conta como o primeiro dia. */
export const fimDoGozo = (inicio: string, dias: number) => somarDias(inicio, dias - 1);

/** O pagamento das férias até dois dias antes do início do gozo (CLT art. 145). */
export const pagamentoPrevisto = (inicio: string) => somarDias(inicio, -2);

/** O intervalo inicial da escala: de hoje aos próximos 120 dias. */
export const intervaloPadrao = (hoje: string) => ({ de: hoje, ate: somarDias(hoje, 120) });

/** O período aceita uma nova fração: completo (aberto ou vencido) e com saldo. */
export const periodoProgramavel = (p: PeriodoAquisitivo) =>
  (p.situacao === 'aberto' || p.situacao === 'vencido') && p.saldo > 0;

/** Dias de gozo oferecidos: de 5 (fração mínima) até o saldo, no máximo 30; com saldo abaixo de 5, só o saldo. */
export function opcoesDiasGozo(saldo: number): number[] {
  const max = Math.min(30, Math.max(0, saldo));
  const min = Math.min(5, max);
  const r: number[] = [];
  for (let d = max; d >= min && d > 0; d--) r.push(d);
  return r;
}

/** Abono pecuniário: até um terço do direito (art. 143), sem passar do saldo menos um dia de gozo. */
export function opcoesAbono(p: Pick<PeriodoAquisitivo, 'direito' | 'saldo' | 'abono'>): number[] {
  if (p.abono > 0) return [0];
  const max = Math.max(0, Math.min(Math.floor(p.direito / 3), p.saldo - 1));
  return Array.from({ length: max + 1 }, (_, i) => i);
}

/** As recusas da CLT que o servidor devolveu (todas, quando vieram na lista; senão a primeira pelo código). */
export function recusasDaProgramacao(e: unknown): RecusaProgramacaoFerias[] {
  if (!(e instanceof ErroApi)) return [];
  const p = e.problema as { codigo?: unknown; recusas?: unknown } | null;
  const validas = (xs: unknown[]) =>
    xs.filter((x): x is RecusaProgramacaoFerias =>
      (RECUSAS_PROGRAMACAO_FERIAS as readonly unknown[]).includes(x),
    );
  if (Array.isArray(p?.recusas)) {
    const r = validas(p.recusas);
    if (r.length) return r;
  }
  return typeof p?.codigo === 'string' ? validas([p.codigo]) : [];
}

/** O que a fração deixa a sessão fazer (o servidor confere de novo). */
export function acoesDaFracao(f: FeriasDoVinculo, a: ApoioFeriasDecimo) {
  const ligada = a.gravacao.ligada;
  return {
    calcular: ligada && f.situacao === 'programada' && a.acoes.calcularFerias,
    // D-PERM-534: o recibo calculado só se cancela com a permissão de calcular; a programação, com a de programar.
    cancelar:
      ligada &&
      (f.situacao === 'programada'
        ? a.acoes.programar
        : f.situacao === 'calculada' && a.acoes.calcularFerias),
    recibo: f.situacao === 'calculada' && a.acoes.verSalario,
  };
}

/** Escala na empresa escolhida, por início do gozo e vínculo. */
export function escalaDaEmpresa(xs: readonly FeriasDoVinculo[], empresa: number | null): FeriasDoVinculo[] {
  return xs
    .filter((f) => empresa === null || f.empresa === empresa)
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.vinculo - b.vinculo || a.id - b.id);
}

/** Saldo a gozar somando os períodos completos (o que aparece no autosserviço). */
export const saldoTotal = (ps: readonly PeriodoAquisitivo[]) =>
  ps.filter((p) => p.situacao === 'aberto' || p.situacao === 'vencido').reduce((s, p) => s + p.saldo, 0);

/** Data padrão de pagamento de cada parcela do 13º (Lei 4.749/1965): 30/11 e 20/12 do ano. */
export const pagamentoPadraoDecimo = (ano: number, parcela: 1 | 2) =>
  parcela === 1 ? `${ano}-11-30` : `${ano}-12-20`;

/** Os anos que a tela do 13º oferece: o de hoje e os dois anteriores. */
export const anosDecimo = (hoje: string) => {
  const a = Number(hoje.slice(0, 4));
  return [a, a - 1, a - 2];
};
