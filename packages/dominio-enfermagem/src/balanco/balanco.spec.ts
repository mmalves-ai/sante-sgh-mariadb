// Regra 6 do M45 (etapa 3): balanço sem redigitação (ganho da checagem uma vez só, mesmo com o reenvio sem rede),
// perdas por tipo com a intensidade quando o tipo exige, perdas insensíveis por fórmula versionada, fechamento padrão
// às 7 h configurável por unidade, débito urinário em mL/kg/h com o alerta de oligúria. Dados SINTÉTICOS.
import type { DominiosBalanco, LancamentoBalancoLido } from '@sgh/contratos';
import { esquemaLancamentoBalanco } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  calcularBalanco,
  comImpressao,
  conferirFechamento,
  parcelasDoBalanco,
  textoDoFechamento,
} from './calculo.js';
import { type ChecagemParaBalanco, diureseDosSinais, ganhoDoHorario, ganhosDaChecagem } from './ganhos.js';
import { debitoUrinario, formulaInsensivel, FORMULAS_INSENSIVEL, perdaInsensivel } from './insensiveis.js';
import {
  horaDoCorte,
  janelaDoInstante,
  janelaQueComecaEm,
  janelasRecentes,
  dentroDaJanela,
} from './janela.js';
import { conferirEstorno, conferirLancamento, janelaFechada, lancamentosVigentes } from './lancamento.js';

