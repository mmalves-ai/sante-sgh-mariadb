// SLA do contrato com fornecedor (09-AREA linha 88): modelo e unidade, faixas contíguas com glosa e multa, vigência
// dentro do contrato, o novo do mesmo modelo fechando o anterior na véspera, a cobertura por horário (inclusive cruzando
// a meia-noite) e por dias úteis com feriado, a medição conferida e a apuração dos três modelos com as parcelas.
import { describe, expect, it } from 'vitest';
import {
  apurarSla,
  conferirFaturaApuracaoSla,
  conferirFechamentoSla,
  conferirMedicaoForaDeApuracao,
  conferirFaixasSla,
  conferirMedicaoSla,
  conferirPeriodoApuracaoSla,
  conferirSlaContrato,
  type FaixaSlaEntrada,
  faixaDoDesempenhoSla,
  minutosCobertosSla,
  planejarSlaContrato,
  type SlaApuravel,
  type SlaContratoEntrada,
} from '../index.js';

const FAIXAS: FaixaSlaEntrada[] = [
  {
    codigo: 'C',
    descricao: 'Crítico',
    desempenhoInicio: 0,
    desempenhoFim: 80,
    penalidade: 'glosa_e_multa',
    percentualGlosa: 10,
    valorMulta: 500,
  },
  {
    codigo: 'B',
    descricao: 'Abaixo',
    desempenhoInicio: 80,
    desempenhoFim: 95,
    penalidade: 'glosa',
    percentualGlosa: 5,
    valorMulta: null,
  },
  {
    codigo: 'A',
    descricao: 'Atende',
    desempenhoInicio: 95,
    desempenhoFim: null,
    penalidade: 'nenhuma',
    percentualGlosa: null,
    valorMulta: null,
  },
];
const SLA: SlaContratoEntrada = {
  servico: null,
  descricao: 'Atendimento da manutenção corretiva',
  tipoRegra: 'tempo_atendimento',
  unidade: 'hora',
  meta: 4,
  horarioInicio: '08:00',
  horarioFim: '18:00',
  somenteDiasUteis: true,
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  faixas: FAIXAS,
};
const CONTRATO = { situacao: 'vigente', inicio: '2026-01-01', fim: '2027-12-31' };
const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);
const apuravel = (x: Partial<SlaApuravel> = {}): SlaApuravel => ({ ...SLA, feriados: new Set(), ...x });

