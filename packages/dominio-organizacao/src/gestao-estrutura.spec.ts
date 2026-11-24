import { describe, expect, it } from 'vitest';
import {
  cnpjConfere,
  errosEstabelecimento,
  errosInativarSetor,
  errosRamais,
  errosSetor,
  errosUnidade,
  formaCiclo,
  ramalPrincipal,
} from './gestao-estrutura.js';

// CNPJ sintético válido pelos dígitos verificadores (nenhuma empresa real é usada).
const CNPJ_OK = '11222333000181';

const setor = {
  codigo: 'UTI-A',
  nome: 'UTI adulto',
  sigla: 'UTIA',
  tipo: 'assistencial',
  centroCusto: 10,
  responsavel: null,
  responsavelInicio: null,
  responsavelFim: null,
  aceitaLancamentoConta: true,
  producaoFaturada: false,
  podeSolicitarExames: true,
  exigeProfissionalAgendamento: false,
  exigeRecursoAgendamento: false,
  siglaAgendamento: null,
};

describe('estabelecimento e unidade', () => {
  it('confere os dígitos do CNPJ', () => {
    expect(cnpjConfere(CNPJ_OK)).toBe(true);
    expect(cnpjConfere('11222333000182')).toBe(false);
    expect(cnpjConfere('11111111111111')).toBe(false);
  });
  it('devolve todos os erros do estabelecimento de uma vez', () => {
    expect(
      errosEstabelecimento({
        razaoSocial: 'x',
        nomeFantasia: 'H',
        cnpj: '11222333000182',
        cnes: '12',
        cep: '1234',
        email: 'sem-arroba',
        inicioAtividade: '2026-02-01',
        fimAtividade: '2026-01-01',
      }),
    ).toEqual([
      'razao-social-vazia',
      'nome-fantasia-vazio',
      'cnpj-invalido',
      'cnes-invalido',
      'cep-invalido',
      'email-invalido',
      'atividade-invertida',
    ]);
    expect(
      errosEstabelecimento({
        razaoSocial: 'Hospital Sintético SA',
        nomeFantasia: 'Hospital',
        cnpj: CNPJ_OK,
        cnes: '1234567',
        cep: '01001000',
        email: 'a@b.com',
        inicioAtividade: null,
        fimAtividade: null,
      }),
    ).toEqual([]);
  });
  it('unidade: código, tipo e documentos', () => {
    expect(
      errosUnidade({ codigo: 'AMB 1', nome: 'A', tipo: 'loja', cnes: null, cnpj: null, cep: null }),
    ).toEqual(['codigo-invalido', 'nome-vazio', 'tipo-unidade-invalido']);
    expect(
      errosUnidade({
        codigo: 'AMB1',
        nome: 'Ambulatório',
        tipo: 'ambulatorio',
        cnes: '7654321',
        cnpj: CNPJ_OK,
        cep: null,
      }),
    ).toEqual([]);
  });
});

describe('setor', () => {
  it('aceita o setor completo', () => {
    expect(errosSetor(setor)).toEqual([]);
  });
  it('lançamento na conta exige centro de custo; responsável exige início; agendamento exige sigla', () => {
    expect(
      errosSetor({
        ...setor,
        centroCusto: null,
        responsavel: 5,
        exigeProfissionalAgendamento: true,
      }),
    ).toEqual(['lancamento-sem-centro-custo', 'responsavel-sem-inicio', 'agendamento-sem-sigla']);
    expect(
      errosSetor({ ...setor, responsavel: 5, responsavelInicio: '2026-02-01', responsavelFim: '2026-01-01' }),
    ).toEqual(['responsavel-vigencia-invertida']);
    expect(errosSetor({ ...setor, responsavelInicio: '2026-02-01' })).toEqual(['vigencia-sem-responsavel']);
    expect(errosSetor({ ...setor, tipo: 'logistico' })).toEqual(['logistico-solicita-exame']);
  });
  it('detecta ciclo na árvore', () => {
    const sup = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
    ]);
    expect(formaCiclo(1, 3, sup)).toBe(true);
    expect(formaCiclo(2, 2, sup)).toBe(true);
    expect(formaCiclo(3, 1, sup)).toBe(false);
    expect(formaCiclo(null, 1, sup)).toBe(false);
  });
  it('inativar só sem filhos ativos e não antes da criação', () => {
    expect(errosInativarSetor({ filhosAtivos: 2, data: '2026-01-01', criadoEm: '2026-02-01' })).toEqual([
      'setor-com-filhos-ativos',
      'inativacao-antes-da-criacao',
    ]);
    expect(errosInativarSetor({ filhosAtivos: 0, data: '2026-03-01', criadoEm: '2026-02-01' })).toEqual([]);
  });
});

describe('ramais', () => {
  const r = (
    ramal: string,
    principal = false,
    responsavel = false,
    telefoneExterno: string | null = null,
  ) => ({
    ramal,
    contato: null,
    principal,
    responsavel,
    telefoneExterno,
  });
  it('confere formato, repetição e marcas únicas', () => {
    expect(
      errosRamais([r('1'), r('2001', true), r('2001', true, true), r('2002', false, true, '123')]),
    ).toEqual([
      'ramal-invalido',
      'ramal-repetido',
      'telefone-invalido',
      'mais-de-um-principal',
      'mais-de-um-responsavel',
    ]);
    expect(errosRamais([r('2001'), r('2002', true, false, '1133334444')])).toEqual([]);
  });
  it('ramal principal: o marcado ou o primeiro', () => {
    expect(ramalPrincipal([r('2001'), r('2002', true)])).toBe('2002');
    expect(ramalPrincipal([r('2001'), r('2002')])).toBe('2001');
    expect(ramalPrincipal([])).toBeNull();
  });
});
