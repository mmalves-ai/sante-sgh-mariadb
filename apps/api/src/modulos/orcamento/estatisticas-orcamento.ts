// Orçamento estatístico e indicadores orçamentários por setor (C1-129; ficha 07-FIN linha 131), na tela `Financeiro >
// Orçamento empresarial`, aba "Estatísticas e indicadores": o cadastro dos indicadores (diárias, exames, cirurgias:
// grupo, dado estatístico de origem do realizado, visão e projeção), a grade da versão (indicador × setor × mês, com a
// projeção sugerida do realizado) e o painel orçado × realizado por grupo e setor. As regras são de
// @sgh/dominio-financeiro (orcamento-estatistico.ts); aqui a porta (própria no MariaDB em
// estatisticas-orcamento-propria.ts; memória sintética de dev/ci para o E2E) e o serviço que valida, confere a versão e
// monta a visão. O realizado vem das estatísticas de custeio do setor (agregadas no banco; nenhuma linha de paciente).
// Desenho próprio: a linha inteira (os 12 meses do setor) grava de uma vez, com a trava otimista por célula; a célula
// esvaziada é retirada (lógica, nunca apagada); só a versão em elaboração recebe quantidades.
import {
  type CelulaDoPainel,
  type FalhaCampoOrcamento,
  type GrupoPainelIndicador,
  type IndicadorOrcamentarioEntrada,
  mesesDaVigencia,
  montarPainelIndicadores,
  PROJECOES_INDICADOR_ORCAMENTARIO,
  premissaEditavel,
  type ProjecaoIndicadorOrcamentario,
  projetarQuantidades,
  somarMeses,
  validarCelulasEstatisticas,
  validarIndicadorOrcamentario,
  VISOES_INDICADOR_ORCAMENTARIO,
  type VisaoIndicadorOrcamentario,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro } from '../cadastro/comum.js';
import type { DestinoPorta } from '../cadastro/tipos.js';
import type { ContextoOrcamento, GravacaoOrcamento, PortaOrcamento } from './porta.js';
import type { SessaoOrcamento } from './servico.js';

export const PORTA_ESTATISTICAS_ORCAMENTO = Symbol('PORTA_ESTATISTICAS_ORCAMENTO');

export interface GrupoIndicadorVisao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
}
export interface TipoDadoVisao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly unidade: string;
}
export interface IndicadorOrcamentarioVisao extends IndicadorOrcamentarioEntrada {
  readonly id: number;
  readonly versao: number;
}
export interface CatalogoIndicadores {
  readonly grupos: GrupoIndicadorVisao[];
  readonly tiposDado: TipoDadoVisao[];
  readonly indicadores: IndicadorOrcamentarioVisao[];
}

/** A célula gravada (quantidades em centésimos). */
export interface CelulaEstatisticaGravada {
  readonly id: number;
  readonly indicadorId: number;
  readonly centroId: number;
  readonly competencia: string;
  readonly orcadoCent: number;
  readonly projetadaCent: number | null;
  readonly versao: number;
}
export interface RealizadoSetorMes {
  readonly tipoDadoId: number;
  readonly centroId: number;
  readonly competencia: string;
  readonly cent: number;
}
export interface CelulaParaGravar {
  readonly competencia: string;
  readonly quantidadeCent: number | null;
  readonly projetadaCent: number | null;
  /** A versão da célula que a tela leu (null: a tela não tinha a célula). */
  readonly versao: number | null;
}
export interface ResultadoLinhaEstatistica {
  readonly incluidas: number;
  readonly alteradas: number;
  readonly retiradas: number;
}

export interface PortaEstatisticasOrcamento {
  readonly destino: DestinoPorta | 'indisponivel';
  catalogo(c: ContextoOrcamento): Promise<CatalogoIndicadores>;
  criarIndicador(
    c: ContextoOrcamento,
    x: IndicadorOrcamentarioEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ id: number }>;
  alterarIndicador(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    x: IndicadorOrcamentarioEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }>;
  /** A vigência da versão (AAAA-MM), do estabelecimento da sessão; null se não existe. */
  vigencia(c: ContextoOrcamento, versaoId: number): Promise<{ inicio: string; fim: string } | null>;
  celulas(c: ContextoOrcamento, versaoId: number): Promise<CelulaEstatisticaGravada[]>;
  realizado(
    c: ContextoOrcamento,
    tiposDado: readonly number[],
    de: string,
    ate: string,
  ): Promise<RealizadoSetorMes[]>;
  gravarLinha(
    c: ContextoOrcamento,
    versaoId: number,
    indicadorId: number,
    centroId: number,
    celulas: readonly CelulaParaGravar[],
    g: GravacaoOrcamento,
  ): Promise<ResultadoLinhaEstatistica>;
}