const D: DominiosBalanco = {
  grupos: [
    { codigo: 1, nome: 'VO' },
    { codigo: 2, nome: 'Enteral' },
    { codigo: 3, nome: 'Parenteral' },
    { codigo: 4, nome: 'EV' },
  ],
  tiposEliminacao: [
    {
      codigo: 1,
      nome: 'Diurese',
      ativo: true,
      pedeIntensidade: false,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
    { codigo: 3, nome: 'Êmese', ativo: true, pedeIntensidade: true, aceitaEstimado: true, pedeAspecto: true },
    {
      codigo: 4,
      nome: 'Evacuação',
      ativo: true,
      pedeIntensidade: true,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
    {
      codigo: 7,
      nome: 'Inativo',
      ativo: false,
      pedeIntensidade: false,
      aceitaEstimado: true,
      pedeAspecto: false,
    },
    {
      codigo: 8,
      nome: 'Medido',
      ativo: true,
      pedeIntensidade: false,
      aceitaEstimado: false,
      pedeAspecto: false,
    },
  ],
  intensidades: [1, 2, 3, 4].map((codigo) => ({ codigo, nome: `${codigo}+/4+` })),
  tiposFechamento: [
    { codigo: 1, nome: 'PARCIAL' },
    { codigo: 2, nome: 'TOTAL' },
  ],
  vias: [
    { codigo: 'EV', nome: 'ENDOVENOSA' },
    { codigo: 'VO', nome: 'VIA ORAL' },
  ],
};
const PI = formulaInsensivel('PI-2026.1');

const chk = (x: Partial<ChecagemParaBalanco> = {}): ChecagemParaBalanco => ({
  horario: 9001,
  tipo: 'solucao',
  situacao: 'A',
  descricao: 'SORO SINTETICO 500 ML',
  dose: 500,
  unidadeDose: 'ML',
  via: 'EV',
  checadoEm: '2026-10-24T22:05',
  horaReal: null,
  quantidade: null,
  volumeInfundidoMl: null,
  ...x,
});

const lido = (x: Partial<LancamentoBalancoLido>): LancamentoBalancoLido => ({
  id: 1,
  sentido: 'perda',
  origem: 'manual',
  grupo: null,
  via: null,
  tipoEliminacao: 1,
  intensidade: null,
  aspecto: null,
  estimado: false,
  volumeMl: 100,
  horaReal: '2026-10-24T10:00',
  descricao: null,
  horario: null,
  sinal: null,
  estornado: null,
  estornadoPor: null,
  motivo: null,
  origemOffline: false,
  usuario: 'SINT.ENF',
  gravadoEm: '2026-10-24T10:01',
  ...x,
});

describe('janela do balanço (regra 6: fechamento padrão às 7 h, configurável por unidade)', () => {
  it('a janela vai das 7 h às 7 h do dia seguinte; antes das 7 h é a do dia anterior', () => {
    expect(janelaDoInstante('2026-10-25T10:30', '0700')).toEqual({
      inicio: '2026-10-25T07:00',
      fim: '2026-10-26T07:00',
    });
    expect(janelaDoInstante('2026-10-25T06:59', '0700')).toEqual({
      inicio: '2026-10-24T07:00',
      fim: '2026-10-25T07:00',
    });
    expect(janelaDoInstante('2026-10-25T07:00', '0700').inicio).toBe('2026-10-25T07:00');
  });
  it('a hora de corte da unidade muda a janela (ex.: 6 h na UTI)', () => {
    expect(janelaDoInstante('2026-10-25T06:30', '06:00').inicio).toBe('2026-10-25T06:00');
    expect(horaDoCorte('0600')).toBe('06:00');
    expect(() => horaDoCorte('2500')).toThrow();
  });
  it('a janela escolhida tem de começar na hora de corte', () => {
    expect(janelaQueComecaEm('2026-10-24T07:00', '0700').fim).toBe('2026-10-25T07:00');
    expect(() => janelaQueComecaEm('2026-10-24T08:00', '0700')).toThrow(/hora de corte/);
  });
  it('as janelas recentes marcam a atual e as fechadas', () => {
    const js = janelasRecentes('2026-10-25T10:00', '0700', new Set(['2026-10-24T07:00']));
    expect(js.map((j) => [j.inicio, j.atual, j.fechada])).toEqual([
      ['2026-10-25T07:00', true, false],
      ['2026-10-24T07:00', false, true],
      ['2026-10-23T07:00', false, false],
    ]);
    expect(dentroDaJanela('2026-10-25T07:00', js[1]!)).toBe(false);
    expect(dentroDaJanela('2026-10-25T06:59', js[1]!)).toBe(true);
  });
  it('as janelas que acabaram antes da internação não são oferecidas (a em curso fica sempre)', () => {
    const desde = '2026-10-24T09:00';
    expect(janelasRecentes('2026-10-25T10:00', '0700', new Set(), 3, desde).map((j) => j.inicio)).toEqual([
      '2026-10-25T07:00',
      '2026-10-24T07:00',
    ]);
    expect(janelasRecentes('2026-10-25T10:00', '0700', new Set(), 3, '2026-10-25T09:00')).toHaveLength(1);
  });
});

describe('ganhos da checagem (regra 6: sem redigitação, uma vez só mesmo com o reenvio sem rede)', () => {
  const J = { inicio: '2026-10-24T07:00', fim: '2026-10-25T07:00' };
  it('o horário administrado em mL entra pelo grupo da via', () => {
    expect(ganhoDoHorario(chk())).toEqual({ ok: true, grupo: 4, via: 'EV', volumeMl: 500 });
    expect(ganhoDoHorario(chk({ via: 'VO', tipo: 'medicamento', dose: 20 }))).toMatchObject({ grupo: 1 });
    expect(ganhoDoHorario(chk({ via: 'VE', tipo: 'dieta', dose: 250 }))).toMatchObject({ grupo: 2 });
    expect(ganhoDoHorario(chk({ via: null, tipo: 'dieta', dose: 250 }))).toMatchObject({ grupo: 2 });
  });
  it('o volume infundido registrado vale mais que a quantidade, e a quantidade mais que a dose', () => {
    expect(ganhoDoHorario(chk({ volumeInfundidoMl: 430, quantidade: 480 }))).toMatchObject({ volumeMl: 430 });
    expect(ganhoDoHorario(chk({ quantidade: 480 }))).toMatchObject({ volumeMl: 480 });
  });
  it('sem mL, via fora do balanço, sem via ou não administrado: não entra sozinho, com o motivo', () => {
    expect(ganhoDoHorario(chk({ unidadeDose: 'MG', dose: 2 }))).toMatchObject({ ok: false });
    expect(ganhoDoHorario(chk({ via: 'IM' }))).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/IM/),
    });
    expect(ganhoDoHorario(chk({ via: null, tipo: 'medicamento' }))).toMatchObject({ ok: false });
    expect(ganhoDoHorario(chk({ situacao: 'N' }))).toMatchObject({ ok: false });
  });
  it('o mesmo horário reenviado sem rede conta uma vez só; o já lançado não volta; fora da janela não entra', () => {
    const offline = chk({ horaReal: '2026-10-24T21:50' });
    const r = ganhosDaChecagem(
      [
        offline,
        offline,
        chk({ horario: 9002, checadoEm: '2026-10-25T07:30' }),
        chk({ horario: 9003 }),
        chk({ horario: 9004, unidadeDose: 'G', dose: 1 }),
        chk({ horario: 9005, situacao: 'N' }),
        chk({ horario: 9006, checadoEm: null }),
      ],
      new Set([9003]),
      J,
    );
    expect(r.pendentes.map((p) => [p.referencia, p.volumeMl, p.horaReal])).toEqual([
      [9001, 500, '2026-10-24T21:50'],
    ]);
    expect(r.semVolume.map((s) => s.horario)).toEqual([9004]);
  });
  it('a diurese dos sinais vitais entra como perda do tipo diurese, uma vez só', () => {
    const r = diureseDosSinais(
      [
        { id: 2, valor: 300, horaReal: '2026-10-24T12:00' },
        { id: 1, valor: 200.04, horaReal: '2026-10-24T09:00' },
        { id: 1, valor: 200, horaReal: '2026-10-24T09:00' },
        { id: 3, valor: 100, horaReal: '2026-10-25T08:00' },
        { id: 4, valor: 100, horaReal: '2026-10-24T09:30' },
      ],
      new Set([4]),
      J,
    );
    expect(r.map((x) => [x.referencia, x.volumeMl, x.tipoEliminacao])).toEqual([
      [1, 200, 1],
      [2, 300, 1],
    ]);
  });
});

