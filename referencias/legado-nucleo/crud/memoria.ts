// Banco EM MEMÓRIA dos domínios do CRUD genérico, para a sessão sintética (AMBIENTE dev ou ci, E2E): o mesmo
// executor, a mesma receita genérica e as mesmas leituras rodam sobre tabelas sintéticas em memória, sem
// tocar a cópia (nada é gravado no banco; a gravação real fica para o núcleo com a sessão real e para a
// integração na cópia, sempre desfeita). Entende só o SQL que o CRUD genérico e o executor montam:
// SELECT da tabela (com ou sem WHERE pela chave, WITH LOCK), INSERT … RETURNING da chave, UPDATE … SET …
// WHERE <chave> = ?; as tabelas SGH_ técnicas do executor (trilha, outbox, idempotência) são aceitas e
// descartadas (a trilha da sessão sintética é a do registrador em memória da API). Dados SINTÉTICOS.
import type { DeclaracaoDominio } from '@sgh/contratos';
import type { Linha } from '../driver.js';
import { Executor } from '../executor.js';
import type { FonteCatalogo } from '../catalogo-operacoes.js';
import type { Escritor, Leitor } from '../transacao.js';
import { chavesDe, colunaDaChave, valorParaColuna } from './declaracao.js';

/** Tabela em memória: colunas da chave (M14: chave composta), linhas e o "generator". */
type Tabelas = Map<string, { chave: string; chaves?: readonly string[]; linhas: Linha[]; gerador: number }>;

/** M14: SGH_CFG_DOMINIO_SITUACAO em memória (inativação só no novo da sessão sintética). */
const SITUACAO_NOVO = '#SGH_CFG_DOMINIO_SITUACAO';

function clonar(t: Tabelas): Tabelas {
  const c: Tabelas = new Map([...t].map(([k, v]) => [k, { ...v, linhas: v.linhas.map((l) => ({ ...l })) }]));
  const fks = FKS_MEMORIA.get(t);
  if (fks) FKS_MEMORIA.set(c, fks);
  return c;
}

const chavesDaTabela = (x: { chave: string; chaves?: readonly string[] }) => x.chaves ?? [x.chave];

function comparar(a: Linha, b: Linha, cols: readonly string[]): number {
  for (const c of cols) {
    const x = a[c];
    const y = b[c];
    const r =
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    if (r !== 0) return r;
  }
  return 0;
}

function situacaoNovo(t: Tabelas): Linha[] {
  let x = t.get(SITUACAO_NOVO);
  if (!x) {
    x = { chave: 'ID', linhas: [], gerador: 0 };
    t.set(SITUACAO_NOVO, x);
  }
  return x.linhas;
}

/** W0-02: as referências entre os domínios em memória (filha.coluna → mãe.chave), registradas pelo banco. */
const FKS_MEMORIA = new WeakMap<
  Tabelas,
  readonly { filha: string; coluna: string; mae: string; chaveMae: string }[]
>();

function fksEmMemoria(t: Tabelas, mae: string): Linha[] {
  return (FKS_MEMORIA.get(t) ?? [])
    .filter((f) => f.mae === mae)
    .map((f, i) => ({
      NOME: `FK_MEMORIA_${i}`,
      FILHA: f.filha,
      COLUNA: f.coluna,
      MAE: f.chaveMae,
      REGRA: 'RESTRICT',
      POS: 0,
    }));
}

function filtrarDependentes(
  t: Tabelas,
  tabela: string,
  onde: string,
  fora: string | undefined,
  p: readonly unknown[],
): Linha[] {
  const x = t.get(tabela);
  if (!x) throw new Error('Tabela fora do banco em memória.');
  const cols = onde.split(' AND ').map((f) => f.split(' = ')[0]?.trim() ?? '');
  const colsFora = (fora ?? '')
    .split(' AND ')
    .filter(Boolean)
    .map((f) => f.split(' = ')[0]?.trim() ?? '');
  return x.linhas.filter(
    (l) =>
      cols.every((c, i) => String(l[c]) === String(p[i])) &&
      !(colsFora.length > 0 && colsFora.every((c, i) => String(l[c]) === String(p[cols.length + i]))),
  );
}