// ── Visão da grade ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface CelulaDaGrade {
  readonly id: number;
  readonly orcadoCent: number;
  readonly projetadaCent: number | null;
  readonly versao: number;
}
export interface LinhaDaGrade {
  readonly indicadorId: number;
  readonly centroId: number;
  /** Por competência (AAAA-MM). */
  readonly celulas: Record<string, CelulaDaGrade>;
  readonly realizado: Record<string, number>;
  readonly projecao: Record<string, number | null>;
}
export interface GradeEstatistica {
  readonly versaoId: number;
  readonly ano: number;
  readonly situacao: string;
  readonly editavel: boolean;
  readonly meses: string[];
  readonly ate: string;
  readonly centros: { id: number; codigo: number; nome: string }[];
  readonly indicadores: IndicadorOrcamentarioVisao[];
  readonly linhas: LinhaDaGrade[];
  readonly painel: GrupoPainelIndicador[];
}
export interface ProjecaoDaLinha {
  readonly indicadorId: number;
  readonly centroId: number;
  readonly projecao: Record<string, number | null>;
  readonly realizado: Record<string, number>;
}

// ── Entradas (Zod) ─────────────────────────────────────────────────────────────────────────────────────────────────

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim()));
const idOpcional = z.number().int().positive().nullable().optional().default(null);

export const esquemaIndicador = z.object({
  codigo: z.string().max(30),
  descricao: z.string().max(150),
  grupoId: idOpcional,
  tipoDadoId: idOpcional,
  unidade: textoOpcional(30),
  visao: z.enum(VISOES_INDICADOR_ORCAMENTARIO),
  tipoProjecao: z.enum(PROJECOES_INDICADOR_ORCAMENTARIO),
  mesesProjecao: z.number().int().nullable().optional().default(null),
  observacao: textoOpcional(2000),
  ativo: z.boolean().optional().default(true),
});
export const esquemaAlterarIndicador = esquemaIndicador.extend({ versao: z.number().int().min(0) });
const quantidade = z.number().int().nullable();
export const esquemaLinhaEstatistica = z.object({
  indicador: z.number().int().positive(),
  centro: z.number().int().positive(),
  celulas: z
    .array(
      z.object({
        competencia: z.string().max(7),
        quantidade,
        projetada: quantidade.optional().default(null),
        versao: z.number().int().min(0).nullable().optional().default(null),
      }),
    )
    .max(120),
});
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/u;

function invalido(campos: readonly FalhaCampoOrcamento[]): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    campos[0]?.mensagem ?? 'Confira os campos.',
    {
      campos: [...new Set(campos.map((f) => f.campo))],
    },
  );
}
function entrada<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success)
    throw invalido(r.error.issues.map((i) => ({ campo: i.path.map(String).join('.'), mensagem: i.message })));
  return r.data;
}
const naoEncontrada = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Orçamento não encontrado',
    'A versão não existe neste estabelecimento.',
  );
const fechada = () =>
  new ErroProblema(
    'recusa-de-negocio',
    409,
    'Versão fechada',
    'Só a versão em elaboração recebe quantidades: a aprovada, substituída ou descartada fica como foi decidida.',
    { codigo: 'versao-fechada' },
  );
async function gravando<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw problemaDoCadastro(e);
  }
}

export interface EventosEstatisticas {
  readonly indicador: string;
  readonly estatistica: string;
}

const mesAtual = (agora: Date) => agora.toISOString().slice(0, 7);
const normalizar = (x: z.infer<typeof esquemaIndicador>): IndicadorOrcamentarioEntrada => ({
  ...x,
  codigo: x.codigo.trim().toUpperCase(),
  descricao: x.descricao.trim(),
  mesesProjecao: x.tipoProjecao === 'nenhuma' ? null : x.mesesProjecao,
});

