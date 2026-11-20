import DatePicker from 'openvue/datepicker';
import { describe, expect, it } from 'vitest';

// DP-51, condição 3: o datepicker do OpenVue 1.0.0 quebra ao interpretar hora em 24 h (sem AM/PM).
// A correção vem de patches/openvue@1.0.0.patch; este teste falha se o patch deixar de ser aplicado.
interface MetodosDatePicker {
  populateTime(this: unknown, valor: Date, hora: string, ampm?: string): void;
  parseTime(this: unknown, valor: string): { hour: number; minute: number; second: number | null };
}

describe('correções locais do OpenVue', () => {
  it('datepicker aceita hora em 24 h sem AM/PM', () => {
    const metodos = (DatePicker as unknown as { methods: MetodosDatePicker }).methods;
    const contexto = {
      hourFormat: '24',
      showSeconds: false,
      pm: false,
      $primevue: { config: { locale: { am: 'AM', pm: 'PM' } } },
      parseTime: metodos.parseTime,
      validateTime: () => true,
    };
    const data = new Date(2026, 9, 19, 0, 0, 0);
    metodos.populateTime.call(contexto, data, '14:30');
    expect(data.getHours()).toBe(14);
    expect(data.getMinutes()).toBe(30);
    expect(contexto.pm).toBe(false);
  });
});
