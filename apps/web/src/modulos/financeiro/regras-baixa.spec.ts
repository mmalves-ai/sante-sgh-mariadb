// F3.8, 07-FIN linha 63: a prévia da baixa na tela (a mesma conta do domínio, para o pagador ver antes de gravar).
import { describe, expect, it } from 'vitest';
import { camposBaixaVazios, previaBaixa } from './regras-baixa.js';

const campos = (x: Partial<ReturnType<typeof camposBaixaVazios>> = {}) => ({ ...camposBaixaVazios(), ...x });

describe('prévia da baixa do título a pagar', () => {
  it('em branco quita o saldo e não manda campo nenhum', () => {
    expect(previaBaixa(1000, campos())).toEqual({
      desembolso: 1000,
      liquida: 1000,
      resta: 0,
      aviso: null,
      corpo: {},
    });
  });

  it('valor menor que o saldo: mostra o que fica em aberto; desconto liquida, juros não', () => {
    const p = previaBaixa(1000, campos({ valorPago: '400', desconto: '30', juros: 10 }));
    expect(p).toMatchObject({ desembolso: 400, liquida: 420, resta: 580, aviso: null });
    expect(p.corpo).toEqual({ valorPago: 400, desconto: 30, juros: 10 });
  });

  it('só desconto e acréscimo: quita com o desembolso ajustado; vírgula decimal aceita', () => {
    expect(previaBaixa(800, campos({ desconto: '50', acrescimo: '2,5' }))).toMatchObject({
      desembolso: 752.5,
      liquida: 800,
      resta: 0,
      aviso: null,
    });
  });

  it('avisa na hora: acima do saldo, desconto total, só encargos e valor inválido', () => {
    expect(previaBaixa(300, campos({ valorPago: '300.01' })).aviso).toBe('acimaDoSaldo');
    expect(previaBaixa(300, campos({ desconto: '300' })).aviso).toBe('descontoTotal');
    expect(previaBaixa(300, campos({ valorPago: '15', juros: '15' })).aviso).toBe('soEncargos');
    expect(previaBaixa(300, campos({ valorPago: '-1' })).aviso).toBe('valorInvalido');
    expect(previaBaixa(300, campos({ valorPago: 'abc' })).aviso).toBe('valorInvalido');
    expect(previaBaixa(300, campos({ valorPago: '0' })).aviso).toBe('valorInvalido');
  });
});
