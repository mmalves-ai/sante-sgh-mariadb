// Porta PRÓPRIA do orçamento estatístico e dos indicadores orçamentários (C1-129) sobre o MariaDB do cliente, pelo
// @sgh/nucleo: indicador_orcamentario (cadastro da rede, com o grupo de grupo_indicador_orcamentario e o dado de
// tipo_dado_estatistico), valor_estatistico_orcado (quantidade orçada por versão, indicador, centro de custo e mês) e o
// realizado lido de estatistica_centro_mes, somado no banco por setor e mês (nenhuma linha de paciente). Toda gravação
// vai pelo Executor, com a trilha, o outbox e a idempotência na mesma transação; a quantidade só muda com a versão em
// elaboração (relida e travada na transação), cada célula pela versão que a tela leu, e a retirada é lógica
// (excluido_em/excluido_por), nunca DELETE; a célula retirada volta pela mesma chave.
import type { IndicadorOrcamentarioEntrada } from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type {
  CatalogoIndicadores,
  CelulaEstatisticaGravada,
  CelulaParaGravar,
  IndicadorOrcamentarioVisao,
  PortaEstatisticasOrcamento,
  RealizadoSetorMes,
  ResultadoLinhaEstatistica,
} from './estatisticas-orcamento.js';
import type { ContextoOrcamento, GravacaoOrcamento } from './porta.js';
import type { NucleoOrcamento } from './porta-propria.js';

const TETO_CATALOGO = 2000;
const TETO_CELULAS = 20_000;
const TETO_REALIZADO = 50_000;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiro = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const cent = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 100);
const decimal = (c: number | null): string | null => (c === null ? null : (c / 100).toFixed(2));

const indicadorZ = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(3).max(150),
  grupoId: z.number().int().positive().nullable(),
  tipoDadoId: z.number().int().positive().nullable(),
  unidade: z.string().max(30).nullable(),
  visao: z.string(),
  tipoProjecao: z.string(),
  mesesProjecao: z.number().int().nullable(),
  observacao: z.string().max(2000).nullable(),
  ativo: z.boolean(),
});
const colunasIndicador = (x: z.infer<typeof indicadorZ>) => ({
  codigo: x.codigo,
  descricao: x.descricao,
  grupo_indicador_orcamentario_id: x.grupoId,
  tipo_dado_estatistico_id: x.tipoDadoId,
  unidade_medida: x.unidade,
  visao: x.visao,
  tipo_projecao: x.tipoProjecao,
  meses_projecao: x.mesesProjecao,
  observacao: x.observacao,
  ativo: x.ativo,
});

const naoEncontrada = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Orçamento não encontrado',
    'A versão não existe neste estabelecimento.',
  );
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O orçamento mudou depois que você abriu (outra pessoa gravou, aprovou ou descartou). Abra de novo para ver a versão atual.',
  );
const codigoRepetido = () => recusa('codigo-repetido', 'Já existe um indicador com este código.');

/** Relê e trava a versão do estabelecimento do contexto; só a em elaboração segue. */
async function travarVersaoAberta(tx: TxOperacao, id: number): Promise<void> {
  const [v] = await tx.consultarParaAtualizar<{ situacao: unknown }>(
    'SELECT situacao FROM versao_orcamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, tx.contexto.estabelecimento],
  );
  if (!v) throw naoEncontrada();
  if (v.situacao !== 'rascunho') throw desatualizado();
}

/** Grupo e dado estatístico ativos (o cadastro pode ter mudado depois da tela). */
async function conferirLigacoes(tx: TxOperacao, x: z.infer<typeof indicadorZ>): Promise<void> {
  if (
    x.grupoId !== null &&
    !(await tx.uma('SELECT id FROM grupo_indicador_orcamentario WHERE id = ? AND ativo = TRUE', [x.grupoId]))
  )
    throw recusa('grupo-inativo', 'Escolha um grupo ativo.');
  if (
    x.tipoDadoId !== null &&
    !(await tx.uma('SELECT id FROM tipo_dado_estatistico WHERE id = ? AND ativo = TRUE', [x.tipoDadoId]))
  )
    throw recusa('dado-inativo', 'Escolha um dado estatístico ativo.');
}