function responder(t: Tabelas, sql: string, p: readonly unknown[]): Linha[] | number {
  const s = sql.replace(/\s+/g, ' ').trim();
  // M14: inativação só no novo (lida e gravada na memória da sessão sintética).
  if (/NEXT VALUE FOR SGH_GEN_CFG_DOMINIO_SITUACAO/.test(s)) {
    const x = situacaoNovo(t);
    return [{ ID: String(x.length + 1) }];
  }
  if (/^SELECT FIRST \d+ CHAVE FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = \?$/.test(s))
    return situacaoNovo(t)
      .filter((l) => l['TABELA'] === p[0])
      .map((l) => ({ CHAVE: l['CHAVE'] }));
  if (/^SELECT .* FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = \? AND CHAVE = \?$/.test(s))
    return situacaoNovo(t)
      .filter((l) => l['TABELA'] === p[0] && l['CHAVE'] === p[1])
      .map((l) => ({ D: '2026-01-01 00:00:00', A: l['AUTOR'] }));
  if (/^INSERT INTO SGH_CFG_DOMINIO_SITUACAO /.test(s)) {
    const x = situacaoNovo(t);
    if (x.some((l) => l['TABELA'] === p[1] && l['CHAVE'] === p[2]))
      throw new Error('violation of PRIMARY or UNIQUE KEY constraint "SGH_UQ_CFG_DOMINIO_SITUACAO"');
    x.push({ ID: p[0] as string, TABELA: p[1] as string, CHAVE: p[2] as string, AUTOR: p[3] as string });
    return 1;
  }
  if (/^DELETE FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = \? AND CHAVE = \?$/.test(s)) {
    const x = situacaoNovo(t);
    const i = x.findIndex((l) => l['TABELA'] === p[0] && l['CHAVE'] === p[1]);
    if (i < 0) return 0;
    x.splice(i, 1);
    return 1;
  }
  // W0-02: o verificador de dependências em memória. As "FKs" de entrada são as referências entre os domínios
  // declarados (coluna com `referencia: { dominio }`), e a chave primária é a da declaração.
  if (/RDB\$REF_CONSTRAINTS/.test(s) && /FOREIGN KEY/.test(s) && /NOME/.test(s))
    return fksEmMemoria(t, String(p[0]));
  if (/RDB\$RELATION_CONSTRAINTS/.test(s) && /'PRIMARY KEY'/.test(s)) {
    const x = t.get(String(p[0]));
    return x ? chavesDaTabela(x).map((c) => ({ C: c })) : [];
  }
  if (/\bSGH_/i.test(s) || /RDB\$/i.test(s)) return /^\s*(INSERT|UPDATE|DELETE)/i.test(s) ? 1 : [];
  const sq = s.replace(/"/g, '');
  let q =
    /^SELECT COUNT\(\*\) N FROM (\w+) WHERE ((?:\w+ = \?)(?: AND \w+ = \?)*)(?: AND NOT \(((?:\w+ = \?)(?: AND \w+ = \?)*)\))?$/.exec(
      sq,
    );
  if (q) return [{ N: filtrarDependentes(t, q[1] ?? '', q[2] ?? '', q[3], p).length }];
  q =
    /^SELECT FIRST (\d+) ([\w, ]+) FROM (\w+) WHERE ((?:\w+ = \?)(?: AND \w+ = \?)*)(?: AND NOT \(((?:\w+ = \?)(?: AND \w+ = \?)*)\))? ORDER BY [\w, ]+$/.exec(
      sq,
    );
  if (q) {
    const cols = (q[2] ?? '').split(',').map((c) => c.trim());
    return filtrarDependentes(t, q[3] ?? '', q[4] ?? '', q[5], p)
      .slice(0, Number(q[1]))
      .map((l) => Object.fromEntries(cols.map((c) => [c, l[c]])));
  }
  q = /^DELETE FROM (\w+) WHERE ((?:\w+ = \?)(?: AND \w+ = \?)*)$/.exec(s);
  if (q) {
    const x = t.get(q[1] ?? '');
    if (!x) throw new Error('Tabela fora do banco em memória.');
    const filtros = (q[2] ?? '').split(' AND ').map((f) => f.split(' = ')[0]?.trim() ?? '');
    const antes = x.linhas.length;
    x.linhas = x.linhas.filter((l) => !filtros.every((c, i) => String(l[c]) === String(p[i])));
    return antes - x.linhas.length;
  }
  let m = /^SELECT FIRST \d+ (\w+) V, (\w+) R FROM (\w+) ORDER BY \w+$/.exec(s);
  if (m) {
    const x = t.get(m[3] ?? '');
    return (x?.linhas ?? []).map((l) => ({ V: l[m![1]!], R: l[m![2]!] }));
  }
  m = /^SELECT FIRST 1 1 U FROM \w+ WHERE \w+ = \?$/.exec(s);
  if (m) return [];
  m =
    /^SELECT (?:FIRST \d+ )?(.+?) FROM (\w+)(?: WHERE ((?:\w+ = \?)(?: AND \w+ = \?)*))?(?: ORDER BY [\w, ]+)?(?: WITH LOCK)?$/.exec(
      s,
    );
  if (m) {
    const x = t.get(m[2] ?? '');
    if (!x) throw new Error('Tabela fora do banco em memória.');
    const filtros = (m[3] ?? '')
      .split(' AND ')
      .filter(Boolean)
      .map((f) => f.split(' = ')[0]?.trim() ?? '');
    const linhas = x.linhas.filter((l) => filtros.every((c, i) => String(l[c]) === String(p[i])));
    return [...linhas].sort((a, b) => comparar(a, b, chavesDaTabela(x))).map((l) => ({ ...l }));
  }
  m = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \(([^)]*)\)(?: RETURNING (\w+))?$/.exec(s);
  if (m) {
    const x = t.get(m[1] ?? '');
    if (!x) throw new Error('Tabela fora do banco em memória.');
    const cols = (m[2] ?? '').split(',').map((c) => c.trim());
    const l: Linha = Object.fromEntries(cols.map((c, i) => [c, p[i] ?? null]));
    if (!x.chaves && (l[x.chave] === undefined || l[x.chave] === null || l[x.chave] === 0))
      l[x.chave] = ++x.gerador;
    if (x.linhas.some((y) => comparar(y, l, chavesDaTabela(x)) === 0))
      throw new Error('violation of PRIMARY or UNIQUE KEY constraint "PK_MEMORIA"');
    x.linhas.push(l);
    return m[4] ? [{ [m[4]]: l[m[4]] }] : 1;
  }
  m = /^UPDATE (\w+) SET (.+?) WHERE ((?:\w+ = \?)(?: AND \w+ = \?)*)$/.exec(s);
  if (m) {
    const x = t.get(m[1] ?? '');
    if (!x) throw new Error('Tabela fora do banco em memória.');
    const sets = (m[2] ?? '').split(',').map((c) => c.split('=')[0]?.trim() ?? '');
    const filtros = (m[3] ?? '').split(' AND ').map((f) => f.split(' = ')[0]?.trim() ?? '');
    const alvo = x.linhas.find((l) => filtros.every((c, i) => String(l[c]) === String(p[sets.length + i])));
    if (!alvo) return 0;
    sets.forEach((c, i) => (alvo[c] = p[i] ?? null));
    return 1;
  }
  throw new Error('Comando fora do banco em memória.');
}

