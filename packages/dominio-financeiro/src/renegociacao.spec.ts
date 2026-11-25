// F3.8, 07-FIN linha 76: a regra da renegociação de títulos a receber (dados sintéticos).
import { describe, expect, it } from 'vitest';
import {
  conferirDesfazerRenegociacao,
  type EntradaRenegociacao,
  type ParcelaRenegociavel,
  planejarRenegociacao,
  ratearEmCentavos,
  vencimentosMensais,
} from './index.js';

const parcela = (
  n: number,
  saldo: number,
  extra: Partial<ParcelaRenegociavel> = {},
): ParcelaRenegociavel => ({
  parcela: n,
  titulo: 100 + n,
  situacao: 'aberta',
  valor: saldo,
  saldo,
  devedor: 'paciente:7',
  emEncontro: false,
  ...extra,
});
const entrada = (extra: Partial<EntradaRenegociacao> = {}): EntradaRenegociacao => ({
  dataAcordo: '2026-11-24',
  parcelas: [parcela(1, 600), parcela(2, 400)],
  juros: 0,
  multa: 0,
  desconto: 0,
  quantidadeParcelas: 1,
  primeiroVencimento: '2026-12-10',
  ...extra,
});
const codigo = (r: unknown) => (r as { codigo?: string }).codigo ?? 'plano';

describe('renegociação de títulos a receber', () => {
  it('soma os saldos, aplica juros, multa e desconto e divide em parcelas iguais com os centavos na última', () => {
    const p = planejarRenegociacao(entrada({ juros: 30, multa: 20, desconto: 50, quantidadeParcelas: 3 }));
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.valorOriginal).toBe(1000);
    expect(p.valorRenegociado).toBe(1000);
    expect(p.novas.map((n) => n.valor)).toEqual([333.33, 333.33, 333.34]);
    expect(p.novas.reduce((x, n) => x + n.valor, 0)).toBeCloseTo(p.valorRenegociado, 2);
    expect(p.novas.map((n) => n.vencimento)).toEqual(['2026-12-10', '2027-01-10', '2027-02-10']);
  });

  it('rateia juros, multa e desconto pelo saldo de cada parcela original, fechando a soma em centavos', () => {
    const p = planejarRenegociacao(
      entrada({ parcelas: [parcela(1, 100), parcela(2, 100), parcela(3, 100)], juros: 10, desconto: 1 }),
    );
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.itens.map((i) => i.juros)).toEqual([3.33, 3.33, 3.34]);
    expect(p.itens.map((i) => i.desconto)).toEqual([0.33, 0.33, 0.34]);
    expect(p.itens.reduce((x, i) => x + i.juros, 0)).toBeCloseTo(10, 2);
    expect(p.valorRenegociado).toBe(309);
  });

  it('leva ao acordo o saldo da parcela recebida em parte, guardando o valor da emissão', () => {
    const p = planejarRenegociacao(
      entrada({ parcelas: [parcela(1, 250, { situacao: 'parcial', valor: 1000 })] }),
    );
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.itens[0]).toMatchObject({ valorOriginal: 1000, saldo: 250 });
    expect(p.valorRenegociado).toBe(250);
  });

  it('o dia 31 cai no último dia dos meses mais curtos, inclusive fevereiro', () => {
    expect(vencimentosMensais('2027-01-31', 4)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(vencimentosMensais('2026-11-15', 3)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  it('o rateio sem peso não inventa valor e a sobra vai à última parte', () => {
    expect(ratearEmCentavos(0, [1, 2])).toEqual([0, 0]);
    expect(ratearEmCentavos(1, [1, 1, 1])).toEqual([0.33, 0.33, 0.34]);
    expect(ratearEmCentavos(5, [])).toEqual([]);
  });

  it.each([
    ['sem-parcela', entrada({ parcelas: [] })],
    ['parcela-repetida', entrada({ parcelas: [parcela(1, 10), parcela(1, 10)] })],
    ['parcela-nao-renegociavel', entrada({ parcelas: [parcela(1, 10, { situacao: 'recebida' })] })],
    ['parcela-nao-renegociavel', entrada({ parcelas: [parcela(1, 0)] })],
    ['parcela-nao-renegociavel', entrada({ parcelas: [parcela(1, 10, { situacao: 'renegociada' })] })],
    ['devedores-diferentes', entrada({ parcelas: [parcela(1, 10), parcela(2, 10, { devedor: 'fonte:3' })] })],
    ['parcela-em-encontro', entrada({ parcelas: [parcela(1, 10, { emEncontro: true })] })],
    ['valor-invalido', entrada({ juros: -1 })],
    ['parcelas-invalidas', entrada({ quantidadeParcelas: 0 })],
    ['parcelas-invalidas', entrada({ quantidadeParcelas: 361 })],
    ['parcelas-invalidas', entrada({ quantidadeParcelas: 1.5 })],
    ['data-invalida', entrada({ primeiroVencimento: '2026-13-40' })],
    ['vencimento-passado', entrada({ primeiroVencimento: '2026-11-23' })],
    ['desconto-total', entrada({ desconto: 1000 })],
    ['desconto-total', entrada({ desconto: 1500 })],
    ['parcela-sem-valor', entrada({ parcelas: [parcela(1, 0.02)], quantidadeParcelas: 3 })],
  ])('recusa %s', (esperado, e) => {
    expect(codigo(planejarRenegociacao(e))).toBe(esperado);
  });

  it('a primeira parcela pode vencer no próprio dia do acordo', () => {
    expect(codigo(planejarRenegociacao(entrada({ primeiroVencimento: '2026-11-24' })))).toBe('plano');
  });

  it('desfazer: só o efetivado, sem recebimento nem parcela movimentada, e com motivo', () => {
    const a = {
      situacao: 'efetivada',
      recebidoNoAcordo: 0,
      parcelaNovaMovimentada: false,
      motivo: 'Lançado em duplicidade',
    };
    expect(conferirDesfazerRenegociacao(a)).toBeNull();
    expect(conferirDesfazerRenegociacao({ ...a, situacao: 'cancelada' })?.codigo).toBe(
      'acordo-nao-efetivado',
    );
    expect(conferirDesfazerRenegociacao({ ...a, recebidoNoAcordo: 0.01 })?.codigo).toBe(
      'acordo-com-recebimento',
    );
    expect(conferirDesfazerRenegociacao({ ...a, parcelaNovaMovimentada: true })?.codigo).toBe(
      'acordo-com-recebimento',
    );
    expect(conferirDesfazerRenegociacao({ ...a, motivo: ' ok ' })?.codigo).toBe('motivo-obrigatorio');
  });
});