describe('lançamento (regras 6 e 15)', () => {
  const ctx = { agora: '2026-10-25T10:00', horaCorte: '0700', fechadas: new Set(['2026-10-24T07:00']) };
  const e = (x: Record<string, unknown>) => esquemaLancamentoBalanco.parse({ volumeMl: 100, ...x });
  it('o ganho leva o grupo e, opcional, a via do cadastro', () => {
    const r = conferirLancamento(
      e({ sentido: 'ganho', grupo: 1, via: 'VO', horaReal: '2026-10-25T09:00' }),
      D,
      ctx,
    );
    expect(r).toMatchObject({
      ok: true,
      grupo: 1,
      via: 'VO',
      tipoEliminacao: null,
      horaReal: '2026-10-25T09:00',
    });
    expect(conferirLancamento(e({ sentido: 'ganho' }), D, ctx)).toMatchObject({ codigo: 'grupo-exigido' });
    expect(conferirLancamento(e({ sentido: 'ganho', grupo: 9 }), D, ctx)).toMatchObject({
      codigo: 'valor-nunca-visto',
    });
    expect(conferirLancamento(e({ sentido: 'ganho', grupo: 1, via: 'XX' }), D, ctx)).toMatchObject({
      codigo: 'valor-nunca-visto',
    });
    expect(conferirLancamento(e({ sentido: 'ganho', grupo: 1, tipoEliminacao: 1 }), D, ctx)).toMatchObject({
      codigo: 'sentido-misturado',
    });
  });
  it('a perda leva o tipo ativo, com a intensidade só quando o tipo pede', () => {
    expect(conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 1 }), D, ctx)).toMatchObject({
      ok: true,
      horaReal: '2026-10-25T10:00',
    });
    expect(conferirLancamento(e({ sentido: 'perda' }), D, ctx)).toMatchObject({ codigo: 'tipo-exigido' });
    expect(conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 99 }), D, ctx)).toMatchObject({
      codigo: 'valor-nunca-visto',
    });
    expect(conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 7 }), D, ctx)).toMatchObject({
      codigo: 'tipo-inativo',
    });
    expect(conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 3 }), D, ctx)).toMatchObject({
      codigo: 'intensidade-exigida',
    });
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 3, intensidade: 2 }), D, ctx),
    ).toMatchObject({
      ok: true,
      intensidade: 2,
    });
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 3, intensidade: 9 }), D, ctx),
    ).toMatchObject({
      codigo: 'valor-nunca-visto',
    });
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 1, intensidade: 2 }), D, ctx),
    ).toMatchObject({
      codigo: 'intensidade-nao-cabe',
    });
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 8, estimado: true }), D, ctx),
    ).toMatchObject({
      codigo: 'estimado-nao-cabe',
    });
    expect(conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 1, grupo: 1 }), D, ctx)).toMatchObject({
      codigo: 'sentido-misturado',
    });
  });
  it('hora do futuro, de antes da internação ou de janela já fechada é recusada', () => {
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 1, horaReal: '2026-10-25T10:01' }), D, ctx),
    ).toMatchObject({ codigo: 'hora-futura' });
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 1, horaReal: '2026-10-24T20:00' }), D, ctx),
    ).toMatchObject({ codigo: 'janela-fechada' });
    expect(
      conferirLancamento(e({ sentido: 'perda', tipoEliminacao: 1, horaReal: '2026-10-25T07:10' }), D, {
        ...ctx,
        desde: '2026-10-25T08:00',
      }),
    ).toMatchObject({ codigo: 'hora-antes-da-internacao' });
  });
  it('estorno: uma vez só, nunca de um estorno, nunca em janela fechada', () => {
    const c = { horaCorte: '0700', fechadas: ctx.fechadas };
    expect(conferirEstorno(lido({ horaReal: '2026-10-25T08:00' }), c)).toEqual({ ok: true });
    expect(conferirEstorno(null, c)).toMatchObject({ codigo: 'nao-encontrado' });
    expect(conferirEstorno(lido({ origem: 'estorno', estornado: 3 }), c)).toMatchObject({
      codigo: 'estorno-de-estorno',
    });
    expect(conferirEstorno(lido({ estornadoPor: 2, horaReal: '2026-10-25T08:00' }), c)).toMatchObject({
      codigo: 'ja-estornado',
    });
    expect(conferirEstorno(lido({ horaReal: '2026-10-24T09:00' }), c)).toMatchObject({
      codigo: 'janela-fechada',
    });
    expect(janelaFechada('2026-10-25T06:00', '0700', ctx.fechadas)).toBe(true);
  });
  it('contam só os vigentes (nem o estorno nem o estornado)', () => {
    expect(
      lancamentosVigentes([
        lido({ id: 1, estornadoPor: 2 }),
        lido({ id: 2, origem: 'estorno', estornado: 1 }),
        lido({ id: 3 }),
      ]).map((l) => l.id),
    ).toEqual([3]);
  });
});

