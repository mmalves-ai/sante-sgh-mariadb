// Cadastro do laudo estruturado no MariaDB do cliente (F3.5, análise 05-SADT linha 17): as seções do laudo do exame
// (câmaras, valvas, função), as medidas de cada seção (grandezas, com unidade, casas decimais, obrigatória na
// assinatura e calculada), as faixas de referência de cada medida (por sexo, idade, peso e superfície corporal, com
// vigência) e a fórmula da medida calculada (nova versão encerra a anterior na véspera; o laudo antigo continua com a
// conta da época). Nada é apagado: seção, medida e faixa saem por inativação. A regra é do domínio
// (grandeza-calculada.ts); a trilha vai na mesma transação (Executor). Também lê as fórmulas para a redação do laudo.
import {
  type FaixaGrandezaCadastro,
  type FormulaDaGrandeza,
  planejarFormulaGrandeza,
  validarFaixaGrandeza,
  validarGrandezaLaudo,
  validarSecaoLaudo,
} from '@sgh/dominio-sadt';
import {
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  camel,
  colunas,
  type ContextoCatalogo,
  inexistente,
  recusar,
  soEnviados,
} from './catalogo-porta-propria.js';

export const GRANDEZAS_LAUDO = Symbol('GRANDEZAS_LAUDO');

const id = z.number().int().positive();
const idNulo = id.nullable().default(null);
const versao = z.number().int().positive().optional();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const curto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);
const medida = z.number().finite().nullable().default(null);
const inteiro = z.number().int().min(0).max(60_000).nullable().default(null);

