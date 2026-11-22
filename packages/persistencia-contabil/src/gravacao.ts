// O núcleo comum da gravação contábil dentro da transação de uma operação do Executor (API e worker): o plano de
// contas vigente, o período travado (criado aberto quando falta), a situação do fato (condicionada à situação lida) e
// o lançamento com as partidas, idempotente pela chave. `concluir` confere, antes do commit, que todo fato marcado como
// contabilizado ganhou o lançamento automático e que nenhum fato que saiu de contabilizado ficou com um ativo.
import { createHash } from 'node:crypto';
import type { SituacaoFato } from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  garantirSequencia,
  jsonCanonico,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { bloqueioDoLancamento } from './bloqueio.js';
import {
  bool,
  chaveDoLancamento,
  corta,
  diaUm,
  ladoModelo,
  lista,
  num,
  numOuNulo,
  reais,
  SITUACAO_FATO_MODELO,
  SQL_PLANO,
  texto,
  textoOuNulo,
} from './consultas.js';
import type { LancamentoParaGravar, PedidoSituacaoFato } from './tipos.js';

/** O período contábil travado na transação. */
export interface PeriodoTravado {
  readonly id: number;
  readonly situacao: string;
  readonly versao: number;
  readonly bloqueadoAte: string | null;
}

export interface GravacaoDosFatos {
  /** O plano de contas vigente do estabelecimento; recusa `sem-plano`. */
  plano(): Promise<number>;
  /** Trava o período da competência; sem ele, cria aberto (criar) ou recusa `periodo-inexistente`. */
  travarPeriodo(competencia: string, criar: boolean): Promise<PeriodoTravado>;
  /** Recusa `outro-estabelecimento` quando a empresa não é o estabelecimento da transação. */
  exigirEmpresa(empresa: number): void;
  marcarSituacao(x: PedidoSituacaoFato): Promise<boolean>;
  gravarLancamento(l: LancamentoParaGravar): Promise<{ id: number; repetido: boolean }>;
  concluir(): Promise<void>;
}

