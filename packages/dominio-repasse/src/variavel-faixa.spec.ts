// Remuneração variável por faixa (F8, 06-FAT linha 48): faixas, incremento progressivo, período e rateio da equipe.
import { describe, expect, it } from 'vitest';
import {
  calcularVariavelFaixa,
  conferirComposicao,
  conflitoRegraVariavel,
  type FaixaVariavel,
  type MembroEquipeVariavel,
  percentualEfetivo,
  periodoDaCompetencia,
  ratearEquipe,
  type RegraVariavelFaixa,
  validarMembroEquipe,
  validarRegraVariavelFaixa,
} from './variavel-faixa.js';

const faixa = (f: Partial<FaixaVariavel>): FaixaVariavel => ({
  de: 0,
  ate: null,
  ajuste: 'acrescimo',
  percentual: null,
  valorFixo: null,
  incremento: null,
  sobreLiquido: false,
  ...f,
});

const regra: RegraVariavelFaixa = {
  codigo: 'CIR-1',
  descricao: 'Cirurgias do mês',
  profissional: 7,
  equipe: null,
  indicador: 'quantidade_cirurgias',
  periodo: 'mensal',
  considerarPacote: false,
  percentualPacote: null,
  inicio: '2026-01-01',
  fim: null,
  faixas: [
    faixa({ de: 0, ate: 9, ajuste: 'desconto', valorFixo: 100 }),
    faixa({ de: 10, ate: 19, percentual: 5 }),
    faixa({ de: 20, percentual: 10 }),
  ],
};

const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('remuneração variável por faixa: validação', () => {
  it('aceita a regra bem formada', () => {
    expect(validarRegraVariavelFaixa(regra)).toEqual([]);
  });

  it('exige um beneficiário só, faixas em ordem e sem sobreposição', () => {
    expect(campos(validarRegraVariavelFaixa({ ...regra, equipe: 3 }))).toContain('beneficiario');
    expect(campos(validarRegraVariavelFaixa({ ...regra, profissional: null }))).toContain('beneficiario');
    const sobre = validarRegraVariavelFaixa({
      ...regra,
      faixas: [faixa({ de: 0, ate: 10, percentual: 1 }), faixa({ de: 10, percentual: 2 })],
    });
    expect(sobre.map((x) => x.mensagem).join()).toContain('se sobrepõem');
    expect(campos(validarRegraVariavelFaixa({ ...regra, faixas: [] }))).toContain('faixas');
  });

  it('recusa faixa vazia, quantidade fracionada, percentual fora de 0..100 e incremento sem teto', () => {
    const msgs = (f: FaixaVariavel) =>
      validarRegraVariavelFaixa({ ...regra, faixas: [f] })
        .map((x) => x.mensagem)
        .join(' | ');
    expect(msgs(faixa({}))).toContain('precisa de percentual');
    expect(msgs(faixa({ de: 1.5, percentual: 2 }))).toContain('números inteiros');
    expect(msgs(faixa({ percentual: 120 }))).toContain('entre 0');
    expect(msgs(faixa({ percentual: 5, incremento: 2 }))).toContain('sem teto');
    expect(msgs(faixa({ ate: 10, percentual: 95, incremento: 10 }))).toContain('passa de 100%');
  });

  it('em indicador de valor, faixa fracionada é aceita; pacote exige percentual', () => {
    expect(
      validarRegraVariavelFaixa({
        ...regra,
        indicador: 'valor_produzido',
        faixas: [faixa({ de: 0.5, percentual: 2 })],
      }),
    ).toEqual([]);
    expect(campos(validarRegraVariavelFaixa({ ...regra, considerarPacote: true }))).toContain(
      'percentualPacote',
    );
    expect(campos(validarRegraVariavelFaixa({ ...regra, percentualPacote: 50 }))).toContain(
      'percentualPacote',
    );
    expect(validarRegraVariavelFaixa({ ...regra, considerarPacote: true, percentualPacote: 50 })).toEqual([]);
  });

  it('regra que cruza outra vigente do mesmo beneficiário e indicador é recusada', () => {
    expect(
      conflitoRegraVariavel({ inicio: '2026-06-01', fim: null }, [{ inicio: '2026-01-01', fim: null }]),
    ).toHaveLength(1);
    expect(
      conflitoRegraVariavel({ inicio: '2026-06-01', fim: null }, [
        { inicio: '2026-01-01', fim: '2026-05-31' },
      ]),
    ).toEqual([]);
  });
});

describe('remuneração variável por faixa: período', () => {
  it('mensal fecha todo mês; trimestral, semestral e anual só no último mês', () => {
    expect(periodoDaCompetencia('mensal', '2026-10-01')).toMatchObject({
      inicio: '2026-10-01',
      fim: '2026-10-01',
      fecha: true,
    });
    expect(periodoDaCompetencia('trimestral', '2026-08-01')).toMatchObject({
      inicio: '2026-07-01',
      fim: '2026-09-01',
      fecha: false,
    });
    expect(periodoDaCompetencia('trimestral', '2026-09-01')).toMatchObject({
      fecha: true,
      competencias: ['2026-07-01', '2026-08-01', '2026-09-01'],
    });
    expect(periodoDaCompetencia('semestral', '2026-06-01')).toMatchObject({
      inicio: '2026-01-01',
      fecha: true,
    });
    expect(periodoDaCompetencia('anual', '2026-11-01')).toMatchObject({
      inicio: '2026-01-01',
      fim: '2026-12-01',
      fecha: false,
    });
  });
});

