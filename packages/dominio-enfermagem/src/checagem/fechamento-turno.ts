// Fechamento da checagem do turno e leitura do produto e do lote na administração (03-PEP L113).
// Desenho próprio:
//   - o turno fecha com as pendências conhecidas: os horários resolvidos (administrado, não administrado com motivo,
//     suspenso) ficam travados no fechamento; os pendentes NÃO são travados (seguem para o próximo turno, que ainda pode
//     checar a dose atrasada) e, havendo algum, o fechamento exige a justificativa de quem fecha;
//   - o fechamento pode ser do setor inteiro ou de um só paciente (visão por paciente), e nunca é apagado: a correção é a
//     reabertura com motivo, que destrava os horários (o fechamento fica no histórico como "reaberto");
//   - a leitura à beira do leito liga a dose ao produto e ao lote do estoque, com o resultado da conferência; o que não
//     confere só segue com a justificativa de quem administra.

/** Situação do horário na checagem: P pendente, A administrado, p administrado em parte, N não administrado, S suspenso. */
export type LetraHorarioFechamento = 'P' | 'A' | 'p' | 'N' | 'S';

const RESOLVIDA = new Set(['A', 'p', 'N', 'S']);

export interface HorarioParaFechar {
  readonly id: number;
  readonly letra: string;
  /** O horário já está travado num fechamento ainda vigente (situação "fechado"). */
  readonly travado: boolean;
}

export interface ResumoFechamento {
  readonly total: number;
  readonly administrados: number;
  readonly naoAdministrados: number;
  readonly suspensos: number;
  /** Pendentes: ficam fora da trava e são listados para o próximo turno. */
  readonly pendentes: readonly number[];
  /** Os horários resolvidos que este fechamento trava. */
  readonly aTravar: readonly number[];
  readonly jaTravados: number;
}

export function resumirFechamento(horarios: readonly HorarioParaFechar[]): ResumoFechamento {
  let administrados = 0;
  let naoAdministrados = 0;
  let suspensos = 0;
  let jaTravados = 0;
  const pendentes: number[] = [];
  const aTravar: number[] = [];
  for (const h of horarios) {
    if (h.letra === 'A' || h.letra === 'p') administrados++;
    else if (h.letra === 'N') naoAdministrados++;
    else if (h.letra === 'S') suspensos++;
    if (h.travado) {
      jaTravados++;
      continue;
    }
    if (RESOLVIDA.has(h.letra)) aTravar.push(h.id);
    else pendentes.push(h.id);
  }
  return {
    total: horarios.length,
    administrados,
    naoAdministrados,
    suspensos,
    pendentes,
    aTravar,
    jaTravados,
  };
}

export const JUSTIFICATIVA_MINIMA = 10;

export type RecusaFechamento =
  | { readonly codigo: 'turno-sem-horarios'; readonly mensagem: string }
  | { readonly codigo: 'turno-ja-fechado'; readonly mensagem: string }
  | { readonly codigo: 'pendencias-sem-justificativa'; readonly mensagem: string };

/** Confere se o turno pode fechar: nulo quando pode; senão, a recusa com a mensagem da tela. */
export function conferirFechamento(
  r: ResumoFechamento,
  justificativa: string | null,
): RecusaFechamento | null {
  if (r.total === 0)
    return { codigo: 'turno-sem-horarios', mensagem: 'Não há horários neste turno para fechar.' };
  if (r.aTravar.length === 0 && r.pendentes.length === 0)
    return { codigo: 'turno-ja-fechado', mensagem: 'Os horários deste turno já estão fechados.' };
  if (r.aTravar.length === 0)
    return {
      codigo: 'turno-sem-horarios',
      mensagem: 'Nenhum horário resolvido para fechar: checar ou registrar o não administrado antes.',
    };
  if (r.pendentes.length > 0 && (justificativa ?? '').trim().length < JUSTIFICATIVA_MINIMA)
    return {
      codigo: 'pendencias-sem-justificativa',
      mensagem: `Há ${r.pendentes.length} horário(s) pendente(s): justifique o fechamento com as pendências (mínimo de ${JUSTIFICATIVA_MINIMA} caracteres).`,
    };
  return null;
}

/** Confere a reabertura: só o fechamento vigente, sempre com o motivo. */
export function conferirReabertura(situacao: string, motivo: string | null): string | null {
  if (situacao !== 'fechado') return 'O fechamento já foi reaberto.';
  if ((motivo ?? '').trim().length < JUSTIFICATIVA_MINIMA)
    return `Informe o motivo da reabertura (mínimo de ${JUSTIFICATIVA_MINIMA} caracteres).`;
  return null;
}

export type ResultadoLeituraLote =
  'conforme' | 'produto_divergente' | 'lote_vencido' | 'lote_bloqueado' | 'nao_identificado';

export interface LeituraLote {
  /** Insumo achado pelo código do produto lido (GTIN), quando houve leitura. */
  readonly insumoDoCodigo: number | null;
  /** O lote do estoque achado pelo número lido. */
  readonly lote: { readonly insumo: number; readonly validade: string; readonly situacao: string } | null;
  /** Validade lida na etiqueta (AAAA-MM-DD), quando houve. */
  readonly validadeLida: string | null;
  /** Data (AAAA-MM-DD) da administração. */
  readonly dataAdministracao: string;
}

/** O resultado da conferência do produto e do lote lidos à beira do leito. */
export function resultadoLeituraLote(l: LeituraLote): ResultadoLeituraLote {
  if (l.insumoDoCodigo === null && l.lote === null) return 'nao_identificado';
  if (l.insumoDoCodigo !== null && l.lote !== null && l.lote.insumo !== l.insumoDoCodigo)
    return 'produto_divergente';
  if (l.lote && l.lote.situacao === 'vencido') return 'lote_vencido';
  if (l.lote && l.lote.situacao !== 'liberado') return 'lote_bloqueado';
  const validade = l.lote?.validade ?? l.validadeLida;
  if (validade !== null && validade < l.dataAdministracao) return 'lote_vencido';
  return 'conforme';
}

/** A justificativa de seguir com a leitura que não confere: nula quando confere; senão o texto, ou a recusa. */
export function justificativaDaLeitura(
  resultado: ResultadoLeituraLote,
  texto: string | null,
): { readonly justificativa: string | null } | { readonly recusa: string } {
  if (resultado === 'conforme') return { justificativa: null };
  const t = (texto ?? '').trim();
  if (t.length < JUSTIFICATIVA_MINIMA)
    return {
      recusa: `A leitura do produto ou do lote não confere (${resultado.replace('_', ' ')}): registre na observação por que a dose segue.`,
    };
  return { justificativa: t.slice(0, 500) };
}