describe('perdas insensíveis e débito urinário (regra 6: fórmula versionada; oligúria)', () => {
  it('PI-2026.1: 0,5 mL/kg/h, mais 10% por grau acima de 37 °C, com a conta impressa', () => {
    expect(perdaInsensivel(PI, 70, 24, 36.8)).toEqual({
      ml: 840,
      conta: 'Perdas insensíveis: 70,0 kg × 0,5 mL/kg/h × 24,0 h = 840,0 mL (PI-2026.1).',
    });
    const febre = perdaInsensivel(PI, 70, 24, 39);
    expect(febre.ml).toBe(1008);
    expect(febre.conta).toContain('× 1,20 (febre de 39,0 °C)');
    expect(perdaInsensivel(PI, null, 24, null)).toMatchObject({
      ml: 0,
      conta: expect.stringMatching(/sem o peso/),
    });
    expect(perdaInsensivel(FORMULAS_INSENSIVEL.nenhuma, 70, 24, null).ml).toBe(0);
    expect(() => formulaInsensivel('PI-1999')).toThrow(/desconhecida/);
  });
  it('débito urinário em mL/kg/h e oligúria abaixo de 0,5 com 6 horas ou mais', () => {
    expect(debitoUrinario(PI, 1200, 70, 24)).toMatchObject({ valor: 0.71, oliguria: false });
    const olig = debitoUrinario(PI, 600, 70, 24);
    expect(olig).toMatchObject({ valor: 0.36, oliguria: true });
    expect(olig.conta).toBe(
      'Débito urinário: 600,0 mL ÷ 70,0 kg ÷ 24,0 h = 0,36 mL/kg/h (abaixo de 0,5: oligúria).',
    );
    expect(debitoUrinario(PI, 50, 70, 3)).toMatchObject({ oliguria: false });
    expect(debitoUrinario(PI, 50, null, 3)).toEqual({ valor: null, conta: null, oliguria: false });
  });
});

