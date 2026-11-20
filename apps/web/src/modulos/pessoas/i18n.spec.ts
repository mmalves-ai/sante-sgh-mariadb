// Os textos da gestão de pessoas não citam sistema antigo (ADR 0023), não mandam o usuário "fazer em outro sistema" e
// o desligamento diz que o usuário não é apagado (regra 2).
import { describe, expect, it } from 'vitest';
import { mensagensPessoas } from './i18n.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos da gestão de pessoas', () => {
  it('nenhum texto cita o sistema antigo nem nome de tabela', () => {
    const achados = textos(mensagensPessoas).filter(([, t]) =>
      /spdata|legado|sistema atual|sistema antigo|\bTB[A-Z]{3,}|\bFP[A-Z_]{3,}|SGH_/i.test(t),
    );
    expect(achados).toEqual([]);
  });

  it('o desligamento avisa o bloqueio no mesmo dia e que o usuário não é apagado', () => {
    expect(mensagensPessoas.desligamento.aviso).toMatch(/bloqueia hoje/);
    expect(mensagensPessoas.desligamento.aviso).toMatch(/não é apagado/);
  });

  it('a situação do cadastro de profissionais aparece como "a confirmar"', () => {
    expect(mensagensPessoas.ficha.aConfirmar).toBe('a confirmar');
  });
});
