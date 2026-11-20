// Plantão realizado para o repasse (ficha do M52, seção 5, cenário origem-plantao; seção 14, DP-33): registro, quatro
// olhos, tarifa vigente, valor com as parcelas escritas, só prestador, grupos do lançamento e a sugestão do ponto.
import { describe, expect, it } from 'vitest';
import {
  competenciaDoRealizado,
  conferirDecisaoRealizado,
  conferirRealizado,
  conferirTarifa,
  dataDoLancamento,
  gruposRepasse,
  minutosRealizado,
  motivoForaDoRepasse,
  type RealizadoLido,
  type RealizadoParaRepasse,
  sugestaoDoPonto,
  tarifaVigente,
  valoracoesPelaTarifa,
  valorRealizado,
  vinculoNoRepasse,
} from './realizado.js';

const AGORA = '2026-10-26T10:00';
const plantao = {
  inicio: '2026-10-24T19:00',
  fim: '2026-10-25T07:00',
  situacao: 'previsto',
  estadoEscala: 'publicada',
};
const ok = { inicio: '2026-10-24T19:05', fim: '2026-10-25T07:20' };
const r = (x: Partial<RealizadoLido> = {}): RealizadoLido => ({
  id: 1,
  plantao: 10,
  pessoa: 5,
  inicio: '2026-10-24T19:00',
  fim: '2026-10-25T07:00',
  situacao: 'informado',
  informadoPor: 'SINT.COORD',
  ...x,
});

describe('registro do realizado', () => {
  it('minutos: o noturno que atravessa a meia-noite (19:05 → 07:20 = 735 min)', () => {
    expect(minutosRealizado(ok)).toBe(735);
  });

  it('aceita o realizado dentro do plantão; recusa rascunho, cancelado, período, 36 h, futuro e fora do previsto', () => {
    expect(conferirRealizado(ok, plantao, AGORA, [], [])).toBeNull();
    expect(conferirRealizado(ok, { ...plantao, estadoEscala: 'rascunho' }, AGORA, [], [])?.codigo).toBe(
      'escala-em-rascunho',
    );
    expect(conferirRealizado(ok, { ...plantao, situacao: 'cancelado' }, AGORA, [], [])?.codigo).toBe(
      'plantao-cancelado',
    );
    expect(conferirRealizado({ inicio: ok.fim, fim: ok.inicio }, plantao, AGORA, [], [])?.codigo).toBe(
      'periodo-invalido',
    );
    expect(
      conferirRealizado(
        { inicio: '2026-10-24T19:00', fim: '2026-10-26T07:01' },
        plantao,
        '2026-10-27T00:00',
        [],
        [],
      )?.codigo,
    ).toBe('periodo-longo');
    expect(conferirRealizado(ok, plantao, '2026-10-25T07:00', [], [])?.codigo).toBe('fim-futuro');
    expect(
      conferirRealizado({ inicio: '2026-10-24T12:59', fim: '2026-10-25T07:00' }, plantao, AGORA, [], [])
        ?.codigo,
    ).toBe('fora-do-plantao');
    expect(
      conferirRealizado({ inicio: '2026-10-24T13:00', fim: '2026-10-25T07:00' }, plantao, AGORA, [], []),
    ).toBeNull();
    expect(
      conferirRealizado({ inicio: '2026-10-25T07:00', fim: '2026-10-25T08:00' }, plantao, AGORA, [], [])
        ?.codigo,
    ).toBe('fora-do-plantao');
  });

  it('o aprovado não é substituído; o informado do mesmo plantão é; não sobrepõe outro plantão da pessoa', () => {
    expect(conferirRealizado(ok, plantao, AGORA, [r({ situacao: 'aprovado' })], [])?.codigo).toBe(
      'ja-aprovado',
    );
    expect(conferirRealizado(ok, plantao, AGORA, [r()], [r()])).toBeNull();
    const outro = r({ id: 2, plantao: 11, inicio: '2026-10-25T07:00', fim: '2026-10-25T13:00' });
    expect(conferirRealizado(ok, plantao, AGORA, [], [outro])?.codigo).toBe('sobreposicao-realizado');
    expect(conferirRealizado(ok, plantao, AGORA, [], [{ ...outro, situacao: 'recusado' }])).toBeNull();
    expect(
      conferirRealizado({ inicio: '2026-10-24T19:05', fim: '2026-10-25T07:00' }, plantao, AGORA, [], [outro]),
    ).toBeNull();
  });
});

