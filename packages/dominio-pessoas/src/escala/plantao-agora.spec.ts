// Regra 10 (ficha do M52, seção 8), parte pura: o plantão em curso no instante (o noturno que atravessa a meia-noite),
// o sobreaviso com o tempo de chegada, o acionamento e a chegada. A consulta no banco é provada em
// apps/api/src/modulos/pessoas/aplicacao/plantao-agora.int.spec.ts.
import { describe, expect, it } from 'vitest';
import {
  atrasado,
  comecouAntesDoDia,
  conferirAcionamento,
  conferirChegada,
  instanteDaChegada,
  emCursoNoInstante,
  instanteEmBrasilia,
  janelaDoInstante,
  plantoesNoInstante,
  prazoDeChegada,
} from './plantao-agora.js';

const noturno = {
  id: 3,
  tipo: 'presencial',
  situacao: 'previsto',
  inicio: '2026-11-01T19:00',
  fim: '2026-11-02T07:00',
};
const diurno = {
  id: 1,
  tipo: 'presencial',
  situacao: 'previsto',
  inicio: '2026-11-02T07:00',
  fim: '2026-11-02T19:00',
};
const sobre = {
  id: 2,
  tipo: 'sobreaviso',
  situacao: 'previsto',
  inicio: '2026-11-02T00:00',
  fim: '2026-11-03T00:00',
};

describe('quem está de plantão agora (regra 10)', () => {
  it('o noturno às 2 h do dia seguinte está em curso e começou ontem; às 7 h, já acabou', () => {
    expect(emCursoNoInstante(noturno, '2026-11-02T02:00')).toBe(true);
    expect(comecouAntesDoDia(noturno, '2026-11-02T02:00')).toBe(true);
    expect(comecouAntesDoDia(noturno, '2026-11-01T23:00')).toBe(false);
    expect(emCursoNoInstante(noturno, '2026-11-02T07:00')).toBe(false);
    expect(emCursoNoInstante(noturno, '2026-11-01T18:59')).toBe(false);
    expect(emCursoNoInstante(noturno, '2026-11-01T19:00')).toBe(true);
  });

  it('a lista no instante: só os previstos em curso, presencial antes do sobreaviso', () => {
    const cancelado = { ...diurno, id: 9, situacao: 'cancelado' };
    expect(
      plantoesNoInstante([sobre, noturno, diurno, cancelado], '2026-11-02T06:30').map((p) => p.id),
    ).toEqual([3, 2]);
    expect(
      plantoesNoInstante([sobre, noturno, diurno, cancelado], '2026-11-02T07:00').map((p) => p.id),
    ).toEqual([1, 2]);
    expect(
      plantoesNoInstante(
        [
          { ...sobre, tipo: 'outro' },
          { ...diurno, tipo: 'diarista' },
        ],
        '2026-11-02T08:00',
      ).map((p) => p.tipo),
    ).toEqual(['diarista', 'outro']);
  });

  it('a janela do índice: o início nas 24 h antes do instante', () => {
    expect(janelaDoInstante('2026-11-02T02:00')).toEqual({
      inicioDesde: '2026-11-01T02:00',
      ate: '2026-11-02T02:01',
    });
  });

  it('o agora de Brasília (UTC−3, sem horário de verão)', () => {
    expect(instanteEmBrasilia(new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-02T02:30');
    expect(instanteEmBrasilia(new Date('2026-11-02T02:59:00Z'))).toBe('2026-11-01T23:59');
  });
});

describe('acionamento do sobreaviso', () => {
  const p = { ...sobre, chegadaMin: 30, estadoEscala: 'publicada' };
  it('aciona o sobreaviso em curso, com o prazo de chegada', () => {
    const r = conferirAcionamento(p, '2026-11-02T23:50', 0);
    expect(r).toEqual({ ok: true, prazoChegada: '2026-11-03T00:20' });
    expect(prazoDeChegada('2026-11-02T10:00', 45)).toBe('2026-11-02T10:45');
  });
  it('recusas', () => {
    const c = (x: object, agora = '2026-11-02T10:00', abertos = 0) => {
      const r = conferirAcionamento({ ...p, ...x }, agora, abertos);
      return r.ok ? 'ok' : r.codigo;
    };
    expect(c({ tipo: 'presencial' })).toBe('nao-e-sobreaviso');
    expect(c({ situacao: 'cancelado' })).toBe('plantao-cancelado');
    expect(c({ estadoEscala: 'rascunho' })).toBe('escala-em-rascunho');
    expect(c({}, '2026-11-03T00:00')).toBe('fora-do-sobreaviso');
    expect(c({}, '2026-11-02T10:00', 1)).toBe('ja-acionado');
    expect(conferirAcionamento({ ...p, chegadaMin: null }, '2026-11-02T10:00', 0)).toEqual({
      ok: true,
      prazoChegada: '2026-11-02T10:00',
    });
  });
  it('chegada e atraso', () => {
    const a = { situacao: 'acionado', acionadoEm: '2026-11-02T10:00' };
    expect(conferirChegada(a, '2026-11-02T10:25', '2026-11-02T10:30').ok).toBe(true);
    const cod = (r: { ok: boolean; codigo?: string }) => (r.ok ? 'ok' : r.codigo);
    expect(cod(conferirChegada(a, '2026-11-02T09:59', '2026-11-02T10:30'))).toBe('chegada-antes');
    expect(cod(conferirChegada(a, '2026-11-02T10:31', '2026-11-02T10:30'))).toBe('chegada-futura');
    expect(cod(conferirChegada({ ...a, situacao: 'chegou' }, '2026-11-02T10:20', '2026-11-02T10:30'))).toBe(
      'acionamento-encerrado',
    );
    const prazo = '2026-11-02T10:30';
    expect(atrasado({ situacao: 'chegou', prazoChegada: prazo, chegouEm: '2026-11-02T10:31' }, prazo)).toBe(
      true,
    );
    expect(atrasado({ situacao: 'chegou', prazoChegada: prazo, chegouEm: '2026-11-02T10:30' }, prazo)).toBe(
      false,
    );
    expect(atrasado({ situacao: 'acionado', prazoChegada: prazo, chegouEm: null }, '2026-11-02T10:31')).toBe(
      true,
    );
    expect(atrasado({ situacao: 'acionado', prazoChegada: prazo, chegouEm: null }, '2026-11-02T10:29')).toBe(
      false,
    );
    expect(atrasado({ situacao: 'cancelado', prazoChegada: prazo, chegouEm: null }, '2026-11-02T11:00')).toBe(
      false,
    );
  });
});

describe('o instante da chegada pela hora informada', () => {
  it('no dia do acionamento; a hora antes da do acionamento é do dia seguinte (acionado às 23h50, chega às 00h20)', () => {
    expect(instanteDaChegada('2026-11-02T10:00', '10:25')).toBe('2026-11-02T10:25');
    expect(instanteDaChegada('2026-11-02T23:50', '00:20')).toBe('2026-11-03T00:20');
    expect(instanteDaChegada('2026-12-31T23:50', '00:05')).toBe('2027-01-01T00:05');
    expect(instanteDaChegada('2026-11-02T23:50', '23:50')).toBe('2026-11-02T23:50');
    const a = { situacao: 'acionado', acionadoEm: '2026-11-02T23:50' };
    expect(conferirChegada(a, instanteDaChegada(a.acionadoEm, '00:20'), '2026-11-03T00:30').ok).toBe(true);
    expect(() => instanteDaChegada('2026-11-02T10:00', '1025')).toThrow();
  });
});
