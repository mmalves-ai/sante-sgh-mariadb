// Manutenção do catálogo de exames do diagnóstico (F3.5, análise 05-SADT linhas 1 a 3) sobre o banco do cliente, pelo
// @sgh/nucleo. O catálogo é da rede inteira (sem estabelecimento), lido em transação somente leitura e gravado pelo
// Executor (trava otimista pela `versao`, trilha e idempotência na mesma transação).
// Uma ficha por exame, numa tela só: o exame, onde é feito (setor executante), o material e o recipiente, o preparo, a
// lateralidade, os exames ligados, os analitos do exame com a faixa de referência (histórico inteiro) e a fórmula.
// Melhoria: nada se apaga. O vínculo sai por inativação (o histórico do pedido antigo continua apontando para ele); a
// faixa de referência e a fórmula ganham nova versão com vigência (a anterior se encerra na véspera, e a linha de
// versão da faixa guarda o que mudou); o exame sai por desativação com a data. As regras ficam no domínio
// (@sgh/dominio-sadt, catalogo/regras.ts) e são conferidas antes de gravar, com a mensagem por campo.
import {
  padroesADesmarcar,
  planejarNovaVersaoFaixa,
  validarExame,
  validarExameLigado,
  validarFormula,
  type FalhaCatalogo,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const CATALOGO_SADT = Symbol('CATALOGO_SADT');

export type ContextoCatalogo = ContextoNucleo & { readonly chaveIdempotencia?: string };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

const id = z.number().int().positive();
const idNulo = id.nullable().default(null);
const inteiroNulo = z.number().int().min(0).nullable().default(null);
const texto = (max: number) => z.string().trim().max(max).nullable().default(null);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive().optional();

export const esquemaExameCatalogo = z.object({
  versao,
  codigo: z.string().trim().min(1).max(30),
  sigla: z.string().trim().min(1).max(10),
  nome: z.string().trim().min(2).max(150),
  nomePopular: texto(150),
  tipoServico: z.string(),
  tipoResultado: z.enum(['numerico', 'texto', 'lista', 'laudo', 'cultura', 'misto']).default('numerico'),
  especialidadeDiagnosticaId: idNulo,
  modalidadeImagemId: idNulo,
  sexoId: idNulo,
  idadeMinimaDias: inteiroNulo,
  idadeMaximaDias: inteiroNulo,
  prazoEntregaHoras: inteiroNulo,
  limiteSolicitacoes: inteiroNulo,
  periodoLimiteDias: inteiroNulo,
  custoUnitario: z.number().nullable().default(null),
  orientacaoGeral: texto(4000),
  exigeLaudo: z.boolean().default(false),
  ativo: z.boolean().default(true),
});
export type ExameCatalogoEntrada = z.infer<typeof esquemaExameCatalogo>;

const comuns = { id: id.optional(), versao, ativo: z.boolean().default(true) };

/** Os vínculos do exame que a ficha mantém: tabela, campos da tela → colunas, e quem tem padrão único. */
export const ESQUEMAS_VINCULO = {
  setor: z.object({
    ...comuns,
    setorDiagnosticoId: id,
    bancadaAnaliticaId: idNulo,
    padrao: z.boolean().default(false),
    prazoEntregaHoras: inteiroNulo,
    atendeFeriado: z.boolean().default(false),
    horarioEspecial: texto(500),
  }),
  material: z.object({
    ...comuns,
    materialBiologicoId: id,
    recipienteColetaId: idNulo,
    padrao: z.boolean().default(false),
    volumeMinimoMl: z.number().positive().nullable().default(null),
    conservacao: z
      .enum(['ambiente', 'refrigerado', 'congelado', 'protegido_luz', 'gelo'])
      .default('ambiente'),
    estabilidadeHoras: inteiroNulo,
  }),
  preparo: z.object({
    ...comuns,
    orientacaoPreparoId: id,
    materialBiologicoId: idNulo,
    setorDiagnosticoId: idNulo,
    publico: z.enum(['todos', 'adulto', 'crianca', 'gestante', 'idoso']).default('todos'),
    ordemImpressao: z.number().int().min(1).default(1),
  }),
  lateralidade: z.object({
    ...comuns,
    lado: z.enum(['direito', 'esquerdo', 'bilateral']),
    multiplicadorCobranca: z.number().positive().max(999).default(1),
  }),
  ligado: z.object({
    ...comuns,
    secundarioExameId: id,
    tipoRelacao: z.enum(['secundario', 'correlacionado', 'incluido']).default('secundario'),
    lancaAutomaticamente: z.boolean().default(true),
  }),
  analito: z.object({
    ...comuns,
    analitoId: id,
    ordem: z.number().int().min(1).max(65535),
    obrigatorio: z.boolean().default(true),
    calculado: z.boolean().default(false),
    unidadeResultadoId: idNulo,
    metodoAnaliticoId: idNulo,
    grupoRespostaId: idNulo,
    casasDecimais: z.number().int().min(0).max(8).nullable().default(null),
  }),
} as const;
export type TipoVinculo = keyof typeof ESQUEMAS_VINCULO;

const TABELA_VINCULO: Readonly<Record<TipoVinculo, string>> = {
  setor: 'exame_setor_executante',
  material: 'exame_material',
  preparo: 'exame_orientacao_preparo',
  lateralidade: 'exame_lateralidade',
  ligado: 'exame_secundario',
  analito: 'exame_analito',
};

export const esquemaFaixaCatalogo = z.object({
  sexoId: idNulo,
  idadeMinimaDias: inteiroNulo,
  idadeMaximaDias: inteiroNulo,
  materialBiologicoId: idNulo,
  metodoAnaliticoId: idNulo,
  condicao: z.string().default('nenhuma'),
  referenciaMinima: z.number().nullable().default(null),
  referenciaMaxima: z.number().nullable().default(null),
  alertaMinimo: z.number().nullable().default(null),
  alertaMaximo: z.number().nullable().default(null),
  criticoMinimo: z.number().nullable().default(null),
  criticoMaximo: z.number().nullable().default(null),
  absurdoMinimo: z.number().nullable().default(null),
  absurdoMaximo: z.number().nullable().default(null),
  referenciaTexto: texto(300),
  vigenciaInicio: dataIso,
});

export const esquemaFormulaCatalogo = z.object({
  descricao: z.string().trim().min(2).max(150),
  expressao: z.string().trim().min(1).max(2000),
  casasDecimais: z.number().int().min(0).max(8).nullable().default(null),
  vigenciaInicio: dataIso,
  variaveis: z
    .array(
      z.object({
        identificador: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,9}$/),
        descricao: z.string().trim().min(1).max(150),
        fonte: z.enum(['analito', 'dado_paciente', 'digitado']),
        analitoId: idNulo,
        dadoPaciente: z
          .enum(['peso', 'altura', 'idade', 'sexo', 'superficie_corporal', 'raca_cor'])
          .nullable()
          .default(null),
      }),
    )
    .max(30),
});

