// Leitura do catálogo RDB$ (ficha do M02, seção 4): insumo dos tipos gerados e da impressão digital.
// Só objetos do legado: RDB$SYSTEM_FLAG = 0 e sem prefixo SGH_ (as tabelas novas ficam de fora).
// Só metadados: nenhum dado de linha é lido.
import { decodificarCp1252 } from '../cp1252.js';
import type { Leitor } from '../transacao.js';

export type TipoBase =
  | 'texto'
  | 'inteiro'
  | 'decimal'
  | 'double'
  | 'data'
  | 'hora'
  | 'timestamp'
  | 'blob-texto'
  | 'blob'
  | 'booleano';

export interface ColunaCatalogo {
  readonly nome: string;
  readonly tipo: string;
  readonly base: TipoBase;
  /** Caracteres (texto; no charset NONE, 1 byte por caractere). */
  readonly tamanho: number | null;
  readonly escala: number | null;
  readonly anulavel: boolean;
  /** Domínio nomeado (os automáticos RDB$nnn ficam null). */
  readonly dominio: string | null;
  readonly check: string | null;
  /** Valor padrão declarado (DEFAULT), como texto da fonte. */
  readonly padrao: string | null;
  readonly calculada: boolean;
}

export interface TabelaCatalogo {
  readonly nome: string;
  readonly colunas: readonly ColunaCatalogo[];
  readonly pk: readonly string[];
}

export interface ObjetoComFonte {
  readonly nome: string;
  /** Bytes da fonte (só para o hash; nunca gravados). */
  readonly fonte: Uint8Array;
}

export interface TriggerCatalogo extends ObjetoComFonte {
  readonly tabela: string | null;
  readonly tipo: number;
  readonly sequencia: number;
  readonly inativo: boolean;
}

export interface ProcedimentoCatalogo extends ObjetoComFonte {
  readonly parametros: readonly string[];
}

export interface IndiceCatalogo {
  readonly nome: string;
  readonly tabela: string;
  readonly unico: boolean;
  readonly descendente: boolean;
  readonly inativo: boolean;
  readonly expressao: string | null;
  readonly segmentos: readonly string[];
}

export interface RestricaoCatalogo {
  readonly nome: string;
  readonly tabela: string;
  readonly tipo: string;
  readonly colunas: readonly string[];
  readonly detalhe: string | null;
}

export interface DominioCatalogo {
  readonly nome: string;
  readonly tipo: string;
  readonly anulavel: boolean;
  readonly check: string | null;
  readonly padrao: string | null;
}

export interface CatalogoLegado {
  readonly charset: string;
  readonly versaoMotor: string;
  readonly tabelas: readonly TabelaCatalogo[];
  readonly visoes: readonly ObjetoComFonte[];
  readonly triggers: readonly TriggerCatalogo[];
  readonly procedimentos: readonly ProcedimentoCatalogo[];
  readonly generators: readonly string[];
  readonly indices: readonly IndiceCatalogo[];
  readonly restricoes: readonly RestricaoCatalogo[];
  readonly dominios: readonly DominioCatalogo[];
  readonly excecoes: readonly ObjetoComFonte[];
  readonly funcoes: readonly ObjetoComFonte[];
}

/** Teto alto: o catálogo inteiro é lido de uma vez (só metadados). */
const TETO = 200_000;
const TEMPO = 120_000;
const OPC = { teto: TETO, tempoMaximoMs: TEMPO } as const;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const sn = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const n = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null;

/** Nome gerado pelo Firebird (RDB$nnn, INTEG_nnn): muda de banco para banco, não entra na comparação. */
export function nomeAutomatico(nome: string): boolean {
  return /^(RDB\$|INTEG_\d)/.test(nome);
}

