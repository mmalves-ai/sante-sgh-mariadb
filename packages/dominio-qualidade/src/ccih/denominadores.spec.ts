// Regra 5 do M48 (denominadores): dispositivos-dia pelo fim do dia, pacientes-dia do censo, densidade por 1.000 e
// utilização por 100 com as parcelas; consolidação pela soma das parcelas. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  consolidarSetores,
  denominadoresDoSetor,
  diasDeDispositivoNaCompetencia,
  diasDeUso,
  dispositivosDoDenominador,
  dispositivosDiaDaAba,
  dispositivosSemRetiradaAposAlta,
  limitarPelaAlta,
  pacientesDiaPorSetor,
  parcela,
} from './denominadores.js';
import { diasDaCompetencia, diferencaDias, limitesDaCompetencia, somarDias } from './tempo.js';

const AGORA = '2026-11-02T08:00:00';
const cvc = (inseridoEm: string, retiradoEm: string | null = null, setor = 'UTI') => ({
  tipo: 'cvc' as const,
  setor,
  inseridoEm,
  retiradoEm,
});

describe('tempo', () => {
  it('dias da competência, limites, soma e diferença de dias', () => {
    expect(diasDaCompetencia('2026-02')).toHaveLength(28);
    expect(diasDaCompetencia('2028-02')).toHaveLength(29);
    expect(limitesDaCompetencia('2026-10')).toEqual({ de: '2026-10-01', ate: '2026-10-31' });
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(diferencaDias('2026-10-30T23:00', '2026-11-01T01:00')).toBe(2);
  });
});

describe('dispositivos-dia (fim do dia, como o censo)', () => {
  it('conta cada dia em que estava instalado no fim do dia', () => {
    // Inserido em 10/10 14h, retirado em 13/10 9h: instalado no fim de 10, 11 e 12 → 3.
    expect(
      diasDeDispositivoNaCompetencia(cvc('2026-10-10T14:00', '2026-10-13T09:00'), '2026-10', AGORA),
    ).toBe(3);
  });
  it('inserido e retirado no mesmo dia: 0; retirado à meia-noite seguinte ainda conta o dia', () => {
    expect(
      diasDeDispositivoNaCompetencia(cvc('2026-10-10T08:00', '2026-10-10T20:00'), '2026-10', AGORA),
    ).toBe(0);
    expect(
      diasDeDispositivoNaCompetencia(cvc('2026-10-10T08:00', '2026-10-11T00:00'), '2026-10', AGORA),
    ).toBe(1);
  });
  it('em uso: até o último dia terminado; só os dias da competência', () => {
    expect(diasDeDispositivoNaCompetencia(cvc('2026-10-30T10:00'), '2026-10', AGORA)).toBe(2);
    expect(diasDeDispositivoNaCompetencia(cvc('2026-10-30T10:00'), '2026-11', AGORA)).toBe(1);
    expect(
      diasDeDispositivoNaCompetencia(cvc('2026-09-28T10:00', '2026-10-02T10:00'), '2026-10', AGORA),
    ).toBe(1);
  });
  it('dias de uso para a tela (inserção = dia 1)', () => {
    expect(diasDeUso({ inseridoEm: '2026-10-30T23:00', retiradoEm: null }, AGORA)).toBe(4);
    expect(diasDeUso({ inseridoEm: '2026-10-30T08:00', retiradoEm: '2026-10-30T09:00' }, AGORA)).toBe(1);
  });
});

describe('indicadores do setor', () => {
  it('parcela com fator; denominador zero dá valor nulo', () => {
    expect(parcela(2, 300, 1000)).toEqual({ numerador: 2, denominador: 300, fator: 1000, valor: 6.67 });
    expect(parcela(0, 0, 100).valor).toBeNull();
  });
  it('densidade só das IRAS associadas; utilização por 100 pacientes-dia', () => {
    const d = denominadoresDoSetor({
      setor: 'UTI',
      competencia: '2026-10',
      agora: AGORA,
      pacientesDia: 200,
      dispositivos: [
        cvc('2026-10-01T08:00', '2026-10-21T08:00'),
        {
          tipo: 'sondaVesical',
          setor: 'UTI',
          inseridoEm: '2026-10-05T08:00',
          retiradoEm: '2026-10-15T08:00',
        },
      ],
      iras: [
        { sitio: 'ipcs', setor: 'UTI', associada: true },
        { sitio: 'ipcs', setor: 'UTI', associada: false },
        { sitio: 'isc', setor: 'UTI', associada: false },
      ],
    });
    expect(d.dispositivosDia).toEqual({ cvc: 20, sondaVesical: 10, ventilacaoMecanica: 0 });
    expect(d.iras).toEqual({ ipcs: 1, pav: 0, itu: 0 });
    expect(d.densidade.ipcs).toEqual({ numerador: 1, denominador: 20, fator: 1000, valor: 50 });
    expect(d.densidade.pav.valor).toBeNull();
    expect(d.utilizacao.cvc).toEqual({ numerador: 20, denominador: 200, fator: 100, valor: 10 });
  });
  it('consolidado: soma das parcelas, razão recalculada', () => {
    const base = { competencia: '2026-10', agora: AGORA, iras: [] };
    const a = denominadoresDoSetor({
      ...base,
      setor: 'A',
      pacientesDia: 100,
      dispositivos: [cvc('2026-10-01T08:00', '2026-10-11T08:00')],
    });
    const b = denominadoresDoSetor({
      ...base,
      setor: 'B',
      pacientesDia: 300,
      dispositivos: [cvc('2026-10-01T08:00', '2026-10-31T08:00')],
      iras: [{ sitio: 'ipcs', setor: 'B', associada: true }],
    });
    const t = consolidarSetores([a, b]);
    expect(t.setor).toBe('todos');
    expect(t.pacientesDia).toBe(400);
    expect(t.dispositivosDia.cvc).toBe(40);
    expect(t.densidade.ipcs).toMatchObject({ numerador: 1, denominador: 40, valor: 25 });
    expect(t.utilizacao.cvc.valor).toBe(10);
  });
  it('pacientes-dia do censo por setor, só da competência', () => {
    const m = pacientesDiaPorSetor(
      [
        { setor: 'UTI', data: '2026-10-01', internados: 8 },
        { setor: 'UTI', data: '2026-10-02', internados: 9 },
        { setor: 'CM', data: '2026-10-02', internados: 20 },
        { setor: 'UTI', data: '2026-11-01', internados: 7 },
      ],
      '2026-10',
    );
    expect([...m]).toEqual([
      ['UTI', 17],
      ['CM', 20],
    ]);
  });
});

