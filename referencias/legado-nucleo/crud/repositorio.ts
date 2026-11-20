// Leituras do CRUD genérico (ficha do M08, seção 4): sempre READ ONLY, SQL explícito e parametrizado.
//   - lista do domínio: ordem pela chave primária, teto de 500 linhas (lê 501 para saber se passou);
//     filtro por descrição em JS normalizado, no servidor (o banco não ignora acento);
//   - item para edição: pela chave primária; a versão são as colunas mostradas (controle otimista);
//   - uso do item antes de inativar: as FKs do catálogo RDB$ que apontam para a tabela, EXISTS por FK
//     (FIRST 1 pela coluna da FK, indexada), uma consulta por referência, em sequência;
//   - opções de um campo de referência: a tabela de opções (chave e descrição), com teto.
// Filtro de escopo (M06, regra 6; pendência 16 do M06): a porta recebe o filtro da sessão
// (`filtroDeEscopo`) e aplica em toda lista e item, na coluna de escopo que a declaração mapeia; escopo
// restrito sem coluna na declaração falha fechado (nenhuma linha sai do escopo).
import { type DeclaracaoDominio, type ItemDominio, type ReferenciaCampo, versaoDoItem } from '@sgh/contratos';
import type { Linha } from '../driver.js';
import type { Leitor } from '../transacao.js';
import {
  chaveDoCodigo,
  colunaDoCampo,
  colunasLidas,
  condicaoDaChave,
  itemDaLinha,
  ordemDaChave,
  valoresDaChave,
} from './declaracao.js';
import {
  descricaoSentinela,
  TETO_TABELA_DOMINIO,
  tetoDoDominio,
  versaoDaLinha,
} from '../gravacao/receita-generica.js';
import { lerInativosSoNoNovo } from '../../config/repositorios/dominio-situacao.js';
import { lerBlobTexto } from '../codec.js';

export type FiltroEscopo = Readonly<Partial<Record<string, readonly string[] | null>>>;

export class ErroEscopo extends Error {
  override readonly name = 'ErroEscopo';
}

/** Cláusula e parâmetros do escopo (vazia quando não há restrição). */
export function clausulaEscopo(
  d: DeclaracaoDominio,
  filtro: FiltroEscopo | undefined,
): { sql: string; parametros: unknown[] } {
  const partes: string[] = [];
  const parametros: unknown[] = [];
  for (const [escopo, valores] of Object.entries(filtro ?? {})) {
    if (valores === null || valores === undefined) continue;
    const coluna = d.escopos?.[escopo as keyof NonNullable<DeclaracaoDominio['escopos']>];
    if (!coluna) throw new ErroEscopo(`Escopo ${escopo} restrito sem coluna na declaração: lista recusada.`);
    if (valores.length === 0) {
      partes.push('1 = 0');
      continue;
    }
    partes.push(`${coluna} IN (${valores.map(() => '?').join(', ')})`);
    parametros.push(...valores);
  }
  return { sql: partes.join(' AND '), parametros };
}

export interface ListaLida {
  readonly itens: ItemDominio[];
  readonly truncada: boolean;
}

/**
 * Item como a tela o vê. M14: inativo só no novo (SGH_CFG_DOMINIO_SITUACAO) também conta como inativo; a
 * versão leva a situação, então inativar por fora (outra pessoa) vira colisão.
 */
function paraItem(d: DeclaracaoDominio, l: Linha, inativosNoNovo: ReadonlySet<string>): ItemDominio {
  const i = itemDaLinha(d, l);
  if (!d.situacao && inativosNoNovo.has(i.codigo)) {
    const inativo = { ...i, ativo: false };
    return { ...inativo, versao: versaoDoItem(inativo.valores, false) };
  }
  return { ...i, versao: versaoDaLinha(d, l) };
}

async function inativosDe(l: Leitor, d: DeclaracaoDominio): Promise<ReadonlySet<string>> {
  return d.situacaoSoNoNovo ? lerInativosSoNoNovo(l, d.tabela) : new Set();
}

