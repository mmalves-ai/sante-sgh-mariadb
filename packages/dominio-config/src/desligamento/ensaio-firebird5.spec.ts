import { esquemaRelatorioEnsaioFirebird5, type RelatorioEnsaioFirebird5 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarEtapasEnsaio,
  avaliarFuncoesEnsaio,
  compararContagens,
  ensaioAprovavel,
  estimarJanelaMinutos,
  explicarContagensCopiaCompartilhada,
  explicarDesvioSchema,
  objetoDoMotor,
  invalidosDaTroca,
  relatorioEnsaioVazio,
  motivoBibliotecaDoFornecedor,
  resolucaoProposta,
  resumoContagens,
  resumoContagensLegado,
  separarDesvioDoMotor,
  situacaoMedida,
  udfAccessLibera,
} from './ensaio-firebird5.js';

const vazio = () =>
  relatorioEnsaioVazio(
    'pc',
    '2026-10-26',
    { versaoMotor: '3.0.14', ods: '12.0' },
    { versaoMotor: '5.0.3', ods: '13.1' },
  );

/** Um ensaio inteiro aprovado (sintético), para cada teste estragar uma parte. */
function aprovado(): RelatorioEnsaioFirebird5 {
  const r = vazio();
  const ok = { situacao: 'aprovada' as const, bloqueio: null, observacao: null };
  const c = compararContagens({ A: 1, B: 2 }, { A: 1, B: 2 });
  const h = 'a'.repeat(64);
  return {
    ...r,
    etapas: {
      backup: { ...ok, segundos: 1200, bytes: 30 },
      restauracao: { ...ok, segundos: 2400, integridadeOk: true, verificacaoSegundos: 300 },
      contagens: {
        ...ok,
        segundos: 900,
        ...c,
        copiaMoveu: false,
        scriptsOrigem: 0,
        scriptsAlvo: 0,
        posterioresSgh: [],
        hashLegadoAntes: null,
        hashLegadoDepois: null,
      },
      objetos: { ...ok, gatilhos: 2538, procedures: 181, invalidos: [], invalidosNaOrigem: [] },
      'funcoes-externas': {
        ...ok,
        udfAccess: 'Restrict UDF',
        funcoes: avaliarFuncoesEnsaio([
          {
            nome: 'RTRIM',
            modulo: 'ib_udf',
            bibliotecaPresente: true,
            chamadaOk: true,
            dependentes: 3,
            dependentesValidos: 3,
          },
        ]),
      },
      driver: { ...ok, conectou: true, autenticacao: 'Srp256', canalCifrado: true },
      schema: { ...ok, impressaoHomologada: h, impressaoEnsaio: h, diferencas: [] },
      assinaturas: {
        ...ok,
        operacoes: 40,
        cenarios: 120,
        diferencas: 0,
        relatorio: 'firebird5.md',
        iguaisAo3: 0,
        operacoesComDiferenca: [],
        gatilhosACorrigir: [],
      },
      carga: { ...ok, slosAtendidos: true },
      'sante-api': { ...ok, contratosQuebrados: 0, referencia: 'verificação do provedor' },
      parceiros: { ...ok, alvos: [{ alvo: 'V_FIRST_', objetos: 25, lidosSemErro: 25, avisado: true }] },
      'volta-atras': { ...ok, segundos: 2000 },
      'restauracao-isolada': { ...ok, integridadeOk: true },
    },
  };
}