const TABELAS = [
  'exame',
  ...Object.values(TABELA_VINCULO),
  'faixa_referencia',
  'faixa_referencia_versao',
  'formula_calculo',
  'variavel_formula',
];

/** 422 com as falhas por campo (a tela marca cada uma). */
function recusar(falhas: readonly FalhaCatalogo[]): never {
  throw new ErroOperacao(
    422,
    'regra-catalogo',
    'Catálogo de exames',
    falhas.map((f) => `${f.campo}: ${f.mensagem}`).join(' '),
  );
}

const inexistente = (o: string) =>
  new ErroOperacao(404, 'registro-inexistente', 'Registro inexistente', `${o} não existe.`);

/** Colunas do vínculo a partir da entrada da tela (camelCase → snake_case; sem id, versão). */
function colunas(e: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'id' || k === 'versao') continue;
    r[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] = v;
  }
  return r;
}

export interface ResumoExameCatalogo {
  readonly id: number;
  readonly codigo: string;
  readonly sigla: string;
  readonly nome: string;
  readonly tipoServico: string;
  readonly ativo: boolean;
  readonly versao: number;
}

export class PortaCatalogoSadtPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoCatalogo, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: c.cliente, correlacao: (c.correlacao || 'sadt.catalogo').slice(0, 64) },
      fn,
    );
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────

  listar(c: ContextoCatalogo, termo: string, tipo: string | null): Promise<ResumoExameCatalogo[]> {
    const t = `%${termo.trim()}%`;
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, codigo, sigla, nome, tipo_servico, ativo, versao FROM exame
            WHERE excluido_em IS NULL AND (? = '%%' OR nome LIKE ? OR codigo LIKE ? OR sigla LIKE ?)
              AND (? IS NULL OR tipo_servico = ?)
            ORDER BY ativo DESC, nome, id LIMIT 200`,
          [t, t, t, t, tipo, tipo],
        )
      ).map((r) => ({
        id: Number(r['id']),
        codigo: String(r['codigo']),
        sigla: String(r['sigla']),
        nome: String(r['nome']),
        tipoServico: String(r['tipo_servico']),
        ativo: bool(r['ativo']),
        versao: Number(r['versao']),
      })),
    );
  }

  /** A ficha do exame: o exame, os vínculos (ativos e inativos), as faixas (todas as versões) e as fórmulas. */
  ficha(c: ContextoCatalogo, exameId: number) {
    return this.ler(c, async (l) => {
      const exame = await l.uma(`SELECT * FROM exame WHERE id = ? AND excluido_em IS NULL`, [exameId]);
      if (!exame) throw inexistente('O exame');
      const vinc = async (tipo: TipoVinculo, extra = '') =>
        (
          await l.consultar(
            `SELECT v.* ${extra ? `, ${extra}` : ''} FROM ${TABELA_VINCULO[tipo]} v
              ${tipo === 'setor' ? 'JOIN setor_diagnostico s ON s.id = v.setor_diagnostico_id' : ''}
              ${tipo === 'material' ? 'JOIN material_biologico m ON m.id = v.material_biologico_id' : ''}
              ${tipo === 'preparo' ? 'JOIN orientacao_preparo o ON o.id = v.orientacao_preparo_id' : ''}
              ${tipo === 'ligado' ? 'JOIN exame e2 ON e2.id = v.secundario_exame_id' : ''}
              ${tipo === 'analito' ? 'JOIN analito a ON a.id = v.analito_id' : ''}
             WHERE v.exame_id = ? ORDER BY v.ativo DESC, v.id`,
            [exameId],
          )
        ).map(camel);
      const analitos = await vinc('analito', 'a.nome AS nome_analito, a.codigo AS codigo_analito');
      const ids = analitos.map((a) => Number(a['id']));
      const faixas = ids.length
        ? (
            await l.consultar(
              `SELECT * FROM faixa_referencia WHERE exame_analito_id IN (${ids.map(() => '?').join(',')})
                ORDER BY exame_analito_id, vigencia_inicio DESC, id DESC`,
              ids,
            )
          ).map(camel)
        : [];
      const formulas = ids.length
        ? (
            await l.consultar(
              `SELECT * FROM formula_calculo WHERE exame_analito_id IN (${ids.map(() => '?').join(',')})
                ORDER BY exame_analito_id, vigencia_inicio DESC, id DESC`,
              ids,
            )
          ).map(camel)
        : [];
      const fIds = formulas.map((f) => Number(f['id']));
      const variaveis = fIds.length
        ? (
            await l.consultar(
              `SELECT * FROM variavel_formula WHERE formula_calculo_id IN (${fIds.map(() => '?').join(',')})
                 AND excluido_em IS NULL ORDER BY formula_calculo_id, sequencia`,
              fIds,
            )
          ).map(camel)
        : [];
      return {
        exame: camel(exame),
        setores: await vinc('setor', 's.nome AS nome_setor'),
        materiais: await vinc('material', 'm.descricao AS nome_material'),
        preparos: await vinc('preparo', 'o.descricao AS descricao_preparo'),
        lateralidades: await vinc('lateralidade'),
        ligados: await vinc('ligado', 'e2.nome AS nome_ligado, e2.sigla AS sigla_ligado'),
        analitos: analitos.map((a) => ({
          ...a,
          faixas: faixas.filter((f) => Number(f['exameAnalitoId']) === Number(a['id'])),
          formulas: formulas
            .filter((f) => Number(f['exameAnalitoId']) === Number(a['id']))
            .map((f) => ({
              ...f,
              variaveis: variaveis.filter((v) => Number(v['formulaCalculoId']) === Number(f['id'])),
            })),
        })),
      };
    });
  }

  // ── Gravações ───────────────────────────────────────────────────────────────────────────────────────────────

  private async gravar<T extends { id: number }>(
    c: ContextoCatalogo,
    evento: string,
    tabela: string,
    fn: (tx: TxOperacao, hoje: string) => Promise<T>,
  ): Promise<T> {
    let saida: T | null = null;
    const op = definirOperacao({
      nome: `sadt.catalogo.${evento}`,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const h = await tx.consultar('SELECT CURRENT_DATE AS hoje');
        saida = await fn(tx, dia(h[0]?.['hoje']) ?? '');
        return { resultado: JSON.stringify(saida) };
      },
      alvo: () => ({ tabela, id: saida?.id ?? null }),
      trilha: () => ({ dados: { evento: `sadt.catalogo.${evento}` } }),
    });
    const chave = `sadt.catalogo:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(op, c.cliente, { chave }, { ...c, chaveIdempotencia: chave });
    if (saida) return saida;
    return JSON.parse(String(r.resultado['resultado'] ?? 'null')) as T;
  }

  /** Inclui (sem id) ou altera (com id e a versão vista) o exame, depois de conferir as regras do domínio. */
  salvarExame(c: ContextoCatalogo, exameId: number | null, e: ExameCatalogoEntrada) {
    const falhas = validarExame(e);
    if (falhas.length) recusar(falhas);
    return this.gravar(c, exameId ? 'exame-alterado' : 'exame-incluido', 'exame', async (tx) => {
      const { versao: v, ativo, ...resto } = e;
      const valores = { ...colunas(resto), ativo };
      const duplicado = await tx.consultar(
        `SELECT id FROM exame WHERE (codigo = ? OR sigla = ?) AND id <> ? LIMIT 1`,
        [e.codigo, e.sigla, exameId ?? 0],
      );
      if (duplicado.length)
        recusar([{ campo: 'codigo', mensagem: 'Já existe exame com este código ou sigla.' }]);
      if (!exameId) {
        const novo = await tx.incluir('exame', { ...valores, desativado_em: ativo ? null : new Date() });
        return { id: novo, versao: 1 };
      }
      const [atual] = await tx.consultarParaAtualizar(`SELECT ativo FROM exame WHERE id = ?`, [exameId]);
      if (!atual) throw inexistente('O exame');
      const desativado = !ativo && bool(atual['ativo']) ? { desativado_em: new Date() } : {};
      const reativado = ativo ? { desativado_em: null } : {};
      const nova = await tx.alterar('exame', exameId, v ?? 0, { ...valores, ...desativado, ...reativado });
      return { id: exameId, versao: nova };
    });
  }

  /** Inclui ou altera um vínculo do exame; "remover" é inativar (ativo = false), nunca apagar. */
  salvarVinculo(c: ContextoCatalogo, tipo: TipoVinculo, exameId: number, entrada: Record<string, unknown>) {
    const e = ESQUEMAS_VINCULO[tipo].parse(entrada) as Record<string, unknown> & {
      id?: number;
      versao?: number;
      ativo: boolean;
      padrao?: boolean;
    };
    const tabela = TABELA_VINCULO[tipo];
    return this.gravar(c, `${tipo}-${e.id ? 'alterado' : 'incluido'}`, tabela, async (tx) => {
      const [ex] = await tx.consultarParaAtualizar(
        `SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL`,
        [exameId],
      );
      if (!ex) throw inexistente('O exame');
      if (tipo === 'ligado' && e.ativo) {
        const ligacoes = await tx.consultar(
          `SELECT exame_id AS de, secundario_exame_id AS para FROM exame_secundario
            WHERE ativo = TRUE AND excluido_em IS NULL AND id <> ?`,
          [e.id ?? 0],
        );
        const falhas = validarExameLigado(
          exameId,
          Number(e['secundarioExameId']),
          ligacoes.map((l) => ({ de: Number(l['de']), para: Number(l['para']) })),
        );
        if (falhas.length) recusar(falhas);
      }
      let alvo: number;
      const valores = { ...colunas(e), exame_id: exameId };
      if (tipo === 'material' && !e.ativo) Object.assign(valores, { inativado_em: new Date() });
      if (e.id) {
        const [l] = await tx.consultarParaAtualizar(`SELECT exame_id FROM ${tabela} WHERE id = ?`, [e.id]);
        if (!l || Number(l['exame_id']) !== exameId) throw inexistente('O vínculo');
        await tx.alterar(tabela, e.id, e.versao ?? 0, valores);
        alvo = e.id;
      } else alvo = await tx.incluir(tabela, valores);
      if (e.padrao && e.ativo) {
        const outros = await tx.consultarParaAtualizar(
          `SELECT id, padrao, ativo, versao FROM ${tabela} WHERE exame_id = ? AND padrao = TRUE`,
          [exameId],
        );
        const desmarcar = padroesADesmarcar(
          outros.map((o) => ({ id: Number(o['id']), padrao: bool(o['padrao']), ativo: bool(o['ativo']) })),
          alvo,
        );
        for (const o of outros)
          if (desmarcar.includes(Number(o['id'])))
            await tx.alterar(tabela, Number(o['id']), Number(o['versao']), { padrao: false });
      }
      return { id: alvo };
    });
  }

  /** Nova versão da faixa de referência do analito no exame: encerra a anterior do estrato e guarda as versões. */
  novaFaixa(c: ContextoCatalogo, exameAnalitoId: number, entrada: unknown) {
    const f = esquemaFaixaCatalogo.parse(entrada);
    return this.gravar(c, 'faixa-nova-versao', 'faixa_referencia', async (tx, hoje) => {
      const [ea] = await tx.consultarParaAtualizar(`SELECT id FROM exame_analito WHERE id = ?`, [
        exameAnalitoId,
      ]);
      if (!ea) throw inexistente('O analito do exame');
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT * FROM faixa_referencia WHERE exame_analito_id = ? AND ativo = TRUE
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [exameAnalitoId, f.vigenciaInicio],
      );
      const plano = planejarNovaVersaoFaixa(
        f,
        vigentes.map((v) => ({
          id: Number(v['id']),
          sexoId: num(v['sexo_id']),
          idadeMinimaDias: num(v['idade_minima_dias']),
          idadeMaximaDias: num(v['idade_maxima_dias']),
          materialBiologicoId: num(v['material_biologico_id']),
          metodoAnaliticoId: num(v['metodo_analitico_id']),
          condicao: String(v['condicao']),
          vigenciaInicio: dia(v['vigencia_inicio']) ?? '',
          vigenciaFim: dia(v['vigencia_fim']),
        })),
        hoje,
      );
      if (plano.falhas.length) recusar(plano.falhas);
      const agora = new Date();
      for (const enc of plano.encerrar) {
        const v = vigentes.find((x) => Number(x['id']) === enc.id) as Linha;
        await tx.alterar('faixa_referencia', enc.id, Number(v['versao']), { vigencia_fim: enc.vigenciaFim });
        const abertas = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM faixa_referencia_versao WHERE faixa_referencia_id = ? AND vigente_ate IS NULL`,
          [enc.id],
        );
        for (const a of abertas)
          await tx.alterar('faixa_referencia_versao', Number(a['id']), Number(a['versao']), {
            vigente_ate: agora,
          });
        await tx.incluir('faixa_referencia_versao', {
          faixa_referencia_id: enc.id,
          operacao: 'alteracao',
          dados: JSON.stringify({ vigenciaFim: enc.vigenciaFim }),
          ocorrido_em: agora,
          usuario_id: c.usuario ?? null,
          vigente_de: agora,
        });
      }
      const nova = await tx.incluir('faixa_referencia', { ...colunas(f), exame_analito_id: exameAnalitoId });
      await tx.incluir('faixa_referencia_versao', {
        faixa_referencia_id: nova,
        operacao: 'inclusao',
        dados: JSON.stringify(f),
        ocorrido_em: agora,
        usuario_id: c.usuario ?? null,
        vigente_de: agora,
      });
      return { id: nova, encerradas: plano.encerrar.map((x) => x.id) };
    });
  }

  /** Nova versão da fórmula do analito calculado: conferida na hora; a anterior em vigor se encerra na véspera. */
  novaFormula(c: ContextoCatalogo, exameAnalitoId: number, entrada: unknown) {
    const f = esquemaFormulaCatalogo.parse(entrada);
    const falhas = validarFormula(
      f.expressao,
      f.variaveis.map((v) => v.identificador),
    );
    for (const v of f.variaveis) {
      if (v.fonte === 'analito' && !v.analitoId)
        falhas.push({ campo: 'variaveis', mensagem: `A variável ${v.identificador} precisa do analito.` });
      if ((v.fonte === 'dado_paciente') !== (v.dadoPaciente !== null))
        falhas.push({
          campo: 'variaveis',
          mensagem: `A variável ${v.identificador}: dado do paciente só com a fonte paciente.`,
        });
    }
    if (falhas.length) recusar(falhas);
    return this.gravar(c, 'formula-nova-versao', 'formula_calculo', async (tx, hoje) => {
      if (f.vigenciaInicio < hoje)
        recusar([
          { campo: 'vigenciaInicio', mensagem: 'A nova fórmula começa hoje ou depois (nada retroativo).' },
        ]);
      const [ea] = await tx.consultarParaAtualizar(`SELECT id FROM exame_analito WHERE id = ?`, [
        exameAnalitoId,
      ]);
      if (!ea) throw inexistente('O analito do exame');
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT id, versao, vigencia_inicio FROM formula_calculo
          WHERE exame_analito_id = ? AND ativo = TRUE AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [exameAnalitoId, f.vigenciaInicio],
      );
      for (const v of vigentes) {
        if ((dia(v['vigencia_inicio']) ?? '') >= f.vigenciaInicio)
          recusar([{ campo: 'vigenciaInicio', mensagem: 'Já há fórmula começando nesta data ou depois.' }]);
        const fim = new Date(`${f.vigenciaInicio}T00:00:00Z`);
        fim.setUTCDate(fim.getUTCDate() - 1);
        await tx.alterar('formula_calculo', Number(v['id']), Number(v['versao']), {
          vigencia_fim: fim.toISOString().slice(0, 10),
        });
      }
      const seq = await tx.consultar(`SELECT COUNT(*) AS n FROM formula_calculo WHERE exame_analito_id = ?`, [
        exameAnalitoId,
      ]);
      const nova = await tx.incluir('formula_calculo', {
        codigo: `EA${exameAnalitoId}V${Number(seq[0]?.['n'] ?? 0) + 1}`.slice(0, 30),
        descricao: f.descricao,
        alvo: 'analito',
        exame_analito_id: exameAnalitoId,
        expressao: f.expressao,
        casas_decimais: f.casasDecimais,
        vigencia_inicio: f.vigenciaInicio,
      });
      let n = 0;
      for (const v of f.variaveis)
        await tx.incluir('variavel_formula', {
          formula_calculo_id: nova,
          sequencia: ++n,
          identificador: v.identificador,
          descricao: v.descricao,
          fonte: v.fonte,
          analito_id: v.fonte === 'analito' ? v.analitoId : null,
          dado_paciente: v.dadoPaciente,
        });
      return { id: nova, encerradas: vigentes.map((v) => Number(v['id'])) };
    });
  }
}

/** Linha do banco → objeto da tela (snake_case → camelCase; datas em ISO). */
function camel(l: Linha): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(l)) {
    const c = k.replace(/_([a-z0-9])/g, (_m, x: string) => x.toUpperCase());
    r[c] =
      v instanceof Date
        ? /_(inicio|fim)$/.test(k)
          ? v.toISOString().slice(0, 10)
          : v.toISOString()
        : typeof v === 'bigint'
          ? Number(v)
          : v;
  }
  return r;
}
