// Disparo automático da comunicação de internação e de alta à operadora (C2-070, 06-FAT linha 26).
import { describe, expect, it } from 'vitest';
import { conferirTransmissao, transicaoComunicacao } from './comunicacao-operadora.js';
import {
  comunicacoesAoDesfazer,
  comunicacoesDevidas,
  type ContextoDisparo,
} from './comunicacao-operadora-disparo.js';

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

describe('comunicação desfeita (alta cancelada ou internação excluída)', () => {
  it('a alta desfeita não conta: a nova alta é comunicada de novo', () => {
    expect(
      comunicacoesDevidas({
        ...base,
        altaRegistrada: true,
        existentes: [
          { tipo: 'internacao', situacao: 'confirmada' },
          { tipo: 'alta', situacao: 'confirmada', desfeita: true },
        ],
      }),
    ).toEqual(['alta']);
  });
  it('cancelada a alta: pendente e erro cancelam, enviada e confirmada pedem retificação, a internação fica', () => {
    const d = comunicacoesAoDesfazer('alta', [
      { id: 1, tipo: 'internacao', situacao: 'confirmada', desfeita: false },
      { id: 2, tipo: 'alta', situacao: 'pendente', desfeita: false },
      { id: 3, tipo: 'alta', situacao: 'erro', desfeita: false },
      { id: 4, tipo: 'obito', situacao: 'enviada', desfeita: false },
      { id: 5, tipo: 'alta', situacao: 'confirmada', desfeita: false },
      { id: 6, tipo: 'alta', situacao: 'rejeitada', desfeita: false },
      { id: 7, tipo: 'alta', situacao: 'confirmada', desfeita: true },
    ]);
    expect(d.map((x) => [x.id, x.acao])).toEqual([
      [2, 'cancelar'],
      [3, 'cancelar'],
      [4, 'retificar'],
      [5, 'retificar'],
      [6, 'marcar'],
    ]);
    expect(d.every((x) => /Alta cancelada/.test(x.motivo))).toBe(true);
  });
  it('excluída a internação, todas as comunicações vivas são atingidas', () => {
    const d = comunicacoesAoDesfazer('internacao', [
      { id: 1, tipo: 'internacao', situacao: 'confirmada', desfeita: false },
      { id: 2, tipo: 'prorrogacao', situacao: 'pendente', desfeita: false },
      { id: 3, tipo: 'alta', situacao: 'cancelada', desfeita: false },
    ]);
    expect(d.map((x) => x.acao)).toEqual(['retificar', 'cancelar', 'marcar']);
  });
  it('cancelar a enviada ou a confirmada só com a retificação pendente', () => {
    const t = (retificacaoPendente: boolean, situacao: 'enviada' | 'confirmada') =>
      transicaoComunicacao({
        situacao,
        acao: 'cancelar',
        protocolo: null,
        resposta: 'Cancelada na operadora',
        retificacaoPendente,
      });
    expect(t(true, 'enviada').para).toBe('cancelada');
    expect(t(true, 'confirmada').para).toBe('cancelada');
    expect(t(false, 'confirmada').para).toBeNull();
  });
  it('sem transporte no ambiente a comunicação não sai pelo serviço web', () => {
    expect(
      conferirTransmissao({ situacao: 'pendente', tipo: 'alta', servicoWeb: true, transporte: false })[0]
        ?.campo,
    ).toBe('canal');
    expect(
      conferirTransmissao({ situacao: 'pendente', tipo: 'alta', servicoWeb: true, transporte: true }),
    ).toEqual([]);
  });
});
