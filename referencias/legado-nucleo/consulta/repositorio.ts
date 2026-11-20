// Leituras da consulta somente leitura (M14; ficha, seção 4; cap-10 §10.11): sempre pelo Leitor do núcleo
// (transação READ ONLY), SQL explícito e parametrizado, nomes conferidos na declaração.
//   - página: paginação por chave (keyset) sobre a chave primária, 100 linhas no máximo; sem chave, por posição
//     (FIRST/SKIP, até 10.000 linhas); filtro só por coluna indexada (igual ou período), sem UPPER/TRIM;
//   - contagem com teto: FIRST 10.001 numa subconsulta ("mais de 10.000"); estourou o tempo, "mais de";
//   - registro: pela chave inteira (o registro de dado de pessoa é aberto com evento auditado, na API);
//   - exportação: as linhas do filtro, com teto (acima dele a exportação é recusada).
// Toda consulta tem tempo máximo: o driver cancela ao passar (ErroTempoEsgotado; a API diz para filtrar mais).
// Nenhuma gravação: o executor não tem receita para consultas (regra 5).
import type { CharsetLegado } from '@sgh/contratos';
import { charsetTextoDe } from '../codec/charset.js';
import {
  TETO_CONTAGEM_CONSULTA,
  TETO_EXPORTACAO_CONSULTA,
  TETO_PAGINA_CONSULTA,
  type ValorCampo,
} from '@sgh/contratos';
import { deCivil, lerTexto, paraCivil } from '../codec.js';
import { colunaUtf8 } from '../colunas-utf8.js';
import type { Linha } from '../driver.js';
import { ErroTempoEsgotado, type Leitor } from '../transacao.js';
import type { ColunaConsultaFisica, DeclaracaoConsulta } from './declaracao.js';
import { ErroEscopo, type FiltroEscopo } from '../crud/repositorio.js';

/** Filtro já validado (o pedido passa por lerFiltros de @sgh/dominio-config). */
export interface FiltroConsulta {
  readonly campo: string;
  readonly modo: 'igual' | 'periodo';
  readonly igual?: string | number;
  readonly de?: string;
  readonly ate?: string;
}

