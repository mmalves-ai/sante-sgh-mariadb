// F3.8, 07-FIN linha 109: a retenção sofrida no recebimento e o saldo a compensar.
import { describe, expect, it } from 'vitest';
import { type RegraRetencao, sugerirRetencoes } from './retencao-regra.js';
import {
  conferirCancelamentoCompensacao,
  conferirCompensacaoSofrida,
  conferirEstornoRetencaoSofrida,
  conferirRetencaoSofrida,
  creditoAteACompetencia,
  efeitoRetencaoSofrida,
  municipioDoServicoRetido,
  saldoACompensar,
  totalRetidoSofrido,
} from './retencao-sofrida.js';

const item = (tributo: number, valor: number, base = 1000, aliquota = 1.5) => ({
  tributo,
  base,
  aliquota,
  valor,
});
const base = {
  emAberto: true,
  saldoParcela: 1000,
  jaRetidos: [] as number[],
  data: '2026-10-10',
  hoje: '2026-10-10',
};

describe('retenção sofrida no recebimento', () => {
  it('aceita o retido que cabe na base e no saldo, e soma em centavos', () => {
    const itens = [item(1, 15), item(2, 46.5, 1000, 4.65)];
    expect(conferirRetencaoSofrida({ ...base, itens })).toBeNull();
    expect(totalRetidoSofrido(itens)).toBe(61.5);
  });

  it('recusa sem item, tributo repetido, já retido na parcela, valor, base e alíquota inválidos', () => {
    const cod = (itens: ReturnType<typeof item>[], extra = {}) =>
      conferirRetencaoSofrida({ ...base, ...extra, itens })?.codigo;
    expect(cod([])).toBe('sem-item');
    expect(cod([item(1, 15), item(1, 10)])).toBe('tributo-repetido');
    expect(cod([item(1, 15)], { jaRetidos: [1] })).toBe('tributo-ja-retido');
    expect(cod([item(1, 0)])).toBe('valor-invalido');
    expect(cod([item(1, 15, 0)])).toBe('base-invalida');
    expect(cod([item(1, 15, 1000, 0)])).toBe('aliquota-invalida');
    expect(cod([item(1, 15, 1000, 101)])).toBe('aliquota-invalida');
    expect(cod([item(1, 20, 10)])).toBe('retido-maior-que-base');
    expect(cod([item(1, 15)], { emAberto: false })).toBe('titulo-ja-baixado');
  });

  it('recusa a data de recebimento futura ou inválida; a de hoje e a passada entram', () => {
    const cod = (data: string) => conferirRetencaoSofrida({ ...base, data, itens: [item(1, 15)] })?.codigo;
    expect(cod('2026-10-11')).toBe('data-futura');
    expect(cod('2027-01-01')).toBe('data-futura');
    expect(cod('2026-13-40')).toBe('data-invalida');
    expect(cod('10/10/2026')).toBe('data-invalida');
    expect(cod('2026-10-10')).toBeUndefined();
    expect(cod('2026-09-30')).toBeUndefined();
  });

  it('recusa a soma do retido acima do saldo da parcela; igual ao saldo quita', () => {
    expect(
      conferirRetencaoSofrida({ ...base, saldoParcela: 60, itens: [item(1, 15), item(2, 46.5)] })?.codigo,
    ).toBe('retido-maior-que-saldo');
    expect(
      conferirRetencaoSofrida({ ...base, saldoParcela: 61.5, itens: [item(1, 15), item(2, 46.5)] }),
    ).toBeNull();
    expect(efeitoRetencaoSofrida(61.5, 61.5)).toEqual({ saldo: 0, quita: true });
    expect(efeitoRetencaoSofrida(1000, 61.5)).toEqual({ saldo: 938.5, quita: false });
  });

  it('a sugestão do recebimento sai da regra vigente no momento "recebimento", não da regra do pagamento', () => {
    const regra = (id: number, momento: RegraRetencao['momento'], aliquota: number): RegraRetencao => ({
      id,
      tributo: 'IRRF',
      momento,
      participante: 'todos',
      municipio: null,
      percentualBase: 100,
      aliquota,
      faixaInicio: null,
      faixaFim: null,
      deducao: 0,
      minimo: 10,
      maximo: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      ativo: true,
    });
    const s = sugerirRetencoes([regra(1, 'pagamento', 3), regra(2, 'recebimento', 1.5)], {
      data: '2026-10-10',
      valorBruto: 2000,
      momento: 'recebimento',
      participante: 'pessoa_juridica',
      municipio: null,
    });
    expect(s).toEqual([
      { tributo: 'IRRF', regra: 2, base: 2000, aliquota: 1.5, valor: 30, dispensada: false },
    ]);
  });

  it('o estorno exige motivo e recusa a retenção já compensada', () => {
    const e = { existe: true, compensada: false, motivo: 'VALOR ERRADO' };
    expect(conferirEstornoRetencaoSofrida(e)).toBeNull();
    expect(conferirEstornoRetencaoSofrida({ ...e, existe: false })?.codigo).toBe('nao-encontrado');
    expect(conferirEstornoRetencaoSofrida({ ...e, compensada: true })?.codigo).toBe('retencao-compensada');
    expect(conferirEstornoRetencaoSofrida({ ...e, motivo: 'oi' })?.codigo).toBe('sem-motivo');
  });

  it('o saldo a compensar é o retido menos o compensado, por tributo, com a competência mais antiga em aberto', () => {
    const s = saldoACompensar([
      { tributo: 'IRRF', competencia: '2026-09', valor: 15, compensado: true },
      { tributo: 'IRRF', competencia: '2026-10', valor: 30.1, compensado: false },
      { tributo: 'IRRF', competencia: '2026-11', valor: 0.2, compensado: false },
      { tributo: 'COFINS', competencia: '2026-10', valor: 60, compensado: true },
    ]);
    expect(s).toEqual([
      { tributo: 'COFINS', retido: 60, compensado: 60, aCompensar: 0, desde: null, creditos: [] },
      {
        tributo: 'IRRF',
        retido: 45.3,
        compensado: 15,
        aCompensar: 30.3,
        desde: '2026-10',
        creditos: [
          { competencia: '2026-10', valor: 30.1 },
          { competencia: '2026-11', valor: 0.2 },
        ],
      },
    ]);
    // O valor que a compensação usa numa competência é só o crédito até ela (é o que a tela confirma).
    const irrf = s[1]?.creditos ?? [];
    expect(creditoAteACompetencia(irrf, '2026-09')).toBe(0);
    expect(creditoAteACompetencia(irrf, '2026-10')).toBe(30.1);
    expect(creditoAteACompetencia(irrf, '2026-11')).toBe(30.3);
  });

  it('a compensação só usa o crédito até a competência da apuração', () => {
    const creditos = [{ competencia: '2026-11', valor: 30 }];
    expect(conferirCompensacaoSofrida(creditos, '2026-10')?.codigo).toBe('sem-credito');
    expect(conferirCompensacaoSofrida(creditos, '2026-11')).toBeNull();
    expect(conferirCompensacaoSofrida([], '2026-11')?.codigo).toBe('sem-credito');
    expect(conferirCompensacaoSofrida(creditos, '11/2026')?.codigo).toBe('competencia-invalida');
  });

  it('o cancelamento da compensação exige motivo e não se repete', () => {
    const c = { existe: true, cancelada: false, motivo: 'COMPETENCIA ERRADA' };
    expect(conferirCancelamentoCompensacao(c)).toBeNull();
    expect(conferirCancelamentoCompensacao({ ...c, existe: false })?.codigo).toBe('nao-encontrado');
    expect(conferirCancelamentoCompensacao({ ...c, cancelada: true })?.codigo).toBe('compensacao-cancelada');
    expect(conferirCancelamentoCompensacao({ ...c, motivo: ' oi ' })?.codigo).toBe('sem-motivo');
  });

  it('o município do serviço do ISS retido é o da nota ligada ao título; sem nota, o do estabelecimento', () => {
    expect(municipioDoServicoRetido({ nota: 20, estabelecimento: 10 })).toBe(20);
    expect(municipioDoServicoRetido({ nota: null, estabelecimento: 10 })).toBe(10);
    expect(municipioDoServicoRetido({ nota: null, estabelecimento: null })).toBeNull();
  });
});