const opCriarIndicador = definirOperacao({
  nome: 'orcamento.indicador.incluir',
  tabelas: ['indicador_orcamentario'],
  entrada: z.object({ indicador: indicadorZ, dados: z.unknown() }),
  async gravar(tx, x) {
    await conferirLigacoes(tx, x.indicador);
    try {
      const id = await tx.incluir('indicador_orcamentario', colunasIndicador(x.indicador));
      return { id };
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw codigoRepetido();
      throw e;
    }
  },
  alvo: (_x, r) => ({ tabela: 'indicador_orcamentario', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: { tela: x.dados ?? null, codigo: x.indicador.codigo } }),
});

const opAlterarIndicador = definirOperacao({
  nome: 'orcamento.indicador.alterar',
  tabelas: ['indicador_orcamentario'],
  entrada: z.object({
    id: z.number().int().positive(),
    versao: z.number().int().min(0),
    indicador: indicadorZ,
    dados: z.unknown(),
  }),
  async gravar(tx, x) {
    await conferirLigacoes(tx, x.indicador);
    try {
      const versao = await tx.alterar(
        'indicador_orcamentario',
        x.id,
        x.versao,
        colunasIndicador(x.indicador),
      );
      return { versao };
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw codigoRepetido();
      throw e;
    }
  },
  alvo: (x) => ({ tabela: 'indicador_orcamentario', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: { tela: x.dados ?? null, codigo: x.indicador.codigo } }),
});

const celulaZ = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  quantidadeCent: z.number().int().min(0).nullable(),
  projetadaCent: z.number().int().min(0).nullable(),
  versao: z.number().int().min(0).nullable(),
});

const opGravarLinha = definirOperacao({
  nome: 'orcamento.estatistica.gravar',
  tabelas: ['valor_estatistico_orcado'],
  entrada: z.object({
    versaoId: z.number().int().positive(),
    indicadorId: z.number().int().positive(),
    centroId: z.number().int().positive(),
    celulas: z.array(celulaZ).min(1).max(120),
    dados: z.unknown(),
  }),
  async gravar(tx, x) {
    await travarVersaoAberta(tx, x.versaoId);
    if (
      !(await tx.uma('SELECT id FROM indicador_orcamentario WHERE id = ? AND ativo = TRUE', [x.indicadorId]))
    )
      throw recusa('indicador-inativo', 'Escolha um indicador ativo.');
    if (
      !(await tx.uma(
        'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
        [x.centroId, tx.contexto.estabelecimento],
      ))
    )
      throw recusa('setor-inativo', 'Escolha um setor (centro de custo) ativo deste estabelecimento.');
    const m = await tx.uma<{ m: unknown }>(
      'SELECT COALESCE(MAX(sequencia), 0) AS m FROM valor_estatistico_orcado WHERE versao_orcamento_id = ?',
      [x.versaoId],
    );
    let sequencia = inteiro(m?.m);
    const r = { incluidas: 0, alteradas: 0, retiradas: 0 };
    for (const c of x.celulas) {
      const [a] = await tx.consultarParaAtualizar<{
        id: unknown;
        versao: unknown;
        excluido_em: unknown;
        q: unknown;
        p: unknown;
      }>(
        `SELECT id, versao, excluido_em, quantidade_orcada AS q, quantidade_projetada AS p
           FROM valor_estatistico_orcado
          WHERE versao_orcamento_id = ? AND indicador_orcamentario_id = ? AND centro_custo_id = ? AND competencia = ?`,
        [x.versaoId, x.indicadorId, x.centroId, `${c.competencia}-01`],
      );
      const vivo = !!a && a.excluido_em === null;
      if (vivo && c.versao !== inteiro(a.versao)) throw desatualizado();
      if (c.quantidadeCent === null) {
        if (!vivo) continue;
        await tx.alterar('valor_estatistico_orcado', inteiro(a.id), inteiro(a.versao), {
          excluido_em: new Date(),
          excluido_por: tx.contexto.usuario,
        });
        r.retiradas++;
        continue;
      }
      const colunas = {
        quantidade_orcada: decimal(c.quantidadeCent),
        quantidade_projetada: decimal(c.projetadaCent),
        quantidade_ajuste: c.projetadaCent === null ? null : decimal(c.quantidadeCent - c.projetadaCent),
        recalculado: false,
      };
      if (a) {
        if (vivo && cent(a.q) === c.quantidadeCent && cent(a.p) === c.projetadaCent) continue;
        await tx.alterar('valor_estatistico_orcado', inteiro(a.id), inteiro(a.versao), {
          ...colunas,
          excluido_em: null,
          excluido_por: null,
        });
        if (vivo) r.alteradas++;
        else r.incluidas++;
        continue;
      }
      sequencia += 1;
      await tx.incluir('valor_estatistico_orcado', {
        versao_orcamento_id: x.versaoId,
        sequencia,
        indicador_orcamentario_id: x.indicadorId,
        centro_custo_id: x.centroId,
        competencia: `${c.competencia}-01`,
        ...colunas,
      });
      r.incluidas++;
    }
    return r;
  },
  alvo: (x) => ({ tabela: 'versao_orcamento', id: x.versaoId }),
  trilha: (x, r) => ({
    acao: 'alteracao',
    dados: {
      tela: x.dados ?? null,
      indicador: x.indicadorId,
      centro: x.centroId,
      incluidas: r.incluidas,
      alteradas: r.alteradas,
      retiradas: r.retiradas,
    },
  }),
});

