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
  type ExameCatalogo,
  type FalhaCatalogo,
  padroesADesmarcar,
  planejarProcedimentoOperacional,
  type ProcedimentoOperacional,
  SITUACOES_PROCEDIMENTO,
  TIPOS_RESULTADO_ANALITO,
  validarAnalito,
  planejarNovasFaixas,
  planejarNovaVersaoFormula,
  validarExame,
  validarExameLigado,
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

/** O esquema do vínculo: completo na inclusão; parcial na alteração (sem default, só o que veio). */
export function esquemaParcialVinculo(t: TipoVinculo, parcial = true): z.ZodType {
  const e = ESQUEMAS_VINCULO[t] as unknown as z.ZodType & { partial(): z.ZodType };
  return parcial ? e.partial() : e;
}

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

/** Uma ou várias faixas numa operação (a cobertura de idade que sobra vai junto; ver o domínio). */
export const esquemaFaixasCatalogo = z.union([
  z.object({ faixas: z.array(esquemaFaixaCatalogo).min(1).max(20) }),
  esquemaFaixaCatalogo.transform((f) => ({ faixas: [f] })),
]);

/**
 * Na alteração vale só o que veio: o esquema parcial (sem default) e só as chaves presentes no corpo. O campo que a tela
 * não mandou continua como está no banco.
 */
export function soEnviados(
  esquema: { partial(): { parse(x: unknown): unknown } },
  entrada: unknown,
): Record<string, unknown> {
  const bruto = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const lido = esquema.partial().parse(bruto) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(lido).filter(([k]) => bruto[k] !== undefined));
}

/** O analito (campo de resultado) da rede: incluído e alterado aqui; sai por inativação, nunca apagado. */
export const esquemaAnalitoCatalogo = z.object({
  versao,
  codigo: z.string().trim().min(1).max(30),
  nome: z.string().trim().min(2).max(150),
  tituloLaudo: texto(150),
  sigla: texto(20),
  tipoResultado: z.enum(TIPOS_RESULTADO_ANALITO).default('numerico'),
  casasDecimais: z.number().int().min(0).max(6).nullable().default(null),
  unidadeResultadoId: idNulo,
  metodoAnaliticoId: idNulo,
  codigoLoinc: z
    .string()
    .trim()
    .regex(/^\d{1,7}-\d$/)
    .nullable()
    .default(null),
  limiteMinimoAceito: z.number().nullable().default(null),
  limiteMaximoAceito: z.number().nullable().default(null),
  resultadoObrigatorio: z.boolean().default(true),
  imprimeNoLaudo: z.boolean().default(true),
  pulaNaDigitacao: z.boolean().default(false),
  ativo: z.boolean().default(true),
});

/** O procedimento operacional do exame (documento da qualidade): conteúdo, situação e vigência. */
const textoPop = texto(20000);
export const esquemaProcedimentoCatalogo = z.object({
  id: id.optional(),
  versao,
  codigoDocumento: z.string().trim().min(1).max(60),
  titulo: z.string().trim().min(3).max(200),
  /** Nova versão de um documento já aprovado: o número vem da regra (a seguinte à maior gravada). */
  versaoDocumento: z.number().int().min(1).max(65535).optional(),
  situacao: z.enum(SITUACOES_PROCEDIMENTO).default('rascunho'),
  vigenciaInicio: dataIso.nullable().default(null),
  vigenciaFim: dataIso.nullable().default(null),
  proximaRevisaoEm: dataIso.nullable().default(null),
  metodologia: textoPop,
  principioTeste: textoPop,
  preparoPaciente: textoPop,
  coletaAmostra: textoPop,
  reagentes: textoPop,
  procedimentoTecnico: textoPop,
  controleInterno: textoPop,
  valorReferencia: textoPop,
  interferentes: textoPop,
  limitacoesMetodo: textoPop,
  interpretacaoResultado: textoPop,
});
/** Os campos de conteúdo do documento (o aprovado não muda neles). */
const CONTEUDO_POP = [
  'codigoDocumento',
  'titulo',
  'metodologia',
  'principioTeste',
  'preparoPaciente',
  'coletaAmostra',
  'reagentes',
  'procedimentoTecnico',
  'controleInterno',
  'valorReferencia',
  'interferentes',
  'limitacoesMetodo',
  'interpretacaoResultado',
];

