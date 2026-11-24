import { describe, expect, it } from 'vitest';
import {
  cnpjConfere,
  errosEstabelecimento,
  errosInativarSetor,
  errosRamais,
  errosSetor,
  errosTrocaResponsavel,
  errosUnidade,
  formaCiclo,
  planoResponsavel,
  ramalPrincipal,
  vespera,
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
    const livre = {
      filhosAtivos: 0,
      leitosAtivos: 0,
      pacientesNoLeito: 0,
      atendimentosAbertos: 0,
      hoje: '2026-06-01',
      criadoEm: '2026-02-01',
    };
    expect(errosInativarSetor({ ...livre, filhosAtivos: 2, data: '2026-01-01' })).toEqual([
      'setor-com-filhos-ativos',
      'inativacao-antes-da-criacao',
    ]);
    expect(errosInativarSetor({ ...livre, data: '2026-03-01' })).toEqual([]);
    expect(errosInativarSetor({ ...livre, data: '2026-06-01' })).toEqual([]);
  });
  it('recusa inativar com uso vivo, um erro por tipo, e com data futura', () => {
    const base = { filhosAtivos: 0, hoje: '2026-06-01', criadoEm: '2026-02-01', data: '2026-06-01' };
    expect(
      errosInativarSetor({ ...base, leitosAtivos: 4, pacientesNoLeito: 1, atendimentosAbertos: 3 }),
    ).toEqual([
      'setor-com-leitos-ativos',
      'setor-com-pacientes-internados',
      'setor-com-atendimentos-abertos',
    ]);
    expect(
      errosInativarSetor({
        ...base,
        leitosAtivos: 0,
        pacientesNoLeito: 0,
        atendimentosAbertos: 0,
        data: '2026-06-02',
      }),
    ).toEqual(['inativacao-futura']);
  });
});

describe('responsável pelo setor com histórico', () => {
  const hoje = '2026-06-10';
  const vigente = { id: 5, profissional: 10, inicio: '2026-01-01', fim: null };
  it('calcula a véspera atravessando mês e ano', () => {
    expect(vespera('2026-03-01')).toBe('2026-02-28');
    expect(vespera('2026-01-01')).toBe('2025-12-31');
  });
  it('troca de profissional encerra o anterior na véspera e abre período novo', () => {
    expect(planoResponsavel(vigente, { profissional: 11, inicio: '2026-06-15', fim: null }, hoje)).toEqual({
      tipo: 'trocar',
      encerrar: { id: 5, fim: '2026-06-14' },
      incluir: { profissional: 11, inicio: '2026-06-15', fim: null },
    });
    // Sem início informado, o novo começa hoje.
    expect(planoResponsavel(null, { profissional: 11, inicio: null, fim: null }, hoje)).toEqual({
      tipo: 'trocar',
      encerrar: null,
      incluir: { profissional: 11, inicio: hoje, fim: null },
    });
  });
  it('o mesmo profissional só ajusta o fim; sem mudança, nada', () => {
    expect(
      planoResponsavel(vigente, { profissional: 10, inicio: '2026-01-01', fim: '2026-12-31' }, hoje),
    ).toEqual({
      tipo: 'ajustar-fim',
      id: 5,
      fim: '2026-12-31',
    });
    expect(planoResponsavel(vigente, { profissional: 10, inicio: '2026-01-01', fim: null }, hoje)).toEqual({
      tipo: 'nada',
    });
    expect(planoResponsavel(null, { profissional: null, inicio: null, fim: null }, hoje)).toEqual({
      tipo: 'nada',
    });
  });
  it('retirar o responsável encerra o período hoje (o histórico fica)', () => {
    expect(planoResponsavel(vigente, { profissional: null, inicio: null, fim: null }, hoje)).toEqual({
      tipo: 'trocar',
      encerrar: { id: 5, fim: hoje },
      incluir: null,
    });
  });
  it('nunca estende um período que já terminou', () => {
    const terminado = { ...vigente, fim: '2026-03-31' };
    expect(planoResponsavel(terminado, { profissional: 11, inicio: '2026-06-15', fim: null }, hoje)).toEqual({
      tipo: 'trocar',
      encerrar: null,
      incluir: { profissional: 11, inicio: '2026-06-15', fim: null },
    });
    expect(planoResponsavel(terminado, { profissional: null, inicio: null, fim: null }, hoje)).toEqual({
      tipo: 'nada',
    });
    // O mesmo profissional volta depois do fim: período novo, o antigo fica como está.
    expect(planoResponsavel(terminado, { profissional: 10, inicio: '2026-06-15', fim: null }, hoje)).toEqual({
      tipo: 'trocar',
      encerrar: null,
      incluir: { profissional: 10, inicio: '2026-06-15', fim: null },
    });
    expect(errosTrocaResponsavel(terminado, { profissional: 10, inicio: '2026-06-15' })).toEqual([]);
  });
  it('recusa o novo período que começa no início do anterior ou antes', () => {
    expect(errosTrocaResponsavel(vigente, { profissional: 11, inicio: '2026-01-01' })).toEqual([
      'responsavel-inicio-antes-do-anterior',
    ]);
    expect(errosTrocaResponsavel(vigente, { profissional: 11, inicio: '2026-01-02' })).toEqual([]);
    expect(errosTrocaResponsavel(vigente, { profissional: 10, inicio: '2025-01-01' })).toEqual([]);
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