function indicadorDaLinha(x: Record<string, unknown>): IndicadorOrcamentarioVisao {
  return {
    id: inteiro(x['id']),
    codigo: texto(x['codigo']) ?? '',
    descricao: texto(x['descricao']) ?? '',
    grupoId:
      x['grupo_indicador_orcamentario_id'] == null ? null : inteiro(x['grupo_indicador_orcamentario_id']),
    tipoDadoId: x['tipo_dado_estatistico_id'] == null ? null : inteiro(x['tipo_dado_estatistico_id']),
    unidade: texto(x['unidade_medida']),
    visao: String(x['visao']) as IndicadorOrcamentarioVisao['visao'],
    tipoProjecao: String(x['tipo_projecao']) as IndicadorOrcamentarioVisao['tipoProjecao'],
    mesesProjecao: x['meses_projecao'] == null ? null : inteiro(x['meses_projecao']),
    observacao: texto(x['observacao']),
    ativo: Boolean(Number(x['ativo'])),
    versao: inteiro(x['versao']),
  };
}

export class PortaEstatisticasOrcamentoPropria implements PortaEstatisticasOrcamento {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOrcamento,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoOrcamento, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'orcamento' }, fn);
  }

  private async estabelecimento(c: ContextoOrcamento, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const x = await l.uma<{ id: unknown }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [c.hospital],
    );
    if (!x)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Estabelecimento desconhecido',
        'O estabelecimento da sessão não existe.',
      );
    return inteiro(x.id);
  }

  private async gravar<S>(
    c: ContextoOrcamento,
    op: Parameters<Executor['executar']>[0],
    entrada: Record<string, unknown>,
    g: GravacaoOrcamento,
  ): Promise<S> {
    const est = await this.ler(c, (l) => this.estabelecimento(c, l));
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: g.trilha.correlacao ?? c.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
    };
    const r = await this.executor.executar(
      op,
      this.cliente,
      { ...entrada, dados: g.trilha.dadosDepois },
      contexto,
    );
    return r.resultado as S;
  }

  catalogo(c: ContextoOrcamento): Promise<CatalogoIndicadores> {
    return this.ler(c, async (l) => {
      const grupos = await l.consultar(
        `SELECT id, codigo, descricao FROM grupo_indicador_orcamentario WHERE ativo = TRUE
          ORDER BY ordem_exibicao, codigo LIMIT ${TETO_CATALOGO}`,
        [],
        { teto: TETO_CATALOGO },
      );
      const tipos = await l.consultar(
        `SELECT id, codigo, descricao, unidade_medida FROM tipo_dado_estatistico WHERE ativo = TRUE
          ORDER BY codigo LIMIT ${TETO_CATALOGO}`,
        [],
        { teto: TETO_CATALOGO },
      );
      const inds = await l.consultar(
        `SELECT id, codigo, descricao, grupo_indicador_orcamentario_id, tipo_dado_estatistico_id, unidade_medida, visao,
                tipo_projecao, meses_projecao, observacao, ativo, versao
           FROM indicador_orcamentario ORDER BY codigo LIMIT ${TETO_CATALOGO}`,
        [],
        { teto: TETO_CATALOGO },
      );
      return {
        grupos: grupos.map((x) => ({
          id: inteiro(x['id']),
          codigo: texto(x['codigo']) ?? '',
          descricao: texto(x['descricao']) ?? '',
        })),
        tiposDado: tipos.map((x) => ({
          id: inteiro(x['id']),
          codigo: texto(x['codigo']) ?? '',
          descricao: texto(x['descricao']) ?? '',
          unidade: texto(x['unidade_medida']) ?? '',
        })),
        indicadores: inds.map(indicadorDaLinha),
      };
    });
  }

  criarIndicador(
    c: ContextoOrcamento,
    x: IndicadorOrcamentarioEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ id: number }> {
    return this.gravar(c, opCriarIndicador, { indicador: x }, g);
  }

  alterarIndicador(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    x: IndicadorOrcamentarioEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }> {
    return this.gravar(c, opAlterarIndicador, { id, versao, indicador: x }, g);
  }

  vigencia(c: ContextoOrcamento, versaoId: number): Promise<{ inicio: string; fim: string } | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const x = await l.uma<{ i: unknown; f: unknown }>(
        `SELECT DATE_FORMAT(vigencia_inicio, '%Y-%m') AS i, DATE_FORMAT(vigencia_fim, '%Y-%m') AS f
           FROM versao_orcamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [versaoId, est],
      );
      return x ? { inicio: String(x.i), fim: String(x.f) } : null;
    });
  }

  celulas(c: ContextoOrcamento, versaoId: number): Promise<CelulaEstatisticaGravada[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const ls = await l.consultar(
        `SELECT o.id, o.indicador_orcamentario_id, o.centro_custo_id, DATE_FORMAT(o.competencia, '%Y-%m') AS mes,
                o.quantidade_orcada, o.quantidade_projetada, o.versao
           FROM valor_estatistico_orcado o
           JOIN versao_orcamento v ON v.id = o.versao_orcamento_id
          WHERE o.versao_orcamento_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            AND o.excluido_em IS NULL
          ORDER BY o.indicador_orcamentario_id, o.centro_custo_id, o.competencia LIMIT ${TETO_CELULAS}`,
        [versaoId, est],
        { teto: TETO_CELULAS },
      );
      return ls.map((x) => ({
        id: inteiro(x['id']),
        indicadorId: inteiro(x['indicador_orcamentario_id']),
        centroId: inteiro(x['centro_custo_id']),
        competencia: String(x['mes']),
        orcadoCent: cent(x['quantidade_orcada']) ?? 0,
        projetadaCent: cent(x['quantidade_projetada']),
        versao: inteiro(x['versao']),
      }));
    });
  }

  realizado(
    c: ContextoOrcamento,
    tiposDado: readonly number[],
    de: string,
    ate: string,
  ): Promise<RealizadoSetorMes[]> {
    const tipos = tiposDado.filter((t) => Number.isSafeInteger(t) && t > 0).slice(0, 200);
    if (tipos.length === 0) return Promise.resolve([]);
    const marcas = tipos.map(() => '?').join(', ');
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const ls = await l.consultar(
        `SELECT s.tipo_dado_estatistico_id AS t, s.centro_custo_id AS c, DATE_FORMAT(s.competencia, '%Y-%m') AS mes,
                SUM(s.quantidade) AS q
           FROM estatistica_centro_mes s
           JOIN centro_custo cc ON cc.id = s.centro_custo_id
          WHERE cc.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.tipo_dado_estatistico_id IN (${marcas})
            AND s.competencia BETWEEN ? AND ?
          GROUP BY s.tipo_dado_estatistico_id, s.centro_custo_id, s.competencia
          ORDER BY s.competencia LIMIT ${TETO_REALIZADO}`,
        [est, ...tipos, `${de}-01`, `${ate}-01`],
        { teto: TETO_REALIZADO },
      );
      return ls.map((x) => ({
        tipoDadoId: inteiro(x['t']),
        centroId: inteiro(x['c']),
        competencia: String(x['mes']),
        cent: cent(x['q']) ?? 0,
      }));
    });
  }

  gravarLinha(
    c: ContextoOrcamento,
    versaoId: number,
    indicadorId: number,
    centroId: number,
    celulas: readonly CelulaParaGravar[],
    g: GravacaoOrcamento,
  ): Promise<ResultadoLinhaEstatistica> {
    return this.gravar(c, opGravarLinha, { versaoId, indicadorId, centroId, celulas }, g);
  }
}
