import { describe, expect, it } from 'vitest';
import {
  conferirEncerramento,
  conferirRecolhimento,
  conferirRegraRetencao,
  type RegraRetencao,
  regraVigente,
  sugerirRetencoes,
  vencimentoRecolhimento,
} from './retencao-regra.js';

const regra = (x: Partial<RegraRetencao>): RegraRetencao => ({
  id: 1,
  tributo: 'IRRF',
  momento: 'pagamento',
  participante: 'todos',
  municipio: null,
  percentualBase: 100,
  aliquota: 1.5,
  faixaInicio: null,
  faixaFim: null,
  deducao: 0,
  minimo: 10,
  maximo: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});
const fato = {
  data: '2026-10-10',
  valorBruto: 1000,
  momento: 'pagamento' as const,
  participante: 'pessoa_juridica' as const,
  municipio: 3550308,
};

describe('retenção sugerida pela regra vigente (07-FIN linha 109)', () => {
  it('calcula base, valor e dispensa pelo mínimo', () => {
    const s = sugerirRetencoes([regra({}), regra({ id: 2, tributo: 'CSLL', aliquota: 1 })], fato);
    expect(s).toEqual([
      // R$ 10,00 é dispensado: a lei dispensa o valor igual ou inferior ao mínimo.
      { tributo: 'CSLL', regra: 2, base: 1000, aliquota: 1, valor: 10, dispensada: true },
      { tributo: 'IRRF', regra: 1, base: 1000, aliquota: 1.5, valor: 15, dispensada: false },
    ]);
    expect(sugerirRetencoes([regra({})], { ...fato, valorBruto: 500 })[0]).toMatchObject({
      valor: 7.5,
      dispensada: true,
    });
    expect(sugerirRetencoes([regra({})], { ...fato, valorBruto: 1000.67 })[0]).toMatchObject({
      valor: 15.01,
      dispensada: false,
    });
  });
  it('PIS, COFINS e CSLL da mesma guia (5952) são dispensados pela soma, não por tributo', () => {
    const guia = [
      regra({ id: 1, tributo: 'PIS', aliquota: 0.65, codigoReceita: '5952' }),
      regra({ id: 2, tributo: 'COFINS', aliquota: 3, codigoReceita: '5952' }),
      regra({ id: 3, tributo: 'CSLL', aliquota: 1, codigoReceita: '5952' }),
    ];
    // 4,65% de 300 = 13,95 na guia: retém os três, embora cada um isolado fique abaixo de 10.
    expect(sugerirRetencoes(guia, { ...fato, valorBruto: 300 }).map((s) => [s.valor, s.dispensada])).toEqual([
      [9, false],
      [3, false],
      [1.95, false],
    ]);
    // 4,65% de 200 = 9,30 na guia: os três dispensados.
    expect(sugerirRetencoes(guia, { ...fato, valorBruto: 200 }).every((s) => s.dispensada)).toBe(true);
    // Sem código de receita comum, cada tributo é a sua própria guia.
    expect(
      sugerirRetencoes(
        guia.map((g) => ({ ...g, codigoReceita: null })),
        { ...fato, valorBruto: 300 },
      ).map((s) => s.dispensada),
    ).toEqual([true, true, true]);
  });
  it('respeita vigência, momento e prefere a regra mais específica', () => {
    const regras = [
      regra({ id: 1, vigenciaFim: '2026-06-30', aliquota: 1 }),
      regra({ id: 2, vigenciaInicio: '2026-07-01' }),
      regra({ id: 3, vigenciaInicio: '2026-07-01', participante: 'pessoa_juridica', aliquota: 2 }),
      regra({ id: 4, momento: 'emissao', aliquota: 9 }),
    ];
    expect(regraVigente(regras, 'IRRF', fato)?.id).toBe(3);
    expect(regraVigente(regras, 'IRRF', { ...fato, data: '2026-03-01' })?.id).toBe(1);
    expect(regraVigente(regras, 'IRRF', { ...fato, participante: 'pessoa_fisica' })?.id).toBe(2);
  });
  it('ISS só pela regra do município do serviço, com base parcial, dedução e teto', () => {
    const iss = [
      regra({
        id: 7,
        tributo: 'ISS',
        municipio: 3550308,
        aliquota: 5,
        percentualBase: 60,
        deducao: 5,
        maximo: 20,
        minimo: 0,
      }),
    ];
    expect(sugerirRetencoes(iss, fato)).toEqual([
      { tributo: 'ISS', regra: 7, base: 600, aliquota: 5, valor: 20, dispensada: false },
    ]);
    expect(sugerirRetencoes(iss, { ...fato, municipio: 3304557 })).toEqual([]);
  });
  it('recusa regra com alíquota fora, vigência invertida ou sobreposta', () => {
    const base = { ...regra({}) } as Omit<RegraRetencao, 'id' | 'ativo'>;
    expect(conferirRegraRetencao({ ...base, aliquota: 0 }, [])?.codigo).toBe('aliquota-invalida');
    expect(conferirRegraRetencao({ ...base, vigenciaFim: '2025-01-01' }, [])?.codigo).toBe(
      'vigencia-invalida',
    );
    expect(conferirRegraRetencao(base, [regra({ vigenciaInicio: '2025-01-01' })])?.codigo).toBe(
      'vigencia-sobreposta',
    );
    expect(
      conferirRegraRetencao(base, [regra({ vigenciaInicio: '2025-01-01', vigenciaFim: '2025-12-31' })]),
    ).toBeNull();
    // Faixas que se cruzam com início diferente (0-1000 e 500-2000) sobrepõem; faixas disjuntas convivem.
    expect(
      conferirRegraRetencao({ ...base, faixaInicio: 500, faixaFim: 2000 }, [
        regra({ faixaInicio: 0, faixaFim: 1000 }),
      ])?.codigo,
    ).toBe('vigencia-sobreposta');
    expect(
      conferirRegraRetencao({ ...base, faixaInicio: 1000.01, faixaFim: 2000 }, [
        regra({ faixaInicio: 0, faixaFim: 1000 }),
      ]),
    ).toBeNull();
  });
  it('encerrar só antecipa o fim, não volta antes do início e não cruza outra vigência', () => {
    const aberta = regra({ id: 1, vigenciaInicio: '2026-01-01' });
    const encerrada = regra({ id: 2, vigenciaInicio: '2025-01-01', vigenciaFim: '2025-06-30' });
    expect(conferirEncerramento(aberta, '2026-12-31', [aberta])).toBeNull();
    expect(conferirEncerramento(aberta, '2025-12-31', [aberta])?.codigo).toBe('vigencia-invalida');
    expect(conferirEncerramento(encerrada, '2025-12-31', [encerrada, aberta])?.codigo).toBe('so-antecipar');
    expect(conferirEncerramento(encerrada, '2025-03-31', [encerrada, aberta])).toBeNull();
    // Uma regra legada aberta sobreposta a outra: o encerramento que ainda cruza a outra é recusado.
    const outra = regra({ id: 3, vigenciaInicio: '2026-06-01' });
    expect(conferirEncerramento(aberta, '2026-09-30', [aberta, outra])?.codigo).toBe('vigencia-sobreposta');
    expect(conferirEncerramento(aberta, '2026-05-31', [aberta, outra])).toBeNull();
  });
  it('vencimento no mês seguinte e conferência do recolhimento', () => {
    expect(vencimentoRecolhimento('2026-01', 31)).toBe('2026-02-28');
    expect(vencimentoRecolhimento('2026-12', 20)).toBe('2027-01-20');
    expect(conferirRecolhimento([], '1708')?.codigo).toBe('sem-retido');
    expect(conferirRecolhimento([{ valor: 15 }], null)?.codigo).toBe('sem-codigo-receita');
    expect(conferirRecolhimento([{ valor: 15 }], '1708')).toBeNull();
  });
});