export async function listarDominio(
  l: Leitor,
  d: DeclaracaoDominio,
  filtro?: FiltroEscopo,
): Promise<ListaLida> {
  const e = clausulaEscopo(d, filtro);
  const teto = tetoDoDominio(d);
  const linhas = await l.consultar(
    `SELECT FIRST ${teto} ${colunasLidas(d).join(', ')} FROM ${d.tabela}${e.sql ? ` WHERE ${e.sql}` : ''} ORDER BY ${ordemDaChave(d)}`,
    e.parametros,
    { teto },
  );
  const truncada = linhas.length >= teto;
  const inativos = await inativosDe(l, d);
  return { itens: linhas.slice(0, teto - 1).map((x) => paraItem(d, x, inativos)), truncada };
}

export async function itemDoDominio(
  l: Leitor,
  d: DeclaracaoDominio,
  codigo: string,
  filtro?: FiltroEscopo,
): Promise<ItemDominio | null> {
  const e = clausulaEscopo(d, filtro);
  const [linha] = await l.consultar(
    `SELECT ${colunasLidas(d).join(', ')} FROM ${d.tabela} WHERE ${condicaoDaChave(d)}${e.sql ? ` AND ${e.sql}` : ''}`,
    [...valoresDaChave(d, codigo), ...e.parametros],
    { teto: 1 },
  );
  return linha ? paraItem(d, linha, await inativosDe(l, d)) : null;
}

/**
 * Correção do M14: os textos longos do item (BLOB de texto), em leitura, decodificados como a coluna guarda
 * (CP1252, sem conversão; RTF sai como está gravado). Mesmo escopo do item: fora dele, null (404 na API).
 */
export async function textosLongosDoItem(
  l: Leitor,
  d: DeclaracaoDominio,
  codigo: string,
  filtro?: FiltroEscopo,
): Promise<Record<string, string | null> | null> {
  const cols = d.textosLongos ?? [];
  const e = clausulaEscopo(d, filtro);
  const [linha] = await l.consultar(
    `SELECT ${[...new Set([...(d.chaveComposta ?? [d.chave]), ...cols.map((c) => c.coluna)])].join(', ')} FROM ${d.tabela} WHERE ${condicaoDaChave(d)}${e.sql ? ` AND ${e.sql}` : ''}`,
    [...valoresDaChave(d, codigo), ...e.parametros],
    { teto: 1 },
  );
  if (!linha) return null;
  const r: Record<string, string | null> = {};
  for (const c of cols) {
    const v = linha[c.coluna];
    if (v === null || v === undefined) r[c.campo] = null;
    else if (typeof v === 'string') r[c.campo] = v;
    else {
      const bytes = Buffer.isBuffer(v) ? v : await l.lerBlob(v);
      const texto = lerBlobTexto(bytes).texto;
      r[c.campo] = texto === '' ? null : texto;
    }
  }
  return r;
}

export interface ReferenciaFkLida {
  readonly tabela: string;
  readonly coluna: string;
  readonly regra: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
}

