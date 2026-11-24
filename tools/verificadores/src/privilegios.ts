// M59-F1 (regra 4): privilégio mínimo por módulo no banco próprio. Monta o alcance de cada módulo da API a partir do
// código (o SQL das portas próprias e as tabelas que cada operação declara ao Executor) e do comum que o Executor grava
// em toda operação (trilha, idempotência, numeração e saída de mensagens), casado com as tabelas do DDL
// (db/migracoes). Gera os artefatos versionados em infra/mariadb/privilegios: o alcance e o par de scripts aplicar e
// recolher dos papéis por módulo, executados pela TI no banco de cada cliente, um passo por autorização do dono.
// Melhoria: um único alcance para todos os clientes (o DDL é o mesmo em todo banco de cliente), sem retrato por hospital.
// Melhoria: sem dependência de gatilho (o banco próprio não tem regra em gatilho): o alcance é só o que o código usa.
// Melhoria: o nome de tabela por constante é resolvido antes de casar (`const TABELA = 'x'`, listas `[A, ...B]`,
//   `${DE_X}` com trecho de SQL, `tx.incluir(TABELA, ...)`, `tabelas: TABELAS`); o nome dinâmico (`${tabela}`,
//   `tx.alterar(d.tabela, ...)`) vale para o catálogo de tabelas do módulo (`tabela: 'x'`); sem catálogo, é ERRO do
//   gerador, nunca silêncio. Módulo sem nenhum uso vira aviso.
// Melhoria: o plano é conferido como o do domínio (planejarPrivilegios/exigirPlanoImutavel de @sgh/dominio-acesso),
//   adaptado ao MariaDB: identificador do banco, módulo repetido, UPDATE/DELETE na trilha e DELETE em tabela clínica
//   (DDL do prontuário, do centro cirúrgico e do diagnóstico) RECUSAM o plano inteiro, com todos os motivos; DELETE em
//   tabela de exclusão lógica (excluido_em) vira descarte listado (aviso), nunca privilégio.
//   O domínio não é chamado direto: ele valida identificador do Firebird (maiúsculo), a trilha SGH_TRILHA e a lista de
//   tabelas clínicas do sistema de origem; a generalização dele para o banco próprio está pedida no saida/05-11.json.
// Melhoria: REVOKE espelhado no recolher, por banco de cliente (o papel é do servidor e serve a todos os clientes).
// Limite conhecido (aviso no script e pedido no saida): o papel só reduz privilégio quando a conta da API passa a
//   usá-lo (conta por módulo com SET DEFAULT ROLE, ou SET ROLE por operação no núcleo). Até lá, aplicar o script não
//   muda o que a API pode.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const RAIZ = resolve(import.meta.dirname, '../../..');
export const PASTA_MODULOS = 'apps/api/src/modulos';
export const PASTA_DDL = 'db/migracoes';
export const PASTA_ARTEFATOS = 'infra/mariadb/privilegios';
export const NOME_ETAPA_PAPEIS = '0001_papeis_por_modulo';
export const caminhoAlcance = () => `${PASTA_ARTEFATOS}/alcance.json`;
export const caminhoScript = (lado: 'aplicar' | 'recolher') =>
  `${PASTA_ARTEFATOS}/${NOME_ETAPA_PAPEIS}.${lado}.sql`;
/** Pasta dos scripts de privilégio (a mesma para todo cliente; o código de hospital antigo é ignorado). */
export const caminhoScripts = () => PASTA_ARTEFATOS;

/** Arquivos do núcleo que rodam na transação de toda operação (o uso deles vai ao comum de todo papel). */
export const ARQUIVOS_DO_EXECUTOR = [
  'packages/nucleo/src/executor.ts',
  'packages/nucleo/src/gravacao.ts',
  'packages/nucleo/src/idempotencia.ts',
  'packages/nucleo/src/sequencia.ts',
  'packages/nucleo/src/trilha.ts',
] as const;

/** Tabelas só de inclusão (nenhum papel altera nem apaga: o plano que pedir isso é recusado). */
export const SO_INCLUSAO: readonly string[] = [
  'trilha_auditoria',
  'trilha_auditoria_fecho',
  'trilha_encadeamento_inicio',
];

/**
 * Pastas do DDL cujas tabelas guardam registro clínico (prontuário, centro cirúrgico, diagnóstico): DELETE nelas
 * recusa o plano, salvo a exceção listada com o motivo (a imutabilidade clínica do M59-F3, no banco próprio).
 */
export const PASTAS_DDL_CLINICAS: readonly string[] = ['06_PEP', '08_CC', '10_SADT'];
export const EXCECOES_DELETE_CLINICO: readonly { readonly tabela: string; readonly motivo: string }[] = [];

/**
 * Catálogo de tabelas de módulo genérico cujo catálogo mora fora da pasta do módulo (arquivo com `tabela: 'x'`).
 * O nome dinâmico do módulo vale para essas tabelas. Caminhos relativos à raiz.
 */
export const CATALOGOS_EXTERNOS: Readonly<Record<string, readonly string[]>> = {};

export const ACOES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type Acao = (typeof ACOES)[number];
export type UsoObjetos = Record<string, Acao[]>;

export interface ModeloBanco {
  readonly tabelas: ReadonlySet<string>;
  /** Tabelas com exclusão lógica (coluna excluido_em). */
  readonly exclusaoLogica: ReadonlySet<string>;
  /** Tabelas de registro clínico (DDL das pastas clínicas). */
  readonly clinicas?: ReadonlySet<string>;
}

const FORA_DA_VARREDURA = /(\.spec\.ts|\.spec-util\.ts|\.d\.ts)$/;
const IDENT_TABELA = /^[a-z][a-z0-9_]{0,63}$/;
const IDENT_PAPEL = /^sgh_mod_[a-z0-9_]{1,55}$/;

function arquivos(pasta: string, ext: RegExp): string[] {
  if (!existsSync(pasta)) return [];
  const saida: string[] = [];
  for (const nome of readdirSync(pasta).sort()) {
    const p = join(pasta, nome);
    if (statSync(p).isDirectory()) {
      if (nome !== 'node_modules') saida.push(...arquivos(p, ext));
    } else if (ext.test(nome) && !FORA_DA_VARREDURA.test(nome)) saida.push(p);
  }
  return saida;
}

