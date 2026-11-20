// W0-03, mercado M3: as regras dos protocolos gerenciados no paciente internado, sem banco (o servidor e a tela usam
// as mesmas):
//   - o local da inclusão pela unidade (UTI pelo parâmetro das unidades de UTI; senão, internação);
//   - a sugestão pelo NEWS2 (escore válido, no limiar ou acima, sem protocolo de sepse aberto no atendimento; o mais
//     recente por atendimento);
//   - a inclusão conferida (o escore do mesmo atendimento, válido e no limiar; a hora do reconhecimento nunca no
//     futuro; um protocolo aberto por tipo e atendimento) e o tempo zero (a hora do escore ou a do reconhecimento);
//   - os indicadores por origem (PA, internação, UTI), cada um com o numerador e o denominador.
// O relógio das metas (prazo e situação de cada meta) é o mesmo do PA (dominio-recepcao), aplicado pela API.
// Base: RDC 36/2013 (protocolos e indicadores de segurança do paciente).
import type {
  IndicadorOrigemProtocolo,
  LocalInternado,
  LocalProtocolo,
  OrigemInclusaoInternado,
} from '@sgh/contratos';
import { diferencaMinutos } from '../tempo.js';

/** O local do internado pela unidade (as unidades de UTI vêm do parâmetro da instituição). */
export function localDaUnidade(unidade: string | null, unidadesUti: readonly string[]): LocalInternado {
  const u = (unidade ?? '').trim().toUpperCase();
  return u !== '' && unidadesUti.some((x) => x.trim().toUpperCase() === u) ? 'uti' : 'internacao';
}

export interface EscoreParaProtocolo {
  readonly id: number;
  readonly atendimento: number;
  readonly escala: string;
  readonly total: number;
  /** A hora da aferição (AAAA-MM-DDTHH:mm). */
  readonly em: string;
  readonly estornado: boolean;
}

/** Alertas do NEWS2 que sugerem o protocolo de sepse: o mais recente por atendimento sem sepse aberta. */
export function sugestoesPeloNews2(
  escores: readonly EscoreParaProtocolo[],
  atendimentosComSepseAberta: ReadonlySet<number>,
  limiar: number,
): EscoreParaProtocolo[] {
  const porAtendimento = new Map<number, EscoreParaProtocolo>();
  for (const e of escores) {
    if (e.escala !== 'news2' || e.estornado || e.total < limiar) continue;
    if (atendimentosComSepseAberta.has(e.atendimento)) continue;
    const atual = porAtendimento.get(e.atendimento);
    if (!atual || e.em > atual.em || (e.em === atual.em && e.id > atual.id))
      porAtendimento.set(e.atendimento, e);
  }
  return [...porAtendimento.values()].sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : b.id - a.id));
}

export type ProblemaInclusaoInternado =
  | 'escore-de-outro-atendimento'
  | 'escore-nao-e-news2'
  | 'escore-estornado'
  | 'escore-abaixo-do-limiar'
  | 'reconhecimento-no-futuro'
  | 'reconhecimento-antigo'
  | 'protocolo-ja-aberto';

export const MENSAGENS_INCLUSAO_INTERNADO: Readonly<Record<ProblemaInclusaoInternado, string>> = {
  'escore-de-outro-atendimento': 'O alerta escolhido é de outro atendimento.',
  'escore-nao-e-news2': 'Só o alerta do NEWS2 abre o protocolo pela origem "alerta".',
  'escore-estornado': 'O escore escolhido foi estornado: escolha um alerta válido.',
  'escore-abaixo-do-limiar': 'O NEWS2 escolhido está abaixo do limiar da instituição.',
  'reconhecimento-no-futuro': 'A hora do reconhecimento não pode estar no futuro.',
  'reconhecimento-antigo': 'A hora do reconhecimento passa de 24 horas: registre a suspeita atual.',
  'protocolo-ja-aberto': 'O paciente já está neste protocolo neste atendimento.',
};

/** Janela máxima da hora do reconhecimento (a inclusão é do que está acontecendo, não registro retroativo longo). */
export const JANELA_RECONHECIMENTO_MIN = 24 * 60;

