// Regra 2 do M55 (RDC 63/2011, RDC63-07; cap-07 §7.2): plano preventivo, calibração e segurança elétrica por
// equipamento, com laudo anexado; a vencida aparece no painel. A próxima data conta da última execução (ou da data
// base, antes da primeira); calibração e segurança elétrica só valem com laudo; reprovado deixa o equipamento parado
// e pede a corretiva. O "hoje" vem de quem chama.
import {
  ATIVIDADES_COM_LAUDO,
  type AtividadePlano,
  type CriticidadeEquipamento,
  type ResultadoExecucao,
  type SituacaoPlano,
  type UnidadePeriodicidade,
} from '@sgh/contratos';
import type { Recusa } from './os.js';
import { diasEntre, somarDias, somarMeses } from './tempo.js';

export interface Periodicidade {
  readonly quantidade: number;
  readonly unidade: UnidadePeriodicidade;
}

export function somarPeriodo(data: string, p: Periodicidade): string {
  if (!Number.isInteger(p.quantidade) || p.quantidade < 1) throw new Error('Periodicidade inválida.');
  return p.unidade === 'dias' ? somarDias(data, p.quantidade) : somarMeses(data, p.quantidade);
}

export interface PlanoParaPainel {
  readonly dataBase: string;
  readonly periodicidade: Periodicidade;
  readonly ultimaExecucao: string | null;
  /** Antecedência própria do item; nula: a do estabelecimento. */
  readonly antecedenciaDias: number | null;
}

export interface SituacaoDoPlano {
  readonly proxima: string;
  readonly situacao: SituacaoPlano;
  /** Dias de hoje até a próxima (negativo: vencida há tantos dias). */
  readonly diasParaVencer: number;
}

/** Próxima execução e situação no painel: vencida passa do dia; a vencer dentro da antecedência; senão em dia. */
export function situacaoDoPlano(
  p: PlanoParaPainel,
  hoje: string,
  antecedenciaPadrao: number,
): SituacaoDoPlano {
  const proxima = p.ultimaExecucao === null ? p.dataBase : somarPeriodo(p.ultimaExecucao, p.periodicidade);
  const dias = diasEntre(hoje, proxima);
  const antecedencia = p.antecedenciaDias ?? antecedenciaPadrao;
  const situacao: SituacaoPlano = dias < 0 ? 'vencida' : dias <= antecedencia ? 'aVencer' : 'emDia';
  return { proxima, situacao, diasParaVencer: dias };
}

export function exigeLaudo(atividade: AtividadePlano): boolean {
  return ATIVIDADES_COM_LAUDO.includes(atividade);
}

export interface PedidoExecucao {
  readonly atividade: AtividadePlano;
  readonly data: string;
  readonly hoje: string;
  readonly resultado: ResultadoExecucao;
  readonly laudo: number | null;
  readonly ultimaExecucao: string | null;
  readonly equipamentoDesativado: boolean;
}

export type RecusaExecucao =
  'laudo-obrigatorio' | 'data-futura' | 'antes-da-ultima' | 'equipamento-desativado';

export type PlanoExecucao =
  | {
      readonly ok: true;
      /** Reprovado: o equipamento fica parado desde a data e a corretiva é aberta pela manutenção. */
      readonly abrirCorretiva: boolean;
      readonly registrarParada: boolean;
    }
  | Recusa<RecusaExecucao>;

export function planejarExecucao(p: PedidoExecucao): PlanoExecucao {
  const recusa = (recusa: RecusaExecucao, mensagem: string): Recusa<RecusaExecucao> => ({
    ok: false,
    recusa,
    mensagem,
  });
  if (p.equipamentoDesativado)
    return recusa('equipamento-desativado', 'O equipamento está desativado: o plano não recebe execução.');
  if (diasEntre(p.hoje, p.data) > 0) return recusa('data-futura', 'A execução é registrada depois de feita.');
  if (p.ultimaExecucao !== null && diasEntre(p.ultimaExecucao, p.data) < 0)
    return recusa('antes-da-ultima', 'Já há execução registrada depois desta data.');
  if (exigeLaudo(p.atividade) && p.laudo === null)
    return recusa('laudo-obrigatorio', 'Anexe o laudo: calibração e segurança elétrica só valem com ele.');
  const reprovado = p.resultado === 'reprovado';
  return { ok: true, abrirCorretiva: reprovado, registrarParada: reprovado };
}

export interface ItemDoPainel {
  readonly plano: number;
  readonly criticidade: CriticidadeEquipamento;
  readonly situacao: SituacaoDoPlano;
}

const PESO_CRITICIDADE: Readonly<Record<CriticidadeEquipamento, number>> = {
  critica: 0,
  alta: 1,
  media: 2,
  baixa: 3,
};
const PESO_SITUACAO: Readonly<Record<SituacaoPlano, number>> = { vencida: 0, aVencer: 1, emDia: 2 };

/** Ordem do painel: vencidas, depois a vencer, depois em dia; dentro, a mais atrasada e o equipamento mais crítico. */
export function ordenarPainel<T extends ItemDoPainel>(itens: readonly T[]): T[] {
  return [...itens].sort(
    (a, b) =>
      PESO_SITUACAO[a.situacao.situacao] - PESO_SITUACAO[b.situacao.situacao] ||
      a.situacao.diasParaVencer - b.situacao.diasParaVencer ||
      PESO_CRITICIDADE[a.criticidade] - PESO_CRITICIDADE[b.criticidade] ||
      a.plano - b.plano,
  );
}

/** Contagem do painel por situação (a tela mostra os três números). */
export function resumoPainel(itens: readonly ItemDoPainel[]): Record<SituacaoPlano, number> {
  const r: Record<SituacaoPlano, number> = { vencida: 0, aVencer: 0, emDia: 0 };
  for (const i of itens) r[i.situacao.situacao] += 1;
  return r;
}