describe('decisão do realizado (quatro olhos)', () => {
  it('só o informado, por outra pessoa, nunca o próprio plantão', () => {
    const base = { situacao: 'informado' as const, informadoPor: 'SINT.COORD', proprio: false };
    expect(conferirDecisaoRealizado(base, 'SINT.APROVA')).toBeNull();
    expect(conferirDecisaoRealizado({ ...base, situacao: 'aprovado' }, 'SINT.APROVA')?.codigo).toBe(
      'ja-decidido',
    );
    expect(conferirDecisaoRealizado(base, 'SINT.COORD')?.codigo).toBe('quatro-olhos');
    expect(conferirDecisaoRealizado({ ...base, proprio: true }, 'SINT.APROVA')?.codigo).toBe(
      'proprio-plantao',
    );
  });
});

describe('tarifa e valor', () => {
  const tarifas = [
    { id: 1, tipo: 'presencial', unidade: null, inicio: '2026-01-01', fim: null, valorHora: 100 },
    { id: 2, tipo: 'presencial', unidade: 12, inicio: '2026-06-01', fim: '2026-12-31', valorHora: 120 },
    { id: 3, tipo: 'presencial', unidade: null, inicio: '2026-09-01', fim: null, valorHora: 110 },
    { id: 4, tipo: 'sobreaviso', unidade: null, inicio: '2026-01-01', fim: null, valorHora: 30 },
  ];

  it('vigente: a da unidade vence a geral; entre as gerais, a de início mais recente; fora do período, nenhuma', () => {
    expect(tarifaVigente(tarifas, 'presencial', 12, '2026-10-24')?.id).toBe(2);
    expect(tarifaVigente(tarifas, 'presencial', 7, '2026-10-24')?.id).toBe(3);
    expect(tarifaVigente(tarifas, 'presencial', 12, '2026-05-10')?.id).toBe(1);
    expect(tarifaVigente(tarifas, 'sobreaviso', 12, '2026-10-24')?.id).toBe(4);
    expect(tarifaVigente(tarifas, 'diarista', 12, '2026-10-24')).toBeNull();
    expect(tarifaVigente(tarifas, 'presencial', 12, '2025-12-31')).toBeNull();
  });

  it('tarifa nova: valor positivo, período, sem sobrepor a do mesmo tipo e unidade', () => {
    const e = { tipo: 'diarista', unidade: null, inicio: '2026-01-01', fim: null, valorHora: 80 };
    expect(conferirTarifa(e, tarifas)).toBeNull();
    expect(conferirTarifa({ ...e, valorHora: 0 }, tarifas)?.codigo).toBe('valor-invalido');
    expect(conferirTarifa({ ...e, fim: '2025-12-31' }, tarifas)?.codigo).toBe('periodo-invalido');
    expect(
      conferirTarifa({ ...e, tipo: 'presencial', unidade: 12, inicio: '2026-12-01' }, tarifas)?.codigo,
    ).toBe('vigencia-sobreposta');
    expect(
      conferirTarifa({ ...e, tipo: 'presencial', unidade: 12, inicio: '2027-01-01' }, tarifas),
    ).toBeNull();
  });

  it('aprovado sem tarifa: a tarifa incluída depois dá o valor pela vigente no dia; o que nenhuma alcança segue sem', () => {
    const rs = [
      { id: 10, minutos: 735, inicio: '2026-10-24T07:00', tipo: 'presencial', unidade: 12 },
      { id: 11, minutos: 60, inicio: '2026-10-24T07:00', tipo: 'diarista', unidade: 12 },
      { id: 12, minutos: 120, inicio: '2026-10-24T07:00', tipo: 'presencial', unidade: 7 },
    ];
    expect(valoracoesPelaTarifa(tarifas, rs)).toEqual([
      { id: 10, tarifa: 2, valorHora: 120, valor: 1470 },
      { id: 12, tarifa: 3, valorHora: 110, valor: 220 },
    ]);
    expect(valoracoesPelaTarifa([], rs)).toEqual([]);
  });

  it('valor: 735 min × R$ 120,00/h = R$ 1.470,00; 90 min × R$ 33,33/h = R$ 50,00 (49,995 arredonda)', () => {
    expect(valorRealizado(735, 120)).toEqual({
      minutos: 735,
      valorHora: 120,
      valor: 1470,
      parcelas: '12 h 15 min × R$ 120,00/h = R$ 1.470,00',
    });
    expect(valorRealizado(90, 33.33)).toMatchObject({
      valor: 50,
      parcelas: '1 h 30 min × R$ 33,33/h = R$ 50,00',
    });
    expect(valorRealizado(720, 100).parcelas).toBe('12 h × R$ 100,00/h = R$ 1.200,00');
  });
});

