// guardas:legado (ficha do M04, seção 10): uma fixture por padrão proibido, cada uma precisa falhar na regra
// certa (no caminho que declara); o repositório inteiro, 0 achado. Uma regressão da guarda cai no verificar.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arquivosConferidos, conferir, lerListas, procurarNoArquivo, type Regra } from './guardas-legado.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const pasta = 'tools/verificadores/src/__fixtures__/guardas';
const listas = lerListas(raiz);

const REGRA_DO_PREFIXO: readonly (readonly [RegExp, Regra])[] = [
  [/^a-/, 'a-tabela-legada-fora'],
  [/^b-/, 'b-escrita-fora'],
  [/^c-/, 'c-ddl-fora-sgh'],
  [/^d-/, 'd-trigger'],
  [/^e-/, 'e-fk-legada'],
  [/^f-/, 'f-max-mais-um'],
  [/^generator-/, 'generator-fora'],
  [/^g-/, 'g-funcao-em-indice'],
  [/^procedimento-/, 'procedimento-com-efeito'],
  [/^coluna-credencial/, 'coluna-credencial'],
  [/^tbtabthm-/, 'tbtabthm-escrita'],
  [/^catalogo-delete/, 'catalogo-delete'],
  [/^beneficiario-ficticio/, 'beneficiario-ficticio'],
];

const fixtures = readdirSync(resolve(raiz, pasta)).sort();

describe('guardas:legado: fixtures proibidas', () => {
  it('há pelo menos uma fixture por regra', () => {
    const cobertas = new Set(fixtures.map((f) => REGRA_DO_PREFIXO.find(([re]) => re.test(f))?.[1]));
    for (const [, regra] of REGRA_DO_PREFIXO) expect(cobertas, regra).toContain(regra);
  });

  it.each(fixtures)('%s falha na regra do nome', (f) => {
    const regra = REGRA_DO_PREFIXO.find(([re]) => re.test(f))?.[1];
    expect(regra, `fixture sem regra conhecida: ${f}`).toBeDefined();
    const achados = conferir(raiz, [`${pasta}/${f}`], listas);
    expect(achados.map((a) => a.regra)).toContain(regra);
  });
});

describe('guardas:legado: casos da revisão do M04', () => {
  it('teste de unidade (dublê) fica de fora das regras a e b; o de integração, não', () => {
    const sql = "export const s = 'INSERT INTO RICADPAC (NOME) VALUES (?)';";
    expect(procurarNoArquivo(sql, 'packages/legado/src/cadastro/x.spec.ts', listas)).toEqual([]);
    expect(
      procurarNoArquivo(sql, 'packages/legado/src/cadastro/x.int.spec.ts', listas).map((a) => a.regra),
    ).toContain('b-escrita-fora');
    expect(
      procurarNoArquivo(sql, 'packages/testes/src/integracao/util.ts', listas).map((a) => a.regra),
    ).toContain('b-escrita-fora');
  });

  it('em packages/testes, a escrita só vale na massa sintética e na reprodução', () => {
    const sql = "export const s = 'INSERT INTO SGH_X (ID) VALUES (?)';";
    expect(procurarNoArquivo(sql, 'packages/testes/src/massa/sintetica.ts', listas)).toEqual([]);
    expect(procurarNoArquivo(sql, 'packages/testes/src/outro.ts', listas).map((a) => a.regra)).toEqual([
      'b-escrita-fora',
    ]);
  });
});

describe('guardas:legado: registros fictícios de beneficiário (M56, regra 4)', () => {
  it('nenhum SQL os cita, nem no adaptador, nem em teste de unidade', () => {
    for (const arquivo of [
      'packages/legado/src/operadora/repositorios/x.ts',
      'packages/legado/src/operadora/repositorios/x.spec.ts',
    ])
      for (const t of ['PSBENEFI', 'PSBENCPL', 'PSBENTMP', 'PSPLNASS', 'PSVENDAS', 'PSATVASS'])
        expect(
          procurarNoArquivo(`export const s = 'SELECT COUNT(*) FROM ${t}';`, arquivo, listas).map(
            (a) => a.regra,
          ),
          `${arquivo} ${t}`,
        ).toContain('beneficiario-ficticio');
  });

  it('as outras tabelas do ramo continuam liberadas no adaptador', () => {
    const sql = "export const s = 'SELECT ID, NOME FROM SPVINCULOTITULAR ORDER BY ID';";
    expect(procurarNoArquivo(sql, 'packages/legado/src/operadora/repositorios/x.ts', listas)).toEqual([]);
  });
});

describe('guardas:legado: repositório', () => {
  // Varre o repositório inteiro (milhares de arquivos): com a VM carregada passa dos 5 s do padrão.
  it('0 achado no código versionado', { timeout: 120_000 }, () => {
    expect(conferir(raiz, arquivosConferidos(raiz), listas)).toEqual([]);
  });
});
