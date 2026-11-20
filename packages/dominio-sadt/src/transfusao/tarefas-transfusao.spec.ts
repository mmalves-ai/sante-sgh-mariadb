// Regra 4 (ficha do M47): sinais vitais antes, aos 10 a 15 minutos e depois, como tarefa na linha do tempo do turno.
import { describe, expect, it } from 'vitest';
import { medidaForaDaJanela, sinaisCompletos, tarefasDoAto } from './tarefas-transfusao.js';

const INICIO = '2026-10-24T10:00:00';

describe('tarefas do ato (regra 4)', () => {
  it('em curso: durante aguarda os 10 minutos, fica devida e depois atrasada', () => {
    const em = (agora: string) =>
      tarefasDoAto({ inicioEm: INICIO, terminoEm: null, estado: 'emCurso', feitos: ['antes'], agora });
    expect(em('2026-10-24T10:05:00').map((t) => [t.momento, t.situacao])).toEqual([
      ['antes', 'feita'],
      ['durante', 'aguardando'],
      ['depois', 'aguardando'],
    ]);
    expect(em('2026-10-24T10:12:00')[1]).toEqual({
      momento: 'durante',
      abreEm: '2026-10-24T10:10:00',
      atrasaEm: '2026-10-24T10:15:00',
      situacao: 'devida',
    });
    expect(em('2026-10-24T10:16:00')[1]?.situacao).toBe('atrasada');
  });

  it('concluído: depois devida até a janela, atrasada depois', () => {
    const fim = (agora: string, feitos: ('antes' | 'durante' | 'depois')[]) =>
      tarefasDoAto({
        inicioEm: INICIO,
        terminoEm: '2026-10-24T12:00:00',
        estado: 'concluido',
        feitos,
        agora,
        janelaDepoisMin: 30,
      });
    expect(fim('2026-10-24T12:10:00', ['antes', 'durante'])[2]?.situacao).toBe('devida');
    expect(fim('2026-10-24T12:31:00', ['antes', 'durante'])[2]?.situacao).toBe('atrasada');
    const todas = fim('2026-10-24T12:31:00', ['antes', 'durante', 'depois']);
    expect(sinaisCompletos(todas)).toBe(true);
    expect(sinaisCompletos(fim('2026-10-24T12:31:00', ['durante', 'depois']))).toBe(false);
  });

  it('interrompido antes dos 10 minutos: sem a tarefa durante', () => {
    const t = tarefasDoAto({
      inicioEm: INICIO,
      terminoEm: '2026-10-24T10:04:00',
      estado: 'interrompido',
      feitos: ['antes', 'depois'],
      agora: '2026-10-24T10:30:00',
    });
    expect(t.map((x) => x.momento)).toEqual(['antes', 'depois']);
    expect(sinaisCompletos(t)).toBe(true);
  });

  it('medida durante fora da janela de 10 a 15 minutos é marcada', () => {
    expect(medidaForaDaJanela('durante', INICIO, '2026-10-24T10:12:00')).toBe(false);
    expect(medidaForaDaJanela('durante', INICIO, '2026-10-24T10:05:00')).toBe(true);
    expect(medidaForaDaJanela('durante', INICIO, '2026-10-24T10:20:00')).toBe(true);
    expect(medidaForaDaJanela('depois', INICIO, '2026-10-24T10:05:00')).toBe(false);
  });
});
