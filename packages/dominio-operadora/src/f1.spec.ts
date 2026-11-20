// M56.2 (fatia F1): documentos, operadora, plano (RN 63, carências, natureza), contrato, beneficiário, baixa,
// reativação, carteirinha e elegibilidade. Só documentos SINTÉTICOS (dígito calculado sobre base inventada).
import { describe, expect, it } from 'vitest';
import { problemasDoBeneficiario, problemasDaBaixa, problemasDaReativacao } from './beneficiario.js';
import {
  carteirinhaValida,
  formatarCarteirinha,
  numeroCarteirinha,
  problemasDoPedidoDeVia,
  somarDias,
  somarMeses,
  validadeDaVia,
} from './carteirinha.js';
import { contratoVigente, problemasDoContrato } from './contrato.js';
import {
  cnpjValido,
  cnsValido,
  cpfValido,
  mascararCpfBeneficiario,
  mascararDocumentoContratante,
  nomeDeBusca,
} from './documentos.js';
import { avaliarElegibilidade, carenciasNaData } from './elegibilidade.js';
import {
  faixaEtariaDaIdade,
  idadeEm,
  precoDeReferencia,
  problemasDaAlteracaoDoPlano,
  problemasDaOperadora,
  problemasDoPlano,
  problemasDosPrecos,
} from './plano.js';
import { cnpjSintetico, cnsDefinitivoSintetico, cnsProvisorioSintetico, cpfSintetico } from './sinteticos.js';

const CPF = cpfSintetico('900000001');
const CPF2 = cpfSintetico('900000002');
const CNPJ = cnpjSintetico('900000010001');

describe('documentos', () => {
  it('CPF, CNPJ e CNS pelo dígito; sequências repetidas recusadas', () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido(`${CPF.slice(0, 10)}${(Number(CPF[10]) + 1) % 10}`)).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('123')).toBe(false);
    expect(cpfValido(null)).toBe(false);
    expect(cnpjValido(CNPJ)).toBe(true);
    expect(cnpjValido(`${CNPJ.slice(0, 13)}${(Number(CNPJ[13]) + 1) % 10}`)).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    // Bases que levam o dígito ao 0 (resto < 2) e ao 10 no CPF.
    for (let i = 0; i < 60; i++) {
      expect(cpfValido(cpfSintetico(String(900_000_100 + i)))).toBe(true);
      expect(cnpjValido(cnpjSintetico(String(900_000_100_001 + i * 7)))).toBe(true);
    }
    const prov = cnsProvisorioSintetico('8900000000001');
    expect(cnsValido(prov)).toBe(true);
    expect(cnsValido(`${prov.slice(0, 14)}${(Number(prov[14]) + 1) % 10}`)).toBe(false);
    for (let i = 0; i < 40; i++)
      expect(cnsValido(cnsDefinitivoSintetico(String(19_000_000_000 + i)))).toBe(true);
    expect(cnsValido('300000000000000')).toBe(false);
    expect(cnsValido('1234')).toBe(false);
    expect(() => cnsProvisorioSintetico('x'.repeat(13))).toThrow();
  });

  it('máscaras da lista e o nome de busca', () => {
    expect(mascararCpfBeneficiario(CPF)).toBe(`***.${CPF.slice(3, 6)}.${CPF.slice(6, 9)}-**`);
    expect(mascararCpfBeneficiario('12')).toBeNull();
    expect(mascararDocumentoContratante(CNPJ)).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
    expect(mascararDocumentoContratante(CPF)).toMatch(/^\*\*\*\./);
    expect(mascararDocumentoContratante('')).toBe('');
    expect(nomeDeBusca('  Jõão   da Côsta-Sintético ')).toBe('JOAO DA COSTA SINTETICO');
  });
});

