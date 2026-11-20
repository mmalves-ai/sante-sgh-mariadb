// W1-01 (parte 11b): regra da troca rápida de usuário por PIN (D-W101-36). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  aposFalhaPin,
  avaliarTrocaRapida,
  type ContextoTrocaRapida,
  PADRAO_TROCA_RAPIDA,
  validarNovoPin,
} from './troca-rapida.js';

const P = PADRAO_TROCA_RAPIDA;
const codigos = (pin: string, login = 'SINT.USUARIO', nascimento: string | null = null) =>
  validarNovoPin(pin, { login, nascimento, parametros: P }).map((r) => r.codigo);

describe('W1-01 (parte 11b): PIN novo', () => {
  it('aceita 6 a 8 dígitos sem padrão óbvio', () => {
    expect(codigos('482915')).toEqual([]);
    expect(codigos('48291573')).toEqual([]);
  });
  it('recusa formato: curto, longo, com letra; o mínimo segue o parâmetro (4 a 8)', () => {
    expect(codigos('48291')).toEqual(['pin-formato']);
    expect(codigos('482915731')).toEqual(['pin-formato']);
    expect(codigos('48a915')).toEqual(['pin-formato']);
    expect(validarNovoPin('4829', { login: 'X', parametros: { ...P, digitosPin: 4 } })).toEqual([]);
    expect(validarNovoPin('4829', { login: 'X', parametros: { ...P, digitosPin: 2 } })).toEqual([]);
    expect(validarNovoPin('482', { login: 'X', parametros: { ...P, digitosPin: 2 } })[0]?.codigo).toBe(
      'pin-formato',
    );
  });
  it('recusa o trivial: repetido, crescente, decrescente (com a volta do 9 ao 0)', () => {
    for (const pin of ['000000', '777777', '123456', '654321', '890123', '210987'])
      expect(codigos(pin)).toEqual(['pin-trivial']);
  });
  it('recusa o derivado do login e da data de nascimento', () => {
    expect(codigos('482915', 'MED482915')).toEqual(['pin-derivado']);
    expect(codigos('148291', 'SINT8291')).toEqual(['pin-derivado']);
    expect(codigos('150380', 'SINT.USUARIO', '1980-03-15')).toEqual(['pin-derivado']);
    expect(codigos('15031980', 'SINT.USUARIO', '1980-03-15')).toEqual(['pin-derivado']);
    expect(codigos('919803', 'SINT.USUARIO', '1980-03-15')).toEqual(['pin-derivado']);
    expect(codigos('482915', 'SINT.USUARIO', '1980-03-15')).toEqual([]);
  });
  it('desligada recusa definir PIN; a mensagem nunca traz o PIN', () => {
    expect(validarNovoPin('482915', { login: 'X', parametros: { ...P, ligada: false } })[0]?.codigo).toBe(
      'troca-rapida-desligada',
    );
    for (const pin of ['123456', '482915', '15031980'])
      for (const r of validarNovoPin(pin, { login: 'X', nascimento: '1980-03-15', parametros: P }))
        expect(r.mensagem).not.toContain(pin);
  });
});

const ctx = (v: Partial<ContextoTrocaRapida> = {}): ContextoTrocaRapida => ({
  parametros: P,
  hoje: '2026-11-19',
  estacao: 'est-a',
  conta: { ativo: true, bloqueado: false },
  pin: { definido: true, bloqueado: false },
  loginsFortes: [{ dia: '2026-11-19', estacao: 'est-a' }],
  ...v,
});

describe('W1-01 (parte 11b): troca rápida', () => {
  it('segue com login forte hoje nesta estação', () => {
    expect(avaliarTrocaRapida(ctx())).toBeNull();
  });
  it('recusa sem login forte hoje (ontem não vale) e em outra estação', () => {
    expect(avaliarTrocaRapida(ctx({ loginsFortes: [{ dia: '2026-11-18', estacao: 'est-a' }] }))?.codigo).toBe(
      'sem-login-forte-hoje',
    );
    expect(avaliarTrocaRapida(ctx({ loginsFortes: [] }))?.codigo).toBe('sem-login-forte-hoje');
    expect(avaliarTrocaRapida(ctx({ estacao: 'est-b' }))?.codigo).toBe('outra-estacao');
  });
  it('recusa conta inativa, bloqueada ou inexistente com a mensagem genérica', () => {
    for (const conta of [null, { ativo: false, bloqueado: false }, { ativo: true, bloqueado: true }]) {
      const r = avaliarTrocaRapida(ctx({ conta }));
      expect(r).toEqual({ codigo: 'conta-indisponivel', mensagem: 'Usuário ou PIN não conferem.' });
    }
  });
  it('recusa sem PIN, PIN bloqueado e parâmetro desligado', () => {
    expect(avaliarTrocaRapida(ctx({ pin: { definido: false, bloqueado: false } }))?.codigo).toBe('sem-pin');
    expect(avaliarTrocaRapida(ctx({ pin: { definido: true, bloqueado: true } }))?.codigo).toBe(
      'pin-bloqueado',
    );
    expect(avaliarTrocaRapida(ctx({ parametros: { ...P, ligada: false } }))?.codigo).toBe(
      'troca-rapida-desligada',
    );
  });
  it('erros seguidos bloqueiam no teto (padrão 3; teto entre 1 e 10)', () => {
    expect(aposFalhaPin(0, P)).toEqual({ falhas: 1, bloquear: false });
    expect(aposFalhaPin(1, P)).toEqual({ falhas: 2, bloquear: false });
    expect(aposFalhaPin(2, P)).toEqual({ falhas: 3, bloquear: true });
    expect(aposFalhaPin(0, { ...P, tentativasPin: 0 })).toEqual({ falhas: 1, bloquear: true });
    expect(aposFalhaPin(9, { ...P, tentativasPin: 50 }).bloquear).toBe(true);
  });
});