/** A orquestração: valida pela regra do domínio, confere a versão, o indicador e o setor e monta a visão. */
export class ServicoEstatisticasOrcamento {
  constructor(
    private readonly orcamento: PortaOrcamento,
    private readonly porta: PortaEstatisticasOrcamento,
    private readonly codigoEditar: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private gravacao(s: SessaoOrcamento, evento: string, operacao: string, tabela: string, id: number | null) {
    return {
      login: s.login,
      chaveIdempotencia: s.chaveIdempotencia,
      trilha: s.trilha(evento, operacao, tabela, id),
    };
  }

  catalogo(s: SessaoOrcamento): Promise<CatalogoIndicadores> {
    return this.porta.catalogo(s.porta);
  }

  private async conferirIndicador(s: SessaoOrcamento, x: IndicadorOrcamentarioEntrada): Promise<void> {
    const f = validarIndicadorOrcamentario(x);
    const cat = await this.porta.catalogo(s.porta);
    if (x.grupoId !== null && !cat.grupos.some((g) => g.id === x.grupoId))
      f.push({ campo: 'grupoId', mensagem: 'Escolha um grupo ativo.' });
    if (x.tipoDadoId !== null && !cat.tiposDado.some((t) => t.id === x.tipoDadoId))
      f.push({ campo: 'tipoDadoId', mensagem: 'Escolha um dado estatístico ativo.' });
    if (f.length) throw invalido(f);
  }

  async criarIndicador(s: SessaoOrcamento, corpo: unknown, ev: EventosEstatisticas): Promise<{ id: number }> {
    const x = normalizar(entrada(esquemaIndicador, corpo));
    await this.conferirIndicador(s, x);
    return gravando(() =>
      this.porta.criarIndicador(
        s.porta,
        x,
        this.gravacao(s, ev.indicador, 'incluir', 'indicador_orcamentario', null),
      ),
    );
  }

  async alterarIndicador(s: SessaoOrcamento, id: number, corpo: unknown, ev: EventosEstatisticas) {
    const bruto = entrada(esquemaAlterarIndicador, corpo);
    const x = normalizar(bruto);
    await this.conferirIndicador(s, x);
    return gravando(() =>
      this.porta.alterarIndicador(
        s.porta,
        id,
        bruto.versao,
        x,
        this.gravacao(s, ev.indicador, 'alterar', 'indicador_orcamentario', id),
      ),
    );
  }

  private async realizadoDe(
    s: SessaoOrcamento,
    indicadores: readonly IndicadorOrcamentarioVisao[],
    meses: readonly string[],
  ) {
    const tipos = [...new Set(indicadores.map((i) => i.tipoDadoId).filter((t): t is number => t !== null))];
    if (tipos.length === 0 || meses.length === 0) return [];
    // 36 meses antes da vigência alimentam a projeção; o realizado da vigência, o painel.
    return this.porta.realizado(s.porta, tipos, somarMeses(meses[0]!, -36), meses[meses.length - 1]!);
  }

  private static projecaoDaLinha(
    ind: IndicadorOrcamentarioVisao,
    centroId: number,
    realizado: readonly RealizadoSetorMes[],
    meses: readonly string[],
  ): { projecao: Record<string, number | null>; realizado: Record<string, number> } {
    const doSetor = realizado.filter((r) => r.tipoDadoId === ind.tipoDadoId && r.centroId === centroId);
    const proj = projetarQuantidades(
      ind.tipoProjecao as ProjecaoIndicadorOrcamentario,
      doSetor,
      meses,
      ind.mesesProjecao,
    );
    const real: Record<string, number> = {};
    for (const r of doSetor) if (meses.includes(r.competencia)) real[r.competencia] = r.cent;
    return { projecao: Object.fromEntries(proj), realizado: real };
  }

  async grade(s: SessaoOrcamento, versaoId: number, ateBruto: unknown): Promise<GradeEstatistica> {
    const v = await this.orcamento.versao(s.porta, versaoId);
    const vig = v ? await this.porta.vigencia(s.porta, versaoId) : null;
    if (!v || !vig) throw naoEncontrada();
    const meses = mesesDaVigencia(vig.inicio, vig.fim);
    const atual = mesAtual(this.agora());
    const pedido = typeof ateBruto === 'string' && COMPETENCIA.test(ateBruto) ? ateBruto : null;
    const ate =
      pedido && meses.includes(pedido)
        ? pedido
        : atual < vig.inicio
          ? vig.inicio
          : atual > vig.fim
            ? vig.fim
            : atual;
    const [cat, celulas, apoio] = await Promise.all([
      this.porta.catalogo(s.porta),
      this.porta.celulas(s.porta, versaoId),
      this.orcamento.apoio(s.porta),
    ]);
    const usados = new Set(celulas.map((c) => c.indicadorId));
    const indicadores = cat.indicadores.filter((i) => i.ativo || usados.has(i.id));
    const realizado = await this.realizadoDe(s, indicadores, meses);
    const chaves = new Map<string, { indicadorId: number; centroId: number }>();
    for (const c of celulas)
      chaves.set(`${c.indicadorId}|${c.centroId}`, { indicadorId: c.indicadorId, centroId: c.centroId });
    const linhas: LinhaDaGrade[] = [];
    for (const k of [...chaves.values()].sort(
      (a, b) => a.indicadorId - b.indicadorId || a.centroId - b.centroId,
    )) {
      const ind = indicadores.find((i) => i.id === k.indicadorId);
      if (!ind) continue;
      const cel: Record<string, CelulaDaGrade> = {};
      for (const c of celulas)
        if (c.indicadorId === k.indicadorId && c.centroId === k.centroId)
          cel[c.competencia] = {
            id: c.id,
            orcadoCent: c.orcadoCent,
            projetadaCent: c.projetadaCent,
            versao: c.versao,
          };
      linhas.push({
        ...k,
        celulas: cel,
        ...ServicoEstatisticasOrcamento.projecaoDaLinha(ind, k.centroId, realizado, meses),
      });
    }
    const centros = apoio.centros.map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome }));
    const nome = (id: number) => centros.find((c) => c.id === id)?.nome ?? `setor ${id}`;
    const doPainel: CelulaDoPainel[] = celulas.map((c) => {
      const ind = indicadores.find((i) => i.id === c.indicadorId);
      const r = realizado.find(
        (x) =>
          x.tipoDadoId === ind?.tipoDadoId && x.centroId === c.centroId && x.competencia === c.competencia,
      );
      return {
        indicadorId: c.indicadorId,
        centroId: c.centroId,
        competencia: c.competencia,
        orcadoCent: c.orcadoCent,
        realizadoCent: r ? r.cent : null,
      };
    });
    const painel = montarPainelIndicadores(
      indicadores.map((i) => ({
        id: i.id,
        codigo: i.codigo,
        descricao: i.descricao,
        unidade: i.unidade,
        visao: i.visao as VisaoIndicadorOrcamentario,
        grupo: cat.grupos.find((g) => g.id === i.grupoId) ?? null,
      })),
      doPainel,
      ate,
      nome,
    ).filter((g) => g.indicadores.some((i) => i.situacao !== 'sem_orcado'));
    return {
      versaoId,
      ano: v.ano,
      situacao: v.situacao,
      editavel: premissaEditavel(v.situacao) && s.pode(this.codigoEditar),
      meses,
      ate,
      centros,
      indicadores,
      linhas,
      painel,
    };
  }

  /** A projeção e o realizado de uma linha ainda sem célula (indicador × setor escolhidos na tela). */
  async projecao(
    s: SessaoOrcamento,
    versaoId: number,
    indicadorId: number,
    centroId: number,
  ): Promise<ProjecaoDaLinha> {
    const vig = await this.porta.vigencia(s.porta, versaoId);
    if (!vig) throw naoEncontrada();
    const ind = (await this.porta.catalogo(s.porta)).indicadores.find((i) => i.id === indicadorId);
    if (!ind) throw invalido([{ campo: 'indicador', mensagem: 'Escolha um indicador cadastrado.' }]);
    const meses = mesesDaVigencia(vig.inicio, vig.fim);
    const realizado = await this.realizadoDe(s, [ind], meses);
    return {
      indicadorId,
      centroId,
      ...ServicoEstatisticasOrcamento.projecaoDaLinha(ind, centroId, realizado, meses),
    };
  }

  async gravarLinha(
    s: SessaoOrcamento,
    versaoId: number,
    corpo: unknown,
    ev: EventosEstatisticas,
  ): Promise<ResultadoLinhaEstatistica> {
    const x = entrada(esquemaLinhaEstatistica, corpo);
    const v = await this.orcamento.versao(s.porta, versaoId);
    const vig = v ? await this.porta.vigencia(s.porta, versaoId) : null;
    if (!v || !vig) throw naoEncontrada();
    const celulas: CelulaParaGravar[] = x.celulas.map((c) => ({
      competencia: c.competencia,
      quantidadeCent: c.quantidade,
      projetadaCent: c.projetada,
      versao: c.versao,
    }));
    const f = validarCelulasEstatisticas(celulas, vig);
    const [cat, apoio] = await Promise.all([this.porta.catalogo(s.porta), this.orcamento.apoio(s.porta)]);
    const ind = cat.indicadores.find((i) => i.id === x.indicador);
    if (!ind || !ind.ativo) f.push({ campo: 'indicador', mensagem: 'Escolha um indicador ativo.' });
    if (!apoio.centros.some((c) => c.id === x.centro && c.ativo))
      f.push({ campo: 'centro', mensagem: 'Escolha um setor (centro de custo) ativo.' });
    if (f.length) throw invalido(f);
    if (!premissaEditavel(v.situacao)) throw fechada();
    return gravando(() =>
      this.porta.gravarLinha(
        s.porta,
        versaoId,
        x.indicador,
        x.centro,
        celulas,
        this.gravacao(s, ev.estatistica, 'gravar', 'valor_estatistico_orcado', versaoId),
      ),
    );
  }
}

