// M59-F1 (regra 4): os artefatos do privilégio mínimo por módulo estão em dia com o código, só trazem privilégio, e
// toda tabela que uma operação declara ao Executor tem INSERT e UPDATE no papel do módulo (conferido por uma
// extração independente do gerador, direto do texto de cada arquivo).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  alcanceVersionado,
  analisarTexto,
  calcularAlcances,
  caminhoAlcance,
  caminhoScript,
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
      calcularAlcances({ modelo, comum, modulos: { generico: { uso: {}, dinamicos: r.dinamicos, catalogo: [] } } }),
    ).toThrow(/dinâmico sem catálogo/);
    const { alcances } = calcularAlcances({
      modelo,
      comum,
      modulos: { generico: { uso: {}, dinamicos: r.dinamicos, catalogo: ['leito', 'trilha_auditoria'] } },
    });
    expect(alcances[0]?.objetos).toEqual({ leito: ['SELECT', 'INSERT'], trilha_auditoria: ['SELECT', 'INSERT'] });
  });

  it('trilha só com SELECT e INSERT; DELETE em exclusão lógica vira descarte; módulo sem uso vira aviso', () => {
    const { alcances, descartes, avisos } = calcularAlcances({
      modelo,
      comum: { trilha_auditoria: ['SELECT', 'INSERT'] },
      modulos: { cadastro: { paciente: ['DELETE', 'SELECT'] }, vazio: {} },
    });
    expect(alcances).toEqual([
      { modulo: 'cadastro', papel: 'sgh_mod_cadastro', objetos: { paciente: ['SELECT'], trilha_auditoria: ['SELECT', 'INSERT'] } },
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
    listas.set(m[1]!, [...m[2]!.matchAll(/'([a-z][a-z0-9_]*)'|\b([A-Z][A-Z0-9_]*)\b/g)].map((x) => x[1] ?? textos.get(x[2]!) ?? '').filter(Boolean));
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
    expect(porModulo.get('documento')?.['emissao_documento']).toEqual(expect.arrayContaining(['INSERT', 'UPDATE']));
    expect(porModulo.get('telemedicina')?.['teleconsulta']).toEqual(expect.arrayContaining(['INSERT']));
    expect(porModulo.get('portal-medico')?.['conta_portal_profissional_externo']).toEqual(
      expect.arrayContaining(['UPDATE']),
    );
  });

  it('toda tabela declarada a uma operação (tabelas: [...]) tem INSERT e UPDATE no papel do módulo', () => {
    const pasta = resolve(RAIZ, PASTA_MODULOS);
    const ts = (p: string): string[] =>
      readdirSync(p).flatMap((n) =>
        statSync(join(p, n)).isDirectory() ? ts(join(p, n)) : /\.ts$/.test(n) && !/\.spec\.ts$/.test(n) ? [join(p, n)] : [],
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
        expect(c).toMatch(/^(CREATE ROLE IF NOT EXISTS sgh_mod_[a-z0-9_]+;|GRANT [A-Z, ]+ ON [a-z0-9_]+ TO sgh_mod_[a-z0-9_]+;|REVOKE [A-Z, ]+ ON [a-z0-9_]+ FROM sgh_mod_[a-z0-9_]+;)$/);
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