describe('cálculo e fechamento (regra 6; toda conta com as parcelas impressas)', () => {
  const J = { inicio: '2026-10-24T07:00', fim: '2026-10-25T07:00' };
  const pend = ganhosDaChecagem([chk()], new Set(), J).pendentes;
  const lancs = [
    lido({
      id: 1,
      sentido: 'ganho',
      grupo: 1,
      tipoEliminacao: null,
      volumeMl: 200.3,
      horaReal: '2026-10-24T12:00',
    }),
    lido({ id: 2, tipoEliminacao: 1, volumeMl: 600, horaReal: '2026-10-24T18:00' }),
    lido({ id: 3, tipoEliminacao: 3, intensidade: 2, volumeMl: 50.1, horaReal: '2026-10-24T19:00' }),
    lido({ id: 4, tipoEliminacao: 1, volumeMl: 999, horaReal: '2026-10-25T07:00' }),
  ];
  const calc = calcularBalanco({
    inicio: J.inicio,
    ate: J.fim,
    parcelas: parcelasDoBalanco(lancs, pend),
    pesoKg: 70,
    temperaturaMaxima: 37,
    formula: PI,
    dominios: D,
  });
  it('soma por grupo e por tipo, só dentro do intervalo, em décimos exatos', () => {
    expect(calc.ganhos).toEqual([
      { rotulo: 'VO', ml: 200.3 },
      { rotulo: 'EV', ml: 500 },
    ]);
    expect(calc.perdas).toEqual([
      { rotulo: 'Diurese', ml: 600 },
      { rotulo: 'Êmese', ml: 50.1 },
    ]);
    expect([calc.ganhosMl, calc.perdasMl, calc.insensiveisMl, calc.saldoMl]).toEqual([
      700.3, 650.1, 840, -789.8,
    ]);
    expect(calc.saldoMl).toBe(Math.round((calc.ganhosMl - calc.perdasMl - calc.insensiveisMl) * 10) / 10);
    expect(calc.lancamentos).toBe(4);
    expect(calc.horas).toBe(24);
    expect(calc.diureseMl).toBe(600);
    expect(calc.oliguria).toBe(true);
    expect(calc.saldoConta).toBe(
      'Saldo: ganhos 700,3 (VO 200,3 + EV 500,0) - perdas 650,1 (Diurese 600,0 + Êmese 50,1) - insensíveis 840,0 = -789,8 mL.',
    );
    expect(textoDoFechamento(calc)).toContain('Débito urinário: 600,0 mL');
  });
  it('sem lançamentos: nenhum, e o nome do domínio que faltar aparece pelo código', () => {
    const vazio = calcularBalanco({
      inicio: J.inicio,
      ate: J.inicio,
      parcelas: [],
      pesoKg: null,
      temperaturaMaxima: null,
      formula: PI,
      dominios: D,
    });
    expect(vazio.saldoConta).toContain('(nenhum)');
    expect(textoDoFechamento(vazio)).toContain('sem o peso');
    const outro = calcularBalanco({
      inicio: J.inicio,
      ate: J.fim,
      parcelas: [
        { sentido: 'ganho', grupo: 42, tipoEliminacao: null, volumeMl: 1, horaReal: '2026-10-24T08:00' },
        { sentido: 'perda', grupo: null, tipoEliminacao: 42, volumeMl: 1, horaReal: '2026-10-24T08:00' },
      ],
      pesoKg: null,
      temperaturaMaxima: null,
      formula: PI,
      dominios: D,
    });
    expect(outro.ganhos[0]?.rotulo).toBe('grupo 42');
    expect(outro.perdas[0]?.rotulo).toBe('tipo 42');
  });
  it('o parcial inclui o minuto de agora; o de 24 horas não inclui a hora de corte', () => {
    const p = [
      {
        sentido: 'perda' as const,
        grupo: null,
        tipoEliminacao: 1,
        volumeMl: 10,
        horaReal: '2026-10-24T13:00',
      },
    ];
    const base = {
      inicio: J.inicio,
      ate: '2026-10-24T13:00',
      parcelas: p,
      pesoKg: null,
      temperaturaMaxima: null,
      formula: PI,
      dominios: D,
    };
    expect(calcularBalanco({ ...base, ateInclusivo: true }).perdasMl).toBe(10);
    expect(calcularBalanco(base).perdasMl).toBe(0);
  });
  it('a impressão muda quando o balanço muda (o fechamento recusa o que a tela não viu)', async () => {
    const a = await comImpressao(calc);
    const b = await comImpressao({ ...calc, saldoMl: calc.saldoMl + 1 });
    expect(a.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(a.impressao).not.toBe(b.impressao);
    expect((await comImpressao(calc)).impressao).toBe(a.impressao);
  });
  it('o de 24 horas só depois da hora de corte e uma vez só; o parcial até agora', () => {
    expect(
      conferirFechamento({ tipo: 'total', janela: J, agora: '2026-10-25T07:00', fechamentos: [] }),
    ).toEqual({
      ok: true,
      ate: J.fim,
    });
    expect(
      conferirFechamento({ tipo: 'total', janela: J, agora: '2026-10-25T06:59', fechamentos: [] }),
    ).toMatchObject({
      codigo: 'janela-em-curso',
    });
    expect(
      conferirFechamento({
        tipo: 'total',
        janela: J,
        agora: '2026-10-26T07:00',
        fechamentos: [{ tipo: 'total', inicio: J.inicio, fim: J.fim }],
      }),
    ).toMatchObject({ codigo: 'ja-fechado' });
    expect(
      conferirFechamento({ tipo: 'parcial', janela: J, agora: '2026-10-24T13:00', fechamentos: [] }),
    ).toEqual({
      ok: true,
      ate: '2026-10-24T13:00',
    });
    expect(
      conferirFechamento({ tipo: 'parcial', janela: J, agora: '2026-10-26T13:00', fechamentos: [] }),
    ).toEqual({
      ok: true,
      ate: J.fim,
    });
    expect(
      conferirFechamento({
        tipo: 'parcial',
        janela: J,
        agora: '2026-10-24T13:00',
        fechamentos: [{ tipo: 'parcial', inicio: J.inicio, fim: '2026-10-24T13:00' }],
      }),
    ).toMatchObject({ codigo: 'ja-fechado' });
    expect(
      conferirFechamento({ tipo: 'parcial', janela: J, agora: '2026-10-24T07:00', fechamentos: [] }),
    ).toMatchObject({
      codigo: 'janela-futura',
    });
  });
});