describe('dispositivo sem retirada e alta feita fora do Sante (D-ALTA-DISP-48.3)', () => {
  it('conta só até a alta: o dia da alta não conta, como no censo', () => {
    const d = cvc('2026-10-05T10:00:00');
    expect(diasDeDispositivoNaCompetencia(d, '2026-10', AGORA)).toBe(27);
    const limitado = limitarPelaAlta(d, '2026-10-15');
    expect(limitado.retiradoEm).toBe('2026-10-15T00:00:00');
    // Do dia 5 ao dia 14 (10 dias); a competência seguinte não conta mais nada.
    expect(diasDeDispositivoNaCompetencia(limitado, '2026-10', AGORA)).toBe(10);
    expect(diasDeDispositivoNaCompetencia(limitado, '2026-11', '2026-12-02T08:00:00')).toBe(0);
  });

  it('a retirada antes da alta vale; internação aberta não muda nada', () => {
    const d = cvc('2026-10-05T10:00:00', '2026-10-08T09:00:00');
    expect(limitarPelaAlta(d, '2026-10-15')).toBe(d);
    const aberto = cvc('2026-10-05T10:00:00');
    expect(limitarPelaAlta(aberto, null)).toBe(aberto);
    expect(limitarPelaAlta(cvc('2026-10-05T10:00:00', '2026-10-20T09:00:00'), '2026-10-15').retiradoEm).toBe(
      '2026-10-15T00:00:00',
    );
  });

  it('lista à CCIH os dispositivos abertos de internação encerrada', () => {
    const ds = [
      { ...cvc('2026-10-05T10:00:00'), reg: 1 },
      { ...cvc('2026-10-05T10:00:00', '2026-10-06T10:00:00'), reg: 2 },
      { ...cvc('2026-10-05T10:00:00'), reg: 3 },
    ];
    const altas = new Map<number, string | null>([
      [1, '2026-10-15'],
      [2, '2026-10-15'],
      [3, null],
    ]);
    expect(dispositivosSemRetiradaAposAlta(ds, altas).map((d) => [d.reg, d.alta])).toEqual([
      [1, '2026-10-15'],
    ]);
  });
});

describe('W0-04: o denominador sai do mesmo registro, sem os cancelados', () => {
  it('o dispositivo cancelado (lançado errado) não conta dispositivo-dia; o corrigido conta pela versão nova', () => {
    const valido = cvc('2026-10-10T14:00', '2026-10-13T09:00');
    const cancelado = { ...cvc('2026-10-01T08:00', null), canceladoEm: '2026-10-02T10:00:00' };
    const d = denominadoresDoSetor({
      setor: 'UTI',
      competencia: '2026-10',
      agora: AGORA,
      pacientesDia: 100,
      dispositivos: [valido, cancelado],
      iras: [],
    });
    expect(d.dispositivosDia.cvc).toBe(3);
    expect(d.utilizacao.cvc).toEqual({ numerador: 3, denominador: 100, fator: 100, valor: 3 });
    expect(dispositivosDoDenominador([valido, cancelado])).toEqual([valido]);
  });
});

describe('W0-04 (M1): a aba de dispositivos do prontuário e o denominador contam o mesmo registro', () => {
  it('a soma dos dispositivos-dia da aba é o denominador do setor; o cancelado fica fora dos dois', () => {
    const svd = (inserido: string, retirado: string | null) => ({
      ...cvc(inserido, retirado),
      tipo: 'sondaVesical' as const,
    });
    const registro = [
      { ...cvc('2026-10-10T14:00', '2026-10-13T09:00'), id: 1 },
      { ...svd('2026-10-20T08:00', null), id: 2 },
      { ...cvc('2026-10-01T08:00', null), id: 3, canceladoEm: '2026-10-02T10:00:00' },
    ];
    const aba = dispositivosDiaDaAba(registro, '2026-10', AGORA);
    const d = denominadoresDoSetor({
      setor: 'UTI',
      competencia: '2026-10',
      agora: AGORA,
      pacientesDia: 100,
      dispositivos: registro,
      iras: [],
    });
    expect(aba.map((x) => x.id)).toEqual([1, 2]);
    const soma = (tipo: string) => aba.filter((x) => x.tipo === tipo).reduce((s, x) => s + x.dias, 0);
    expect(soma('cvc')).toBe(d.dispositivosDia.cvc);
    expect(soma('sondaVesical')).toBe(d.dispositivosDia.sondaVesical);
    expect(d.dispositivosDia.sondaVesical).toBeGreaterThan(0);
  });
});
