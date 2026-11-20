// Lactário (M45, etapa 6): porções a partir do preparo, validade, conferência por outra pessoa e os totais do dia.
import { esquemaRegistrarOrdemLactario } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  arredondar,
  ErroEspecialidade,
  idadeEmAnos,
  minutosEntreCivis,
  decimalBr,
  somarHorasCivil,
} from './comum.js';
import {
  conferirConferencia,
  conferirEtiquetaLactario,
  conferirOrdemLactario,
  ordemVencida,
  porcoesDaOrdem,
  totaisDoLactario,
} from './lactario.js';

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroEspecialidade ? e.codigo : `outro: ${String(e)}`;
  }
  return 'passou';
};
const ordem = (x: Record<string, unknown> = {}) =>
  esquemaRegistrarOrdemLactario.parse({
    internacao: 1,
    formula: 'Fórmula infantil de partida SINTETICA',
    volumeMl: 90,
    horarios: ['21:00', '09:00', '12:00', '15:00'],
    preparoEm: '2026-10-25T08:00',
    ...x,
  });
const V = '2026-10-26T08:00';
const AG = '2026-10-25T09:00';
const C = { agora: '2026-10-25T08:30', validadeHoras: 24, admissao: '2026-10-20T10:00' };

describe('ordem do lactário', () => {
  it('as porções em ordem a partir do preparo (o horário antes do preparo é do dia seguinte)', () => {
    expect(porcoesDaOrdem('2026-10-25T08:00', ['06:00', '09:00'])).toEqual([
      { horario: '09:00', em: '2026-10-25T09:00' },
      { horario: '06:00', em: '2026-10-26T06:00' },
    ]);
    const r = conferirOrdemLactario(ordem(), C);
    expect(r.validadeEm).toBe('2026-10-26T08:00');
    expect(r.porcoes.map((p) => p.horario)).toEqual(['09:00', '12:00', '15:00', '21:00']);
  });

  it('recusa horário repetido, depois da validade, preparo no futuro e antes da admissão', () => {
    expect(erro(() => conferirOrdemLactario(ordem({ horarios: ['09:00', '09:00'] }), C))).toBe(
      'horario-repetido',
    );
    expect(
      erro(() => conferirOrdemLactario(ordem({ horarios: ['09:00', '21:00'] }), { ...C, validadeHoras: 12 })),
    ).toBe('horario-apos-validade');
    expect(erro(() => conferirOrdemLactario(ordem({ preparoEm: '2026-10-25T10:00' }), C))).toBe(
      'instante-futuro',
    );
    expect(
      erro(() =>
        conferirOrdemLactario(ordem({ preparoEm: '2026-10-19T10:00' }), { ...C, agora: '2026-10-25T08:30' }),
      ),
    ).toBe('antes-da-admissao');
  });

  it('a conferência é de outra pessoa, uma vez só', () => {
    expect(
      erro(() =>
        conferirConferencia(
          { por: 'SINT.LACTARIO', conferidoPor: null, validadeEm: V },
          'sint.lactario ',
          AG,
        ),
      ),
    ).toBe('conferente-e-preparador');
    expect(
      erro(() =>
        conferirConferencia({ por: 'SINT.LACTARIO', conferidoPor: 'X', validadeEm: V }, 'OUTRO', AG),
      ),
    ).toBe('ordem-ja-conferida');
    expect(
      erro(() =>
        conferirConferencia(
          { por: 'SINT.LACTARIO', conferidoPor: null, validadeEm: V },
          'SINT.LACTARIO2',
          AG,
        ),
      ),
    ).toBe('passou');
  });

  it('a ordem vencida não é conferida nem etiquetada (a validade conferida no relógio de agora)', () => {
    expect(ordemVencida(V, '2026-10-26T07:59')).toBe(false);
    expect(ordemVencida(V, V)).toBe(true);
    expect(
      erro(() =>
        conferirConferencia({ por: 'SINT.LACTARIO', conferidoPor: null, validadeEm: V }, 'SINT.LACTARIO2', V),
      ),
    ).toBe('ordem-vencida');
    const conferida = { situacao: 'conferida', conferidoPor: 'SINT.LACTARIO2', validadeEm: V };
    expect(erro(() => conferirEtiquetaLactario(conferida, AG))).toBe('passou');
    expect(erro(() => conferirEtiquetaLactario(conferida, '2026-10-26T08:01'))).toBe('ordem-vencida');
    expect(
      erro(() => conferirEtiquetaLactario({ situacao: 'preparada', conferidoPor: null, validadeEm: V }, AG)),
    ).toBe('ordem-nao-conferida');
  });

  it('os totais por fórmula com as parcelas', () => {
    expect(
      totaisDoLactario([
        { formula: 'B', volumeMl: 60, horarios: ['09:00', '12:00'] },
        { formula: 'a', volumeMl: 90, horarios: ['09:00'] },
        { formula: 'A', volumeMl: 30, horarios: ['15:00', '18:00'] },
      ]),
    ).toEqual([
      { formula: 'a', porcoes: 3, volumeMl: 150 },
      { formula: 'B', porcoes: 2, volumeMl: 120 },
    ]);
  });
});

describe('apoio comum', () => {
  it('arredonda, escreve com vírgula, soma horas, conta minutos e a idade', () => {
    expect(arredondar(1.005, 2)).toBe(1.01);
    expect(decimalBr(2.5, 2)).toBe('2,50');
    expect(somarHorasCivil('2026-12-31T20:00', 6)).toBe('2027-01-01T02:00');
    expect(minutosEntreCivis('2026-10-25', '2026-10-25T01:30')).toBe(90);
    expect(idadeEmAnos('1990-10-26', '2026-10-25')).toBe(35);
    expect(idadeEmAnos('1990-10-25', '2026-10-25')).toBe(36);
    expect(idadeEmAnos('1899-12-30', '2026-10-25')).toBeNull();
    expect(idadeEmAnos(null, '2026-10-25')).toBeNull();
    expect(idadeEmAnos('2030-01-01', '2026-10-25')).toBeNull();
  });
});
