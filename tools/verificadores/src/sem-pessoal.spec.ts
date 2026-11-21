// Regra 1 do M03 (cap-10 §10.4; convencoes.md §7 e §11): arquivo de assinatura, perfil, domínios vistos e
// resultado não guardam conteúdo de linha. O verificador falha com CPF, CNS, telefone, e-mail ou nome de
// coluna pessoal com valor; e passa nos arquivos do repositório. Valores abaixo são SINTÉTICOS (inválidos).
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cobertoPelaRegra,
  colunaRestrita,
  lerListaPessoais,
  procurarPessoal,
  verificarRepositorio,
} from './sem-pessoal.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const lista = lerListaPessoais(
  raiz,
  'tools/verificadores/src/__fixtures__/sem-pessoal/colunas-pessoais.yaml',
);
const motivos = (conteudo: unknown, arquivo = 'x.assinatura.json') =>
  procurarPessoal(typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo), arquivo, lista).map(
    (a) => a.motivo,
  );

const assinatura = (colunas: Record<string, unknown>) => ({
  formato: 1,
  operacao: 'agenda.agendarExame',
  cenario: 'c',
  tabelas: [{ tabela: 'SIPACAGD', acao: 'INSERT', linhas: 1, colunas }],
});

describe('sem-pessoal: falha com dado pessoal', () => {
  it('CPF, CNS, telefone e e-mail em qualquer texto', () => {
    expect(motivos({ x: 'paciente 000.000.000-00' })).toContain('CPF');
    expect(motivos({ x: '00000000000' })).toContain('CPF (só dígitos)');
    expect(motivos({ x: '700000000000000' })).toContain('CNS');
    expect(motivos({ x: '(00) 90000-0000' })).toContain('telefone');
    expect(motivos({ x: 'fulano@exemplo.invalid' })).toContain('e-mail');
    expect(
      motivos('resumo com 000.000.000-00', 'tools/assinatura/resultados/2026-10-19/resumo.txt'),
    ).toContain('CPF');
  });

  it('coluna pessoal com valor na assinatura', () => {
    expect(motivos(assinatura({ PACIENTE: { classe: 'constante:FULANO' } }))).toEqual([
      'valor em coluna pessoal',
    ]);
    expect(motivos(assinatura({ CPF: { classe: 'dominio:1|2' } }))).toEqual(['valor em coluna pessoal']);
    expect(
      motivos(assinatura({ PACIENTE: { classe: 'entrada' }, LIVRE: { classe: 'constante:T' } })),
    ).toEqual([]);
  });

  it('coluna pessoal com valores, classe ou distintos no perfil; data de linha em domínio', () => {
    const perfil = (colunas: Record<string, unknown>) => ({ formato: 1, tabela: 'RICADPAC', colunas });
    expect(
      motivos(perfil({ NOME: { classe: 'entrada', valores: { X: 9 } } }), 'perfil-RICADPAC.pc.json'),
    ).toEqual(['valores em coluna pessoal']);
    expect(
      motivos(perfil({ FONE: { classe: 'constante:0', distintos: 3 } }), 'perfil-RICADPAC.pc.json'),
    ).toEqual(['valor em coluna pessoal', 'distintos em coluna pessoal']);
    expect(
      motivos(
        perfil({ TIPO: { classe: 'dominio:2020-01-02', valores: { '2020-01-02': 9, '1899-12-30': 5 } } }),
        'perfil-X.pc.json',
      ),
    ).toEqual(['data de linha em valor de domínio']);
    expect(
      motivos(
        perfil({ SEXO: { classe: 'dominio:F|M', valores: { F: 9, M: 8 }, distintos: 2 } }),
        'perfil-X.pc.json',
      ),
    ).toEqual([]);
  });

  it('correção do M21: o conselho (CRM*) nunca com valores no perfil, na assinatura, nos domínios e nos resultados', () => {
    const perfil = {
      formato: 1,
      tabela: 'RIALTA_EXCLUSAO',
      colunas: { CRMALTA: { classe: 'dominio:1|2', valores: { 1: 9 }, distintos: 2 } },
    };
    expect(motivos(perfil, 'perfil-RIALTA_EXCLUSAO.pc.json')).toEqual([
      'valores em coluna pessoal',
      'valor em coluna pessoal',
      'distintos em coluna pessoal',
    ]);
    expect(motivos(assinatura({ CRMEXECUTANTE: { classe: 'constante:1' } }))).toEqual([
      'valor em coluna pessoal',
    ]);
    expect(
      motivos(
        { formato: 1, grupo: 'internacao', colunas: { 'RIALTA_EXCLUSAO.CRMALTA': { valores: ['1'] } } },
        'dominios-vistos.json',
      ),
    ).toEqual(['domínio exportado de coluna pessoal']);
    const resultado = (esperado: string, obtido: string) => ({
      diferencas: [{ tipo: 'classe', elemento: 'RIALTA_EXCLUSAO:INSERT.colunas.CRMALTA', esperado, obtido }],
    });
    const arq = 'tools/assinatura/resultados/2026-10-22/internacao.cancelarAlta.pc.json';
    expect(motivos(resultado('dominio:1|2', 'constante:3'), arq)).toEqual([
      'valor em coluna pessoal no resultado',
    ]);
    expect(motivos(resultado('dominio:<omitido>', 'constante:<omitido>'), arq)).toEqual([]);
    const resumo = 'tools/assinatura/resultados/2026-10-22/resumo.internacao.cancelarAlta.txt';
    expect(
      motivos(
        '  DEFEITO classe: RIALTA_EXCLUSAO:INSERT.colunas.CRMALTA (esperado dominio:1|2; obtido constante:3)',
        resumo,
      ),
    ).toEqual(['valor em coluna pessoal no resultado']);
    expect(
      motivos(
        '  DEFEITO classe: RIALTA_EXCLUSAO:INSERT.colunas.CRMALTA (esperado dominio:<omitido>; obtido constante:<omitido>)',
        resumo,
      ),
    ).toEqual([]);
    expect(
      motivos('  DEFEITO classe: X:INSERT.colunas.TIPO (esperado dominio:1|2; obtido constante:3)', resumo),
    ).toEqual([]);
  });

  it('domínio exportado de coluna pessoal', () => {
    expect(
      motivos(
        { formato: 1, grupo: 'agenda', colunas: { 'SIPACAGD.EMAIL': { valores: ['a'] } } },
        'dominios-vistos.json',
      ),
    ).toEqual(['domínio exportado de coluna pessoal']);
  });

  it('metadados (impressão digital, datas de geração e de janela) não são dado de linha', () => {
    expect(
      motivos({
        impressaoSchema: '1234567890123456789012345678901234567890',
        geradoEm: '2026-10-19',
        janela: { inicio: '2025-10-01' },
      }),
    ).toEqual([]);
  });

  it('padrão de coocorrência (0 e 1) não é documento; fora dele, o mesmo texto é', () => {
    const perfil = {
      formato: 1,
      tabela: 'X',
      colunas: {},
      coocorrencia: { colunas: [], padroes: [{ padrao: '100000000000000', linhas: 9 }] },
    };
    expect(motivos(perfil, 'perfil-X.pc.json')).toEqual([]);
    expect(motivos({ x: '100000000000000' })).toContain('CNS');
  });

  it('contagem de 1 a 4 publicada como número (coocorrência, ligação, sentinela, valor) e coluna sensível na coocorrência', () => {
    const perfil = {
      formato: 1,
      tabela: 'X',
      colunas: {
        V: { classe: 'entrada', sentinelas: { zero: 2, '2099': '<5' }, valores: { A: 3, B: '<5', C: 9 } },
      },
      coocorrencia: {
        colunas: ['A', 'COR', 'DTOBITO'],
        padroes: [
          { padrao: '111', linhas: 9 },
          { padrao: '101', linhas: 1 },
          { padrao: 'outros', linhas: '<5' },
        ],
      },
      ligacoes: [
        { para: 'Y', total: 3, comCorrespondente: 0 },
        { para: 'Z', total: 90, comCorrespondente: 90 },
      ],
    };
    expect(motivos(perfil, 'perfil-X.pc.json').sort()).toEqual(
      [
        'contagem abaixo de 5 em valor',
        'contagem abaixo de 5 na coocorrência',
        'contagem abaixo de 5 na ligação',
        'contagem abaixo de 5 na sentinela',
        'coluna sensível na coocorrência',
        'coluna sensível na coocorrência',
      ].sort(),
    );
    expect(colunaRestrita(lista, 'FATORRH')).toBe(true);
    expect(colunaRestrita(lista, 'PS')).toBe(true);
    expect(colunaRestrita(lista, 'SOL_PLS')).toBe(true);
  });

  it('arquivos cobertos e colunas restritas', () => {
    expect(
      cobertoPelaRegra(
        'packages/legado/src/agenda/assinaturas/agenda.agendarExame/com-prontuario.assinatura.json',
      ),
    ).toBe(true);
    expect(
      cobertoPelaRegra('packages/legado/src/agenda/assinaturas/agenda.agendarExame/perfil-SIPACAGD.pc.json'),
    ).toBe(true);
    expect(cobertoPelaRegra('packages/legado/src/agenda/assinaturas/dominios-vistos.json')).toBe(true);
    expect(cobertoPelaRegra('tools/assinatura/resultados/2026-10-19/teste.sintetico.pc.json')).toBe(true);
    expect(cobertoPelaRegra('package.json')).toBe(false);
    expect(colunaRestrita(lista, 'NOME_MAE')).toBe(true);
    expect(colunaRestrita(lista, 'LIVRE')).toBe(false);
  });
});

describe('sem-pessoal: arquivos do repositório', () => {
  it('nenhum achado nas assinaturas, perfis, domínios e resultados versionados', () => {
    // O sante-sgh ainda não versiona captura (0 arquivos é válido); quando versionar, a lista real passa a ser exigida.
    const r = verificarRepositorio(raiz);
    expect(r.achados).toEqual([]);
  }, 30_000); // lê todos os arquivos versionados; passa dos 5 s com o portão em paralelo e a máquina carregada
});