export function problemaDaInclusaoInternado(p: {
  origem: OrigemInclusaoInternado;
  atendimento: number;
  escore: EscoreParaProtocolo | null;
  limiar: number;
  reconhecidoEm: string | null;
  agora: string;
  jaAberto: boolean;
}): ProblemaInclusaoInternado | null {
  if (p.jaAberto) return 'protocolo-ja-aberto';
  if (p.origem === 'news2') {
    const e = p.escore;
    if (!e || e.atendimento !== p.atendimento) return 'escore-de-outro-atendimento';
    if (e.escala !== 'news2') return 'escore-nao-e-news2';
    if (e.estornado) return 'escore-estornado';
    if (e.total < p.limiar) return 'escore-abaixo-do-limiar';
    return null;
  }
  const r = p.reconhecidoEm ?? p.agora;
  if (diferencaMinutos(p.agora, r) > 0) return 'reconhecimento-no-futuro';
  if (diferencaMinutos(r, p.agora) > JANELA_RECONHECIMENTO_MIN) return 'reconhecimento-antigo';
  return null;
}

/** O tempo zero do relógio: a hora do alerta do NEWS2 ou a do reconhecimento da suspeita. */
export function tempoZeroDoInternado(
  origem: OrigemInclusaoInternado,
  escoreEm: string | null,
  reconhecidoEm: string | null,
  incluidoEm: string,
): string {
  if (origem === 'news2' && escoreEm) return escoreEm;
  return reconhecidoEm ?? incluidoEm;
}

// ── Indicadores por origem ───────────────────────────────────────────────────────────────────────

export interface ProtocoloParaIndicador {
  readonly local: LocalProtocolo;
  readonly tipo: string;
  /** Incluído pelo alerta do NEWS2 (no PA, a sugestão da classificação não conta aqui). */
  readonly pelaNews2: boolean;
  /** Os códigos das metas da versão usada. */
  readonly metas: readonly string[];
  readonly eventos: readonly { tipo: string; codigo: string; situacao: string }[];
  readonly inativo: boolean;
}

/** Arredonda a uma casa (percentual). */
function pct(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 1000) / 10;
}

/**
 * Os indicadores por origem e tipo, mais a linha "todos" de cada origem: a adesão às metas (cumpridas / registradas),
 * o pacote completo (encerradas com todas as metas cumpridas / encerradas) e os óbitos. A inclusão inativada (por
 * engano) não conta. A ordem é PA, internação, UTI; dentro de cada origem, "todos" primeiro e os tipos em ordem.
 */
export function indicadoresPorOrigem(
  protocolos: readonly ProtocoloParaIndicador[],
): IndicadorOrigemProtocolo[] {
  const ordemLocal: LocalProtocolo[] = ['pa', 'internacao', 'uti'];
  const grupos = new Map<string, IndicadorOrigemProtocolo>();
  const somar = (local: LocalProtocolo, tipo: string, p: ProtocoloParaIndicador) => {
    const k = `${local}|${tipo}`;
    const g = grupos.get(k) ?? {
      local,
      tipo,
      inclusoes: 0,
      pelaNews2: 0,
      metasCumpridas: 0,
      metasRegistradas: 0,
      adesaoPercentual: null,
      pacoteCompleto: 0,
      encerradas: 0,
      pacotePercentual: null,
      obitos: 0,
    };
    g.inclusoes++;
    if (p.pelaNews2) g.pelaNews2++;
    let cumpridas = 0;
    for (const m of p.metas) {
      const ev = p.eventos.find((e) => e.tipo === 'meta' && e.codigo === m);
      if (!ev) continue;
      g.metasRegistradas++;
      if (ev.situacao === 'cumprida') {
        g.metasCumpridas++;
        cumpridas++;
      }
    }
    const enc = p.eventos.find((e) => e.tipo === 'encerramento');
    if (enc) {
      g.encerradas++;
      if (p.metas.length > 0 && cumpridas === p.metas.length) g.pacoteCompleto++;
      if (enc.situacao === 'obito') g.obitos++;
    }
    grupos.set(k, g);
  };
  for (const p of protocolos) {
    if (p.inativo) continue;
    somar(p.local, 'todos', p);
    somar(p.local, p.tipo, p);
  }
  return [...grupos.values()]
    .map((g) => ({
      ...g,
      adesaoPercentual: pct(g.metasCumpridas, g.metasRegistradas),
      pacotePercentual: pct(g.pacoteCompleto, g.encerradas),
    }))
    .sort((a, b) => {
      const l = ordemLocal.indexOf(a.local) - ordemLocal.indexOf(b.local);
      if (l !== 0) return l;
      if (a.tipo === 'todos') return -1;
      if (b.tipo === 'todos') return 1;
      return a.tipo.localeCompare(b.tipo);
    });
}
