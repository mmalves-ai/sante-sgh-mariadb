// `suprimentos.aprovarPedido` (ficha do M28): faixa de valor, marca de autorizar pedido, solicitante e justificativa.
import { describe, expect, it } from 'vitest';
import { conferirAprovacaoPedido, faixaDoValor, situacaoGravavel } from '@sgh/contratos/regras-suprimentos';

const ok = {
  valor: 1000,
  aprovador: { podeAutorizar: true, nivel: 1, login: 'APROV' },
  solicitante: 'COMP',
  decisao: 'aprovado' as const,
  justificativa: '',
  jaDecidido: false,
};

describe('aprovação por alçada', () => {
  it('a faixa do valor', () => {
    expect(faixaDoValor(5000).nivel).toBe(1);
    expect(faixaDoValor(5000.01).nivel).toBe(2);
    expect(faixaDoValor(1e9).nivel).toBe(3);
    expect(faixaDoValor(10, [{ ate: 5, nivel: 1 }]).nivel).toBe(1);
  });
  it('dentro da faixa aprova; recusas', () => {
    expect(conferirAprovacaoPedido(ok)).toBeNull();
    expect(conferirAprovacaoPedido({ ...ok, jaDecidido: true })?.codigo).toBe('pedido-ja-decidido');
    expect(
      conferirAprovacaoPedido({ ...ok, aprovador: { ...ok.aprovador, podeAutorizar: false } })?.codigo,
    ).toBe('sem-alcada');
    expect(conferirAprovacaoPedido({ ...ok, valor: 10_000 })?.codigo).toBe('fora-da-alcada');
    expect(conferirAprovacaoPedido({ ...ok, solicitante: 'APROV' })?.codigo).toBe('aprovador-solicitante');
    expect(conferirAprovacaoPedido({ ...ok, decisao: 'reprovado' })?.codigo).toBe('sem-justificativa');
  });
  it('só as situações vistas são gravadas', () => {
    expect(situacaoGravavel(2)).toBe(true);
    expect(situacaoGravavel(5)).toBe(false);
  });
});
