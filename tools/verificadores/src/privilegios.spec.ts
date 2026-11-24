// M59-F1 (regra 4): os artefatos do privilégio mínimo por módulo estão em dia com o código, só trazem privilégio, e
// toda tabela que uma operação declara ao Executor tem INSERT e UPDATE no papel do módulo (conferido por uma
// extração independente do gerador, direto do texto de cada arquivo).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  alcanceVersionado,
  analisarTexto,
  calcularAlcances,
  caminhoAlcance,
  caminhoScript,
  entradaDoRepositorio,
  gerarArtefatos,
  gerarScriptsPapeis,
  lerConstantes,
  lerModelo,
  PASTA_MODULOS,
  PlanoPrivilegioRecusado,
  RAIZ,
  SO_INCLUSAO,
  usosNoTexto,
  type ModeloBanco,
} from './privilegios.ts';

const ler = (p: string) => readFileSync(resolve(RAIZ, p), 'utf8');

describe('privilégio mínimo por módulo: regras (puro)', () => {
  const modelo: ModeloBanco = {
    tabelas: new Set(['paciente', 'leito', 'trilha_auditoria', 'vinculo', 'evolucao', 'emissao_documento']),
    exclusaoLogica: new Set(['paciente']),
    clinicas: new Set(['evolucao']),
  };

  it('lê o SQL literal e as tabelas declaradas às operações; ignora o que não é tabela do modelo', () => {
    const u = usosNoTexto(
      `const a = 'SELECT p.id FROM paciente p JOIN leito l ON l.id = p.leito_id';
       // DELETE FROM leito (comentário não conta)
       await tx.excluir('paciente', 1, 1); await e.executar('DELETE FROM vinculo WHERE id = ?');
       definirOperacao({ nome: 'x.y', tabelas: ['leito'] }); 'SELECT 1 FROM dual'`,
      modelo,
    );
    expect(u).toEqual({
      paciente: ['SELECT', 'UPDATE'],
      leito: ['SELECT', 'INSERT', 'UPDATE'],
      vinculo: ['SELECT', 'DELETE'],
    });
  });

  it('resolve constante: tx.incluir(TABELA), tx.alterar(TABELA_CONTA), ${DE_X} com trecho de SQL e tabelas: [TABELA]', () => {
    const texto = `
      const TABELA = 'emissao_documento';
      export const TABELA_CONTA = 'leito';
      const DE_VINCULO = \`vinculo v JOIN paciente p ON p.id = v.paciente_id\`;
      const TABELAS = [TABELA, 'paciente'] as const;
      const op = definirOperacao({ nome: 'a.b', tabelas: [TABELA], async gravar(tx) {
        await tx.incluir(TABELA, { a: 1 });
        await tx.alterar(TABELA_CONTA, 1, 1, {});
        await tx.consultar(\`SELECT 1 FROM \${DE_VINCULO} WHERE 1\`);
      } });
      const op2 = definirOperacao({ nome: 'a.c', tabelas: TABELAS, async gravar() {} });`;
    const r = analisarTexto(texto, modelo, lerConstantes([texto]));
    expect(r.dinamicos).toEqual([]);
    expect(r.uso).toEqual({
      emissao_documento: ['SELECT', 'INSERT', 'UPDATE'],
      leito: ['SELECT', 'UPDATE'],
      vinculo: ['SELECT'],
      paciente: ['SELECT', 'INSERT', 'UPDATE'],
    });
  });

  it('nome dinâmico sem catálogo é erro do gerador; com catálogo, vale para as tabelas do catálogo', () => {
    const texto = `async function gravar(tx, tabela) { await tx.incluir(tabela, {}); return tx.consultar(\`SELECT 1 FROM \${tabela}\`); }`;
    const r = analisarTexto(texto, modelo, new Map(), 'm/x.ts');
    expect(r.dinamicos.map((d) => [d.acao, d.expressao, d.onde])).toEqual([
      ['SELECT', 'tabela', 'm/x.ts:1'],
      ['INSERT', 'tabela', 'm/x.ts:1'],
    ]);
    const comum = { trilha_auditoria: ['SELECT', 'INSERT'] as ('SELECT' | 'INSERT')[] };
    expect(() =>
      calcularAlcances({
        modelo,
        comum,
        modulos: { generico: { uso: {}, dinamicos: r.dinamicos, catalogo: [] } },
      }),
    ).toThrow(/dinâmico sem catálogo/);
    const { alcances } = calcularAlcances({
      modelo,
      comum,
      modulos: { generico: { uso: {}, dinamicos: r.dinamicos, catalogo: ['leito', 'trilha_auditoria'] } },
    });
    expect(alcances[0]?.objetos).toEqual({
      leito: ['SELECT', 'INSERT'],
      trilha_auditoria: ['SELECT', 'INSERT'],
    });
  });

  it('constante de tabelas não resolvida é ERRO, mesmo com catálogo (nunca cai no catálogo em silêncio)', () => {
    const texto = `const op = definirOperacao({ nome: 'x', tabelas: ['leito', ...TABELAS_DE_FORA] });
const outra = definirOperacao({ nome: 'y', tabelas: TABELAS_OUTRAS });`;
    const r = analisarTexto(texto, modelo, new Map(), 'm/x.ts');
    expect(r.dinamicos.map((d) => d.expressao)).toEqual([
      '...TABELAS_DE_FORA',
      '...TABELAS_DE_FORA',
      'TABELAS_OUTRAS',
      'TABELAS_OUTRAS',
    ]);
    const comum = { trilha_auditoria: ['SELECT', 'INSERT'] as ('SELECT' | 'INSERT')[] };
    let erro: unknown;
    try {
      calcularAlcances({
        modelo,
        comum,
        modulos: { m: { uso: r.uso, dinamicos: r.dinamicos, catalogo: ['leito', 'paciente'] } },
      });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(PlanoPrivilegioRecusado);
    expect((erro as PlanoPrivilegioRecusado).motivos).toEqual([
      'm: constante de tabelas não resolvida (INSERT em ...TABELAS_DE_FORA em m/x.ts:1); siga o import até a definição ou declare a lista literal',
      'm: constante de tabelas não resolvida (UPDATE em ...TABELAS_DE_FORA em m/x.ts:1); siga o import até a definição ou declare a lista literal',
      'm: constante de tabelas não resolvida (INSERT em TABELAS_OUTRAS em m/x.ts:2); siga o import até a definição ou declare a lista literal',
      'm: constante de tabelas não resolvida (UPDATE em TABELAS_OUTRAS em m/x.ts:2); siga o import até a definição ou declare a lista literal',
    ]);
  });

  it('resolve lista filtrada pela diferença exata e objeto de listas; filtro de outra forma não se resolve', () => {
    const c = lerConstantes([
      `const A = ['leito', 'paciente', 'vinculo'] as const;
const B = ['vinculo'];
const C = [...A.filter((t) => t !== 'leito'), 'evolucao'];
const D = [
  ...A.filter(
    (t) => !B.includes(t as never) && t !== 'paciente',
  ),
];
const E = [...A.filter((t) => t.startsWith('l'))];
export const POR_RECURSO: Readonly<Record<string, readonly string[]>> = {
  ciclos: ['leito', 'vinculo'],
  vazio: [],
};`,
    ]);
    expect(c.get('C')).toEqual(['paciente', 'vinculo', 'evolucao']);
    expect(c.get('D')).toEqual(['leito']);
    expect(c.has('E')).toBe(false);
    expect(c.get('POR_RECURSO.ciclos')).toEqual(['leito', 'vinculo']);
    expect(c.get('POR_RECURSO.vazio')).toEqual([]);
  });

  it('trilha só com SELECT e INSERT; DELETE em exclusão lógica vira descarte; módulo sem uso vira aviso', () => {
    const { alcances, descartes, avisos } = calcularAlcances({
      modelo,
      comum: { trilha_auditoria: ['SELECT', 'INSERT'] },
      modulos: { cadastro: { paciente: ['DELETE', 'SELECT'] }, vazio: {} },
    });
    expect(alcances).toEqual([
      {
        modulo: 'cadastro',
        papel: 'sgh_mod_cadastro',
        objetos: { paciente: ['SELECT'], trilha_auditoria: ['SELECT', 'INSERT'] },
      },
    ]);
    expect(descartes).toEqual(['cadastro: DELETE em paciente (exclusão lógica)']);
    expect(avisos).toEqual([expect.stringMatching(/^vazio: nenhum uso/)]);
    const s = gerarScriptsPapeis(alcances, 'v1');
    expect(s.aplicar).toContain('CREATE ROLE IF NOT EXISTS sgh_mod_cadastro;');
    expect(s.aplicar).toContain('GRANT SELECT, INSERT ON trilha_auditoria TO sgh_mod_cadastro;');
    expect(s.aplicar).toContain('Sem efeito sozinho');
    expect(s.recolher).toContain('REVOKE SELECT ON paciente FROM sgh_mod_cadastro;');
  });

  it('recusa o plano inteiro: UPDATE na trilha, DELETE clínico, módulo repetido e objeto inválido', () => {
    try {
      calcularAlcances({
        modelo,
        comum: {},
        modulos: {
          'a-b': { trilha_auditoria: ['UPDATE'] },
          a_b: { evolucao: ['DELETE'] },
          c: { 'Paciente;': ['SELECT'] },
        },
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlanoPrivilegioRecusado);
      const m = (e as PlanoPrivilegioRecusado).motivos.join('\n');
      expect(m).toMatch(/trilha_auditoria é só de inclusão: UPDATE recusado em a-b/);
      expect(m).toMatch(/a_b: DELETE em evolucao \(registro clínico/);
      expect(m).toMatch(/módulo repetido: a-b e a_b/);
      expect(m).toMatch(/objeto inválido em c/);
    }
  });
});

/** Extração independente do gerador: `tabelas: [...]` com literais e constantes do próprio arquivo. */
function declaracoesDoArquivo(texto: string): string[] {
  const t = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const textos = new Map<string, string>();
  const listas = new Map<string, string[]>();
  for (const m of t.matchAll(/const ([A-Z][A-Z0-9_]*)\s*=\s*'([a-z][a-z0-9_]*)'/g)) textos.set(m[1]!, m[2]!);
  for (const m of t.matchAll(/const ([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]*)\]/g))
    listas.set(
      m[1]!,
      [...m[2]!.matchAll(/'([a-z][a-z0-9_]*)'|\b([A-Z][A-Z0-9_]*)\b/g)]
        .map((x) => x[1] ?? textos.get(x[2]!) ?? '')
        .filter(Boolean),
    );
  const saida: string[] = [];
  for (const m of t.matchAll(/\btabelas:\s*(\[[^\]]*\]|[A-Z][A-Z0-9_]*)\s*[,}\n]/g)) {
    const c = m[1]!;
    if (!c.startsWith('[')) saida.push(...(listas.get(c) ?? []));
    else
      for (const x of c.matchAll(/'([a-z][a-z0-9_]*)'|\b([A-Z][A-Z0-9_]*)\b/g))
        saida.push(x[1] ?? textos.get(x[2]!) ?? '');
  }
  return saida.filter(Boolean);
}

