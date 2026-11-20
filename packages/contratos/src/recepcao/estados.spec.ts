import { describe, expect, it } from 'vitest';
import { chamavel, decidirEvento, eventosPossiveis, situacaoDe, type EstadoSenha } from './estados.js';

const s = (x: Partial<EstadoSenha> = {}): EstadoSenha => ({
  situacao: 'G',
  guiche: 0,
  atendida: false,
  tipoGerador: '5',
  ...x,
});

describe('máquina de estados da senha (letras do legado)', () => {
  it('situação vazia ou com espaço é G', () => {
    expect(situacaoDe('')).toBe('G');
    expect(situacaoDe(' ')).toBe('G');
    expect(situacaoDe(null)).toBe('G');
    expect(situacaoDe('l')).toBe('L');
  });

  it('chamável: G, guichê livre, sem atendimento (como a procedure do outro sistema)', () => {
    expect(chamavel(s())).toBe(true);
    expect(chamavel(s({ guiche: 3 }))).toBe(false);
    expect(chamavel(s({ situacao: 'S' }))).toBe(false);
    expect(chamavel(s({ situacao: 'L' }))).toBe(false);
    expect(chamavel(s({ atendida: true }))).toBe(false);
  });

  it('chamar de novo grava C no fluxo e não muda a senha; só do próprio guichê', () => {
    const d = decidirEvento(s({ guiche: 2 }), 'rechamar', 2);
    expect(d).toEqual({
      ok: true,
      efeito: { situacao: null, guiche: null, letraFluxo: 'C', motivo: null, usuario: false },
    });
    expect(decidirEvento(s({ guiche: 3 }), 'rechamar', 2)).toMatchObject({
      ok: false,
      codigo: 'senha-nao-esta-no-guiche',
    });
    expect(decidirEvento(s({ guiche: 2, atendida: true }), 'rechamar', 2)).toMatchObject({
      codigo: 'senha-em-atendimento',
    });
  });

  it('suspender e não localizado: S, guichê 0, motivo; da fila ou do próprio guichê', () => {
    expect(decidirEvento(s({ guiche: 2 }), 'suspender', 2)).toMatchObject({
      ok: true,
      efeito: { situacao: 'S', guiche: 'zero', letraFluxo: 'S', motivo: 'entrada', usuario: true },
    });
    expect(decidirEvento(s(), 'naoLocalizado', 2)).toMatchObject({
      ok: true,
      efeito: { motivo: 'nao-localizado' },
    });
    expect(decidirEvento(s({ guiche: 4 }), 'suspender', 2)).toMatchObject({
      codigo: 'senha-em-outro-guiche',
    });
    expect(decidirEvento(s({ situacao: 'S' }), 'suspender', 2)).toMatchObject({ codigo: 'situacao-mudou' });
    expect(decidirEvento(s({ atendida: true, situacao: 'A' }), 'suspender', 2)).toMatchObject({
      codigo: 'senha-em-atendimento',
    });
  });

  it('a suspensa volta a ser chamada pelo guichê (C no fluxo, guichê e usuário na senha)', () => {
    expect(decidirEvento(s({ situacao: 'S' }), 'retomar', 2)).toMatchObject({
      ok: true,
      efeito: { situacao: null, guiche: 'meu', letraFluxo: 'C', usuario: true },
    });
    expect(decidirEvento(s({ situacao: 'S', guiche: 5 }), 'retomar', 2)).toMatchObject({
      codigo: 'senha-em-outro-guiche',
    });
    expect(decidirEvento(s({ situacao: 'G' }), 'retomar', 2)).toMatchObject({ codigo: 'senha-nao-suspensa' });
    expect(decidirEvento(s({ situacao: 'S' }), 'retomar', 0)).toMatchObject({ codigo: 'guiche-fechado' });
    expect(decidirEvento(s({ situacao: 'S', atendida: true }), 'retomar', 2)).toMatchObject({
      codigo: 'senha-em-atendimento',
    });
  });

  it('liberar só a de serviços diversos chamada pelo guichê (L com o motivo fixo)', () => {
    expect(decidirEvento(s({ guiche: 2 }), 'liberar', 2)).toMatchObject({
      ok: true,
      efeito: { situacao: 'L', letraFluxo: 'L', motivo: 'diversos' },
    });
    expect(decidirEvento(s({ guiche: 2, tipoGerador: '0' }), 'liberar', 2)).toMatchObject({
      codigo: 'senha-abre-atendimento',
    });
    expect(decidirEvento(s({ guiche: 0 }), 'liberar', 2)).toMatchObject({
      codigo: 'senha-nao-esta-no-guiche',
    });
    expect(decidirEvento(s({ guiche: 2, atendida: true }), 'liberar', 2)).toMatchObject({
      codigo: 'senha-em-atendimento',
    });
  });

  it('no local: chamar põe C; cancelar e não localizado voltam a A; liberar do local deixa A', () => {
    const a = s({ situacao: 'A', guiche: 2, atendida: true, tipoGerador: '0' });
    expect(decidirEvento(a, 'chamarNoLocal', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'C', letraFluxo: 'C' },
    });
    expect(decidirEvento({ ...a, situacao: 'C' }, 'cancelarChamada', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'A', letraFluxo: 'X' },
    });
    expect(decidirEvento(a, 'cancelarChamada', 0)).toMatchObject({ codigo: 'senha-nao-chamada' });
    expect(decidirEvento({ ...a, situacao: 'C' }, 'naoLocalizadoNoLocal', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'A', letraFluxo: 'N' },
    });
    expect(decidirEvento(a, 'liberarDoLocal', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: null, letraFluxo: 'L' },
    });
    for (const e of [
      'chamarNoLocal',
      'cancelarChamada',
      'naoLocalizadoNoLocal',
      'liberarDoLocal',
      'encaminhar',
    ] as const)
      expect(decidirEvento(s(), e, 0)).toMatchObject({ codigo: 'senha-sem-atendimento' });
    expect(decidirEvento({ ...a, situacao: 'L' }, 'chamarNoLocal', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
    expect(decidirEvento({ ...a, situacao: 'L' }, 'naoLocalizadoNoLocal', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
    expect(decidirEvento({ ...a, situacao: 'S' }, 'liberarDoLocal', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
  });

  it('encaminhar: só a senha em atendimento (E no fluxo, a senha não muda)', () => {
    const a = s({ situacao: 'A', atendida: true, tipoGerador: '0' });
    expect(decidirEvento(a, 'encaminhar', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: null, letraFluxo: 'E', usuario: false },
    });
    expect(decidirEvento({ ...a, situacao: 'C' }, 'encaminhar', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
  });

  it('F e I nunca vistos: recusados', () => {
    expect(decidirEvento(s(), 'finalizar', 2)).toMatchObject({ ok: false, codigo: 'letra-nunca-vista' });
    expect(decidirEvento(s(), 'ignorar', 2)).toMatchObject({ ok: false, codigo: 'letra-nunca-vista' });
  });

  it('eventos possíveis para a tela', () => {
    expect(eventosPossiveis(s({ guiche: 2 }), 2)).toEqual([
      'rechamar',
      'liberar',
      'suspender',
      'naoLocalizado',
    ]);
    expect(eventosPossiveis(s({ situacao: 'S' }), 2)).toEqual(['retomar']);
    expect(eventosPossiveis(s({ situacao: 'A', atendida: true }), 0)).toEqual([
      'chamarNoLocal',
      'naoLocalizadoNoLocal',
      'encaminhar',
      'liberarDoLocal',
    ]);
  });
});