/** FKs de uma coluna que apontam para a chave da tabela (catálogo RDB$). */
export async function referenciasDaTabela(l: Leitor, tabela: string): Promise<ReferenciaFkLida[]> {
  const linhas = await l.consultar(
    `SELECT TRIM(rc.RDB$RELATION_NAME) FILHA, TRIM(s.RDB$FIELD_NAME) COLUNA, TRIM(ref.RDB$DELETE_RULE) REGRA,
            (SELECT COUNT(*) FROM RDB$INDEX_SEGMENTS s2 WHERE s2.RDB$INDEX_NAME = rc.RDB$INDEX_NAME) SEGMENTOS
       FROM RDB$RELATION_CONSTRAINTS rc
       JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
       JOIN RDB$RELATION_CONSTRAINTS pk ON pk.RDB$CONSTRAINT_NAME = ref.RDB$CONST_NAME_UQ
       JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
      WHERE pk.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
      ORDER BY 1, 2`,
    [tabela],
    { teto: 500 },
  );
  const regras = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']);
  return linhas
    .filter((x) => Number(x['SEGMENTOS']) === 1)
    .map((x) => ({
      tabela: String(x['FILHA']),
      coluna: String(x['COLUNA']),
      regra: (regras.has(String(x['REGRA'])) ? String(x['REGRA']) : 'RESTRICT') as ReferenciaFkLida['regra'],
    }));
}

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Uso do item: uma consulta FIRST 1 por FK (índice da FK), em sequência; só booleano (nenhum valor sai). */
export async function usoDoItem(
  l: Leitor,
  d: DeclaracaoDominio,
  codigo: string,
): Promise<{ regra: ReferenciaFkLida['regra']; usos: boolean; tabela: string }[]> {
  // M14: chave composta não é alvo de FK de uma coluna (o catálogo não tem FK para elas).
  if (d.chaveComposta) return [];
  const chave = chaveDoCodigo(d, codigo);
  const r: { regra: ReferenciaFkLida['regra']; usos: boolean; tabela: string }[] = [];
  for (const f of await referenciasDaTabela(l, d.tabela)) {
    if (!NOME.test(f.tabela) || !NOME.test(f.coluna)) continue;
    const [x] = await l.consultar(`SELECT FIRST 1 1 U FROM ${f.tabela} WHERE ${f.coluna} = ?`, [chave], {
      teto: 1,
      tempoMaximoMs: 5_000,
    });
    r.push({ regra: f.regra, usos: x !== undefined, tabela: f.tabela });
  }
  return r;
}

/**
 * M14 (regra 10): a sentinela "não informado" (código 0 ou a descrição) fica fora das escolhas — salvo quando é
 * a única opção da tabela (o legado só tem ela, ex.: os tipos de agenda da recepção).
 */
export function semSentinela(ops: readonly OpcaoCampo[]): OpcaoCampo[] {
  const sentinela = (o: OpcaoCampo) => String(o.valor) === '0' || descricaoSentinela(o.rotulo);
  if (!ops.some((o) => o.ativo && !sentinela(o))) return [...ops];
  return ops.map((o) => (sentinela(o) ? { ...o, ativo: false } : o));
}

/** M24: maior teto de opções de uma referência a tabela (o item de estoque tem 7.147 linhas no pc). */
export const TETO_OPCOES_MAXIMO = 10_000;

export interface OpcaoCampo {
  readonly valor: number | string;
  readonly rotulo: string;
  readonly ativo: boolean;
}

/** Opções de um campo de referência (outro domínio declarado ou tabela de opções do legado). */
export async function opcoesDoCampo(
  l: Leitor,
  d: DeclaracaoDominio,
  campo: string,
  dominio: (id: string) => DeclaracaoDominio | undefined,
): Promise<OpcaoCampo[]> {
  const c = colunaDoCampo(d, campo);
  const ref: ReferenciaCampo | undefined = c?.referencia;
  if (!ref) throw new Error('Campo sem referência.');
  if ('dominio' in ref) {
    const alvo = dominio(ref.dominio);
    if (!alvo) throw new Error(`Domínio de referência ${ref.dominio} não declarado.`);
    const lista = await listarDominio(l, alvo);
    return semSentinela(
      lista.itens.map((i) => ({
        valor: Number(i.codigo),
        rotulo: String(i.valores[alvo.descricao] ?? i.codigo),
        ativo: i.ativo,
      })),
    );
  }
  for (const n of [ref.tabela, ref.chave, ref.descricao])
    if (!NOME.test(n)) throw new Error('Referência inválida.');
  // M24: o teto da referência (item de estoque) vale até 10.000 opções; o padrão é o da tabela de domínio.
  const teto = Math.min(TETO_OPCOES_MAXIMO, Math.max(TETO_TABELA_DOMINIO, ref.teto ?? 0));
  const linhas = await l.consultar(
    `SELECT FIRST ${teto} ${ref.chave} V, ${ref.descricao} R FROM ${ref.tabela} ORDER BY ${ref.chave}`,
    [],
    { teto },
  );
  return semSentinela(
    linhas.map((x) => ({
      valor: typeof x['V'] === 'number' ? x['V'] : String(x['V']).replace(/ +$/, ''),
      rotulo: String(x['R'] ?? '').replace(/ +$/, ''),
      ativo: true,
    })),
  );
}
