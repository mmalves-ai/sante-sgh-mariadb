// Disparo automático da comunicação de internação e de alta à operadora (C2-070, 06-FAT linha 26).
import { describe, expect, it } from 'vitest';
import { comunicacoesDevidas, type ContextoDisparo } from './comunicacao-operadora-disparo.js';

const base: ContextoDisparo = {
  tipoFonte: 'operadora',
  registroAns: '123456',
  numeroCarteira: '0001',
  altaRegistrada: false,
  altaPorObito: false,
  existentes: [],
};

describe('comunicacoesDevidas', () => {
  it('ao internar nasce a comunicação da internação', () => {
    expect(comunicacoesDevidas(base)).toEqual(['internacao']);
  });
  it('com a alta registrada e sem nada comunicado nascem a internação e a alta, nessa ordem', () => {
    expect(comunicacoesDevidas({ ...base, altaRegistrada: true })).toEqual(['internacao', 'alta']);
  });
  it('a alta por óbito gera a comunicação do óbito, nunca a da alta', () => {
    expect(
      comunicacoesDevidas({
        ...base,
        altaRegistrada: true,
        altaPorObito: true,
        existentes: [{ tipo: 'internacao', situacao: 'confirmada' }],
      }),
    ).toEqual(['obito']);
  });
  it('não repete o que já existe, nem o que a equipe cancelou', () => {
    expect(
      comunicacoesDevidas({ ...base, existentes: [{ tipo: 'internacao', situacao: 'pendente' }] }),
    ).toEqual([]);
    expect(
      comunicacoesDevidas({ ...base, existentes: [{ tipo: 'internacao', situacao: 'cancelada' }] }),
    ).toEqual([]);
    expect(
      comunicacoesDevidas({
        ...base,
        altaRegistrada: true,
        existentes: [
          { tipo: 'internacao', situacao: 'confirmada' },
          { tipo: 'alta', situacao: 'rejeitada' },
        ],
      }),
    ).toEqual([]);
  });
  it('a saída espera a internação viva: cancelada a da internação, a alta não nasce', () => {
    expect(
      comunicacoesDevidas({
        ...base,
        altaRegistrada: true,
        existentes: [{ tipo: 'internacao', situacao: 'cancelada' }],
      }),
    ).toEqual([]);
  });
  it('fonte que não é saúde suplementar, sem registro ou sem carteira: nada nasce', () => {
    expect(comunicacoesDevidas({ ...base, tipoFonte: 'sus' })).toEqual([]);
    expect(comunicacoesDevidas({ ...base, registroAns: null })).toEqual([]);
    expect(comunicacoesDevidas({ ...base, numeroCarteira: '  ' })).toEqual([]);
  });
});