/** As tabelas do DDL, com a marca de exclusão lógica e de registro clínico. */
export function lerModelo(raiz = RAIZ): ModeloBanco {
  const tabelas = new Set<string>();
  const exclusaoLogica = new Set<string>();
  const clinicas = new Set<string>();
  const ddl = resolve(raiz, PASTA_DDL);
  for (const f of arquivos(ddl, /\.sql$/)) {
    const pasta = relative(ddl, f).split(/[\\/]/)[0] ?? '';
    const partes = readFileSync(f, 'utf8')
      .split(/\bCREATE TABLE\s+(?:IF NOT EXISTS\s+)?/i)
      .slice(1);
    for (const p of partes) {
      const m = /^`?([a-z][a-z0-9_]*)`?\s*\(/.exec(p);
      if (!m?.[1]) continue;
      tabelas.add(m[1]);
      if (PASTAS_DDL_CLINICAS.includes(pasta)) clinicas.add(m[1]);
      const corpo = p.slice(0, Math.max(0, p.search(/\n\)/)));
      if (/^\s*excluido_em\s/m.test(corpo)) exclusaoLogica.add(m[1]);
    }
  }
  return { tabelas, exclusaoLogica, clinicas };
}

/** Remove comentários preservando o comprimento das linhas (o número da linha do uso dinâmico continua certo). */
const semComentarios = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (c) => ' '.repeat(c.length));

/** Constante resolvida: um texto (nome de tabela ou trecho de SQL) ou uma lista de nomes. */
export type ValorConstante = string | readonly string[];
export type Constantes = ReadonlyMap<string, ValorConstante>;