describe('operadora e plano', () => {
  it('operadora: registro de 6 dígitos e CNPJ válido (regra 3)', () => {
    expect(problemasDaOperadora({ registroAns: '900001', cnpj: CNPJ })).toEqual([]);
    expect(problemasDaOperadora({ registroAns: '9001', cnpj: '1' })).toEqual([
      'registro-operadora-invalido',
      'cnpj-invalido',
    ]);
  });

  const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];
  const plano = {
    natureza: 'plano' as const,
    registroAns: '900000001',
    segmentacao: 'ambulatorialHospitalar' as const,
    abrangencia: 'estadual',
    acomodacao: 2,
    coparticipacao: { tipo: 1, valor: null },
    carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    precos: PRECOS,
  };

  it('plano completo passa; cada falta tem o seu código', () => {
    expect(problemasDoPlano(plano)).toEqual([]);
    expect(problemasDoPlano({ ...plano, registroAns: null })).toContain('plano-sem-registro-ans');
    expect(problemasDoPlano({ ...plano, segmentacao: null, abrangencia: null })).toEqual([
      'segmentacao-obrigatoria',
      'abrangencia-obrigatoria',
    ]);
    expect(problemasDoPlano({ ...plano, acomodacao: null })).toEqual(['acomodacao-obrigatoria']);
    expect(problemasDoPlano({ ...plano, acomodacao: 3 })).toEqual(['acomodacao-obrigatoria']);
    expect(problemasDoPlano({ ...plano, segmentacao: 'ambulatorial', acomodacao: 1 })).toEqual([
      'acomodacao-sem-internacao',
    ]);
    expect(problemasDoPlano({ ...plano, segmentacao: 'ambulatorial', acomodacao: 3 })).toEqual([]);
    expect(problemasDoPlano({ ...plano, segmentacao: 'odontologico', acomodacao: null })).toEqual([]);
    expect(problemasDoPlano({ ...plano, carencias: { ...plano.carencias, demais: 181 } })).toEqual([
      'carencia-acima-do-limite',
    ]);
    expect(problemasDoPlano({ ...plano, coparticipacao: { tipo: 2, valor: null } })).toEqual([
      'coparticipacao-sem-valor',
    ]);
    expect(problemasDoPlano({ ...plano, coparticipacao: { tipo: 2, valor: 120 } })).toEqual([
      'coparticipacao-percentual-invalido',
    ]);
    expect(problemasDoPlano({ ...plano, coparticipacao: { tipo: 3, valor: 25 } })).toEqual([]);
    expect(problemasDoPlano({ ...plano, precos: null })).toEqual(['precos-obrigatorios']);
  });

  it('regra 2: cartão de desconto sem registro, sem cobertura e sem carência', () => {
    const cartao = {
      ...plano,
      natureza: 'cartaoDesconto' as const,
      registroAns: null,
      segmentacao: null,
      abrangencia: null,
      acomodacao: null,
      carencias: { urgencia: 0, partos: 0, demais: 0, cpt: 0 },
      precos: null,
    };
    expect(problemasDoPlano(cartao)).toEqual([]);
    expect(problemasDoPlano({ ...cartao, registroAns: '900000001' })).toEqual([
      'cartao-desconto-com-registro-ans',
    ]);
    expect(problemasDoPlano({ ...cartao, carencias: { ...cartao.carencias, demais: 30 } })).toEqual([
      'cartao-desconto-com-cobertura',
    ]);
    expect(problemasDoPlano({ ...cartao, precos: [50, 40, 40, 40, 40, 40, 60, 60, 60, 60] })).toEqual([
      'precos-decrescentes',
    ]);
  });

  it('RN 63: a última faixa até 6 vezes a primeira e a variação 7ª→10ª não maior que a 1ª→7ª', () => {
    expect(problemasDosPrecos(PRECOS)).toEqual([]);
    expect(problemasDosPrecos([100, 100, 100, 100, 100, 100, 300, 300, 300, 600])).toEqual([]);
    expect(problemasDosPrecos([100, 100, 100, 100, 100, 100, 300, 300, 300, 601])).toEqual([
      'precos-ultima-acima-de-seis-vezes',
    ]);
    expect(problemasDosPrecos([100, 110, 120, 130, 140, 150, 160, 200, 250, 300])).toEqual([
      'precos-variacao-final-maior',
    ]);
    expect(problemasDosPrecos([0, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toEqual(['preco-zero']);
    expect(problemasDosPrecos([1, 2])).toEqual(['precos-obrigatorios']);
  });

  it('faixa etária, idade e preço de referência', () => {
    expect(faixaEtariaDaIdade(0)).toBe(0);
    expect(faixaEtariaDaIdade(18)).toBe(0);
    expect(faixaEtariaDaIdade(19)).toBe(1);
    expect(faixaEtariaDaIdade(58)).toBe(8);
    expect(faixaEtariaDaIdade(90)).toBe(9);
    expect(faixaEtariaDaIdade(-1)).toBe(0);
    expect(idadeEm('2000-10-25', '2026-10-24')).toBe(25);
    expect(idadeEm('2000-10-24', '2026-10-24')).toBe(26);
    expect(idadeEm('2000-11-01', '2026-10-24')).toBe(25);
    expect(precoDeReferencia(PRECOS, '1990-01-01', '2026-10-24')).toBe(150);
    expect(precoDeReferencia(null, '1990-01-01', '2026-10-24')).toBeNull();
  });
});

describe('alteração do produto em uso', () => {
  it('natureza, tipo de contratação e registro na ANS só mudam sem contrato em uso', () => {
    const a = { natureza: 'plano' as const, tipoContratacao: 1, registroAns: '900000001' };
    expect(problemasDaAlteracaoDoPlano(a, a, 3)).toEqual([]);
    expect(problemasDaAlteracaoDoPlano(a, { ...a, tipoContratacao: 2 }, 1)).toEqual(['produto-em-uso']);
    expect(problemasDaAlteracaoDoPlano(a, { ...a, registroAns: '900000002' }, 1)).toEqual(['produto-em-uso']);
    expect(
      problemasDaAlteracaoDoPlano(
        a,
        { natureza: 'cartaoDesconto', tipoContratacao: 1, registroAns: null },
        1,
      ),
    ).toEqual(['produto-em-uso']);
    expect(problemasDaAlteracaoDoPlano(a, { ...a, tipoContratacao: 2 }, 0)).toEqual([]);
  });
});

describe('contrato', () => {
  const pf = {
    tipo: 1,
    contratanteDocumento: CPF,
    tipoVigencia: 2,
    inicio: '2026-01-01',
    fim: null,
    diaVencimento: 10,
    situacao: 'ativo' as const,
    motivoSituacao: null,
  };
  const ctx = {
    tipoContratacaoProduto: 1,
    situacaoProduto: 'ativo' as const,
    novo: true,
    diasPermitidos: [],
    beneficiariosAtivos: 0,
    produto: 5,
    anterior: null,
    beneficiariosVinculados: 0,
  };

  it('pessoa física com CPF no produto individual; jurídica com CNPJ no coletivo', () => {
    expect(problemasDoContrato(pf, ctx)).toEqual([]);
    expect(problemasDoContrato({ ...pf, contratanteDocumento: CNPJ }, ctx)).toEqual([
      'documento-pf-invalido',
    ]);
    expect(
      problemasDoContrato(
        { ...pf, tipo: 2, contratanteDocumento: CNPJ },
        { ...ctx, tipoContratacaoProduto: 2 },
      ),
    ).toEqual([]);
    expect(problemasDoContrato({ ...pf, tipo: 2 }, { ...ctx, tipoContratacaoProduto: 3 })).toEqual([
      'documento-pj-invalido',
    ]);
    expect(problemasDoContrato(pf, { ...ctx, tipoContratacaoProduto: 2 })).toEqual([
      'contratacao-incompativel',
    ]);
  });

  it('produto inativo só recusa contrato novo; vigência, vencimento, motivo e beneficiários ativos', () => {
    expect(problemasDoContrato(pf, { ...ctx, situacaoProduto: 'suspenso' })).toEqual(['produto-inativo']);
    expect(problemasDoContrato(pf, { ...ctx, situacaoProduto: 'suspenso', novo: false })).toEqual([]);
    expect(problemasDoContrato({ ...pf, tipoVigencia: 1 }, ctx)).toEqual(['vigencia-sem-fim']);
    expect(problemasDoContrato({ ...pf, tipoVigencia: 1, fim: '2025-12-31' }, ctx)).toEqual([
      'fim-antes-do-inicio',
    ]);
    expect(problemasDoContrato({ ...pf, diaVencimento: 30 }, ctx)).toEqual(['dia-vencimento-nao-permitido']);
    expect(problemasDoContrato({ ...pf, diaVencimento: 30 }, { ...ctx, diasPermitidos: [5, 30] })).toEqual(
      [],
    );
    expect(problemasDoContrato({ ...pf, diaVencimento: 10 }, { ...ctx, diasPermitidos: [5] })).toEqual([
      'dia-vencimento-nao-permitido',
    ]);
    expect(problemasDoContrato({ ...pf, diaVencimento: null }, ctx)).toEqual([]);
    expect(problemasDoContrato({ ...pf, situacao: 'suspenso' }, ctx)).toEqual(['situacao-sem-motivo']);
    expect(
      problemasDoContrato(
        { ...pf, situacao: 'encerrado', motivoSituacao: 'Fim sintético' },
        { ...ctx, beneficiariosAtivos: 2, novo: false },
      ),
    ).toEqual(['encerrado-com-beneficiarios-ativos']);
  });

  it('D-BAIXA-56: contrato com beneficiário (ativo ou suspenso) não troca de produto nem de tipo', () => {
    const alt = { ...ctx, novo: false, anterior: { produto: 5, tipo: 1 }, beneficiariosVinculados: 1 };
    expect(problemasDoContrato(pf, alt)).toEqual([]);
    expect(problemasDoContrato(pf, { ...alt, produto: 6, novo: true })).toEqual([
      'produto-com-beneficiarios',
    ]);
    expect(
      problemasDoContrato(
        { ...pf, tipo: 2, contratanteDocumento: CNPJ },
        { ...alt, produto: 6, tipoContratacaoProduto: 2 },
      ),
    ).toEqual(['produto-com-beneficiarios', 'tipo-com-beneficiarios']);
    // Sem beneficiário, o contrato ainda pode trocar de produto e de tipo (antes da primeira adesão).
    expect(
      problemasDoContrato(
        { ...pf, tipo: 2, contratanteDocumento: CNPJ },
        { ...alt, produto: 6, tipoContratacaoProduto: 2, beneficiariosVinculados: 0 },
      ),
    ).toEqual([]);
  });

  it('vigência na data', () => {
    const c = { situacao: 'ativo' as const, inicio: '2026-01-01', fim: '2026-12-31' };
    expect(contratoVigente(c, '2026-06-01')).toBe(true);
    expect(contratoVigente(c, '2027-01-01')).toBe(false);
    expect(contratoVigente(c, '2025-12-31')).toBe(false);
    expect(contratoVigente({ ...c, fim: null }, '2099-01-01')).toBe(true);
    expect(contratoVigente({ ...c, situacao: 'suspenso' }, '2026-06-01')).toBe(false);
  });
});

describe('beneficiário', () => {
  const contrato = { id: 7, tipo: 1, situacao: 'ativo' as const, inicio: '2026-01-01', fim: null };
  const ctx = { hoje: '2026-10-24', contrato, titular: null, outrosTitularesAtivos: 0, cpfNoContrato: 0 };
  const titular = {
    id: null,
    vinculo: 1,
    titular: null,
    cpf: CPF,
    cns: null,
    nascimento: '1980-05-01',
    inclusao: '2026-02-01',
  };
  const dep = { ...titular, vinculo: 5, titular: 11, cpf: null, nascimento: '2015-03-01' };
  const ctxDep = { ...ctx, titular: { id: 11, contrato: 7, vinculo: 1, situacao: 'ativo' as const } };

  it('titular com CPF; um titular só no contrato de pessoa física', () => {
    expect(problemasDoBeneficiario(titular, ctx)).toEqual([]);
    expect(problemasDoBeneficiario({ ...titular, cpf: null }, ctx)).toEqual(['cpf-obrigatorio']);
    expect(problemasDoBeneficiario({ ...titular, cpf: '12345678900' }, ctx)).toEqual(['cpf-invalido']);
    expect(problemasDoBeneficiario(titular, { ...ctx, cpfNoContrato: 1 })).toEqual([
      'cpf-repetido-no-contrato',
    ]);
    expect(problemasDoBeneficiario(titular, { ...ctx, outrosTitularesAtivos: 1 })).toEqual([
      'contrato-pf-ja-tem-titular',
    ]);
    expect(
      problemasDoBeneficiario(titular, {
        ...ctx,
        outrosTitularesAtivos: 1,
        contrato: { ...contrato, tipo: 2 },
      }),
    ).toEqual([]);
    expect(problemasDoBeneficiario({ ...titular, titular: 3 }, ctx)).toEqual(['titular-com-titular']);
  });

  it('dependente: menor sem CPF; maior de 18 com CPF; titular ativo do mesmo contrato', () => {
    expect(problemasDoBeneficiario(dep, ctxDep)).toEqual([]);
    expect(problemasDoBeneficiario({ ...dep, nascimento: '2000-01-01' }, ctxDep)).toEqual([
      'cpf-obrigatorio',
    ]);
    expect(problemasDoBeneficiario({ ...dep, nascimento: '2000-01-01', cpf: CPF2 }, ctxDep)).toEqual([]);
    expect(problemasDoBeneficiario({ ...dep, titular: null }, ctx)).toEqual(['dependente-sem-titular']);
    expect(problemasDoBeneficiario(dep, ctx)).toEqual(['dependente-sem-titular']);
    expect(
      problemasDoBeneficiario(dep, {
        ...ctxDep,
        titular: { id: 11, contrato: 8, vinculo: 5, situacao: 'excluido' },
      }),
    ).toEqual(['titular-de-outro-contrato', 'titular-e-dependente', 'titular-inativo']);
  });

  it('datas, CNS e contrato inativo', () => {
    expect(problemasDoBeneficiario({ ...dep, nascimento: '2027-01-01' }, ctxDep)).toEqual([
      'nascimento-futuro',
    ]);
    expect(problemasDoBeneficiario({ ...titular, inclusao: '2025-12-01' }, ctx)).toEqual([
      'inclusao-antes-do-contrato',
    ]);
    expect(
      problemasDoBeneficiario(titular, { ...ctx, contrato: { ...contrato, fim: '2026-01-31' } }),
    ).toEqual(['inclusao-depois-do-fim']);
    expect(problemasDoBeneficiario({ ...titular, cns: '123' }, ctx)).toEqual(['cns-invalido']);
    expect(
      problemasDoBeneficiario({ ...titular, cns: cnsProvisorioSintetico('8900000000002') }, ctx),
    ).toEqual([]);
    expect(
      problemasDoBeneficiario(titular, { ...ctx, contrato: { ...contrato, situacao: 'suspenso' } }),
    ).toEqual(['contrato-inativo']);
    expect(
      problemasDoBeneficiario(
        { ...titular, id: 11 },
        { ...ctx, contrato: { ...contrato, situacao: 'suspenso' } },
      ),
    ).toEqual([]);
  });

  it('baixa e reativação', () => {
    const b = { situacao: 'ativo' as const, inclusao: '2026-02-01' };
    const x = { motivosValidos: [1, 99], hoje: '2026-10-24' };
    expect(problemasDaBaixa(b, { motivo: 1, data: '2026-10-24' }, x)).toEqual([]);
    expect(problemasDaBaixa({ ...b, situacao: 'excluido' }, { motivo: 2, data: '2026-01-01' }, x)).toEqual([
      'ja-excluido',
      'motivo-invalido',
      'data-antes-da-inclusao',
    ]);
    expect(problemasDaBaixa(b, { motivo: 1, data: '2026-10-25' }, x)).toEqual(['data-futura']);
    expect(
      problemasDaReativacao(
        { situacao: 'excluido', vinculo: 5 },
        { contratoAtivo: true, titularAtivo: true },
      ),
    ).toEqual([]);
    expect(
      problemasDaReativacao({ situacao: 'ativo', vinculo: 5 }, { contratoAtivo: false, titularAtivo: false }),
    ).toEqual(['nao-excluido', 'contrato-inativo', 'titular-inativo']);
    expect(
      problemasDaReativacao(
        { situacao: 'excluido', vinculo: 1 },
        { contratoAtivo: true, titularAtivo: false },
      ),
    ).toEqual([]);
  });
});

describe('carteirinha', () => {
  it('16 dígitos estáveis: registro, sequência e verificador', () => {
    const n = numeroCarteirinha('900001', 42);
    expect(n).toMatch(/^900001000000042\d$/);
    expect(carteirinhaValida(n)).toBe(true);
    expect(carteirinhaValida(`${n.slice(0, 15)}${(Number(n[15]) + 1) % 10}`)).toBe(false);
    expect(carteirinhaValida('123')).toBe(false);
    for (let i = 1; i < 40; i++) expect(carteirinhaValida(numeroCarteirinha('900001', i * 97))).toBe(true);
    expect(formatarCarteirinha(n)).toBe(`900001 000000042 ${n[15]}`);
    expect(formatarCarteirinha('12')).toBe('12');
    expect(() => numeroCarteirinha('9', 1)).toThrow();
    expect(() => numeroCarteirinha('900001', 0)).toThrow();
  });

  it('pedido de via: primeira sem motivo, segunda com o motivo do domínio, só beneficiário ativo', () => {
    const ativo = { situacao: 'ativo', viasEmitidas: 1 };
    expect(problemasDoPedidoDeVia({ ...ativo, viasEmitidas: 0 }, null, [1])).toEqual([]);
    expect(problemasDoPedidoDeVia({ ...ativo, viasEmitidas: 0 }, 1, [1])).toEqual([
      'primeira-via-ja-emitida',
    ]);
    expect(problemasDoPedidoDeVia(ativo, 1, [1])).toEqual([]);
    expect(problemasDoPedidoDeVia(ativo, null, [1])).toEqual(['segunda-via-sem-motivo']);
    expect(problemasDoPedidoDeVia(ativo, 9, [1])).toEqual(['motivo-invalido']);
    expect(problemasDoPedidoDeVia({ ...ativo, situacao: 'excluido' }, 1, [1])).toEqual([
      'beneficiario-inativo',
    ]);
  });

  it('datas e validade da via', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-10-24', 24)).toBe('2028-10-24');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(validadeDaVia('2026-10-24', null)).toBe('2028-10-24');
    expect(validadeDaVia('2026-10-24', '2027-06-30')).toBe('2027-06-30');
    expect(validadeDaVia('2026-10-24', '2030-01-01')).toBe('2028-10-24');
  });
});

describe('elegibilidade', () => {
  const n = numeroCarteirinha('900001', 7);
  const dados = {
    beneficiario: { situacao: 'ativo' as const, inclusao: '2026-05-01' },
    contrato: { situacao: 'ativo' as const, inicio: '2026-01-01', fim: null },
    produto: {
      situacao: 'ativo' as const,
      natureza: 'plano' as const,
      carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    },
  };

  it('elegível com as carências contadas da adesão (não tornam inelegível)', () => {
    const r = avaliarElegibilidade(n, dados, '2026-10-24');
    expect(r.elegivel).toBe(true);
    expect(r.carencias).toEqual([
      { tipo: 'urgencia', cumpridaEm: '2026-05-02', cumprida: true },
      { tipo: 'partos', cumpridaEm: '2027-02-25', cumprida: false },
      { tipo: 'demais', cumpridaEm: '2026-10-28', cumprida: false },
      { tipo: 'cpt', cumpridaEm: '2028-05-01', cumprida: false },
    ]);
    expect(
      carenciasNaData({ urgencia: 0, partos: 0, demais: 0, cpt: 0 }, '2026-01-01', '2026-01-01'),
    ).toEqual([]);
  });

  it('cada motivo de inelegibilidade', () => {
    expect(avaliarElegibilidade('123', dados, '2026-10-24').motivos).toEqual(['carteirinha-invalida']);
    expect(avaliarElegibilidade(n, null, '2026-10-24').motivos).toEqual(['nao-encontrado']);
    const r = avaliarElegibilidade(
      n,
      {
        beneficiario: { situacao: 'excluido', inclusao: '2026-11-01' },
        contrato: { situacao: 'suspenso', inicio: '2026-01-01', fim: null },
        produto: { ...dados.produto, situacao: 'cancelado' },
      },
      '2026-10-24',
    );
    expect(r).toMatchObject({
      elegivel: false,
      motivos: ['beneficiario-excluido', 'contrato-inativo', 'produto-cancelado', 'antes-da-inclusao'],
    });
    expect(
      avaliarElegibilidade(
        n,
        {
          ...dados,
          beneficiario: { ...dados.beneficiario, situacao: 'suspenso' },
          contrato: { ...dados.contrato, fim: '2026-06-30' },
        },
        '2026-10-24',
      ).motivos,
    ).toEqual(['beneficiario-suspenso', 'contrato-fora-da-vigencia']);
    // Cartão de desconto: sem carência.
    expect(
      avaliarElegibilidade(
        n,
        { ...dados, produto: { ...dados.produto, natureza: 'cartaoDesconto' } },
        '2026-10-24',
      ).carencias,
    ).toEqual([]);
  });
});
