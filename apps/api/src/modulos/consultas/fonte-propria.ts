// Fonte PRÓPRIA das consultas somente leitura (M14; F2.2): o banco do cliente pelo @sgh/nucleo, sempre em transação
// somente leitura (nada é gravado; regra 5). A declaração física sai das colunas e dos índices da tabela do modelo
// (information_schema, guardada por 10 minutos); o SQL é parametrizado (`?`) e os nomes de tabela e coluna passam
// pela conferência de nome do núcleo e vêm só da declaração (lista branca), nunca do pedido.
// Toda leitura filtra o estabelecimento da sessão quando a tabela o tem (a de rede aceita o nulo: vale para todos) e
// tira os excluídos; o escopo restrito do M06 vira `coluna IN (…)` e, sem coluna, a leitura é recusada (falha fechada).
// Sem estabelecimento_id, o filtro vai pela tabela-pai (EXISTS pela chave estrangeira; pais de lista branca em
// declaracao.ts) e, sem caminho conhecido, a leitura é recusada. A consulta em tabela compartilhada leva o filtro fixo.
// Melhoria: paginação por chave (o id) com teto, contagem com teto ("mais de N") e exportação com teto, todas no banco.
import type { ConsultaPublica, ValorCampo } from '@sgh/contratos';
import { TETO_CONTAGEM_CONSULTA, TETO_EXPORTACAO_CONSULTA, TETO_PAGINA_CONSULTA } from '@sgh/contratos';
import { type ContextoNucleo, conferirNome, type Leitor, type NucleoProprio } from '@sgh/nucleo';
import {
  type ColunaDoBanco,
  type DeclaracaoConsulta,
  ErroConsulta,
  ErroEscopo,
  type FiltroConsulta,
  type FiltroEscopo,
  type FiltroFixoConsulta,
  montarDeclaracao,
  type PaiDoBanco,
} from './declaracao.js';
import { type CtxConsulta, destinoDaConsulta, type FonteConsultas, type JustificativaExportacao } from './fonte.js';

/** O mínimo do núcleo que a fonte usa (os testes trocam). */
export type NucleoConsultas = Pick<NucleoProprio, 'lerSomente'>;

const CACHE_MS = 10 * 60_000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

type Linha = Record<string, unknown>;