function escritorDe(t: Tabelas, hospital: string): Escritor {
  return {
    hospital,
    async consultar<T extends Linha>(sql: string, p: readonly unknown[] = []): Promise<T[]> {
      const r = responder(t, sql, p);
      return (Array.isArray(r) ? r : []) as T[];
    },
    async lerBlob() {
      return Buffer.alloc(0);
    },
    async executar(sql: string, p: readonly unknown[] = []) {
      const r = responder(t, sql, p);
      return typeof r === 'number' ? r : 1;
    },
    async executarRetornando(sql: string, p: readonly unknown[] = []) {
      const r = responder(t, sql, p);
      return (Array.isArray(r) ? (r[0] ?? {}) : {}) as Linha;
    },
  };
}

/** Linhas sintéticas de um domínio (3 itens) a partir da declaração. */
export function linhasSinteticas(d: DeclaracaoDominio, quantidade = 3): Linha[] {
  const chave = colunaDaChave(d);
  const chaves = chavesDe(d);
  return Array.from({ length: quantidade }, (_, i) => {
    const l: Linha = {};
    for (const c of d.colunas) {
      if (c.coluna === d.chave && (c.tipo !== 'texto' || !d.chaveComposta))
        l[c.coluna] = (chave.minimo ?? 1) + i;
      else if (d.chaveComposta && chaves.includes(c.coluna) && c.tipo === 'texto')
        l[c.coluna] = `K${i + 1}`.slice(0, Math.max(1, c.maxBytes ?? 2));
      else if (c.constanteNaInclusao !== undefined) l[c.coluna] = c.constanteNaInclusao;
      else if (c.tipo === 'decimal') l[c.coluna] = 1.5 + i;
      else if (c.tipo === 'texto')
        l[c.coluna] =
          `${d.publico.rotulo.singular.slice(0, Math.max(1, (c.maxBytes ?? 10) - 3))} ${i + 1}`.slice(
            0,
            c.maxBytes ?? 10,
          );
      else if (c.tipo === 'letra') l[c.coluna] = c.valores?.[0]?.valor ?? null;
      else if (c.tipo === 'hora') l[c.coluna] = valorParaColuna(c, '01:00');
      else if (c.tipo === 'data') l[c.coluna] = valorParaColuna(c, '9999-12-25');
      // Referência obrigatória aponta para o primeiro item sintético da tabela de opções (código 1).
      else if (c.tipo === 'referencia') l[c.coluna] = c.obrigatorio ? 1 : null;
      else l[c.coluna] = (c.minimo ?? 1) + i;
    }
    // W1-04: o leiaute sintético que a inclusão com leiaute padrão copia (painel de chamada).
    for (const t of d.textosLongos ?? []) if (t.padraoNaInclusao) l[t.coluna] = `${t.rotulo} ${i + 1}`;
    if (d.situacao) l[d.situacao.coluna] = d.situacao.ativo;
    return l;
  });
}

