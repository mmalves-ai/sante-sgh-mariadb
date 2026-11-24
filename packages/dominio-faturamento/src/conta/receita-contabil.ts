// F3.7 (06-FAT linha 37): o evento contábil da receita faturada, glosada e recuperada, a partir do fato do faturamento
// e da regra de conta contábil da receita (por fonte pagadora, tipo de conta, tipo de lançamento, grupo, subgrupo, item
// faturável, setor e componente). A regra vale para o fechamento da conta (receita), a reabertura (estorno), a glosa
// registrada ou em recurso, a glosa aceita (perda definitiva, conta própria), o recurso acatado e o desconto concedido
// (dedução). Um fato sem regra aplicável, sem data de referência válida ou com a conta contábil que o tipo de ação exige
// em branco vira pendência com o motivo, nunca lançamento pela metade.
// Apuração idempotente: o evento leva a chave do fato (gravada em lancamento_contabil_receita.chave_fato, única entre os
// vivos do estabelecimento, migração 12_FAT/95_receita_chave_fato). O estorno tem UM caminho só: o fato 'reabertura' (com a sua própria
// chave). A diferença nunca estorna: o evento já contabilizado não é cancelado nem reapurado; se o apurado de hoje
// diverge dele, a divergência volta para o faturista e a correção vem pelo fato de reabertura. Assim, reabrir uma conta
// contabilizada gera um único estorno. A chave do fechamento leva o ciclo de fechamento da conta (o refechamento depois
// de uma reabertura é outro fato, com outra chave).

export type FatoReceita =
  | 'fechamento' // receita reconhecida no fechamento da conta
  | 'reabertura' // a conta reaberta estorna a receita reconhecida
  | 'glosa' // a fonte pagadora não pagou o item (glosa registrada, em recurso)
  | 'glosa_aceita' // o hospital aceitou a glosa: perda definitiva, em conta própria
  | 'recurso_acatado' // a glosa revertida no recurso
  | 'desconto'; // desconto concedido sobre a receita reconhecida (dedução)

export type TipoAcaoReceita = 'receita' | 'estorno' | 'glosa' | 'recurso' | 'desconto';

export interface RegraContaReceita {
  readonly id: number;
  readonly ativo: boolean;
  readonly prioridade: number;
  readonly fontePagadoraId: number | null;
  readonly tipoContaId: number | null;
  readonly tipoLancamentoId: number | null;
  readonly grupoFaturamentoId: number | null;
  readonly subgrupoFaturamentoId: number | null;
  readonly itemFaturavelId: number | null;
  readonly setorFuncionalId: number | null;
  readonly componente: string;
  readonly contaReceitaId: number;
  /** Receita prevista (competência antes do faturamento); lida da regra, ainda sem fato que a use. */
  readonly contaReceitaPrevistaId: number | null;
  readonly contaGlosaId: number | null;
  readonly contaGlosaAceitaId: number | null;
  readonly contaRecuperacaoGlosaId: number | null;
  readonly contaDeducaoId: number | null;
  readonly contaTransitoriaClienteId: number | null;
}

export interface FatoFaturamento {
  readonly fato: FatoReceita;
  /** Chave estável do fato (ex.: "conta:12:ciclo:1:item:40:fechamento"), para a apuração não duplicar. */
  readonly chave: string;
  /** Competência da receita (AAAA-MM-DD), gravada em data_referencia. */
  readonly dataReferencia: string;
  readonly valor: number;
  readonly fontePagadoraId: number;
  readonly tipoContaId: number | null;
  readonly tipoLancamentoId: number | null;
  readonly grupoFaturamentoId: number | null;
  readonly subgrupoFaturamentoId: number | null;
  readonly itemFaturavelId: number | null;
  readonly setorFuncionalId: number | null;
  readonly componente: string | null;
}

export interface EventoReceita {
  readonly chave: string;
  readonly dataReferencia: string;
  readonly tipoAcao: TipoAcaoReceita;
  readonly debitoContaContabilId: number;
  readonly creditoContaContabilId: number;
  readonly valor: number;
  readonly regraId: number;
}
export interface PendenciaReceita {
  readonly chave: string;
  readonly motivo: string;
}

