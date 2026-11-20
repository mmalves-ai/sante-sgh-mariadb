// W0-03, mercado M5: as regras da contenção mecânica (checagem aprazada, situação, atraso e indicador).
import { describe, expect, it } from 'vitest';
import {
  checagensAtrasadas,
  conferirOrdem,
  fimDaOrdem,
  horariosDeChecagem,
  indicadorContencao,
  PARAMETROS_CONTENCAO_PADRAO,
  situacaoDaOrdem,
} from './contencao.js';

const ORDEM = {
  id: 1,
  inicio: '2026-11-18T08:00',
  prazoHoras: 4,
  intervaloMinutos: 60,
  encerradaEm: null,
  encerramento: null,
  renovadaPor: null,
};

describe('contenção mecânica', () => {
  it('a ordem apraza a checagem a cada intervalo até o fim do prazo', () => {
    expect(fimDaOrdem(ORDEM)).toBe('2026-11-18T12:00');
    expect(horariosDeChecagem(ORDEM)).toEqual([
      '2026-11-18T09:00',
      '2026-11-18T10:00',
      '2026-11-18T11:00',
      '2026-11-18T12:00',
    ]);
    expect(horariosDeChecagem({ ...ORDEM, intervaloMinutos: 90 })).toHaveLength(2);
  });

  it('situação: ativa no prazo, vencida depois sem retirada, retirada e renovada', () => {
    expect(situacaoDaOrdem(ORDEM, '2026-11-18T11:59')).toBe('ativa');
    expect(situacaoDaOrdem(ORDEM, '2026-11-18T12:01')).toBe('vencida');
    expect(
      situacaoDaOrdem(
        { ...ORDEM, encerradaEm: '2026-11-18T10:00', encerramento: 'retirada' },
        '2026-11-18T13:00',
      ),
    ).toBe('retirada');
    expect(situacaoDaOrdem({ ...ORDEM, renovadaPor: 2 }, '2026-11-18T13:00')).toBe('renovada');
  });

  it('o prazo acima do parâmetro é recusado; o intervalo tem de caber no prazo', () => {
    const p = { ...PARAMETROS_CONTENCAO_PADRAO, prazoMaximoHoras: 12 };
    expect(conferirOrdem({ prazoHoras: 12, intervaloMinutos: 60 }, p)).toEqual({ ok: true });
    expect(conferirOrdem({ prazoHoras: 13, intervaloMinutos: 60 }, p)).toMatchObject({
      codigo: 'prazo-acima-do-maximo',
    });
    expect(conferirOrdem({ prazoHoras: 1, intervaloMinutos: 90 }, p)).toMatchObject({
      codigo: 'intervalo-maior-que-prazo',
    });
  });

  it('checagem atrasada: horário passado da tolerância sem registro', () => {
    const prev = horariosDeChecagem(ORDEM);
    expect(checagensAtrasadas(prev, [{ previsto: '2026-11-18T09:00' }], '2026-11-18T10:10', 15)).toEqual([]);
    expect(checagensAtrasadas(prev, [{ previsto: '2026-11-18T09:00' }], '2026-11-18T10:16', 15)).toEqual([
      '2026-11-18T10:00',
    ]);
  });

  it('indicador com numerador e denominador: renovação não é contenção nova; inativada não conta', () => {
    const i = indicadorContencao(
      [
        { ...ORDEM, encerradaEm: '2026-11-18T10:30', encerramento: 'retirada', renovaAnterior: false },
        { ...ORDEM, id: 2, inicio: '2026-11-18T12:00', renovaAnterior: true },
        {
          ...ORDEM,
          id: 3,
          encerradaEm: '2026-11-18T08:05',
          encerramento: 'inativacao',
          renovaAnterior: false,
        },
      ],
      [
        { previsto: '2026-11-18T09:00', feitaEm: '2026-11-18T09:10' },
        { previsto: '2026-11-18T10:00', feitaEm: '2026-11-18T10:40' },
      ],
      4,
      250,
      '2026-11-18T14:00',
      15,
    );
    expect(i.contencoes).toEqual({ numerador: 1, denominador: 250, por1000: 4 });
    // 2,5 h da primeira (8:00 a 10:30) + 2 h da renovação (12:00 ao fim do período, 14:00).
    expect(i.horasContidas).toBe(4.5);
    expect(i.checagensNoPrazo).toEqual({ numerador: 1, denominador: 4, percentual: 25 });
    expect(indicadorContencao([], [], 0, 0, '2026-11-18T14:00', 15).contencoes.por1000).toBeNull();
  });
});
