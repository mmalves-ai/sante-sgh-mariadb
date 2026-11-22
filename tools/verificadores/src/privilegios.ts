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
import { join, relative, resolve } from 'node:path';

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
export const SO_INCLUSAO: readonly string[] = ['trilha_auditoria'];

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
  /\.\.\.\s*new\s+Set\(\[|\.\.\.\s*([A-Za-z_$][\w$]*)|(['"`])([^'"`\n]*)\2|([A-Za-z_$][\w$]*)/g;

/** As constantes de nível de arquivo (string, template sem expressão não resolvida e lista de nomes). */
export function lerConstantes(
  textos: readonly string[],
  base: Constantes = new Map(),
): Map<string, ValorConstante> {
  const brutos = new Map<string, { tipo: 'texto' | 'lista'; corpo: string }>();
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
      for (const e of b.corpo.matchAll(ELEMENTO)) {
        if (e[1]) {
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
        .matchAll(
          /\.\.\.\s*(?:new Set\(\[\s*\.\.\.\s*)?([^,\]\s]+)|(['"`])([^'"`\n]*)\2|([A-Za-z_$][\w$.]*)/g,
        )) {
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
  return { uso: ordenarAcoes(u), dinamicos, foraDoModelo: [...foraDoModelo].sort() };
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
    if (m.dinamicos.length > 0) {
      if (m.catalogo.length === 0)
        for (const d of m.dinamicos)
          motivos.push(
            `${modulo}: nome de tabela dinâmico sem catálogo (${d.acao} em \${${d.expressao}} em ${d.onde})`,
          );
      else
        for (const d of m.dinamicos)
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
    .filter((t) => /\bexport const\b/.test(t));
  const todas = lerConstantes(textos);
  // Só as listas e os nomes de tabela simples (um trecho de SQL de outro pacote não entra).
  return new Map([...todas].filter(([, v]) => Array.isArray(v) || IDENT_TABELA.test(v as string)));
}

/** A entrada do cálculo, lida do repositório. */
export function entradaDoRepositorio(raiz = RAIZ): EntradaAlcance {
  const modelo = lerModelo(raiz);
  const executor = ARQUIVOS_DO_EXECUTOR.map((f) => resolve(raiz, f)).filter((f) => existsSync(f));
  const textosExecutor = executor.map((f) => readFileSync(f, 'utf8'));
  const comum = analisarTexto(textosExecutor.join('\n'), modelo, lerConstantes(textosExecutor)).uso;
  const pacotes = constantesDosPacotes(raiz);
  const modulos: Record<string, UsoModulo> = {};
  const pasta = resolve(raiz, PASTA_MODULOS);
  for (const m of readdirSync(pasta).sort()) {
    const p = join(pasta, m);
    if (!statSync(p).isDirectory()) continue;
    const fs = arquivos(p, /\.ts$/);
    const textos = fs.map((f) => readFileSync(f, 'utf8'));
    const constantes = lerConstantes(textos, pacotes);
    const uso: UsoObjetos = {};
    const dinamicos: UsoDinamico[] = [];
    const fora = new Set<string>();
    fs.forEach((f, i) => {
      // A constante do próprio arquivo vale sobre a de outro arquivo do módulo com o mesmo nome.
      const r = analisarTexto(textos[i]!, modelo, lerConstantes([textos[i]!], constantes), relative(raiz, f));
      for (const [t, a] of Object.entries(r.uso))
        for (const x of a) if (!(uso[t] ??= []).includes(x)) uso[t]!.push(x);
      dinamicos.push(...r.dinamicos);
      for (const x of r.foraDoModelo) fora.add(x);
    });
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