// ── Porta em memória (sessão sintética de dev/ci e E2E) ─────────────────────────────────────────────────────────────

const conflito = () =>
  new ErroProblema(
    'conflito-de-versao',
    409,
    'Registro alterado',
    'O registro mudou depois que você abriu. Abra de novo para ver o atual.',
    { codigo: 'conflito-versao' },
  );

export class PortaEstatisticasOrcamentoMemoria implements PortaEstatisticasOrcamento {
  readonly destino = 'memoria' as const;
  private readonly grupos: GrupoIndicadorVisao[] = [
    { id: 1, codigo: 'INTERNACAO', descricao: 'Internação' },
    { id: 2, codigo: 'DIAGNOSTICO', descricao: 'Diagnóstico' },
  ];
  private readonly tipos: TipoDadoVisao[] = [
    { id: 1, codigo: 'PACIENTE_DIA', descricao: 'Pacientes-dia', unidade: 'paciente_dia' },
    { id: 2, codigo: 'EXAMES', descricao: 'Exames realizados', unidade: 'exame' },
  ];
  private readonly indicadores: IndicadorOrcamentarioVisao[] = [
    {
      id: 1,
      codigo: 'DIARIAS',
      descricao: 'Diárias (pacientes-dia)',
      grupoId: 1,
      tipoDadoId: 1,
      unidade: 'pacientes-dia',
      visao: 'acumulado',
      tipoProjecao: 'media',
      mesesProjecao: 6,
      observacao: null,
      ativo: true,
      versao: 1,
    },
    {
      id: 2,
      codigo: 'EXAMES',
      descricao: 'Exames realizados',
      grupoId: 2,
      tipoDadoId: 2,
      unidade: 'exames',
      visao: 'mensal',
      tipoProjecao: 'ultimo_mes',
      mesesProjecao: 3,
      observacao: null,
      ativo: true,
      versao: 1,
    },
  ];
  private readonly lista: (CelulaEstatisticaGravada & { versaoId: number; vivo: boolean })[] = [];
  private proximo = 1;