describe('cadastro do SLA', () => {
  it('aceita o SLA completo e recusa modelo com unidade errada, meta, horário pela metade e contrato não vigente', () => {
    expect(conferirSlaContrato(SLA, CONTRATO)).toEqual([]);
    expect(codigos(conferirSlaContrato({ ...SLA, unidade: 'percentual' }, CONTRATO))).toEqual([
      'sla-unidade',
    ]);
    expect(
      codigos(
        conferirSlaContrato(
          { ...SLA, tipoRegra: 'disponibilidade', unidade: 'percentual', meta: 101 },
          CONTRATO,
        ),
      ),
    ).toEqual(['sla-meta']);
    expect(codigos(conferirSlaContrato({ ...SLA, horarioFim: null }, CONTRATO))).toEqual(['sla-horario']);
    expect(codigos(conferirSlaContrato({ ...SLA, horarioFim: '08:00' }, CONTRATO))).toEqual(['sla-horario']);
    expect(codigos(conferirSlaContrato(SLA, { ...CONTRATO, situacao: 'encerrado' }))).toEqual([
      'contrato-nao-vigente',
    ]);
    expect(codigos(conferirSlaContrato({ ...SLA, vigenciaInicio: '2025-12-31' }, CONTRATO))).toEqual([
      'sla-fora-contrato',
    ]);
    expect(codigos(conferirSlaContrato({ ...SLA, vigenciaFim: '2026-10-01' }, CONTRATO))).toEqual([
      'sla-vigencia',
    ]);
  });

  it('faixas: começam em zero, contíguas, só a última sem fim, código único, penalidade com o seu valor', () => {
    expect(conferirFaixasSla(FAIXAS)).toEqual([]);
    expect(codigos(conferirFaixasSla([]))).toEqual(['faixas-sla']);
    expect(codigos(conferirFaixasSla([{ ...FAIXAS[0]!, desempenhoInicio: 10 }, ...FAIXAS.slice(1)]))).toEqual(
      ['faixas-sla-contiguas'],
    );
    expect(codigos(conferirFaixasSla([FAIXAS[0]!, FAIXAS[2]!]))).toEqual(['faixas-sla-contiguas']);
    expect(
      codigos(conferirFaixasSla([{ ...FAIXAS[0]!, desempenhoFim: null }, ...FAIXAS.slice(1)])),
    ).toContain('faixas-sla-contiguas');
    expect(codigos(conferirFaixasSla([FAIXAS[0]!, FAIXAS[1]!, { ...FAIXAS[2]!, codigo: 'b' }]))).toEqual([
      'faixa-sla-codigo',
    ]);
    expect(codigos(conferirFaixasSla([{ ...FAIXAS[0]!, valorMulta: null }, ...FAIXAS.slice(1)]))).toEqual([
      'faixa-sla-multa',
    ]);
    expect(
      codigos(conferirFaixasSla([FAIXAS[0]!, { ...FAIXAS[1]!, percentualGlosa: 0 }, FAIXAS[2]!])),
    ).toEqual(['faixa-sla-glosa']);
    expect(codigos(conferirFaixasSla([FAIXAS[0]!, FAIXAS[1]!, { ...FAIXAS[2]!, valorMulta: 1 }]))).toEqual([
      'faixa-sla-multa',
    ]);
  });

  it('o novo do mesmo modelo e serviço fecha o anterior na véspera; o que começa depois é recusado; outro serviço não conta', () => {
    const existentes = [
      { id: 1, servico: null, tipoRegra: 'tempo_atendimento' as const, inicio: '2026-01-01', fim: null },
      { id: 2, servico: 7, tipoRegra: 'tempo_atendimento' as const, inicio: '2026-01-01', fim: null },
      { id: 3, servico: null, tipoRegra: 'tempo_solucao' as const, inicio: '2026-01-01', fim: null },
      {
        id: 4,
        servico: null,
        tipoRegra: 'tempo_atendimento' as const,
        inicio: '2025-01-01',
        fim: '2025-12-31',
      },
    ];
    expect(planejarSlaContrato(SLA, existentes)).toEqual({ recusas: [], fechar: [1], fim: '2026-10-31' });
    const futuro = [
      { id: 9, servico: null, tipoRegra: 'tempo_atendimento' as const, inicio: '2026-11-01', fim: null },
    ];
    expect(codigos(planejarSlaContrato(SLA, futuro).recusas)).toEqual(['sla-sobreposto']);
  });

  it('fechar a vigência (encerrar ou SLA novo) não deixa apuração nem medição depois do fim; medição não entra em período apurado', () => {
    const h = { apuracoes: [{ inicio: '2026-11-01', fim: '2026-11-30' }], medicoes: ['2026-11-20'] };
    expect(codigos(conferirFechamentoSla('2026-11-14', h))).toEqual(['sla-apurado', 'sla-com-medicao']);
    expect(conferirFechamentoSla('2026-11-14', h, 'vigenciaInicio')[0]?.campos).toEqual(['vigenciaInicio']);
    expect(codigos(conferirFechamentoSla('2026-11-14', { apuracoes: [], medicoes: ['2026-11-15'] }))).toEqual(
      ['sla-com-medicao'],
    );
    expect(conferirFechamentoSla('2026-11-30', h)).toEqual([]);
    expect(conferirFechamentoSla('2026-11-14', { apuracoes: [], medicoes: ['2026-11-14'] })).toEqual([]);
    const ap = [{ inicio: '2026-11-01', fim: '2026-11-30' }];
    expect(codigos(conferirMedicaoForaDeApuracao({ inicio: '2026-11-01T00:00' }, ap))).toEqual([
      'medicao-em-periodo-apurado',
    ]);
    expect(codigos(conferirMedicaoForaDeApuracao({ inicio: '2026-11-30T23:59' }, ap))).toEqual([
      'medicao-em-periodo-apurado',
    ]);
    expect(conferirMedicaoForaDeApuracao({ inicio: '2026-12-01T00:00' }, ap)).toEqual([]);
    expect(conferirMedicaoForaDeApuracao({ inicio: '2026-10-31T23:59' }, ap)).toEqual([]);
  });
});