/** Árvore temporária com DDL, pacote de persistência e módulos (cada chave é um caminho relativo à raiz). */
function arvore(arquivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), 'privilegios-'));
  const ddl = ['leito', 'paciente', 'vinculo', 'evolucao', 'regra', 'producao']
    .map((t) => `CREATE TABLE ${t} (\n  id BIGINT NOT NULL\n);\n`)
    .join('');
  for (const [p, texto] of Object.entries({ 'db/migracoes/01_X/01_tabelas.sql': ddl, ...arquivos })) {
    mkdirSync(dirname(join(raiz, p)), { recursive: true });
    writeFileSync(join(raiz, p), texto);
  }
  return raiz;
}

function recusa(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof PlanoPrivilegioRecusado) return [...e.motivos];
    throw e;
  }
  return [];
}

describe('privilégio mínimo por módulo: imports seguidos até a definição (árvore temporária)', () => {
  const M = 'apps/api/src/modulos';
  it('resolve alias, reexportação relativa, operação importada de outro módulo (op.tabelas) e porta compartilhada', () => {
    const raiz = arvore({
      'packages/persistencia/src/porta-prod.ts': `export const TABELAS_PROD: readonly string[] = ['producao'];
export const SQL = 'SELECT id FROM regra WHERE id = ?';
export async function gravar(tx: { executar(s: string): Promise<void> }) {
  await tx.executar('INSERT INTO producao (id) VALUES (1)');
}
`,
      // Lista só num arquivo relativo do app (fora de pacotes): o mapa dos pacotes não a resolveria.
      [`${M}/fat/base.ts`]: `export const LISTA_BASE = ['vinculo'];\n`,
      [`${M}/fat/nomes.ts`]: `export { LISTA_BASE as LISTA_LOCAL } from './base.js';\n`,
      [`${M}/fat/ops.ts`]: `import { TABELAS_PROD } from '@sgh/persistencia';
import { LISTA_LOCAL as LISTA } from './nomes.js';
export const lancar = definirOperacao({
  nome: 'fat.lancar',
  tabelas: ['leito', ...LISTA, ...TABELAS_PROD],
  gravar: async () => undefined,
});
`,
      [`${M}/atd/extra.ts`]: `import { lancar } from '../fat/ops.js';
const OP = definirOperacao({ nome: 'atd.extra', tabelas: [...lancar.tabelas] });
`,
      // Ciclo x ↔ y: x é lido primeiro (pela ordem dos módulos) e deixa y incompleto; z importa de y por outro caminho.
      [`${M}/m8/x.ts`]: `import { TABELAS_Y } from '../m9/y.js';\nexport const TABELAS_X = ['paciente'];\n`,
      [`${M}/m9/y.ts`]: `import { TABELAS_X } from '../m8/x.js';
export const TABELAS_Y = [...TABELAS_X];
const OP = definirOperacao({ nome: 'y', tabelas: TABELAS_Y });
`,
      [`${M}/m10/z.ts`]: `import { TABELAS_Y } from '../m9/y.js';
const OP = definirOperacao({ nome: 'z', tabelas: TABELAS_Y });
`,
    });
    try {
      const e = entradaDoRepositorio(raiz);
      const { alcances } = calcularAlcances(e);
      const de = (m: string) => alcances.find((a) => a.modulo === m)?.objetos;
      const gravacao = { leito: ['INSERT', 'UPDATE'], vinculo: ['INSERT', 'UPDATE'] };
      expect(de('fat')).toEqual({ ...gravacao, producao: ['INSERT', 'UPDATE'], regra: ['SELECT'] });
      expect(de('atd')).toEqual(de('fat'));
      expect(e.modulos['atd']).toMatchObject({ dinamicos: [] });
      expect(de('m9')).toEqual({ paciente: ['INSERT', 'UPDATE'] });
      expect(de('m10')).toEqual({ paciente: ['INSERT', 'UPDATE'] });
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('recusa (nunca o catálogo) o nome ligado a import que não se resolve: membro em minúsculas, export *, import type e ciclo', () => {
    const raiz = arvore({
      [`${M}/m1/a.ts`]: `import { op } from '../m2/b.js';
export const CATALOGO = [{ tabela: 'leito' }, { tabela: 'paciente' }];
const X = definirOperacao({ nome: 'x', tabelas: [...op.tabelas] });
`,
      [`${M}/m2/b.ts`]: `export const op = criarOperacao();\n`,
      [`${M}/m3/c.ts`]: `import { TABELAS_S } from '../m4/estrela.js';
const X = definirOperacao({ nome: 'c', tabelas: TABELAS_S });
`,
      [`${M}/m4/estrela.ts`]: `export * from './def.js';\n`,
      [`${M}/m4/def.ts`]: `export const TABELAS_S = ['leito'];\nexport const TABELAS_T = ['vinculo'];\n`,
      [`${M}/m5/e.ts`]: `import type { TABELAS_T } from '../m4/def.js';
const X = definirOperacao({ nome: 'e', tabelas: TABELAS_T });
`,
      [`${M}/m6/a.ts`]: `import { TABELAS_B } from '../m7/b.js';
export const TABELAS_A = [...TABELAS_B];
const X = definirOperacao({ nome: 'a', tabelas: TABELAS_A });
`,
      [`${M}/m7/b.ts`]: `import { TABELAS_A } from '../m6/a.js';\nexport const TABELAS_B = [...TABELAS_A];\n`,
    });
    try {
      const e = entradaDoRepositorio(raiz);
      expect(e.modulos['m1']).toMatchObject({ catalogo: ['leito', 'paciente'] });
      const motivos = recusa(() => calcularAlcances(e));
      const naoResolvida = (m: string, acao: string, x: string, onde: string) =>
        `${m}: constante de tabelas não resolvida (${acao} em ${x} em ${M}/${onde}); siga o import até a definição ou declare a lista literal`;
      expect(motivos).toEqual([
        naoResolvida('m1', 'INSERT', '...op.tabelas', 'm1/a.ts:3'),
        naoResolvida('m1', 'UPDATE', '...op.tabelas', 'm1/a.ts:3'),
        naoResolvida('m3', 'INSERT', 'TABELAS_S', 'm3/c.ts:2'),
        naoResolvida('m3', 'UPDATE', 'TABELAS_S', 'm3/c.ts:2'),
        naoResolvida('m5', 'INSERT', 'TABELAS_T', 'm5/e.ts:2'),
        naoResolvida('m5', 'UPDATE', 'TABELAS_T', 'm5/e.ts:2'),
        naoResolvida('m6', 'INSERT', 'TABELAS_A', 'm6/a.ts:3'),
        naoResolvida('m6', 'UPDATE', 'TABELAS_A', 'm6/a.ts:3'),
      ]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('função sem parâmetro que devolve um campo de lista de objetos (com filtro de igualdade) vira lista de tabelas', () => {
    const c = lerConstantes([
      `export const REFS: readonly Ref[] = [
  { tabela: 'leito', destino: 'transferir' },
  { tabela: 'vinculo', destino: 'manter' },
  { tabela: 'leito', destino: 'transferir' },
];
export function transferidas(): string[] {
  return [...new Set(REFS.filter((r) => r.destino === 'transferir').map((r) => r.tabela))];
}
export function todas(): string[] {
  return REFS.map((r) => r.tabela);
}
export function outra(): string[] {
  return REFS.filter((r) => r.destino !== 'manter').map((r) => r.tabela);
}`,
    ]);
    expect(c.get('transferidas()')).toEqual(['leito']);
    expect(c.get('todas()')).toEqual(['leito', 'vinculo']);
    expect(c.has('outra()')).toBe(false);
    const modelo: ModeloBanco = { tabelas: new Set(['leito', 'paciente']), exclusaoLogica: new Set() };
    const r = analisarTexto(
      `const OP = definirOperacao({ nome: 'u', tabelas: [\n  ...new Set([\n    'paciente',\n    ...transferidas(),\n  ]),\n] });`,
      modelo,
      c,
    );
    expect(r.uso).toEqual({ paciente: ['INSERT', 'UPDATE'], leito: ['INSERT', 'UPDATE'] });
    expect(r.dinamicos).toEqual([]);
  });
});

describe('privilégio mínimo por módulo: artefatos do repositório', () => {
  const a = gerarArtefatos();
  const modelo = lerModelo();
  const porModulo = new Map(a.alcances.map((x) => [x.modulo, x.objetos]));

  it('alcance e scripts versionados iguais ao gerador (rode pnpm privilegios:gerar)', () => {
    expect(modelo.tabelas.size).toBeGreaterThan(100);
    expect(a.modulos).toBeGreaterThan(10);
    expect(ler(caminhoAlcance())).toBe(a.alcanceJson);
    expect(ler(caminhoScript('aplicar'))).toBe(a.aplicar);
    expect(ler(caminhoScript('recolher'))).toBe(a.recolher);
    expect(alcanceVersionado()?.versao).toBe(a.versao);
  });

  it('gravação por constante chega ao papel (os casos que o casamento só por literal perdia)', () => {
    expect(porModulo.get('documento')?.['emissao_documento']).toEqual(
      expect.arrayContaining(['INSERT', 'UPDATE']),
    );
    expect(porModulo.get('telemedicina')?.['teleconsulta']).toEqual(expect.arrayContaining(['INSERT']));
    expect(porModulo.get('portal-medico')?.['conta_portal_profissional_externo']).toEqual(
      expect.arrayContaining(['UPDATE']),
    );
  });

  it('constante de tabelas importada de outro módulo segue o import até a definição (repasse no faturamento)', () => {
    // faturamento/operacoes.ts declara `...TABELAS_PRODUCAO_CONTA`, definida em repasse/producao-conta.ts.
    expect(ler('apps/api/src/modulos/faturamento/operacoes.ts')).toMatch(
      /import \{[^}]*\bTABELAS_PRODUCAO_CONTA\b[^}]*\} from '\.\.\/repasse\/producao-conta\.js'/,
    );
    for (const t of ['producao_repasse', 'estorno_repasse'])
      expect(porModulo.get('faturamento')?.[t]).toEqual(['SELECT', 'INSERT', 'UPDATE']);
  });

  it('operação importada de outro módulo (tabelas: [...lancarItem.tabelas]) e a leitura da porta compartilhada', () => {
    // atendimento.lancar-procedimento-extra declara as tabelas do lançamento do faturamento, que roda a produção do
    // repasse na mesma transação: o papel do atendimento grava a produção e lê o que a sincronização lê.
    expect(ler('apps/api/src/modulos/atendimento/porta-propria.ts')).toMatch(
      /tabelas: \[\.\.\.lancarItem\.tabelas\]/,
    );
    for (const m of ['atendimento', 'faturamento']) {
      for (const t of ['producao_repasse', 'estorno_repasse', 'lancamento_repasse'])
        expect(porModulo.get(m)?.[t], `${m} ${t}`).toEqual(['SELECT', 'INSERT', 'UPDATE']);
      for (const t of [
        'regra_repasse',
        'regra_repasse_item',
        'glosa_item',
        'conta_hospitalar_item_participante',
      ])
        expect(porModulo.get(m)?.[t], `${m} ${t}`).toContain('SELECT');
    }
  });

  it('toda tabela declarada a uma operação (tabelas: [...]) tem INSERT e UPDATE no papel do módulo', () => {
    const pasta = resolve(RAIZ, PASTA_MODULOS);
    const ts = (p: string): string[] =>
      readdirSync(p).flatMap((n) =>
        statSync(join(p, n)).isDirectory()
          ? ts(join(p, n))
          : /\.ts$/.test(n) && !/\.spec\.ts$/.test(n)
            ? [join(p, n)]
            : [],
      );
    const faltas: string[] = [];
    let conferidas = 0;
    for (const m of readdirSync(pasta).filter((n) => statSync(join(pasta, n)).isDirectory())) {
      const obj = porModulo.get(m) ?? {};
      for (const f of ts(join(pasta, m)))
        for (const t of declaracoesDoArquivo(readFileSync(f, 'utf8'))) {
          if (!modelo.tabelas.has(t)) continue;
          conferidas++;
          const exigidas = SO_INCLUSAO.includes(t) ? ['INSERT'] : ['INSERT', 'UPDATE'];
          for (const x of exigidas) if (!obj[t]?.includes(x as 'INSERT')) faltas.push(`${m} ${t} ${x}`);
        }
    }
    expect(conferidas).toBeGreaterThan(100);
    expect([...new Set(faltas)]).toEqual([]);
  });

  it('os scripts só criam papéis e concedem ou revogam privilégio de tabela; nada de administrador', () => {
    for (const texto of [a.aplicar, a.recolher]) {
      for (const c of texto.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('--'))) {
        expect(c).toMatch(
          /^(CREATE ROLE IF NOT EXISTS sgh_mod_[a-z0-9_]+;|GRANT [A-Z, ]+ ON [a-z0-9_]+ TO sgh_mod_[a-z0-9_]+;|REVOKE [A-Z, ]+ ON [a-z0-9_]+ FROM sgh_mod_[a-z0-9_]+;)$/,
        );
        expect(c).not.toMatch(/ALL PRIVILEGES|GRANT OPTION|SUPER|PASSWORD|\*\./);
      }
    }
  });

  it('o comum do Executor (trilha) está em todo papel, só com SELECT e INSERT; nenhum DELETE em exclusão lógica nem clínico', () => {
    for (const x of a.alcances) {
      expect(x.objetos['trilha_auditoria'], x.modulo).toEqual(['SELECT', 'INSERT']);
      for (const [t, acoes] of Object.entries(x.objetos)) {
        if (modelo.exclusaoLogica.has(t)) expect(acoes, `${x.modulo} ${t}`).not.toContain('DELETE');
        if (modelo.clinicas?.has(t)) expect(acoes, `${x.modulo} ${t}`).not.toContain('DELETE');
      }
    }
  });
});