describe('contagens por tabela (prova da restauração)', () => {
  it('iguais: mesmo resumo; o resumo não depende da ordem das chaves', () => {
    const c = compararContagens({ B: 2, A: 1 }, { A: 1, B: 2 });
    expect(c).toMatchObject({ tabelas: 2, iguais: 2, diferentes: [], ausentes: [] });
    expect(c.hashAntes).toBe(c.hashDepois);
    expect(resumoContagens({ A: 1, B: 2 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('linha a mais ou a menos e tabela de um lado só aparecem pelos nomes', () => {
    const c = compararContagens({ A: 1, B: 2, C: 0 }, { A: 1, B: 3, D: 0 });
    expect(c.diferentes).toEqual(['B']);
    expect(c.ausentes).toEqual(['C', 'D']);
    expect(c.iguais).toBe(1);
    expect(c.hashAntes).not.toBe(c.hashDepois);
  });
});

describe('gatilhos e procedures recompilados', () => {
  it('só o inválido novo é da troca do motor', () => {
    expect(invalidosDaTroca(['TRG_X'], ['TRG_X', 'TRG_Y'])).toEqual(['TRG_Y']);
    expect(invalidosDaTroca([], [])).toEqual([]);
  });
});

describe('funções externas (regra 5)', () => {
  const f = {
    nome: 'SUBSTR',
    modulo: 'ib_udf',
    bibliotecaPresente: true,
    chamadaOk: true,
    dependentes: 45,
    dependentesValidos: 45,
  };
  it('biblioteca, chamada e dependentes válidos ⇒ habilitada por configuração', () => {
    expect(resolucaoProposta(f)).toBe('habilitada-por-configuracao');
  });
  it('sem biblioteca (a do fornecedor), sem chamada ou com dependente inválido ⇒ pendente', () => {
    expect(resolucaoProposta({ ...f, bibliotecaPresente: false })).toBe('pendente');
    expect(resolucaoProposta({ ...f, chamadaOk: null })).toBe('pendente');
    expect(resolucaoProposta({ ...f, chamadaOk: false })).toBe('pendente');
    expect(resolucaoProposta({ ...f, dependentesValidos: 44 })).toBe('pendente');
  });
  it('sem dependente no banco e sem biblioteca segue pendente, com o motivo da declaração (D-VLR-MED-58.2)', () => {
    const v = {
      ...f,
      nome: 'VLR_MED',
      modulo: 'vlr_med',
      bibliotecaPresente: false,
      chamadaOk: false,
      dependentes: 0,
      dependentesValidos: 0,
    };
    expect(resolucaoProposta(v)).toBe('pendente');
    const m = motivoBibliotecaDoFornecedor([v]);
    expect(m).toContain('VLR_MED (declarada no banco, 0 dependentes');
    expect(m).not.toMatch(/gatilho/i);
    expect(motivoBibliotecaDoFornecedor([{ ...v, nome: 'X', dependentes: 2 }])).toContain(
      'X (2 dependentes no banco)',
    );
  });
  it('ordena por nome e o UdfAccess só libera com Restrict UDF ou Full', () => {
    expect(avaliarFuncoesEnsaio([{ ...f, nome: 'VLR_MED' }, f]).map((x) => x.nome)).toEqual([
      'SUBSTR',
      'VLR_MED',
    ]);
    expect(udfAccessLibera('Restrict UDF')).toBe(true);
    expect(udfAccessLibera('Full')).toBe(true);
    expect(udfAccessLibera('None')).toBe(false);
    expect(udfAccessLibera('Restrict UDR')).toBe(false);
  });
});

describe('desvio da impressão digital', () => {
  it('sem diferença: explicado; ausente ou novo nunca se explica', () => {
    expect(explicarDesvioSchema([], [])).toEqual([]);
    expect(
      explicarDesvioSchema([{ categoria: 'triggers', ausentes: 1, novos: 1, alterados: 0, nomes: [] }], []),
    ).toEqual(['schema-ausentes:triggers', 'schema-novos:triggers']);
  });
  it('função alterada só se explica quando é uma substituída', () => {
    const d = [{ categoria: 'funcoes', ausentes: 0, novos: 0, alterados: 1, nomes: ['RTRIM'] }];
    expect(explicarDesvioSchema(d, ['RTRIM'])).toEqual([]);
    expect(explicarDesvioSchema(d, [])).toEqual(['schema-alterados:funcoes']);
    expect(
      explicarDesvioSchema(
        [{ categoria: 'tabelas', ausentes: 0, novos: 0, alterados: 1, nomes: ['RTRIM'] }],
        ['RTRIM'],
      ),
    ).toEqual(['schema-alterados:tabelas']);
  });
});

describe('janela (regra 4)', () => {
  it('soma × 1,5 arredondada para cima em blocos de 15 minutos', () => {
    expect(estimarJanelaMinutos(1200, 2400, 600)).toBe(105); // 70 min × 1,5 = 105
    expect(estimarJanelaMinutos(60, 60, null)).toBe(15);
    expect(estimarJanelaMinutos(1210, 2400, 600)).toBe(120);
  });
  it('sem backup ou sem restauração medidos não há janela', () => {
    expect(estimarJanelaMinutos(null, 10, 10)).toBeNull();
    expect(estimarJanelaMinutos(10, null, 10)).toBeNull();
  });
});

describe('avaliação das etapas (falha fechada)', () => {
  it('o relatório vazio é válido, não aprovável, com todas as etapas não executadas', () => {
    const r = vazio();
    expect(esquemaRelatorioEnsaioFirebird5.safeParse(r).success).toBe(true);
    const e = avaliarEtapasEnsaio(r);
    expect(e).toHaveLength(13);
    expect(e.every((x) => x.situacao === 'nao-executada')).toBe(true);
    expect(ensaioAprovavel(e)).toBe(false);
  });

  it('o ensaio inteiro aprovado é aprovável e passa no esquema', () => {
    const r = aprovado();
    expect(esquemaRelatorioEnsaioFirebird5.safeParse(r).success).toBe(true);
    const e = avaliarEtapasEnsaio(r);
    expect(e.filter((x) => x.situacao !== 'aprovada')).toEqual([]);
    expect(ensaioAprovavel(e)).toBe(true);
  });

  it('"aprovada" que os números não sustentam vira reprovada, com o achado', () => {
    const r = aprovado();
    const casos: [keyof RelatorioEnsaioFirebird5['etapas'], (x: RelatorioEnsaioFirebird5) => void, string][] =
      [
        [
          'contagens',
          (x) => void (x.etapas.contagens = { ...x.etapas.contagens, diferentes: ['A'] }),
          'contagens-diferentes',
        ],
        [
          'objetos',
          (x) => void (x.etapas.objetos = { ...x.etapas.objetos, invalidos: ['TRG_Y'] }),
          'objetos-invalidos',
        ],
        [
          'funcoes-externas',
          (x) => void (x.etapas['funcoes-externas'] = { ...x.etapas['funcoes-externas'], udfAccess: 'None' }),
          'udf-access-fechado',
        ],
        [
          'assinaturas',
          (x) => void (x.etapas.assinaturas = { ...x.etapas.assinaturas, diferencas: 1 }),
          'assinaturas-diferentes',
        ],
        [
          'sante-api',
          (x) => void (x.etapas['sante-api'] = { ...x.etapas['sante-api'], contratosQuebrados: null }),
          'contratos-nao-verdes',
        ],
        [
          'parceiros',
          (x) =>
            void (x.etapas.parceiros = {
              ...x.etapas.parceiros,
              alvos: [{ alvo: 'V_FIRST_', objetos: 2, lidosSemErro: 1, avisado: true }],
            }),
          'parceiro-com-erro:V_FIRST_',
        ],
        [
          'schema',
          (x) =>
            void (x.etapas.schema = {
              ...x.etapas.schema,
              diferencas: [
                { categoria: 'triggers', ausentes: 0, novos: 0, alterados: 2, nomes: [], doMotor: 0 },
              ],
            }),
          'schema-alterados:triggers',
        ],
      ];
    for (const [etapa, estragar, achado] of casos) {
      const x = structuredClone(r);
      estragar(x);
      const e = avaliarEtapasEnsaio(x).find((y) => y.etapa === etapa);
      expect(e?.situacao, etapa).toBe('reprovada');
      expect(e?.achados, etapa).toContain(achado);
      expect(situacaoMedida(x, etapa)).toBe('reprovada');
    }
    expect(situacaoMedida(r, 'contagens')).toBe('aprovada');
  });

  it('a bloqueada exige o motivo, e só ela', () => {
    const r = vazio();
    r.etapas.carga = { ...r.etapas.carga, situacao: 'bloqueada' };
    expect(esquemaRelatorioEnsaioFirebird5.safeParse(r).success).toBe(false);
    r.etapas.carga = { ...r.etapas.carga, bloqueio: 'equipe-hal-ai' };
    expect(esquemaRelatorioEnsaioFirebird5.safeParse(r).success).toBe(true);
    r.etapas.backup = { ...r.etapas.backup, bloqueio: 'parceiro' };
    expect(esquemaRelatorioEnsaioFirebird5.safeParse(r).success).toBe(false);
  });

  it('texto com dado pessoal é recusado no relatório', () => {
    const r = vazio();
    r.etapas.backup = { ...r.etapas.backup, observacao: 'prontuário 123456' };
    expect(esquemaRelatorioEnsaioFirebird5.safeParse(r).success).toBe(false);
  });
});

describe('cópia de dev compartilhada que andou depois do backup (contagens)', () => {
  const sc = (...ns: number[]) => ns.map((numero) => ({ numero, hash: `h${numero}` }));
  const antes = { TBPACIENTE: 10, SGH_TRILHA: 7, SGH_NOVA: 0 };
  const depois = { TBPACIENTE: 10, SGH_TRILHA: 5 };

  it('registro da restaurada contido no da origem (menos scripts, mesmos hashes): SGH_ divergente não reprova', () => {
    const c = compararContagens(antes, depois);
    const mov = explicarContagensCopiaCompartilhada(c, ['SGH_NOVA'], sc(1, 2, 580), sc(1, 580));
    expect(mov).toEqual({ copiaMoveu: true, posterioresSgh: ['SGH_NOVA', 'SGH_TRILHA'] });
    const r = aprovado();
    r.etapas.contagens = {
      ...r.etapas.contagens,
      ...c,
      ...mov,
      hashLegadoAntes: resumoContagensLegado(antes),
      hashLegadoDepois: resumoContagensLegado(depois),
    };
    expect(avaliarEtapasEnsaio(r).find((e) => e.etapa === 'contagens')?.achados).toEqual([]);
  });

  it('tabela do banco de origem divergente reprova mesmo com a cópia andando', () => {
    const d2 = { ...depois, TBPACIENTE: 11 };
    const c = compararContagens(antes, d2);
    const mov = explicarContagensCopiaCompartilhada(c, ['SGH_NOVA'], sc(1, 2), sc(1));
    const r = aprovado();
    r.etapas.contagens = {
      ...r.etapas.contagens,
      ...c,
      ...mov,
      hashLegadoAntes: resumoContagensLegado(antes),
      hashLegadoDepois: resumoContagensLegado(d2),
    };
    expect(avaliarEtapasEnsaio(r).find((e) => e.etapa === 'contagens')?.achados).toEqual([
      'contagens-diferentes',
      'resumo-diferente',
    ]);
  });

  it('sem prova de que a cópia andou (mesmo registro, hash diferente ou alvo com script a mais): vale tudo', () => {
    const c = compararContagens(antes, depois);
    expect(explicarContagensCopiaCompartilhada(c, [], sc(1, 2), sc(1, 2)).copiaMoveu).toBe(false);
    expect(
      explicarContagensCopiaCompartilhada(c, [], sc(1, 2), [{ numero: 1, hash: 'outro' }]).copiaMoveu,
    ).toBe(false);
    expect(explicarContagensCopiaCompartilhada(c, [], sc(1, 2), sc(1, 3)).copiaMoveu).toBe(false);
    expect(explicarContagensCopiaCompartilhada(c, [], sc(1), [])).toEqual({
      copiaMoveu: false,
      posterioresSgh: [],
    });
    const r = aprovado();
    r.etapas.contagens = { ...r.etapas.contagens, ...c, copiaMoveu: false, posterioresSgh: ['SGH_TRILHA'] };
    expect(avaliarEtapasEnsaio(r).find((e) => e.etapa === 'contagens')?.achados).toEqual([
      'contagens-diferentes',
      'tabelas-ausentes',
      'resumo-diferente',
    ]);
  });
});

describe('desvio da impressão no catálogo do próprio motor', () => {
  it('tabelas de sistema novas da versão 5 vão a doMotor e não reprovam; objeto do banco reprova', () => {
    expect(objetoDoMotor('RDB$PUBLICATIONS:UNIQUE()')).toBe(true);
    expect(objetoDoMotor('MON$COMPILED_STATEMENTS')).toBe(true);
    expect(objetoDoMotor('TBPACIENTE:PK')).toBe(false);
    const d = separarDesvioDoMotor('restricoes', {
      ausentes: [],
      novos: [
        'RDB$BACKUP_HISTORY:UNIQUE()#2',
        'RDB$PUBLICATIONS:UNIQUE()',
        'RDB$PUBLICATION_TABLES:UNIQUE()',
      ],
      alterados: [],
    });
    expect(d).toEqual({
      categoria: 'restricoes',
      ausentes: 0,
      novos: 0,
      alterados: 0,
      nomes: [],
      doMotor: 3,
    });
    expect(explicarDesvioSchema([d], [])).toEqual([]);
    const d2 = separarDesvioDoMotor('restricoes', {
      ausentes: [],
      novos: ['RDB$X', 'TBX_FK'],
      alterados: [],
    });
    expect(d2).toMatchObject({ novos: 1, doMotor: 1, nomes: ['TBX_FK'] });
    expect(explicarDesvioSchema([d2], [])).toEqual(['schema-novos:restricoes']);
  });
});

describe('assinaturas com diferença do motor explicada por gatilho do banco', () => {
  it('o achado nomeia o gatilho a corrigir; sem diferença do motor, nenhum achado', () => {
    const r = aprovado();
    r.etapas.assinaturas = {
      ...r.etapas.assinaturas,
      diferencas: 14,
      iguaisAo3: 60,
      operacoesComDiferenca: ['sadt.registrarResultado'],
      gatilhosACorrigir: ['TRG_SIRES01_AIU'],
    };
    expect(avaliarEtapasEnsaio(r).find((e) => e.etapa === 'assinaturas')).toMatchObject({
      situacao: 'reprovada',
      achados: ['assinaturas-diferentes', 'gatilho-a-corrigir:TRG_SIRES01_AIU'],
    });
    r.etapas.assinaturas = { ...r.etapas.assinaturas, diferencas: 0 };
    expect(avaliarEtapasEnsaio(r).find((e) => e.etapa === 'assinaturas')?.achados).toEqual([]);
  });
});