describe('remuneração variável por faixa: cálculo', () => {
  const ent = {
    indicador: 'quantidade_cirurgias' as const,
    faixas: regra.faixas,
    producaoBrutaCentavos: 1_000_000,
    producaoLiquidaCentavos: 800_000,
    margemCentavos: null,
  };

  it('enquadra a medida e aplica o percentual sobre a produção', () => {
    const r = calcularVariavelFaixa({ ...ent, medida: 12 });
    expect(r.ordemFaixa).toBe(2);
    expect(r.valorCentavos).toBe(50_000);
    expect(r.memoria).toContain('faixa 2');
  });

  it('faixa de desconto sai negativa; última faixa sem teto vale para cima', () => {
    expect(calcularVariavelFaixa({ ...ent, medida: 3 }).valorCentavos).toBe(-10_000);
    expect(calcularVariavelFaixa({ ...ent, medida: 400 }).valorCentavos).toBe(100_000);
  });

  it('fora de toda faixa não gera valor', () => {
    const r = calcularVariavelFaixa({ ...ent, faixas: [faixa({ de: 5, ate: 9, percentual: 1 })], medida: 2 });
    expect(r).toMatchObject({ faixa: null, valorCentavos: 0 });
  });

  it('o incremento progressivo cresce em linha reta dentro da faixa', () => {
    const f = faixa({ de: 10, ate: 20, percentual: 5, incremento: 5 });
    expect(percentualEfetivo(f, 10)).toBe(5);
    expect(percentualEfetivo(f, 15)).toBe(7.5);
    expect(percentualEfetivo(f, 20)).toBe(10);
    expect(calcularVariavelFaixa({ ...ent, faixas: [f], medida: 15 }).valorCentavos).toBe(75_000);
  });

  it('sobre o líquido usa a produção líquida; fixo soma ao percentual', () => {
    const f = faixa({ percentual: 10, valorFixo: 50, sobreLiquido: true });
    expect(calcularVariavelFaixa({ ...ent, faixas: [f], medida: 1 }).valorCentavos).toBe(80_000 + 5_000);
  });

  it('resultado: base é a margem; margem negativa não gera valor', () => {
    const f = [faixa({ de: 0, percentual: 10 })];
    const r = { ...ent, indicador: 'resultado' as const, faixas: f };
    expect(calcularVariavelFaixa({ ...r, medida: 2000, margemCentavos: 200_000 }).valorCentavos).toBe(20_000);
    expect(calcularVariavelFaixa({ ...r, medida: 0, margemCentavos: -5_000 }).valorCentavos).toBe(0);
  });
});

describe('remuneração variável por faixa: equipe', () => {
  const m = (x: Partial<MembroEquipeVariavel>): MembroEquipeVariavel => ({
    profissional: 1,
    terceiro: null,
    cota: 50,
    chefe: false,
    inicio: '2026-01-01',
    fim: null,
    ...x,
  });

  it('membro: um alvo só e cota válida', () => {
    expect(validarMembroEquipe(m({}))).toEqual([]);
    expect(campos(validarMembroEquipe(m({ terceiro: 4 })))).toContain('membro');
    expect(campos(validarMembroEquipe(m({ cota: 0 })))).toContain('cota');
  });

  it('composição vigente soma 100%, um chefe só, sem repetição', () => {
    const ok = [m({ profissional: 1, cota: 60, chefe: true }), m({ profissional: 2, cota: 40 })];
    expect(conferirComposicao(ok, '2026-10-01')).toEqual([]);
    expect(
      conferirComposicao([...ok, m({ profissional: 3, cota: 10, fim: '2026-03-31' })], '2026-10-01'),
    ).toEqual([]);
    expect(conferirComposicao([m({ cota: 30 })], '2026-10-01')[0]!.mensagem).toContain('somam 30%');
    expect(
      campos(
        conferirComposicao(
          [m({ profissional: 1, chefe: true }), m({ profissional: 2, chefe: true })],
          '2026-10-01',
        ),
      ),
    ).toContain('chefe');
    expect(
      campos(conferirComposicao([m({ profissional: 1 }), m({ profissional: 1 })], '2026-10-01')),
    ).toContain('membro');
    expect(campos(conferirComposicao([], '2026-10-01'))).toContain('membros');
  });

  it('rateio pelas cotas com a sobra ao chefe, e o sinal do desconto mantido', () => {
    const membros = [
      { id: 1, cota: 33.3333, chefe: false },
      { id: 2, cota: 33.3333, chefe: true },
      { id: 3, cota: 33.3334, chefe: false },
    ];
    const r = ratearEquipe(10_000, membros);
    expect(r.reduce((s, x) => s + x.valorCentavos, 0)).toBe(10_000);
    expect(r.map((x) => x.valorCentavos)).toEqual([3_333, 3_334, 3_333]);
    const neg = ratearEquipe(-1_001, [
      { id: 1, cota: 50, chefe: false },
      { id: 2, cota: 50, chefe: false },
    ]);
    expect(neg.reduce((s, x) => s + x.valorCentavos, 0)).toBe(-1_001);
    expect(ratearEquipe(100, [])).toEqual([]);
  });
});
