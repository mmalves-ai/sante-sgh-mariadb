// Registro do ato: tempos, porte e o que a tela oferece.
import { describe, expect, it } from 'vitest';
import { conferirTempos, PORTES, porteSugerido, POTENCIAIS_CONTAMINACAO, TECNICAS } from './registro.js';

describe('registro do ato cirúrgico', () => {
  it('tempos válidos dão a duração; anestesia opcional', () => {
    expect(conferirTempos({ inicio: '08:00', fim: '09:30' })).toEqual({ duracaoMin: 90, problemas: [] });
    expect(
      conferirTempos({ inicio: '08:00', fim: '09:30', inicioAnestesia: '07:45', fimAnestesia: '09:40' })
        .problemas,
    ).toEqual([]);
  });
  it('recusa hora inválida, término igual ao início e anestesia invertida', () => {
    expect(conferirTempos({ inicio: '25:00', fim: '09:30' }).problemas.map((p) => p.campo)).toEqual([
      'inicio',
    ]);
    expect(conferirTempos({ inicio: '08:00', fim: '99' }).problemas.map((p) => p.campo)).toEqual(['fim']);
    expect(conferirTempos({ inicio: '08:00', fim: '08:00' }).problemas.map((p) => p.campo)).toEqual(['fim']);
    expect(
      conferirTempos({
        inicio: '08:00',
        fim: '09:00',
        inicioAnestesia: 'x',
        fimAnestesia: 'y',
      }).problemas.map((p) => p.campo),
    ).toEqual(['inicioAnestesia', 'fimAnestesia']);
    expect(
      conferirTempos({ inicio: '08:00', fim: '09:00', inicioAnestesia: '08:00', fimAnestesia: '08:00' })
        .problemas,
    ).toHaveLength(1);
  });
  it('porte sugerido e listas vistas', () => {
    expect(porteSugerido(60)).toBe('P');
    expect(porteSugerido(180)).toBe('M');
    expect(porteSugerido(300)).toBe('G');
    expect(PORTES.map((p) => p.codigo)).toEqual(['P', 'M', 'G']);
    expect(POTENCIAIS_CONTAMINACAO.map((p) => p.codigo)).toEqual(['L', 'P', 'C']);
    expect(TECNICAS).toHaveLength(3);
  });
});
