// O quadro do PA com cor e cronômetro (ficha do M44, seção 7: evolução do quadro do M20, sem mudar de dono). Cada
// cartão ganha a cor vigente com o nome escrito, o prazo e os minutos que faltam (ou passaram), a marca de
// reclassificação obrigatória e o número de reclassificações. Dentro da coluna, a ordem passa a ser a do risco: a cor
// mais grave primeiro, depois o prazo mais próximo; sem classificação, depois dos classificados, pela prioridade legal
// e pela chegada (a ordem do M20). O painel de TV mostra só senha ou iniciais e a cor com o nome (nunca nome nem
// diagnóstico): `cartaoDoPainel`.
import type { CorRisco, RiscoNoQuadro } from '@sgh/contratos';
import { CORES_RISCO } from '@sgh/contratos';
import { prioridadeDaCor } from './protocolo.js';
import { classificacaoVigente, situacaoDoTempo, type ClassificacaoVigente } from './tempo-alvo.js';

const NOME: ReadonlyMap<CorRisco, string> = new Map(CORES_RISCO.map((c) => [c.codigo, c.nome]));
const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);

/** O risco do cartão a partir das classificações do atendimento (todas as linhas, só inclusão). */
export function riscoDoAtendimento(
  linhas: readonly ClassificacaoVigente[],
  agora: string,
  atendimentoMedicoEm: string | null,
): RiscoNoQuadro | null {
  const v = classificacaoVigente(linhas);
  if (!v) return null;
  const t = situacaoDoTempo(v, agora, atendimentoMedicoEm);
  return {
    cor: v.cor,
    nomeCor: NOME.get(v.cor) ?? v.cor,
    prioridade: prioridadeDaCor(v.cor),
    classificadoEm: v.classificadoEm,
    prazoEm: t.prazoEm,
    minutosRestantes: t.minutosRestantes,
    estourado: t.estourado,
    reclassificar: t.estourado && !t.atendido,
    reclassificacoes: linhas.filter((l) => l.motivo !== 'inicial').length,
  };
}

export interface ItemOrdenavel {
  readonly reg: number;
  readonly prioridade: '0' | '1' | '2';
  readonly chegada: string;
  readonly risco: Pick<RiscoNoQuadro, 'prioridade' | 'prazoEm'> | null;
}

/** Ordem da coluna do quadro com a cor (classificados primeiro, pelo risco e pelo prazo). */
export function ordenarPorRisco<T extends ItemOrdenavel>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) => {
    if (a.risco && b.risco)
      return (
        a.risco.prioridade - b.risco.prioridade ||
        ms(a.risco.prazoEm) - ms(b.risco.prazoEm) ||
        ms(a.chegada) - ms(b.chegada) ||
        a.reg - b.reg
      );
    if (a.risco) return -1;
    if (b.risco) return 1;
    return a.prioridade.localeCompare(b.prioridade) || ms(a.chegada) - ms(b.chegada) || a.reg - b.reg;
  });
}

/** Contagem por cor (o cabeçalho do quadro e o cartão da fila de trabalho do PA, etapa 3). */
export function contagemPorCor(
  riscos: readonly (Pick<RiscoNoQuadro, 'cor' | 'estourado'> | null)[],
): { cor: CorRisco | 'semClassificacao'; total: number; estourados: number }[] {
  const r = [...CORES_RISCO.map((c) => c.codigo), 'semClassificacao' as const].map((cor) => ({
    cor,
    total: 0,
    estourados: 0,
  }));
  for (const x of riscos) {
    const alvo = r.find((y) => y.cor === (x?.cor ?? 'semClassificacao'))!;
    alvo.total++;
    if (x?.estourado) alvo.estourados++;
  }
  return r;
}

/**
 * O cartão do painel de TV: só a senha (ou as iniciais, sem senha), a cor com o nome e o tempo de espera em
 * minutos. Nunca nome, prontuário nem queixa.
 */
export function cartaoDoPainel(item: {
  readonly senha: string | null;
  readonly iniciais: string;
  readonly risco: Pick<RiscoNoQuadro, 'cor' | 'nomeCor'> | null;
  readonly minutosTotal: number;
}): { rotulo: string; cor: CorRisco | null; nomeCor: string | null; minutos: number } {
  return {
    rotulo: item.senha?.trim() || item.iniciais,
    cor: item.risco?.cor ?? null,
    nomeCor: item.risco?.nomeCor ?? null,
    minutos: item.minutosTotal,
  };
}
