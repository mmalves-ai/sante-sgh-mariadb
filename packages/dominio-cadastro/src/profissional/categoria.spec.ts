// Casos de sante-api: test/medico-cadastro.test.js (categoria pelo CBO, não pela sigla), com códigos da CBO.
import { describe, expect, it } from 'vitest';
import {
  categoriaDoProfissional,
  categoriaPorCbo,
  ehSentinelaProfissional,
  ehSentinelaRegistro,
  prefixosDaCategoria,
  profissionalAtivo,
  registroAtivo,
} from './categoria.js';
import { CATEGORIAS_PROFISSIONAL } from '@sgh/contratos';

describe('categoria pelo CBO (regra 10)', () => {
  it('225 é médico; enfermagem, odontologia, farmácia e demais', () => {
    expect(categoriaPorCbo('225125')).toBe('medico');
    expect(categoriaPorCbo('2251-25')).toBe('medico');
    expect(categoriaPorCbo('223505')).toBe('enfermagem');
    expect(categoriaPorCbo('322205')).toBe('enfermagem');
    expect(categoriaPorCbo('223208')).toBe('odontologia');
    expect(categoriaPorCbo('223405')).toBe('farmacia');
    expect(categoriaPorCbo('223605')).toBe('outros-saude');
    expect(categoriaPorCbo('251510')).toBe('outros');
    expect(categoriaPorCbo(null)).toBe('outros');
    expect(categoriaPorCbo('22')).toBe('outros');
  });
  it('o médico vence entre os registros ativos; sem ativo, todos contam', () => {
    expect(
      categoriaDoProfissional([
        { cbo: '223505', ativo: true },
        { cbo: '225125', ativo: true },
      ]),
    ).toBe('medico');
    expect(
      categoriaDoProfissional([
        { cbo: '225125', ativo: false },
        { cbo: '223505', ativo: true },
      ]),
    ).toBe('enfermagem');
    expect(categoriaDoProfissional([{ cbo: '225125', ativo: false }])).toBe('medico');
    expect(categoriaDoProfissional([])).toBe('outros');
  });
  it('atividade real pelo registro (T, F, nulo) e sentinelas fora das listas', () => {
    expect(registroAtivo('T')).toBe(true);
    expect(registroAtivo('F ')).toBe(false);
    expect(registroAtivo(null)).toBeNull();
    expect(profissionalAtivo([{ ativo: null }, { ativo: true }])).toBe(true);
    expect(profissionalAtivo([{ ativo: false }])).toBe(false);
    expect(ehSentinelaProfissional(1)).toBe(true);
    expect(ehSentinelaProfissional(3)).toBe(false);
    expect(ehSentinelaRegistro(488)).toBe(true);
  });
});

describe('prefixos da categoria (M15: filtro da lista de registros)', () => {
  it('um CBO casa os prefixos da categoria exatamente quando categoriaPorCbo dá a categoria', () => {
    const cbos = [
      '225125',
      '225250',
      '223505',
      '322205',
      '223208',
      '322405',
      '223405',
      '325115',
      '223605',
      '224140',
      '324205',
      '322505',
      '252105',
      '411010',
      '999999',
    ];
    for (const cbo of cbos)
      for (const c of CATEGORIAS_PROFISSIONAL) {
        const p = prefixosDaCategoria(c);
        const casa =
          (p.incluir.length === 0 || p.incluir.some((x) => cbo.startsWith(x))) &&
          !p.excluir.some((x) => cbo.startsWith(x));
        expect(casa, `${cbo} ${c}`).toBe(categoriaPorCbo(cbo) === c);
      }
  });
});