const TABELAS = [
  'exame',
  'analito',
  'procedimento_operacional_exame',
  'exame_setor_executante',
  'exame_material',
  'exame_orientacao_preparo',
  'exame_lateralidade',
  'exame_secundario',
  'exame_analito',
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
      const vinc = async (tipo: TipoVinculo, extra = '', tabelaVinculo = TABELA_VINCULO[tipo]) =>
        (
          await l.consultar(
            `SELECT v.* ${extra ? `, ${extra}` : ''} FROM ${tabelaVinculo} v
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
        procedimentos: (
          await l.consultar(
            `SELECT * FROM procedimento_operacional_exame
              WHERE exame_id = ? AND excluido_em IS NULL AND (? IS NULL OR estabelecimento_id = ?)
              ORDER BY codigo_documento, versao_documento DESC, id DESC`,
            [exameId, c.estabelecimento ?? null, c.estabelecimento ?? null],
          )
        ).map(camel),
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

  /**
   * Inclui (sem id) ou altera (com id e a versão vista) o exame, depois de conferir as regras do domínio. Na alteração
   * grava só os campos enviados; a regra é conferida sobre o exame como fica (o do banco com o que mudou).
   */
  salvarExame(c: ContextoCatalogo, exameId: number | null, entrada: unknown) {
    const enviado = exameId ? soEnviados(esquemaExameCatalogo, entrada) : esquemaExameCatalogo.parse(entrada);
    return this.gravar(c, exameId ? 'exame-alterado' : 'exame-incluido', 'exame', async (tx) => {
      const [atual] = exameId
        ? await tx.consultarParaAtualizar(`SELECT * FROM exame WHERE id = ? AND excluido_em IS NULL`, [
            exameId,
          ])
        : [null];
      if (exameId && !atual) throw inexistente('O exame');
      const fica = { ...(atual ? camel(atual) : {}), ...enviado } as unknown as ExameCatalogo & {
        ativo: boolean;
      };
      const falhas = validarExame(fica);
      if (falhas.length) recusar(falhas);
      const duplicado = await tx.consultar(
        `SELECT id FROM exame WHERE (codigo = ? OR sigla = ?) AND id <> ? LIMIT 1`,
        [fica.codigo, fica.sigla, exameId ?? 0],
      );
      if (duplicado.length)
        recusar([{ campo: 'codigo', mensagem: 'Já existe exame com este código ou sigla.' }]);
      const valores = colunas(enviado);
      if (!exameId || !atual) {
        const novo = await tx.incluir('exame', { ...valores, desativado_em: fica.ativo ? null : new Date() });
        return { id: novo, versao: 1 };
      }
      if ('ativo' in enviado && Boolean(enviado['ativo']) !== bool(atual['ativo']))
        valores['desativado_em'] = enviado['ativo'] ? null : new Date();
      const nova = await tx.alterar('exame', exameId, Number(enviado['versao'] ?? 0), valores);
      return { id: exameId, versao: nova };
    });
  }

  /**
   * Inclui ou altera um vínculo do exame; "remover" é inativar (ativo = false), nunca apagar. Na alteração grava só os
   * campos enviados (o resto continua como está).
   */
  salvarVinculo(c: ContextoCatalogo, tipo: TipoVinculo, exameId: number, entrada: unknown) {
    const bruto = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
    const alteracao = bruto['id'] !== undefined && bruto['id'] !== null;
    const e = alteracao
      ? soEnviados(ESQUEMAS_VINCULO[tipo], bruto)
      : (ESQUEMAS_VINCULO[tipo].parse(bruto) as Record<string, unknown>);
    const vid = alteracao ? Number(e['id']) : null;
    const tabela = TABELA_VINCULO[tipo];
    return this.gravar(c, `${tipo}-${vid ? 'alterado' : 'incluido'}`, tabela, async (tx) => {
      const [ex] = await tx.consultarParaAtualizar(
        `SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL`,
        [exameId],
      );
      if (!ex) throw inexistente('O exame');
      let atual: Record<string, unknown> = {};
      if (vid) {
        const [l] = await tx.consultarParaAtualizar(`SELECT * FROM ${tabela} WHERE id = ?`, [vid]);
        if (!l || Number(l['exame_id']) !== exameId) throw inexistente('O vínculo');
        atual = camel(l);
      }
      const fica = { ...atual, ...e };
      if (tipo === 'ligado' && fica['ativo']) {
        const ligacoes = await tx.consultar(
          `SELECT exame_id AS de, secundario_exame_id AS para FROM exame_secundario
            WHERE ativo = TRUE AND excluido_em IS NULL AND id <> ?`,
          [vid ?? 0],
        );
        const falhas = validarExameLigado(
          exameId,
          Number(fica['secundarioExameId']),
          ligacoes.map((l) => ({ de: Number(l['de']), para: Number(l['para']) })),
        );
        if (falhas.length) recusar(falhas);
      }
      const valores = colunas(e);
      if (tipo === 'material' && 'ativo' in e && Boolean(e['ativo']) !== Boolean(atual['ativo'] ?? true))
        valores['inativado_em'] = e['ativo'] ? null : new Date();
      if (tipo === 'material' && !vid && !e['ativo']) valores['inativado_em'] = new Date();
      let alvo: number;
      if (vid) {
        await tx.alterar(tabela, vid, Number(e['versao'] ?? 0), valores);
        alvo = vid;
      } else alvo = await tx.incluir(tabela, { ...valores, exame_id: exameId });
      if (fica['padrao'] && fica['ativo']) {
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

  /**
   * Nova versão da faixa de referência do analito no exame (uma ou várias faixas numa operação): encerra na véspera as
   * do estrato que as novas cobrem inteiras e guarda as versões. A cobertura parcial é recusada pelo domínio.
   */
  novaFaixa(c: ContextoCatalogo, exameAnalitoId: number, entrada: unknown) {
    const { faixas } = esquemaFaixasCatalogo.parse(entrada);
    return this.gravar(c, 'faixa-nova-versao', 'faixa_referencia', async (tx, hoje) => {
      const [ea] = await tx.consultarParaAtualizar(`SELECT id FROM exame_analito WHERE id = ?`, [
        exameAnalitoId,
      ]);
      if (!ea) throw inexistente('O analito do exame');
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT * FROM faixa_referencia WHERE exame_analito_id = ? AND ativo = TRUE
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [
          exameAnalitoId,
          faixas.reduce((m, f) => (f.vigenciaInicio < m ? f.vigenciaInicio : m), '9999-12-31'),
        ],
      );
      const plano = planejarNovasFaixas(
        faixas,
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
      const ids: number[] = [];
      for (const f of faixas) {
        const nova = await tx.incluir('faixa_referencia', {
          ...colunas(f),
          exame_analito_id: exameAnalitoId,
        });
        await tx.incluir('faixa_referencia_versao', {
          faixa_referencia_id: nova,
          operacao: 'inclusao',
          dados: JSON.stringify(f),
          ocorrido_em: agora,
          usuario_id: c.usuario ?? null,
          vigente_de: agora,
        });
        ids.push(nova);
      }
      return { id: ids[0] as number, ids, encerradas: plano.encerrar.map((x) => x.id) };
    });
  }

  /**
   * Nova versão da fórmula do analito calculado. As regras (expressão, variáveis do mesmo exame, sem autorreferência
   * nem ciclo, só analito calculado, nada retroativo, encerramento da anterior na véspera) são do domínio.
   */
  novaFormula(c: ContextoCatalogo, exameAnalitoId: number, entrada: unknown) {
    const f = esquemaFormulaCatalogo.parse(entrada);
    return this.gravar(c, 'formula-nova-versao', 'formula_calculo', async (tx, hoje) => {
      const [ea] = await tx.consultarParaAtualizar(
        `SELECT id, exame_id, analito_id, calculado FROM exame_analito WHERE id = ?`,
        [exameAnalitoId],
      );
      if (!ea) throw inexistente('O analito do exame');
      const doExame = await tx.consultar(
        `SELECT analito_id FROM exame_analito WHERE exame_id = ? AND ativo = TRUE`,
        [Number(ea['exame_id'])],
      );
      const deps = await tx.consultar(
        `SELECT ea.analito_id AS calculado, vf.analito_id AS usa
           FROM formula_calculo fc
           JOIN exame_analito ea ON ea.id = fc.exame_analito_id
           JOIN variavel_formula vf ON vf.formula_calculo_id = fc.id AND vf.excluido_em IS NULL
          WHERE ea.exame_id = ? AND ea.id <> ? AND fc.ativo = TRUE AND vf.analito_id IS NOT NULL
            AND (fc.vigencia_fim IS NULL OR fc.vigencia_fim >= ?)`,
        [Number(ea['exame_id']), exameAnalitoId, f.vigenciaInicio],
      );
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT id, versao, vigencia_inicio, vigencia_fim FROM formula_calculo
          WHERE exame_analito_id = ? AND ativo = TRUE AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [exameAnalitoId, f.vigenciaInicio],
      );
      const porAnalito = new Map<number, number[]>();
      for (const d of deps)
        porAnalito.set(Number(d['calculado']), [
          ...(porAnalito.get(Number(d['calculado'])) ?? []),
          Number(d['usa']),
        ]);
      const plano = planejarNovaVersaoFormula(f, {
        hoje,
        analitoAlvoId: Number(ea['analito_id']),
        calculado: bool(ea['calculado']),
        analitosDoExame: doExame.map((x) => Number(x['analito_id'])),
        vigentes: vigentes.map((v) => ({
          id: Number(v['id']),
          vigenciaInicio: dia(v['vigencia_inicio']) ?? '',
          vigenciaFim: dia(v['vigencia_fim']),
        })),
        dependencias: [...porAnalito].map(([analitoId, usa]) => ({ analitoId, usa })),
      });
      if (plano.falhas.length) recusar(plano.falhas);
      for (const enc of plano.encerrar) {
        const v = vigentes.find((x) => Number(x['id']) === enc.id) as Linha;
        await tx.alterar('formula_calculo', enc.id, Number(v['versao']), { vigencia_fim: enc.vigenciaFim });
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
      return { id: nova, encerradas: plano.encerrar.map((x) => x.id) };
    });
  }

  // ── Analito (campo de resultado) ───────────────────────────────────────────────────────────────────────────────

  /** Os analitos da rede (ativos e inativos), com o termo no nome, no código ou na sigla. */
  analitos(c: ContextoCatalogo, termo: string) {
    const t = `%${termo.trim()}%`;
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT a.*, u.simbolo AS simbolo_unidade FROM analito a
             LEFT JOIN unidade_resultado u ON u.id = a.unidade_resultado_id
            WHERE a.excluido_em IS NULL AND (? = '%%' OR a.nome LIKE ? OR a.codigo LIKE ? OR a.sigla LIKE ?)
            ORDER BY a.ativo DESC, a.nome, a.id LIMIT 300`,
          [t, t, t, t],
        )
      ).map(camel),
    );
  }

  /**
   * Inclui (sem id) ou altera (com id e a versão vista) o analito, depois da regra do domínio; na alteração grava só
   * o enviado. O código é único na rede; sair é inativar (o resultado antigo continua apontando para ele).
   */
  salvarAnalito(c: ContextoCatalogo, analitoId: number | null, entrada: unknown) {
    const enviado = analitoId
      ? soEnviados(esquemaAnalitoCatalogo, entrada)
      : esquemaAnalitoCatalogo.parse(entrada);
    return this.gravar(c, analitoId ? 'analito-alterado' : 'analito-incluido', 'analito', async (tx) => {
      const [atual] = analitoId
        ? await tx.consultarParaAtualizar(`SELECT * FROM analito WHERE id = ? AND excluido_em IS NULL`, [
            analitoId,
          ])
        : [null];
      if (analitoId && !atual) throw inexistente('O analito');
      const fica = { ...(atual ? camel(atual) : {}), ...enviado } as Record<string, unknown>;
      const falhas = validarAnalito({
        codigo: String(fica['codigo'] ?? ''),
        nome: String(fica['nome'] ?? ''),
        sigla: (fica['sigla'] as string | null) ?? null,
        tipoResultado: String(fica['tipoResultado'] ?? ''),
        casasDecimais: num(fica['casasDecimais']),
        unidadeResultadoId: num(fica['unidadeResultadoId']),
        limiteMinimoAceito: num(fica['limiteMinimoAceito']),
        limiteMaximoAceito: num(fica['limiteMaximoAceito']),
        pulaNaDigitacao: bool(fica['pulaNaDigitacao']),
      });
      if (falhas.length) recusar(falhas);
      const duplicado = await tx.consultar(`SELECT id FROM analito WHERE codigo = ? AND id <> ? LIMIT 1`, [
        fica['codigo'],
        analitoId ?? 0,
      ]);
      if (duplicado.length) recusar([{ campo: 'codigo', mensagem: 'Já existe analito com este código.' }]);
      const valores = colunas(enviado);
      if (!analitoId) return { id: await tx.incluir('analito', valores), versao: 1 };
      const nova = await tx.alterar('analito', analitoId, Number(enviado['versao'] ?? 0), valores);
      return { id: analitoId, versao: nova };
    });
  }

  // ── Procedimento operacional do exame ──────────────────────────────────────────────────────────────────────────

  /**
   * Inclui a versão do documento (rascunho; a seguinte à maior do mesmo código) ou altera a existente (só o enviado,
   * com a versão vista). Aprovar grava quem aprova (o profissional da conta da sessão, nunca escolhido) e a data, e
   * torna obsoleta a versão aprovada anterior, com a vigência encerrada na véspera. O aprovado não muda de conteúdo.
   */
  salvarProcedimento(c: ContextoCatalogo, exameId: number, entrada: unknown) {
    const bruto = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
    const pid = bruto['id'] !== undefined && bruto['id'] !== null ? Number(bruto['id']) : null;
    const e = pid ? soEnviados(esquemaProcedimentoCatalogo, bruto) : esquemaProcedimentoCatalogo.parse(bruto);
    const evento = pid ? 'procedimento-alterado' : 'procedimento-incluido';
    return this.gravar(c, evento, 'procedimento_operacional_exame', async (tx, hoje) => {
      if (!c.estabelecimento)
        throw new ErroOperacao(
          422,
          'sem-estabelecimento',
          'Procedimento operacional',
          'Escolha o estabelecimento.',
        );
      if (!c.usuario)
        throw new ErroOperacao(401, 'sem-usuario', 'Procedimento operacional', 'Falta a conta da sessão.');
      const [ex] = await tx.consultarParaAtualizar(
        `SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL`,
        [exameId],
      );
      if (!ex) throw inexistente('O exame');
      let atual: Record<string, unknown> | null = null;
      if (pid) {
        const [l] = await tx.consultarParaAtualizar(
          `SELECT * FROM procedimento_operacional_exame WHERE id = ? AND excluido_em IS NULL`,
          [pid],
        );
        if (!l || Number(l['exame_id']) !== exameId || Number(l['estabelecimento_id']) !== c.estabelecimento)
          throw inexistente('O procedimento operacional');
        atual = camel(l);
      }
      const codigo = String(e['codigoDocumento'] ?? atual?.['codigoDocumento'] ?? '');
      const outras = (
        await tx.consultarParaAtualizar(
          `SELECT id, exame_id, versao_documento, situacao, vigencia_inicio, vigencia_fim, versao
             FROM procedimento_operacional_exame
            WHERE estabelecimento_id = ? AND codigo_documento = ? AND excluido_em IS NULL AND id <> ?`,
          [c.estabelecimento, codigo, pid ?? 0],
        )
      ).map(camel);
      if (outras.some((o) => Number(o['exameId']) !== exameId))
        recusar([{ campo: 'codigoDocumento', mensagem: 'Este código de documento é de outro exame.' }]);
      const maior = outras.reduce((m, o) => Math.max(m, Number(o['versaoDocumento'])), 0);
      const fica = { ...(atual ?? {}), ...e } as Record<string, unknown>;
      if (!pid) fica['versaoDocumento'] = e['versaoDocumento'] ?? maior + 1;
      const valores = colunas(e);
      delete valores['versao_documento'];
      const aprovando = fica['situacao'] === 'aprovado' && atual?.['situacao'] !== 'aprovado';
      if (aprovando) {
        const v = await tx.uma(
          `SELECT v.profissional_id FROM usuario_vinculo_profissional v
             JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
            WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
              AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
            ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
          [c.usuario, c.estabelecimento],
        );
        fica['aprovadoPorProfissionalId'] = num(v?.['profissional_id']);
        fica['aprovadoEm'] = hoje;
        valores['aprovado_por_profissional_id'] = fica['aprovadoPorProfissionalId'];
        valores['aprovado_em'] = new Date();
      }
      if (fica['situacao'] === 'obsoleto' && atual?.['situacao'] !== 'obsoleto' && !fica['vigenciaFim']) {
        fica['vigenciaFim'] = hoje;
        valores['vigencia_fim'] = hoje;
      }
      const conteudoMudou = CONTEUDO_POP.some(
        (k) => k in e && atual !== null && ((e as Record<string, unknown>)[k] ?? null) !== (atual[k] ?? null),
      );
      const daLinha = (x: Record<string, unknown>): ProcedimentoOperacional => ({
        id: num(x['id']),
        codigoDocumento: String(x['codigoDocumento'] ?? ''),
        titulo: String(x['titulo'] ?? ''),
        versaoDocumento: Number(x['versaoDocumento'] ?? 1),
        situacao: x['situacao'] as ProcedimentoOperacional['situacao'],
        aprovadoPorProfissionalId: num(x['aprovadoPorProfissionalId']),
        aprovadoEm: x['aprovadoEm'] ? String(x['aprovadoEm']).slice(0, 10) : null,
        vigenciaInicio: dia(x['vigenciaInicio']),
        vigenciaFim: dia(x['vigenciaFim']),
        proximaRevisaoEm: dia(x['proximaRevisaoEm']),
      });
      const { falhas, plano } = planejarProcedimentoOperacional(
        daLinha(fica),
        atual ? daLinha(atual) : null,
        outras.map((o) => ({
          id: Number(o['id']),
          versaoDocumento: Number(o['versaoDocumento']),
          situacao: o['situacao'] as ProcedimentoOperacional['situacao'],
          vigenciaInicio: dia(o['vigenciaInicio']),
          vigenciaFim: dia(o['vigenciaFim']),
        })),
        conteudoMudou,
        hoje,
      );
      if (falhas.length) recusar(falhas);
      let alvo: number;
      if (pid) {
        await tx.alterar('procedimento_operacional_exame', pid, Number(e['versao'] ?? 0), valores);
        alvo = pid;
      } else
        alvo = await tx.incluir('procedimento_operacional_exame', {
          ...valores,
          versao_documento: fica['versaoDocumento'],
          tipo: 'exame',
          exame_id: exameId,
          estabelecimento_id: c.estabelecimento,
          elaborado_por_usuario_id: c.usuario,
        });
      for (const o of plano.obsoletar) {
        const linha = outras.find((x) => Number(x['id']) === o.id);
        await tx.alterar('procedimento_operacional_exame', o.id, Number(linha?.['versao'] ?? 0), {
          situacao: 'obsoleto',
          vigencia_fim: o.vigenciaFim,
        });
      }
      return { id: alvo, obsoletas: plano.obsoletar.map((o) => o.id) };
    });
  }

  /** As listas para os seletores da tela (id e nome, só os ativos), em vez de digitar o id. */
  opcoes(c: ContextoCatalogo) {
    const fontes: Record<string, string> = {
      setores: `SELECT id, nome FROM setor_diagnostico WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome`,
      materiais: `SELECT id, descricao AS nome FROM material_biologico WHERE ativo = TRUE ORDER BY descricao`,
      recipientes: `SELECT id, descricao AS nome FROM recipiente_coleta WHERE ativo = TRUE ORDER BY descricao`,
      preparos: `SELECT id, descricao AS nome FROM orientacao_preparo WHERE ativo = TRUE ORDER BY descricao`,
      analitos: `SELECT id, CONCAT(nome, ' (', codigo, ')') AS nome FROM analito
                  WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome`,
      sexos: `SELECT id, descricao AS nome FROM sexo WHERE ativo = TRUE ORDER BY id`,
      modalidades: `SELECT id, descricao AS nome FROM modalidade_imagem WHERE ativo = TRUE ORDER BY descricao`,
      metodos: `SELECT id, descricao AS nome FROM metodo_analitico WHERE ativo = TRUE ORDER BY descricao`,
      especialidades: `SELECT id, descricao AS nome FROM especialidade_diagnostica WHERE ativo = TRUE ORDER BY descricao`,
      unidades: `SELECT id, CONCAT(simbolo, ' · ', descricao) AS nome FROM unidade_resultado
                  WHERE ativo = TRUE ORDER BY simbolo`,
      exames: `SELECT id, CONCAT(sigla, ' · ', nome) AS nome FROM exame
                WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 2000`,
    };
    return this.ler(c, async (l) => {
      const r: Record<string, { id: number; nome: string }[]> = {};
      for (const [k, sql] of Object.entries(fontes))
        r[k] = (await l.consultar(sql, [])).map((x) => ({ id: Number(x['id']), nome: String(x['nome']) }));
      return r;
    });
  }
}

/** As colunas BOOLEAN (TINYINT 1/0 no driver) e DECIMAL (texto no driver) do catálogo, devolvidas como tipo de JS. */
const BOOLEANOS = new Set([
  'ativo',
  'resultado_obrigatorio',
  'resultado_fixo',
  'imprime_no_laudo',
  'imprime_etiqueta_triagem',
  'pula_na_digitacao',
  'padrao',
  'atende_feriado',
  'lanca_automaticamente',
  'obrigatorio',
  'calculado',
  'exige_laudo',
]);
const DECIMAIS =
  /^(volume_minimo_ml|custo_unitario|multiplicador_cobranca|limite_(minimo|maximo)_aceito|(referencia|alerta|critico|absurdo)_(minima|maxima|minimo|maximo))$/;

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
          : BOOLEANOS.has(k)
            ? bool(v)
            : DECIMAIS.test(k) && v !== null
              ? Number(v)
              : v;
  }
  return r;
}
