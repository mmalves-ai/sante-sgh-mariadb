// Regra 9 (ficha do M21): os estados da higienização no novo, a conclusão com o checklist, a precaução de contato que
// exige a terminal com o protocolo da CCIH, o cronômetro sem as pausas, o prazo por tipo × criticidade e a fila.
import { describe, expect, it } from 'vitest';
import {
  atrasada,
  conferirEtapa,
  limpezaAberta,
  minutosEmExecucao,
  ordenarFila,
  podeTransitar,
  prazoMinutos,
  situacaoLegadoDaEtapa,
  CHECKLIST_PADRAO,
  ITEM_PROTOCOLO_CCIH,
  TIPO_TERMINAL,
} from './limpeza.js';

const min = (m: number) => m * 60_000;

describe('estados da higienização', () => {
  it('Solicitado → Atribuído → Em execução → Concluído → Inspecionado → Liberado; reprovação volta', () => {
    expect(podeTransitar('solicitado', 'atribuido')).toBe(true);
    expect(podeTransitar('atribuido', 'emExecucao')).toBe(true);
    expect(podeTransitar('emExecucao', 'pausado')).toBe(true);
    expect(podeTransitar('pausado', 'emExecucao')).toBe(true);
    expect(podeTransitar('emExecucao', 'concluido')).toBe(true);
    expect(podeTransitar('concluido', 'reprovado')).toBe(true);
    expect(podeTransitar('reprovado', 'emExecucao')).toBe(true);
    expect(podeTransitar('concluido', 'inspecionado')).toBe(true);
    expect(podeTransitar('inspecionado', 'liberado')).toBe(true);
    expect(podeTransitar('solicitado', 'liberado')).toBe(false);
    expect(podeTransitar('liberado', 'emExecucao')).toBe(false);
    expect(podeTransitar('cancelado', 'atribuido')).toBe(false);
    expect(limpezaAberta('liberado')).toBe(false);
    expect(limpezaAberta('pausado')).toBe(true);
  });

  it('a conclusão exige o checklist; a precaução exige a terminal e o protocolo; o início, o profissional', () => {
    const base = {
      atual: 'emExecucao' as const,
      pedida: 'concluido' as const,
      tipoLimpeza: 3,
      precaucao: null,
      checklist: [...CHECKLIST_PADRAO],
      profissional: 7,
    };
    expect(conferirEtapa(base)).toBeNull();
    expect(conferirEtapa({ ...base, checklist: ['piso'] })).toMatch(/checklist/);
    expect(conferirEtapa({ ...base, precaucao: 'contato' })).toMatch(/terminal/);
    expect(conferirEtapa({ ...base, precaucao: 'contato', tipoLimpeza: TIPO_TERMINAL })).toMatch(/CCIH/);
    expect(
      conferirEtapa({
        ...base,
        precaucao: 'contato',
        tipoLimpeza: TIPO_TERMINAL,
        checklist: [...CHECKLIST_PADRAO, ITEM_PROTOCOLO_CCIH],
      }),
    ).toBeNull();
    expect(conferirEtapa({ ...base, atual: 'solicitado', pedida: 'emExecucao', profissional: null })).toMatch(
      /profissional/,
    );
    expect(conferirEtapa({ ...base, atual: 'solicitado', pedida: 'liberado' })).toMatch(/não passa/);
  });

  it('o legado acompanha só nos valores gravados (2 na atribuição e no início; 3 e 4 ficam no novo)', () => {
    expect(situacaoLegadoDaEtapa('atribuido')).toBe(2);
    expect(situacaoLegadoDaEtapa('emExecucao')).toBe(2);
    expect(situacaoLegadoDaEtapa('liberado')).toBeNull();
    expect(situacaoLegadoDaEtapa('inspecionado')).toBeNull();
  });

  it('o cronômetro não conta as pausas', () => {
    const marcas = [
      { etapa: 'solicitado' as const, em: 0 },
      { etapa: 'emExecucao' as const, em: min(10) },
      { etapa: 'pausado' as const, em: min(20) },
      { etapa: 'emExecucao' as const, em: min(50) },
      { etapa: 'concluido' as const, em: min(65) },
    ];
    expect(minutosEmExecucao(marcas, min(100))).toBe(25);
    expect(minutosEmExecucao(marcas.slice(0, 4), min(60))).toBe(20);
    expect(minutosEmExecucao([], min(60))).toBe(0);
  });

  it('o prazo por tipo e criticidade; a fila põe as atrasadas primeiro', () => {
    const p = { terminalMinutos: 120, concorrenteMinutos: 60, fatorCritica: 75 };
    expect(prazoMinutos(TIPO_TERMINAL, 3, p)).toBe(120);
    expect(prazoMinutos(TIPO_TERMINAL, 1, p)).toBe(90);
    expect(prazoMinutos(3, null, p)).toBe(60);
    expect(atrasada(min(10), 'emExecucao', min(20))).toBe(true);
    expect(atrasada(min(10), 'liberado', min(20))).toBe(false);
    expect(atrasada(null, 'emExecucao', min(20))).toBe(false);
    const fila = ordenarFila(
      [
        { id: 1, etapa: 'solicitado' as const, prazo: min(100), solicitadaEm: 0 },
        { id: 2, etapa: 'atribuido' as const, prazo: min(5), solicitadaEm: 1 },
        { id: 3, etapa: 'liberado' as const, prazo: min(1), solicitadaEm: 2 },
        { id: 4, etapa: 'solicitado' as const, prazo: null, solicitadaEm: 3 },
        { id: 5, etapa: 'solicitado' as const, prazo: min(50), solicitadaEm: 4 },
      ],
      min(10),
    );
    expect(fila.map((f) => f.id)).toEqual([2, 5, 1, 4]);
  });
});
