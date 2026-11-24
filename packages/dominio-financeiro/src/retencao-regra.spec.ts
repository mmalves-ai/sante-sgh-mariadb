import { describe, expect, it } from 'vitest';
import {
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
      { tributo: 'CSLL', regra: 2, base: 1000, aliquota: 1, valor: 10, dispensada: false },
      { tributo: 'IRRF', regra: 1, base: 1000, aliquota: 1.5, valor: 15, dispensada: false },
    ]);
    expect(sugerirRetencoes([regra({})], { ...fato, valorBruto: 500 })[0]).toMatchObject({
      valor: 7.5,
      dispensada: true,
    });
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
  });
  it('vencimento no mês seguinte e conferência do recolhimento', () => {
    expect(vencimentoRecolhimento('2026-01', 31)).toBe('2026-02-28');
    expect(vencimentoRecolhimento('2026-12', 20)).toBe('2027-01-20');
    expect(conferirRecolhimento([], '1708')?.codigo).toBe('sem-retido');
    expect(conferirRecolhimento([{ valor: 15 }], null)?.codigo).toBe('sem-codigo-receita');
    expect(conferirRecolhimento([{ valor: 15 }], '1708')).toBeNull();
  });
});
