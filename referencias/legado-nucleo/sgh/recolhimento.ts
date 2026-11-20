// M60, etapa 1 (`pnpm sgh:aplicar -- --recolher`): remove TODOS os objetos SGH_ do banco, em ordem reversa
// de dependência, para o ensaio da primeira aplicação numa cópia limpa (aplica, mede, recolhe e confere que a
// impressão digital volta à de antes). Lê o catálogo do próprio banco (não os scripts): recolhe o que existe,
// inclusive o que um corte deixou pela metade. Ordem: chaves estrangeiras das tabelas SGH_ (FK só entre
// SGH_, convencoes.md §8), visões (as dependentes primeiro), tabelas (os índices e CHECKs vão junto),
// sequências, SGH_VERSAO_SCRIPT por último entre as tabelas e o papel SGH_APLICACAO no fim. Cada DROP numa
// transação própria (retomável: a reexecução relê o catálogo). Recusa: objeto de fora do SGH_ que dependa de
// um SGH_ (procedure, trigger, visão ou FK do sistema anterior: nada do legado é tocado, regra 1), produção
// sem a autorização própria do recolhimento e todo comando que não passe na conferência dos scripts SGH_.
import type { Escritor, Leitor } from '../transacao.js';
import { type AmbienteScript, AMBIENTES_SCRIPT } from './aplicador.js';
import { conferirComandoSgh, ErroScriptSgh, PAPEL_APLICACAO, TABELA_VERSAO } from './scripts.js';

export interface ObjetosSgh {
  readonly tabelas: readonly string[];
  readonly visoes: readonly string[];
  /** Visão SGH_ → objetos SGH_ de que ela depende (para a ordem). */
  readonly dependenciasDeVisao: readonly { readonly visao: string; readonly de: string }[];
  readonly chavesEstrangeiras: readonly { readonly tabela: string; readonly restricao: string }[];
  readonly sequencias: readonly string[];
  readonly papeis: readonly string[];
  /** Objetos de fora do SGH_ que dependem de um SGH_ (recolher recusaria). */
  readonly dependentesDeFora: readonly { readonly dependente: string; readonly de: string }[];
}

const SGH = /^SGH_[A-Z0-9_$]{1,27}$/;
const s = (v: unknown) => String(v ?? '').trim();

/** Catálogo SGH_ do banco (só leitura, tabelas do sistema RDB$). */
export async function lerObjetosSgh(l: Leitor): Promise<ObjetosSgh> {
  const teto = { teto: 20_000 };
  const rel = await l.consultar(
    `SELECT TRIM(RDB$RELATION_NAME) NOME, COALESCE(RDB$RELATION_TYPE, 0) TIPO FROM RDB$RELATIONS
      WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$RELATION_NAME STARTING WITH 'SGH_'`,
    [],
    teto,
  );
  const fks = await l.consultar(
    `SELECT TRIM(RDB$RELATION_NAME) TABELA, TRIM(RDB$CONSTRAINT_NAME) RESTRICAO FROM RDB$RELATION_CONSTRAINTS
      WHERE RDB$CONSTRAINT_TYPE = 'FOREIGN KEY' AND RDB$RELATION_NAME STARTING WITH 'SGH_'`,
    [],
    teto,
  );
  // FK de tabela de fora do SGH_ apontando para uma SGH_ (nunca deveria existir).
  const fksDeFora = await l.consultar(
    `SELECT TRIM(rc.RDB$RELATION_NAME) DEPENDENTE, TRIM(alvo.RDB$RELATION_NAME) DE
       FROM RDB$RELATION_CONSTRAINTS rc
       JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
       JOIN RDB$RELATION_CONSTRAINTS alvo ON alvo.RDB$CONSTRAINT_NAME = ref.RDB$CONST_NAME_UQ
      WHERE rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY' AND alvo.RDB$RELATION_NAME STARTING WITH 'SGH_'
        AND rc.RDB$RELATION_NAME NOT STARTING WITH 'SGH_'`,
    [],
    teto,
  );
  // Dependências registradas de objetos SGH_. Os triggers de CHECK (RDB$CHECK_CONSTRAINTS) e os campos
  // calculados (nomes RDB$) são do próprio objeto e caem com ele.
  const deps = await l.consultar(
    `SELECT DISTINCT TRIM(d.RDB$DEPENDENT_NAME) DEPENDENTE, TRIM(d.RDB$DEPENDED_ON_NAME) DE
       FROM RDB$DEPENDENCIES d
      WHERE d.RDB$DEPENDED_ON_NAME STARTING WITH 'SGH_'
        AND d.RDB$DEPENDENT_NAME NOT STARTING WITH 'RDB$'
        AND NOT EXISTS (SELECT 1 FROM RDB$CHECK_CONSTRAINTS c WHERE c.RDB$TRIGGER_NAME = d.RDB$DEPENDENT_NAME)`,
    [],
    teto,
  );
  const seq = await l.consultar(
    `SELECT TRIM(RDB$GENERATOR_NAME) NOME FROM RDB$GENERATORS
      WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$GENERATOR_NAME STARTING WITH 'SGH_'`,
    [],
    teto,
  );
  const pap = await l.consultar(
    `SELECT TRIM(RDB$ROLE_NAME) NOME FROM RDB$ROLES
      WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$ROLE_NAME STARTING WITH 'SGH_'`,
    [],
    teto,
  );
  const visoes = rel.filter((r) => Number(r['TIPO']) === 1).map((r) => s(r['NOME']));
  const nomesVisoes = new Set(visoes);
  const todas = deps.map((d) => ({ dependente: s(d['DEPENDENTE']), de: s(d['DE']) }));
  return {
    tabelas: rel.filter((r) => Number(r['TIPO']) !== 1).map((r) => s(r['NOME'])),
    visoes,
    dependenciasDeVisao: todas
      .filter((d) => nomesVisoes.has(d.dependente))
      .map((d) => ({ visao: d.dependente, de: d.de })),
    chavesEstrangeiras: fks.map((f) => ({ tabela: s(f['TABELA']), restricao: s(f['RESTRICAO']) })),
    sequencias: seq.map((r) => s(r['NOME'])),
    papeis: pap.map((r) => s(r['NOME'])),
    dependentesDeFora: [
      ...todas.filter((d) => !SGH.test(d.dependente)),
      ...fksDeFora.map((f) => ({ dependente: s(f['DEPENDENTE']), de: s(f['DE']) })),
    ],
  };
}

