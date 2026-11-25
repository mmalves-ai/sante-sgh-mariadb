import { describe, expect, it } from 'vitest';
import {
  conferirCategoriaDoDetalhe,
  conferirItemGravavel,
  conferirRefeicoesDieta,
  conferirVentilacaoNoCadastro,
  MENSAGENS_ITEM_GRAVAVEL,
  mlPorHoraDaSigla,
  type RefeicaoDietaGravavel,
} from './itens-gravaveis.js';

const sol = (over: Record<string, unknown> = {}) => ({
  tipo: 'solucao' as const,
  componentes: [
    { dose: 500, principal: true, etapa: 1 },
    { dose: 10, principal: false, etapa: 1 },
    { dose: 500, principal: true, etapa: 2 },
  ],
  etapas: [
    {
      etapa: 1,
      inicio: '2026-11-24T08:00',
      fim: '2026-11-24T12:00',
      velocidade: 125,
      unidadeInfusao: 1,
      volume: 500,
    },
    {
      etapa: 2,
      inicio: '2026-11-24T12:00',
      fim: '2026-11-24T22:00',
      velocidade: 50,
      unidadeInfusao: 1,
      volume: 500,
    },
  ],
  ...over,
});
const mlh = () => 1;

describe('conferência do item antes de gravar (03-PEP L105)', () => {
  it('medicamento: dose positiva e condições de "se necessário" sem repetição', () => {
    const sn = { tipo: 'medicamento' as const, dose: 1, seNecessario: [1, 2], intervaloMinimoMinutos: 360 };
    expect(conferirItemGravavel(sn)).toBeNull();
    expect(conferirItemGravavel({ tipo: 'medicamento', dose: 0, seNecessario: [] })).toBe('dose-invalida');
    expect(conferirItemGravavel({ ...sn, seNecessario: [3, 3] })).toBe('se-necessario-repetido');
  });

  it('"se necessário": intervalo mínimo obrigatório, sem horário fixo e dose máxima coerente', () => {
    const sn = { tipo: 'medicamento' as const, dose: 500, seNecessario: [1], intervaloMinimoMinutos: 360 };
    expect(conferirItemGravavel({ ...sn, intervaloMinimoMinutos: null })).toBe('se-necessario-sem-intervalo');
    expect(conferirItemGravavel({ ...sn, intervaloMinimoMinutos: 0 })).toBe('se-necessario-sem-intervalo');
    expect(conferirItemGravavel(sn, { horarios: 1 })).toBe('se-necessario-com-horario');
    expect(conferirItemGravavel(sn, { horarios: 0 })).toBeNull();
    expect(conferirItemGravavel({ ...sn, doseMaxima: { dose: 2000, periodoHoras: 24 } })).toBeNull();
    expect(conferirItemGravavel({ ...sn, doseMaxima: { dose: 100, periodoHoras: 24 } })).toBe(
      'se-necessario-dose-maxima-invalida',
    );
    expect(conferirItemGravavel({ ...sn, doseMaxima: { dose: 2000, periodoHoras: 0 } })).toBe(
      'se-necessario-dose-maxima-invalida',
    );
    expect(conferirItemGravavel({ ...sn, seNecessario: [] })).toBe('se-necessario-sem-condicao');
    // Medicamento de horário fixo segue com horários.
    expect(
      conferirItemGravavel({ tipo: 'medicamento', dose: 1, seNecessario: [] }, { horarios: 4 }),
    ).toBeNull();
  });

  it('dieta por classe: jejum e dieta livre sem quantidade; oral medida e enteral com quantidade', () => {
    const base = {
      tipo: 'dieta' as const,
      classe: 'enteral' as const,
      quantidade: 1500,
      velocidade: null,
      unidadeInfusao: null,
      caracteristicas: [],
    };
    expect(conferirItemGravavel(base)).toBeNull();
    expect(conferirItemGravavel({ ...base, classe: 'jejum', quantidade: null })).toBeNull();
    expect(conferirItemGravavel({ ...base, classe: 'livre', quantidade: null })).toBeNull();
    expect(conferirItemGravavel({ ...base, classe: 'jejum', quantidade: 0 })).toBe(
      'dieta-quantidade-indevida',
    );
    expect(conferirItemGravavel({ ...base, classe: 'oral', quantidade: null })).toBe(
      'dieta-quantidade-invalida',
    );
    expect(conferirItemGravavel({ ...base, quantidade: 0 })).toBe('dieta-quantidade-invalida');
    expect(conferirItemGravavel({ ...base, velocidade: 60 })).toBe('dieta-velocidade-sem-unidade');
    expect(conferirItemGravavel({ ...base, velocidade: 60, unidadeInfusao: 2 })).toBeNull();
    expect(conferirItemGravavel({ ...base, classe: 'oral', velocidade: 60, unidadeInfusao: 2 })).toBe(
      'dieta-velocidade-indevida',
    );
    expect(
      conferirItemGravavel({
        ...base,
        caracteristicas: [
          { caracteristica: 4, resposta: '2 g' },
          { caracteristica: 4, resposta: '3 g' },
        ],
      }),
    ).toBe('dieta-caracteristica-repetida');
  });

  it('dieta por refeição: só oral e livre, sem alimento repetido, substituto anterior e calorias até 100% (L112)', () => {
    const base = {
      tipo: 'dieta' as const,
      classe: 'oral' as const,
      quantidade: 1,
      velocidade: null,
      unidadeInfusao: null,
      caracteristicas: [],
    };
    const r = (refeicao: number, alimento: number, extra: Partial<RefeicaoDietaGravavel> = {}) => ({
      refeicao,
      alimento,
      quantidade: 100,
      medidaCaseira: null,
      quantidadeMedidaCaseira: null,
      substitui: null,
      percentualDiario: null,
      ...extra,
    });
    const cafe = [
      r(1, 10, { percentualDiario: 25 }),
      r(1, 11, { substitui: 1 }),
      r(2, 10, { percentualDiario: 40 }),
    ];
    expect(conferirItemGravavel({ ...base, refeicoes: cafe })).toBeNull();
    expect(conferirItemGravavel({ ...base, classe: 'livre', quantidade: null, refeicoes: cafe })).toBeNull();
    expect(conferirItemGravavel({ ...base, refeicoes: [] })).toBeNull();
    expect(conferirItemGravavel({ ...base, classe: 'jejum', quantidade: null, refeicoes: cafe })).toBe(
      'dieta-refeicao-indevida',
    );
    expect(conferirItemGravavel({ ...base, classe: 'enteral', refeicoes: cafe })).toBe(
      'dieta-refeicao-indevida',
    );
    expect(conferirRefeicoesDieta('oral', [r(1, 10), r(1, 10)])).toBe('dieta-refeicao-repetida');
    expect(conferirRefeicoesDieta('oral', [r(1, 10, { quantidade: 0 })])).toBe('dieta-quantidade-invalida');
    expect(conferirRefeicoesDieta('oral', [r(1, 10, { medidaCaseira: 3 })])).toBe(
      'dieta-refeicao-medida-caseira',
    );
    expect(conferirRefeicoesDieta('oral', [r(1, 10, { medidaCaseira: 3, quantidadeMedidaCaseira: 0 })])).toBe(
      'dieta-refeicao-medida-caseira',
    );
    expect(
      conferirRefeicoesDieta('oral', [r(1, 10, { medidaCaseira: 3, quantidadeMedidaCaseira: 2 })]),
    ).toBeNull();
    // Substituto: aponta um titular anterior da mesma refeição, com outro alimento.
    expect(conferirRefeicoesDieta('oral', [r(1, 11, { substitui: 1 })])).toBe(
      'dieta-refeicao-substituto-invalido',
    );
    expect(conferirRefeicoesDieta('oral', [r(1, 10), r(2, 11, { substitui: 1 })])).toBe(
      'dieta-refeicao-substituto-invalido',
    );
    expect(conferirRefeicoesDieta('oral', [r(1, 10), r(1, 10, { substitui: 1 })])).toBe(
      'dieta-refeicao-substituto-invalido',
    );
    expect(
      conferirRefeicoesDieta('oral', [r(1, 10), r(1, 11, { substitui: 1 }), r(1, 12, { substitui: 2 })]),
    ).toBe('dieta-refeicao-substituto-invalido');
    // A parte das calorias do dia soma só os titulares, até 100%.
    expect(
      conferirRefeicoesDieta('oral', [
        r(1, 10, { percentualDiario: 60 }),
        r(1, 11, { substitui: 1, percentualDiario: 60 }),
        r(2, 10, { percentualDiario: 40 }),
      ]),
    ).toBeNull();
    expect(
      conferirRefeicoesDieta('oral', [
        r(1, 10, { percentualDiario: 60 }),
        r(2, 10, { percentualDiario: 41 }),
      ]),
    ).toBe('dieta-refeicao-percentual-acima');
  });

  it('solução em etapas: principal, etapas únicas, cada componente na sua etapa e fim depois do início', () => {
    expect(conferirItemGravavel(sol())).toBeNull();
    expect(conferirItemGravavel(sol({ componentes: [{ dose: 10, principal: false, etapa: 1 }] }))).toBe(
      'solucao-sem-principal',
    );
    const [e1, e2] = sol().etapas;
    expect(conferirItemGravavel(sol({ etapas: [e1, e1] }))).toBe('solucao-etapa-repetida');
    expect(conferirItemGravavel(sol({ etapas: [e1] }))).toBe('solucao-componente-sem-etapa');
    expect(conferirItemGravavel(sol({ etapas: [e1, e2, { ...e2!, etapa: 3 }] }))).toBe(
      'solucao-etapa-sem-componente',
    );
    expect(conferirItemGravavel(sol({ etapas: [{ ...e1!, fim: '2026-11-24T07:00' }, e2] }))).toBe(
      'solucao-etapa-fim-antes-inicio',
    );
    expect(conferirItemGravavel(sol({ etapas: [{ ...e1!, volume: 0 }, e2] }))).toBe('solucao-etapa-invalida');
  });

  it('solução: sem sobreposição, dentro da vigência e volume = velocidade × duração', () => {
    const [e1, e2] = sol().etapas;
    const vig = { inicio: '2026-11-24T08:00', fim: '2026-11-25T08:00' };
    expect(conferirItemGravavel(sol(), { vigencia: vig, mlPorHora: mlh })).toBeNull();
    expect(conferirItemGravavel(sol({ etapas: [e1, { ...e2!, inicio: '2026-11-24T11:00' }] }))).toBe(
      'solucao-etapa-sobreposta',
    );
    expect(conferirItemGravavel(sol(), { vigencia: { ...vig, fim: '2026-11-24T20:00' } })).toBe(
      'solucao-etapa-fora-da-vigencia',
    );
    // 500 mL a 125 mL/h em 24 h não confere (seriam 3.000 mL).
    const longa = { ...e1!, fim: '2026-11-25T08:00' };
    expect(
      conferirItemGravavel(
        sol({ etapas: [longa], componentes: [{ dose: 500, principal: true, etapa: 1 }] }),
        {
          mlPorHora: mlh,
        },
      ),
    ).toBe('solucao-volume-incoerente');
    // 83,3 mL/h em 6 h = 499,8 mL: dentro da tolerância.
    const arred = { ...e1!, fim: '2026-11-24T14:00', velocidade: 83.3 };
    expect(
      conferirItemGravavel(
        sol({ etapas: [arred], componentes: [{ dose: 500, principal: true, etapa: 1 }] }),
        {
          mlPorHora: mlh,
        },
      ),
    ).toBeNull();
    // Gotas por minuto: 41,7 gt/min ≈ 125 mL/h.
    const gotas = { ...e1!, velocidade: 41.7 };
    expect(
      conferirItemGravavel(
        sol({ etapas: [gotas], componentes: [{ dose: 500, principal: true, etapa: 1 }] }),
        {
          mlPorHora: () => 3,
        },
      ),
    ).toBeNull();
    // Unidade sem conversão: não confere volume.
    expect(
      conferirItemGravavel(
        sol({ etapas: [longa], componentes: [{ dose: 500, principal: true, etapa: 1 }] }),
        {
          mlPorHora: () => null,
        },
      ),
    ).toBeNull();
    expect([mlPorHoraDaSigla('mL/h'), mlPorHoraDaSigla('gts/min'), mlPorHoraDaSigla('mgts/min')]).toEqual([
      1, 3, 1,
    ]);
    expect(mlPorHoraDaSigla('mg/kg/min')).toBeNull();
  });

  it('VMI: sem sentinela, faixas clínicas e alvo por volume ou por pressão', () => {
    const vmi = {
      tipo: 'vmi' as const,
      frequenciaRespiratoria: 16,
      peep: 5,
      volumeCorrente: 450,
      pressao: null,
      tempoInspiratorio: null,
      tempoExpiratorio: null,
      fio2: 40,
    };
    expect(conferirItemGravavel(vmi)).toBeNull();
    // Pressão controlada sem volume corrente.
    expect(conferirItemGravavel({ ...vmi, volumeCorrente: null, pressao: 18 })).toBeNull();
    expect(conferirItemGravavel({ ...vmi, volumeCorrente: null })).toBe('ventilacao-sem-alvo');
    expect(conferirItemGravavel({ ...vmi, fio2: 15 })).toBe('ventilacao-fio2-fora-da-faixa');
    for (const ruim of [
      { volumeCorrente: 0 },
      { volumeCorrente: 1_000_000 },
      { frequenciaRespiratoria: 0 },
      { frequenciaRespiratoria: 61 },
      { peep: 0 },
      { peep: 31 },
      { tempoInspiratorio: 0 },
      { tempoExpiratorio: 0 },
      { pressao: 2 },
    ])
      expect(conferirItemGravavel({ ...vmi, ...ruim })).toBe('ventilacao-parametro-invalido');
    // Parâmetros não informados passam nulos.
    expect(conferirItemGravavel({ ...vmi, frequenciaRespiratoria: null, peep: null })).toBeNull();
  });

  it('VNI: EPAP ou IPAP, IPAP maior que EPAP, pressão de suporte e duração da sessão', () => {
    const vni = {
      tipo: 'vni' as const,
      pressaoInspiratoria: 12,
      pressaoExpiratoria: 6,
      pressaoSuporte: null,
      duracaoMinutos: 120,
      fio2: null,
    };
    expect(conferirItemGravavel(vni)).toBeNull();
    expect(conferirItemGravavel({ ...vni, pressaoInspiratoria: null })).toBeNull(); // CPAP
    expect(conferirItemGravavel({ ...vni, pressaoInspiratoria: null, pressaoExpiratoria: null })).toBe(
      'ventilacao-sem-pressao',
    );
    expect(conferirItemGravavel({ ...vni, pressaoInspiratoria: 6 })).toBe('ventilacao-ipap-menor-epap');
    expect(conferirItemGravavel({ ...vni, fio2: 101 })).toBe('ventilacao-fio2-fora-da-faixa');
    expect(conferirItemGravavel({ ...vni, duracaoMinutos: 2_000 })).toBe('ventilacao-parametro-invalido');
    expect(conferirItemGravavel({ ...vni, pressaoExpiratoria: 2 })).toBe('ventilacao-parametro-invalido');
  });

  it('ventilação contra o cadastro: via aérea da modalidade e FR em modo controlado', () => {
    const inv = { viaInvasiva: true, modoControlado: true };
    expect(conferirVentilacaoNoCadastro({ tipo: 'vmi', frequenciaRespiratoria: 16 }, inv)).toBeNull();
    expect(conferirVentilacaoNoCadastro({ tipo: 'vmi', frequenciaRespiratoria: null }, inv)).toBe(
      'ventilacao-fr-obrigatoria',
    );
    expect(
      conferirVentilacaoNoCadastro(
        { tipo: 'vmi', frequenciaRespiratoria: null },
        { ...inv, modoControlado: false },
      ),
    ).toBeNull();
    expect(
      conferirVentilacaoNoCadastro(
        { tipo: 'vmi', frequenciaRespiratoria: 16 },
        { ...inv, viaInvasiva: false },
      ),
    ).toBe('ventilacao-via-incoerente');
    expect(conferirVentilacaoNoCadastro({ tipo: 'vni' }, inv)).toBe('ventilacao-via-incoerente');
    expect(
      conferirVentilacaoNoCadastro({ tipo: 'vni' }, { viaInvasiva: false, modoControlado: false }),
    ).toBeNull();
  });

  it('o tipo de lançamento casa com o detalhe', () => {
    expect(conferirCategoriaDoDetalhe('dieta', 'dieta')).toBeNull();
    expect(conferirCategoriaDoDetalhe('ventilacao', 'vmi')).toBeNull();
    expect(conferirCategoriaDoDetalhe('medicamento', 'dieta')).toBe('tipo-item-incoerente');
    expect(conferirCategoriaDoDetalhe('medicamento', 'vni')).toBe('tipo-item-incoerente');
    expect(conferirCategoriaDoDetalhe('dieta', 'desconhecido')).toBe('tipo-item-incoerente');
  });

  it('kit do medicamento: quantidade maior que zero e produto sem repetir', () => {
    const med = { tipo: 'medicamento', dose: 1, seNecessario: [] } as const;
    expect(conferirItemGravavel({ ...med, kit: [{ produto: 1, quantidade: 2 }] })).toBeNull();
    expect(conferirItemGravavel({ ...med, kit: [{ produto: 1, quantidade: 0 }] })).toBe(
      'kit-quantidade-invalida',
    );
    expect(
      conferirItemGravavel({
        ...med,
        kit: [
          { produto: 1, quantidade: 1 },
          { produto: 1, quantidade: 3 },
        ],
      }),
    ).toBe('kit-item-repetido');
  });

  it('procedimento: "se necessário" sem horário fixo e faixas de glicemia sem sobreposição', () => {
    const proc = { tipo: 'procedimento', seNecessario: [], faixas: [] } as const;
    expect(conferirItemGravavel(proc, { horarios: 3 })).toBeNull();
    expect(conferirItemGravavel({ ...proc, seNecessario: [4] }, { horarios: 0 })).toBeNull();
    expect(conferirItemGravavel({ ...proc, seNecessario: [4] }, { horarios: 2 })).toBe(
      'se-necessario-com-horario',
    );
    expect(conferirItemGravavel({ ...proc, seNecessario: [4, 4] })).toBe('se-necessario-repetido');
    const faixas = [
      { de: 0, ate: 150, dose: 0 },
      { de: 151, ate: 200, dose: 2 },
      { de: 201, ate: 999, dose: 4 },
    ];
    expect(conferirItemGravavel({ ...proc, faixas })).toBeNull();
    expect(conferirItemGravavel({ ...proc, faixas: [{ de: 200, ate: 150, dose: 2 }] })).toBe(
      'glicemia-faixa-invalida',
    );
    expect(
      conferirItemGravavel({
        ...proc,
        faixas: [
          { de: 151, ate: 200, dose: 2 },
          { de: 0, ate: 151, dose: 0 },
        ],
      }),
    ).toBe('glicemia-faixa-sobreposta');
  });

  it('hemoterapia: indicação clínica e quantidade obrigatórias', () => {
    const hem = { tipo: 'hemoterapia', dose: 1, indicacao: 'Hb 6,5 g/dL com sintomas' } as const;
    expect(conferirItemGravavel(hem)).toBeNull();
    expect(conferirItemGravavel({ ...hem, indicacao: null })).toBe('hemoterapia-sem-indicacao');
    expect(conferirItemGravavel({ ...hem, indicacao: 'anemia   ' })).toBe('hemoterapia-sem-indicacao');
    expect(conferirItemGravavel({ ...hem, dose: 0 })).toBe('hemoterapia-sem-indicacao');
  });

  it('procedimento e cuidado aceitam o tipo de procedimento e o de cuidado; hemoterapia o de hemocomponente', () => {
    expect(conferirCategoriaDoDetalhe('cuidado', 'procedimento')).toBeNull();
    expect(conferirCategoriaDoDetalhe('hemocomponente', 'hemoterapia')).toBeNull();
    expect(conferirCategoriaDoDetalhe('medicamento', 'hemoterapia')).toBe('tipo-item-incoerente');
  });

  it('toda recusa tem mensagem', () => {
    for (const m of Object.values(MENSAGENS_ITEM_GRAVAVEL)) expect(m.length).toBeGreaterThan(10);
  });
});
