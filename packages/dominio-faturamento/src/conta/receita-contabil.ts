// F3.7 (06-FAT linha 37): o evento contábil da receita faturada, glosada e recuperada, a partir do fato do faturamento
// e da regra de conta contábil da receita (por fonte pagadora, tipo de conta, tipo de lançamento, grupo e componente).
// A regra vale para o fechamento da conta (receita), a reabertura (estorno), a glosa e o recurso acatado. Um fato sem
// regra aplicável, ou com a conta contábil que o tipo de ação exige em branco, vira pendência com o motivo, nunca
// lançamento pela metade. A apuração é idempotente: o evento leva uma chave do fato e a diferença diz o que incluir e o
// que cancelar (o evento já contabilizado não é cancelado: o ajuste vai como estorno).

export type FatoReceita =
  | 'fechamento' // receita reconhecida no fechamento da conta
  | 'reabertura' // a conta reaberta estorna a receita reconhecida
  | 'glosa' // a fonte pagadora não pagou o item
  | 'recurso_acatado'; // a glosa revertida no recurso

export type TipoAcaoReceita = 'receita' | 'estorno' | 'glosa' | 'recurso';

export interface RegraContaReceita {
  readonly id: number;
  readonly ativo: boolean;
  readonly prioridade: number;
  readonly fontePagadoraId: number | null;
  readonly tipoContaId: number | null;
  readonly tipoLancamentoId: number | null;
  readonly grupoFaturamentoId: number | null;
  readonly componente: string;
  readonly contaReceitaId: number;
  readonly contaGlosaId: number | null;
  readonly contaRecuperacaoGlosaId: number | null;
  readonly contaTransitoriaClienteId: number | null;
}

export interface FatoFaturamento {
  readonly fato: FatoReceita;
  /** Chave estável do fato (ex.: "conta:12:item:40:fechamento"), para a apuração não duplicar. */
  readonly chave: string;
  readonly valor: number;
  readonly fontePagadoraId: number;
  readonly tipoContaId: number | null;
  readonly tipoLancamentoId: number | null;
  readonly grupoFaturamentoId: number | null;
  readonly componente: string | null;
}

export interface EventoReceita {
  readonly chave: string;
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

const casa = (r: number | null, f: number | null) => r === null || r === f;
const especificidade = (r: RegraContaReceita) =>
  [r.fontePagadoraId, r.tipoContaId, r.tipoLancamentoId, r.grupoFaturamentoId].filter((v) => v !== null)
    .length + (r.componente !== 'todos' ? 1 : 0);

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

/** Apuração idempotente: o que incluir e o que cancelar, comparando os eventos gravados com os apurados agora. */
export function diferencaEventosReceita(
  gravados: readonly EventoGravado[],
  apurados: readonly EventoReceita[],
): { incluir: EventoReceita[]; cancelar: number[]; estornar: EventoGravado[] } {
  const igual = (a: EventoReceita, b: EventoReceita) =>
    a.tipoAcao === b.tipoAcao &&
    a.debitoContaContabilId === b.debitoContaContabilId &&
    a.creditoContaContabilId === b.creditoContaContabilId &&
    Math.round(a.valor * 100) === Math.round(b.valor * 100);
  const vivos = gravados.filter((g) => g.situacao !== 'cancelado');
  const porChave = new Map(apurados.map((a) => [a.chave, a]));
  const incluir: EventoReceita[] = [];
  const cancelar: number[] = [];
  const estornar: EventoGravado[] = [];
  for (const g of vivos) {
    const a = porChave.get(g.chave);
    if (a && igual(a, g)) continue;
    if (g.situacao === 'pendente') cancelar.push(g.id);
    else estornar.push(g);
  }
  for (const a of apurados) {
    if (!vivos.some((g) => g.chave === a.chave && igual(a, g))) incluir.push(a);
  }
  return { incluir, cancelar, estornar };
}