  constructor(
    private readonly orcamento: PortaOrcamento | null = null,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  catalogo(): Promise<CatalogoIndicadores> {
    return Promise.resolve({
      grupos: [...this.grupos],
      tiposDado: [...this.tipos],
      indicadores: [...this.indicadores].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    });
  }
  criarIndicador(_c: ContextoOrcamento, x: IndicadorOrcamentarioEntrada): Promise<{ id: number }> {
    if (this.indicadores.some((k) => k.codigo === x.codigo))
      return Promise.reject(
        new ErroProblema(
          'recusa-de-negocio',
          409,
          'Código repetido',
          'Já existe um indicador com este código.',
          {
            codigo: 'codigo-repetido',
          },
        ),
      );
    const id = this.indicadores.length + 1;
    this.indicadores.push({ id, ...x, versao: 1 });
    return Promise.resolve({ id });
  }
  alterarIndicador(_c: ContextoOrcamento, id: number, versao: number, x: IndicadorOrcamentarioEntrada) {
    const i = this.indicadores.findIndex((k) => k.id === id);
    const atual = this.indicadores[i];
    if (!atual || atual.versao !== versao) return Promise.reject(conflito());
    this.indicadores[i] = { id, ...x, versao: versao + 1 };
    return Promise.resolve({ versao: versao + 1 });
  }
  async vigencia(c: ContextoOrcamento, versaoId: number) {
    const v = this.orcamento ? await this.orcamento.versao(c, versaoId) : null;
    return v ? { inicio: `${v.ano}-01`, fim: `${v.ano}-12` } : null;
  }
  celulas(_c: ContextoOrcamento, versaoId: number): Promise<CelulaEstatisticaGravada[]> {
    return Promise.resolve(
      this.lista
        .filter((x) => x.versaoId === versaoId && x.vivo)
        .map((x) => ({
          id: x.id,
          indicadorId: x.indicadorId,
          centroId: x.centroId,
          competencia: x.competencia,
          orcadoCent: x.orcadoCent,
          projetadaCent: x.projetadaCent,
          versao: x.versao,
        })),
    );
  }
  /** Realizado sintético dos setores 101 a 103: (100 × tipo + final do setor) por mês, nos meses já passados. */
  realizado(_c: ContextoOrcamento, tipos: readonly number[], de: string, ate: string) {
    const atual = mesAtual(this.agora());
    const r: RealizadoSetorMes[] = [];
    for (const tipoDadoId of tipos)
      for (const centroId of [101, 102, 103])
        for (let m = de; m <= ate && m < atual; m = somarMeses(m, 1))
          r.push({ tipoDadoId, centroId, competencia: m, cent: (100 * tipoDadoId + (centroId % 100)) * 100 });
    return Promise.resolve(r);
  }
  gravarLinha(
    _c: ContextoOrcamento,
    versaoId: number,
    indicadorId: number,
    centroId: number,
    celulas: readonly CelulaParaGravar[],
  ): Promise<ResultadoLinhaEstatistica> {
    const achar = (comp: string) =>
      this.lista.find(
        (x) =>
          x.versaoId === versaoId &&
          x.indicadorId === indicadorId &&
          x.centroId === centroId &&
          x.competencia === comp,
      );
    for (const c of celulas) {
      const a = achar(c.competencia);
      if (a?.vivo && c.versao !== a.versao) return Promise.reject(conflito());
    }
    const r = { incluidas: 0, alteradas: 0, retiradas: 0 };
    for (const c of celulas) {
      const i = this.lista.findIndex((x) => x === achar(c.competencia));
      const a = this.lista[i];
      if (c.quantidadeCent === null) {
        if (a?.vivo) {
          this.lista[i] = { ...a, vivo: false, versao: a.versao + 1 };
          r.retiradas++;
        }
        continue;
      }
      if (a) {
        if (a.vivo && a.orcadoCent === c.quantidadeCent && a.projetadaCent === c.projetadaCent) continue;
        this.lista[i] = {
          ...a,
          orcadoCent: c.quantidadeCent,
          projetadaCent: c.projetadaCent,
          vivo: true,
          versao: a.versao + 1,
        };
        if (a.vivo) r.alteradas++;
        else r.incluidas++;
        continue;
      }
      this.lista.push({
        id: this.proximo++,
        versaoId,
        indicadorId,
        centroId,
        competencia: c.competencia,
        orcadoCent: c.quantidadeCent,
        projetadaCent: c.projetadaCent,
        versao: 1,
        vivo: true,
      });
      r.incluidas++;
    }
    return Promise.resolve(r);
  }
}

export function portaEstatisticasIndisponivel(): PortaEstatisticasOrcamento {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return {
    destino: 'indisponivel',
    catalogo: recusa,
    criarIndicador: recusa,
    alterarIndicador: recusa,
    vigencia: recusa,
    celulas: recusa,
    realizado: recusa,
    gravarLinha: recusa,
  };
}