describe('cobertura por horário e dias', () => {
  const comercial = {
    horarioInicio: '08:00',
    horarioFim: '18:00',
    somenteDiasUteis: true,
    feriados: new Set<string>(),
  };
  it('conta só o horário coberto dos dias úteis e pula o fim de semana e o feriado', () => {
    // Sexta 2026-11-20 17:00 até segunda 2026-11-23 09:30: 60 min na sexta + 90 min na segunda.
    expect(minutosCobertosSla('2026-11-20T17:00', '2026-11-23T09:30', comercial)).toBe(150);
    // A segunda é feriado: só a sexta conta.
    expect(
      minutosCobertosSla('2026-11-20T17:00', '2026-11-23T09:30', {
        ...comercial,
        feriados: new Set(['2026-11-23']),
      }),
    ).toBe(60);
    // Fora do horário: nada.
    expect(minutosCobertosSla('2026-11-20T19:00', '2026-11-20T23:00', comercial)).toBe(0);
  });
  it('24 horas e o horário que cruza a meia-noite', () => {
    const vinteQuatro = {
      horarioInicio: null,
      horarioFim: null,
      somenteDiasUteis: false,
      feriados: new Set<string>(),
    };
    expect(minutosCobertosSla('2026-11-21T22:00', '2026-11-22T02:00', vinteQuatro)).toBe(240);
    const noturno = {
      horarioInicio: '22:00',
      horarioFim: '06:00',
      somenteDiasUteis: false,
      feriados: new Set<string>(),
    };
    // 21h às 07h: 22h-24h (120) + 0h-6h (360).
    expect(minutosCobertosSla('2026-11-21T21:00', '2026-11-22T07:00', noturno)).toBe(480);
  });
});

