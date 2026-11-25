// F3.8, 07-FIN linha 66 (C1-026): o credor dos dados bancários (fornecedor, profissional ou prestador terceiro) e a
// chave Pix que paga o título.
import { describe, expect, it } from 'vitest';
import { type ChaveCandidata, credorDaConta, credorRecusado, escolherChavePix } from './credor-conta.js';

describe('credor da conta bancária', () => {
  it('aceita o fornecedor pela forma curta e o par tipo e código dos três credores', () => {
    expect(credorDaConta({ fornecedor: 7 })).toEqual({ tipo: 'fornecedor', id: 7 });
    expect(credorDaConta({ tipoCredor: 'profissional', credor: 5001 })).toEqual({
      tipo: 'profissional',
      id: 5001,
    });
    expect(credorDaConta({ tipoCredor: 'prestador', credor: 3 })).toEqual({ tipo: 'prestador', id: 3 });
    expect(credorDaConta({ tipoCredor: 'fornecedor', credor: 9 })).toEqual({ tipo: 'fornecedor', id: 9 });
  });

  it('recusa a falta do credor, o código sem tipo, o código inválido e dois credores juntos', () => {
    const codigo = (r: ReturnType<typeof credorDaConta>) => (credorRecusado(r) ? r.codigo : 'aceito');
    expect(codigo(credorDaConta({}))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ credor: 5 }))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ tipoCredor: 'profissional' }))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ tipoCredor: 'profissional', credor: 0 }))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ tipoCredor: 'profissional', credor: 1.5 }))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ fornecedor: -1 }))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ tipoCredor: 'colaborador' as never, credor: 2 }))).toBe('credor-invalido');
    expect(codigo(credorDaConta({ tipoCredor: 'profissional', credor: 2, fornecedor: 3 }))).toBe(
      'credor-ambiguo',
    );
  });
});

describe('chave Pix que paga o título', () => {
  const c = (conta: number, nivel: 'credor' | 'prestador', preferencial: boolean): ChaveCandidata => ({
    conta,
    nivel,
    preferencial,
    tipoChavePix: 'aleatoria',
    chavePix: `chave-${conta}`,
  });

  it('sem chave ativa não há chave', () => {
    expect(escolherChavePix([])).toBeNull();
  });

  it('a do próprio credor vem antes da do prestador ligado, mesmo que a do prestador seja preferencial', () => {
    expect(escolherChavePix([c(9, 'prestador', true), c(2, 'credor', false)])?.conta).toBe(2);
  });

  it('sem chave do credor, vale a do prestador ligado', () => {
    expect(escolherChavePix([c(4, 'prestador', false)])?.chavePix).toBe('chave-4');
  });

  it('no mesmo nível, a preferencial e depois a mais recente', () => {
    expect(
      escolherChavePix([c(3, 'credor', false), c(1, 'credor', true), c(5, 'credor', false)])?.conta,
    ).toBe(1);
    expect(escolherChavePix([c(3, 'credor', false), c(5, 'credor', false)])?.conta).toBe(5);
  });
});
