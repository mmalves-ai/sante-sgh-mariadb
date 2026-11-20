// Alergias e reações adversas (ficha do M23, regra 4; cap-05b §5.6): por agente, reação, gravidade e origem da
// informação (CBARA); "nega alergias" é registro explícito; a alergia ativa vale para o cabeçalho e é exposta à
// prescrição (M24); a superada fica no histórico (nada se apaga). No banco do estabelecimento a alergia nasce DENTRO
// de um registro clínico (PRALERGIAPAC.ID_PRCABEVOL, só agente, observação e a marca de retirada); reação,
// gravidade, origem e o "nega alergias" ficam no novo (o legado não tem a coluna nem um agente de negação).
import { sha256Hex } from '@sgh/contratos';
import type { GravidadeAlergia, OrigemAlergia, SituacaoAlergias } from '@sgh/contratos';

export interface AlergiaLida {
  readonly id: number;
  readonly agenteId: number;
  readonly agente: string;
  readonly ativa: boolean;
  /** Registro clínico (data do lançamento, ISO) em que a alergia foi informada. */
  readonly registradaEm: string | null;
}

export interface NegaLida {
  readonly em: string;
}

/**
 * Situação para o cabeçalho (três estados do componente do cabeçalho): com alergia ativa, "lista"; senão, "nega"
 * quando o último registro de negação é posterior à última alergia retirada ou registrada; senão "não avaliadas".
 */
export function situacaoDasAlergias(
  alergias: readonly AlergiaLida[],
  negas: readonly NegaLida[],
): SituacaoAlergias {
  if (alergias.some((a) => a.ativa)) return 'lista';
  if (negas.length === 0) return 'nao-avaliadas';
  const ultimaNega =
    negas
      .map((n) => n.em)
      .sort()
      .at(-1) ?? '';
  const ultimaAlergia = alergias
    .map((a) => a.registradaEm ?? '')
    .sort()
    .at(-1);
  return !ultimaAlergia || ultimaNega >= ultimaAlergia ? 'nega' : 'nao-avaliadas';
}

/**
 * Situação para as linhas de lista (painel do M23 e fila do médico do M27), que só leem o resumo por paciente: o
 * número de alergias ativas, a data da última alergia informada (ativa ou retirada) e a do último "nega alergias".
 * Mesma regra de `situacaoDasAlergias`.
 */
export function situacaoDasAlergiasDoResumo(
  ativas: number,
  ultimaAlergia: string | undefined,
  ultimaNega: string | undefined,
): SituacaoAlergias {
  if (ativas > 0) return 'lista';
  return situacaoDasAlergias(
    ultimaAlergia ? [{ id: 0, agenteId: 0, agente: '', ativa: false, registradaEm: ultimaAlergia }] : [],
    ultimaNega ? [{ em: ultimaNega }] : [],
  );
}

/** Versão da lista ativa lida pela tela (controle otimista): os IDs ativos em ordem. */
export function versaoDasAlergias(alergias: readonly Pick<AlergiaLida, 'id' | 'ativa'>[]): string {
  return alergias
    .filter((a) => a.ativa)
    .map((a) => a.id)
    .sort((x, y) => x - y)
    .join(',');
}

export interface PedidoAlergia {
  readonly nega: boolean;
  readonly agente?: number | undefined;
  readonly gravidade?: GravidadeAlergia | undefined;
  readonly origem?: OrigemAlergia | undefined;
}

export interface ConferenciaAlergia {
  readonly ok: boolean;
  readonly codigo: 'duplicada' | 'nega-com-ativa' | 'agente-inativo' | null;
  readonly motivo: string | null;
}

/**
 * Condições da inclusão (ficha, seção 5): agente não duplicado ativo para o paciente; "nega alergias" só sem alergia
 * ativa (a tela pede para retirar antes); agente inativo no catálogo recusado.
 */
export function conferirNovaAlergia(
  p: PedidoAlergia,
  ativas: readonly AlergiaLida[],
  agentesAtivos: ReadonlySet<number>,
): ConferenciaAlergia {
  if (p.nega) {
    return ativas.some((a) => a.ativa)
      ? {
          ok: false,
          codigo: 'nega-com-ativa',
          motivo: 'Há alergia ativa: retire-a da lista antes de registrar que o paciente nega alergias.',
        }
      : { ok: true, codigo: null, motivo: null };
  }
  if (p.agente === undefined || !agentesAtivos.has(p.agente))
    return { ok: false, codigo: 'agente-inativo', motivo: 'Agente inativo ou fora do catálogo de alergias.' };
  if (ativas.some((a) => a.ativa && a.agenteId === p.agente))
    return { ok: false, codigo: 'duplicada', motivo: 'Este agente já está na lista de alergias ativas.' };
  return { ok: true, codigo: null, motivo: null };
}

/** Agentes das alergias ativas, para a prescrição (M24: alergia ativa bloqueia o item). */
export function agentesAtivos(alergias: readonly AlergiaLida[]): number[] {
  return [...new Set(alergias.filter((a) => a.ativa).map((a) => a.agenteId))].sort((a, b) => a - b);
}

/** Hash do conteúdo da alergia registrada pelo novo (prova em SGH_PEP_DOCUMENTO). */
export function hashDaAlergia(c: {
  readonly paciente: number;
  readonly registro: number;
  readonly nega: boolean;
  readonly agente: number | null;
  readonly principios: readonly number[];
  readonly reacao: string | null;
  readonly gravidade: string | null;
  readonly origem: string | null;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      ...c,
      principios: [...c.principios].sort((a, b) => a - b),
    }),
  );
}
