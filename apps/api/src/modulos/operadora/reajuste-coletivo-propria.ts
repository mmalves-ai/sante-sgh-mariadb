// Porta própria do reajuste da operadora além do anual digitado (08-SGO L96, C1-086; F7) sobre o banco do cliente:
// - o índice de reajuste com vigência (indice_reajuste_plano): o teto anual da ANS do individual, que a conferência do
//   reajuste anual usa sem o teto digitado, e os índices econômicos ou próprios;
// - a regra de reajuste por sinistralidade da operadora (regra_reajuste_sinistralidade e as faixas);
// - o agrupamento dos contratos coletivos pequenos (agrupamento_reajuste_coletivo e agrupamento_reajuste_contrato,
//   RN ANS 565/2022): os contratos elegíveis entram de uma vez, o percentual único sai da regra sobre o resultado somado
//   do grupo (ou é informado com a memória de cálculo) e é aplicado no aniversário de cada contrato;
// - o reajuste do coletivo grande pela regra, com a sinistralidade apurada do próprio contrato.
// A regra vem do domínio (reajuste-coletivo.ts e conferirReajuste); o banco só guarda. Nada é apagado: o agrupamento é
// cancelado pela situação, o reajuste gerado é cancelado pela rota do reajuste. Cada gravação é uma operação do Executor
// (trilha na mesma transação). O escopo é o estabelecimento da sessão e a operadora ligada a ele (fora, 404).
import {
  calcularReajustePorRegra,
  competenciaDe,
  conferirReajuste,
  type FaixaReajuste,
  type IndiceReajuste,
  periodoDeApuracao,
  problemasDaRegra,
  problemasDoAgrupamento,
  problemasDoContratoNoAgrupamento,
  problemasDoContratoPorSinistralidade,
  problemasDoIndice,
  problemasDoPassoAgrupamento,
  type ProblemaReajusteColetivo,
  type RegraReajusteSinistralidade,
  type ResultadoApuracaoReajuste,
  type SituacaoAgrupamento,
  type TipoIndiceReajuste,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  marcadores,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_REAJUSTE_COLETIVO = Symbol('PORTA_REAJUSTE_COLETIVO_OPERADORA');

export const TABELAS_REAJUSTE_COLETIVO = [
  'indice_reajuste_plano',
  'regra_reajuste_sinistralidade',
  'regra_reajuste_sinistralidade_faixa',
  'agrupamento_reajuste_coletivo',
  'agrupamento_reajuste_contrato',
  'reajuste_contrato_plano',
] as const;

export type Gravado = { readonly id: number; readonly versao: number } & Readonly<
  Record<string, string | number | boolean | null>
>;
type Trilha = (r: Gravado) => RegistroTrilhaTela;

const CONTRATACAO: Readonly<Record<string, number>> = {
  individual_familiar: 1,
  coletivo_empresarial: 2,
  coletivo_adesao: 3,
};
const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
function exigir(problemas: readonly ProblemaReajusteColetivo[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const competencia = (v: unknown) => {
  const d = dataIso(v);
  return d ? competenciaDe(d) : null;
};

// ---- leituras ----
export interface IndiceLido extends IndiceReajuste {
  id: number;
  versao: number;
}
export interface RegraLida extends RegraReajusteSinistralidade {
  id: number;
  versao: number;
  ativo: boolean;
}
export interface AgrupamentoLido {
  id: number;
  versao: number;
  descricao: string;
  vigencia: string;
  limiteVidas: number;
  contratos: number;
  vidas: number;
  percentual: number | null;
  dataAplicacao: string | null;
  situacao: SituacaoAgrupamento;
  memoria: string | null;
  reajustes: number;
}
export interface ContratoAgrupadoLido {
  id: number;
  contrato: number;
  numero: string;
  mesReajuste: number;
  vidas: number;
  reajustado: boolean;
}
export interface ContratoColetivo {
  id: number;
  numero: string;
  operadora: number;
  situacao: string;
  inicio: string;
  mesReajuste: number;
  tipoContratacao: number;
  vidas: number;
}
export interface PreviaSinistralidade extends ResultadoApuracaoReajuste {
  contrato: number;
  regra: number;
  periodo: { inicio: string; fim: string };
  problemasContrato: ProblemaReajusteColetivo[];
}

const esquemaEntrada = z.record(z.string(), z.unknown());

export class PortaReajusteColetivoPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-reajuste-coletivo' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number, hoje: string) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_REAJUSTE_COLETIVO,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        const h = await tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(tx, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = contextoDireto(this.cliente, est, c, null);
    const r = await this.executor.executar(operacao, this.cliente, {}, ctx);
    return r.resultado;
  }

  private static async operadoraDoEst(l: Leitor, est: number, op: number): Promise<void> {
    const r = await l.uma(
      'SELECT 1 AS ok FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [op, est],
    );
    if (!r) throw naoEncontrado();
  }

  /** Os contratos do estabelecimento com a contratação do produto e as vidas ativas. */
  static async contratos(
    l: Leitor,
    est: number,
    filtro: { ids?: readonly number[]; operadora?: number },
  ): Promise<ContratoColetivo[]> {
    const conds = ['k.estabelecimento_id = ?', 'k.excluido_em IS NULL'];
    const ps: unknown[] = [est];
    if (filtro.ids) {
      if (!filtro.ids.length) return [];
      conds.push(`k.id IN (${marcadores(filtro.ids.length)})`);
      ps.push(...filtro.ids);
    }
    if (filtro.operadora !== undefined) {
      conds.push('k.operadora_saude_id = ?');
      ps.push(filtro.operadora);
    }
    const rs = await l.consultar(
      `SELECT k.id, k.numero, k.operadora_saude_id, k.situacao, k.inicio_vigencia, k.mes_reajuste, p.tipo_contratacao,
              (SELECT COUNT(*) FROM beneficiario_plano b WHERE b.contrato_plano_id = k.id AND b.situacao <> 'excluido'
                  AND b.excluido_em IS NULL) AS vidas
         FROM contrato_plano k
         LEFT JOIN produto_plano p ON p.id = k.produto_plano_id
        WHERE ${conds.join(' AND ')}
        ORDER BY k.numero`,
      ps,
      { teto: 5000 },
    );
    return rs.map((r) => ({
      id: Number(r['id']),
      numero: textoObrigatorio(r['numero']),
      operadora: Number(r['operadora_saude_id']),
      situacao: textoObrigatorio(r['situacao']),
      inicio: dataIso(r['inicio_vigencia']) ?? '',
      mesReajuste: Number(r['mes_reajuste']),
      tipoContratacao: CONTRATACAO[textoObrigatorio(r['tipo_contratacao'])] ?? 1,
      vidas: Number(r['vidas'] ?? 0),
    }));
  }

  /** Receita (mensalidades não canceladas) e despesa assistencial (guias liberadas ou pagas) dos contratos no período. */
  static async resultado(
    l: Leitor,
    est: number,
    contratos: readonly number[],
    p: { inicio: string; fim: string },
  ): Promise<{ receita: number; despesa: number }> {
    if (!contratos.length) return { receita: 0, despesa: 0 };
    const m = marcadores(contratos.length);
    const rec = await l.uma(
      `SELECT COALESCE(SUM(f.valor_total), 0) AS v FROM fatura_plano f
        WHERE f.estabelecimento_id = ? AND f.contrato_plano_id IN (${m}) AND f.tipo_fatura = 'mensalidade'
          AND f.situacao <> 'cancelada' AND f.excluido_em IS NULL AND f.competencia BETWEEN ? AND ?`,
      [est, ...contratos, p.inicio, p.fim],
    );
    const des = await l.uma(
      `SELECT COALESCE(SUM(COALESCE(g.valor_liberado, 0)), 0) AS v FROM guia_conta_recebida g
         JOIN beneficiario_plano b ON b.id = g.beneficiario_plano_id
        WHERE g.estabelecimento_id = ? AND b.contrato_plano_id IN (${m})
          AND g.situacao IN ('auditada','liberada','paga') AND g.excluido_em IS NULL
          AND g.inicio_atendimento >= ? AND g.inicio_atendimento < ? + INTERVAL 1 DAY`,
      [est, ...contratos, p.inicio, p.fim],
    );
    return { receita: numero(rec?.['v']) ?? 0, despesa: numero(des?.['v']) ?? 0 };
  }

  /** A conferência do reajuste anual do domínio (aniversário, 12 meses, competência ainda não cobrada). */
  static async conferirNoContrato(
    l: Leitor,
    est: number,
    k: ContratoColetivo,
    comp: string,
    percentual: number,
  ): Promise<ProblemaReajusteColetivo[]> {
    const vig = await l.consultar(
      `SELECT data_base FROM reajuste_contrato_plano
        WHERE contrato_plano_id = ? AND estabelecimento_id = ? AND situacao = 'aplicado' AND excluido_em IS NULL`,
      [k.id, est],
    );
    const ult = await l.uma(
      `SELECT MAX(competencia) AS c FROM fatura_plano WHERE contrato_plano_id = ? AND estabelecimento_id = ?
          AND tipo_fatura = 'mensalidade' AND situacao <> 'cancelada' AND excluido_em IS NULL`,
      [k.id, est],
    );
    const { problemas } = conferirReajuste({
      competencia: comp,
      percentual,
      tetoAns: null,
      oficioAns: null,
      contrato: {
        situacao: k.situacao,
        inicio: k.inicio,
        mesReajuste: k.mesReajuste,
        tipoContratacao: k.tipoContratacao,
      },
      reajustesVigentes: vig.map((r) => competencia(r['data_base']) ?? ''),
      ultimaMensalidade: competencia(ult?.['c']),
      vidas: k.vidas,
    });
    return problemas.map((p) => ({ codigo: p, campo: 'competencia', detalhe: MENSAGEM_REAJUSTE[p] ?? p }));
  }

  // ------------------------------------------------------------ índice ---------------------------------------------
  indices(c: ContextoPorta): Promise<IndiceLido[]> {
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT id, versao, codigo_indice, descricao, tipo_indice, vigencia_inicio, vigencia_fim, percentual,
                protocolo_autorizacao
           FROM indice_reajuste_plano ORDER BY vigencia_inicio DESC, codigo_indice`,
        [],
        { teto: 500 },
      );
      return rs.map(indiceDe);
    });
  }

  gravarIndice(c: ContextoPorta, e: IndiceReajuste, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reajuste.indice.incluir',
      'indice_reajuste_plano',
      trilha,
      async (tx) => {
        const ex = await tx.consultarParaAtualizar(
          `SELECT id, versao, codigo_indice, descricao, tipo_indice, vigencia_inicio, vigencia_fim, percentual,
                protocolo_autorizacao
           FROM indice_reajuste_plano WHERE codigo_indice = ?`,
          [e.codigo.trim()],
          { teto: 500 },
        );
        exigir(problemasDoIndice(e, ex.map(indiceDe)));
        const id = await tx.incluir('indice_reajuste_plano', {
          codigo_indice: e.codigo.trim(),
          descricao: e.descricao.trim(),
          tipo_indice: e.tipo,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          percentual: e.percentual,
          protocolo_autorizacao: e.protocolo?.trim() || null,
        });
        return { id, versao: 1 };
      },
    );
  }

  // ------------------------------------------------------------ regra ----------------------------------------------
  regras(c: ContextoPorta, op: number): Promise<RegraLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaReajusteColetivoPropria.operadoraDoEst(l, est, op);
      return lerRegras(l, op, null);
    });
  }

  gravarRegra(
    c: ContextoPorta,
    op: number,
    e: RegraReajusteSinistralidade,
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reajuste.regra.incluir',
      'regra_reajuste_sinistralidade',
      trilha,
      async (tx, est) => {
        await PortaReajusteColetivoPropria.operadoraDoEst(tx, est, op);
        exigir(problemasDaRegra(e));
        const ja = await tx.uma(
          'SELECT id FROM regra_reajuste_sinistralidade WHERE operadora_saude_id = ? AND codigo = ?',
          [op, e.codigo.trim()],
        );
        if (ja) throw recusa('regra-codigo-existente', 'Já existe regra com este código nesta operadora.');
        const id = await tx.incluir('regra_reajuste_sinistralidade', {
          operadora_saude_id: op,
          codigo: e.codigo.trim(),
          descricao: e.descricao.trim(),
          base_apuracao: e.base,
          meses_apuracao: e.meses,
          meta_sinistralidade: e.meta,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        let seq = 0;
        for (const f of e.faixas)
          await tx.incluir('regra_reajuste_sinistralidade_faixa', {
            regra_reajuste_sinistralidade_id: id,
            sequencia: ++seq,
            valor_inicial: f.de,
            valor_final: f.ate,
            percentual_reajuste: f.percentual,
          });
        return { id, versao: 1 };
      },
    );
  }

  // ------------------------------------------------------------ agrupamento ----------------------------------------
  agrupamentos(c: ContextoPorta, op: number): Promise<AgrupamentoLido[]> {
    return this.ler(c, async (l, est) => {
      await PortaReajusteColetivoPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT a.id, a.versao, a.descricao, a.vigencia, a.limite_vidas, a.quantidade_contratos, a.quantidade_vidas,
                a.percentual_reajuste, a.data_aplicacao, a.situacao, a.memoria_calculo,
                (SELECT COUNT(*) FROM reajuste_contrato_plano r WHERE r.agrupamento_reajuste_coletivo_id = a.id
                    AND r.situacao = 'aplicado' AND r.excluido_em IS NULL) AS reajustes
           FROM agrupamento_reajuste_coletivo a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND (a.quantidade_contratos = 0 OR EXISTS (
                 SELECT 1 FROM agrupamento_reajuste_contrato x JOIN contrato_plano k ON k.id = x.contrato_plano_id
                  WHERE x.agrupamento_reajuste_coletivo_id = a.id AND k.operadora_saude_id = ?))
          ORDER BY a.vigencia DESC, a.id DESC`,
        [est, op],
        { teto: 200 },
      );
      return rs.map(agrupamentoDe);
    });
  }

  contratosDoAgrupamento(c: ContextoPorta, id: number): Promise<ContratoAgrupadoLido[]> {
    return this.ler(c, async (l, est) => {
      await agrupamentoDoEst(l, est, id);
      const rs = await l.consultar(
        `SELECT x.id, x.contrato_plano_id, k.numero, k.mes_reajuste, x.quantidade_vidas,
                EXISTS (SELECT 1 FROM reajuste_contrato_plano r WHERE r.agrupamento_reajuste_coletivo_id = x.agrupamento_reajuste_coletivo_id
                           AND r.contrato_plano_id = x.contrato_plano_id AND r.situacao = 'aplicado'
                           AND r.excluido_em IS NULL) AS reajustado
           FROM agrupamento_reajuste_contrato x JOIN contrato_plano k ON k.id = x.contrato_plano_id
          WHERE x.agrupamento_reajuste_coletivo_id = ? AND x.excluido_em IS NULL
          ORDER BY k.mes_reajuste, k.numero`,
        [id],
        { teto: 5000 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        contrato: Number(r['contrato_plano_id']),
        numero: textoObrigatorio(r['numero']),
        mesReajuste: Number(r['mes_reajuste']),
        vidas: Number(r['quantidade_vidas']),
        reajustado: Number(r['reajustado']) === 1,
      }));
    });
  }

  /** Cria o agrupamento do período e inclui de uma vez os contratos coletivos elegíveis da operadora. */
  criarAgrupamento(
    c: ContextoPorta,
    op: number,
    e: { descricao: string; vigencia: string; limiteVidas: number },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reajuste.agrupamento.criar',
      'agrupamento_reajuste_coletivo',
      trilha,
      async (tx, est) => {
        await PortaReajusteColetivoPropria.operadoraDoEst(tx, est, op);
        exigir(problemasDoAgrupamento(e));
        // Contratos já num agrupamento não cancelado do mesmo período ficam de fora.
        const ocupados = await tx.consultar(
          `SELECT x.contrato_plano_id FROM agrupamento_reajuste_contrato x
           JOIN agrupamento_reajuste_coletivo a ON a.id = x.agrupamento_reajuste_coletivo_id
          WHERE a.estabelecimento_id = ? AND a.vigencia = ? AND a.situacao <> 'cancelado' AND a.excluido_em IS NULL
            AND x.excluido_em IS NULL`,
          [est, e.vigencia],
          { teto: 5000 },
        );
        const fora = new Set(ocupados.map((r) => Number(r['contrato_plano_id'])));
        const elegiveis = (await PortaReajusteColetivoPropria.contratos(tx, est, { operadora: op })).filter(
          (k) => !fora.has(k.id) && problemasDoContratoNoAgrupamento(k, e.limiteVidas).length === 0,
        );
        if (!elegiveis.length)
          throw recusa(
            'agrupamento-sem-contrato',
            'Nenhum contrato coletivo elegível fora de outro agrupamento.',
          );
        const vidas = elegiveis.reduce((s, k) => s + k.vidas, 0);
        const id = await tx.incluir('agrupamento_reajuste_coletivo', {
          estabelecimento_id: est,
          descricao: e.descricao.trim(),
          vigencia: e.vigencia,
          limite_vidas: e.limiteVidas,
          quantidade_vidas: vidas,
          quantidade_contratos: elegiveis.length,
          situacao: 'aberto',
        });
        for (const k of elegiveis)
          await tx.incluir('agrupamento_reajuste_contrato', {
            agrupamento_reajuste_coletivo_id: id,
            contrato_plano_id: k.id,
            vigencia_inicio: e.vigencia,
            quantidade_vidas: k.vidas,
          });
        return { id, versao: 1, contratos: elegiveis.length, vidas };
      },
    );
  }

  /** O percentual único: pela regra sobre o resultado somado do grupo, ou informado com a justificativa. */
  calcularAgrupamento(
    c: ContextoPorta,
    id: number,
    versao: number,
    e: { regra: number | null; percentual: number | null; justificativa: string | null },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reajuste.agrupamento.calcular',
      'agrupamento_reajuste_coletivo',
      trilha,
      async (tx, est) => {
        const a = await agrupamentoDoEst(tx, est, id);
        exigir(problemasDoPassoAgrupamento(a, 'calcular'));
        let percentual: number;
        let memoria: string;
        if (e.regra !== null) {
          const ids = (
            await tx.consultar(
              'SELECT contrato_plano_id FROM agrupamento_reajuste_contrato WHERE agrupamento_reajuste_coletivo_id = ? AND excluido_em IS NULL',
              [id],
              { teto: 5000 },
            )
          ).map((r) => Number(r['contrato_plano_id']));
          const op = await tx.uma('SELECT operadora_saude_id FROM contrato_plano WHERE id = ?', [
            ids[0] ?? 0,
          ]);
          const [regra] = await lerRegras(tx, Number(op?.['operadora_saude_id'] ?? 0), e.regra);
          if (!regra) throw naoEncontrado();
          const per = periodoDeApuracao(competenciaDe(a.vigencia), regra.meses);
          const r = calcularReajustePorRegra(
            regra,
            await PortaReajusteColetivoPropria.resultado(tx, est, ids, per),
          );
          exigir(r.problemas);
          percentual = r.percentual ?? 0;
          memoria = `Regra ${regra.codigo}; ${ids.length} contratos, ${a.vidas} vidas; ${per.inicio} a ${per.fim}; ${r.memoria}`;
        } else {
          if (e.percentual === null || !e.justificativa?.trim() || e.justificativa.trim().length < 10)
            throw recusa(
              'agrupamento-sem-memoria',
              'Informe a regra ou o percentual com a memória de cálculo (ao menos 10 letras).',
              { campos: ['justificativa'] },
            );
          percentual = e.percentual;
          memoria = `Percentual informado: ${e.justificativa.trim()}`;
        }
        if (e.justificativa?.trim() && e.regra !== null) memoria = `${memoria}\n${e.justificativa.trim()}`;
        await tx.alterar('agrupamento_reajuste_coletivo', id, versao, {
          percentual_reajuste: percentual,
          situacao: 'calculado',
          memoria_calculo: memoria.slice(0, 60_000),
        });
        return { id, versao: versao + 1, percentual };
      },
    );
  }

  /** Aplica o percentual único aos contratos do agrupamento com aniversário na competência. */
  aplicarAgrupamento(
    c: ContextoPorta,
    id: number,
    versao: number,
    comp: string,
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reajuste.agrupamento.aplicar',
      'agrupamento_reajuste_coletivo',
      trilha,
      async (tx, est, hoje) => {
        const a = await agrupamentoDoEst(tx, est, id);
        exigir(problemasDoPassoAgrupamento(a, 'aplicar', comp));
        const percentual = a.percentual ?? 0;
        const ids = (
          await tx.consultar(
            'SELECT contrato_plano_id FROM agrupamento_reajuste_contrato WHERE agrupamento_reajuste_coletivo_id = ? AND excluido_em IS NULL',
            [id],
            { teto: 5000 },
          )
        ).map((r) => Number(r['contrato_plano_id']));
        const doMes = (await PortaReajusteColetivoPropria.contratos(tx, est, { ids })).filter(
          (k) => k.mesReajuste === Number(comp.slice(5, 7)),
        );
        const aplicados: number[] = [];
        const ignorados: { contrato: string; motivo: string }[] = [];
        for (const k of doMes) {
          const p = await PortaReajusteColetivoPropria.conferirNoContrato(tx, est, k, comp, percentual);
          if (p.length) {
            ignorados.push({ contrato: k.numero, motivo: p[0]!.codigo });
            continue;
          }
          aplicados.push(
            await tx.incluir('reajuste_contrato_plano', {
              estabelecimento_id: est,
              contrato_plano_id: k.id,
              agrupamento_reajuste_coletivo_id: id,
              tipo_reajuste: 'agrupamento',
              percentual,
              data_base: `${comp}-01`,
              quantidade_vidas: k.vidas,
              complementar: false,
              situacao: 'aplicado',
              aplicado_em: new Date(),
              aplicado_por_usuario_id: tx.contexto.usuario,
              observacao: `Percentual único do agrupamento ${a.descricao}`.slice(0, 500),
            }),
          );
        }
        if (!aplicados.length)
          throw recusa(
            'agrupamento-nada-a-aplicar',
            doMes.length
              ? `Nenhum contrato pôde ser reajustado (${ignorados.map((x) => `${x.contrato}: ${x.motivo}`).join('; ')}).`
              : 'Nenhum contrato do agrupamento faz aniversário nesta competência.',
          );
        await tx.alterar('agrupamento_reajuste_coletivo', id, versao, {
          situacao: 'aplicado',
          data_aplicacao: a.dataAplicacao ?? hoje,
        });
        return {
          id,
          versao: versao + 1,
          aplicados: aplicados.length,
          ignorados: ignorados.map((x) => `${x.contrato}: ${x.motivo}`).join('; '),
        };
      },
    );
  }

  cancelarAgrupamento(c: ContextoPorta, id: number, versao: number, motivo: string, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.reajuste.agrupamento.cancelar',
      'agrupamento_reajuste_coletivo',
      trilha,
      async (tx, est) => {
        const a = await agrupamentoDoEst(tx, est, id);
        exigir(problemasDoPassoAgrupamento(a, 'cancelar'));
        if (motivo.trim().length < 5) throw recusa('motivo-obrigatorio', 'Informe o motivo do cancelamento.');
        await tx.alterar('agrupamento_reajuste_coletivo', id, versao, {
          situacao: 'cancelado',
          memoria_calculo: `${a.memoria ?? ''}\nCancelado: ${motivo.trim()}`.trim().slice(0, 60_000),
        });
        return { id, versao: versao + 1 };
      },
    );
  }

  // ------------------------------------------------------------ sinistralidade do contrato ---------------------------
  /** Os contratos coletivos da operadora com as vidas (os de até 29 vidas vão para o agrupamento). */
  contratosColetivos(c: ContextoPorta, op: number): Promise<ContratoColetivo[]> {
    return this.ler(c, async (l, est) => {
      await PortaReajusteColetivoPropria.operadoraDoEst(l, est, op);
      return (await PortaReajusteColetivoPropria.contratos(l, est, { operadora: op })).filter(
        (k) => k.tipoContratacao !== 1 && k.situacao !== 'encerrado',
      );
    });
  }

  previaSinistralidade(
    c: ContextoPorta,
    contrato: number,
    comp: string,
    regraId: number,
  ): Promise<PreviaSinistralidade> {
    return this.ler(c, (l, est) => previa(l, est, contrato, comp, regraId));
  }

  reajustarPorSinistralidade(
    c: ContextoPorta,
    contrato: number,
    comp: string,
    regraId: number,
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reajuste.sinistralidade.aplicar',
      'reajuste_contrato_plano',
      trilha,
      async (tx, est) => {
        const p = await previa(tx, est, contrato, comp, regraId);
        exigir(p.problemasContrato);
        exigir(p.problemas);
        const [k] = await PortaReajusteColetivoPropria.contratos(tx, est, { ids: [contrato] });
        exigir(await PortaReajusteColetivoPropria.conferirNoContrato(tx, est, k!, comp, p.percentual ?? 0));
        const id = await tx.incluir('reajuste_contrato_plano', {
          estabelecimento_id: est,
          contrato_plano_id: contrato,
          tipo_reajuste: 'sinistralidade',
          percentual: p.percentual,
          data_base: `${comp}-01`,
          quantidade_vidas: k!.vidas,
          complementar: false,
          situacao: 'aplicado',
          aplicado_em: new Date(),
          aplicado_por_usuario_id: tx.contexto.usuario,
          observacao: `${p.periodo.inicio} a ${p.periodo.fim}: ${p.memoria}`.slice(0, 60_000),
        });
        return { id, versao: 1, percentual: p.percentual, sinistralidade: p.valorApurado };
      },
    );
  }
}