describe('repasse do realizado (só prestador)', () => {
  it('prestador: cooperado, PJ e terceiro; CLT, estatutário, residente e estagiário não', () => {
    expect(['cooperado', 'pj', 'terceiro'].every(vinculoNoRepasse)).toBe(true);
    expect(['clt', 'estatutario', 'residente', 'estagiario'].some(vinculoNoRepasse)).toBe(false);
  });

  it('competência pelo início real; data do lançamento: hoje na corrente, senão o último dia', () => {
    expect(competenciaDoRealizado('2026-09-30T19:00')).toBe('2026-09');
    expect(dataDoLancamento('2026-10', '2026-10-26')).toBe('2026-10-26');
    expect(dataDoLancamento('2026-09', '2026-10-26')).toBe('2026-09-30');
    expect(dataDoLancamento('2026-02', '2026-10-26')).toBe('2026-02-28');
  });

  const base: RealizadoParaRepasse = {
    id: 1,
    prestador: 4321,
    registro: 77,
    tipoVinculo: 'pj',
    situacao: 'aprovado',
    lancado: false,
    inicio: '2026-10-01T07:00',
    valor: 1200,
  };

  it('fora do repasse: não aprovado, já lançado, CLT, sem registro, sem tarifa', () => {
    expect(motivoForaDoRepasse(base)).toBeNull();
    expect(motivoForaDoRepasse({ ...base, situacao: 'informado' })).toMatch(/aprovado/);
    expect(motivoForaDoRepasse({ ...base, lancado: true })).toMatch(/lançado/);
    expect(motivoForaDoRepasse({ ...base, tipoVinculo: 'clt' })).toMatch(/folha/);
    expect(motivoForaDoRepasse({ ...base, registro: null })).toMatch(/registro/);
    expect(motivoForaDoRepasse({ ...base, valor: null })).toMatch(/tarifa/);
  });

  it('grupos por prestador × competência com a soma escrita (1.200,00 + 600,00 = 1.800,00)', () => {
    const rs: RealizadoParaRepasse[] = [
      base,
      { ...base, id: 2, valor: 600, inicio: '2026-10-05T19:00' },
      { ...base, id: 3, inicio: '2026-09-28T07:00', valor: 300 },
      { ...base, id: 4, prestador: 1000, registro: 5, valor: 450.5 },
      { ...base, id: 5, tipoVinculo: 'clt' },
    ];
    expect(gruposRepasse(rs)).toEqual([
      {
        prestador: 1000,
        registro: 5,
        competencia: '2026-10',
        realizados: [4],
        valor: 450.5,
        parcelas: 'R$ 450,50',
      },
      {
        prestador: 4321,
        registro: 77,
        competencia: '2026-09',
        realizados: [3],
        valor: 300,
        parcelas: 'R$ 300,00',
      },
      {
        prestador: 4321,
        registro: 77,
        competencia: '2026-10',
        realizados: [1, 2],
        valor: 1800,
        parcelas: 'R$ 1.200,00 + R$ 600,00 = R$ 1.800,00',
      },
    ]);
  });
});

describe('sugestão pelo ponto', () => {
  it('a primeira e a última marcação na janela do plantão (± 2 h); menos de duas, nenhuma', () => {
    const ms = [
      '2026-10-24T16:30',
      '2026-10-24T18:52',
      '2026-10-25T01:00',
      '2026-10-25T07:14',
      '2026-10-25T09:30',
    ];
    expect(sugestaoDoPonto(plantao, ms)).toEqual({ inicio: '2026-10-24T18:52', fim: '2026-10-25T07:14' });
    expect(sugestaoDoPonto(plantao, ['2026-10-24T18:52'])).toBeNull();
    expect(sugestaoDoPonto(plantao, [])).toBeNull();
  });
});
