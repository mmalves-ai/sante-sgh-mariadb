// Regra 1 (vigência) e a régua do horário que já passou (vigencia.js:189-307; porta dos casos de
// test/vigencia-grade.test.js da sante-api que são regra pura: os de SQL são provados na integração).
import { describe, expect, it } from 'vitest';
import { agendaVigente } from './estado-horario.js';
import {
  datasEntre,
  deMinutos,
  diasEntre,
  duracaoEmHoras,
  duracaoMinutos,
  ErroTempo,
  formatarHora,
  horaValida,
  horarioJaPassou,
  normalizarHora,
  paraMinutos,
  recortarJanela,
  segundaDaSemana,
  semanaDaData,
  somarDias,
  umAnoDepois,
  dataValida,
} from './tempo.js';

const relogio = { hoje: '2026-09-28', hhmm: '10:00' };

describe('vigência e horário que já passou', () => {
  it('vigente = ativa e ao menos um horário que ainda não começou (nunca PERINI/PERFIN)', () => {
    expect(agendaVigente('S', 1)).toBe(true);
    expect(agendaVigente('S', 0)).toBe(false);
    expect(agendaVigente('N', 10)).toBe(false);
    expect(agendaVigente(' S ', 3)).toBe(true);
  });
  it('o horário do minuto corrente conta como começado', () => {
    expect(horarioJaPassou({ data: '2026-09-28', hora: '1000' }, relogio)).toBe(true);
    expect(horarioJaPassou({ data: '2026-09-28', hora: '1001' }, relogio)).toBe(false);
    expect(horarioJaPassou({ data: '2026-09-28', hora: '0959' }, relogio)).toBe(true);
  });
  it('data anterior passou; data posterior não, qualquer hora', () => {
    expect(horarioJaPassou({ data: '2026-09-27', hora: '2359' }, relogio)).toBe(true);
    expect(horarioJaPassou({ data: '2026-09-29', hora: '0000' }, relogio)).toBe(false);
  });
  it('hora de 3 dígitos é lida com zero à esquerda (defesa do LPAD)', () => {
    expect(horarioJaPassou({ data: '2026-09-28', hora: '930' }, relogio)).toBe(true);
  });
  it('janela de consulta recortada em 31 dias (recorta, não recusa)', () => {
    expect(recortarJanela('2026-10-01', '2026-12-31', 31)).toEqual({
      de: '2026-10-01',
      ate: '2026-10-31',
      recortada: true,
    });
    expect(recortarJanela('2026-10-01', '2026-10-10', 31).recortada).toBe(false);
    expect(() => recortarJanela('2026-10-10', '2026-10-01', 31)).toThrow(ErroTempo);
  });
});

describe('horas HH:MM e durações', () => {
  it('normaliza HH:MM, H:MM, HHMM e HMM', () => {
    expect(normalizarHora('08:00')).toBe('08:00');
    expect(normalizarHora('8:05')).toBe('08:05');
    expect(normalizarHora('0815')).toBe('08:15');
    expect(normalizarHora('930')).toBe('09:30');
    expect(() => normalizarHora('24:00')).toThrow(ErroTempo);
    expect(() => normalizarHora('08:60')).toThrow(ErroTempo);
    expect(() => normalizarHora('oito')).toThrow(ErroTempo);
  });
  it('o formato estrito é "HH:MM"', () => {
    expect(horaValida('08:01')).toBe(true);
    expect(horaValida('0801')).toBe(false);
    expect(horaValida('24:00')).toBe(false);
  });
  it('formata para a tela', () => {
    expect(formatarHora('0800')).toBe('08:00');
    expect(formatarHora('930')).toBe('09:30');
    expect(formatarHora('08:00')).toBe('08:00');
    expect(formatarHora('')).toBe('');
    expect(formatarHora(null)).toBe('');
  });
  it('duração em horas e minutos: "01:00" são 60 minutos', () => {
    expect(duracaoMinutos('01:00')).toBe(60);
    expect(duracaoMinutos('0045')).toBe(45);
    expect(duracaoMinutos('00:00')).toBeNull();
    expect(duracaoMinutos('')).toBeNull();
    expect(duracaoMinutos(null)).toBeNull();
    expect(duracaoMinutos('9999')).toBeNull();
    expect(duracaoEmHoras(60)).toBe('01:00');
    expect(duracaoEmHoras(15)).toBe('00:15');
    expect(() => duracaoEmHoras(0)).toThrow(ErroTempo);
  });
  it('minutos ↔ HH:MM dentro do dia', () => {
    expect(paraMinutos('08:15')).toBe(495);
    expect(deMinutos(495)).toBe('08:15');
    expect(() => deMinutos(1440)).toThrow(ErroTempo);
    expect(() => paraMinutos('2500')).toThrow(ErroTempo);
  });
});

describe('datas', () => {
  it('semana como o legado: 1 = domingo … 7 = sábado (2026-08-19 é quarta = 4)', () => {
    expect(semanaDaData('2026-08-19')).toBe(4);
    expect(semanaDaData('2026-10-18')).toBe(1);
    expect(semanaDaData('2026-10-24')).toBe(7);
  });
  it('soma, diferença e lista de datas', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(diasEntre('2026-10-01', '2026-10-31')).toBe(30);
    expect(datasEntre('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
  it('um ano depois: mesma data no ano seguinte, e 29/02 vira 28/02', () => {
    expect(umAnoDepois('2026-03-15')).toBe('2027-03-15');
    expect(umAnoDepois('2028-02-29')).toBe('2029-02-28');
  });
  it('segunda-feira da semana (domingo recua 6)', () => {
    expect(segundaDaSemana('2026-10-21')).toBe('2026-10-19');
    expect(segundaDaSemana('2026-10-25')).toBe('2026-10-19');
    expect(segundaDaSemana('2026-10-19')).toBe('2026-10-19');
  });
  it('data inexistente é recusada', () => {
    expect(dataValida('2026-02-30')).toBe(false);
    expect(dataValida('2026-2-3')).toBe(false);
    expect(dataValida('2026-02-28')).toBe(true);
    expect(() => semanaDaData('2026-02-30')).toThrow(ErroTempo);
  });
});
