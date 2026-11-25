// Rateio do repasse por setor e custos do prestador (F8, 06-FAT linha 49): regras puras.
import { describe, expect, it } from 'vitest';
import {
  ratearApuracaoPorSetor,
  ratearPorSetor,
  type RegraRateioVigente,
  regraDoMedico,
  validarCustoDoPrestador,
  validarRegraRateioSetor,
  validarTipoDescontoRepasse,
} from './rateio-setor.js';

const regra = (o: Partial<Parameters<typeof validarRegraRateioSetor>[0]> = {}) => ({
  descricao: 'Rateio do centro cirúrgico',
  profissional: 1,
  prestadorTerceiro: null,
  grupoRepasse: null,
  base: 'repasse',
  inicio: '2026-01-01',
  fim: null,
  setores: [
    { setor: 10, percentual: 60 },
    { setor: 20, percentual: 40 },
  ],
  ...o,
});
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('validarRegraRateioSetor', () => {
  it('aceita a regra com um dono e setores somando 100', () => {
    expect(validarRegraRateioSetor(regra())).toEqual([]);
  });
  it('recusa soma diferente de 100, setor repetido, percentual fora da faixa e dois donos', () => {
    expect(campos(validarRegraRateioSetor(regra({ setores: [{ setor: 10, percentual: 99.9999 }] })))).toEqual(
      ['setores'],
    );
    expect(
      campos(
        validarRegraRateioSetor(
          regra({
            setores: [
              { setor: 10, percentual: 50 },
              { setor: 10, percentual: 50 },
            ],
          }),
        ),
      ),
    ).toEqual(['setores.1.setor']);
    expect(campos(validarRegraRateioSetor(regra({ setores: [{ setor: 10, percentual: 100.5 }] })))).toContain(
      'setores.0.percentual',
    );
    expect(campos(validarRegraRateioSetor(regra({ grupoRepasse: 3 })))).toEqual(['profissional']);
    expect(campos(validarRegraRateioSetor(regra({ profissional: null })))).toEqual(['profissional']);
    expect(campos(validarRegraRateioSetor(regra({ base: 'outra', fim: '2025-12-31' })))).toEqual([
      'base',
      'fim',
    ]);
    expect(campos(validarRegraRateioSetor(regra({ setores: [], descricao: ' ' })))).toEqual([
      'descricao',
      'setores',
    ]);
  });
  it('aceita percentuais com 4 casas que somam 100', () => {
    expect(
      validarRegraRateioSetor(
        regra({
          setores: [
            { setor: 1, percentual: 33.3333 },
            { setor: 2, percentual: 33.3333 },
            { setor: 3, percentual: 33.3334 },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('ratearPorSetor', () => {
  it('divide pelos maiores restos e a soma fecha no valor', () => {
    const r = ratearPorSetor(10000, [
      { setor: 1, percentual: 33.3333 },
      { setor: 2, percentual: 33.3333 },
      { setor: 3, percentual: 33.3334 },
    ]);
    expect(r.reduce((t, x) => t + x.centavos, 0)).toBe(10000);
    expect(r).toEqual([
      { setor: 1, centavos: 3333 },
      { setor: 2, centavos: 3333 },
      { setor: 3, centavos: 3334 },
    ]);
    const s = ratearPorSetor(101, [
      { setor: 1, percentual: 50 },
      { setor: 2, percentual: 50 },
    ]);
    expect(s).toEqual([
      { setor: 1, centavos: 51 },
      { setor: 2, centavos: 50 },
    ]);
  });
  it('valor zero dá parcelas zero', () => {
    expect(ratearPorSetor(0, [{ setor: 1, percentual: 100 }])).toEqual([{ setor: 1, centavos: 0 }]);
  });
});

const vig = (o: Partial<RegraRateioVigente>): RegraRateioVigente => ({
  id: 1,
  profissional: null,
  grupoRepasse: null,
  base: 'repasse',
  inicio: '2026-01-01',
  fim: null,
  setores: [{ setor: 10, percentual: 100 }],
  ...o,
});

describe('regraDoMedico e ratearApuracaoPorSetor', () => {
  const regras = [
    vig({ id: 1, profissional: 7, inicio: '2026-01-01', fim: '2026-09-30' }),
    vig({
      id: 2,
      profissional: 7,
      inicio: '2026-10-01',
      setores: [
        { setor: 10, percentual: 70 },
        { setor: 20, percentual: 30 },
      ],
    }),
    vig({ id: 3, grupoRepasse: 5, base: 'custo', setores: [{ setor: 30, percentual: 100 }] }),
  ];
  it('a do médico vence a do grupo e a vigência escolhe a da competência', () => {
    expect(regraDoMedico(regras, 7, [5], '2026-10-01')?.id).toBe(2);
    expect(regraDoMedico(regras, 7, [5], '2026-09-01')?.id).toBe(1);
    expect(regraDoMedico(regras, 8, [5], '2026-10-01')?.id).toBe(3);
    expect(regraDoMedico(regras, 9, [], '2026-10-01')).toBeNull();
  });
  it('rateia o repasse ou o custo conforme a base e deixa pendente quem não tem regra nem valor', () => {
    const r = ratearApuracaoPorSetor(
      [
        { profissional: 7, repasseCentavos: 600000, custoCentavos: 50000, grupos: [5] },
        { profissional: 8, repasseCentavos: 100000, custoCentavos: 12345, grupos: [5] },
        { profissional: 9, repasseCentavos: 100000, custoCentavos: 0, grupos: [] },
        { profissional: 10, repasseCentavos: 100000, custoCentavos: 0, grupos: [5] },
      ],
      regras,
      '2026-10-01',
    );
    expect(r.parcelas).toEqual([
      { profissional: 7, setor: 10, regra: 2, base: 'repasse', centavos: 420000 },
      { profissional: 7, setor: 20, regra: 2, base: 'repasse', centavos: 180000 },
      { profissional: 8, setor: 30, regra: 3, base: 'custo', centavos: 12345 },
    ]);
    expect(r.pendencias).toEqual([
      { profissional: 9, motivo: 'sem-regra' },
      { profissional: 10, motivo: 'sem-valor' },
    ]);
  });
});

describe('custo do prestador e tipo de desconto', () => {
  const custo = {
    forma: 'valor',
    valor: 500,
    percentual: null,
    faixaInicial: null,
    faixaFinal: null,
    frequencia: 'mensal',
    natureza: 'desconto',
    inicio: '2026-01-01',
    fim: null,
  };
  it('confere forma, faixa, frequência e vigência', () => {
    expect(validarCustoDoPrestador(custo)).toEqual([]);
    expect(validarCustoDoPrestador({ ...custo, forma: 'percentual', valor: null, percentual: 2 })).toEqual(
      [],
    );
    expect(campos(validarCustoDoPrestador({ ...custo, valor: 0 }))).toEqual(['valor']);
    expect(campos(validarCustoDoPrestador({ ...custo, forma: 'percentual', percentual: 101 }))).toEqual([
      'percentual',
      'valor',
    ]);
    expect(
      campos(
        validarCustoDoPrestador({
          ...custo,
          faixaInicial: 10,
          faixaFinal: 5,
          frequencia: 'anual',
          fim: '2025-01-01',
        }),
      ),
    ).toEqual(['frequencia', 'faixaFinal', 'fim']);
  });
  it('o tipo de desconto pede o padrão da forma', () => {
    const tipo = {
      codigo: 'SALA',
      descricao: 'Uso de sala',
      natureza: 'custo',
      forma: 'informado',
      valorPadrao: null,
      percentualPadrao: null,
    };
    expect(validarTipoDescontoRepasse(tipo)).toEqual([]);
    expect(campos(validarTipoDescontoRepasse({ ...tipo, forma: 'valor_fixo' }))).toEqual(['valorPadrao']);
    expect(campos(validarTipoDescontoRepasse({ ...tipo, forma: 'percentual' }))).toEqual([
      'percentualPadrao',
    ]);
    expect(campos(validarTipoDescontoRepasse({ ...tipo, codigo: 'com espaço', natureza: 'x' }))).toEqual([
      'codigo',
      'natureza',
    ]);
  });
});