export class ErroConsulta extends Error {
  override readonly name = 'ErroConsulta';
  readonly codigo: 'sem-filtro' | 'filtro-invalido' | 'pagina-invalida' | 'exportacao-grande' | 'sem-chave';
  constructor(codigo: ErroConsulta['codigo'], mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Tempo máximo de cada consulta (o driver cancela). */
export const TEMPO_CONSULTA_MS = 15_000;
const TEMPO_CONTAGEM_MS = 8_000;
const SKIP_MAXIMO = 10_000;

const dois = (n: number) => String(n).padStart(2, '0');

/**
 * Valor do banco → valor da tela (data AAAA-MM-DD, hora HH:MM; data e hora AAAA-MM-DD HH:MM:SS, com os
 * milissegundos quando houver). Correção do M14: a data e hora leva os segundos e as frações, porque o mesmo
 * valor serve de cursor da página seguinte e de código do registro (sem eles, a chave não casa).
 */
export function valorDaConsulta(
  c: Pick<ColunaConsultaFisica, 'tipo'> & { readonly utf8?: boolean; readonly charsetBanco?: CharsetLegado },
  bruto: unknown,
): ValorCampo {
  if (bruto === null || bruto === undefined) return null;
  if (bruto instanceof Date) {
    const v = paraCivil(bruto);
    const dia = `${String(v.ano).padStart(4, '0')}-${dois(v.mes)}-${dois(v.dia)}`;
    const hora = `${dois(v.hora ?? 0)}:${dois(v.minuto ?? 0)}`;
    if (c.tipo === 'data') return dia;
    if (c.tipo === 'hora') return hora;
    const ms = v.milissegundo ?? 0;
    return `${dia} ${hora}:${dois(v.segundo ?? 0)}${ms ? `.${String(ms).padStart(3, '0')}` : ''}`;
  }
  if (typeof bruto === 'bigint')
    return bruto <= BigInt(Number.MAX_SAFE_INTEGER) && bruto >= -BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(bruto)
      : bruto.toString();
  if (typeof bruto === 'number') return bruto;
  if (Buffer.isBuffer(bruto)) return null;
  const texto = String(bruto).replace(/ +$/, '');
  // Coluna catalogada como UTF-8 (colunas-utf8.ts): o driver entrega CP1252, e o codec relê os bytes como UTF-8. No
  // banco convertido (M58-F3) o texto já vem pronto.
  if (c.charsetBanco === 'UTF8') return texto;
  return c.utf8 ? (lerTexto(texto, { tipo: 'VARCHAR', utf8: true })?.texto ?? texto) : texto;
}

function coluna(d: DeclaracaoConsulta, campo: string): ColunaConsultaFisica {
  const c = d.colunas.find((x) => x.campo === campo);
  if (!c) throw new ErroConsulta('filtro-invalido', 'Filtro em campo inexistente.');
  return c;
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
function inicioDoDia(v: string, maisUm = false): Date {
  const m = DATA.exec(v);
  if (!m) throw new ErroConsulta('filtro-invalido', 'Data inválida.');
  const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (maisUm ? 1 : 0)));
  return deCivil({
    ano: base.getUTCFullYear(),
    mes: base.getUTCMonth() + 1,
    dia: base.getUTCDate(),
    hora: 0,
    minuto: 0,
    segundo: 0,
  });
}

/**
 * Correção do M14 (escopo do M06, como no CRUD genérico): os valores aceitos de cada escopo restrito da sessão
 * viram `coluna IN (…)`; lista vazia não deixa nada sair; escopo restrito sem coluna declarada falha fechado.
 */
export function clausulaEscopoConsulta(
  d: DeclaracaoConsulta,
  escopo: FiltroEscopo | undefined,
): { sql: string[]; parametros: unknown[] } {
  const sql: string[] = [];
  const parametros: unknown[] = [];
  for (const [e, valores] of Object.entries(escopo ?? {})) {
    if (valores === null || valores === undefined) continue;
    const coluna = d.escopos?.[e as keyof NonNullable<DeclaracaoConsulta['escopos']>];
    if (!coluna) throw new ErroEscopo(`Escopo ${e} restrito sem coluna na consulta: leitura recusada.`);
    if (valores.length === 0) {
      sql.push('1 = 0');
      continue;
    }
    sql.push(`${coluna} IN (${valores.map(() => '?').join(', ')})`);
    parametros.push(...valores);
  }
  return { sql, parametros };
}

/** Cláusula e parâmetros dos filtros (só colunas declaradas com filtro) e do escopo da sessão. */
export function clausulaFiltros(
  d: DeclaracaoConsulta,
  filtros: readonly FiltroConsulta[],
  escopo?: FiltroEscopo,
): { sql: string[]; parametros: unknown[] } {
  const e = clausulaEscopoConsulta(d, escopo);
  const sql: string[] = [...e.sql];
  const parametros: unknown[] = [...e.parametros];
  for (const f of filtros) {
    const c = coluna(d, f.campo);
    if (!c.filtro || c.filtro !== f.modo)
      throw new ErroConsulta('filtro-invalido', 'Filtro só por coluna indexada.');
    if (f.modo === 'igual') {
      sql.push(`${c.coluna} = ?`);
      parametros.push(f.igual);
    } else {
      if (f.de) {
        sql.push(`${c.coluna} >= ?`);
        parametros.push(inicioDoDia(f.de));
      }
      if (f.ate) {
        sql.push(`${c.coluna} < ?`);
        parametros.push(inicioDoDia(f.ate, true));
      }
    }
  }
  return { sql, parametros };
}

/** Valor da chave para o parâmetro do keyset (data do cursor volta a Date). */
function paramDaChave(c: ColunaConsultaFisica, v: string | number | null): unknown {
  if (v === null) return null;
  if ((c.tipo === 'data' || c.tipo === 'dataHora') && typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(v);
    if (!m) throw new ErroConsulta('pagina-invalida', 'Página inválida.');
    return deCivil({
      ano: Number(m[1]),
      mes: Number(m[2]),
      dia: Number(m[3]),
      hora: Number(m[4] ?? 0),
      minuto: Number(m[5] ?? 0),
      segundo: Number(m[6] ?? 0),
      milissegundo: m[7] ? Number(m[7].padEnd(3, '0')) : 0,
    });
  }
  return v;
}

/** (k1 > ?) OR (k1 = ? AND k2 > ?) … — a página seguinte depois da última chave lida. */
function clausulaKeyset(
  d: DeclaracaoConsulta,
  apos: readonly (string | number | null)[],
): { sql: string; parametros: unknown[] } {
  const cols = d.chave.map((k) => d.colunas.find((c) => c.coluna === k)!);
  const ou: string[] = [];
  const parametros: unknown[] = [];
  for (let i = 0; i < cols.length; i++) {
    const partes: string[] = [];
    for (let j = 0; j < i; j++) {
      partes.push(`${cols[j]!.coluna} = ?`);
      parametros.push(paramDaChave(cols[j]!, apos[j] ?? null));
    }
    partes.push(`${cols[i]!.coluna} > ?`);
    parametros.push(paramDaChave(cols[i]!, apos[i] ?? null));
    ou.push(`(${partes.join(' AND ')})`);
  }
  return { sql: `(${ou.join(' OR ')})`, parametros };
}

export interface PaginaConsultaLida {
  readonly linhas: Readonly<Record<string, ValorCampo>>[];
  /** Valores da chave da última linha (keyset) ou a posição seguinte (sem chave); null: acabou. */
  readonly proxima: readonly (string | number | null)[] | null;
}

/** Página da consulta (os valores ainda sem máscara: a API mascara). */
export async function paginaDaConsulta(
  l: Leitor,
  d: DeclaracaoConsulta,
  filtros: readonly FiltroConsulta[],
  apos: readonly (string | number | null)[] | null,
  porPagina = TETO_PAGINA_CONSULTA,
  escopo?: FiltroEscopo,
): Promise<PaginaConsultaLida> {
  const n = Math.max(1, Math.min(porPagina, TETO_PAGINA_CONSULTA));
  const f = clausulaFiltros(d, filtros, escopo);
  const cols = d.colunas.map((c) => c.coluna).join(', ');
  let sql: string;
  const parametros: unknown[] = [...f.parametros];
  if (d.chave.length > 0) {
    const onde = [...f.sql];
    if (apos) {
      if (apos.length !== d.chave.length) throw new ErroConsulta('pagina-invalida', 'Página inválida.');
      const k = clausulaKeyset(d, apos);
      onde.push(k.sql);
      parametros.push(...k.parametros);
    }
    sql = `SELECT FIRST ${n + 1} ${cols} FROM ${d.tabela}${onde.length ? ` WHERE ${onde.join(' AND ')}` : ''} ORDER BY ${d.chave.join(', ')}`;
  } else {
    const pos = apos ? Number(apos[0]) : 0;
    if (!Number.isSafeInteger(pos) || pos < 0 || pos > SKIP_MAXIMO)
      throw new ErroConsulta('pagina-invalida', 'Página além do limite: filtre mais.');
    sql = `SELECT FIRST ${n + 1} SKIP ${pos} ${cols} FROM ${d.tabela}${f.sql.length ? ` WHERE ${f.sql.join(' AND ')}` : ''}`;
  }
  const brutas = await l.consultar(sql, parametros, { teto: n + 1, tempoMaximoMs: TEMPO_CONSULTA_MS });
  const linhas = brutas.slice(0, n).map((b) => linhaDaConsulta(d, b, charsetTextoDe(l.hospital)));
  let proxima: PaginaConsultaLida['proxima'] = null;
  if (brutas.length > n) {
    if (d.chave.length > 0) {
      const ultima = linhas[linhas.length - 1]!;
      proxima = d.chave.map((k) => {
        const c = d.colunas.find((x) => x.coluna === k)!;
        const v = ultima[c.campo];
        return v === undefined ? null : (v as string | number | null);
      });
    } else proxima = [Number(apos?.[0] ?? 0) + n];
  }
  return { linhas, proxima };
}

export function linhaDaConsulta(
  d: DeclaracaoConsulta,
  b: Linha,
  charsetBanco: CharsetLegado = 'CP1252',
): Record<string, ValorCampo> {
  return Object.fromEntries(
    d.colunas.map((c) => [
      c.campo,
      valorDaConsulta({ tipo: c.tipo, utf8: colunaUtf8(d.tabela, c.coluna), charsetBanco }, b[c.coluna]),
    ]),
  );
}

/** Contagem com teto ("mais de 10.000"); passou do tempo, "mais de" sem o número exato. */
export async function contarConsulta(
  l: Leitor,
  d: DeclaracaoConsulta,
  filtros: readonly FiltroConsulta[],
  escopo?: FiltroEscopo,
): Promise<{ valor: number; maisDe: boolean }> {
  const f = clausulaFiltros(d, filtros, escopo);
  try {
    const [x] = await l.consultar(
      `SELECT COUNT(*) N FROM (SELECT FIRST ${TETO_CONTAGEM_CONSULTA + 1} 1 X FROM ${d.tabela}${f.sql.length ? ` WHERE ${f.sql.join(' AND ')}` : ''})`,
      f.parametros,
      { teto: 1, tempoMaximoMs: TEMPO_CONTAGEM_MS },
    );
    const n = Number(typeof x?.['N'] === 'bigint' ? Number(x['N']) : (x?.['N'] ?? 0));
    return n > TETO_CONTAGEM_CONSULTA
      ? { valor: TETO_CONTAGEM_CONSULTA, maisDe: true }
      : { valor: n, maisDe: false };
  } catch (e) {
    if (e instanceof ErroTempoEsgotado) return { valor: TETO_CONTAGEM_CONSULTA, maisDe: true };
    throw e;
  }
}

/** Registro pela chave inteira (códigos da chave na ordem da declaração). */
export async function registroDaConsulta(
  l: Leitor,
  d: DeclaracaoConsulta,
  chave: readonly string[],
  escopo?: FiltroEscopo,
): Promise<Record<string, ValorCampo> | null> {
  if (d.chave.length === 0)
    throw new ErroConsulta('sem-chave', 'Esta tabela não tem chave: o registro não abre sozinho.');
  if (chave.length !== d.chave.length) throw new ErroConsulta('pagina-invalida', 'Código inválido.');
  const cols = d.chave.map((k) => d.colunas.find((c) => c.coluna === k)!);
  const parametros = cols.map((c, i) => {
    const v = chave[i] ?? '';
    if (c.tipo === 'inteiro') {
      if (!/^-?\d{1,15}$/.test(v)) throw new ErroConsulta('pagina-invalida', 'Código inválido.');
      return Number(v);
    }
    if (c.tipo === 'decimal') return Number(v);
    return paramDaChave(c, v);
  });
  const e = clausulaEscopoConsulta(d, escopo);
  const [b] = await l.consultar(
    `SELECT ${d.colunas.map((c) => c.coluna).join(', ')} FROM ${d.tabela} WHERE ${[...cols.map((c) => `${c.coluna} = ?`), ...e.sql].join(' AND ')}`,
    [...parametros, ...e.parametros],
    { teto: 1, tempoMaximoMs: TEMPO_CONSULTA_MS },
  );
  return b ? linhaDaConsulta(d, b, charsetTextoDe(l.hospital)) : null;
}

/** Linhas da exportação (as do filtro), com teto: acima dele, recusa (filtre mais). */
export async function linhasParaExportar(
  l: Leitor,
  d: DeclaracaoConsulta,
  filtros: readonly FiltroConsulta[],
  escopo?: FiltroEscopo,
): Promise<Record<string, ValorCampo>[]> {
  const f = clausulaFiltros(d, filtros, escopo);
  const ordem = d.chave.length ? ` ORDER BY ${d.chave.join(', ')}` : '';
  const brutas = await l.consultar(
    `SELECT FIRST ${TETO_EXPORTACAO_CONSULTA + 1} ${d.colunas.map((c) => c.coluna).join(', ')} FROM ${d.tabela}${f.sql.length ? ` WHERE ${f.sql.join(' AND ')}` : ''}${ordem}`,
    f.parametros,
    { teto: TETO_EXPORTACAO_CONSULTA + 1, tempoMaximoMs: TEMPO_CONSULTA_MS * 2 },
  );
  if (brutas.length > TETO_EXPORTACAO_CONSULTA)
    throw new ErroConsulta(
      'exportacao-grande',
      `A exportação passa de ${TETO_EXPORTACAO_CONSULTA} linhas: filtre mais.`,
    );
  return brutas.map((b) => linhaDaConsulta(d, b, charsetTextoDe(l.hospital)));
}
