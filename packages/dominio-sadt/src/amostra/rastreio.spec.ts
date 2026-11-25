// Regra 3 (ficha do M26): código único da amostra, pulseira do internado, dois identificadores e passagens de estado.
import { describe, expect, it } from 'vitest';
import {
  codigoDaAmostra,
  codigoValido,
  aceitaPedidoDeRecoleta,
  conferirColeta,
  conferirPassagemDoRastreio,
  digitoVerificador,
  gruposDeColeta,
  podeMudar,
} from './rastreio.js';

describe('código único da amostra', () => {
  it('prefixo, ID em base 34 e dígito verificador; o leitor confere', () => {
    const c = codigoDaAmostra('pc', 1);
    expect(c).toMatch(/^PC0000001[0-9A-Z]$/);
    expect(codigoValido(c)).toBe(true);
    expect(codigoValido(`${c.slice(0, 9)}${c[9] === '0' ? '1' : '0'}`)).toBe(false);
    expect(codigoValido('curto')).toBe(false);
    expect(codigoDaAmostra('x', 34 * 34 + 5)).toMatch(/^XX0000105/);
    expect(codigoDaAmostra('hospital', 123456).length).toBe(10);
    expect(() => codigoDaAmostra('pc', 0)).toThrow(/inválido/);
    expect(() => digitoVerificador('PC*')).toThrow(/inválido/);
  });

  it('trocar dois caracteres vizinhos muda o dígito', () => {
    expect(digitoVerificador('PC0000012')).not.toBe(digitoVerificador('PC0000021'));
  });
});

describe('coleta (regra 3)', () => {
  it('dois identificadores sempre; pulseira do internado lida e do paciente', () => {
    expect(
      conferirColeta({
        internado: false,
        pulseiraLida: null,
        pulseiraEsperada: null,
        identificadoresConferidos: false,
      }).motivo,
    ).toMatch(/nome completo/);
    expect(
      conferirColeta({
        internado: false,
        pulseiraLida: null,
        pulseiraEsperada: null,
        identificadoresConferidos: true,
      }).pode,
    ).toBe(true);
    expect(
      conferirColeta({
        internado: true,
        pulseiraLida: ' ',
        pulseiraEsperada: 'P1',
        identificadoresConferidos: true,
      }).motivo,
    ).toMatch(/Leia a pulseira/);
    expect(
      conferirColeta({
        internado: true,
        pulseiraLida: 'P2',
        pulseiraEsperada: 'P1',
        identificadoresConferidos: true,
      }).motivo,
    ).toMatch(/não é do paciente/);
    expect(
      conferirColeta({
        internado: true,
        pulseiraLida: 'P1',
        pulseiraEsperada: 'P1',
        identificadoresConferidos: true,
      }).pode,
    ).toBe(true);
    expect(
      conferirColeta({
        internado: true,
        pulseiraLida: 'P9',
        pulseiraEsperada: null,
        identificadoresConferidos: true,
      }).pode,
    ).toBe(true);
  });

  it('agrupa por paciente e recipiente', () => {
    const g = gruposDeColeta([
      { id: 1, paciente: 10, recipiente: 2 },
      { id: 2, paciente: 10, recipiente: 2 },
      { id: 3, paciente: 10, recipiente: 1 },
      { id: 4, paciente: 11, recipiente: 2 },
      { id: 5, paciente: 10, recipiente: null },
    ]);
    expect(g.map((x) => x.map((e) => e.id))).toEqual([[1, 2], [3], [4], [5]]);
  });
});

describe('passagens de estado da amostra', () => {
  it('as permitidas e as recusadas', () => {
    expect(podeMudar('aguardandoColeta', 'coletada').pode).toBe(true);
    expect(podeMudar('coletada', 'emTransporte').pode).toBe(true);
    expect(podeMudar('emTransporte', 'recebida').pode).toBe(true);
    expect(podeMudar('recebida', 'emAnalise').pode).toBe(true);
    expect(podeMudar('recebida', 'rejeitada').pode).toBe(true);
    expect(podeMudar('rejeitada', 'recoleta').pode).toBe(true);
    expect(podeMudar('coletada', 'coletada').motivo).toMatch(/já está/);
    expect(podeMudar('recoleta', 'coletada').motivo).toMatch(/substituída/);
    expect(podeMudar('emAnalise', 'recebida').motivo).toMatch(/não permitida/);
  });
  it('a recoleta não passa pelo rastreio: nasce do pedido de recoleta com a nova coleta', () => {
    const r = conferirPassagemDoRastreio('rejeitada', 'recoleta');
    expect(r.pode).toBe(false);
    expect(r.codigo).toBe('recoleta-pelo-pedido');
    expect(conferirPassagemDoRastreio('recebida', 'rejeitada')).toEqual({
      pode: true,
      motivo: null,
      codigo: null,
    });
    expect(conferirPassagemDoRastreio('emAnalise', 'recebida').codigo).toBe('amostra-transicao');
    expect(conferirPassagemDoRastreio('recoleta', 'recoleta').motivo).toMatch(/já está/);
    expect(
      ['coletada', 'emTransporte', 'recebida', 'emAnalise', 'rejeitada'].every((e) =>
        aceitaPedidoDeRecoleta(e as 'coletada'),
      ),
    ).toBe(true);
    expect(aceitaPedidoDeRecoleta('aguardandoColeta')).toBe(false);
    expect(aceitaPedidoDeRecoleta('recoleta')).toBe(false);
  });
});