export function descreverTipo(
  tipo: number,
  subtipo: number | null,
  tamanho: number,
  precisao: number | null,
  escala: number | null,
  tamanhoCaracteres: number | null,
): { tipo: string; base: TipoBase; tamanho: number | null; escala: number | null } {
  const esc = escala ?? 0;
  if ((tipo === 7 || tipo === 8 || tipo === 16) && (esc < 0 || (subtipo ?? 0) > 0)) {
    const nome = subtipo === 2 ? 'DECIMAL' : 'NUMERIC';
    return { tipo: `${nome}(${precisao ?? 18},${-esc})`, base: 'decimal', tamanho: null, escala: -esc };
  }
  const chars = tamanhoCaracteres ?? tamanho;
  switch (tipo) {
    case 7:
      return { tipo: 'SMALLINT', base: 'inteiro', tamanho: null, escala: null };
    case 8:
      return { tipo: 'INTEGER', base: 'inteiro', tamanho: null, escala: null };
    case 16:
      return { tipo: 'BIGINT', base: 'inteiro', tamanho: null, escala: null };
    case 10:
      return { tipo: 'FLOAT', base: 'double', tamanho: null, escala: null };
    case 27:
      return { tipo: 'DOUBLE PRECISION', base: 'double', tamanho: null, escala: null };
    case 12:
      return { tipo: 'DATE', base: 'data', tamanho: null, escala: null };
    case 13:
      return { tipo: 'TIME', base: 'hora', tamanho: null, escala: null };
    case 35:
      return { tipo: 'TIMESTAMP', base: 'timestamp', tamanho: null, escala: null };
    case 14:
      return { tipo: `CHAR(${chars})`, base: 'texto', tamanho: chars, escala: null };
    case 37:
      return { tipo: `VARCHAR(${chars})`, base: 'texto', tamanho: chars, escala: null };
    case 23:
      return { tipo: 'BOOLEAN', base: 'booleano', tamanho: null, escala: null };
    case 261:
      return subtipo === 1
        ? { tipo: 'BLOB SUB_TYPE TEXT', base: 'blob-texto', tamanho: null, escala: null }
        : { tipo: `BLOB SUB_TYPE ${subtipo ?? 0}`, base: 'blob', tamanho: null, escala: null };
    default:
      return { tipo: `TIPO_${tipo}`, base: 'blob', tamanho: null, escala: null };
  }
}

async function fonte(leitor: Leitor, blob: unknown): Promise<Uint8Array> {
  if (blob === null || blob === undefined) return new Uint8Array();
  return normalizarFonte(await leitor.lerBlob(blob));
}

/** Fonte para o hash: CRLF → LF e sem espaço no fim das linhas e do texto. */
export function normalizarFonte(bytes: Uint8Array): Uint8Array {
  const t = decodificarCp1252(bytes)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd();
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}

function anexar<V>(mapa: Map<string, V[]>, chave: string, valor: V): void {
  const lista = mapa.get(chave);
  if (lista) lista.push(valor);
  else mapa.set(chave, [valor]);
}

const FORA_SGH = (col: string) => `${col} NOT STARTING WITH 'SGH_'`;

