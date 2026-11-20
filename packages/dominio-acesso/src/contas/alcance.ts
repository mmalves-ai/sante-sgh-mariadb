// M59-F1 (ficha do M59, regra 4; preparo, seção 4.5 e risco 2): o alcance de cada módulo no banco, derivado do
// que o próprio código do módulo faz. Puro: recebe as receitas de gravação compatível (passos e efeitos dos
// gatilhos), o uso de tabelas, procedures e generators que a varredura do adaptador achou em cada grupo, o comum do
// núcleo (trilha, idempotência, versões) e os generators que os gatilhos de cada tabela usam (catálogo do banco, fora
// de PUBLIC); devolve um AlcanceModulo por grupo, pronto para planejarPrivilegios. O módulo do banco é o grupo do
// adaptador (`packages/legado/src/<grupo>`), que é a unidade de dono das receitas e das consultas.
import type { AcaoPrivilegioModulo, AlcanceModulo } from '@sgh/contratos';
import { SO_INCLUSAO } from './privilegio-minimo.js';

export type UsoObjetos = Readonly<Record<string, readonly AcaoPrivilegioModulo[]>>;

export interface ReceitaAlcance {
  readonly nome: string;
  readonly grupo: string;
  readonly passos: readonly { readonly tabela: string; readonly acao: string }[];
  readonly efeitos: readonly { readonly tabela: string; readonly acao: string }[];
}

export interface EntradaAlcance {
  readonly receitas: readonly ReceitaAlcance[];
  /** Grupo → objetos citados no código do grupo, com as ações vistas (SELECT, DML, EXECUTE, USAGE). */
  readonly usosPorGrupo: Readonly<Record<string, UsoObjetos>>;
  /** O que todo módulo precisa (o núcleo grava a trilha, a idempotência e lê a versão dos scripts). */
  readonly comum: UsoObjetos;
  /** Tabela → generators que os gatilhos dela usam e que PUBLIC não tem (catálogo RDB$DEPENDENCIES). */
  readonly generatorsPorTabela?: Readonly<Record<string, readonly string[]>>;
  /** Tabela → procedures que os gatilhos dela chamam (o gatilho roda com o privilégio de quem grava). */
  readonly proceduresPorTabela?: Readonly<Record<string, readonly string[]>>;
  /**
   * Tabela → tabelas que os gatilhos dela (e o que eles chamam ou disparam) leem ou gravam, com as ações, já sem o que
   * PUBLIC ou o próprio gatilho ou procedure têm (catálogo RDB$DEPENDENCIES e fontes PSQL).
   */
  readonly tabelasPorTabela?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /**
   * Receitas que o núcleo executa dentro da transação de toda operação de qualquer módulo (o evento na trilha do
   * legado, gravado pelo executor com a conta do módulo): os passos, os efeitos e os gatilhos delas vão a todo módulo.
   */
  readonly receitasDoNucleo?: readonly string[];
  /** Grupos que não viram módulo (o núcleo, os tipos gerados, a cópia de dev). */
  readonly gruposFora?: readonly string[];
}

export interface AlcanceCalculado {
  readonly alcances: readonly AlcanceModulo[];
  /** O que foi deixado de fora e por quê (ex.: UPDATE na trilha visto num texto do grupo). */
  readonly descartes: readonly string[];
}