/** Domínios em memória por estabelecimento: leitor, escritor transacional e executor sobre eles. */
export class BancoMemoriaDominios {
  private readonly porHospital = new Map<string, Tabelas>();
  private readonly declaracoes: readonly DeclaracaoDominio[];
  private readonly extras: Readonly<Record<string, { chave: string; linhas: Linha[] }>>;
  constructor(
    declaracoes: readonly DeclaracaoDominio[],
    extras: Readonly<Record<string, { chave: string; linhas: Linha[] }>> = {},
  ) {
    this.declaracoes = declaracoes;
    this.extras = extras;
  }

  private tabelas(hospital: string): Tabelas {
    let t = this.porHospital.get(hospital);
    if (!t) {
      t = new Map();
      for (const d of this.declaracoes) {
        const linhas = linhasSinteticas(d);
        t.set(d.tabela, {
          chave: d.chave,
          ...(d.chaveComposta ? { chaves: d.chaveComposta } : {}),
          linhas,
          gerador: 1000,
        });
      }
      for (const [nome, x] of Object.entries(this.extras))
        t.set(nome, { ...x, linhas: x.linhas.map((l) => ({ ...l })), gerador: 1000 });
      // W0-02: as referências entre domínios declarados viram as FKs de entrada do verificador de dependências.
      const porId = new Map(this.declaracoes.map((d) => [`${d.publico.modulo}.${d.publico.recurso}`, d]));
      FKS_MEMORIA.set(
        t,
        this.declaracoes.flatMap((d) =>
          d.colunas.flatMap((c) => {
            const ref = c.referencia;
            const alvo = ref && 'dominio' in ref ? porId.get(ref.dominio) : undefined;
            return alvo && !alvo.chaveComposta
              ? [{ filha: d.tabela, coluna: c.coluna, mae: alvo.tabela, chaveMae: alvo.chave }]
              : [];
          }),
        ),
      );
      this.porHospital.set(hospital, t);
    }
    return t;
  }

  ler<T>(hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return fn(escritorDe(this.tabelas(hospital), hospital));
  }

  /** Transação em memória: confirma trocando o estado só no sucesso e com `confirmar`. */
  async escrever<T>(hospital: string, fn: (e: Escritor) => Promise<T>, confirmar: boolean): Promise<T> {
    const copia = clonar(this.tabelas(hospital));
    const r = await fn(escritorDe(copia, hospital));
    if (confirmar) this.porHospital.set(hospital, copia);
    return r;
  }

  criarExecutor(catalogo: FonteCatalogo, ambiente: string): Executor {
    return new Executor({
      ambiente,
      catalogo,
      schema: { bloqueada: () => false },
      ler: (ctx, fn) => this.ler(ctx.hospital, fn),
      escrever: (ctx, fn, confirmar) => this.escrever(ctx.hospital, fn, confirmar),
    });
  }
}
