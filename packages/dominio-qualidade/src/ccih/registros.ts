// Conferências dos registros da CCIH que não são regra de cálculo: dispositivo (inserção e retirada), observação de
// higiene das mãos e surto. Todas devolvem o código da recusa (texto em mensagens.ts) ou null.
import type { DispositivoInvasivoLido, SituacaoSurto, TipoDispositivoInvasivo } from '@sgh/contratos';
import { ACOES_HIGIENE_MAOS, CATEGORIAS_OBSERVADAS, MOMENTOS_HIGIENE_MAOS } from '@sgh/contratos';
import type { CategoriaObservada, MomentoHigieneMaos, AcaoHigieneMaos } from '@sgh/contratos';
import { parcela } from './denominadores.js';
import { msLocal } from '../nsp/prazos.js';
import { diferencaDias } from './tempo.js';

/** Retroativo máximo do registro de dispositivo e da observação (o que é mais antigo vai pela correção da CCIH). */
export const RETROATIVO_MAXIMO_DIAS = 30;

export type RecusaDispositivo =
  | 'instante-futuro'
  | 'muito-antigo'
  | 'antes-da-internacao'
  | 'dispositivo-ja-ativo'
  | 'ja-retirado'
  | 'antes-da-insercao';

/**
 * A inserção: não no futuro, não mais antiga que o retroativo, não antes da entrada da internação; um dispositivo ativo
 * por tipo por paciente (dois CVCs ao mesmo tempo contam um dispositivo-dia: o segundo é registrado como troca).
 */
export function conferirInsercao(e: {
  readonly tipo: TipoDispositivoInvasivo;
  readonly inseridoEm: string;
  readonly agora: string;
  readonly entrada: string;
  readonly ativos: readonly Pick<DispositivoInvasivoLido, 'tipo'>[];
}): RecusaDispositivo | null {
  if (msLocal(e.inseridoEm) > msLocal(e.agora)) return 'instante-futuro';
  if (diferencaDias(e.inseridoEm, e.agora) > RETROATIVO_MAXIMO_DIAS) return 'muito-antigo';
  if (diferencaDias(e.entrada, e.inseridoEm) < 0) return 'antes-da-internacao';
  return e.ativos.some((a) => a.tipo === e.tipo) ? 'dispositivo-ja-ativo' : null;
}

export function conferirRetirada(e: {
  readonly dispositivo: Pick<DispositivoInvasivoLido, 'inseridoEm' | 'retiradoEm'>;
  readonly retiradoEm: string;
  readonly agora: string;
}): RecusaDispositivo | null {
  if (e.dispositivo.retiradoEm !== null) return 'ja-retirado';
  if (msLocal(e.retiradoEm) > msLocal(e.agora)) return 'instante-futuro';
  return msLocal(e.retiradoEm) < msLocal(e.dispositivo.inseridoEm) ? 'antes-da-insercao' : null;
}

/** Retirada acidental (inclui a extubação não planejada) sugere a notificação ao NSP; quem decide é o usuário. */
export function sugereNotificacao(motivo: string): boolean {
  return motivo === 'acidental';
}

// ── Higiene das mãos ─────────────────────────────────────────────────────────────────────────────

export interface ObservacaoMaos {
  readonly categoria: CategoriaObservada;
  readonly oportunidades: readonly { readonly momento: MomentoHigieneMaos; readonly acao: AcaoHigieneMaos }[];
}

const conforme = (a: AcaoHigieneMaos) => ACOES_HIGIENE_MAOS.find((x) => x.codigo === a)?.conforme ?? false;

/** Conformes e oportunidades de uma sessão (o que a linha guarda). */
export function contarObservacao(o: ObservacaoMaos): { oportunidades: number; conformes: number } {
  return {
    oportunidades: o.oportunidades.length,
    conformes: o.oportunidades.filter((x) => conforme(x.acao)).length,
  };
}

/** Adesão (conformes ÷ oportunidades × 100) no total, por momento e por categoria, com as parcelas. */
export function adesaoHigieneMaos(observacoes: readonly ObservacaoMaos[]) {
  const ops = observacoes.flatMap((o) => o.oportunidades.map((x) => ({ ...x, categoria: o.categoria })));
  const taxa = (xs: typeof ops) => parcela(xs.filter((x) => conforme(x.acao)).length, xs.length, 100);
  return {
    total: taxa(ops),
    porMomento: MOMENTOS_HIGIENE_MAOS.map((m) => ({
      momento: m.codigo,
      ...taxa(ops.filter((x) => x.momento === m.codigo)),
    })),
    porCategoria: CATEGORIAS_OBSERVADAS.map((c) => ({
      categoria: c.codigo,
      ...taxa(ops.filter((x) => x.categoria === c.codigo)),
    })),
  };
}

/** Consumo de preparação alcoólica em mL por paciente-dia (OMS recomenda pelo menos 20 mL). */
export function consumoAlcoolPorPacienteDia(mililitros: number, pacientesDia: number) {
  return parcela(mililitros, pacientesDia, 1);
}

export function conferirObservacao(
  observadoEm: string,
  agora: string,
): 'instante-futuro' | 'muito-antigo' | null {
  if (msLocal(observadoEm) > msLocal(agora)) return 'instante-futuro';
  return diferencaDias(observadoEm, agora) > RETROATIVO_MAXIMO_DIAS ? 'muito-antigo' : null;
}

// ── Surto ────────────────────────────────────────────────────────────────────────────────────────

export type RecusaSurto = 'surto-encerrado' | 'encerramento-antes-do-inicio' | 'data-futura';

export function conferirSurto(e: {
  readonly atual: SituacaoSurto | null;
  readonly inicio: string;
  readonly encerradoEm: string | null;
  readonly hoje: string;
}): RecusaSurto | null {
  if (e.atual === 'encerrado') return 'surto-encerrado';
  if (
    diferencaDias(e.hoje, e.inicio) > 0 ||
    (e.encerradoEm !== null && diferencaDias(e.hoje, e.encerradoEm) > 0)
  )
    return 'data-futura';
  return e.encerradoEm !== null && diferencaDias(e.inicio, e.encerradoEm) < 0
    ? 'encerramento-antes-do-inicio'
    : null;
}