/** As gravações comuns da contabilidade na transação `tx`, no estabelecimento `est`. */
export function gravacaoDosFatos(tx: TxOperacao, est: number): GravacaoDosFatos {
  const usuario = tx.contexto.usuario;
  /** Fatos marcados como contabilizados nesta transação à espera do lançamento automático. */
  const aguardamLancamento = new Map<number, { motivo: string | null; regraId: number | null }>();
  /** Fatos que saíram de contabilizado nesta transação (não podem terminar com lançamento automático ativo). */
  const saidosDeContabilizado = new Set<number>();
  const lancamentoAtivoDoFato = async (idFato: number) =>
    numOuNulo(
      (
        await tx.uma(
          `SELECT id FROM lancamento_contabil WHERE fato_contabil_id = ? AND estabelecimento_id = ? AND tipo = 'automatico'
             AND situacao = 'ativo' AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
          [idFato, est],
        )
      )?.['id'],
    );
  const exigirEmpresa = (empresa: number) => {
    if (empresa !== est)
      throw recusa('outro-estabelecimento', 'A empresa informada não é a do estabelecimento da sessão.');
  };
  const plano = async () => {
    const p = numOuNulo((await tx.uma(SQL_PLANO, [est]))?.['id']);
    if (p === null) throw recusa('sem-plano', 'O estabelecimento não tem plano de contas contábil vigente.');
    return p;
  };
  const travarPeriodo = async (competencia: string, criar: boolean) => {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, situacao, versao, DATE_FORMAT(bloqueado_ate, '%Y-%m-%d') AS bloqueado_ate FROM periodo_contabil
        WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL`,
      [est, diaUm(competencia)],
      { teto: 1 },
    );
    if (r)
      return {
        id: num(r['id']),
        situacao: texto(r['situacao']),
        versao: num(r['versao']),
        bloqueadoAte: textoOuNulo(r['bloqueado_ate']),
      };
    if (!criar)
      throw recusa(
        'periodo-inexistente',
        `A competência ${competencia} não tem movimento nem período aberto.`,
      );
    const id = await tx.incluir('periodo_contabil', {
      estabelecimento_id: est,
      competencia: diaUm(competencia),
      exercicio: Number(competencia.slice(0, 4)),
      plano_contas_id: await plano(),
      situacao: 'aberto',
    });
    return { id, situacao: 'aberto', versao: 1, bloqueadoAte: null as string | null };
  };
  const concluir = async () => {
    if (aguardamLancamento.size)
      throw recusa(
        'fato-sem-lancamento',
        'O fato não tem lançamento automático ativo para ser marcado como contabilizado.',
      );
    for (const idFato of saidosDeContabilizado)
      if ((await lancamentoAtivoDoFato(idFato)) !== null)
        throw recusa(
          'fato-com-lancamento',
          'O fato tem lançamento automático ativo: estorne-o antes de mudar a situação.',
        );
  };
  return {
    plano,
    travarPeriodo,
    exigirEmpresa,
    concluir,
    async marcarSituacao(x: PedidoSituacaoFato) {
      const atual = await tx.uma(
        'SELECT situacao FROM fato_contabil WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.idFato, est],
      );
      // O lançamento automático do fato: o já gravado, ou o que esta mesma transação gravar em seguida (Contabilizar
      // marca a situação condicionada à lida e só então lança; concluir() confere que o lançamento veio).
      const lancamento = x.situacao === 'contabilizado' ? await lancamentoAtivoDoFato(x.idFato) : null;
      const lida = x.situacaoLida ?? null;
      if (x.situacao === 'contabilizado' && lancamento === null) {
        // O banco exige o lançamento do fato contabilizado: aqui só trava o fato e confere a situação lida; a situação
        // muda quando gravarLancamento gravar o lançamento automático do fato (concluir() confere que veio).
        const n = await tx.executar(
          `UPDATE fato_contabil SET versao = versao + 1, alterado_em = ?, alterado_por = ?
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL${lida ? ' AND situacao = ?' : ''}`,
          [new Date(), usuario, x.idFato, est, ...(lida ? [SITUACAO_FATO_MODELO[lida]] : [])],
        );
        if (n > 0) aguardamLancamento.set(x.idFato, { motivo: corta(x.motivo, 500), regraId: x.regraId });
        return n > 0;
      }
      const n = await tx.executar(
        `UPDATE fato_contabil SET situacao = ?, motivo = ?, lancamento_contabil_id = ?, contabilizado_em = ?,
                versao_regra_contabil_id = ?, versao = versao + 1, alterado_em = ?, alterado_por = ?
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL${lida ? ' AND situacao = ?' : ''}`,
        [
          SITUACAO_FATO_MODELO[x.situacao],
          corta(x.motivo, 500),
          lancamento,
          lancamento === null ? null : new Date(),
          x.regraId,
          new Date(),
          usuario,
          x.idFato,
          est,
          ...(lida ? [SITUACAO_FATO_MODELO[lida]] : []),
        ],
      );
      if (n > 0 && x.situacao !== 'contabilizado' && atual?.['situacao'] === 'contabilizado')
        saidosDeContabilizado.add(x.idFato);
      return n > 0;
    },
    async gravarLancamento(l: LancamentoParaGravar) {
      exigirEmpresa(l.empresa);
      const chave = chaveDoLancamento(est, l.chave);
      const existente = await tx.uma('SELECT id FROM lancamento_contabil WHERE chave_idempotencia = ?', [
        chave,
      ]);
      if (existente) return { id: num(existente['id']), repetido: true };
      const periodo = await travarPeriodo(l.competencia, true);
      const bloqueio = bloqueioDoLancamento(periodo, l.data, l.competencia);
      if (bloqueio) throw recusa(bloqueio.codigo, bloqueio.mensagem);
      const p = await plano();
      const codigos = [...new Set(l.partidas.map((x) => x.conta))];
      const contas = new Map<string, number>();
      const semManual: string[] = [];
      for (const r of await tx.consultar(
        `SELECT id, classificacao, aceita_lancamento_manual FROM conta_contabil WHERE plano_contas_id = ? AND excluido_em IS NULL
            AND ativo = TRUE AND tipo = 'analitica' AND classificacao IN (${lista(codigos.length)})`,
        [p, ...codigos],
      )) {
        contas.set(texto(r['classificacao']), num(r['id']));
        if (!bool(r['aceita_lancamento_manual'])) semManual.push(texto(r['classificacao']));
      }
      const falta = codigos.filter((k) => !contas.has(k));
      if (falta.length)
        throw recusa(
          'conta-inexistente',
          `Conta sem cadastro analítico ativo no plano: ${falta.join(', ')}.`,
        );
      if (l.tipo === 'manual' && semManual.length)
        throw recusa(
          'conta-sem-lancamento-manual',
          `A conta não aceita lançamento manual: ${semManual.join(', ')}.`,
        );
      const debitos = l.partidas.filter((x) => x.lado === 'D').reduce((s, x) => s + x.valorCentavos, 0);
      const creditos = l.partidas.filter((x) => x.lado === 'C').reduce((s, x) => s + x.valorCentavos, 0);
      if (debitos !== creditos || debitos <= 0)
        throw recusa(
          'lancamento-desbalanceado',
          'A soma dos débitos tem de ser igual à dos créditos e maior que zero.',
        );
      const fato =
        l.fatoId === null
          ? null
          : await tx.uma(
              'SELECT entidade_origem, entidade_origem_id FROM fato_contabil WHERE id = ? AND estabelecimento_id = ?',
              [l.fatoId, est],
            );
      if (l.fatoId !== null && !fato)
        throw recusa('fato-inexistente', 'O fato de origem não existe neste estabelecimento.');
      if (l.estornaId !== null) {
        const [o] = await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao FROM lancamento_contabil WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [l.estornaId, est],
          { teto: 1 },
        );
        if (!o)
          throw recusa('lancamento-inexistente', 'O lançamento a estornar não existe neste estabelecimento.');
        if (o['situacao'] === 'estornado') throw recusa('ja-estornado', 'O lançamento já foi estornado.');
        await tx.alterar('lancamento_contabil', l.estornaId, num(o['versao']), {
          situacao: 'estornado',
          estornado_em: new Date(),
        });
      }
      await garantirSequencia(
        tx,
        { tipo: 'lancamento_contabil', estabelecimento: est },
        { usuario, agora: new Date() },
      );
      const numero = await tx.proximoNumero('lancamento_contabil');
      const id = await tx.incluir('lancamento_contabil', {
        estabelecimento_id: est,
        numero: numero.valor,
        periodo_contabil_id: periodo.id,
        data_lancamento: l.data,
        tipo: l.tipo,
        historico: l.historico.slice(0, 500),
        complemento: l.justificativa,
        valor_total: reais(debitos),
        fato_contabil_id: l.fatoId,
        entidade_origem: fato ? texto(fato['entidade_origem']) : null,
        entidade_origem_id: fato ? num(fato['entidade_origem_id']) : null,
        estornado_lancamento_contabil_id: l.estornaId,
        versao_regra_contabil_id: l.regraId,
        situacao: 'ativo',
        chave_idempotencia: chave,
      });
      for (const [i, x] of l.partidas.entries())
        await tx.incluir('partida_contabil', {
          lancamento_contabil_id: id,
          sequencia: i + 1,
          lado: ladoModelo(x.lado),
          conta_contabil_id: contas.get(x.conta),
          centro_custo_id: x.centroCusto,
          valor: reais(x.valorCentavos),
          complemento: corta(x.historico, 300),
        });
      if (l.fatoId !== null && l.tipo === 'automatico' && aguardamLancamento.has(l.fatoId)) {
        await tx.executar(
          `UPDATE fato_contabil SET situacao = 'contabilizado', motivo = ?, lancamento_contabil_id = ?, contabilizado_em = ?,
                  versao_regra_contabil_id = ?, alterado_em = ?, alterado_por = ?
            WHERE id = ? AND estabelecimento_id = ?`,
          [
            aguardamLancamento.get(l.fatoId)?.motivo ?? null,
            id,
            new Date(),
            aguardamLancamento.get(l.fatoId)?.regraId ?? l.regraId,
            new Date(),
            usuario,
            l.fatoId,
            est,
          ],
        );
        aguardamLancamento.delete(l.fatoId);
      }
      return { id, repetido: false };
    },
  };
}

