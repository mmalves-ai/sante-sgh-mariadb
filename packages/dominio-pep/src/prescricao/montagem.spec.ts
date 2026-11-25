// Montagem do item para a gravação (M24) e o documento da trilha: tipos, horários pela grade, âncoras, dieta pelos
// horários do cadastro, etapas da solução, kit, integração com o estoque e o XML com os marcadores.
import {
  esquemaItemPrescricao,
  type ItemPrescricao,
  MARCADOR_PRESCRICAO,
  marcadorItem,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { chaveChecagem, documentoPrescricao, type ItemDocumento } from './documento.js';
import { minLocal } from './tempo.js';
import { type ContextoMontagem, ErroMontagem, horariosDaGrade, kitQueCasa, montarItem } from './montagem.js';

const VIG = { inicio: '2026-10-21T16:01', fim: '2026-10-22T16:00' };
const GRADE = new Map<number, readonly string[]>([
  [1, ['2200']],
  [2, ['2200', '1000']],
  [3, ['2200', '0600', '1400']],
  [4, ['1800', '0000', '0600', '1200']],
]);
const ctx: ContextoMontagem = {
  vigencia: VIG,
  agora: '2026-10-21T15:00',
  grade: GRADE,
  relativos: new Map([
    [1, '0700'],
    [2, '1145'],
  ]),
  horariosDieta: (d) => (d === 1 ? ['0700', '11:45', '1800'] : []),
  kit: (produto) => (produto === 502 ? [{ produto: 601, quantidade: 1, unidade: 'UN' }] : []),
  retratoCid: (cid) => (cid === 'A09' ? 77 : null),
};
const PAD = {
  unidadeVolume: 'ML',
  unidadePressao: 1,
  unidadeFio2: 2,
  tipoInfusaoHemoterapia: 3,
  unidadeHemoterapia: 'UN',
};
const item = (detalhe: unknown, extra: Record<string, unknown> = {}): ItemPrescricao =>
  esquemaItemPrescricao.parse({ chave: 'k1', detalhe, ...extra });

describe('montarItem (M24)', () => {
  it('medicamento por intervalo: grade da unidade, kit, estoque, não padronizado e alergia justificada', () => {
    const m = montarItem(
      item(
        {
          tipo: 'medicamento',
          item: { produto: 502, naoPadronizado: { justificativa: 'Sem similar SINTETICO', cid: 'A09' } },
          dose: 1,
          unidade: 'G',
          via: 'EV',
          frequencia: 11,
        },
        {
          decisoes: [{ alerta: 'alergia:502:0', decisao: 'mantido', justificativa: 'Reação leve antiga' }],
          observacaoEnfermagem: '  ',
        },
      ),
      ctx,
      PAD,
    );
    expect(m.plano).toBe(6);
    expect(m.numDose).toBe(4);
    expect(m.integracaoEstoque).toBe(true);
    expect(m.observacao).toBeNull();
    expect(m.horarios.map((h) => h.dataHora.slice(11, 16))).toEqual(['18:00', '00:00', '06:00', '12:00']);
    expect(m.detalhe).toMatchObject({
      tipo: 'medicamento',
      kit: [{ produto: 601 }],
      naoPadronizado: { htcid: 77 },
      justificativaAlergia: 'Reação leve antiga',
    });
    expect(() =>
      montarItem(
        item({
          tipo: 'medicamento',
          item: { produto: 1, naoPadronizado: { justificativa: 'Sem similar SINTETICO', cid: 'Z99' } },
          dose: 1,
          unidade: 'G',
          via: 'EV',
          frequencia: 11,
        }),
        ctx,
        PAD,
      ),
    ).toThrow(ErroMontagem);
  });

  it('se necessário e a critério não integram o estoque; relativa usa as âncoras; frequência desconhecida recusa', () => {
    const sn = montarItem(
      item({
        tipo: 'medicamento',
        item: { produto: 501 },
        dose: 1,
        unidade: 'G',
        via: 'VO',
        frequencia: 1,
        seNecessario: { motivos: [1], intervaloMinimoHoras: 6 },
      }),
      ctx,
      PAD,
    );
    expect(sn.integracaoEstoque).toBe(false);
    expect(sn.detalhe).toMatchObject({ seNecessario: [1], intervaloMinimoMinutos: 360 });
    // "Se necessário" não gera horário fixo pendente.
    expect(sn.horarios).toEqual([]);
    const rel = montarItem(
      item({
        tipo: 'medicamento',
        item: { produto: 501 },
        dose: 1,
        unidade: 'G',
        via: 'VO',
        frequencia: 18,
        relativos: [1, 2],
      }),
      ctx,
      PAD,
    );
    expect(rel.horarios.map((h) => h.relativo)).toEqual([1, 2]);
    expect(() =>
      montarItem(
        item({
          tipo: 'medicamento',
          item: { produto: 501 },
          dose: 1,
          unidade: 'G',
          via: 'VO',
          frequencia: 18,
          relativos: [9],
        }),
        ctx,
        PAD,
      ),
    ).toThrow(ErroMontagem);
    expect(() =>
      montarItem(
        item({
          tipo: 'medicamento',
          item: { produto: 501 },
          dose: 1,
          unidade: 'G',
          via: 'VO',
          frequencia: 77,
        }),
        ctx,
        PAD,
      ),
    ).toThrow(ErroMontagem);
  });

  it('cuidado, glicemia, dietas, solução, ventilação e hemoterapia', () => {
    const p = montarItem(
      item({
        tipo: 'procedimento',
        procedimento: 2,
        frequencia: 9,
        primeiroHorario: '20:00',
        seNecessario: { motivos: [3], intervaloMinimoHoras: 4 },
      }),
      ctx,
      PAD,
    );
    expect(p).toMatchObject({
      plano: 13,
      via: null,
      integracaoEstoque: false,
      detalhe: { tipo: 'procedimento', seNecessario: [3] },
    });
    const g = montarItem(
      item({
        tipo: 'glicemia',
        procedimento: 3,
        frequencia: 5,
        faixas: [{ de: 181, ate: 250, produto: 505, dose: 2, unidade: 'UI', via: 'SC' }],
      }),
      ctx,
      PAD,
    );
    expect(g).toMatchObject({ plano: 14, detalhe: { faixas: [{ produto: 505 }] } });
    const oral = montarItem(
      item({ tipo: 'dieta-oral', dieta: 1, frequencia: null, quantidade: 200 }),
      ctx,
      PAD,
    );
    expect(oral.horarios.map((h) => h.dataHora.slice(11, 16))).toEqual(['18:00', '07:00', '11:45']);
    expect(oral.numDose).toBe(1);
    const jejum = montarItem(
      item({ tipo: 'jejum', dieta: 5, frequencia: 4, caracteristicas: [{ caracteristica: 1 }] }),
      ctx,
      PAD,
    );
    expect(jejum.detalhe).toMatchObject({
      tipo: 'dieta',
      // Jejum e dieta livre sem quantidade: nulo, nunca o sentinela 0.
      quantidade: null,
      caracteristicas: [{ resposta: '' }],
      refeicoes: [],
    });
    // Composição por refeição (03-PEP L112): passa da tela ao item montado na ordem, com o substituto pela posição.
    const livre = montarItem(
      item({
        tipo: 'dieta-livre',
        dieta: 5,
        frequencia: null,
        refeicoes: [
          { refeicao: 7, alimento: 31, quantidade: 50, percentualDiario: 20 },
          {
            refeicao: 7,
            alimento: 32,
            quantidade: 40,
            medidaCaseira: 3,
            quantidadeMedidaCaseira: 2,
            substitui: 1,
          },
        ],
      }),
      ctx,
      PAD,
    );
    expect(livre.detalhe).toMatchObject({
      tipo: 'dieta',
      classe: 'livre',
      refeicoes: [
        {
          refeicao: 7,
          alimento: 31,
          quantidade: 50,
          medidaCaseira: null,
          substitui: null,
          percentualDiario: 20,
        },
        { refeicao: 7, alimento: 32, medidaCaseira: 3, quantidadeMedidaCaseira: 2, substitui: 1 },
      ],
    });
    const ent = montarItem(
      item({
        tipo: 'dieta-enteral',
        dieta: 2,
        frequencia: 4,
        viaDieta: 2,
        quantidade: 500,
        unidade: 'ML',
        tipoInfusao: 1,
        velocidade: 21,
        unidadeInfusao: 1,
      }),
      ctx,
      PAD,
    );
    expect(ent.detalhe).toMatchObject({ viaDieta: 2, velocidade: 21 });
    const sol = montarItem(
      item({
        tipo: 'solucao',
        via: 'EV',
        frequencia: 4,
        componentes: [
          { produto: 504, dose: 500, unidade: 'ML', principal: true, etapa: 1 },
          { produto: 508, dose: 10, unidade: 'ML', principal: false, etapa: 1 },
          { produto: 504, dose: 210, unidade: 'ML', principal: true, etapa: 2 },
        ],
        etapas: [
          { etapa: 1, velocidade: 125, unidadeInfusao: 1 },
          { etapa: 2, velocidade: 21, unidadeInfusao: 1 },
        ],
      }),
      ctx,
      PAD,
    );
    expect(sol.detalhe).toMatchObject({ tipo: 'solucao', unidade: 'ML', tipoInfusao: 1 });
    if (sol.detalhe.tipo === 'solucao') {
      expect(sol.detalhe.etapas).toHaveLength(2);
      // Cada componente na sua etapa; etapas em sequência, com duração = volume ÷ velocidade (4 h e 10 h).
      const [e1, e2] = sol.detalhe.etapas;
      expect(sol.detalhe.componentes.map((x) => x.etapa)).toEqual([1, 1, 2]);
      expect([e1!.volume, e2!.volume]).toEqual([500, 210]);
      expect(e1!.fim).toBe(e2!.inicio);
      expect(minLocal(e1!.fim) - minLocal(e1!.inicio)).toBe(240);
      expect(minLocal(e2!.fim) - minLocal(e2!.inicio)).toBe(600);
    }
    const vmi = montarItem(
      item({ tipo: 'vmi', viaAerea: 1, modo: 1, frequencia: 4, fio2: 40, peep: 5, pressaoInspiratoria: 20 }),
      ctx,
      PAD,
    );
    expect(vmi.detalhe).toMatchObject({
      tipo: 'vmi',
      unidade: 'ML',
      unidadePressao: 1,
      unidadeFio2: 2,
      // Sem sentinela: o que não foi prescrito fica nulo.
      frequenciaRespiratoria: null,
      volumeCorrente: null,
      tempoInspiratorio: null,
      tempoExpiratorio: null,
    });
    const vmiSem = montarItem(item({ tipo: 'vmi', viaAerea: 1, modo: 1, frequencia: null }), ctx, PAD);
    expect(vmiSem).toMatchObject({ numDose: 1, detalhe: { unidadePressao: null, unidadeFio2: null } });
    const vni = montarItem(item({ tipo: 'vni', viaAerea: 2, modo: 3, frequencia: null, fio2: 30 }), ctx, PAD);
    expect(vni).toMatchObject({
      plano: 11,
      numDose: 1,
      detalhe: { unidadeFio2: 2, unidadePressaoInspiratoria: null },
    });
    const vni2 = montarItem(
      item({ tipo: 'vni', viaAerea: 2, modo: 3, frequencia: 4, pressaoInspiratoria: 12 }),
      ctx,
      PAD,
    );
    expect(vni2.detalhe).toMatchObject({ unidadePressaoInspiratoria: 1, unidadeFio2: null });
    const hemo = montarItem(
      item({
        tipo: 'hemoterapia',
        hemocomponente: { ato: 99, codigo: 'CH' },
        dose: 1,
        unidade: 'UN',
        frequencia: 3,
        indicacao: 'Anemia sintomática SINTETICO',
        iniciarAgora: true,
      }),
      ctx,
      PAD,
    );
    expect(hemo).toMatchObject({ plano: 8, detalhe: { tipoInfusao: 3, agora: true } });
    expect(hemo.horarios.length).toBeGreaterThan(0);
  });

  it('horários próprios da dieta a partir de agora; kit que casa pela faixa e pelo tipo de atendimento', () => {
    expect(horariosDaGrade(['07:00', '18:00'], VIG, '2026-10-22T08:00').map((h) => h.dataHora)).toEqual([]);
    expect(horariosDaGrade(['18:00', '18:00'], VIG, '2026-10-21T10:00')).toHaveLength(1);
    const kits = [
      {
        produto: 1,
        doseDe: 0,
        doseAte: 0,
        unidade: 'G',
        via: 'EV',
        tipoAtendimento: null,
        itens: [{ produto: 9, quantidade: 1, unidade: 'UN' }],
      },
      {
        produto: 1,
        doseDe: 1,
        doseAte: 2,
        unidade: 'g',
        via: 'ev',
        tipoAtendimento: 'I',
        itens: [{ produto: 8, quantidade: 2, unidade: 'UN' }],
      },
      {
        produto: 1,
        doseDe: 5,
        doseAte: 9,
        unidade: 'G',
        via: 'EV',
        tipoAtendimento: 'E',
        itens: [{ produto: 7, quantidade: 1, unidade: 'UN' }],
      },
    ];
    expect(
      kitQueCasa(kits, { produto: 1, via: 'EV', unidade: 'G', dose: 1, tipoAtendimento: 'I' })[0]!.produto,
    ).toBe(8);
    expect(
      kitQueCasa(kits, { produto: 1, via: 'EV', unidade: 'G', dose: 3, tipoAtendimento: 'I' })[0]!.produto,
    ).toBe(9);
    expect(
      kitQueCasa(kits, { produto: 1, via: 'EV', unidade: 'G', dose: 6, tipoAtendimento: 'I' })[0]!.produto,
    ).toBe(9);
    expect(kitQueCasa(kits, { produto: 2, via: 'EV', unidade: 'G', dose: 1, tipoAtendimento: 'I' })).toEqual(
      [],
    ); // 'A' (todos, o DEFAULT da coluna) vale para a internação e para o externo.
    const todos = [
      {
        produto: 3,
        doseDe: 0,
        doseAte: 0,
        unidade: 'G',
        via: 'EV',
        tipoAtendimento: 'A',
        itens: [{ produto: 11, quantidade: 1, unidade: 'UN' }],
      },
    ];
    for (const tipoAtendimento of ['I', 'E'])
      expect(
        kitQueCasa(todos, { produto: 3, via: 'EV', unidade: 'G', dose: 1, tipoAtendimento }),
      ).toHaveLength(1);
  });
});

describe('documentoPrescricao (M24)', () => {
  it('um lançamento por item com o detalhe do tipo, horários e os marcadores dos IDs', () => {
    const h = (chave: string, dataHora: string, relativo: { id: number; nome: string } | null = null) => ({
      chave,
      dataHora,
      relativo,
    });
    const base = {
      plano: 6,
      planoNome: 'Medicamento',
      numDoses: 2,
      frequencia: { id: 5, nome: '12/12' },
      via: { id: 'EV', nome: 'Endovenosa' },
    };
    const itens: ItemDocumento[] = [
      {
        ...base,
        chave: 'm1',
        detalhe: {
          tipo: 'medicamento',
          produto: 501,
          nome: 'DIPIRONA & CIA',
          dose: 2.5,
          unidade: 'ML',
          agora: true,
          horarios: [h(chaveChecagem.principal('m1', 0), '2026-10-21T22:00', { id: 1, nome: 'Jantar' })],
          kit: [
            {
              produto: 601,
              nome: 'SERINGA',
              quantidade: 1,
              unidade: 'UN',
              horarios: [h(chaveChecagem.kit('m1', 0, 0), '2026-10-21T22:00')],
            },
          ],
        },
      },
      {
        ...base,
        chave: 'p1',
        plano: 13,
        planoNome: 'Cuidado',
        frequencia: null,
        via: null,
        detalhe: { tipo: 'procedimento', procedimento: 2, nome: 'Curativo', agora: false, horarios: [] },
      },
      {
        ...base,
        chave: 'd1',
        plano: 3,
        planoNome: 'Dieta oral',
        detalhe: {
          tipo: 'dieta',
          dieta: 1,
          nome: 'Geral',
          quantidade: null,
          unidade: null,
          horarios: [h('d1:0', '2026-10-21T18:00')],
        },
      },
      {
        ...base,
        chave: 's1',
        plano: 7,
        planoNome: 'Solução',
        detalhe: {
          tipo: 'solucao',
          unidade: 'ML',
          tipoInfusao: { id: 1, nome: 'Contínua' },
          agora: false,
          componentes: [
            {
              produto: 504,
              nome: 'SF',
              principal: true,
              etapa: 1,
              dose: 500,
              unidade: 'ML',
              horario: h(chaveChecagem.componente('s1', 0), '2026-10-21T18:00'),
            },
          ],
        },
      },
      {
        ...base,
        chave: 'v1',
        plano: 12,
        planoNome: 'VMI',
        detalhe: {
          tipo: 'ventilacao',
          modo: { id: 1, nome: 'PCV' },
          horarios: [h('v1:0', '2026-10-21T18:00')],
        },
      },
      {
        ...base,
        chave: 'h1',
        plano: 8,
        planoNome: 'Hemoterapia',
        detalhe: {
          tipo: 'hemoterapia',
          codigo: 'CH',
          nome: 'Concentrado',
          dose: 1,
          unidade: 'UN',
          horarios: [h('h1:0', '2026-10-21T18:00')],
        },
      },
    ];
    const xml = documentoPrescricao(
      {
        hospital: [['nome', 'HOSPITAL SINTETICO']],
        paciente: [
          ['nome', 'PACIENTE SINTETICO'],
          ['vazio', null],
        ],
        atendimento: [['id_htatendimento', 1]],
        profissional: [['id_tbcbopro', 11]],
        tipoAssinatura: 'Prescrição Geral',
      },
      itens,
    );
    expect(xml).toContain(`<id_prpresc>${MARCADOR_PRESCRICAO}</id_prpresc>`);
    expect(xml).toContain(`<id_prlangeral>${marcadorItem('m1')}</id_prlangeral>`);
    expect(xml).toContain('DIPIRONA &amp; CIA');
    expect(xml).toContain('2,5');
    for (const tag of [
      '<medicamento>',
      '<procedimento_enfermagem>',
      '<dieta>',
      '<solucao>',
      '<oxigenoterapia>',
      '<hemoterapia>',
    ])
      expect(xml.includes(tag) || xml.includes(tag.replace('>', ' '))).toBe(true);
    expect(xml).not.toContain('<vazio>');
    expect(xml.match(/<lancamento>/g)).toHaveLength(itens.length);
  });
});
