import { describe, expect, it } from 'vitest';
import {
  validarAltoCusto,
  validarDescontoGrupo,
  validarEncerramentoRegra,
  validarInicioQueEncerra,
  validarIsento,
  validarPercentualCobranca,
  validarTeto,
  validarVigenciaRegra,
  validarViaAcesso,
} from './regras-acordo.js';

const V = { vigenciaInicio: '2026-01-01', vigenciaFim: null };

describe('vigência da regra', () => {
  it('início obrigatório e fim nunca antes dele', () => {
    expect(validarVigenciaRegra(V)).toEqual({});
    expect(Object.keys(validarVigenciaRegra({ vigenciaInicio: '' }))).toEqual(['vigenciaInicio']);
    expect(
      Object.keys(validarVigenciaRegra({ vigenciaInicio: '2026-02-01', vigenciaFim: '2026-01-31' })),
    ).toEqual(['vigenciaFim']);
  });
});

describe('percentual por componente', () => {
  const base = {
    ...V,
    tabelaId: 1,
    componente: 'honorario',
    tipoPaciente: 'todos',
    itemId: null,
    grupoId: null,
    percentual: 120,
    valorFixo: null,
    quantidadeFixa: null,
  };
  it('aceita percentual, valor ou quantidade dentro das faixas', () => {
    expect(validarPercentualCobranca(base)).toEqual({});
    expect(validarPercentualCobranca({ ...base, percentual: null, valorFixo: 50 })).toEqual({});
  });
  it('recusa sem valor, fora da faixa, parcela desconhecida e dois alvos', () => {
    expect(validarPercentualCobranca({ ...base, percentual: null })).toHaveProperty('percentual');
    expect(validarPercentualCobranca({ ...base, percentual: 1000 })).toHaveProperty('percentual');
    expect(validarPercentualCobranca({ ...base, percentual: -1 })).toHaveProperty('percentual');
    expect(validarPercentualCobranca({ ...base, valorFixo: -5 })).toHaveProperty('valorFixo');
    expect(validarPercentualCobranca({ ...base, componente: 'outro' })).toHaveProperty('componente');
    expect(validarPercentualCobranca({ ...base, tipoPaciente: 'x' })).toHaveProperty('tipoPaciente');
    expect(validarPercentualCobranca({ ...base, tabelaId: null })).toHaveProperty('tabelaId');
    expect(validarPercentualCobranca({ ...base, itemId: 1, grupoId: 2 })).toHaveProperty('grupoId');
  });
});

describe('desconto por grupo de despesa', () => {
  const base = {
    ...V,
    grupoId: 3,
    acrescimo: 0,
    desconto: 10,
    regimes: ['internacao'],
    sobre: ['honorario'],
  };
  it('um sentido só', () => {
    expect(validarDescontoGrupo(base)).toEqual({});
    expect(validarDescontoGrupo({ ...base, desconto: 0, acrescimo: 15 })).toEqual({});
    expect(validarDescontoGrupo({ ...base, acrescimo: 5 })).toHaveProperty('desconto');
    expect(validarDescontoGrupo({ ...base, desconto: 0 })).toHaveProperty('desconto');
  });
  it('faixas, regime e parcela', () => {
    expect(validarDescontoGrupo({ ...base, desconto: 101 })).toHaveProperty('desconto');
    expect(validarDescontoGrupo({ ...base, desconto: 0, acrescimo: 1001 })).toHaveProperty('acrescimo');
    expect(validarDescontoGrupo({ ...base, regimes: [] })).toHaveProperty('regimes');
    expect(validarDescontoGrupo({ ...base, regimes: ['lua'] })).toHaveProperty('regimes');
    expect(validarDescontoGrupo({ ...base, sobre: ['tudo'] })).toHaveProperty('sobre');
    expect(validarDescontoGrupo({ ...base, grupoId: null })).toHaveProperty('grupoId');
  });
});

describe('via de acesso', () => {
  const base = { ...V, descricao: 'SEGUNDO', viaId: 1, ordem: 2, percentual: 50, criterio: 'maior_valor' };
  it('ordem a partir de 1, percentual de 0 a 999 e critério conhecido', () => {
    expect(validarViaAcesso(base)).toEqual({});
    expect(validarViaAcesso({ ...base, ordem: 0 })).toHaveProperty('ordem');
    expect(validarViaAcesso({ ...base, ordem: 1.5 })).toHaveProperty('ordem');
    expect(validarViaAcesso({ ...base, percentual: 1000 })).toHaveProperty('percentual');
    expect(validarViaAcesso({ ...base, criterio: 'sorteio' })).toHaveProperty('criterio');
    expect(validarViaAcesso({ ...base, descricao: ' ' })).toHaveProperty('descricao');
    expect(validarViaAcesso({ ...base, viaId: null })).toHaveProperty('viaId');
  });
});

describe('item isento', () => {
  const base = { ...V, itemId: 1, grupoId: null, motivo: 'Incluso no pacote' };
  it('um alvo só e o motivo', () => {
    expect(validarIsento(base)).toEqual({});
    expect(validarIsento({ ...base, itemId: null, grupoId: 2 })).toEqual({});
    expect(validarIsento({ ...base, grupoId: 2 })).toHaveProperty('itemId');
    expect(validarIsento({ ...base, itemId: null })).toHaveProperty('itemId');
    expect(validarIsento({ ...base, motivo: ' ' })).toHaveProperty('motivo');
  });
});

