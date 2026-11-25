import { describe, expect, it } from 'vitest';
import { RecusaRegistroTurno, registrosDoTurno, type HorarioDoRegistro } from './registro-turno.js';

const h = (
  id: number,
  atendimento: number,
  letra: string,
  papel: 'travado' | 'pendente' = 'travado',
  anterior = false,
  paciente = atendimento * 10,
): HorarioDoRegistro => ({ id, atendimento, paciente, letra, papel, anterior });
const CAB = {
  data: '2026-11-25',
  turno: 'diurno' as const,
  unidade: 'U1',
  justificativa: '  Paciente em exame externo  ',
};

describe('registro do fechamento do turno no prontuário (03-PEP L113)', () => {
  it('um documento por atendimento, com as contagens só dos travados', () => {
    const r = registrosDoTurno(
      [h(1, 2, 'A'), h(2, 1, 'N'), h(3, 2, 'p'), h(4, 2, 'S'), h(5, 2, 'P', 'pendente', true), h(6, 1, 'A')],
      CAB,
    );
    expect(r.map((x) => x.atendimento)).toEqual([1, 2]);
    expect(r[0]).toMatchObject({
      paciente: 10,
      administrados: 1,
      naoAdministrados: 1,
      suspensos: 0,
      travados: [2, 6],
      pendentes: [],
    });
    expect(r[1]).toMatchObject({
      paciente: 20,
      administrados: 2,
      suspensos: 1,
      travados: [1, 3, 4],
      pendentes: [5],
      pendentesAnteriores: [5],
    });
    expect(r[1]!.titulo).toBe('Registro de checagem do turno diurno de 25/11/2026');
  });
  it('a justificativa entra só no documento do paciente com pendência', () => {
    const r = registrosDoTurno([h(1, 1, 'A'), h(2, 2, 'P', 'pendente')], CAB);
    expect(r[0]!.conteudo['justificativa_pendencias']).toBeNull();
    expect(r[1]!.conteudo['justificativa_pendencias']).toBe('Paciente em exame externo');
    expect(r[1]!.conteudo).toMatchObject({
      tipo: 'registro_checagem_turno',
      turno: 'diurno',
      horarios_pendentes: [2],
    });
  });
  it('nunca vai ao prontuário errado: horário sem paciente ou atendimento com dois pacientes é recusado', () => {
    expect(() => registrosDoTurno([h(1, 0, 'A')], CAB)).toThrow(RecusaRegistroTurno);
    try {
      registrosDoTurno([h(1, 1, 'A', 'travado', false, 7), h(2, 1, 'A', 'travado', false, 8)], CAB);
      expect.unreachable();
    } catch (e) {
      expect((e as RecusaRegistroTurno).codigo).toBe('atendimento-com-dois-pacientes');
    }
  });
  it('fechamento vazio não gera documento', () => {
    expect(registrosDoTurno([], CAB)).toEqual([]);
  });
});
