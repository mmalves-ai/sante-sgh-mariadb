// W0-09 (programa CRUD completo, M2): regras puras da hora confiável (NGS1.07.05). O desvio do relógio do servidor da
// API e do banco contra a referência do NTP, o item do painel de saúde e a exibição no fuso da instituição. A hora se
// grava sempre em UTC (o processo roda com TZ=UTC, D-TZ-60.2); o fuso da instituição só muda a exibição. Sem E/S.
import type { HoraConfiavel, ItemFumaca, RelogioConferido, SituacaoItemConferencia } from '@sgh/contratos';

export interface EntradaHoraConfiavel {
  readonly servidorNtp: string;
  /**
   * Deslocamento do relógio local para o do NTP (ms; o `offset` do SNTP: NTP − local). Nulo: o NTP não respondeu
   * (sem acesso de rede ou servidor errado).
   */
  readonly deslocamentoNtpMs: number | null;
  /** O instante do servidor no meio da consulta ao NTP (ms). */
  readonly servidorMs: number;
  /** O relógio do banco contra o do servidor (a fumaça do M60). */
  readonly relogio: RelogioConferido;
  readonly limiarMs: number;
  readonly fusoInstituicao: string;
}

/** O instante como se grava: ISO 8601 em UTC (sufixo Z), qualquer que seja o fuso do processo ou da instituição. */
export function instanteParaGravar(ms: number): string {
  return new Date(ms).toISOString();
}

/** O instante exibido no fuso da instituição: DD/MM/AAAA HH:mm:ss. Fuso inválido: cai para UTC com o sufixo. */
export function exibirNoFuso(ms: number, fuso: string): string {
  const fmt = (timeZone: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(ms))
      .replace(',', '');
  try {
    return fmt(fuso);
  } catch {
    return `${fmt('UTC')} UTC`;
  }
}

export function conferirHoraConfiavel(e: EntradaHoraConfiavel): HoraConfiavel {
  const exibidoNoFuso = exibirNoFuso(e.servidorMs, e.fusoInstituicao);
  const base = {
    servidorNtp: e.servidorNtp,
    limiarMs: Math.max(1, Math.round(e.limiarMs)),
    fusoInstituicao: e.fusoInstituicao,
    exibidoNoFuso,
  };
  if (e.deslocamentoNtpMs === null || !Number.isFinite(e.deslocamentoNtpMs))
    return {
      ...base,
      referencia: 'sem-referencia',
      ntpEm: null,
      desvioServidorMs: null,
      desvioBancoMs: null,
    };
  const desvioServidorMs = Math.round(-e.deslocamentoNtpMs);
  // A deriva do banco é contra o servidor (positivo = banco adiantado): contra o NTP soma-se o desvio do servidor.
  const desvioBancoMs = e.relogio.derivaMs === null ? null : desvioServidorMs + e.relogio.derivaMs;
  return {
    ...base,
    referencia: 'ntp',
    ntpEm: instanteParaGravar(Math.round(e.servidorMs + e.deslocamentoNtpMs)),
    desvioServidorMs,
    desvioBancoMs,
  };
}

const segundos = (ms: number) => (Math.abs(ms) / 1000).toFixed(1).replace('.', ',');
const sinal = (ms: number) => (ms >= 0 ? 'adiantado' : 'atrasado');

/** O item 'hora-confiavel' do painel de saúde: alerta sem referência ou acima do limiar (nunca falha sozinho). */
export function itemHoraConfiavel(h: HoraConfiavel): ItemFumaca {
  const titulo = 'Hora confiável (NTP)';
  const it = (situacao: SituacaoItemConferencia, detalhe: string): ItemFumaca => ({
    codigo: 'hora-confiavel',
    titulo,
    situacao,
    detalhe,
  });
  if (h.referencia === 'sem-referencia')
    return it(
      'alerta',
      `Sem referência: o servidor NTP ${h.servidorNtp} não respondeu (confira o acesso de rede ao NTP.br e o parâmetro do servidor NTP).`,
    );
  const partes = [`servidor da API ${segundos(h.desvioServidorMs ?? 0)} s ${sinal(h.desvioServidorMs ?? 0)}`];
  partes.push(
    h.desvioBancoMs === null
      ? 'banco não lido'
      : `banco ${segundos(h.desvioBancoMs)} s ${sinal(h.desvioBancoMs)}`,
  );
  const pior = Math.max(Math.abs(h.desvioServidorMs ?? 0), Math.abs(h.desvioBancoMs ?? 0));
  const texto = `Contra ${h.servidorNtp}: ${partes.join('; ')} (limiar ${segundos(h.limiarMs)} s; ${h.fusoInstituicao}: ${h.exibidoNoFuso}).`;
  if (pior > h.limiarMs || h.desvioBancoMs === null)
    return it('alerta', `${texto} Sincronize o NTP do servidor acima do limiar.`);
  return it('ok', texto);
}