/** Visões em ordem de DROP: a que depende de outra visão SGH_ cai antes dela. */
export function ordenarVisoesParaRemover(
  visoes: readonly string[],
  deps: ObjetosSgh['dependenciasDeVisao'],
): string[] {
  const conjunto = new Set(visoes);
  const restantes = new Set(visoes);
  const ordem: string[] = [];
  while (restantes.size > 0) {
    // Pode cair a visão da qual nenhuma visão restante (outra) depende.
    const livres = [...restantes]
      .filter((v) => !deps.some((d) => d.de === v && d.visao !== v && restantes.has(d.visao)))
      .sort();
    if (livres.length === 0) throw new ErroScriptSgh('Dependência circular entre visões SGH_.');
    for (const v of livres) {
      ordem.push(v);
      restantes.delete(v);
    }
  }
  return ordem.filter((v) => conjunto.has(v));
}

/** Comandos do recolhimento, na ordem; cada um passa na conferência dos scripts SGH_. */
export function planejarRecolhimento(o: ObjetosSgh): string[] {
  if (o.dependentesDeFora.length > 0) {
    throw new ErroScriptSgh(
      `Recolhimento recusado: objeto de fora do SGH_ depende de objeto SGH_ (${o.dependentesDeFora
        .slice(0, 5)
        .map((d) => `${d.dependente} → ${d.de}`)
        .join(', ')}); nada do sistema anterior é tocado.`,
    );
  }
  const todos = [
    ...o.tabelas,
    ...o.visoes,
    ...o.sequencias,
    ...o.papeis,
    ...o.chavesEstrangeiras.flatMap((f) => [f.tabela, f.restricao]),
  ];
  const fora = todos.find((n) => !SGH.test(n));
  if (fora) throw new ErroScriptSgh(`Nome fora do padrão SGH_ no recolhimento: ${fora}.`);
  const tabelas = [...o.tabelas].sort();
  const comandos = [
    ...[...o.chavesEstrangeiras]
      .sort((a, b) => a.tabela.localeCompare(b.tabela) || a.restricao.localeCompare(b.restricao))
      .map((f) => `ALTER TABLE ${f.tabela} DROP CONSTRAINT ${f.restricao}`),
    ...ordenarVisoesParaRemover(o.visoes, o.dependenciasDeVisao).map((v) => `DROP VIEW ${v}`),
    ...tabelas.filter((t) => t !== TABELA_VERSAO).map((t) => `DROP TABLE ${t}`),
    ...[...o.sequencias].sort().map((q) => `DROP SEQUENCE ${q}`),
    ...(tabelas.includes(TABELA_VERSAO) ? [`DROP TABLE ${TABELA_VERSAO}`] : []),
    ...[...o.papeis]
      .sort((a, b) => Number(a === PAPEL_APLICACAO) - Number(b === PAPEL_APLICACAO) || a.localeCompare(b))
      .map((p) => `DROP ROLE ${p}`),
  ];
  for (const c of comandos) conferirComandoSgh(c);
  return comandos;
}

export interface AcessoRecolhimento {
  ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T>;
  escreverConfirmando<T>(fn: (e: Escritor) => Promise<T>): Promise<T>;
}

export interface OpcoesRecolhimento {
  readonly ambiente: AmbienteScript;
  /** Linha de ESTADO.md › Autorizações com `sgh:recolher producao <cod>` (obrigatória em producao). */
  readonly autorizacao?: string | null;
  readonly relogio?: () => number;
  readonly aoExecutar?: (comando: string, ms: number) => void;
}

export interface ResultadoRecolhimento {
  readonly comandos: readonly { readonly comando: string; readonly ms: number }[];
  readonly totalMs: number;
}

export async function recolherSgh(
  acesso: AcessoRecolhimento,
  opcoes: OpcoesRecolhimento,
): Promise<ResultadoRecolhimento> {
  if (!AMBIENTES_SCRIPT.includes(opcoes.ambiente)) throw new ErroScriptSgh('Ambiente inválido.');
  if (opcoes.ambiente === 'producao' && !opcoes.autorizacao?.trim()) {
    throw new ErroScriptSgh(
      'Recolhimento em produção recusado: falta a autorização própria (sgh:recolher producao <cod>) em ESTADO.md › Autorizações.',
    );
  }
  const relogio = opcoes.relogio ?? (() => performance.now());
  const inicio = relogio();
  const plano = planejarRecolhimento(await acesso.ler(lerObjetosSgh));
  const feitos: { comando: string; ms: number }[] = [];
  for (const c of plano) {
    const t0 = relogio();
    await acesso.escreverConfirmando((e) => e.executar(c));
    const ms = Math.max(0, relogio() - t0);
    feitos.push({ comando: c, ms });
    opcoes.aoExecutar?.(c, ms);
  }
  return { comandos: feitos, totalMs: Math.max(0, relogio() - inicio) };
}
