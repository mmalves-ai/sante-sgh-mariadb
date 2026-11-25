// F3.7 (06-FAT linha 12): a conta parcial por período usada no faturamento, sobre o banco próprio.
// - Leitura: cada período com os itens que caem nele (pela data em que foram realizados), o valor, as guias TISS e a
//   competência; o que ficou sem período e o total por competência. A regra é do domínio (conta/periodos-conta.ts).
// - Fechamento parcial por faixa (faturamento.fechar-periodo-conta): marca fechado_em/fechado_por; o período fechado
//   não aceita lançamento com data na faixa (conferirLancamentoNoPeriodo, chamado no lançamento do item) nem é retirado.
// - Reabertura (faturamento.reabrir-periodo-conta): com motivo na trilha, do último para o primeiro e sem guia do
//   período num lote TISS. Nada se apaga; sem gatilho.
import {
  type ItemDoPeriodo,
  type PeriodoFaixa,
  periodoFechadoDoLancamento,
  resumoPorPeriodo,
  validarFechamentoPeriodo,
  validarReaberturaPeriodo,
  contaEditavel,
} from '@sgh/dominio-faturamento';
import { type ContextoOperacao, definirOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';
import { dataHora } from './conta-complementos-propria.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

async function contaDa(l: Consulta, est: number, conta: number) {
  const r = await l.uma<Linha>(
    'SELECT id, situacao FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [conta, est],
  );
  if (!r)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return { id: n(r['id']), situacao: String(r['situacao']) };
}

export interface PeriodoFaixaLido extends PeriodoFaixa {
  sequencia: number;
  tipoLancamento: string | null;
  fechadoEm: string | null;
  versao: number;
}

async function periodosDa(l: Consulta, conta: number): Promise<PeriodoFaixaLido[]> {
  const ls = await l.consultar<Linha>(
    `SELECT p.id, p.sequencia, p.inicio_em, p.fim_em, p.competencia, p.tipo_lancamento_id, p.fechado_em, p.versao,
            t.descricao AS tipo_lancamento
       FROM conta_hospitalar_periodo p LEFT JOIN tipo_lancamento t ON t.id = p.tipo_lancamento_id
      WHERE p.conta_hospitalar_id = ? AND p.excluido_em IS NULL ORDER BY p.inicio_em, p.sequencia`,
    [conta],
  );
  return ls.map((r) => ({
    id: n(r['id']),
    sequencia: n(r['sequencia']),
    inicio: dataHora(r['inicio_em']) ?? '',
    fim: dataHora(r['fim_em']) ?? '',
    competencia: (dataHora(r['competencia']) ?? '').slice(0, 10),
    tipoLancamentoId: nn(r['tipo_lancamento_id']),
    tipoLancamento: txn(r['tipo_lancamento']),
    fechado: r['fechado_em'] !== null && r['fechado_em'] !== undefined,
    fechadoEm: dataHora(r['fechado_em']),
    versao: n(r['versao']),
  }));
}

async function itensDa(l: Consulta, conta: number): Promise<ItemDoPeriodo[]> {
  const ls = await l.consultar<Linha>(
    `SELECT id, realizado_em, tipo_lancamento_id, valor_total, guia_tiss_id, situacao
       FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL`,
    [conta],
  );
  return ls.map((r) => ({
    id: n(r['id']),
    realizadoEm: dataHora(r['realizado_em']) ?? '',
    tipoLancamentoId: nn(r['tipo_lancamento_id']),
    valorTotal: n(r['valor_total']),
    guiaTissId: nn(r['guia_tiss_id']),
    situacao: String(r['situacao']),
  }));
}

/** Os períodos da conta com itens, valor, guias e competência; o que ficou sem período; o total por competência. */
export async function faturamentoPorPeriodoPropria(l: Leitor, est: number, conta: number) {
  const c = await contaDa(l, est, conta);
  const periodos = await periodosDa(l, c.id);
  const r = resumoPorPeriodo(periodos, await itensDa(l, c.id));
  const porId = new Map(r.periodos.map((x) => [x.periodoId, x]));
  return {
    contaId: c.id,
    situacao: c.situacao,
    editavel: contaEditavel(c.situacao),
    periodos: periodos.map((p) => {
      const x = porId.get(p.id)!;
      return { ...p, itens: x.itens, valor: x.valor, guias: x.guias };
    }),
    semPeriodo: r.semPeriodo,
    porCompetencia: r.porCompetencia,
  };
}

/** Recusa o lançamento cuja data cai num período fechado da conta (chamado sob a transação do lançamento). */
export async function conferirLancamentoNoPeriodo(
  tx: Consulta,
  conta: number,
  realizado: Date,
  tipoLancamentoId: number | null,
): Promise<void> {
  // A data volta do banco no mesmo formato dos períodos (relógio do hospital), para a regra comparar igual.
  const r = await tx.uma<Linha>('SELECT CAST(? AS DATETIME(3)) AS r', [realizado]);
  const p = periodoFechadoDoLancamento(await periodosDa(tx, conta), {
    realizadoEm: dataHora(r?.['r']) ?? '',
    tipoLancamentoId,
  });
  if (p)
    throw recusa(
      'periodo-fechado',
      `A data cai no período ${p.inicio.slice(0, 10)} a ${p.fim.slice(0, 10)}, já fechado: reabra o período para lançar.`,
      { campos: ['data'] },
    );
}

const id = z.number().int().positive();
const versao = z.number().int().positive();

async function periodoDaOperacao(tx: Consulta, est: number, periodoId: number) {
  const p = await tx.uma<Linha>(
    'SELECT conta_hospitalar_id FROM conta_hospitalar_periodo WHERE id = ? AND excluido_em IS NULL',
    [periodoId],
  );
  if (!p) throw recusa('nao-encontrado', 'O período não existe.', { campos: ['id'] });
  const c = await contaDa(tx, est, n(p['conta_hospitalar_id']));
  const periodos = await periodosDa(tx, c.id);
  return { c, periodos, periodo: periodos.find((x) => x.id === periodoId)! };
}

export const esquemaFecharPeriodo = z.object({ id, versao });
export const opFecharPeriodo = definirOperacao({
  nome: 'faturamento.fechar-periodo-conta',
  tabelas: ['conta_hospitalar_periodo'],
  entrada: esquemaFecharPeriodo,
  async gravar(tx, e, ctx) {
    const { c, periodos, periodo } = await periodoDaOperacao(tx, estDe(ctx), e.id);
    // Trava a conta contra fechamento e lançamento simultâneos.
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c.id]);
    const r = resumoPorPeriodo(periodos, await itensDa(tx, c.id));
    const doPeriodo = r.periodos.find((x) => x.periodoId === periodo.id)!;
    exigirValido(validarFechamentoPeriodo(c, periodo, periodos, doPeriodo.itens));
    await tx.alterar('conta_hospitalar_periodo', e.id, e.versao, {
      fechado_em: new Date(),
      fechado_por: ctx.usuario,
    });
    return {
      id: e.id,
      competencia: periodo.competencia,
      itens: doPeriodo.itens,
      valor: doPeriodo.valor,
      guias: doPeriodo.guias.join(','),
    };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar_periodo', id: e.id }),
});