/** Dia seguinte de "AAAA-MM-DD" (o fim do período é exclusivo no SQL). */
function diaSeguinte(v: string): string {
  const d = new Date(`${v}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const dois = (n: number) => String(n).padStart(2, '0');
/** Valor do banco → valor da tela (datas ISO, decimal em número, sim/não). */
function valorDaTela(v: unknown, c: DeclaracaoConsulta['colunas'][number]): ValorCampo {
  if (v === null || v === undefined) return null;
  if (c.booleano) return v === true || v === 1 || v === '1' ? 'Sim' : 'Não';
  if (v instanceof Date) {
    if (c.tipo === 'data') return v.toISOString().slice(0, 10);
    return `${v.getFullYear()}-${dois(v.getMonth() + 1)}-${dois(v.getDate())} ${dois(v.getHours())}:${dois(v.getMinutes())}:${dois(v.getSeconds())}`;
  }
  if (c.tipo === 'inteiro' || c.tipo === 'decimal') {
    const n = Number(typeof v === 'bigint' ? v.toString() : v);
    return Number.isFinite(n) ? n : String(v);
  }
  if (c.tipo === 'data') return String(v).slice(0, 10);
  if (c.tipo === 'dataHora') return String(v).replace('T', ' ').slice(0, 19);
  return String(v);
}

function linhaDaTela(x: Linha, d: DeclaracaoConsulta): Record<string, ValorCampo> {
  return Object.fromEntries(d.colunas.map((c) => [c.campo, valorDaTela(x[c.coluna], c)]));
}

/** O filtro fixo da consulta em SQL (nomes da lista branca do gerador, valores como parâmetro). */
function sqlFixo(f: FiltroFixoConsulta, p: unknown[]): string {
  const col = conferirNome(f.coluna);
  if ('em' in f) return `${col} IN (SELECT id FROM ${conferirNome(f.em.tabela)} WHERE ${sqlFixo(f.em.filtro, p)})`;
  p.push(f.valor);
  return `${col} = ?`;
}

/** As cláusulas fixas (estabelecimento, exclusão, escopo) e as dos filtros, com os parâmetros. */
function clausulas(
  d: DeclaracaoConsulta,
  est: number,
  filtros: readonly FiltroConsulta[],
  escopo: FiltroEscopo | undefined,
): { sql: string[]; p: unknown[] } {
  const sql: string[] = [];
  const p: unknown[] = [];
  if (d.semCaminhoEstabelecimento)
    throw new ErroEscopo('Consulta sem caminho para o estabelecimento da sessão: leitura recusada.');
  if (d.porEstabelecimento === 'obrigatorio') {
    sql.push('estabelecimento_id = ?');
    p.push(est);
  } else if (d.porEstabelecimento === 'opcional') {
    sql.push('(estabelecimento_id = ? OR estabelecimento_id IS NULL)');
    p.push(est);
  }
  const tabela = conferirNome(d.tabela);
  for (const pai of d.estabelecimentoPorPai ?? []) {
    const ref = `${tabela}.${conferirNome(pai.coluna)}`;
    const doPai = pai.estabelecimentoNulo
      ? '(pai.estabelecimento_id = ? OR pai.estabelecimento_id IS NULL)'
      : 'pai.estabelecimento_id = ?';
    const existe = `EXISTS (SELECT 1 FROM ${conferirNome(pai.tabela)} pai WHERE pai.id = ${ref} AND ${doPai})`;
    sql.push(pai.colunaNula ? `(${ref} IS NULL OR ${existe})` : existe);
    p.push(est);
  }
  if (d.exclusaoLogica) sql.push('excluido_em IS NULL');
  if (d.fixo) sql.push(sqlFixo(d.fixo, p));
  for (const [e, valores] of Object.entries(escopo ?? {})) {
    if (valores === null || valores === undefined) continue;
    const coluna = d.escopos?.[e as keyof NonNullable<DeclaracaoConsulta['escopos']>];
    if (!coluna) throw new ErroEscopo(`Escopo ${e} restrito sem coluna na consulta: leitura recusada.`);
    if (valores.length === 0) {
      sql.push('1 = 0');
      continue;
    }
    sql.push(`${conferirNome(coluna)} IN (${valores.map(() => '?').join(', ')})`);
    p.push(...valores);
  }
  for (const f of filtros) {
    const c = d.colunas.find((x) => x.campo === f.campo);
    if (!c || !c.filtro || c.filtro !== f.modo)
      throw new ErroConsulta('filtro-invalido', 'Filtro só por coluna indexada.');
    const col = conferirNome(c.coluna);
    if (f.modo === 'igual') {
      sql.push(`${col} = ?`);
      p.push(f.igual);
    } else {
      if (f.de) {
        if (!DATA.test(f.de)) throw new ErroConsulta('filtro-invalido', 'Data inválida.');
        sql.push(`${col} >= ?`);
        p.push(f.de);
      }
      if (f.ate) {
        if (!DATA.test(f.ate)) throw new ErroConsulta('filtro-invalido', 'Data inválida.');
        sql.push(`${col} < ?`);
        p.push(diaSeguinte(f.ate));
      }
    }
  }
  return { sql, p };
}

const onde = (sql: readonly string[]) => (sql.length ? ` WHERE ${sql.join(' AND ')}` : '');

export class FonteConsultasPropria implements FonteConsultas {
  readonly destino = 'banco' as const;
  private readonly declaracoes = new Map<string, { d: DeclaracaoConsulta | null; em: number }>();
  private readonly estabelecimentos = new Map<string, { id: number; em: number }>();

  constructor(
    private readonly nucleo: NucleoConsultas,
    /** Código do cliente (o banco cliente_<codigo>), da configuração da API (CLIENTE_PADRAO). */
    private readonly cliente: string,
    private readonly agora: () => number = Date.now,
  ) {}

  private contexto(c: CtxConsulta, est: number | null): ContextoNucleo {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario ?? null,
      correlacao: (c.correlacao || 'consulta').slice(0, 64),
    };
  }

  private async estabelecimento(c: CtxConsulta): Promise<number> {
    if (c.estabelecimento) return c.estabelecimento;
    const x = this.estabelecimentos.get(c.hospital);
    if (x && this.agora() - x.em < CACHE_MS) return x.id;
    const r = await this.nucleo.lerSomente(this.contexto(c, null), (l) =>
      l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [c.hospital]),
    );
    if (!r) throw new ErroConsulta('filtro-invalido', 'O estabelecimento da sessão não está no banco do cliente.');
    const id = Number(r['id']);
    this.estabelecimentos.set(c.hospital, { id, em: this.agora() });
    return id;
  }

  private async ler<T>(c: CtxConsulta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(l, est));
  }

  async declaracao(c: CtxConsulta, publico: ConsultaPublica): Promise<DeclaracaoConsulta | null> {
    const destino = destinoDaConsulta(publico);
    if (!destino) return null;
    const { tabela, fixo } = destino;
    const k = `${publico.modulo}.${publico.recurso}`;
    const x = this.declaracoes.get(k);
    if (x && this.agora() - x.em < CACHE_MS) return x.d;
    const d = await this.nucleo.lerSomente(this.contexto(c, null), async (l) => {
      const cols = await l.consultar(
        `SELECT COLUMN_NAME AS nome, DATA_TYPE AS tipo, COLUMN_TYPE AS tipo_completo, IS_NULLABLE AS nulo,
                COLUMN_COMMENT AS comentario
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [tabela],
        { teto: 500 },
      );
      if (cols.length === 0) return null;
      const idx = await l.consultar(
        `SELECT DISTINCT COLUMN_NAME AS nome FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND SEQ_IN_INDEX = 1`,
        [tabela],
        { teto: 500 },
      );
      if (fixo && !cols.some((r) => String(r['nome']) === fixo.coluna)) return null;
      // Chaves estrangeiras para tabelas-pai com estabelecimento_id (o caminho do estabelecimento sem a coluna).
      const fks = await l.consultar(
        `SELECT k.COLUMN_NAME AS coluna, k.REFERENCED_TABLE_NAME AS pai, c.IS_NULLABLE AS nulo, pc.IS_NULLABLE AS pai_nulo
           FROM information_schema.KEY_COLUMN_USAGE k
           JOIN information_schema.COLUMNS c
             ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
           JOIN information_schema.COLUMNS pc
             ON pc.TABLE_SCHEMA = k.TABLE_SCHEMA AND pc.TABLE_NAME = k.REFERENCED_TABLE_NAME
            AND pc.COLUMN_NAME = 'estabelecimento_id'
          WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_COLUMN_NAME = 'id'
            AND k.REFERENCED_TABLE_NAME <> 'estabelecimento'
          ORDER BY k.COLUMN_NAME`,
        [tabela],
        { teto: 200 },
      );
      const pais: PaiDoBanco[] = fks.map((r) => ({
        coluna: String(r['coluna']),
        tabela: String(r['pai']),
        colunaNula: String(r['nulo']) === 'YES',
        estabelecimentoNulo: String(r['pai_nulo']) === 'YES',
      }));
      const colunas: ColunaDoBanco[] = cols.map((r) => ({
        nome: String(r['nome']),
        tipo: String(r['tipo']),
        tipoCompleto: String(r['tipo_completo']),
        aceitaNulo: String(r['nulo']) === 'YES',
        comentario: String(r['comentario'] ?? ''),
      }));
      return montarDeclaracao(publico, tabela, colunas, new Set(idx.map((r) => String(r['nome']))), {
        ...(fixo ? { fixo } : {}),
        pais,
      });
    });
    this.declaracoes.set(k, { d, em: this.agora() });
    return d;
  }

  pagina(
    c: CtxConsulta,
    d: DeclaracaoConsulta,
    filtros: readonly FiltroConsulta[],
    apos: readonly (string | number | null)[] | null,
    porPagina: number,
  ) {
    const n = Math.max(1, Math.min(porPagina, TETO_PAGINA_CONSULTA));
    return this.ler(c, async (l, est) => {
      const f = clausulas(d, est, filtros, c.escopo);
      if (apos) {
        const id = Number(apos[0]);
        if (apos.length !== 1 || !Number.isSafeInteger(id) || id < 0)
          throw new ErroConsulta('pagina-invalida', 'Página inválida.');
        f.sql.push('id > ?');
        f.p.push(id);
      }
      const cols = d.colunas.map((x) => conferirNome(x.coluna)).join(', ');
      const ls = await l.consultar(
        `SELECT ${cols} FROM ${conferirNome(d.tabela)}${onde(f.sql)} ORDER BY id LIMIT ${n + 1}`,
        f.p,
        { teto: n + 1 },
      );
      const pagina = ls.slice(0, n);
      const ultima = pagina[pagina.length - 1];
      return {
        linhas: pagina.map((x) => linhaDaTela(x, d)),
        proxima: ls.length > n && ultima ? [Number(ultima['id'])] : null,
      };
    });
  }

  contar(c: CtxConsulta, d: DeclaracaoConsulta, filtros: readonly FiltroConsulta[]) {
    return this.ler(c, async (l, est) => {
      const f = clausulas(d, est, filtros, c.escopo);
      const r = await l.uma<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${conferirNome(d.tabela)}${onde(f.sql)} LIMIT ${TETO_CONTAGEM_CONSULTA + 1}) x`,
        f.p,
      );
      const n = Number(r?.n ?? 0);
      return n > TETO_CONTAGEM_CONSULTA
        ? { valor: TETO_CONTAGEM_CONSULTA, maisDe: true }
        : { valor: n, maisDe: false };
    });
  }

  registro(c: CtxConsulta, d: DeclaracaoConsulta, chave: readonly string[]) {
    const id = Number(chave[0]);
    if (chave.length !== 1 || !/^\d{1,19}$/.test(chave[0] ?? '') || !Number.isSafeInteger(id))
      return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const f = clausulas(d, est, [], c.escopo);
      f.sql.push('id = ?');
      f.p.push(id);
      const cols = d.colunas.map((x) => conferirNome(x.coluna)).join(', ');
      const x = await l.uma(`SELECT ${cols} FROM ${conferirNome(d.tabela)}${onde(f.sql)}`, f.p);
      return x ? linhaDaTela(x, d) : null;
    });
  }

  exportar(c: CtxConsulta, d: DeclaracaoConsulta, filtros: readonly FiltroConsulta[]) {
    return this.ler(c, async (l, est) => {
      const f = clausulas(d, est, filtros, c.escopo);
      const cols = d.colunas.map((x) => conferirNome(x.coluna)).join(', ');
      const ls = await l.consultar(
        `SELECT ${cols} FROM ${conferirNome(d.tabela)}${onde(f.sql)} ORDER BY id LIMIT ${TETO_EXPORTACAO_CONSULTA + 1}`,
        f.p,
        { teto: TETO_EXPORTACAO_CONSULTA + 1 },
      );
      if (ls.length > TETO_EXPORTACAO_CONSULTA)
        throw new ErroConsulta('exportacao-grande', 'A exportação passa do teto: filtre mais (período ou código).');
      return ls.map((x) => linhaDaTela(x, d));
    });
  }

  justificativas(c: CtxConsulta): Promise<readonly JustificativaExportacao[]> {
    // Domínio do cliente inteiro (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, descricao FROM tipo_justificativa_exportacao WHERE ativo ORDER BY descricao, id', [], {
          teto: 500,
        })
      ).map((x) => ({ codigo: Number(x['id']), descricao: String(x['descricao']) })),
    );
  }
}