function dataValida(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
const casa = (r: number | null, f: number | null) => r === null || r === f;
const especificidade = (r: RegraContaReceita) =>
  [
    r.fontePagadoraId,
    r.tipoContaId,
    r.tipoLancamentoId,
    r.grupoFaturamentoId,
    r.subgrupoFaturamentoId,
    r.itemFaturavelId,
    r.setorFuncionalId,
  ].filter((v) => v !== null).length + (r.componente !== 'todos' ? 1 : 0);

/** A regra que vale para o fato: a ativa que casa, de menor prioridade e, no empate, a mais específica. */
export function regraDoFatoReceita(
  regras: readonly RegraContaReceita[],
  f: FatoFaturamento,
): RegraContaReceita | null {
  const validas = regras.filter(
    (r) =>
      r.ativo &&
      casa(r.fontePagadoraId, f.fontePagadoraId) &&
      casa(r.tipoContaId, f.tipoContaId) &&
      casa(r.tipoLancamentoId, f.tipoLancamentoId) &&
      casa(r.grupoFaturamentoId, f.grupoFaturamentoId) &&
      casa(r.subgrupoFaturamentoId, f.subgrupoFaturamentoId) &&
      casa(r.itemFaturavelId, f.itemFaturavelId) &&
      casa(r.setorFuncionalId, f.setorFuncionalId) &&
      (r.componente === 'todos' || r.componente === f.componente),
  );
  validas.sort((a, b) => a.prioridade - b.prioridade || especificidade(b) - especificidade(a) || a.id - b.id);
  return validas[0] ?? null;
}

/** Débito e crédito de cada fato pela regra (a conta transitória do cliente é o "a receber" da fonte pagadora). */
export function eventoDoFato(
  regras: readonly RegraContaReceita[],
  f: FatoFaturamento,
): EventoReceita | PendenciaReceita {
  if (!(Math.round(f.valor * 100) > 0)) return { chave: f.chave, motivo: 'valor zero ou negativo' };
  if (!dataValida(f.dataReferencia)) return { chave: f.chave, motivo: 'fato sem data de referência válida' };
  if (!f.chave.trim() || f.chave.length > 150)
    return { chave: f.chave, motivo: 'fato sem chave estável (até 150 caracteres)' };
  const r = regraDoFatoReceita(regras, f);
  if (!r) return { chave: f.chave, motivo: 'nenhuma regra de conta contábil da receita casa com o fato' };
  const aReceber = r.contaTransitoriaClienteId;
  const par = (
    tipoAcao: TipoAcaoReceita,
    debito: number | null,
    credito: number | null,
    falta: string,
  ): EventoReceita | PendenciaReceita =>
    debito === null || credito === null
      ? { chave: f.chave, motivo: `a regra ${r.id} não tem ${falta}` }
      : debito === credito
        ? { chave: f.chave, motivo: `a regra ${r.id} tem a mesma conta no débito e no crédito` }
        : {
            chave: f.chave,
            dataReferencia: f.dataReferencia,
            tipoAcao,
            debitoContaContabilId: debito,
            creditoContaContabilId: credito,
            valor: Math.round(f.valor * 100) / 100,
            regraId: r.id,
          };
  switch (f.fato) {
    case 'fechamento':
      return par('receita', aReceber, r.contaReceitaId, 'a conta a receber da fonte pagadora');
    case 'reabertura':
      return par('estorno', r.contaReceitaId, aReceber, 'a conta a receber da fonte pagadora');
    case 'glosa':
      return par('glosa', r.contaGlosaId, aReceber, 'a conta de glosa ou a conta a receber');
    case 'glosa_aceita':
      return par('glosa', r.contaGlosaAceitaId, aReceber, 'a conta de glosa aceita ou a conta a receber');
    case 'desconto':
      return par('desconto', r.contaDeducaoId, aReceber, 'a conta de dedução ou a conta a receber');
    case 'recurso_acatado':
      return par(
        'recurso',
        aReceber,
        r.contaRecuperacaoGlosaId,
        'a conta de recuperação de glosa ou a conta a receber',
      );
  }
}

export interface EventoGravado extends EventoReceita {
  readonly id: number;
  readonly situacao: 'pendente' | 'contabilizado' | 'cancelado';
}

/** Divergência entre o evento já contabilizado e o apurado agora: volta para o faturista, nunca vira estorno sozinho. */
export interface DivergenciaReceita {
  readonly gravado: EventoGravado;
  readonly apurado: EventoReceita;
}

/**
 * Apuração idempotente: o que incluir e o que cancelar, comparando os eventos gravados com os apurados agora.
 * - igual ao gravado vivo: nada;
 * - pendente diferente ou que deixou de ser apurado: cancela (e inclui o novo, se houver);
 * - contabilizado: fica como está. Se o apurado diverge, vai para `divergentes` (a correção vem pelo fato
 *   'reabertura', o único caminho do estorno); se deixou de ser apurado, nada (a reabertura já tem a sua chave).
 */
export function diferencaEventosReceita(
  gravados: readonly EventoGravado[],
  apurados: readonly EventoReceita[],
): { incluir: EventoReceita[]; cancelar: number[]; divergentes: DivergenciaReceita[] } {
  const igual = (a: EventoReceita, b: EventoReceita) =>
    a.tipoAcao === b.tipoAcao &&
    a.dataReferencia === b.dataReferencia &&
    a.debitoContaContabilId === b.debitoContaContabilId &&
    a.creditoContaContabilId === b.creditoContaContabilId &&
    Math.round(a.valor * 100) === Math.round(b.valor * 100);
  const vivos = gravados.filter((g) => g.situacao !== 'cancelado');
  const porChave = new Map(apurados.map((a) => [a.chave, a]));
  const contabilizados = new Set(vivos.filter((g) => g.situacao === 'contabilizado').map((g) => g.chave));
  const incluir: EventoReceita[] = [];
  const cancelar: number[] = [];
  const divergentes: DivergenciaReceita[] = [];
  for (const g of vivos) {
    const a = porChave.get(g.chave);
    if (a && igual(a, g)) continue;
    if (g.situacao === 'pendente') cancelar.push(g.id);
    else if (a) divergentes.push({ gravado: g, apurado: a });
  }
  for (const a of apurados) {
    if (contabilizados.has(a.chave)) continue;
    if (!vivos.some((g) => g.chave === a.chave && igual(a, g))) incluir.push(a);
  }
  return { incluir, cancelar, divergentes };
}