const IDENT = /^[A-Z][A-Z0-9_$]{0,62}$/;
const DML: readonly AcaoPrivilegioModulo[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const ESCRITA = new Set(['INSERT', 'UPDATE', 'DELETE']);

/** `cadastro-paciente` ou `cadastro_paciente` → `cadastroPaciente` (o módulo é identificador camelCase). */
export function moduloDoGrupo(grupo: string): string {
  const m = grupo.trim().replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  if (!/^[a-z][a-zA-Z0-9]*$/.test(m)) throw new Error(`Grupo inválido: ${grupo}`);
  return m;
}

/**
 * Alcance por módulo. Regras: passo de receita dá SELECT e a ação na tabela; efeito de gatilho dá a ação (o gatilho
 * roda com o privilégio de quem grava); escrita em tabela (receita, código do grupo ou núcleo) dá o que os gatilhos
 * dela usam: USAGE nos generators, EXECUTE nas procedures e a ação nas tabelas que eles leem ou gravam (todos os
 * gatilhos da tabela, de qualquer evento: aproximação por cima, só de execução); receita do núcleo vale para todo
 * módulo; procedure
 * (EXECUTE) e generator (USAGE) nunca se misturam com DML no mesmo objeto (o primeiro uso visto define o tipo); UPDATE
 * e DELETE nas tabelas só de inclusão são descartados com motivo (a trilha nunca muda).
 */
export function calcularAlcances(e: EntradaAlcance): AlcanceCalculado {
  const fora = new Set(e.gruposFora ?? []);
  const descartes: string[] = [];
  const porModulo = new Map<string, Map<string, Set<AcaoPrivilegioModulo>>>();
  const tipoObjeto = new Map<string, 'tabela' | 'procedure' | 'generator'>();

  const tipoDe = (acao: AcaoPrivilegioModulo) =>
    acao === 'EXECUTE' ? 'procedure' : acao === 'USAGE' ? 'generator' : 'tabela';

  const somar = (modulo: string, objeto: string, acao: AcaoPrivilegioModulo, origem: string) => {
    const o = objeto.trim().toUpperCase();
    if (!IDENT.test(o)) {
      descartes.push(`${modulo}: objeto com nome inválido em ${origem}`);
      return;
    }
    if (ESCRITA.has(acao) && acao !== 'INSERT' && SO_INCLUSAO.some((r) => r.test(o))) {
      descartes.push(`${modulo}: ${acao} em ${o} descartado (${origem}; tabela só de inclusão)`);
      return;
    }
    const t = tipoDe(acao);
    const visto = tipoObjeto.get(o);
    if (visto && visto !== t) {
      descartes.push(`${modulo}: ${acao} em ${o} descartado (${origem}; o objeto é ${visto})`);
      return;
    }
    tipoObjeto.set(o, t);
    const m = porModulo.get(modulo) ?? porModulo.set(modulo, new Map()).get(modulo)!;
    (m.get(o) ?? m.set(o, new Set()).get(o)!).add(acao);
  };

  const dosGatilhos = (m: string, t: string) => {
    for (const g of e.generatorsPorTabela?.[t] ?? []) somar(m, g, 'USAGE', `gatilho de ${t}`);
    for (const p of e.proceduresPorTabela?.[t] ?? []) somar(m, p, 'EXECUTE', `gatilho de ${t}`);
    for (const [x, acoes] of Object.entries(e.tabelasPorTabela?.[t] ?? {}))
      for (const a of acoes) somar(m, x, a.trim().toUpperCase() as AcaoPrivilegioModulo, `gatilho de ${t}`);
  };

  const modulos = new Set<string>();
  for (const g of Object.keys(e.usosPorGrupo)) if (!fora.has(g)) modulos.add(moduloDoGrupo(g));
  for (const r of e.receitas) if (!fora.has(r.grupo)) modulos.add(moduloDoGrupo(r.grupo));

  const doNucleo = new Set(e.receitasDoNucleo ?? []);
  const aplicarReceita = (m: string, r: ReceitaAlcance) => {
    const escritas = new Set<string>();
    for (const p of r.passos) {
      const acao = p.acao.trim().toUpperCase() as AcaoPrivilegioModulo;
      if (!ESCRITA.has(acao)) {
        descartes.push(`${m}: ação ${p.acao} em ${p.tabela} na receita ${r.nome}`);
        continue;
      }
      somar(m, p.tabela, 'SELECT', `receita ${r.nome}`);
      somar(m, p.tabela, acao, `receita ${r.nome}`);
      escritas.add(p.tabela.trim().toUpperCase());
    }
    for (const f of r.efeitos) {
      const acao = f.acao.trim().toUpperCase() as AcaoPrivilegioModulo;
      if (!ESCRITA.has(acao)) {
        descartes.push(`${m}: ação ${f.acao} em ${f.tabela} (efeito) na receita ${r.nome}`);
        continue;
      }
      somar(m, f.tabela, acao, `efeito da receita ${r.nome}`);
      escritas.add(f.tabela.trim().toUpperCase());
    }
    for (const t of escritas) dosGatilhos(m, t);
  };
  for (const r of e.receitas) {
    if (doNucleo.has(r.nome)) for (const m of modulos) aplicarReceita(m, r);
    else if (!fora.has(r.grupo)) aplicarReceita(moduloDoGrupo(r.grupo), r);
  }
  for (const [g, usos] of Object.entries(e.usosPorGrupo)) {
    if (fora.has(g)) continue;
    const m = moduloDoGrupo(g);
    for (const [o, acoes] of Object.entries(usos)) for (const a of acoes) somar(m, o, a, `código de ${g}`);
    for (const [o, acoes] of Object.entries(usos)) {
      if (acoes.some((a) => ESCRITA.has(a))) dosGatilhos(m, o.trim().toUpperCase());
    }
  }
  for (const m of modulos) {
    for (const [o, acoes] of Object.entries(e.comum)) {
      for (const a of acoes) somar(m, o, a, 'núcleo');
      if (acoes.some((a) => ESCRITA.has(a))) dosGatilhos(m, o.trim().toUpperCase());
    }
  }

  const ordem = (a: AcaoPrivilegioModulo, b: AcaoPrivilegioModulo) =>
    [...DML, 'EXECUTE', 'USAGE'].indexOf(a) - [...DML, 'EXECUTE', 'USAGE'].indexOf(b);
  const alcances = [...modulos].sort().map((modulo) => {
    const objs = porModulo.get(modulo) ?? new Map<string, Set<AcaoPrivilegioModulo>>();
    const objetos: Record<string, AcaoPrivilegioModulo[]> = {};
    for (const o of [...objs.keys()].sort()) objetos[o] = [...(objs.get(o) ?? [])].sort(ordem);
    return { modulo, objetos };
  });
  return { alcances, descartes: [...new Set(descartes)].sort() };
}

/** Resumo estável do alcance (12 hex; FNV-1a de 64 bits sobre o JSON ordenado): a versão do plano. */
export function versaoDoAlcance(alcances: readonly AlcanceModulo[]): string {
  const texto = JSON.stringify(alcances.map((a) => [a.modulo, Object.entries(a.objetos)]));
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(texto)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}
