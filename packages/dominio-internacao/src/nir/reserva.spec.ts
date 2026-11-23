// Ficha do M44, regra 11: a reserva (vaga, perfil, exceção do supervisor, validade e expiração) e a regra 12 (conflito).
import type { PerfilLeito } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  chaveExpiracao,
  conflitoDaReserva,
  decidirCancelamentoReserva,
  decidirReserva,
  incompatibilidadeComPerfil,
  type LeitoParaReserva,
  minutosParaVencer,
  reservaVencida,
  reservaVigente,
  validadeDaReserva,
} from './reserva.js';

const leito = (x: Partial<LeitoParaReserva> = {}): LeitoParaReserva => ({
  situacao: 'livre',
  tipo: 1,
  intensiva: false,
  atributos: null,
  acomodacao: { ocupados: 0, precaucoes: [] },
  ...x,
});
const perfil = (x: Partial<PerfilLeito> = {}): PerfilLeito => ({
  intensiva: false,
  precaucao: null,
  tiposAcomodacao: [],
  ...x,
});
const adulto = { sexo: 'M', idade: 54 };

describe('reserva de leito (regra 11)', () => {
  it('a vaga: o leito livre reserva; o reservado e o ocupado nunca, nem com exceção', () => {
    expect(decidirReserva(leito(), perfil(), adulto, null)).toEqual({ ok: true, comExcecao: false });
    expect(
      decidirReserva(leito({ situacao: 'reservado' }), perfil(), adulto, 'Excecao do supervisor'),
    ).toMatchObject({
      ok: false,
      codigo: 'leito-reservado',
    });
    for (const situacao of ['ocupado', 'bloqueado', 'higienizacao', 'conflito', 'inativo'])
      expect(decidirReserva(leito({ situacao }), perfil(), adulto, 'Excecao do supervisor')).toMatchObject({
        ok: false,
        codigo: 'leito-indisponivel',
      });
  });

  it('o perfil: terapia intensiva, tipo aceito, sexo, idade e isolamento', () => {
    expect(incompatibilidadeComPerfil(leito(), perfil({ intensiva: true }), adulto)).toMatch(
      /terapia intensiva/,
    );
    expect(incompatibilidadeComPerfil(leito({ intensiva: true, tipo: 3 }), perfil(), adulto)).toMatch(
      /guarde-o/,
    );
    expect(
      incompatibilidadeComPerfil(leito({ intensiva: true, tipo: 3 }), perfil({ intensiva: true }), adulto),
    ).toBeNull();
    expect(incompatibilidadeComPerfil(leito({ tipo: 2 }), perfil({ tiposAcomodacao: [1] }), adulto)).toMatch(
      /tipo/,
    );
    expect(
      incompatibilidadeComPerfil(
        leito({ atributos: { sexo: 'F', idadeMinima: null, idadeMaxima: null } }),
        perfil(),
        adulto,
      ),
    ).toMatch(/feminino/);
    expect(
      incompatibilidadeComPerfil(
        leito({ atributos: { sexo: 'A', idadeMinima: null, idadeMaxima: 12 } }),
        perfil(),
        adulto,
      ),
    ).toMatch(/até 12/);
    expect(
      incompatibilidadeComPerfil(
        leito({ acomodacao: { ocupados: 1, precaucoes: [] } }),
        perfil({ precaucao: 'contato' }),
        adulto,
      ),
    ).toMatch(/isolamento/);
    expect(
      incompatibilidadeComPerfil(
        leito({ acomodacao: { ocupados: 1, precaucoes: ['aerossois'] } }),
        perfil(),
        adulto,
      ),
    ).toMatch(/isolamento: escolha outra/);
    expect(
      incompatibilidadeComPerfil(
        leito({ acomodacao: { ocupados: 0, precaucoes: ['goticulas'] } }),
        perfil({ precaucao: 'contato' }),
        adulto,
      ),
    ).toMatch(/outro tipo/);
    expect(
      incompatibilidadeComPerfil(
        leito({ acomodacao: { ocupados: 0, precaucoes: ['contato'] } }),
        perfil({ precaucao: 'contato' }),
        adulto,
      ),
    ).toBeNull();
  });

  it('fora do perfil: recusado, salvo exceção do supervisor (registrada)', () => {
    const l = leito({ atributos: { sexo: 'F', idadeMinima: null, idadeMaxima: null } });
    expect(decidirReserva(l, perfil(), adulto, null)).toMatchObject({
      ok: false,
      codigo: 'leito-incompativel',
    });
    expect(decidirReserva(l, perfil(), adulto, 'Unico leito livre na clinica')).toEqual({
      ok: true,
      comExcecao: true,
    });
  });

  it('a validade, o vencimento e a chave idempotente da expiração', () => {
    const v = validadeDaReserva('2026-10-24T10:00:00', 120);
    expect(v).toBe('2026-10-24T12:00:00');
    expect(minutosParaVencer(v, '2026-10-24T11:30:00')).toBe(30);
    expect(reservaVencida({ situacao: 'ativa', validaAte: v }, '2026-10-24T12:00:01')).toBe(true);
    expect(reservaVencida({ situacao: 'confirmada', validaAte: v }, '2026-10-24T12:00:01')).toBe(true);
    expect(reservaVencida({ situacao: 'ativa', validaAte: v }, '2026-10-24T11:59:59')).toBe(false);
    expect(reservaVencida({ situacao: 'consumida', validaAte: v }, '2026-10-25T00:00:00')).toBe(false);
    expect(reservaVigente('expirada')).toBe(false);
    expect(chaveExpiracao('pc', 42)).toBe('nir.reserva.expira:pc:42');
  });

  it('regra 12: ocupado por fora o leito reservado vira conflito, visto uma vez', () => {
    expect(conflitoDaReserva({ situacao: 'ativa', conflitoEm: null }, 880001)).toBe('novo');
    expect(conflitoDaReserva({ situacao: 'confirmada', conflitoEm: '2026-10-24T10:00:00' }, 880001)).toBe(
      'registrado',
    );
    expect(conflitoDaReserva({ situacao: 'ativa', conflitoEm: null }, null)).toBeNull();
    expect(conflitoDaReserva({ situacao: 'expirada', conflitoEm: null }, 880001)).toBeNull();
  });
});

describe('cancelamento da reserva (o "excluir" vira cancelamento; SBIS-26)', () => {
  it('só a vigente se cancela; a convertida em internação e a já encerrada recusam com o código', () => {
    expect(decidirCancelamentoReserva('ativa')).toEqual({ ok: true });
    expect(decidirCancelamentoReserva('confirmada')).toEqual({ ok: true });
    expect(decidirCancelamentoReserva('consumida')).toMatchObject({
      ok: false,
      codigo: 'reserva-convertida',
    });
    expect(decidirCancelamentoReserva('expirada')).toMatchObject({
      ok: false,
      codigo: 'reserva-desatualizada',
    });
    expect(decidirCancelamentoReserva('cancelada')).toMatchObject({
      ok: false,
      codigo: 'reserva-desatualizada',
    });
  });
});
