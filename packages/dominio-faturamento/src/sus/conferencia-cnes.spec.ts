import { describe, expect, it } from 'vitest';
import { conferirComCadastroNacional, resumoCriticasCnes } from './conferencia-cnes.js';

const COMP = '2026-10-01';
const local = {
  codigoCnes: '9999991',
  cnpj: '00.000.000/0001-91',
  habilitacoes: ['2601', '0801'],
  servicos: [
    { servico: '121', classificacao: '001' },
    { servico: '145', classificacao: '2' },
  ],
};
const oficial = {
  estabelecimento: { cnpj: '00000000000191', razaoSocial: 'Hospital sintético' },
  habilitacoes: [
    { codigo: '2601', competenciaInicio: '2015-01-01', competenciaFim: null },
    { codigo: '801', competenciaInicio: '2020-01-01', competenciaFim: null },
  ],
  servicos: [
    { servico: '121', classificacao: '1' },
    { servico: '145', classificacao: '002' },
  ],
  leitos: [],
};

describe('conferirComCadastroNacional', () => {
  it('cadastro igual à base oficial: nenhuma crítica (códigos normalizados)', () => {
    expect(conferirComCadastroNacional(local, oficial, COMP)).toEqual([]);
  });

  it('sem número nacional no estabelecimento: um erro e nada mais', () => {
    const c = conferirComCadastroNacional({ ...local, codigoCnes: null }, oficial, COMP);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ categoria: 'estabelecimento', gravidade: 'erro' });
  });

  it('ausente da base da competência: erro do estabelecimento', () => {
    const c = conferirComCadastroNacional(local, { ...oficial, estabelecimento: null }, COMP);
    expect(c).toEqual([expect.objectContaining({ categoria: 'estabelecimento', gravidade: 'erro' })]);
  });

  it('divergências: só local é erro, só oficial é alerta, CNPJ diferente é alerta, leitos são informação', () => {
    const c = conferirComCadastroNacional(
      { ...local, cnpj: '11111111000111', habilitacoes: ['2601', '1901'] },
      {
        ...oficial,
        habilitacoes: [
          ...oficial.habilitacoes,
          { codigo: '2602', competenciaInicio: '2015-01-01', competenciaFim: '2026-09-01' },
        ],
        servicos: [
          { servico: '121', classificacao: '001' },
          { servico: '999', classificacao: '001' },
        ],
        leitos: [
          { quantidadeExistente: 10, quantidadeSus: 8 },
          { quantidadeExistente: 5, quantidadeSus: 5 },
        ],
      },
      COMP,
    );
    const m = c.map((x) => `${x.categoria}:${x.gravidade}:${x.mensagem.slice(0, 40)}`);
    expect(m).toEqual([
      'estabelecimento:alerta:O CNPJ do cadastro local é diferente do ',
      'estabelecimento:erro:Habilitação 1901 vigente no cadastro loc',
      'estabelecimento:alerta:Habilitação 0801 da base oficial ausente',
      'servico:erro:Serviço e classificação 145/002 no cadas',
      'servico:alerta:Serviço e classificação 999/001 da base ',
      'leito:informacao:Base oficial: 15 leitos existentes, 13 p',
    ]);
    expect(resumoCriticasCnes(c)).toEqual({ erro: 2, alerta: 3, informacao: 1 });
  });

  it('competência fora do formato é recusada', () => {
    expect(() => conferirComCadastroNacional(local, oficial, '2026-10')).toThrow();
  });
});
