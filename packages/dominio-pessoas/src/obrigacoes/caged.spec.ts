// M53-F7: o arquivo do CAGED (240 posições; admissão e desligamento do mês; pendências). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { CPF, ficha } from '../esocial/fixtures-esocial.spec-util.js';
import { type EntradaCaged, LEIAUTE_CAGED, montarCaged, pendenciasCaged } from './caged.js';
import { admissaoCaged, admissaoRais, instrucaoRaisCaged, vinculoRais } from './correspondencias.js';
import { catalogos, empresa, NIS, trab } from './fixtures-obrigacoes.spec-util.js';
import { campoDaLinha, tamanhoDoLeiaute } from './leiaute-fixo.js';

const entrada = (over: Partial<EntradaCaged> = {}): EntradaCaged => ({
  competencia: '2019-05',
  empresa,
  movimentados: [
    trab({
      vinculo: 7,
      admissao: '2019-05-06',
      desligamento: '2019-05-31',
      modalidadeRescisao: 'termino-contrato',
    }),
    trab({ vinculo: 3, admissao: '2019-05-13' }),
  ],
  empregadosPrimeiroDia: 120,
  catalogos,
  ...over,
});

describe('leiaute do CAGED', () => {
  it('registros de 240 posições', () => {
    for (const l of Object.values(LEIAUTE_CAGED)) expect(tamanhoDoLeiaute(l)).toBe(240);
  });

  it('A, B e um C por movimento (admitido e desligado no mês: dois)', () => {
    const a = montarCaged(entrada());
    expect(a.nomeArquivo).toBe('CGED052019.txt');
    const ls = a.conteudo.split('\r\n').filter(Boolean);
    expect(ls.map((l) => l[0])).toEqual(['A', 'B', 'C', 'C', 'C']);
    for (const l of ls) expect(l).toHaveLength(240);
    const L = LEIAUTE_CAGED;
    expect(campoDaLinha(L.A, ls[0]!, 'competencia')).toBe('052019');
    expect(campoDaLinha(L.A, ls[0]!, 'movimentacoes')).toBe('00003');
    expect(campoDaLinha(L.A, ls[0]!, 'ddd')).toBe('0031');
    expect(campoDaLinha(L.B, ls[1]!, 'empregadosPrimeiroDia')).toBe('00120');
    expect(campoDaLinha(L.C, ls[2]!, 'movimento')).toBe('20');
    expect(campoDaLinha(L.C, ls[2]!, 'nis')).toBe(NIS);
    expect(campoDaLinha(L.C, ls[2]!, 'sexo')).toBe('2');
    expect(campoDaLinha(L.C, ls[2]!, 'racaCor')).toBe('8');
    expect(campoDaLinha(L.C, ls[2]!, 'instrucao')).toBe('09');
    expect(campoDaLinha(L.C, ls[2]!, 'salario')).toBe('00300000');
    expect(campoDaLinha(L.C, ls[2]!, 'cpf')).toBe(CPF);
    expect(campoDaLinha(L.C, ls[3]!, 'movimento')).toBe('20');
    expect(campoDaLinha(L.C, ls[4]!, 'movimento')).toBe('43');
    expect(campoDaLinha(L.C, ls[4]!, 'diaDesligamento')).toBe('31');
    expect(campoDaLinha(L.C, ls[3]!, 'sequencia')).toBe('00004');
  });

  it('aprendiz, sem salário e sem CPF: zeros', () => {
    const a = montarCaged(
      entrada({
        movimentados: [
          trab({
            admissao: '2019-05-02',
            salario: null,
            cpf: null,
            ficha: { ...ficha, nis: NIS, categoria: '103', racaCor: 9 as never },
          }),
        ],
      }),
    );
    const c = a.conteudo.split('\r\n')[2]!;
    expect(campoDaLinha(LEIAUTE_CAGED.C, c, 'aprendiz')).toBe('1');
    expect(campoDaLinha(LEIAUTE_CAGED.C, c, 'salario')).toBe('0'.repeat(8));
    expect(campoDaLinha(LEIAUTE_CAGED.C, c, 'cpf')).toBe('0'.repeat(11));
    expect(campoDaLinha(LEIAUTE_CAGED.C, c, 'racaCor')).toBe('9');
  });
});

describe('pendências do CAGED e correspondências', () => {
  it('ficha, NIS, CBO, desligamento sem rescisão e código fora do catálogo', () => {
    expect(pendenciasCaged(entrada())).toEqual([]);
    const ps = pendenciasCaged(
      entrada({
        movimentados: [
          trab({ vinculo: 1, ficha: null }),
          trab({ vinculo: 2, admissao: '2019-05-02', ficha: { ...ficha, nis: null, cboCargo: null } }),
          trab({ vinculo: 3, desligamento: '2019-05-10', modalidadeRescisao: null }),
          trab({ vinculo: 4, desligamento: '2019-05-10', modalidadeRescisao: 'falecimento' }),
          trab({ vinculo: 5, admissao: '2019-05-02', ficha: { ...ficha, nis: NIS, tipoAdmissao: 2 } }),
        ],
        catalogos: { ...catalogos, desligamentosCaged: new Set(['31']), admissoesCaged: new Set(['20']) },
      }),
    );
    expect(ps.map((p) => [p.codigo, p.vinculos])).toEqual([
      ['sem-ficha', [1]],
      ['sem-nis', [2]],
      ['sem-cbo', [2]],
      ['categoria-sem-correspondencia', [3]],
      ['codigo-fora-do-catalogo', [4, 5]],
    ]);
  });

  it('admissão (transferência, prazo, reemprego), vínculo da RAIS e instrução', () => {
    expect(admissaoCaged({ tipoAdmissao: 3, tipoContrato: 1 })).toBe('70');
    expect(admissaoCaged({ tipoAdmissao: 1, tipoContrato: 2 })).toBe('25');
    expect(admissaoCaged({ tipoAdmissao: 1, tipoContrato: 1 })).toBe('20');
    expect(admissaoRais({ tipoAdmissao: 4 })).toBe('3');
    expect(admissaoRais({ tipoAdmissao: 1 })).toBe('2');
    expect(vinculoRais({ categoria: '101', tipoContrato: 1 })).toBe('10');
    expect(vinculoRais({ categoria: '111', tipoContrato: 2 })).toBe('60');
    expect(vinculoRais({ categoria: '103', tipoContrato: 2 })).toBe('55');
    expect(vinculoRais({ categoria: '105', tipoContrato: 2 })).toBe('90');
    expect(vinculoRais({ categoria: '106', tipoContrato: 2 })).toBe('50');
    expect(vinculoRais({ categoria: '901', tipoContrato: 2 })).toBeNull();
    expect(['01', '09', '10', '11', '12'].map(instrucaoRaisCaged)).toEqual(['1', '9', '9', '10', '11']);
  });
});
