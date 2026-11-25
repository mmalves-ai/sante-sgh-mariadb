import { describe, expect, it } from 'vitest';
import { chamavel, decidirEvento, eventosPossiveis, situacaoDe, type EstadoSenha } from './estados.js';
import { CODIGOS_SITUACAO_SENHA, foraDaFila, SITUACOES_SENHA } from './vocabulario.js';

const s = (x: Partial<EstadoSenha> = {}): EstadoSenha => ({
  situacao: 'aguardando',
  guiche: 0,
  atendida: false,
  tipoGerador: '5',
  ...x,
});

describe('situação nominal da senha', () => {
  it('as situações são as do banco próprio, nenhuma é letra', () => {
    expect(CODIGOS_SITUACAO_SENHA).toEqual([
      'aguardando',
      'chamada',
      'em_atendimento',
      'encaminhada',
      'atendida',
      'suspensa',
      'nao_compareceu',
      'cancelada',
    ]);
    for (const x of SITUACOES_SENHA) expect(x.codigo.length).toBeGreaterThan(1);
    expect(foraDaFila('nao_compareceu')).toBe(true);
    expect(foraDaFila('suspensa')).toBe(true);
    expect(foraDaFila('chamada')).toBe(false);
  });

  it('a situação vazia vale aguardando', () => {
    expect(situacaoDe('')).toBe('aguardando');
    expect(situacaoDe(null)).toBe('aguardando');
    expect(situacaoDe(' Chamada ')).toBe('chamada');
  });

  it('só a aguardando sem guichê e sem atendimento é chamável', () => {
    expect(chamavel(s())).toBe(true);
    expect(chamavel(s({ guiche: 2 }))).toBe(false);
    expect(chamavel(s({ situacao: 'suspensa' }))).toBe(false);
    expect(chamavel(s({ situacao: 'nao_compareceu' }))).toBe(false);
    expect(chamavel(s({ situacao: 'atendida' }))).toBe(false);
    expect(chamavel(s({ atendida: true }))).toBe(false);
  });
});

describe('máquina de estados no guichê', () => {
  const chamada = s({ situacao: 'chamada', guiche: 2 });

  it('chamar de novo só a senha chamada por este guichê, sem mudar a situação', () => {
    expect(decidirEvento(chamada, 'rechamar', 2)).toMatchObject({
      ok: true,
      efeito: { situacao: null, letraFluxo: 'C' },
    });
    expect(decidirEvento(chamada, 'rechamar', 3)).toMatchObject({ codigo: 'senha-nao-esta-no-guiche' });
    expect(decidirEvento(s(), 'rechamar', 2)).toMatchObject({ codigo: 'senha-nao-esta-no-guiche' });
  });

  it('suspender deixa suspensa, devolve o guichê e grava o motivo de entrada', () => {
    expect(decidirEvento(chamada, 'suspender', 2)).toEqual({
      ok: true,
      efeito: { situacao: 'suspensa', guiche: 'zero', letraFluxo: 'S', motivo: 'entrada', usuario: true },
    });
    expect(decidirEvento(s(), 'suspender', 2)).toMatchObject({ ok: true });
    expect(decidirEvento(chamada, 'suspender', 3)).toMatchObject({ codigo: 'senha-em-outro-guiche' });
    expect(decidirEvento(s({ situacao: 'suspensa' }), 'suspender', 2)).toMatchObject({
      codigo: 'situacao-mudou',
    });
  });

  it('não comparecimento: a chamada que o paciente não atende fica nao_compareceu, e volta pela retomada', () => {
    const d = decidirEvento(chamada, 'naoLocalizado', 2);
    expect(d).toEqual({
      ok: true,
      efeito: {
        situacao: 'nao_compareceu',
        guiche: 'zero',
        letraFluxo: 'S',
        motivo: 'nao-localizado',
        usuario: true,
      },
    });
    // Sem chamada não há não comparecimento.
    expect(decidirEvento(s(), 'naoLocalizado', 2)).toMatchObject({ codigo: 'senha-nao-chamada' });
    // A que não compareceu sai da fila (não é chamável) e o guichê a retoma.
    const naoVeio = s({ situacao: 'nao_compareceu' });
    expect(chamavel(naoVeio)).toBe(false);
    expect(eventosPossiveis(naoVeio, 2)).toEqual(['retomar']);
    expect(decidirEvento(naoVeio, 'retomar', 2)).toEqual({
      ok: true,
      efeito: { situacao: 'chamada', guiche: 'meu', letraFluxo: 'C', motivo: null, usuario: true },
    });
    expect(decidirEvento(naoVeio, 'naoLocalizado', 2)).toMatchObject({ codigo: 'situacao-mudou' });
  });

  it('retomar: só suspensa ou não compareceu, guichê aberto e sem outro guichê', () => {
    expect(decidirEvento(s({ situacao: 'suspensa' }), 'retomar', 2)).toMatchObject({ ok: true });
    expect(decidirEvento(s({ situacao: 'suspensa', guiche: 5 }), 'retomar', 2)).toMatchObject({
      codigo: 'senha-em-outro-guiche',
    });
    expect(decidirEvento(s(), 'retomar', 2)).toMatchObject({ codigo: 'senha-nao-suspensa' });
    expect(decidirEvento(s({ situacao: 'suspensa' }), 'retomar', 0)).toMatchObject({
      codigo: 'guiche-fechado',
    });
    expect(decidirEvento(s({ situacao: 'suspensa', atendida: true }), 'retomar', 2)).toMatchObject({
      codigo: 'senha-em-atendimento',
    });
  });

  it('concluir no guichê só a senha de serviços diversos chamada por ele', () => {
    expect(decidirEvento(chamada, 'liberar', 2)).toMatchObject({
      ok: true,
      efeito: { situacao: 'atendida', letraFluxo: 'L', motivo: 'diversos' },
    });
    expect(decidirEvento({ ...chamada, tipoGerador: '0' }, 'liberar', 2)).toMatchObject({
      codigo: 'senha-abre-atendimento',
    });
    expect(decidirEvento(s({ situacao: 'suspensa' }), 'liberar', 2)).toMatchObject({
      codigo: 'senha-nao-esta-no-guiche',
    });
  });

  it('os eventos possíveis da senha chamada pelo meu guichê', () => {
    expect(eventosPossiveis(chamada, 2)).toEqual(['rechamar', 'liberar', 'suspender', 'naoLocalizado']);
    expect(eventosPossiveis(s(), 2)).toEqual(['suspender']);
  });
});