/** Ação da contabilização a gravar (a forma de AcaoContabilizacao de @sgh/dominio-contabil). */
export type AcaoParaGravar =
  | {
      readonly acao: 'lancar';
      readonly idFato: number;
      readonly situacaoLida: SituacaoFato;
      readonly situacao: 'contabilizado';
      readonly regraId: number | null;
      readonly lancamento: LancamentoParaGravar;
    }
  | {
      readonly acao: 'marcar';
      readonly idFato: number;
      readonly situacaoLida: SituacaoFato;
      readonly situacao: SituacaoFato;
      readonly motivo: string | null;
      readonly regraId: number | null;
    };

export interface ResultadoDasAcoes {
  readonly lancamentos: number;
  readonly repetidos: number;
  /** Fatos que outra gravação mudou entre a leitura e esta (ficam como estão, sem lançamento). */
  readonly mudaram: number;
}

/**
 * Aplica as ações de um lote (D-CORRIDA-542): a situação primeiro, condicionada à lida; o fato que outra gravação
 * mudou fica como está, sem lançamento, e volta na próxima leitura.
 */
export async function aplicarAcoes(
  g: Pick<GravacaoDosFatos, 'marcarSituacao' | 'gravarLancamento'>,
  acoes: readonly AcaoParaGravar[],
): Promise<ResultadoDasAcoes> {
  let lancamentos = 0;
  let repetidos = 0;
  let mudaram = 0;
  for (const a of acoes) {
    const marcada = await g.marcarSituacao({
      idFato: a.idFato,
      situacao: a.situacao,
      motivo: a.acao === 'marcar' ? a.motivo : null,
      regraId: a.regraId,
      situacaoLida: a.situacaoLida,
    });
    if (!marcada) {
      mudaram++;
      continue;
    }
    if (a.acao === 'lancar') {
      const r = await g.gravarLancamento(a.lancamento);
      if (r.repetido) repetidos++;
      else lancamentos++;
    }
  }
  return { lancamentos, repetidos, mudaram };
}

