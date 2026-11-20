// W0-03, mercado M2: as regras do TRR e da PCR (sem banco): a ficha Utstein conferida, a mediana e os indicadores com
// o numerador e o denominador. Dados sintéticos.
import type { DadosPcr } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conferirFichaPcr, indicadoresTrrPcr, mediana } from './trr.js';

const D: DadosPcr = {
  presenciada: true,
  monitorizada: false,
  ritmoInicial: 'fv',
  colapsoEm: '2031-01-06T10:00',
  rcpEm: '2031-01-06T10:01',
  desfibrilacaoEm: '2031-01-06T10:03',
  adrenalinaEm: null,
  viaAereaAvancada: false,
  rceEm: '2031-01-06T10:09',
  fimEm: null,
  desfecho: 'rceSustentado',
};
const AGORA = '2031-01-06T11:00';

describe('W0-03, M2: ficha Utstein', () => {
  it('aceita a sequência certa (rascunho e finalizada)', () => {
    expect(conferirFichaPcr(D, true, AGORA)).toBeNull();
    expect(conferirFichaPcr({ ...D, desfecho: null, rceEm: null }, false, AGORA)).toBeNull();
  });
  it('recusa as horas fora de ordem, o colapso no futuro e a finalizada sem desfecho', () => {
    expect(conferirFichaPcr({ ...D, rcpEm: '2031-01-06T09:59' }, false, AGORA)?.codigo).toBe(
      'rcp-antes-do-colapso',
    );
    expect(conferirFichaPcr({ ...D, desfibrilacaoEm: '2031-01-06T10:00' }, false, AGORA)?.codigo).toBe(
      'desfibrilacao-antes-da-rcp',
    );
    expect(conferirFichaPcr({ ...D, adrenalinaEm: '2031-01-06T10:00' }, false, AGORA)?.codigo).toBe(
      'adrenalina-antes-da-rcp',
    );
    expect(conferirFichaPcr({ ...D, rceEm: '2031-01-06T10:00' }, false, AGORA)?.codigo).toBe(
      'rce-antes-da-rcp',
    );
    expect(conferirFichaPcr({ ...D, fimEm: '2031-01-06T10:00' }, false, AGORA)?.codigo).toBe(
      'fim-antes-da-rcp',
    );
    expect(conferirFichaPcr({ ...D, rceEm: null }, false, AGORA)?.codigo).toBe('rce-sem-hora');
    expect(conferirFichaPcr({ ...D, desfecho: null }, true, AGORA)?.codigo).toBe('finalizada-sem-desfecho');
    expect(conferirFichaPcr({ ...D, colapsoEm: '2031-01-06T12:00' }, false, AGORA)?.codigo).toBe(
      'colapso-no-futuro',
    );
  });
});

describe('W0-03, M2: indicadores', () => {
  it('mediana', () => {
    expect(mediana([])).toBeNull();
    expect(mediana([7, 3, 5])).toBe(5);
    expect(mediana([2, 4, 6, 9])).toBe(5);
  });
  it('PCR por 1.000 pacientes-dia fora da UTI (só as finalizadas) e a chegada no prazo, com numerador e denominador', () => {
    const r = indicadoresTrrPcr(
      [
        { alertaEm: '2031-01-06T10:00', acionadoEm: '2031-01-06T10:04', chegadaEm: '2031-01-06T10:07' },
        { alertaEm: null, acionadoEm: '2031-01-06T12:00', chegadaEm: '2031-01-06T12:09' },
        { alertaEm: '2031-01-06T13:00', acionadoEm: '2031-01-06T13:02', chegadaEm: null },
      ],
      [
        { uti: false, situacao: 'finalizada' },
        { uti: false, situacao: 'rascunho' },
        { uti: true, situacao: 'finalizada' },
      ],
      400,
      5,
    );
    expect(r.pcrForaUti).toEqual({ numerador: 1, denominador: 400, por1000: 2.5 });
    expect(r.tempoResposta).toEqual({
      medianaMinutos: 6,
      noPrazo: { numerador: 1, denominador: 2, percentual: 50 },
      metaMinutos: 5,
    });
    expect(r.alertaAteAcionar).toEqual({ medianaMinutos: 3, n: 2 });
    expect(indicadoresTrrPcr([], [], 0, 5).pcrForaUti.por1000).toBeNull();
  });
});
