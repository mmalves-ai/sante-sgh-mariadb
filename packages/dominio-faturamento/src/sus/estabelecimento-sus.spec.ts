import { describe, expect, it } from 'vitest';
import {
  conciliarHabilitacoesCnes,
  conferirHabilitacaoEstabelecimento,
  conferirRegraPrestador,
  conferirRegraServicoClassificacao,
  conferirServicoEstabelecimento,
  diasDaCompetenciaSus,
  habilitacoesDaCompetencia,
  habilitacoesNaCompetencia,
  permissaoPorTipoPrestador,
  type RegrasDaCriticaSus,
  vedacoesPorTipoPrestador,
  type RegraPrestadorSus,
  servicoClassificacaoAutomatico,
  vigenteNaCompetenciaSus,
} from './estabelecimento-sus.js';

const nova = {
  codigo: '0801',
  exigeLeitos: false,
  leitosHabilitados: null,
  numeroPortaria: null,
  dataPortaria: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
};

describe('vigência por competência', () => {
  it('dá o primeiro e o último dia da competência e recusa competência inválida', () => {
    expect(diasDaCompetenciaSus('202602')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
    expect(diasDaCompetenciaSus('202413')).toBeNull();
  });
  it('alcança a competência quando algum dia dela está na vigência', () => {
    expect(
      vigenteNaCompetenciaSus({ vigenciaInicio: '2026-01-01', vigenciaFim: '2026-01-31' }, '202601'),
    ).toBe(true);
    expect(
      vigenteNaCompetenciaSus({ vigenciaInicio: '2026-01-01', vigenciaFim: '2026-01-31' }, '202602'),
    ).toBe(false);
    expect(vigenteNaCompetenciaSus({ vigenciaInicio: '2026-03-01', vigenciaFim: null }, '202602')).toBe(
      false,
    );
  });
});

describe('conferirHabilitacaoEstabelecimento', () => {
  it('aceita a habilitação válida', () => {
    expect(conferirHabilitacaoEstabelecimento(nova, [])).toEqual([]);
  });
  it('recusa código, vigência fora da competência, leitos exigidos e portaria sem número', () => {
    const p = conferirHabilitacaoEstabelecimento(
      {
        ...nova,
        codigo: 'AB',
        vigenciaInicio: '2026-01-05',
        vigenciaFim: '2026-02-10',
        exigeLeitos: true,
        dataPortaria: '2025-12-01',
      },
      [],
    );
    expect(p.map((x) => x.campo).sort()).toEqual([
      'codigo',
      'leitosHabilitados',
      'numeroPortaria',
      'vigenciaFim',
      'vigenciaInicio',
    ]);
  });
  it('recusa o fim antes do início', () => {
    const p = conferirHabilitacaoEstabelecimento({ ...nova, vigenciaFim: '2025-12-31' }, []);
    expect(p.some((x) => x.mensagem.includes('anterior ao início'))).toBe(true);
  });
  it('recusa a sobreposição da mesma habilitação (801 = 0801) e ignora a própria', () => {
    const existentes = [{ id: 7, codigo: '801', vigenciaInicio: '2025-06-01', vigenciaFim: null }];
    expect(conferirHabilitacaoEstabelecimento(nova, existentes)[0]?.campo).toBe('vigenciaInicio');
    expect(conferirHabilitacaoEstabelecimento(nova, existentes, 7)).toEqual([]);
    expect(
      conferirHabilitacaoEstabelecimento(nova, [{ ...existentes[0]!, vigenciaFim: '2025-12-31' }]),
    ).toEqual([]);
  });
});

describe('habilitações da competência', () => {
  const lista = [
    { codigo: '0801', vigenciaInicio: '2025-01-01', vigenciaFim: '2025-12-31' },
    { codigo: '1601', vigenciaInicio: '2026-01-01', vigenciaFim: null },
  ];
  it('lista só as vigentes, normalizadas', () => {
    expect([...habilitacoesNaCompetencia(lista, '202512')]).toEqual(['801']);
    expect([...habilitacoesNaCompetencia(lista, '202602')]).toEqual(['1601']);
  });
  it('usa o cadastro quando há; sem cadastro, o parâmetro', () => {
    const param = new Set(['999']);
    expect([...habilitacoesDaCompetencia(lista, '202602', param)]).toEqual(['1601']);
    expect(habilitacoesDaCompetencia([], '202602', param)).toBe(param);
    expect(habilitacoesDaCompetencia(undefined, '202602', param)).toBe(param);
  });
});

describe('conciliarHabilitacoesCnes', () => {
  it('inclui as que faltam, encerra na véspera as que saíram e aponta o conflito', () => {
    const r = conciliarHabilitacoesCnes(
      [
        { id: 1, codigo: '0801', vigenciaInicio: '2025-01-01', vigenciaFim: null },
        { id: 2, codigo: '1601', vigenciaInicio: '2025-01-01', vigenciaFim: null },
        { id: 3, codigo: '2601', vigenciaInicio: '2026-03-01', vigenciaFim: null },
        { id: 4, codigo: '3001', vigenciaInicio: '2024-01-01', vigenciaFim: '2024-12-31' },
      ],
      [{ codigo: '801' }, { codigo: '1701', numeroPortaria: 'P 1' }, { codigo: 'x' }],
      '202603',
    );
    expect(r.mantidas).toBe(1);
    expect(r.incluir).toEqual([
      { codigo: '1701', numeroPortaria: 'P 1', vigenciaInicio: '2026-03-01', vigenciaFim: null },
    ]);
    expect(r.encerrar).toEqual([{ id: 2, codigo: '1601', vigenciaFim: '2026-02-28' }]);
    expect(r.conflitos.map((c) => c.id)).toEqual([3]);
  });
  it('recusa competência inválida', () => {
    expect(() => conciliarHabilitacoesCnes([], [], '2026')).toThrow();
  });
});

describe('conferirServicoEstabelecimento', () => {
  const s = {
    servicoClassificacao: 5,
    caracteristica: 'proprio' as const,
    prestadorExterno: null,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  it('aceita o próprio e pede o prestador do terceirizado', () => {
    expect(conferirServicoEstabelecimento(s, [])).toEqual([]);
    expect(conferirServicoEstabelecimento({ ...s, caracteristica: 'terceirizado' }, [])[0]?.campo).toBe(
      'prestadorExterno',
    );
    expect(conferirServicoEstabelecimento({ ...s, prestadorExterno: 3 }, [])[0]?.campo).toBe(
      'prestadorExterno',
    );
  });
  it('recusa a sobreposição do mesmo serviço ativo', () => {
    const ex = [{ id: 1, servicoClassificacao: 5, vigenciaInicio: '2025-01-01', vigenciaFim: null }];
    expect(conferirServicoEstabelecimento(s, ex)).toHaveLength(1);
    expect(conferirServicoEstabelecimento(s, [{ ...ex[0]!, ativo: false }])).toEqual([]);
    expect(conferirServicoEstabelecimento(s, ex, 1)).toEqual([]);
  });
});

describe('regras por tipo de prestador', () => {
  const base: RegraPrestadorSus = {
    id: 1,
    estabelecimento: null,
    tipoPrestador: 10,
    naturezaJuridica: null,
    instrumento: null,
    procedimento: null,
    grupo: 4,
    servicoClassificacao: null,
    permitido: true,
    vigenciaInicio: '2025-01-01',
    vigenciaFim: null,
  };
  const prod = {
    estabelecimento: 9,
    tipoPrestador: 10,
    naturezaJuridica: 2,
    procedimento: 100,
    grupo: 4,
    servicoClassificacao: null,
    instrumento: null,
  };
  it('pede um alvo', () => {
    expect(conferirRegraPrestador({ ...base, grupo: null })[0]?.campo).toBe('procedimento');
    expect(conferirRegraPrestador(base)).toEqual([]);
  });
  it('sem regra que alcance, sem restrição', () => {
    expect(permissaoPorTipoPrestador([base], { ...prod, tipoPrestador: 11 }, '202601')).toBeNull();
    expect(permissaoPorTipoPrestador([{ ...base, vigenciaFim: '2025-12-31' }], prod, '202601')).toBeNull();
  });
  it('vale a mais específica; no empate, a vedação', () => {
    const vedaProc = { ...base, id: 2, grupo: null, procedimento: 100, permitido: false };
    expect(permissaoPorTipoPrestador([base, vedaProc], prod, '202601')).toEqual({
      permitido: false,
      regra: 2,
    });
    const doHospital = { ...base, id: 3, estabelecimento: 9, permitido: true };
    expect(permissaoPorTipoPrestador([vedaProc, doHospital], prod, '202601')).toEqual({
      permitido: true,
      regra: 3,
    });
    const empate = { ...base, id: 4, permitido: false };
    expect(permissaoPorTipoPrestador([base, empate], prod, '202601')).toEqual({ permitido: false, regra: 4 });
  });
});

describe('serviço e classificação automático', () => {
  const r = {
    id: 1,
    servicoClassificacao: 50,
    procedimento: null,
    grupo: 4,
    setor: null,
    local: null,
    urgencia: false,
    prioridade: 100,
    ativo: true,
  };
  it('confere alvo e prioridade', () => {
    expect(conferirRegraServicoClassificacao({ ...r, grupo: null }).map((x) => x.campo)).toEqual([
      'procedimento',
    ]);
    expect(conferirRegraServicoClassificacao({ ...r, prioridade: 0 }).map((x) => x.campo)).toEqual([
      'prioridade',
    ]);
  });
  it('aplica a de menor prioridade, ignora inativa e a de urgência fora da urgência', () => {
    const x = { procedimento: 100, grupo: 4, setor: 7, local: null, urgencia: false };
    const r2 = { ...r, id: 2, servicoClassificacao: 51, setor: 7, prioridade: 10 };
    const r3 = { ...r, id: 3, servicoClassificacao: 52, prioridade: 1, urgencia: true };
    const r4 = { ...r, id: 4, servicoClassificacao: 53, prioridade: 1, ativo: false };
    expect(servicoClassificacaoAutomatico([r, r2, r3, r4], x)).toEqual({
      servicoClassificacao: 51,
      regra: 2,
    });
    expect(servicoClassificacaoAutomatico([r, r2, r3], { ...x, urgencia: true })?.regra).toBe(3);
    expect(servicoClassificacaoAutomatico([r], { ...x, grupo: 5 })).toBeNull();
  });
});

describe('crítica da produção pelas regras do estabelecimento', () => {
  const veda: RegraPrestadorSus = {
    id: 7,
    estabelecimento: null,
    tipoPrestador: 10,
    naturezaJuridica: null,
    instrumento: null,
    procedimento: null,
    grupo: null,
    servicoClassificacao: 50,
    permitido: false,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2026-03-31',
  };
  const cad: RegrasDaCriticaSus = {
    estabelecimento: 9,
    tipoPrestador: 10,
    naturezaJuridica: null,
    prestador: [veda],
    servico: [
      {
        id: 3,
        servicoClassificacao: 50,
        procedimento: null,
        grupo: 1,
        setor: null,
        local: null,
        urgencia: false,
        prioridade: 10,
        ativo: true,
      },
    ],
    grupos: [
      { id: 1, codigo: '03' },
      { id: 2, codigo: '0301' },
      { id: 4, codigo: '04' },
    ],
    instrumentos: { '01': 101, '02': 102, '06': 106 },
  };
  const item = { conta: 5, atendimento: 6, item: 8, sigtap: 100, codigo: '0301010072' };

  it('veda o procedimento cujo serviço automático a regra do tipo de prestador veda', () => {
    expect(vedacoesPorTipoPrestador(cad, [item], '202602', 'bpa')).toEqual([
      {
        regra: 'procedimento-vedado-prestador',
        gravidade: 'bloqueante',
        conta: 5,
        atendimento: 6,
        item: 8,
        detalhe: { sigtap: '0301010072', regraPrestador: 7, servicoClassificacao: 50, regraServico: 3 },
      },
    ]);
  });
  it('fora da vigência, de outro grupo ou sem tipo de prestador, nada veda', () => {
    expect(vedacoesPorTipoPrestador(cad, [item], '202604', 'bpa')).toEqual([]);
    expect(vedacoesPorTipoPrestador(cad, [{ ...item, codigo: '0401010015' }], '202602', 'bpa')).toEqual([]);
    expect(vedacoesPorTipoPrestador({ ...cad, tipoPrestador: null }, [item], '202602', 'bpa')).toEqual([]);
  });
  it('a regra do instrumento alcança só a saída dele; a regra do estabelecimento libera a geral', () => {
    const soApac = { ...veda, servicoClassificacao: null, grupo: 2, instrumento: 106 };
    expect(vedacoesPorTipoPrestador({ ...cad, prestador: [soApac] }, [item], '202602', 'bpa')).toEqual([]);
    expect(vedacoesPorTipoPrestador({ ...cad, prestador: [soApac] }, [item], '202602', 'apac')).toHaveLength(
      1,
    );
    const libera = { ...veda, id: 8, estabelecimento: 9, permitido: true };
    expect(vedacoesPorTipoPrestador({ ...cad, prestador: [veda, libera] }, [item], '202602', 'bpa')).toEqual(
      [],
    );
  });
});
