// Regras 1 e 2 (ficha do M29): a fila nasce dos horários na janela por unidade, separada por paciente e horário; a dose
// dispensada por qualquer dos dois sistemas e a suspensa somem; a ocupada passa à seguinte. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  classeDoItem,
  type DoseNaFila,
  JANELA_PADRAO_HORAS,
  janelaDaFila,
  montarFila,
  proximaLivre,
} from '@sgh/contratos/regras-suprimentos';

const dose = (o: Partial<DoseNaFila>): DoseNaFila => ({
  horario: 1,
  atendimento: 100,
  paciente: 10,
  leito: '101-A',
  item: 7,
  descricao: 'DIPIRONA SINTETICA',
  previsto: '2026-10-23T08:00',
  quantidade: 1,
  classe: 'comum',
  urgente: false,
  agora: false,
  dispensada: false,
  suspensa: false,
  validada: true,
  ...o,
});

describe('janela da fila (regra 1)', () => {
  it('padrão de 12 h; parâmetro fora dos limites cai no padrão; fração é truncada', () => {
    expect(janelaDaFila('2026-10-23T06:00:00', null)).toEqual({
      inicio: '2026-10-23T06:00',
      fim: '2026-10-23T18:00',
    });
    expect(JANELA_PADRAO_HORAS).toBe(12);
    expect(janelaDaFila('2026-10-23T22:00', 6).fim).toBe('2026-10-24T04:00');
    expect(janelaDaFila('2026-10-23T22:00', 0).fim).toBe('2026-10-24T10:00');
    expect(janelaDaFila('2026-10-23T22:00', 49).fim).toBe('2026-10-24T10:00');
    expect(janelaDaFila('2026-10-23T22:00', 2.7).fim).toBe('2026-10-24T00:00');
  });
});

describe('montar a fila (regras 1 e 2)', () => {
  const janela = { inicio: '2026-10-23T06:00', fim: '2026-10-23T18:00' };
  it('separa por paciente (ordem do leito) e por horário; urgente primeiro no mesmo horário', () => {
    const f = montarFila(
      [
        dose({ horario: 1, atendimento: 200, leito: '110-B', previsto: '2026-10-23T08:00' }),
        dose({ horario: 2, atendimento: 100, leito: '102-A', previsto: '2026-10-23T10:00' }),
        dose({ horario: 3, atendimento: 100, leito: '102-A', previsto: '2026-10-23T08:00' }),
        dose({ horario: 4, atendimento: 100, leito: '102-A', previsto: '2026-10-23T08:00', urgente: true }),
        dose({ horario: 5, atendimento: 300, leito: '102-A', previsto: '2026-10-23T09:00', agora: true }),
      ],
      janela,
    );
    expect(f.total).toBe(5);
    expect(f.cortada).toBe(false);
    expect(f.pacientes.map((p) => p.atendimento)).toEqual([100, 300, 200]);
    const p100 = f.pacientes[0]!;
    expect(p100.horarios.map((h) => h.previsto)).toEqual(['2026-10-23T08:00', '2026-10-23T10:00']);
    expect(p100.horarios[0]!.doses.map((d) => d.horario)).toEqual([4, 3]);
  });
  it('a dose dispensada (por qualquer sistema), a suspensa e a fora da janela somem', () => {
    const f = montarFila(
      [
        dose({ horario: 1, dispensada: true }),
        dose({ horario: 2, suspensa: true }),
        dose({ horario: 3, previsto: '2026-10-23T18:00' }),
        dose({ horario: 4, previsto: '2026-10-23T05:59' }),
        dose({ horario: 5 }),
      ],
      janela,
    );
    expect(f.pacientes.flatMap((p) => p.horarios.flatMap((h) => h.doses.map((d) => d.horario)))).toEqual([5]);
  });
  it('corta no teto e avisa', () => {
    const doses = Array.from({ length: 7 }, (_, k) => dose({ horario: k + 1 }));
    const f = montarFila(doses, janela, 5);
    expect(f.total).toBe(5);
    expect(f.cortada).toBe(true);
  });
  it('fila vazia', () => {
    expect(montarFila([], janela)).toEqual({ pacientes: [], total: 0, cortada: false });
  });
});

describe('fila disputada (regra 2): ocupada passa à seguinte', () => {
  it('a primeira livre; todas ocupadas: null', () => {
    const ocupadas = new Set([1, 2]);
    expect(proximaLivre([1, 2, 3, 4], (x) => ocupadas.has(x))).toBe(3);
    expect(proximaLivre([1, 2], (x) => ocupadas.has(x))).toBeNull();
    expect(proximaLivre([], () => false)).toBeNull();
  });
});

describe('classe do item', () => {
  it('material, alto risco, antimicrobiano, controlado e comum, nessa precedência', () => {
    const b = { tipo: 'medicamento', altaVigilancia: false, antimicrobiano: false, controlado: false };
    expect(classeDoItem({ ...b, tipo: 'material', altaVigilancia: true })).toBe('material');
    expect(classeDoItem({ ...b, altaVigilancia: true, antimicrobiano: true })).toBe('alto-risco');
    expect(classeDoItem({ ...b, antimicrobiano: true, controlado: true })).toBe('antimicrobiano');
    expect(classeDoItem({ ...b, controlado: true })).toBe('controlado');
    expect(classeDoItem(b)).toBe('comum');
  });
});