const MENSAGEM_REAJUSTE: Readonly<Record<string, string>> = {
  'contrato-encerrado': 'O contrato está encerrado.',
  'reajuste-fora-do-aniversario': 'A competência não é o mês de aniversário do contrato.',
  'reajuste-antes-de-12-meses': 'O contrato ainda não completou 12 meses.',
  'reajuste-intervalo-menor': 'Há reajuste há menos de 12 meses.',
  'reajuste-ja-registrado': 'O contrato já tem reajuste nesta competência.',
  'reajuste-percentual-zero': 'O percentual é zero.',
  'reajuste-competencia-cobrada': 'A mensalidade da competência já foi gerada.',
};

async function previa(
  l: Leitor,
  est: number,
  contrato: number,
  comp: string,
  regraId: number,
): Promise<PreviaSinistralidade> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp))
    throw recusa('competencia-invalida', 'Competência no formato AAAA-MM.', { campos: ['competencia'] });
  const [k] = await PortaReajusteColetivoPropria.contratos(l, est, { ids: [contrato] });
  if (!k) throw naoEncontrado();
  const [regra] = await lerRegras(l, k.operadora, regraId);
  if (!regra) throw naoEncontrado();
  const periodo = periodoDeApuracao(comp, regra.meses);
  const r = calcularReajustePorRegra(
    regra,
    await PortaReajusteColetivoPropria.resultado(l, est, [k.id], periodo),
  );
  return {
    ...r,
    contrato,
    regra: regraId,
    periodo,
    problemasContrato: problemasDoContratoPorSinistralidade(k),
  };
}