export const esquemaSecaoLaudo = z
  .object({
    id: id.optional(),
    versao,
    exameId: id,
    codigo: z.string().trim().max(60),
    nome: z.string().trim().max(200),
    sigla: curto(20),
    ordem: z.number().int().default(1),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaGrandezaLaudo = z
  .object({
    id: id.optional(),
    versao,
    exameId: id,
    secaoLaudoEstruturadoId: idNulo,
    codigo: z.string().trim().max(60),
    sigla: curto(20),
    descricao: z.string().trim().max(300),
    unidadeResultadoId: idNulo,
    casasDecimais: z.number().int().nullable().default(null),
    ordem: z.number().int().default(1),
    calculada: z.boolean().default(false),
    obrigatoria: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaFaixaGrandeza = z
  .object({
    id: id.optional(),
    versao,
    grandezaLaudoId: id,
    sexoId: idNulo,
    idadeMinimaDias: inteiro,
    idadeMaximaDias: inteiro,
    pesoMinimoKg: medida,
    pesoMaximoKg: medida,
    superficieCorporalMinima: medida,
    superficieCorporalMaxima: medida,
    referenciaMinima: medida,
    referenciaMaxima: medida,
    indexadaSuperficie: z.boolean().default(false),
    referenciaTexto: curto(300),
    vigenciaInicio: dataIso,
    vigenciaFim: dataIso.nullable().default(null),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaFormulaGrandeza = z
  .object({
    descricao: z.string().trim().min(2).max(150),
    expressao: z.string().trim().min(1).max(2000),
    casasDecimais: z.number().int().min(0).max(6).nullable().default(null),
    vigenciaInicio: dataIso,
    variaveis: z
      .array(
        z
          .object({
            identificador: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,9}$/),
            descricao: z.string().trim().min(1).max(150),
            fonte: z.enum(['grandeza', 'dado_paciente']),
            grandezaLaudoId: idNulo,
            dadoPaciente: z.string().trim().max(30).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const TABELAS = [
  'secao_laudo_estruturado',
  'grandeza_laudo',
  'faixa_referencia_grandeza',
  'formula_calculo',
  'variavel_formula',
];

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

interface Fonte {
  consultar(sql: string, parametros: readonly unknown[]): Promise<Linha[]>;
}

/** As fórmulas ativas das medidas calculadas do exame, com as variáveis (a vigência é escolhida pela regra). */
export async function lerFormulasDasGrandezas(l: Fonte, exameId: number): Promise<FormulaDaGrandeza[]> {
  const formulas = await l.consultar(
    `SELECT fc.id, fc.grandeza_laudo_id, fc.expressao, COALESCE(fc.casas_decimais, g.casas_decimais) AS casas,
            fc.vigencia_inicio, fc.vigencia_fim
       FROM formula_calculo fc
       JOIN grandeza_laudo g ON g.id = fc.grandeza_laudo_id AND g.ativo = TRUE AND g.calculada = TRUE
      WHERE g.exame_id = ? AND fc.alvo = 'grandeza' AND fc.ativo = TRUE
      ORDER BY fc.grandeza_laudo_id, fc.vigencia_inicio, fc.id`,
    [exameId],
  );
  if (!formulas.length) return [];
  const variaveis = await l.consultar(
    `SELECT formula_calculo_id, identificador, fonte, grandeza_laudo_id, dado_paciente FROM variavel_formula
      WHERE formula_calculo_id IN (${marcas(formulas.length)}) AND excluido_em IS NULL
      ORDER BY formula_calculo_id, sequencia`,
    formulas.map((f) => Number(f['id'])),
  );
  return formulas.map((f) => ({
    grandeza: Number(f['grandeza_laudo_id']),
    expressao: String(f['expressao']),
    casas: num(f['casas']),
    vigenciaInicio: dia(f['vigencia_inicio']) ?? '1900-01-01',
    vigenciaFim: dia(f['vigencia_fim']),
    variaveis: variaveis
      .filter((v) => Number(v['formula_calculo_id']) === Number(f['id']))
      .map((v) => ({
        identificador: String(v['identificador']),
        fonte: String(v['fonte']) === 'grandeza' ? ('grandeza' as const) : ('dado_paciente' as const),
        grandeza: num(v['grandeza_laudo_id']),
        dadoPaciente: v['dado_paciente'] === null ? null : String(v['dado_paciente']),
      })),
  }));
}

const faixaDoBanco = (r: Linha): FaixaGrandezaCadastro => ({
  id: Number(r['id']),
  sexoId: num(r['sexo_id']),
  idadeMinimaDias: num(r['idade_minima_dias']),
  idadeMaximaDias: num(r['idade_maxima_dias']),
  pesoMinimoKg: num(r['peso_minimo_kg']),
  pesoMaximoKg: num(r['peso_maximo_kg']),
  superficieMinima: num(r['superficie_corporal_minima']),
  superficieMaxima: num(r['superficie_corporal_maxima']),
  referenciaMinima: num(r['referencia_minima']),
  referenciaMaxima: num(r['referencia_maxima']),
  referenciaTexto: r['referencia_texto'] === null ? null : String(r['referencia_texto']),
  vigenciaInicio: dia(r['vigencia_inicio']) ?? '',
  vigenciaFim: dia(r['vigencia_fim']),
  ativo: bool(r['ativo']),
});

export class PortaGrandezasLaudoPropria {
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

  /** O laudo estruturado do exame para a manutenção: seções, medidas (com as fórmulas) e faixas, ativas e inativas. */
  laudoEstruturado(c: ContextoCatalogo, exameId: number) {
    return this.ler(c, async (l) => {
      const secoes = (
        await l.consultar(
          `SELECT id, versao, codigo, nome, sigla, ordem, ativo FROM secao_laudo_estruturado
            WHERE exame_id = ? ORDER BY ativo DESC, ordem, id LIMIT 200`,
          [exameId],
        )
      ).map((r) => ({ ...camel(r), ativo: bool(r['ativo']) }));
      const grandezas = await l.consultar(
        `SELECT id, versao, secao_laudo_estruturado_id, codigo, sigla, descricao, unidade_resultado_id, casas_decimais,
                ordem, calculada, obrigatoria, ativo
           FROM grandeza_laudo WHERE exame_id = ? ORDER BY ativo DESC, ordem, id LIMIT 500`,
        [exameId],
      );
      const gIds = grandezas.map((g) => Number(g['id']));
      const faixas = gIds.length
        ? await l.consultar(
            `SELECT * FROM faixa_referencia_grandeza WHERE grandeza_laudo_id IN (${marcas(gIds.length)})
              ORDER BY grandeza_laudo_id, ativo DESC, vigencia_inicio DESC, id LIMIT 2000`,
            gIds,
          )
        : [];
      const formulas = gIds.length
        ? await l.consultar(
            `SELECT id, grandeza_laudo_id, descricao, expressao, casas_decimais, vigencia_inicio, vigencia_fim
               FROM formula_calculo
              WHERE alvo = 'grandeza' AND ativo = TRUE AND grandeza_laudo_id IN (${marcas(gIds.length)})
              ORDER BY grandeza_laudo_id, vigencia_inicio DESC, id DESC LIMIT 2000`,
            gIds,
          )
        : [];
      const fIds = formulas.map((f) => Number(f['id']));
      const variaveis = fIds.length
        ? await l.consultar(
            `SELECT formula_calculo_id, identificador, descricao, fonte, grandeza_laudo_id, dado_paciente
               FROM variavel_formula WHERE formula_calculo_id IN (${marcas(fIds.length)}) AND excluido_em IS NULL
              ORDER BY formula_calculo_id, sequencia`,
            fIds,
          )
        : [];
      const sexos = (
        await l.consultar('SELECT id, descricao FROM sexo WHERE ativo = TRUE ORDER BY descricao', [])
      ).map((r) => ({ id: Number(r['id']), descricao: String(r['descricao']) }));
      const unidades = (
        await l.consultar(
          'SELECT id, simbolo FROM unidade_resultado WHERE ativo = TRUE ORDER BY simbolo LIMIT 1000',
          [],
        )
      ).map((r) => ({ id: Number(r['id']), simbolo: String(r['simbolo']) }));
      return {
        exameId,
        secoes,
        grandezas: grandezas.map((g) => ({
          ...camel(g),
          casasDecimais: num(g['casas_decimais']),
          calculada: bool(g['calculada']),
          obrigatoria: bool(g['obrigatoria']),
          ativo: bool(g['ativo']),
          faixas: faixas
            .filter((f) => Number(f['grandeza_laudo_id']) === Number(g['id']))
            .map((f) => ({
              id: Number(f['id']),
              versao: Number(f['versao']),
              grandezaLaudoId: Number(g['id']),
              sexoId: num(f['sexo_id']),
              idadeMinimaDias: num(f['idade_minima_dias']),
              idadeMaximaDias: num(f['idade_maxima_dias']),
              pesoMinimoKg: num(f['peso_minimo_kg']),
              pesoMaximoKg: num(f['peso_maximo_kg']),
              superficieCorporalMinima: num(f['superficie_corporal_minima']),
              superficieCorporalMaxima: num(f['superficie_corporal_maxima']),
              referenciaMinima: num(f['referencia_minima']),
              referenciaMaxima: num(f['referencia_maxima']),
              indexadaSuperficie: bool(f['indexada_superficie']),
              referenciaTexto: f['referencia_texto'] === null ? null : String(f['referencia_texto']),
              vigenciaInicio: dia(f['vigencia_inicio']) ?? '',
              vigenciaFim: dia(f['vigencia_fim']),
              ativo: bool(f['ativo']),
            })),
          formulas: formulas
            .filter((f) => Number(f['grandeza_laudo_id']) === Number(g['id']))
            .map((f) => ({
              id: Number(f['id']),
              descricao: String(f['descricao']),
              expressao: String(f['expressao']),
              casasDecimais: num(f['casas_decimais']),
              vigenciaInicio: dia(f['vigencia_inicio']) ?? '',
              vigenciaFim: dia(f['vigencia_fim']),
              variaveis: variaveis
                .filter((v) => Number(v['formula_calculo_id']) === Number(f['id']))
                .map((v) => ({
                  identificador: String(v['identificador']),
                  descricao: String(v['descricao']),
                  fonte: String(v['fonte']),
                  grandezaLaudoId: num(v['grandeza_laudo_id']),
                  dadoPaciente: v['dado_paciente'] === null ? null : String(v['dado_paciente']),
                })),
            })),
        })),
        sexos,
        unidades,
      };
    });
  }

  private entrada(
    esquema: { parse(x: unknown): unknown; partial(): { parse(x: unknown): unknown } },
    entrada: unknown,
  ) {
    const bruto = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
    const alteracao = bruto['id'] !== undefined && bruto['id'] !== null;
    const enviado = alteracao
      ? soEnviados(esquema, bruto)
      : (esquema.parse(bruto) as Record<string, unknown>);
    return { enviado, rid: alteracao ? Number(enviado['id']) : null };
  }

  private async exameExiste(tx: TxOperacao, exameId: unknown) {
    const [ex] = await tx.consultar(`SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL`, [exameId]);
    if (!ex) throw inexistente('O exame');
  }

  /** Inclui ou altera (só o enviado, com a versão vista) a seção do laudo do exame; sair é inativar. */
  salvarSecao(c: ContextoCatalogo, entrada: unknown) {
    const { enviado, rid } = this.entrada(esquemaSecaoLaudo, entrada);
    return this.gravar(
      c,
      rid ? 'laudo-secao-alterada' : 'laudo-secao-incluida',
      'secao_laudo_estruturado',
      async (tx) => {
        const [atual] = rid
          ? await tx.consultarParaAtualizar(`SELECT * FROM secao_laudo_estruturado WHERE id = ?`, [rid])
          : [null];
        if (rid && !atual) throw inexistente('A seção');
        const fica = { ...(atual ? camel(atual) : {}), ...enviado } as Record<string, unknown>;
        if (atual && Number(atual['exame_id']) !== Number(fica['exameId'])) throw inexistente('A seção');
        await this.exameExiste(tx, fica['exameId']);
        const falhas = validarSecaoLaudo({
          codigo: String(fica['codigo'] ?? ''),
          nome: String(fica['nome'] ?? ''),
          sigla: (fica['sigla'] as string | null) ?? null,
          ordem: Number(fica['ordem'] ?? 0),
        });
        if (falhas.length) recusar(falhas);
        const repetida = await tx.consultar(
          `SELECT id FROM secao_laudo_estruturado WHERE exame_id = ? AND codigo = ? AND id <> ? LIMIT 1`,
          [fica['exameId'], fica['codigo'], rid ?? 0],
        );
        if (repetida.length)
          recusar([{ campo: 'codigo', mensagem: 'Já existe seção com este código neste exame.' }]);
        if (rid && enviado['ativo'] === false) {
          const emUso = await tx.consultar(
            `SELECT id FROM grandeza_laudo WHERE secao_laudo_estruturado_id = ? AND ativo = TRUE LIMIT 1`,
            [rid],
          );
          if (emUso.length)
            recusar([
              { campo: 'ativo', mensagem: 'A seção tem medidas ativas: mova ou inative as medidas antes.' },
            ]);
        }
        const valores = colunas(enviado);
        if (!rid) return { id: await tx.incluir('secao_laudo_estruturado', valores), versao: 1 };
        return {
          id: rid,
          versao: await tx.alterar('secao_laudo_estruturado', rid, Number(enviado['versao'] ?? 0), valores),
        };
      },
    );
  }

  /** Inclui ou altera a medida (grandeza) do laudo do exame; sair é inativar, e a usada em fórmula não inativa. */
  salvarGrandeza(c: ContextoCatalogo, entrada: unknown) {
    const { enviado, rid } = this.entrada(esquemaGrandezaLaudo, entrada);
    return this.gravar(
      c,
      rid ? 'laudo-grandeza-alterada' : 'laudo-grandeza-incluida',
      'grandeza_laudo',
      async (tx, hoje) => {
        const [atual] = rid
          ? await tx.consultarParaAtualizar(`SELECT * FROM grandeza_laudo WHERE id = ?`, [rid])
          : [null];
        if (rid && !atual) throw inexistente('A medida');
        const fica = { ...(atual ? camel(atual) : {}), ...enviado } as Record<string, unknown>;
        if (atual && Number(atual['exame_id']) !== Number(fica['exameId'])) throw inexistente('A medida');
        await this.exameExiste(tx, fica['exameId']);
        const usada = rid
          ? await tx.consultar(
              `SELECT vf.id FROM variavel_formula vf
                 JOIN formula_calculo fc ON fc.id = vf.formula_calculo_id AND fc.ativo = TRUE AND fc.alvo = 'grandeza'
                 JOIN grandeza_laudo g ON g.id = fc.grandeza_laudo_id AND g.ativo = TRUE
                WHERE vf.grandeza_laudo_id = ? AND vf.excluido_em IS NULL
                  AND (fc.vigencia_fim IS NULL OR fc.vigencia_fim >= ?) LIMIT 1`,
              [rid, hoje],
            )
          : [];
        const falhas = validarGrandezaLaudo({
          codigo: String(fica['codigo'] ?? ''),
          descricao: String(fica['descricao'] ?? ''),
          sigla: (fica['sigla'] as string | null) ?? null,
          casasDecimais: num(fica['casasDecimais']),
          ordem: Number(fica['ordem'] ?? 0),
          ativo: bool(fica['ativo']),
          usadaEmFormula: usada.length > 0,
        });
        if (falhas.length) recusar(falhas);
        if (fica['secaoLaudoEstruturadoId'] !== null && fica['secaoLaudoEstruturadoId'] !== undefined) {
          const [s] = await tx.consultar(
            `SELECT id FROM secao_laudo_estruturado WHERE id = ? AND exame_id = ? AND ativo = TRUE`,
            [fica['secaoLaudoEstruturadoId'], fica['exameId']],
          );
          if (!s)
            recusar([
              { campo: 'secaoLaudoEstruturadoId', mensagem: 'A seção não é deste exame ou está inativa.' },
            ]);
        }
        const repetida = await tx.consultar(
          `SELECT id FROM grandeza_laudo WHERE exame_id = ? AND codigo = ? AND id <> ? LIMIT 1`,
          [fica['exameId'], fica['codigo'], rid ?? 0],
        );
        if (repetida.length)
          recusar([{ campo: 'codigo', mensagem: 'Já existe medida com este código neste exame.' }]);
        if (rid && atual && bool(atual['calculada']) && !bool(fica['calculada'])) {
          const comFormula = await tx.consultar(
            `SELECT id FROM formula_calculo WHERE grandeza_laudo_id = ? AND ativo = TRUE
                AND (vigencia_fim IS NULL OR vigencia_fim >= ?) LIMIT 1`,
            [rid, hoje],
          );
          if (comFormula.length)
            recusar([
              {
                campo: 'calculada',
                mensagem: 'A medida tem fórmula em vigor: ela continua calculada enquanto a fórmula valer.',
              },
            ]);
        }
        const valores = colunas(enviado);
        if (!rid) return { id: await tx.incluir('grandeza_laudo', valores), versao: 1 };
        return {
          id: rid,
          versao: await tx.alterar('grandeza_laudo', rid, Number(enviado['versao'] ?? 0), valores),
        };
      },
    );
  }

  /** Inclui ou altera a faixa de referência da medida; sair é inativar ou encerrar a vigência. */
  salvarFaixa(c: ContextoCatalogo, entrada: unknown) {
    const { enviado, rid } = this.entrada(esquemaFaixaGrandeza, entrada);
    return this.gravar(
      c,
      rid ? 'laudo-faixa-alterada' : 'laudo-faixa-incluida',
      'faixa_referencia_grandeza',
      async (tx) => {
        const [atual] = rid
          ? await tx.consultarParaAtualizar(`SELECT * FROM faixa_referencia_grandeza WHERE id = ?`, [rid])
          : [null];
        if (rid && !atual) throw inexistente('A faixa');
        const grandeza = Number(atual ? atual['grandeza_laudo_id'] : enviado['grandezaLaudoId']);
        if (enviado['grandezaLaudoId'] !== undefined && Number(enviado['grandezaLaudoId']) !== grandeza)
          throw inexistente('A faixa');
        // A medida travada: duas faixas do mesmo recorte não entram ao mesmo tempo.
        const [g] = await tx.consultarParaAtualizar(`SELECT id FROM grandeza_laudo WHERE id = ?`, [grandeza]);
        if (!g) throw inexistente('A medida');
        if (enviado['sexoId'] !== null && enviado['sexoId'] !== undefined) {
          const [sx] = await tx.consultar(`SELECT id FROM sexo WHERE id = ?`, [enviado['sexoId']]);
          if (!sx) recusar([{ campo: 'sexoId', mensagem: 'Sexo desconhecido.' }]);
        }
        const outras = (
          await tx.consultar(
            `SELECT * FROM faixa_referencia_grandeza WHERE grandeza_laudo_id = ? AND ativo = TRUE AND id <> ?`,
            [grandeza, rid ?? 0],
          )
        ).map(faixaDoBanco);
        const base = atual ? faixaDoBanco(atual) : null;
        const veio = <T>(k: string, antes: T): T => (enviado[k] !== undefined ? (enviado[k] as T) : antes);
        const fica: FaixaGrandezaCadastro = {
          id: rid,
          sexoId: veio('sexoId', base?.sexoId ?? null),
          idadeMinimaDias: veio('idadeMinimaDias', base?.idadeMinimaDias ?? null),
          idadeMaximaDias: veio('idadeMaximaDias', base?.idadeMaximaDias ?? null),
          pesoMinimoKg: veio('pesoMinimoKg', base?.pesoMinimoKg ?? null),
          pesoMaximoKg: veio('pesoMaximoKg', base?.pesoMaximoKg ?? null),
          superficieMinima: veio('superficieCorporalMinima', base?.superficieMinima ?? null),
          superficieMaxima: veio('superficieCorporalMaxima', base?.superficieMaxima ?? null),
          referenciaMinima: veio('referenciaMinima', base?.referenciaMinima ?? null),
          referenciaMaxima: veio('referenciaMaxima', base?.referenciaMaxima ?? null),
          referenciaTexto: veio('referenciaTexto', base?.referenciaTexto ?? null),
          vigenciaInicio: veio('vigenciaInicio', base?.vigenciaInicio ?? ''),
          vigenciaFim: veio('vigenciaFim', base?.vigenciaFim ?? null),
          ativo: veio('ativo', base?.ativo ?? true),
        };
        const falhas = validarFaixaGrandeza(fica, outras);
        if (falhas.length) recusar(falhas);
        const valores = colunas(enviado);
        if (!rid) return { id: await tx.incluir('faixa_referencia_grandeza', valores), versao: 1 };
        return {
          id: rid,
          versao: await tx.alterar('faixa_referencia_grandeza', rid, Number(enviado['versao'] ?? 0), valores),
        };
      },
    );
  }

  /** Nova versão da fórmula da medida calculada: encerra a anterior na véspera (regra do domínio). */
  novaFormula(c: ContextoCatalogo, grandezaId: number, entrada: unknown) {
    const f = esquemaFormulaGrandeza.parse(entrada);
    return this.gravar(c, 'laudo-formula-nova-versao', 'formula_calculo', async (tx, hoje) => {
      const [g] = await tx.consultarParaAtualizar(
        `SELECT id, exame_id, calculada, ativo FROM grandeza_laudo WHERE id = ?`,
        [grandezaId],
      );
      if (!g || !bool(g['ativo'])) throw inexistente('A medida');
      const doExame = await tx.consultar(
        `SELECT id FROM grandeza_laudo WHERE exame_id = ? AND ativo = TRUE`,
        [Number(g['exame_id'])],
      );
      const deps = await tx.consultar(
        `SELECT fc.grandeza_laudo_id AS calculada, vf.grandeza_laudo_id AS usa
           FROM formula_calculo fc
           JOIN grandeza_laudo gl ON gl.id = fc.grandeza_laudo_id
           JOIN variavel_formula vf ON vf.formula_calculo_id = fc.id AND vf.excluido_em IS NULL
          WHERE gl.exame_id = ? AND gl.id <> ? AND fc.ativo = TRUE AND fc.alvo = 'grandeza'
            AND vf.grandeza_laudo_id IS NOT NULL AND (fc.vigencia_fim IS NULL OR fc.vigencia_fim >= ?)`,
        [Number(g['exame_id']), grandezaId, f.vigenciaInicio],
      );
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT id, versao, vigencia_inicio, vigencia_fim FROM formula_calculo
          WHERE grandeza_laudo_id = ? AND ativo = TRUE AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [grandezaId, f.vigenciaInicio],
      );
      const usa = new Map<number, number[]>();
      for (const d of deps)
        usa.set(Number(d['calculada']), [...(usa.get(Number(d['calculada'])) ?? []), Number(d['usa'])]);
      const plano = planejarFormulaGrandeza(
        {
          expressao: f.expressao,
          vigenciaInicio: f.vigenciaInicio,
          variaveis: f.variaveis.map((v) => ({
            identificador: v.identificador,
            fonte: v.fonte,
            grandeza: v.fonte === 'grandeza' ? v.grandezaLaudoId : null,
            dadoPaciente: v.fonte === 'dado_paciente' ? v.dadoPaciente : null,
          })),
        },
        {
          hoje,
          grandezaAlvo: grandezaId,
          calculada: bool(g['calculada']),
          grandezasDoExame: doExame.map((x) => Number(x['id'])),
          vigentes: vigentes.map((v) => ({
            id: Number(v['id']),
            vigenciaInicio: dia(v['vigencia_inicio']) ?? '',
            vigenciaFim: dia(v['vigencia_fim']),
          })),
          dependencias: [...usa].map(([grandeza, lista]) => ({ grandeza, usa: lista })),
        },
      );
      if (plano.falhas.length) recusar(plano.falhas);
      for (const enc of plano.encerrar) {
        const v = vigentes.find((x) => Number(x['id']) === enc.id) as Linha;
        await tx.alterar('formula_calculo', enc.id, Number(v['versao']), { vigencia_fim: enc.vigenciaFim });
      }
      const seq = await tx.consultar(
        `SELECT COUNT(*) AS n FROM formula_calculo WHERE grandeza_laudo_id = ?`,
        [grandezaId],
      );
      const nova = await tx.incluir('formula_calculo', {
        codigo: `GL${grandezaId}V${Number(seq[0]?.['n'] ?? 0) + 1}`.slice(0, 30),
        descricao: f.descricao,
        alvo: 'grandeza',
        grandeza_laudo_id: grandezaId,
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
          grandeza_laudo_id: v.fonte === 'grandeza' ? v.grandezaLaudoId : null,
          dado_paciente: v.fonte === 'dado_paciente' ? v.dadoPaciente : null,
        });
      return { id: nova, encerradas: plano.encerrar.map((x) => x.id) };
    });
  }
}