export const esquemaReabrirPeriodo = z.object({
  id,
  versao,
  motivo: z.string().trim().min(5, 'Informe o motivo (ao menos 5 letras).').max(300),
});
export const opReabrirPeriodo = definirOperacao({
  nome: 'faturamento.reabrir-periodo-conta',
  tabelas: ['conta_hospitalar_periodo'],
  entrada: esquemaReabrirPeriodo,
  async gravar(tx, e, ctx) {
    const { c, periodos, periodo } = await periodoDaOperacao(tx, estDe(ctx), e.id);
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c.id]);
    const r = resumoPorPeriodo(periodos, await itensDa(tx, c.id));
    const guias = r.periodos.find((x) => x.periodoId === periodo.id)!.guias;
    const emLote = guias.length
      ? n(
          (
            await tx.uma<Linha>(
              `SELECT COUNT(*) AS q FROM lote_tiss_conta
                WHERE guia_tiss_id IN (${guias.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
              guias,
            )
          )?.['q'],
        )
      : 0;
    exigirValido(validarReaberturaPeriodo(c, periodo, periodos, emLote, e.motivo));
    await tx.alterar('conta_hospitalar_periodo', e.id, e.versao, { fechado_em: null, fechado_por: null });
    return { id: e.id };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar_periodo', id: e.id }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const OPERACOES_PERIODOS = {
  'periodo.fechar': opFecharPeriodo,
  'periodo.reabrir': opReabrirPeriodo,
} as const;
export type NomeOperacaoPeriodos = keyof typeof OPERACOES_PERIODOS;

export async function gravarPeriodos(
  executor: Executor,
  nome: NomeOperacaoPeriodos,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_PERIODOS[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
