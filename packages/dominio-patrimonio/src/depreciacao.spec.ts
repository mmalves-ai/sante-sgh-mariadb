// Regra 12 do M54 (ficha, seção 8): depreciação mensal linear com o coeficiente acelerado por turno, com as parcelas no
// teste. Bens sintéticos.
import { describe, expect, it } from 'vitest';
import {
  type BemParaDepreciar,
  cotaDoMes,
  impedimentosDoCalculo,
  mesesEntre,
  montarTotais,
  planoDaDepreciacao,
  resumoDoCalculo,
} from './depreciacao.js';

const P = { aplicarCoeficiente: true, considerarResidual: true };

const bem = (extra: Partial<BemParaDepreciar> = {}): BemParaDepreciar => ({
  id: 1,
  plaqueta: 'PC000001',
  descricao: 'Monitor',
  grupo: 'equipamentoMedico',
  centro: 10,
  valorCent: 12_000_00,
  residualCent: 0,
  vidaUtilMeses: 120,
  coeficiente: null,
  inicioDepreciacao: '2026-01',
  depreciavel: true,
  situacao: 'ativo',
  baixadoEm: null,
  acumuladaCent: 0,
  temCotaNaCompetencia: false,
  ...extra,
});

const valor = (b: BemParaDepreciar, comp: string, p = P): number => {
  const r = cotaDoMes(b, comp, p);
  return 'cota' in r ? r.cota.valorCent : -1;
};

describe('regra 12: cota mensal linear', () => {
  it('12.000,00 em 120 meses: 100,00 por mês, com as parcelas da conta', () => {
    const r = cotaDoMes(bem(), '2026-01', P);
    expect(r).toEqual({
      cota: {
        bem: 1,
        plaqueta: 'PC000001',
        descricao: 'Monitor',
        grupo: 'equipamentoMedico',
        centro: 10,
        baseCent: 12_000_00,
        residualCent: 0,
        vidaUtilMeses: 120,
        coeficiente: 1,
        acumuladaAntesCent: 0,
        mesesDecorridos: 1,
        valorCent: 100_00,
        acumuladaDepoisCent: 100_00,
        ultima: false,
        recuperaMeses: false,
      },
    });
  });

  it('o residual sai da base quando o parâmetro manda; senão, deprecia o valor inteiro', () => {
    const b = bem({ residualCent: 2_000_00 });
    expect(valor(b, '2026-01')).toBe(83_33); // (12.000 − 2.000) ÷ 120 = 83,333…
    expect(valor(b, '2026-01', { ...P, considerarResidual: false })).toBe(100_00);
  });

  it('o arredondamento não se acumula: as cotas somam exatamente o valor depreciável', () => {
    let b = bem({ valorCent: 1_000_00, vidaUtilMeses: 7, inicioDepreciacao: '2026-01' });
    const cotas: number[] = [];
    for (const comp of [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]) {
      const r = cotaDoMes(b, comp, P);
      if (!('cota' in r)) {
        expect(r.semCota).toBe('depreciado');
        break;
      }
      cotas.push(r.cota.valorCent);
      b = { ...b, acumuladaCent: r.cota.acumuladaDepoisCent };
      if (comp === '2026-07') expect(r.cota.ultima).toBe(true);
    }
    expect(cotas).toEqual([142_86, 142_85, 142_86, 142_86, 142_86, 142_85, 142_86]);
    expect(cotas.reduce((s, v) => s + v, 0)).toBe(1_000_00);
  });

  it('coeficiente por turno: 2 turnos (1,5) acelera; sem o parâmetro, não aplica', () => {
    const b = bem({ coeficiente: 1.5 });
    expect(valor(b, '2026-01')).toBe(150_00);
    expect(valor(b, '2026-01', { ...P, aplicarCoeficiente: false })).toBe(100_00);
    // 3 turnos (2,0): termina na metade da vida útil
    let x = bem({ coeficiente: 2, valorCent: 1_200_00, vidaUtilMeses: 12 });
    let n = 0;
    for (let m = 1; m <= 12; m++) {
      const r = cotaDoMes(x, `2026-${String(m).padStart(2, '0')}`, P);
      if (!('cota' in r)) break;
      n++;
      x = { ...x, acumuladaCent: r.cota.acumuladaDepoisCent };
    }
    expect(n).toBe(6);
    expect(x.acumuladaCent).toBe(1_200_00);
  });

  it('bem cadastrado depois do início recupera os meses na primeira cota (marcada)', () => {
    const r = cotaDoMes(bem({ inicioDepreciacao: '2025-11' }), '2026-01', P);
    expect('cota' in r && r.cota).toMatchObject({
      mesesDecorridos: 3,
      valorCent: 300_00,
      recuperaMeses: true,
    });
  });

  it('sem cota: não depreciável, baixado (até o mês anterior ao da baixa), antes do início, já calculado, depreciado', () => {
    const motivo = (b: BemParaDepreciar, comp = '2026-03') => {
      const r = cotaDoMes(b, comp, P);
      return 'semCota' in r ? r.semCota : 'cota';
    };
    expect(motivo(bem({ depreciavel: false }))).toBe('nao-depreciavel');
    expect(motivo(bem({ situacao: 'baixado', baixadoEm: '2026-03-15' }))).toBe('baixado');
    expect(motivo(bem({ situacao: 'baixado', baixadoEm: null }))).toBe('baixado');
    expect(motivo(bem({ situacao: 'baixado', baixadoEm: '2026-04-01' }))).toBe('cota');
    expect(motivo(bem({ inicioDepreciacao: '2026-04' }))).toBe('ainda-nao-iniciou');
    expect(motivo(bem({ temCotaNaCompetencia: true }))).toBe('ja-calculado');
    expect(motivo(bem({ acumuladaCent: 12_000_00 }))).toBe('depreciado');
    expect(motivo(bem({ situacao: 'emprestado' }))).toBe('cota');
  });

  it('meses entre competências', () => {
    expect(mesesEntre('2025-11', '2026-01')).toBe(3);
    expect(mesesEntre('2026-02', '2026-01')).toBe(0);
  });
});

