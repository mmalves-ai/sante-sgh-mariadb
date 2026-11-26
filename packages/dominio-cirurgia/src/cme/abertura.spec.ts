// Baixa do uso do pacote estéril no paciente (F7, 04-CME linha 118): a abertura só passa com a embalagem conferida,
// o indicador externo virado (ou ausente) e a cirurgia com atendimento.
import { describe, expect, it } from 'vitest';
import { conferirAbertura } from './cme.js';

const ok = { integridadeConferida: true, indicadorExternoOk: true, atendimento: 7 };

describe('conferirAbertura', () => {
  it('aceita a abertura conferida, com ou sem indicador externo', () => {
    expect(conferirAbertura(ok)).toEqual([]);
    expect(conferirAbertura({ ...ok, indicadorExternoOk: null })).toEqual([]);
  });

  it('recusa sem a conferência da embalagem, com o indicador que não virou e sem atendimento', () => {
    expect(conferirAbertura({ ...ok, integridadeConferida: false }).map((p) => p.campo)).toEqual([
      'integridadeConferida',
    ]);
    expect(conferirAbertura({ ...ok, indicadorExternoOk: false }).map((p) => p.campo)).toEqual([
      'indicadorExternoOk',
    ]);
    expect(conferirAbertura({ ...ok, atendimento: null }).map((p) => p.campo)).toEqual(['agendamento']);
    expect(
      conferirAbertura({ integridadeConferida: false, indicadorExternoOk: false, atendimento: null }),
    ).toHaveLength(3);
  });
});