/** Tabelas que a contabilização dos fatos grava. */
export const TABELAS_CONTABILIZACAO = [
  'fato_contabil',
  'lancamento_contabil',
  'partida_contabil',
  'periodo_contabil',
  'sequencia_negocio',
] as const;

/**
 * Grava um lote da contabilização automática pelo Executor do núcleo, numa transação com a trilha (contagens do lote,
 * nunca valores de pessoas). A chave idempotente é o hash do lote: o mesmo lote repetido devolve o resultado gravado.
 */
export async function gravarContabilizacao(
  executor: Pick<Executor, 'executar'>,
  contexto: ContextoNucleo & { readonly estabelecimento: number },
  acoes: readonly AcaoParaGravar[],
  diferenca: string,
): Promise<ResultadoDasAcoes> {
  const est = contexto.estabelecimento;
  const pedido = createHash('sha256')
    .update(jsonCanonico(acoes.map((a) => [a.idFato, a.situacaoLida, a.situacao, a.regraId])))
    .digest('hex');
  const op = definirOperacao({
    nome: 'contabil.contabilizar_fatos',
    tabelas: TABELAS_CONTABILIZACAO,
    entrada: z.object({ pedido: z.string().regex(/^[0-9a-f]{64}$/) }),
    async gravar(tx) {
      const g = gravacaoDosFatos(tx, est);
      const r = await aplicarAcoes(g, acoes);
      await g.concluir();
      return { lancamentos: r.lancamentos, repetidos: r.repetidos, mudaram: r.mudaram };
    },
    alvo: () => ({ tabela: 'lancamento_contabil', id: null }),
    trilha: () => ({ dados: { diferenca }, motivo: null }),
  });
  const r = await executor.executar(
    op,
    contexto.cliente,
    { pedido },
    {
      ...contexto,
      chaveIdempotencia: `contabil:${est}:${pedido.slice(0, 40)}`,
    },
  );
  const v = r.resultado;
  return { lancamentos: num(v['lancamentos']), repetidos: num(v['repetidos']), mudaram: num(v['mudaram']) };
}