describe('plano da competência, com as parcelas por grupo e por centro', () => {
  it('total = soma das cotas = soma das parcelas', () => {
    const bens = [
      bem(),
      bem({
        id: 2,
        plaqueta: 'PC000002',
        grupo: 'informatica',
        valorCent: 6_000_00,
        vidaUtilMeses: 60,
        centro: 20,
      }),
      bem({ id: 3, plaqueta: 'PC000003', depreciavel: false }),
    ];
    const plano = planoDaDepreciacao(bens, '2026-01', P, (id) => `Setor ${id}`);
    expect(plano.totalCent).toBe(200_00);
    expect(plano.porGrupo).toEqual([
      { chave: 'equipamentoMedico', rotulo: 'Equipamentos médico-hospitalares', bens: 1, valorCent: 100_00 },
      { chave: 'informatica', rotulo: 'Equipamentos de informática', bens: 1, valorCent: 100_00 },
    ]);
    expect(plano.porCentro.map((c) => [c.rotulo, c.valorCent])).toEqual([
      ['Setor 10', 100_00],
      ['Setor 20', 100_00],
    ]);
    expect(plano.porCentro.reduce((s, c) => s + c.valorCent, 0)).toBe(plano.totalCent);
    expect(plano.semCota).toEqual([{ bem: 3, plaqueta: 'PC000003', motivo: 'nao-depreciavel' }]);
    expect(JSON.parse(resumoDoCalculo(plano))).toEqual({
      total: 200_00,
      cotas: 2,
      recuperam: 0,
      ultimas: 0,
      semCota: { 'nao-depreciavel': 1 },
      porGrupo: [
        ['equipamentoMedico', 1, 100_00],
        ['informatica', 1, 100_00],
      ],
    });
    expect(montarTotais(plano.cotas).porCentro.map((c) => c.rotulo)).toEqual(['10', '20']);
    expect(montarTotais([{ ...plano.cotas[0]!, grupo: 'x' as never }]).porGrupo[0]?.rotulo).toBe('x');
  });
});

describe('impedimentos do cálculo (sequência e parâmetros)', () => {
  const par = { empresa: 1, depreciar: true, aplicarCoeficiente: false, considerarResidual: false };
  it('a primeira competência pode ser qualquer uma até o mês atual', () => {
    expect(
      impedimentosDoCalculo('2026-03', { parametros: par, ultimaCalculada: null, mesAtual: '2026-10' }),
    ).toEqual([]);
    expect(
      impedimentosDoCalculo('2026-11', { parametros: par, ultimaCalculada: null, mesAtual: '2026-10' }),
    ).toEqual(['A competência ainda não começou.']);
  });
  it('depois, só a seguinte; a calculada não se recalcula', () => {
    const c = { parametros: par, ultimaCalculada: '2026-03', mesAtual: '2026-10' };
    expect(impedimentosDoCalculo('2026-04', c)).toEqual([]);
    expect(impedimentosDoCalculo('2026-03', c)[0]).toMatch(/já foi calculada/);
    expect(impedimentosDoCalculo('2026-02', c)[0]).toMatch(/não se recalcula/);
    expect(impedimentosDoCalculo('2026-06', c)[0]).toMatch(/Calcule antes a competência 2026-04/);
  });
  it('os parâmetros da empresa mandam depreciar', () => {
    expect(
      impedimentosDoCalculo('2026-03', { parametros: null, ultimaCalculada: null, mesAtual: '2026-10' })[0],
    ).toMatch(/não tem os parâmetros/);
    expect(
      impedimentosDoCalculo('2026-03', {
        parametros: { ...par, depreciar: false },
        ultimaCalculada: null,
        mesAtual: '2026-10',
      })[0],
    ).toMatch(/sem a depreciação/);
  });
});