describe('máquina de estados no local de atendimento', () => {
  const a = s({ situacao: 'em_atendimento', guiche: 2, atendida: true, tipoGerador: '0' });

  it('chamar ao local, cancelar e não localizado no local', () => {
    expect(decidirEvento(a, 'chamarNoLocal', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'chamada', letraFluxo: 'C' },
    });
    expect(decidirEvento({ ...a, situacao: 'chamada' }, 'cancelarChamada', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'em_atendimento', letraFluxo: 'X' },
    });
    expect(decidirEvento(a, 'cancelarChamada', 0)).toMatchObject({ codigo: 'senha-nao-chamada' });
    expect(decidirEvento({ ...a, situacao: 'chamada' }, 'naoLocalizadoNoLocal', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'em_atendimento', letraFluxo: 'N' },
    });
  });

  it('encaminhar deixa encaminhada; a encaminhada é chamada no destino e liberada do local', () => {
    expect(decidirEvento(a, 'encaminhar', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'encaminhada', letraFluxo: 'E', usuario: false },
    });
    const enc = { ...a, situacao: 'encaminhada' };
    expect(decidirEvento(enc, 'chamarNoLocal', 0)).toMatchObject({ ok: true });
    expect(decidirEvento(enc, 'liberarDoLocal', 0)).toMatchObject({
      ok: true,
      efeito: { situacao: 'em_atendimento', letraFluxo: 'L' },
    });
    expect(decidirEvento({ ...a, situacao: 'chamada' }, 'encaminhar', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
  });

  it('a senha concluída ou sem atendimento não é conduzida no local', () => {
    expect(decidirEvento({ ...a, situacao: 'atendida' }, 'chamarNoLocal', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
    expect(decidirEvento({ ...a, situacao: 'suspensa' }, 'liberarDoLocal', 0)).toMatchObject({
      codigo: 'situacao-mudou',
    });
    expect(decidirEvento(s({ situacao: 'chamada' }), 'chamarNoLocal', 0)).toMatchObject({
      codigo: 'senha-sem-atendimento',
    });
    expect(decidirEvento(s({ atendida: true, situacao: 'em_atendimento' }), 'suspender', 2)).toMatchObject({
      codigo: 'senha-em-atendimento',
    });
  });

  it('finalizar e ignorar nunca gravam', () => {
    expect(decidirEvento(a, 'finalizar', 0)).toMatchObject({ ok: false, codigo: 'letra-nunca-vista' });
    expect(decidirEvento(a, 'ignorar', 0)).toMatchObject({ ok: false, codigo: 'letra-nunca-vista' });
  });

  it('os eventos possíveis da senha em atendimento', () => {
    expect(eventosPossiveis(a, 0)).toEqual([
      'chamarNoLocal',
      'naoLocalizadoNoLocal',
      'encaminhar',
      'liberarDoLocal',
    ]);
  });
});
