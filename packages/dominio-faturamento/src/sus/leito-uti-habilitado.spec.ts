// Regras dos leitos de UTI habilitados e das diárias por competência (F7, 06-SUS linha 59). Massa sintética.
import { describe, expect, it } from 'vitest';
import { diariasUtiDaTrajetoria } from './aih.js';
import {
  classeDaUtiSus,
  conferirHabilitacaoUti,
  diariasUtiPorCompetencia,
  type HabilitacaoUtiVigencia,
  habilitacaoUtiDaCompetencia,
} from './leito-uti-habilitado.js';

const h = (x: Partial<HabilitacaoUtiVigencia> & { id: number }): HabilitacaoUtiVigencia => ({
  tipo: 1,
  unidade: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});
const nova = {
  tipo: 1,
  unidade: null,
  quantidadeLeitos: 10,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
};

describe('cadastro dos leitos de UTI habilitados', () => {
  it('aceita a primeira habilitação e confere quantidade e vigência por competência', () => {
    expect(conferirHabilitacaoUti(nova, [])).toEqual({ problemas: [], encerrar: null });
    const r = conferirHabilitacaoUti(
      { ...nova, quantidadeLeitos: 0, vigenciaInicio: '2026-01-15', vigenciaFim: '2026-03-30' },
      [],
    );
    expect(r.problemas.map((x) => x.campo)).toEqual(['quantidadeLeitos', 'vigenciaInicio', 'vigenciaFim']);
    expect(
      conferirHabilitacaoUti({ ...nova, vigenciaInicio: '2026-05-01', vigenciaFim: '2026-03-31' }, [])
        .problemas,
    ).toEqual([{ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' }]);
    expect(conferirHabilitacaoUti({ ...nova, quantidadeLeitos: 10000 }, []).problemas[0]?.campo).toBe(
      'quantidadeLeitos',
    );
  });

  it('a nova quantidade a partir de uma competência encerra a aberta anterior na véspera', () => {
    const r = conferirHabilitacaoUti({ ...nova, vigenciaInicio: '2026-03-01' }, [h({ id: 7 })]);
    expect(r).toEqual({ problemas: [], encerrar: { id: 7, vigenciaFim: '2026-02-28' } });
  });

  it('recusa a sobreposição do mesmo tipo e unidade; outro tipo, outra unidade ou inativa não contam', () => {
    const existentes = [h({ id: 1, vigenciaInicio: '2026-01-01', vigenciaFim: '2026-06-30' })];
    expect(
      conferirHabilitacaoUti({ ...nova, vigenciaInicio: '2026-05-01' }, existentes).problemas,
    ).toHaveLength(1);
    expect(conferirHabilitacaoUti({ ...nova, vigenciaInicio: '2026-07-01' }, existentes).problemas).toEqual(
      [],
    );
    expect(conferirHabilitacaoUti({ ...nova, tipo: 2 }, existentes).problemas).toEqual([]);
    expect(conferirHabilitacaoUti({ ...nova, unidade: 5 }, existentes).problemas).toEqual([]);
    expect(conferirHabilitacaoUti(nova, [h({ id: 1, ativo: false })]).problemas).toEqual([]);
    // Alteração da própria: não conflita consigo nem encerra nada.
    expect(conferirHabilitacaoUti({ ...nova, vigenciaFim: '2026-12-31' }, [h({ id: 3 })], 3)).toEqual({
      problemas: [],
      encerrar: null,
    });
    // A aberta que começa no mesmo dia não é encerrada: é sobreposição.
    expect(conferirHabilitacaoUti(nova, [h({ id: 4 })]).problemas).toHaveLength(1);
  });

  it('a habilitação vigente do tipo na competência', () => {
    const l = [
      h({ id: 1, vigenciaFim: '2026-02-28' }),
      h({ id: 2, vigenciaInicio: '2026-03-01' }),
      h({ id: 3, tipo: 2 }),
    ];
    expect(habilitacaoUtiDaCompetencia(l, 1, '202602')).toBe(1);
    expect(habilitacaoUtiDaCompetencia(l, 1, '202604')).toBe(2);
    expect(habilitacaoUtiDaCompetencia(l, 1, '202512')).toBeNull();
    expect(habilitacaoUtiDaCompetencia(l, 9, '202602')).toBeNull();
  });
});

describe('diárias de UTI por competência', () => {
  const mapa = new Map([
    [3, { tipo: 2, procedimento: '0802010083' }],
    [17, { tipo: 5, procedimento: '0802010113' }],
  ]);

  it('parte a passagem nos meses que atravessa e a soma bate com a da trajetória', () => {
    const passagens = [
      { entrada: '2026-01-28', saida: '2026-02-03', acomodacao: 3 },
      { entrada: '2026-02-03', saida: null, acomodacao: 1 },
      { entrada: '2026-02-10', saida: '2026-02-10', acomodacao: 17 },
    ];
    const r = diariasUtiPorCompetencia(passagens, mapa, '2026-02-20');
    expect(r).toEqual([
      {
        tipo: 2,
        procedimento: '0802010083',
        competencia: '202601',
        dataEntrada: '2026-01-28',
        dataSaida: '2026-02-01',
        diarias: 4,
      },
      {
        tipo: 2,
        procedimento: '0802010083',
        competencia: '202602',
        dataEntrada: '2026-02-01',
        dataSaida: '2026-02-03',
        diarias: 2,
      },
      {
        tipo: 5,
        procedimento: '0802010113',
        competencia: '202602',
        dataEntrada: '2026-02-10',
        dataSaida: '2026-02-10',
        diarias: 1,
      },
    ]);
    const t = diariasUtiDaTrajetoria(passagens, mapa, '2026-02-20');
    expect(r.reduce((s, x) => s + x.diarias, 0)).toBe(t.total);
    expect(r.filter((x) => x.competencia === '202601').reduce((s, x) => s + x.diarias, 0)).toBe(
      t.porTipo.reduce((s, x) => s + x.mesAnterior, 0),
    );
  });

  it('sem saída vai até a alta; sem alta nem saída, ou sem tipo do SIH, não conta', () => {
    expect(
      diariasUtiPorCompetencia([{ entrada: '2026-12-30', saida: null, acomodacao: 3 }], mapa, '2027-01-02'),
    ).toEqual([
      {
        tipo: 2,
        procedimento: '0802010083',
        competencia: '202612',
        dataEntrada: '2026-12-30',
        dataSaida: '2027-01-01',
        diarias: 2,
      },
      {
        tipo: 2,
        procedimento: '0802010083',
        competencia: '202701',
        dataEntrada: '2027-01-01',
        dataSaida: '2027-01-02',
        diarias: 1,
      },
    ]);
    expect(
      diariasUtiPorCompetencia([{ entrada: '2026-01-01', saida: null, acomodacao: 3 }], mapa, null),
    ).toEqual([]);
    expect(
      diariasUtiPorCompetencia([{ entrada: '2026-01-01', saida: '2026-01-05', acomodacao: 7 }], mapa, null),
    ).toEqual([]);
  });
});

describe('classe da UTI pela descrição do tipo', () => {
  it.each([
    ['UTI ADULTO - TIPO II', 'adulto', 2],
    ['UTI adulto tipo III (teste)', 'adulto', 3],
    ['UTI INFANTIL - TIPO I', 'pediatrica', 1],
    ['UTI PEDIÁTRICA TIPO II', 'pediatrica', 2],
    ['UTI NEONATAL - TIPO III', 'neonatal', 3],
    ['UTI DE QUEIMADOS', 'queimados', null],
    ['UTI CORONARIANA TIPO II - UCO TIPO II', 'coronariana', 2],
    ['UNIDADE DE CUIDADOS INTERMEDIÁRIOS NEONATAL', 'intermediaria', null],
    ['ADULTO 2 (SINTETICO)', 'adulto', 2],
  ])('%s', (d, classe, nivel) => {
    expect(classeDaUtiSus(d)).toEqual({ classe, nivel });
  });

  it('descrição sem a classe', () => {
    expect(classeDaUtiSus('LEITO ESPECIAL')).toBeNull();
  });
});