export async function lerCatalogoLegado(leitor: Leitor): Promise<CatalogoLegado> {
  const [db] = await leitor.consultar(
    `SELECT TRIM(d.RDB$CHARACTER_SET_NAME) CS, RDB$GET_CONTEXT('SYSTEM', 'ENGINE_VERSION') V FROM RDB$DATABASE d`,
    [],
    OPC,
  );

  const relacoes = await leitor.consultar(
    `SELECT TRIM(r.RDB$RELATION_NAME) NOME, r.RDB$VIEW_SOURCE FONTE,
            CASE WHEN r.RDB$VIEW_BLR IS NULL THEN 0 ELSE 1 END VISAO
       FROM RDB$RELATIONS r
      WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('r.RDB$RELATION_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );

  const campos = await leitor.consultar(
    `SELECT TRIM(rf.RDB$RELATION_NAME) T, TRIM(rf.RDB$FIELD_NAME) C, rf.RDB$FIELD_POSITION P,
            TRIM(rf.RDB$FIELD_SOURCE) D, rf.RDB$NULL_FLAG NR, f.RDB$NULL_FLAG ND,
            f.RDB$FIELD_TYPE TP, f.RDB$FIELD_SUB_TYPE ST, f.RDB$FIELD_LENGTH L, f.RDB$FIELD_PRECISION PR,
            f.RDB$FIELD_SCALE SC, f.RDB$CHARACTER_LENGTH CL,
            CASE WHEN f.RDB$COMPUTED_BLR IS NULL THEN 0 ELSE 1 END CALC,
            CAST(f.RDB$VALIDATION_SOURCE AS VARCHAR(8000)) CK,
            CAST(COALESCE(rf.RDB$DEFAULT_SOURCE, f.RDB$DEFAULT_SOURCE) AS VARCHAR(8000)) DF
       FROM RDB$RELATION_FIELDS rf
       JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
       JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND r.RDB$VIEW_BLR IS NULL AND ${FORA_SGH('rf.RDB$RELATION_NAME')}
      ORDER BY 1, 3, 2`,
    [],
    OPC,
  );

  const pks = await leitor.consultar(
    `SELECT TRIM(rc.RDB$RELATION_NAME) T, TRIM(s.RDB$FIELD_NAME) C
       FROM RDB$RELATION_CONSTRAINTS rc
       JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
      WHERE rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' AND ${FORA_SGH('rc.RDB$RELATION_NAME')}
      ORDER BY 1, s.RDB$FIELD_POSITION`,
    [],
    OPC,
  );

  const trg = await leitor.consultar(
    `SELECT TRIM(t.RDB$TRIGGER_NAME) NOME, TRIM(t.RDB$RELATION_NAME) T, t.RDB$TRIGGER_TYPE TP,
            t.RDB$TRIGGER_SEQUENCE SQ, COALESCE(t.RDB$TRIGGER_INACTIVE, 0) INATIVO, t.RDB$TRIGGER_SOURCE FONTE
       FROM RDB$TRIGGERS t
      WHERE COALESCE(t.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('t.RDB$TRIGGER_NAME')}
        AND (t.RDB$RELATION_NAME IS NULL OR ${FORA_SGH('t.RDB$RELATION_NAME')})
      ORDER BY 1`,
    [],
    OPC,
  );

  const procs = await leitor.consultar(
    `SELECT TRIM(p.RDB$PROCEDURE_NAME) NOME, p.RDB$PROCEDURE_SOURCE FONTE
       FROM RDB$PROCEDURES p
      WHERE COALESCE(p.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('p.RDB$PROCEDURE_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );
  const params = await leitor.consultar(
    `SELECT TRIM(pp.RDB$PROCEDURE_NAME) P, TRIM(pp.RDB$PARAMETER_NAME) NOME, pp.RDB$PARAMETER_TYPE ES,
            pp.RDB$PARAMETER_NUMBER NUM, f.RDB$FIELD_TYPE TP, f.RDB$FIELD_SUB_TYPE ST, f.RDB$FIELD_LENGTH L,
            f.RDB$FIELD_PRECISION PR, f.RDB$FIELD_SCALE SC, f.RDB$CHARACTER_LENGTH CL
       FROM RDB$PROCEDURE_PARAMETERS pp
       JOIN RDB$PROCEDURES p ON p.RDB$PROCEDURE_NAME = pp.RDB$PROCEDURE_NAME
       LEFT JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = pp.RDB$FIELD_SOURCE
      WHERE COALESCE(p.RDB$SYSTEM_FLAG, 0) = 0
      ORDER BY 1, 3, 4`,
    [],
    OPC,
  );

  const gens = await leitor.consultar(
    `SELECT TRIM(g.RDB$GENERATOR_NAME) NOME FROM RDB$GENERATORS g
      WHERE COALESCE(g.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('g.RDB$GENERATOR_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );

  const idx = await leitor.consultar(
    `SELECT TRIM(i.RDB$INDEX_NAME) NOME, TRIM(i.RDB$RELATION_NAME) T, COALESCE(i.RDB$UNIQUE_FLAG, 0) U,
            COALESCE(i.RDB$INDEX_TYPE, 0) DESCE, COALESCE(i.RDB$INDEX_INACTIVE, 0) INATIVO,
            CAST(i.RDB$EXPRESSION_SOURCE AS VARCHAR(8000)) EXPR
       FROM RDB$INDICES i
      WHERE COALESCE(i.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('i.RDB$RELATION_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );
  const segs = await leitor.consultar(
    `SELECT TRIM(s.RDB$INDEX_NAME) I, TRIM(s.RDB$FIELD_NAME) C
       FROM RDB$INDEX_SEGMENTS s
       JOIN RDB$INDICES i ON i.RDB$INDEX_NAME = s.RDB$INDEX_NAME
      WHERE COALESCE(i.RDB$SYSTEM_FLAG, 0) = 0
      ORDER BY 1, s.RDB$FIELD_POSITION`,
    [],
    OPC,
  );

  const rcs = await leitor.consultar(
    `SELECT TRIM(rc.RDB$CONSTRAINT_NAME) NOME, TRIM(rc.RDB$RELATION_NAME) T, TRIM(rc.RDB$CONSTRAINT_TYPE) TP,
            TRIM(rc.RDB$INDEX_NAME) I, TRIM(ref.RDB$CONST_NAME_UQ) UQ, TRIM(ref.RDB$UPDATE_RULE) UR,
            TRIM(ref.RDB$DELETE_RULE) DR,
            (SELECT FIRST 1 CAST(t.RDB$TRIGGER_SOURCE AS VARCHAR(8000))
               FROM RDB$CHECK_CONSTRAINTS cc JOIN RDB$TRIGGERS t ON t.RDB$TRIGGER_NAME = cc.RDB$TRIGGER_NAME
              WHERE cc.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME) CK
       FROM RDB$RELATION_CONSTRAINTS rc
       LEFT JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
      WHERE rc.RDB$CONSTRAINT_TYPE <> 'NOT NULL' AND ${FORA_SGH('rc.RDB$RELATION_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );

  const doms = await leitor.consultar(
    `SELECT TRIM(f.RDB$FIELD_NAME) NOME, f.RDB$FIELD_TYPE TP, f.RDB$FIELD_SUB_TYPE ST, f.RDB$FIELD_LENGTH L,
            f.RDB$FIELD_PRECISION PR, f.RDB$FIELD_SCALE SC, f.RDB$CHARACTER_LENGTH CL, f.RDB$NULL_FLAG NF,
            CAST(f.RDB$VALIDATION_SOURCE AS VARCHAR(8000)) CK, CAST(f.RDB$DEFAULT_SOURCE AS VARCHAR(8000)) DF
       FROM RDB$FIELDS f
      WHERE COALESCE(f.RDB$SYSTEM_FLAG, 0) = 0 AND f.RDB$FIELD_NAME NOT STARTING WITH 'RDB$'
        AND ${FORA_SGH('f.RDB$FIELD_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );

  const excs = await leitor.consultar(
    `SELECT TRIM(e.RDB$EXCEPTION_NAME) NOME, CAST(e.RDB$MESSAGE AS VARCHAR(1023) CHARACTER SET OCTETS) M
       FROM RDB$EXCEPTIONS e
      WHERE COALESCE(e.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('e.RDB$EXCEPTION_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );
  const funcs = await leitor.consultar(
    `SELECT TRIM(f.RDB$FUNCTION_NAME) NOME, TRIM(f.RDB$MODULE_NAME) MODULO, TRIM(f.RDB$ENTRYPOINT) ENTRADA,
            f.RDB$RETURN_ARGUMENT RET, f.RDB$FUNCTION_SOURCE FONTE
       FROM RDB$FUNCTIONS f
      WHERE COALESCE(f.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('f.RDB$FUNCTION_NAME')}
      ORDER BY 1`,
    [],
    OPC,
  );
  // Assinatura das funções (UDF e PSQL): posição, mecanismo, tipo, tamanho e escala de cada argumento.
  const fargs = await leitor.consultar(
    `SELECT TRIM(a.RDB$FUNCTION_NAME) F, a.RDB$ARGUMENT_POSITION POS, a.RDB$MECHANISM MEC,
            TRIM(a.RDB$ARGUMENT_NAME) NOME, COALESCE(a.RDB$FIELD_TYPE, d.RDB$FIELD_TYPE) TP,
            COALESCE(a.RDB$FIELD_SUB_TYPE, d.RDB$FIELD_SUB_TYPE) ST, COALESCE(a.RDB$FIELD_LENGTH, d.RDB$FIELD_LENGTH) L,
            COALESCE(a.RDB$FIELD_PRECISION, d.RDB$FIELD_PRECISION) PR, COALESCE(a.RDB$FIELD_SCALE, d.RDB$FIELD_SCALE) SC,
            COALESCE(a.RDB$CHARACTER_LENGTH, d.RDB$CHARACTER_LENGTH) CL
       FROM RDB$FUNCTION_ARGUMENTS a
       JOIN RDB$FUNCTIONS f ON f.RDB$FUNCTION_NAME = a.RDB$FUNCTION_NAME
       LEFT JOIN RDB$FIELDS d ON d.RDB$FIELD_NAME = a.RDB$FIELD_SOURCE
      WHERE COALESCE(f.RDB$SYSTEM_FLAG, 0) = 0 AND ${FORA_SGH('f.RDB$FUNCTION_NAME')}
      ORDER BY 1, 2`,
    [],
    OPC,
  );

  // Montagem
  const pkPorTabela = new Map<string, string[]>();
  for (const r of pks) anexar(pkPorTabela, s(r['T']), s(r['C']));

  const colunasPorTabela = new Map<string, ColunaCatalogo[]>();
  for (const r of campos) {
    const t = s(r['T']);
    const d = s(r['D']);
    const desc = descreverTipo(
      n(r['TP']) ?? 0,
      n(r['ST']),
      n(r['L']) ?? 0,
      n(r['PR']),
      n(r['SC']),
      n(r['CL']),
    );
    const col: ColunaCatalogo = {
      nome: s(r['C']),
      tipo: desc.tipo,
      base: desc.base,
      tamanho: desc.tamanho,
      escala: desc.escala,
      anulavel: (n(r['NR']) ?? 0) !== 1 && (n(r['ND']) ?? 0) !== 1,
      dominio: nomeAutomatico(d) ? null : d,
      check: sn(r['CK']),
      padrao: sn(r['DF']),
      calculada: n(r['CALC']) === 1,
    };
    anexar(colunasPorTabela, t, col);
  }

  const tabelas: TabelaCatalogo[] = [];
  const visoes: ObjetoComFonte[] = [];
  for (const r of relacoes) {
    const nome = s(r['NOME']);
    if (n(r['VISAO']) === 1) visoes.push({ nome, fonte: await fonte(leitor, r['FONTE']) });
    else tabelas.push({ nome, colunas: colunasPorTabela.get(nome) ?? [], pk: pkPorTabela.get(nome) ?? [] });
  }

  const triggers: TriggerCatalogo[] = [];
  for (const r of trg) {
    triggers.push({
      nome: s(r['NOME']),
      tabela: sn(r['T']),
      tipo: n(r['TP']) ?? 0,
      sequencia: n(r['SQ']) ?? 0,
      inativo: n(r['INATIVO']) === 1,
      fonte: await fonte(leitor, r['FONTE']),
    });
  }

  const paramsPorProc = new Map<string, string[]>();
  for (const r of params) {
    const desc = descreverTipo(
      n(r['TP']) ?? 0,
      n(r['ST']),
      n(r['L']) ?? 0,
      n(r['PR']),
      n(r['SC']),
      n(r['CL']),
    );
    const p = s(r['P']);
    anexar(
      paramsPorProc,
      p,
      `${n(r['ES']) === 1 ? 'saida' : 'entrada'}:${n(r['NUM'])}:${s(r['NOME'])}:${desc.tipo}`,
    );
  }
  const procedimentos: ProcedimentoCatalogo[] = [];
  for (const r of procs) {
    const nome = s(r['NOME']);
    procedimentos.push({
      nome,
      fonte: await fonte(leitor, r['FONTE']),
      parametros: paramsPorProc.get(nome) ?? [],
    });
  }

  const segPorIndice = new Map<string, string[]>();
  for (const r of segs) anexar(segPorIndice, s(r['I']), s(r['C']));
  const indices: IndiceCatalogo[] = idx.map((r) => ({
    nome: s(r['NOME']),
    tabela: s(r['T']),
    unico: n(r['U']) === 1,
    descendente: n(r['DESCE']) === 1,
    inativo: n(r['INATIVO']) === 1,
    expressao: sn(r['EXPR']),
    segmentos: segPorIndice.get(s(r['NOME'])) ?? [],
  }));

  const restricoes: RestricaoCatalogo[] = rcs.map((r) => {
    const tipo = s(r['TP']);
    const detalhe =
      tipo === 'FOREIGN KEY'
        ? `ref=${s(r['UQ'])};upd=${s(r['UR'])};del=${s(r['DR'])}`
        : tipo === 'CHECK'
          ? sn(r['CK'])
          : null;
    return {
      nome: s(r['NOME']),
      tabela: s(r['T']),
      tipo,
      colunas: segPorIndice.get(s(r['I'])) ?? [],
      detalhe,
    };
  });

  const dominios: DominioCatalogo[] = doms.map((r) => ({
    nome: s(r['NOME']),
    tipo: descreverTipo(n(r['TP']) ?? 0, n(r['ST']), n(r['L']) ?? 0, n(r['PR']), n(r['SC']), n(r['CL'])).tipo,
    anulavel: n(r['NF']) !== 1,
    check: sn(r['CK']),
    padrao: sn(r['DF']),
  }));

  const excecoes: ObjetoComFonte[] = excs.map((r) => ({
    nome: s(r['NOME']),
    fonte: r['M'] instanceof Uint8Array ? r['M'] : new Uint8Array(),
  }));
  const argsPorFuncao = new Map<string, string[]>();
  for (const r of fargs) {
    const desc = descreverTipo(
      n(r['TP']) ?? 0,
      n(r['ST']),
      n(r['L']) ?? 0,
      n(r['PR']),
      n(r['SC']),
      n(r['CL']),
    );
    anexar(
      argsPorFuncao,
      s(r['F']),
      `${n(r['POS'])}:${n(r['MEC']) ?? ''}:${s(r['NOME'])}:${desc.tipo}:${n(r['L']) ?? ''}:${n(r['SC']) ?? ''}`,
    );
  }
  // Hash da função: módulo, ponto de entrada, argumento de retorno, assinatura e corpo PSQL (normalizado).
  const funcoes: ObjetoComFonte[] = [];
  for (const r of funcs) {
    const nome = s(r['NOME']);
    const cabecalho = Uint8Array.from(
      `${s(r['MODULO'])}|${s(r['ENTRADA'])}|ret:${n(r['RET']) ?? ''}|${(argsPorFuncao.get(nome) ?? []).join(';')}|`,
      (c) => c.charCodeAt(0) & 0xff,
    );
    const corpo = await fonte(leitor, r['FONTE']);
    const bytes = new Uint8Array(cabecalho.length + corpo.length);
    bytes.set(cabecalho, 0);
    bytes.set(corpo, cabecalho.length);
    funcoes.push({ nome, fonte: bytes });
  }

  return {
    charset: s(db?.['CS']),
    versaoMotor: s(db?.['V']),
    tabelas,
    visoes,
    triggers,
    procedimentos,
    generators: gens.map((r) => s(r['NOME'])),
    indices,
    restricoes,
    dominios,
    excecoes,
    funcoes,
  };
}