// `...new Set([` (lista sem repetição montada de outras) é só o invólucro: consumido sem captura, os elementos de
// dentro seguem pelas outras alternativas (sem isso, `new` virava um espalhamento não resolvido e a lista inteira caía).
const ELEMENTO =
  /\.\.\.\s*new\s+Set\(\[|\.\.\.\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\s*\))?)|(['"`])([^'"`\n]*)\2|([A-Za-z_$][\w$]*)/g;

// `...LISTA.filter((t) => <condição>)`, com um nível de parênteses dentro da condição (`!B.includes(t as never)`).
const FILTRO =
  /\.\.\.\s*([A-Za-z_$][\w$]*)\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*((?:[^()]|\([^()]*\))*)\)/g;

/**
 * A lista filtrada, quando a condição é uma conjunção que o gerador lê com exatidão: `t !== 'x'` (tira o nome) e
 * `!OUTRA.includes(t)` (tira os nomes de outra lista resolvida). Outra forma devolve undefined (não resolvida).
 */
function filtrarLista(
  origem: ValorConstante | undefined,
  param: string,
  cond: string,
  resolver: (nome: string) => ValorConstante | undefined,
): readonly string[] | undefined {
  if (!Array.isArray(origem)) return undefined;
  const fora = new Set<string>();
  for (const termo of cond
    .trim()
    .replace(/,$/, '')
    .split('&&')
    .map((x) => x.trim())) {
    const dif = /^([A-Za-z_$][\w$]*)\s*!==?\s*(['"])([^'"]*)\2$/.exec(termo);
    if (dif && dif[1] === param) {
      fora.add(dif[3]!);
      continue;
    }
    const inc = /^!\s*([A-Za-z_$][\w$]*)\.includes\(\s*([A-Za-z_$][\w$]*)(?:\s+as\s+[\w$]+)?\s*\)$/.exec(
      termo,
    );
    if (inc && inc[2] === param) {
      const outra = resolver(inc[1]!);
      if (!Array.isArray(outra)) return undefined;
      for (const x of outra as string[]) fora.add(x);
      continue;
    }
    return undefined;
  }
  return (origem as string[]).filter((x) => !fora.has(x));
}

/** O trecho `{ ... }` que começa em `i` (chaves balanceadas; texto entre aspas não conta). */
function objetoBalanceado(t: string, i: number): string {
  let prof = 0;
  let aspas: string | null = null;
  for (let j = i; j < t.length; j++) {
    const c = t[j]!;
    if (aspas) {
      if (c === '\\') j++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === "'" || c === '"') aspas = c;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) return t.slice(i, j + 1);
  }
  return t.slice(i);
}

const FUNCAO_DE_LISTA =
  /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*(?::[^{]+)?\{\s*return\s+(?:\[\s*\.\.\.\s*new\s+Set\(\s*)?([A-Z][A-Z0-9_]*)(?:\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\3\.([A-Za-z_$][\w$]*)\s*===\s*(['"])([^'"\n]*)\5\s*\))?\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\7\.([A-Za-z_$][\w$]*)\s*\)\s*(?:\)\s*\])?\s*;?\s*\}/gm;

/** As constantes de nível de arquivo (string, template sem expressão não resolvida e lista de nomes). */
export function lerConstantes(
  textos: readonly string[],
  base: Constantes = new Map(),
): Map<string, ValorConstante> {
  const brutos = new Map<string, { tipo: 'texto' | 'lista'; corpo: string }>();
  const objetos = new Map<string, Record<string, string>[]>();
  const funcoes = new Map<
    string,
    { lista: string; campoF: string | undefined; valorF: string | undefined; campoM: string }
  >();
  for (const bruto of textos) {
    const t = semComentarios(bruto);
    for (const m of t.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(['"])([^'"\n]*)\2/g))
      brutos.set(m[1]!, { tipo: 'texto', corpo: m[3]! });
    for (const m of t.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*`([^`]*)`/g))
      brutos.set(m[1]!, { tipo: 'texto', corpo: m[2]! });
    for (const m of t.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*\[([^\]]*)\]/g))
      brutos.set(m[1]!, { tipo: 'lista', corpo: m[2]! });
    // Objeto de nomes (`const TABELAS = { ciclos: 'x', ... }`): cada propriedade vira `TABELAS.ciclos`.
    for (const m of t.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=;\n]+)?=\s*\{([^{}]*)\}/g))
      for (const p of m[2]!.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(['"])([a-z][a-z0-9_]*)\2/g))
        brutos.set(`${m[1]}.${p[1]}`, { tipo: 'texto', corpo: p[3]! });
    // Objeto de listas (`const TABELAS_X = { ciclos: ['a', 'b'], backup: [] }`): cada propriedade vira `TABELAS_X.ciclos`.
    for (const m of t.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=;\n]+)?=\s*\{([^{}]*)\}/g))
      for (const p of m[2]!.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*\[([^\]]*)\]/g))
        brutos.set(`${m[1]}.${p[1]}`, { tipo: 'lista', corpo: p[2]! });
    // Operação de nível de arquivo (`const op = definirOperacao({ ..., tabelas: [...] })`): vira `op.tabelas`, para quem
    // declara `tabelas: [...op.tabelas]` (no mesmo arquivo ou importando a operação de outro módulo).
    for (const m of t.matchAll(
      /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*definirOperacao\s*(?:<[^(]*?>)?\(\s*\{/gm,
    )) {
      const obj = objetoBalanceado(t, m.index! + m[0].length - 1);
      const tb = /(?:^|[\s,{])tabelas\s*:\s*(\[[^\]]*\]|[A-Za-z_$][\w$.]*(?=\s*[,}\n]))/.exec(obj.slice(1));
      if (tb)
        brutos.set(`${m[1]}.tabelas`, {
          tipo: 'lista',
          corpo: tb[1]!.startsWith('[') ? tb[1]!.slice(1, -1) : `...${tb[1]}`,
        });
    }
    // Lista de objetos de nível de arquivo (`const R = [{ tabela: 'x', destino: 'y' }, ...]`), só para a função abaixo.
    for (const m of t.matchAll(
      /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=;\n]+)?=\s*\[(\s*\{[^\]]*)\]/gm,
    )) {
      const itens: Record<string, string>[] = [];
      for (const o of m[2]!.matchAll(/\{([^{}]*)\}/g)) {
        const r: Record<string, string> = {};
        for (const p of o[1]!.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(['"])([^'"\n]*)\2/g)) r[p[1]!] = p[3]!;
        itens.push(r);
      }
      objetos.set(m[1]!, itens);
    }
    // Função sem parâmetro que devolve um campo de uma lista de objetos, com filtro de igualdade exata opcional:
    // `function f(): string[] { return [...new Set(R.filter((r) => r.k === 'v').map((r) => r.tabela))]; }`. Vira `f()`.
    for (const m of t.matchAll(FUNCAO_DE_LISTA)) {
      const [, nome, lista, , campoF, , valorF, , campoM] = m;
      funcoes.set(`${nome}()`, { lista: lista!, campoF, valorF, campoM: campoM! });
    }
  }
  const saida = new Map<string, ValorConstante>(base);
  const resolvendo = new Set<string>();
  const resolver = (nome: string): ValorConstante | undefined => {
    if (saida.has(nome) && !brutos.has(nome)) return saida.get(nome);
    const b = brutos.get(nome);
    if (!b) return saida.get(nome);
    if (resolvendo.has(nome)) return undefined;
    resolvendo.add(nome);
    try {
      if (b.tipo === 'texto') {
        let falhou = false;
        const v = b.corpo.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_x, n: string) => {
          const r = resolver(n);
          if (typeof r === 'string') return r;
          falhou = true;
          return _x;
        });
        return falhou ? undefined : v;
      }
      const lista: string[] = [];
      // `...LISTA.filter((t) => ...)`: resolvido só quando o filtro é a diferença exata que o gerador lê.
      const filtradas = new Map<string, readonly string[]>();
      let falhouFiltro = false;
      const corpo = b.corpo.replace(FILTRO, (_x, origem: string, param: string, cond: string) => {
        const r = filtrarLista(resolver(origem), param, cond, resolver);
        if (r === undefined) falhouFiltro = true;
        const marca = `__filtro_${filtradas.size}`;
        filtradas.set(marca, r ?? []);
        return `...${marca}`;
      });
      if (falhouFiltro) return undefined;
      for (const e of corpo.matchAll(ELEMENTO)) {
        if (e[1] && filtradas.has(e[1])) lista.push(...filtradas.get(e[1])!);
        else if (e[1]) {
          const r = resolver(e[1]);
          if (!Array.isArray(r)) return undefined;
          lista.push(...(r as string[]));
        } else if (e[3] !== undefined) lista.push(e[3]);
        else if (e[4] && e[4] !== 'as' && e[4] !== 'const') {
          const r = resolver(e[4]);
          if (typeof r !== 'string') return undefined;
          lista.push(r);
        }
      }
      return lista;
    } finally {
      resolvendo.delete(nome);
    }
  };
  for (const [n, f] of funcoes) {
    const itens = objetos.get(f.lista);
    if (!itens) continue;
    const vals = itens
      .filter((o) => f.campoF === undefined || o[f.campoF] === f.valorF)
      .map((o) => o[f.campoM]);
    // Item sem o campo (ou com valor que não é texto literal): a função não se resolve.
    if (vals.some((v) => v === undefined)) continue;
    saida.set(n, [...new Set(vals as string[])]);
  }
  for (const n of brutos.keys()) {
    const v = resolver(n);
    if (v === undefined) saida.delete(n);
    else saida.set(n, v);
  }
  return saida;
}

/** Uso de tabela por nome que só se conhece em tempo de execução. */
export interface UsoDinamico {
  readonly onde: string;
  readonly acao: Acao;
  readonly expressao: string;
  /** Veio de tx.incluir/alterar/excluir (o excluir em exclusão lógica é UPDATE). */
  readonly porExecutor?: boolean;
  /** A raiz da expressão é nome importado ou declarado no nível do arquivo (constante que não se resolveu). */
  readonly ligado?: boolean;
}

export interface UsoDoTexto {
  readonly uso: UsoObjetos;
  readonly dinamicos: readonly UsoDinamico[];
  /** Nomes resolvidos em declaração ao Executor que não são tabela do DDL. */
  readonly foraDoModelo: readonly string[];
}

function anotar(u: UsoObjetos, tabela: string, acao: Acao, modelo: ModeloBanco): boolean {
  if (!modelo.tabelas.has(tabela)) return false;
  const a = (u[tabela] ??= []);
  if (!a.includes(acao)) a.push(acao);
  // Toda escrita relê a linha (trava otimista e conferência): SELECT junto.
  if (acao !== 'SELECT' && !a.includes('SELECT')) a.push('SELECT');
  return true;
}

const ordenarAcoes = (u: UsoObjetos) => {
  for (const k of Object.keys(u)) u[k] = ACOES.filter((a) => u[k]!.includes(a));
  return u;
};

/**
 * O uso de tabelas num texto de código: o SQL (com as constantes já resolvidas) e as tabelas declaradas às operações
 * do Executor. O que não se resolve fica em `dinamicos`, com o arquivo e a linha.
 */
export function analisarTexto(
  texto: string,
  modelo: ModeloBanco,
  constantes: Constantes = new Map(),
  arquivo = '<texto>',
): UsoDoTexto {
  const original = semComentarios(texto);
  const linhaDe = (i: number) => `${arquivo}:${original.slice(0, i).split('\n').length}`;
  // Substitui ${CONST} e ${conferirNome(CONST)} pelo texto resolvido, mantendo o índice para a linha do uso.
  const marcas: { i: number; delta: number }[] = [];
  let delta = 0;
  const t = original.replace(
    /\$\{\s*(?:conferirNome\(\s*)?([A-Za-z_$][\w$]*)\s*\)?\s*\}/g,
    (x, n: string, i: number) => {
      const v = constantes.get(n);
      if (typeof v !== 'string') return x;
      marcas.push({ i: i + delta, delta: v.length - x.length });
      delta += v.length - x.length;
      return v;
    },
  );
  const naOrigem = (i: number) => {
    let d = 0;
    for (const m of marcas) if (m.i < i) d += m.delta;
    return i - d;
  };
  const u: UsoObjetos = {};
  const dinamicos: UsoDinamico[] = [];
  const foraDoModelo = new Set<string>();
  const valor = (expr: string): ValorConstante | undefined => {
    const q = /^(['"`])([^'"`]*)\1$/.exec(expr.trim());
    if (q) return q[2]!;
    return constantes.get(expr.trim());
  };
  const declarar = (nome: string, acao: Acao) => {
    if (!anotar(u, nome, acao, modelo) && IDENT_TABELA.test(nome)) foraDoModelo.add(nome);
  };
  const casar = (re: RegExp, acao: (nome: string) => Acao) => {
    for (const m of t.matchAll(re)) if (m[1]) anotar(u, m[1], acao(m[1]), modelo);
  };
  casar(/\b(?:FROM|JOIN)\s+`?([a-z][a-z0-9_]*)`?/gi, () => 'SELECT');
  casar(/\bINSERT\s+(?:IGNORE\s+)?INTO\s+`?([a-z][a-z0-9_]*)`?/gi, () => 'INSERT');
  casar(/\bUPDATE\s+`?([a-z][a-z0-9_]*)`?\s+(?:[a-z]\w*\s+)?SET\b/gi, () => 'UPDATE');
  casar(/\bDELETE\s+FROM\s+`?([a-z][a-z0-9_]*)`?/gi, () => 'DELETE');
  const DIN: [RegExp, Acao][] = [
    [/\b(?:FROM|JOIN)\s+\$\{([^}]*)\}/g, 'SELECT'],
    [/\bINSERT\s+(?:IGNORE\s+)?INTO\s+\$\{([^}]*)\}/g, 'INSERT'],
    [/\bUPDATE\s+\$\{([^}]*)\}/g, 'UPDATE'],
    [/\bDELETE\s+FROM\s+\$\{([^}]*)\}/g, 'DELETE'],
  ];
  for (const [re, acao] of DIN)
    for (const m of t.matchAll(re))
      if (!(acao === 'SELECT' && /^\s*DELETE\s+$/i.test(t.slice(Math.max(0, m.index! - 8), m.index))))
        dinamicos.push({ onde: linhaDe(naOrigem(m.index!)), acao, expressao: m[1]!.trim() });
  // Gravação pelo Executor: tx.incluir/alterar/excluir(<tabela>, ...).
  for (const m of t.matchAll(/(\b[A-Za-z_$][\w$]*)?\.?\b(incluir|alterar|excluir)\(\s*([^,()]+?)\s*,/g)) {
    const [, recebedor, metodo, expr] = m;
    const acaoDe = (n: string): Acao =>
      metodo === 'incluir'
        ? 'INSERT'
        : metodo === 'alterar'
          ? 'UPDATE'
          : modelo.exclusaoLogica.has(n)
            ? 'UPDATE'
            : 'DELETE';
    const v = valor(expr!);
    if (typeof v === 'string') {
      if (/^['"`]/.test(expr!.trim())) anotar(u, v, acaoDe(v), modelo);
      else declarar(v, acaoDe(v));
    } else if ([...expr!.matchAll(/'([a-z][a-z0-9_]*)'/g)].some((x) => modelo.tabelas.has(x[1]!))) {
      for (const x of expr!.matchAll(/'([a-z][a-z0-9_]*)'/g))
        if (modelo.tabelas.has(x[1]!)) anotar(u, x[1]!, acaoDe(x[1]!), modelo);
    } else if (recebedor === 'tx')
      dinamicos.push({
        onde: linhaDe(naOrigem(m.index!)),
        acao: metodo === 'incluir' ? 'INSERT' : metodo === 'alterar' ? 'UPDATE' : 'DELETE',
        expressao: expr!,
        porExecutor: true,
      });
  }
  // Tabelas declaradas à operação: INSERT e UPDATE em cada uma.
  for (const m of t.matchAll(/\btabelas\s*:\s*(\[[^\]]*\]|[A-Za-z_$][\w$.]*(?=\s*[,}\n]))/g)) {
    const corpo = m[1]!;
    // Tipo (`tabelas: readonly string[]`, `tabelas: number`) ou lista de objetos (porta de memória): não é declaração.
    if (/^(readonly|string|number|boolean|Number|String|new|await|unknown|Array|Set)$/.test(corpo)) continue;
    if (corpo.startsWith('[') && /[{:]|^\[\s*(string|number)\b/.test(corpo)) continue;
    const nomes: string[] = [];
    const naoResolvidos: string[] = [];
    if (corpo.startsWith('[')) {
      for (const e of corpo
        .slice(1, -1)
        .matchAll(/\.\.\.\s*new\s+Set\(\[|\.\.\.\s*([^,\]\s]+)|(['"`])([^'"`\n]*)\2|([A-Za-z_$][\w$.]*)/g)) {
        if (e[1]) {
          const r = constantes.get(e[1].trim());
          if (Array.isArray(r)) nomes.push(...(r as string[]));
          else naoResolvidos.push(`...${e[1].trim()}`);
        } else if (e[3] !== undefined) nomes.push(e[3]);
        else if (e[4] && e[4] !== 'as' && e[4] !== 'const') {
          const r = constantes.get(e[4]);
          if (typeof r === 'string') nomes.push(r);
          else naoResolvidos.push(e[4]);
        }
      }
    } else {
      const r = constantes.get(corpo);
      if (Array.isArray(r)) nomes.push(...(r as string[]));
      else if (typeof r === 'string') nomes.push(r);
      else naoResolvidos.push(corpo);
    }
    // Literais dentro de expressão não resolvida (ex.: `x ? 'a' : 'b'`) contam como as tabelas possíveis.
    for (let i = naoResolvidos.length - 1; i >= 0; i--) {
      const lits = [...naoResolvidos[i]!.matchAll(/'([a-z][a-z0-9_]*)'/g)]
        .map((x) => x[1]!)
        .filter((x) => modelo.tabelas.has(x));
      if (lits.length > 0) {
        nomes.push(...lits);
        naoResolvidos.splice(i, 1);
      }
    }
    for (const n of nomes) {
      declarar(n, 'INSERT');
      // A trilha declarada à operação é só de inclusão: a declaração não lhe dá UPDATE.
      if (!SO_INCLUSAO.includes(n)) declarar(n, 'UPDATE');
    }
    for (const x of naoResolvidos)
      for (const acao of ['INSERT', 'UPDATE'] as const)
        dinamicos.push({ onde: linhaDe(naOrigem(m.index!)), acao, expressao: x });
  }
  // Expressão cuja raiz é nome ligado a import ou a declaração de nível de arquivo: é constante do código, não dado de
  // tempo de execução. Se chegou aqui, não se resolveu, e o gerador recusa (nunca o catálogo do módulo).
  const ligados = nomesLigados(original);
  const marcados = dinamicos.map((d) => {
    const raiz = raizDaExpressao(d.expressao);
    return raiz !== null && ligados.has(raiz) ? { ...d, ligado: true } : d;
  });
  return { uso: ordenarAcoes(u), dinamicos: marcados, foraDoModelo: [...foraDoModelo].sort() };
}

/** Os nomes ligados no nível do arquivo: importados (menos `import type`) e declarados (const, let, var, function, class). */
export function nomesLigados(texto: string): Set<string> {
  const t = semComentarios(texto);
  const s = new Set<string>();
  for (const m of t.matchAll(/^\s*import\s+(?!type\b)([^'";]*?)\s+from\s+['"][^'"]+['"]/gm)) {
    const clausula = m[1]!;
    const chaves = /\{([^}]*)\}/.exec(clausula);
    if (chaves)
      for (const item of chaves[1]!.split(',')) {
        const x = /^\s*(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
        if (x && !x[1]) s.add(x[3] ?? x[2]!);
      }
    const fora = clausula.replace(/\{[^}]*\}/, '');
    const ns = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(fora);
    if (ns) s.add(ns[1]!);
    const padrao = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(fora);
    if (padrao) s.add(padrao[1]!);
  }
  for (const m of t.matchAll(
    /^(?:export\s+)?(?:declare\s+)?(?:const|let|var|(?:async\s+)?function\s*\*?|(?:abstract\s+)?class)\s+([A-Za-z_$][\w$]*)/gm,
  ))
    s.add(m[1]!);
  return s;
}

/** O primeiro identificador de uma expressão (`...x.y` → x, `conferirNome(X)` → X, `(a?.b ?? [])` → a), ou null. */
export function raizDaExpressao(expressao: string): string | null {
  let e = expressao.trim();
  for (;;) {
    const antes = e;
    e = e
      .replace(/^\.\.\.\s*/, '')
      .replace(/^\(\s*/, '')
      .replace(/^(?:conferirNome|String)\s*\(\s*/, '');
    if (e === antes) break;
  }
  const m = /^[A-Za-z_$][\w$]*/.exec(e);
  return m && m[0] !== 'this' && m[0] !== 'new' ? m[0] : null;
}

/** Compatibilidade: só o uso resolvido de um texto (sem constantes externas). */
export function usosNoTexto(texto: string, modelo: ModeloBanco): UsoObjetos {
  const c = lerConstantes([texto]);
  return analisarTexto(texto, modelo, c).uso;
}

/** As tabelas do catálogo de um módulo genérico: propriedades `tabela: 'x'` do modelo. */
export function catalogoDoTexto(texto: string, modelo: ModeloBanco): string[] {
  const s = new Set<string>();
  for (const m of semComentarios(texto).matchAll(/\btabela\s*:\s*(['"`])([a-z][a-z0-9_]*)\1/g))
    if (modelo.tabelas.has(m[2]!)) s.add(m[2]!);
  return [...s].sort();
}

export interface UsoModulo {
  readonly uso: UsoObjetos;
  readonly dinamicos: readonly UsoDinamico[];
  readonly catalogo: readonly string[];
  readonly foraDoModelo?: readonly string[];
}

export interface EntradaAlcance {
  readonly modulos: Readonly<Record<string, UsoObjetos | UsoModulo>>;
  readonly comum: UsoObjetos;
  readonly modelo: ModeloBanco;
}

export interface AlcanceModulo {
  readonly modulo: string;
  readonly papel: string;
  readonly objetos: Readonly<Record<string, readonly Acao[]>>;
}

export class PlanoPrivilegioRecusado extends Error {
  readonly motivos: readonly string[];
  constructor(motivos: readonly string[]) {
    super(
      `Plano de privilégios recusado (${motivos.length}): ${motivos.slice(0, 12).join('; ')}${motivos.length > 12 ? '; …' : ''}`,
    );
    this.name = 'PlanoPrivilegioRecusado';
    this.motivos = motivos;
  }
}

export const papelDoModulo = (m: string) => `sgh_mod_${m.replace(/[^a-z0-9]+/g, '_')}`;

/**
 * Expressão que é nome de constante (`TABELAS`, `...TABELAS_X`, `DE_CONTA`, `TABELAS.ciclos`, `conferirNome(TABELA)`):
 * maiúsculas por convenção do repositório. Nome em minúsculas (`tabela`, `d.tabela`) é dado de tempo de execução.
 */
export const ehNomeDeConstante = (expressao: string): boolean =>
  /^(?:\.\.\.\s*)?(?:conferirNome\(\s*)?[A-Z][A-Z0-9_]*(?:\.[A-Za-z_$][\w$]*)?\s*\)?$/.test(expressao.trim());

const ehUsoModulo = (x: UsoObjetos | UsoModulo): x is UsoModulo =>
  'uso' in x && 'dinamicos' in x && !Array.isArray((x as Record<string, unknown>)['uso']);

/**
 * O alcance de cada módulo (comum + uso do módulo + nome dinâmico sobre o catálogo do módulo), com as regras do plano
 * aplicadas. Puro. Recusa (PlanoPrivilegioRecusado, com todos os motivos) o que o domínio recusa; devolve como
 * descarte o DELETE em exclusão lógica e como aviso o módulo sem nenhum uso.
 */
export function calcularAlcances(e: EntradaAlcance): {
  alcances: AlcanceModulo[];
  descartes: string[];
  avisos: string[];
} {
  const motivos: string[] = [];
  const descartes: string[] = [];
  const avisos: string[] = [];
  const alcances: AlcanceModulo[] = [];
  const papeis = new Map<string, string>();
  const clinicas = e.modelo.clinicas ?? new Set<string>();
  const excecoes = new Set(EXCECOES_DELETE_CLINICO.map((x) => x.tabela));
  for (const modulo of Object.keys(e.modulos).sort()) {
    const bruto = e.modulos[modulo] ?? {};
    const m: UsoModulo = ehUsoModulo(bruto) ? bruto : { uso: bruto, dinamicos: [], catalogo: [] };
    const papel = papelDoModulo(modulo);
    if (!IDENT_PAPEL.test(papel)) motivos.push(`módulo com nome inválido para papel: ${modulo}`);
    const outro = papeis.get(papel);
    if (outro !== undefined) motivos.push(`módulo repetido: ${outro} e ${modulo} dão o mesmo papel ${papel}`);
    papeis.set(papel, modulo);
    const uso: UsoObjetos = {};
    for (const [t, a] of Object.entries(m.uso)) uso[t] = [...a];
    // Constante de tabelas (nome em maiúsculas) que não se resolveu: ERRO, nunca o catálogo do módulo. O catálogo vale
    // só para o nome que de fato só se conhece em tempo de execução; a constante que não se resolve (importada de
    // arquivo que o gerador não seguiu, montada de forma que ele não lê) daria ao papel as tabelas erradas.
    const ehConstante = (d: UsoDinamico) => d.ligado === true || ehNomeDeConstante(d.expressao);
    const constantesNaoResolvidas = m.dinamicos.filter(ehConstante);
    for (const d of constantesNaoResolvidas)
      motivos.push(
        `${modulo}: constante de tabelas não resolvida (${d.acao} em ${d.expressao} em ${d.onde}); siga o import até a definição ou declare a lista literal`,
      );
    const dinamicosDeFato = m.dinamicos.filter((d) => !ehConstante(d));
    if (dinamicosDeFato.length > 0) {
      if (m.catalogo.length === 0)
        for (const d of dinamicosDeFato)
          motivos.push(
            `${modulo}: nome de tabela dinâmico sem catálogo (${d.acao} em \${${d.expressao}} em ${d.onde})`,
          );
      else
        for (const d of dinamicosDeFato)
          for (const t of m.catalogo) {
            if (SO_INCLUSAO.includes(t) && d.acao !== 'SELECT' && d.acao !== 'INSERT') {
              descartes.push(
                `${modulo}: ${d.acao} dinâmico em ${t} (tabela só de inclusão; o catálogo do módulo só a lê)`,
              );
              continue;
            }
            // tx.excluir em tabela de exclusão lógica é UPDATE (o Executor marca excluido_em).
            const acao: Acao =
              d.acao === 'DELETE' && d.porExecutor && e.modelo.exclusaoLogica.has(t) ? 'UPDATE' : d.acao;
            const a = (uso[t] ??= []);
            if (!a.includes(acao)) a.push(acao);
            if (!a.includes('SELECT')) a.push('SELECT');
          }
    }
    for (const t of m.foraDoModelo ?? [])
      avisos.push(`${modulo}: ${t} declarada ao Executor e ausente do DDL`);
    if (Object.keys(uso).length === 0) {
      avisos.push(
        `${modulo}: nenhum uso de tabela encontrado (sem papel; confira se o módulo grava pelo núcleo)`,
      );
      continue;
    }
    const objetos: Record<string, Acao[]> = {};
    for (const fonte of [e.comum, uso])
      for (const [t, acoes] of Object.entries(fonte))
        for (const a of acoes) {
          if (!IDENT_TABELA.test(t)) {
            motivos.push(`objeto inválido em ${modulo}: ${t}`);
            continue;
          }
          if (SO_INCLUSAO.includes(t) && (a === 'UPDATE' || a === 'DELETE')) {
            motivos.push(`${t} é só de inclusão: ${a} recusado em ${modulo}`);
            continue;
          }
          if (a === 'DELETE' && e.modelo.exclusaoLogica.has(t)) {
            descartes.push(`${modulo}: DELETE em ${t} (exclusão lógica)`);
            continue;
          }
          if (a === 'DELETE' && clinicas.has(t) && !excecoes.has(t)) {
            motivos.push(`${modulo}: DELETE em ${t} (registro clínico; imutabilidade)`);
            continue;
          }
          const x = (objetos[t] ??= []);
          if (!x.includes(a)) x.push(a);
        }
    const ordenado: Record<string, Acao[]> = {};
    for (const t of Object.keys(objetos).sort()) ordenado[t] = ACOES.filter((a) => objetos[t]!.includes(a));
    alcances.push({ modulo, papel, objetos: ordenado });
  }
  if (motivos.length > 0) throw new PlanoPrivilegioRecusado([...new Set(motivos)]);
  return { alcances, descartes: [...new Set(descartes)].sort(), avisos: [...new Set(avisos)].sort() };
}

export const versaoDoAlcance = (alcances: readonly AlcanceModulo[]) =>
  createHash('sha256').update(JSON.stringify(alcances)).digest('hex').slice(0, 12);

/** Constantes exportadas pelos pacotes (ex.: listas de tabelas do contrato), usadas quando o módulo as importa. */
function constantesDosPacotes(raiz: string): Map<string, ValorConstante> {
  const textos = arquivos(resolve(raiz, 'packages'), /\.ts$/)
    .filter((f) => /[\\/]src[\\/]/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .filter((t) => /\bexport (?:const|function)\b/.test(t));
  const todas = lerConstantes(textos);
  // Só as listas e os nomes de tabela simples (um trecho de SQL de outro pacote não entra).
  return new Map([...todas].filter(([, v]) => Array.isArray(v) || IDENT_TABELA.test(v as string)));
}

export const PASTA_PERSISTENCIA = 'packages/persistencia/src';

/** Porta compartilhada da persistência: a lista exportada das tabelas que ela grava e o uso do seu SQL. */
export interface PortaCompartilhada {
  readonly arquivo: string;
  readonly gravadas: readonly string[];
  readonly uso: UsoObjetos;
}

/**
 * As portas compartilhadas da persistência: arquivo com SQL que exporta uma lista `TABELAS_*` (as tabelas que a porta
 * grava, para a operação que a roda declarar). A operação que declara a lista inteira roda a porta na transação; o
 * papel do módulo precisa também do que o SQL dela lê (a produção do repasse lê regra, participante, glosa, parâmetro).
 */
function portasCompartilhadas(raiz: string, modelo: ModeloBanco, pacotes: Constantes): PortaCompartilhada[] {
  const pasta = resolve(raiz, PASTA_PERSISTENCIA);
  if (!existsSync(pasta)) return [];
  const saida: PortaCompartilhada[] = [];
  for (const f of arquivos(pasta, /\.ts$/)) {
    const texto = readFileSync(f, 'utf8');
    const nomes = [...semComentarios(texto).matchAll(/^export\s+const\s+(TABELAS_[A-Z0-9_]+)\b/gm)].map(
      (m) => m[1]!,
    );
    if (nomes.length === 0) continue;
    const c = lerConstantes([texto], pacotes);
    const uso = analisarTexto(texto, modelo, c, relative(raiz, f)).uso;
    if (Object.keys(uso).length === 0) continue;
    for (const n of nomes) {
      const v = c.get(n);
      if (Array.isArray(v) && v.length > 0)
        saida.push({ arquivo: relative(raiz, f), gravadas: v as string[], uso });
    }
  }
  return saida;
}

const EXTENSOES_IMPORT = ['', '.ts', '/index.ts'];

/** O arquivo .ts de um import relativo (`./x.js`, `../y/z.js`, `./w`), ou null quando não existe. */
function arquivoDoImport(de: string, especificador: string): string | null {
  const base = resolve(dirname(de), especificador.replace(/\.js$/, '.ts'));
  for (const ext of EXTENSOES_IMPORT) {
    const p = `${base}${ext}`;
    if (existsSync(p) && statSync(p).isFile() && /\.ts$/.test(p)) return p;
  }
  return null;
}

/** Os nomes trazidos por import ou reexportação relativa de um texto: [nome local, nome na origem, arquivo]. */
function importsRelativos(arquivo: string, texto: string): [string, string, string][] {
  const saida: [string, string, string][] = [];
  const t = semComentarios(texto);
  for (const m of t.matchAll(
    /\b(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  )) {
    // `import type` / `export type` só traz tipo: nenhum valor a seguir.
    if (m[1]) continue;
    const alvo = arquivoDoImport(arquivo, m[3]!);
    if (!alvo) continue;
    for (const item of m[2]!.split(',')) {
      const x = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (x && !/^\s*type\s/.test(item)) saida.push([x[2] ?? x[1]!, x[1]!, alvo]);
    }
  }
  return saida;
}

/** Copia o nome importado e os seus membros (`op.tabelas`, `TABELAS_X.ciclos`, `f()`) com o nome local. */
function trazerNome(
  de: ReadonlyMap<string, ValorConstante>,
  origem: string,
  local: string,
  para: Map<string, ValorConstante>,
): void {
  for (const [k, v] of de)
    if (k === origem) para.set(local, v);
    else if (k.startsWith(`${origem}.`) || k === `${origem}()`)
      para.set(`${local}${k.slice(origem.length)}`, v);
}

/**
 * As constantes de um arquivo seguindo os imports relativos até a definição (inclusive em outro módulo: a lista de
 * tabelas da produção do repasse usada pelo faturamento). Memoizado por arquivo. No import circular o nome que depende
 * do ciclo fica sem valor (o plano que o usa é recusado), e o resultado parcial de quem está no ciclo não entra no memo
 * (senão outro arquivo que importasse dele por outro caminho herdaria a falta).
 */
function constantesSeguindoImports(
  arquivo: string,
  pacotes: Constantes,
  memo: Map<string, Map<string, ValorConstante>>,
  pilha: Set<string> = new Set(),
): { mapa: Map<string, ValorConstante>; parcial: boolean } {
  const pronto = memo.get(arquivo);
  if (pronto) return { mapa: pronto, parcial: false };
  if (pilha.has(arquivo)) return { mapa: new Map(), parcial: true };
  pilha.add(arquivo);
  const texto = readFileSync(arquivo, 'utf8');
  const base = new Map<string, ValorConstante>(pacotes);
  let parcial = false;
  for (const [local, origem, alvo] of importsRelativos(arquivo, texto)) {
    const r = constantesSeguindoImports(alvo, pacotes, memo, pilha);
    if (r.parcial) parcial = true;
    trazerNome(r.mapa, origem, local, base);
  }
  pilha.delete(arquivo);
  const saida = lerConstantes([texto], base);
  if (!parcial) memo.set(arquivo, saida);
  return { mapa: saida, parcial };
}

/** Só os nomes importados (resolvidos na origem) de um arquivo. */
function constantesImportadas(
  arquivo: string,
  texto: string,
  pacotes: Constantes,
  memo: Map<string, Map<string, ValorConstante>>,
): Map<string, ValorConstante> {
  const saida = new Map<string, ValorConstante>();
  for (const [local, origem, alvo] of importsRelativos(arquivo, texto))
    trazerNome(constantesSeguindoImports(alvo, pacotes, memo).mapa, origem, local, saida);
  return saida;
}

/** A entrada do cálculo, lida do repositório. */
export function entradaDoRepositorio(raiz = RAIZ): EntradaAlcance {
  const modelo = lerModelo(raiz);
  const executor = ARQUIVOS_DO_EXECUTOR.map((f) => resolve(raiz, f)).filter((f) => existsSync(f));
  const textosExecutor = executor.map((f) => readFileSync(f, 'utf8'));
  const comum = analisarTexto(textosExecutor.join('\n'), modelo, lerConstantes(textosExecutor)).uso;
  const pacotes = constantesDosPacotes(raiz);
  const portas = portasCompartilhadas(raiz, modelo, pacotes);
  const modulos: Record<string, UsoModulo> = {};
  const memo = new Map<string, Map<string, ValorConstante>>();
  const pasta = resolve(raiz, PASTA_MODULOS);
  for (const m of readdirSync(pasta).sort()) {
    const p = join(pasta, m);
    if (!statSync(p).isDirectory()) continue;
    const fs = arquivos(p, /\.ts$/);
    const textos = fs.map((f) => readFileSync(f, 'utf8'));
    // O import relativo é seguido até a definição (de outro arquivo do módulo ou de outro módulo).
    const importadas = fs.map((f, i) => constantesImportadas(f, textos[i]!, pacotes, memo));
    const constantes = lerConstantes(textos, new Map([...pacotes, ...importadas.flatMap((x) => [...x])]));
    const uso: UsoObjetos = {};
    const dinamicos: UsoDinamico[] = [];
    const fora = new Set<string>();
    fs.forEach((f, i) => {
      // A constante do próprio arquivo vale sobre a de outro arquivo do módulo com o mesmo nome.
      const r = analisarTexto(
        textos[i]!,
        modelo,
        lerConstantes([textos[i]!], new Map([...constantes, ...importadas[i]!])),
        relative(raiz, f),
      );
      for (const [t, a] of Object.entries(r.uso))
        for (const x of a) if (!(uso[t] ??= []).includes(x)) uso[t]!.push(x);
      dinamicos.push(...r.dinamicos);
      for (const x of r.foraDoModelo) fora.add(x);
    });
    // Operação que declara todas as tabelas que uma porta compartilhada grava roda essa porta: o uso do SQL dela entra.
    for (const porta of portas)
      if (porta.gravadas.every((t) => uso[t]?.includes('INSERT')))
        for (const [t, a] of Object.entries(porta.uso))
          for (const x of a) if (!(uso[t] ??= []).includes(x)) uso[t]!.push(x);
    const catalogo = new Set(catalogoDoTexto(textos.join('\n'), modelo));
    for (const ext of CATALOGOS_EXTERNOS[m] ?? [])
      for (const t of catalogoDoTexto(readFileSync(resolve(raiz, ext), 'utf8'), modelo)) catalogo.add(t);
    modulos[m] = {
      uso: ordenarAcoes(uso),
      dinamicos,
      catalogo: [...catalogo].sort(),
      foraDoModelo: [...fora].sort(),
    };
  }
  return { modulos, comum, modelo };
}

export interface Artefatos {
  readonly alcanceJson: string;
  readonly aplicar: string;
  readonly recolher: string;
  readonly versao: string;
  readonly descartes: readonly string[];
  readonly avisos: readonly string[];
  readonly modulos: number;
  readonly itens: number;
  readonly alcances: readonly AlcanceModulo[];
}

/** Os scripts dos papéis (texto exato: o teste compara byte a byte). Puro. */
export function gerarScriptsPapeis(
  alcances: readonly AlcanceModulo[],
  versao: string,
): { aplicar: string; recolher: string } {
  const cabeca = (lado: string) => [
    `-- ${NOME_ETAPA_PAPEIS}.${lado} (alcance ${versao}). Gerado por pnpm privilegios:gerar; não edite à mão.`,
    '-- Rodar no banco de cada cliente (USE <banco do cliente>), pela TI, com autorização do dono para o passo.',
    '-- Sem efeito sozinho: o papel só reduz privilégio quando a conta da API o usa (conta por módulo com',
    '-- SET DEFAULT ROLE, ou SET ROLE por operação no núcleo). Esse passo está pedido e ainda não existe.',
  ];
  const aplicar = [...cabeca('aplicar')];
  const recolher = [...cabeca('recolher')];
  for (const a of alcances) aplicar.push(`CREATE ROLE IF NOT EXISTS ${a.papel};`);
  for (const a of alcances)
    for (const [t, acoes] of Object.entries(a.objetos)) {
      aplicar.push(`GRANT ${acoes.join(', ')} ON ${t} TO ${a.papel};`);
      recolher.push(`REVOKE ${acoes.join(', ')} ON ${t} FROM ${a.papel};`);
    }
  return { aplicar: `${aplicar.join('\n')}\n`, recolher: `${recolher.join('\n')}\n` };
}

/**
 * Os artefatos versionados. Aceita, por compatibilidade, o código de hospital da chamada antiga (ignorado: o alcance
 * é um só para todos os clientes). Lança PlanoPrivilegioRecusado quando o plano fere uma regra.
 */
export function gerarArtefatos(opcoes: { readonly raiz?: string } | string = {}): Artefatos {
  const raiz = typeof opcoes === 'string' ? RAIZ : (opcoes.raiz ?? RAIZ);
  const { alcances, descartes, avisos } = calcularAlcances(entradaDoRepositorio(raiz));
  const versao = versaoDoAlcance(alcances);
  const scripts = gerarScriptsPapeis(alcances, versao);
  // Um módulo por linha: diff legível.
  const alcanceJson = [
    `{"formato":2,"versao":"${versao}","descartes":${descartes.length},"avisos":${avisos.length},"alcances":[`,
    alcances.map((x) => JSON.stringify(x)).join(',\n'),
    ']}',
    '',
  ].join('\n');
  return {
    alcanceJson,
    aplicar: scripts.aplicar,
    recolher: scripts.recolher,
    versao,
    descartes,
    avisos,
    modulos: alcances.length,
    itens: alcances.reduce((n, a) => n + Object.keys(a.objetos).length, 0),
    alcances,
  };
}

/** O alcance versionado (null se ainda não gerado). */
export function alcanceVersionado(raiz = RAIZ): { versao: string; alcances: AlcanceModulo[] } | null {
  const p = resolve(raiz, caminhoAlcance());
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as { versao: string; alcances: AlcanceModulo[] };
}

const GRANT_PAPEL_MODULO = /^GRANT ([A-Z, ]+) ON ([a-z][a-z0-9_]*) TO (sgh_mod_[a-z_]+);$/;

/** Uma concessão do script versionado dos papéis por módulo. */
export interface ConcessaoPapel {
  readonly acoes: readonly string[];
  readonly tabela: string;
  readonly papel: string;
}

/** As concessões do script aplicar versionado (o mesmo texto que a TI roda no banco de cada cliente). */
export function concessoesDoScript(texto: string): ConcessaoPapel[] {
  const saida: ConcessaoPapel[] = [];
  for (const linha of texto.split('\n')) {
    const m = GRANT_PAPEL_MODULO.exec(linha.trim());
    if (m) saida.push({ acoes: m[1]!.split(',').map((a) => a.trim()), tabela: m[2]!, papel: m[3]! });
  }
  return saida;
}