describe('teto de cobrança', () => {
  const base = {
    ...V,
    fonteId: 10,
    planoId: null,
    abrangencia: 'grupo',
    itemId: null,
    grupoId: 3,
    valorTeto: 5000,
    quantidadeMaxima: null,
    ocorrenciasMaximas: null,
    acao: 'alertar',
    excedenteFonteId: null,
    excedentePlanoId: null,
  };
  it('alvo pela abrangência', () => {
    expect(validarTeto(base)).toEqual({});
    expect(validarTeto({ ...base, grupoId: null })).toHaveProperty('grupoId');
    expect(validarTeto({ ...base, abrangencia: 'item' })).toHaveProperty('itemId');
    expect(validarTeto({ ...base, abrangencia: 'conta' })).toHaveProperty('grupoId');
    expect(validarTeto({ ...base, abrangencia: 'conta', grupoId: null })).toEqual({});
    expect(validarTeto({ ...base, abrangencia: 'semana' })).toHaveProperty('abrangencia');
  });
  it('limite positivo e inteiro nas vezes', () => {
    expect(validarTeto({ ...base, valorTeto: 0 })).toHaveProperty('valorTeto');
    expect(validarTeto({ ...base, valorTeto: null, ocorrenciasMaximas: 2 })).toEqual({});
    expect(validarTeto({ ...base, ocorrenciasMaximas: 1.5 })).toHaveProperty('ocorrenciasMaximas');
    expect(validarTeto({ ...base, quantidadeMaxima: -1 })).toHaveProperty('quantidadeMaxima');
  });
  it('destino do excedente só ao transferir, e outro plano na mesma fonte', () => {
    const t = { ...base, acao: 'transferir_excedente' };
    expect(validarTeto(t)).toHaveProperty('excedenteFonteId');
    expect(validarTeto({ ...t, excedenteFonteId: 11 })).toEqual({});
    expect(validarTeto({ ...t, excedenteFonteId: 10 })).toHaveProperty('excedentePlanoId');
    expect(validarTeto({ ...t, excedenteFonteId: 10, excedentePlanoId: 7 })).toEqual({});
    expect(validarTeto({ ...t, planoId: 7, excedenteFonteId: 10, excedentePlanoId: 7 })).toHaveProperty(
      'excedentePlanoId',
    );
    expect(validarTeto({ ...base, excedenteFonteId: 11 })).toHaveProperty('excedenteFonteId');
    expect(validarTeto({ ...base, acao: 'ignorar' })).toHaveProperty('acao');
  });
});

describe('alto custo', () => {
  const base = {
    ...V,
    itemId: 1,
    grupoId: null,
    regra: 'preco_negociado',
    valorBase: null,
    valorNegociado: 1500,
  };
  it('alvo, regra e preço negociado', () => {
    expect(validarAltoCusto(base)).toEqual({});
    expect(
      validarAltoCusto({ ...base, regra: 'exige_autorizacao', valorNegociado: null, valorBase: 800 }),
    ).toEqual({});
    expect(validarAltoCusto({ ...base, valorNegociado: null })).toHaveProperty('valorNegociado');
    expect(validarAltoCusto({ ...base, regra: 'cobranca_a_parte' })).toHaveProperty('valorNegociado');
    expect(validarAltoCusto({ ...base, grupoId: 2 })).toHaveProperty('itemId');
    expect(validarAltoCusto({ ...base, itemId: null })).toHaveProperty('itemId');
    expect(validarAltoCusto({ ...base, regra: 'outra' })).toHaveProperty('regra');
    expect(validarAltoCusto({ ...base, valorBase: -1 })).toHaveProperty('valorBase');
  });
});

describe('encerramento da regra', () => {
  it('não reescreve o passado', () => {
    expect(validarEncerramentoRegra('2026-01-01', null, '2026-12-31', '2026-11-25')).toEqual({});
    expect(validarEncerramentoRegra('2026-01-01', null, '2026-11-25', '2026-11-25')).toEqual({});
    expect(validarEncerramentoRegra('2026-01-01', null, '2026-11-24', '2026-11-25')).toHaveProperty(
      'vigenciaFim',
    );
    expect(validarEncerramentoRegra('2026-12-01', null, '2026-11-30', '2026-11-25')).toHaveProperty(
      'vigenciaFim',
    );
    expect(validarEncerramentoRegra('2026-01-01', '2026-06-30', '2026-12-31', '2026-11-25')).toHaveProperty(
      'id',
    );
    expect(validarEncerramentoRegra('2026-01-01', null, '', '2026-11-25')).toHaveProperty('vigenciaFim');
  });
});

describe('regra nova que encerra a anterior', () => {
  it('não começa antes de hoje (o fim da anterior iria para o passado)', () => {
    expect(validarInicioQueEncerra('2026-11-25', '2026-11-25')).toEqual({});
    expect(validarInicioQueEncerra('2026-12-01', '2026-11-25')).toEqual({});
    expect(validarInicioQueEncerra('2026-11-24', '2026-11-25')).toHaveProperty('vigenciaInicio');
    expect(validarInicioQueEncerra('2025-01-01', '2026-11-25')).toHaveProperty('vigenciaInicio');
  });
});