describe('medição e apuração', () => {
  it('confere a medição: fim depois do início, nada no futuro, produção com quantidade', () => {
    const v = { inicio: '2026-11-01', fim: null };
    const agora = '2026-11-25T10:00';
    expect(
      conferirMedicaoSla(
        'tempo_atendimento',
        { inicio: '2026-11-20T09:00', fim: '2026-11-20T10:00', quantidade: null, descricao: 'Bomba' },
        agora,
        v,
      ),
    ).toEqual([]);
    expect(
      codigos(
        conferirMedicaoSla(
          'tempo_atendimento',
          { inicio: '2026-11-20T09:00', fim: null, quantidade: null, descricao: 'x' },
          agora,
          v,
        ),
      ),
    ).toEqual(['medicao-fim']);
    expect(
      codigos(
        conferirMedicaoSla(
          'tempo_atendimento',
          { inicio: '2026-11-20T09:00', fim: '2026-11-20T08:00', quantidade: null, descricao: 'x' },
          agora,
          v,
        ),
      ),
    ).toEqual(['medicao-fim']);
    expect(
      codigos(
        conferirMedicaoSla(
          'disponibilidade',
          { inicio: '2026-11-26T09:00', fim: '2026-11-26T10:00', quantidade: null, descricao: 'x' },
          agora,
          v,
        ),
      ),
    ).toContain('medicao-futura');
    expect(
      codigos(
        conferirMedicaoSla(
          'producao',
          { inicio: '2026-11-20T00:00', fim: null, quantidade: 0, descricao: 'x' },
          agora,
          v,
        ),
      ),
    ).toEqual(['medicao-quantidade']);
    expect(
      codigos(
        conferirMedicaoSla(
          'producao',
          { inicio: '2026-10-20T00:00', fim: null, quantidade: 3, descricao: 'x' },
          agora,
          v,
        ),
      ),
    ).toEqual(['medicao-fora-vigencia']);
  });

  it('tempo: percentual no prazo pelo tempo coberto, faixa com glosa e multa e as parcelas impressas', () => {
    const medicoes = [
      // Sexta 17h a segunda 9h30: 2,5 h cobertas (no prazo, apesar de 64 horas corridas).
      { id: 1, inicio: '2026-11-20T17:00', fim: '2026-11-23T09:30', quantidade: null, descricao: 'a' },
      // Terça 8h a 14h: 6 h (fora).
      { id: 2, inicio: '2026-11-24T08:00', fim: '2026-11-24T14:00', quantidade: null, descricao: 'b' },
      // Fora do período: não conta.
      { id: 3, inicio: '2026-10-30T08:00', fim: '2026-10-30T20:00', quantidade: null, descricao: 'c' },
    ];
    const a = apurarSla(apuravel(), medicoes, { inicio: '2026-11-01', fim: '2026-11-24' }, 10000);
    expect(a).toMatchObject({
      considerados: 2,
      noPrazo: 1,
      desempenho: 50,
      metaAtingida: false,
      glosa: 1000,
      multa: 500,
      total: 1500,
    });
    expect(a.faixa?.codigo).toBe('C');
    expect(a.medicoes.map((m) => [m.id, m.medido, m.dentro])).toEqual([
      [1, 2.5, true],
      [2, 6, false],
    ]);
    // O real formatado traz o espaço inseparável depois do R$.
    expect(a.parcelas.map((x) => x.replace(/\u00a0/g, ' '))).toEqual([
      'Prazo: 1 de 2 chamado(s) em até 4 hora(s) cobertos = 50%',
      'Faixa C (Crítico): de 0% até antes de 80%',
      'Glosa: 10% de R$ 10.000,00 = R$ 1.000,00',
      'Multa da faixa: R$ 500,00',
      'Total: R$ 1.000,00 + R$ 500,00 = R$ 1.500,00',
    ]);
    // Sem chamado no período: 100%, faixa sem penalidade.
    expect(apurarSla(apuravel(), [], { inicio: '2026-11-01', fim: '2026-11-02' }, null)).toMatchObject({
      desempenho: 100,
      total: 0,
      metaAtingida: true,
    });
  });

  it('disponibilidade e produção', () => {
    const disp = apuravel({
      tipoRegra: 'disponibilidade',
      unidade: 'percentual',
      meta: 95,
      horarioInicio: null,
      horarioFim: null,
      somenteDiasUteis: false,
    });
    // 1 dia coberto (1440 min) com 144 min parados: 90% (faixa B, glosa de 5%).
    const a = apurarSla(
      disp,
      [{ id: 5, inicio: '2026-11-10T10:00', fim: '2026-11-10T12:24', quantidade: null, descricao: 'parada' }],
      { inicio: '2026-11-10', fim: '2026-11-10' },
      2000,
    );
    expect(a).toMatchObject({
      minutosCobertos: 1440,
      minutosParados: 144,
      desempenho: 90,
      metaAtingida: false,
      glosa: 100,
      multa: 0,
      total: 100,
    });
    expect(a.faixa?.codigo).toBe('B');
    expect(conferirFaturaApuracaoSla({ ...a, valorFatura: null })).toHaveLength(1);
    const prod = apuravel({ tipoRegra: 'producao', unidade: 'quantidade', meta: 200 });
    const p = apurarSla(
      prod,
      [
        { id: 6, inicio: '2026-11-03T00:00', fim: null, quantidade: 120, descricao: 'lote 1' },
        { id: 7, inicio: '2026-11-04T00:00', fim: null, quantidade: 80, descricao: 'lote 2' },
      ],
      { inicio: '2026-11-01', fim: '2026-11-30' },
      null,
    );
    expect(p).toMatchObject({ realizado: 200, desempenho: 100, metaAtingida: true, total: 0 });
    expect(faixaDoDesempenhoSla(FAIXAS, 95)?.codigo).toBe('A');
    expect(faixaDoDesempenhoSla(FAIXAS, 94.99)?.codigo).toBe('B');
  });

  it('o período: fechado, até 92 dias, dentro da vigência', () => {
    const v = { vigenciaInicio: '2026-11-01', vigenciaFim: null };
    expect(conferirPeriodoApuracaoSla({ inicio: '2026-11-01', fim: '2026-11-24' }, v, '2026-11-25')).toEqual(
      [],
    );
    expect(
      codigos(conferirPeriodoApuracaoSla({ inicio: '2026-11-01', fim: '2026-11-25' }, v, '2026-11-25')),
    ).toEqual(['periodo-aberto']);
    expect(
      codigos(conferirPeriodoApuracaoSla({ inicio: '2026-10-01', fim: '2026-10-31' }, v, '2026-11-25')),
    ).toEqual(['periodo-fora-vigencia']);
    expect(
      codigos(conferirPeriodoApuracaoSla({ inicio: '2026-11-10', fim: '2026-11-01' }, v, '2026-11-25')),
    ).toEqual(['periodo-apuracao']);
  });
});