function indiceDe(r: Record<string, unknown>): IndiceLido {
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    codigo: textoObrigatorio(r['codigo_indice']),
    descricao: textoObrigatorio(r['descricao']),
    tipo: textoObrigatorio(r['tipo_indice']) as TipoIndiceReajuste,
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    percentual: numero(r['percentual']) ?? 0,
    protocolo: texto(r['protocolo_autorizacao']),
  };
}

async function lerRegras(l: Leitor, op: number, id: number | null): Promise<RegraLida[]> {
  const rs = await l.consultar(
    `SELECT id, versao, codigo, descricao, base_apuracao, meses_apuracao, meta_sinistralidade, vigencia_inicio,
            vigencia_fim, ativo
       FROM regra_reajuste_sinistralidade WHERE operadora_saude_id = ? ${id === null ? '' : 'AND id = ?'}
      ORDER BY codigo`,
    id === null ? [op] : [op, id],
    { teto: 200 },
  );
  if (!rs.length) return [];
  const fs = await l.consultar(
    `SELECT regra_reajuste_sinistralidade_id AS regra, valor_inicial, valor_final, percentual_reajuste
       FROM regra_reajuste_sinistralidade_faixa
      WHERE regra_reajuste_sinistralidade_id IN (${marcadores(rs.length)}) AND excluido_em IS NULL
      ORDER BY regra_reajuste_sinistralidade_id, sequencia`,
    rs.map((r) => r['id']),
    { teto: 5000 },
  );
  return rs.map((r) => ({
    id: Number(r['id']),
    versao: Number(r['versao']),
    codigo: textoObrigatorio(r['codigo']),
    descricao: textoObrigatorio(r['descricao']),
    base: textoObrigatorio(r['base_apuracao']) as 'sinistralidade' | 'mensalidade',
    meses: Number(r['meses_apuracao']),
    meta: numero(r['meta_sinistralidade']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    ativo: Number(r['ativo']) === 1 || r['ativo'] === true,
    faixas: fs
      .filter((f) => Number(f['regra']) === Number(r['id']))
      .map((f): FaixaReajuste => ({
        de: numero(f['valor_inicial']) ?? 0,
        ate: numero(f['valor_final']),
        percentual: numero(f['percentual_reajuste']) ?? 0,
      })),
  }));
}

function agrupamentoDe(r: Record<string, unknown>): AgrupamentoLido {
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    descricao: textoObrigatorio(r['descricao']),
    vigencia: dataIso(r['vigencia']) ?? '',
    limiteVidas: Number(r['limite_vidas']),
    contratos: Number(r['quantidade_contratos']),
    vidas: Number(r['quantidade_vidas']),
    percentual: numero(r['percentual_reajuste']),
    dataAplicacao: dataIso(r['data_aplicacao']),
    situacao: textoObrigatorio(r['situacao']) as SituacaoAgrupamento,
    memoria: texto(r['memoria_calculo']),
    reajustes: inteiro(r['reajustes']) ?? 0,
  };
}

async function agrupamentoDoEst(l: Leitor, est: number, id: number): Promise<AgrupamentoLido> {
  const r = await l.uma(
    `SELECT id, versao, descricao, vigencia, limite_vidas, quantidade_contratos, quantidade_vidas, percentual_reajuste,
            data_aplicacao, situacao, memoria_calculo, 0 AS reajustes
       FROM agrupamento_reajuste_coletivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!r) throw naoEncontrado();
  return agrupamentoDe(r);
}

export const METODOS_REAJUSTE_COLETIVO: ReadonlySet<string> = new Set([
  'indices',
  'gravarIndice',
  'regras',
  'gravarRegra',
  'agrupamentos',
  'contratosDoAgrupamento',
  'criarAgrupamento',
  'calcularAgrupamento',
  'aplicarAgrupamento',
  'cancelarAgrupamento',
  'contratosColetivos',
  'previaSinistralidade',
  'reajustarPorSinistralidade',
]);
