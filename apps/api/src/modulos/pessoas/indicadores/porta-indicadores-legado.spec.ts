// W0-06, parte 7b-2: a porta do painel sobre o núcleo (só leitura). As horas do ponto saem dos totais por classe dos
// fechamentos (conta conferida à mão abaixo); cada fonte é lida isolada e a que falha vira aviso sem derrubar as
// outras; só `lerSomente` é usado (nenhuma gravação). Núcleo dublê respondendo por tabela; dados sintéticos.
import type { Leitor, NucleoLegado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import {
  horasDoPontoFechado,
  lerBaseIndicadores,
  portaIndicadoresPessoasLegado,
} from './porta-indicadores-legado.js';

const UTI = { setor: 20, nomeSetor: 'UTI' };
// Minutos por classe: 1 normais, 2 débito, 5 extra, 7 falta, 8 abonada, 9 tolerância.
const T1 = JSON.stringify({ classes: { 1: 9000, 2: 60, 5: 600, 7: 480, 8: 480, 9: 30 }, eventos: {} });
const T2 = JSON.stringify({ classes: { 1: 6000, 3: 120, 4: 60, 6: 30 } });

describe('horasDoPontoFechado', () => {
  it('soma por setor: trabalhadas = normais + extras; ausência = 2 + 7 + 8; previstas = normais + ausência + 9', () => {
    const { horas, ilegiveis } = horasDoPontoFechado([
      { ...UTI, totais: T1, enfermagem: true },
      { ...UTI, totais: T2, enfermagem: false },
      { ...UTI, totais: '{"x":', enfermagem: true },
      { ...UTI, totais: null, enfermagem: true },
    ]);
    expect(ilegiveis).toBe(2);
    // T1: normais 150 h, extras 10 h, ausência (60+480+480)/60 = 17 h, tolerância 0,5 h.
    // T2: normais 100 h, extras (120+60+30)/60 = 3,5 h.
    expect(horas).toEqual([
      {
        ...UTI,
        horasTrabalhadas: 150 + 10 + 100 + 3.5,
        horasExtras: 10 + 3.5,
        horasAusencia: 17,
        horasPrevistas: 150 + 17 + 0.5 + 100,
        horasEnfermagem: 160,
      },
    ]);
  });
});

/** Núcleo dublê: responde pela tabela citada no SQL; `falhar` derruba a leitura que cita a tabela. */
function nucleo(falhar: string | null = null) {
  const lidos: string[] = [];
  const leitor = {
    hospital: 'pc',
    lerBlob: async () => Buffer.alloc(0),
    consultar: async (sql: string) => {
      lidos.push(sql);
      if (falhar && sql.includes(falhar)) throw new Error('tabela fora');
      if (sql.includes('RDB$DATABASE') || sql.includes('CURRENT_'))
        return [{ AGORA: '2026-04-02 10:00:00', HOJE: '2026-04-02' }];
      if (sql.includes('SGH_INT_CENSO_DIA')) return [{ BLOCO: 'B1', N: 31 }];
      if (sql.includes('UNIDADE_INTERNACAO'))
        return [{ UNIDADE_INTERNACAO: 'B1', ID_TBUNIDAD: 20, SETOR: 'UTI' }];
      if (sql.includes('SGH_PES_PONTO_FECHAMENTO'))
        return [{ ID_TBUNIDAD: 20, SETOR: 'UTI', COMPETENCIA: '2026-01', TOTAIS: T1, ENF: 'T' }];
      if (sql.includes('SGH_PES_FOLHA_CALCULO')) return [{ ID_TBUNIDAD: 20, SETOR: 'UTI', VALOR: 5000 }];
      if (sql.includes('SGH_PES_TREIN_PARTICIPANTE'))
        return [{ ID_TBUNIDAD: 20, SETOR: 'UTI', MINUTOS: 120 }];
      if (sql.includes('SGH_PES_ACIDENTE')) return [{ ID_TBUNIDAD: 20, SETOR: 'UTI', N: 1, AFASTADOS: 0 }];
      if (sql.includes('SGH_PES_DIMENSIONAMENTO'))
        return [{ ID_TBUNIDAD: 20, SETOR: 'UTI', P_INTENSIVOS: 8, P_MINIMOS: 0 }];
      if (sql.includes('SGH_PES_VINCULO'))
        return [{ ID_TBUNIDAD: 20, SETOR: 'UTI', ADMISSAO: '2025-01-01', DESLIGAMENTO: null }];
      return [];
    },
  } as unknown as Leitor;
  let transacoes = 0;
  const n = {
    lerSomente: async <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => {
      transacoes += 1;
      return fn(leitor);
    },
  } as unknown as Pick<NucleoLegado, 'lerSomente'>;
  return { n, lidos, transacoes: () => transacoes };
}

const C = { rede: '', hospital: 'pc', usuario: 'SINT.RH' } as never;
const R = { inicio: '2026-01-01', fim: '2026-03-31', hospital: 'pc', setor: null };

describe('portaIndicadoresPessoasLegado', () => {
  it('monta a base do recorte com as sete fontes, cada uma na sua transação de leitura', async () => {
    const d = nucleo();
    const { base, indisponiveis } = await portaIndicadoresPessoasLegado(d.n).base(C, R);
    expect(indisponiveis).toEqual([]);
    expect(d.transacoes()).toBe(7);
    const h = { hospital: 'pc', ...UTI };
    expect(base.vinculos).toEqual([{ ...h, admissao: '2025-01-01', desligamento: null }]);
    expect(base.ponto).toEqual([
      {
        ...h,
        horasPrevistas: 167.5,
        horasTrabalhadas: 160,
        horasAusencia: 17,
        horasExtras: 10,
        horasEnfermagem: 160,
      },
    ]);
    expect(base.folhaHorasExtras).toEqual([{ ...h, valorCent: 5000 }]);
    expect(base.treinamento).toEqual([{ ...h, horas: 2 }]);
    expect(base.acidentes).toEqual([{ ...h, quantidade: 1, comAfastamento: 0 }]);
    expect(base.censo).toEqual([{ ...h, pacientesDia: 31 }]);
    expect(base.dimensionamento[0]).toMatchObject({ ...h, pacientes: { intensivos: 8, minimos: 0 } });
    expect(d.lidos.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });

  it('a fonte que falha vem vazia e com o motivo; as outras seguem', async () => {
    const d = nucleo('SGH_PES_ACIDENTE');
    const { base, indisponiveis } = await portaIndicadoresPessoasLegado(d.n).base(C, R);
    expect(base.acidentes).toEqual([]);
    expect(base.vinculos).toHaveLength(1);
    expect(indisponiveis).toEqual([{ fonte: 'sesmt', motivo: expect.stringContaining('tabela fora') }]);
  });

  it('fechamento ilegível e fonte fora entram em ordem nos avisos', async () => {
    const lerTudo = async <T>(fn: (l: Leitor) => Promise<T>): Promise<T> =>
      fn({
        hospital: 'pc',
        lerBlob: async () => Buffer.alloc(0),
        consultar: async (sql: string) => {
          if (sql.includes('SGH_PES_FOLHA_CALCULO')) throw 'sem folha';
          return sql.includes('SGH_PES_PONTO_FECHAMENTO')
            ? [{ ID_TBUNIDAD: 20, SETOR: 'UTI', TOTAIS: 'x' }]
            : [];
        },
      } as unknown as Leitor);
    const { indisponiveis } = await lerBaseIndicadores(lerTudo, 'pc', R);
    expect(indisponiveis.map((x) => x.fonte)).toEqual(['ponto', 'folha']);
    expect(indisponiveis[1]?.motivo).toContain('sem folha');
  });

  it('setores e hoje pelo banco, em leitura', async () => {
    const d = nucleo();
    const p = portaIndicadoresPessoasLegado(d.n);
    expect(p.destino).toBe('legado');
    expect(await p.setores(C)).toEqual([{ codigo: 20, rotulo: 'UTI' }]);
  });
});
