import { describe, expect, it } from 'vitest';
import {
  criticarItensDaMarcacao,
  desdobrarItens,
  formaCicloDeRequisito,
  type ItemAgendavelEntrada,
  combinarPreparo,
  montarPreparo,
  type RegrasDoItem,
  validarItemAgendavel,
} from './item-agendavel.js';

const base = (x: Partial<ItemAgendavelEntrada> = {}): ItemAgendavelEntrada => ({
  codigo: 'US-ABD',
  descricao: 'Ultrassom de abdome',
  tipoItem: 'exame',
  duracaoMinutos: 20,
  diasPreparo: null,
  orientacaoPreparo: null,
  intervaloRepeticaoMinutos: null,
  composicao: [],
  conflitos: [],
  requisitos: [],
  recursos: [],
  orientacoes: [],
  ...x,
});
const cod = (e: ItemAgendavelEntrada, id: number | null = 1) => validarItemAgendavel(e, id)?.codigo ?? null;

describe('validarItemAgendavel', () => {
  it('aceita o item simples e recusa campos básicos inválidos', () => {
    expect(cod(base())).toBeNull();
    expect(cod(base({ codigo: ' ' }))).toBe('codigo-obrigatorio');
    expect(cod(base({ tipoItem: 'outro' }))).toBe('tipo-invalido');
    expect(cod(base({ duracaoMinutos: 0 }))).toBe('duracao-invalida');
    expect(cod(base({ diasPreparo: 2 }))).toBe('preparo-sem-orientacao');
    expect(cod(base({ intervaloRepeticaoMinutos: 0 }))).toBe('intervalo-invalido');
  });
  it('composição só no pacote, sem si mesmo nem repetição', () => {
    expect(cod(base({ tipoItem: 'composto' }))).toBe('pacote-vazio');
    expect(cod(base({ composicao: [{ componente: 2, quantidade: 1 }] }))).toBe('composicao-fora-de-pacote');
    const pac = (c: { componente: number; quantidade: number }[]) =>
      base({ tipoItem: 'composto', composicao: c });
    expect(cod(pac([{ componente: 1, quantidade: 1 }]))).toBe('composicao-propria');
    expect(
      cod(
        pac([
          { componente: 2, quantidade: 1 },
          { componente: 2, quantidade: 1 },
        ]),
      ),
    ).toBe('composicao-repetida');
    expect(cod(pac([{ componente: 2, quantidade: 0 }]))).toBe('quantidade-invalida');
    expect(cod(pac([{ componente: 2, quantidade: 1 }]))).toBeNull();
  });
  it('conflitos, pré-requisitos, recursos e orientações', () => {
    expect(cod(base({ conflitos: [{ item: 1, intervaloMinimoHoras: 2, direcao: 'ambos' }] }))).toBe(
      'conflito-proprio',
    );
    expect(cod(base({ conflitos: [{ item: 2, intervaloMinimoHoras: 0, direcao: 'ambos' }] }))).toBe(
      'conflito-sem-intervalo',
    );
    const req = {
      tipo: 'item_realizado' as const,
      item: 2,
      descricao: null,
      prazoMaximoDias: 30,
      bloqueia: true,
    };
    expect(cod(base({ requisitos: [{ ...req, item: null }] }))).toBe('requisito-sem-item');
    expect(cod(base({ requisitos: [{ ...req, tipo: 'documento', item: null }] }))).toBe(
      'requisito-sem-condicao',
    );
    expect(cod(base({ requisitos: [req, req] }))).toBe('requisito-repetido');
    expect(
      cod(base({ requisitos: [req], conflitos: [{ item: 2, intervaloMinimoHoras: 1, direcao: 'ambos' }] })),
    ).toBe('requisito-em-conflito');
    expect(cod(base({ requisitos: [{ ...req, prazoMaximoDias: 0 }] }))).toBe('requisito-prazo');
    const rec = { recurso: 5, papel: 'exigido' as const, quantidade: 1 };
    expect(cod(base({ recursos: [rec, rec] }))).toBe('recurso-repetido');
    expect(cod(base({ orientacoes: [{ fontePagadora: 3, orientacao: ' ' }] }))).toBe('orientacao-vazia');
    expect(
      cod(base({ requisitos: [req], recursos: [rec], orientacoes: [{ fontePagadora: 3, orientacao: 'x' }] })),
    ).toBeNull();
  });
  it('ciclo de pré-requisito', () => {
    const arestas = [
      { item: 2, exigido: 3 },
      { item: 3, exigido: 1 },
    ];
    expect(formaCicloDeRequisito(1, [2], arestas)).toBe(true);
    expect(formaCicloDeRequisito(1, [4], arestas)).toBe(false);
    expect(formaCicloDeRequisito(1, [2], [{ item: 1, exigido: 9 }])).toBe(false);
  });
});

const H = 3_600_000;
const T0 = Date.UTC(2030, 2, 12, 11, 0);
const regra = (x: Partial<RegrasDoItem> = {}): RegrasDoItem => ({
  id: 10,
  descricao: 'Colonoscopia',
  ativo: true,
  duracaoMinutos: 40,
  intervaloRepeticaoMinutos: null,
  requisitos: [],
  conflitos: [],
  recursos: [],
  ...x,
});
const critica = (
  itens: RegrasDoItem[],
  historico = [] as Parameters<typeof criticarItensDaMarcacao>[0]['historico'],
  recursos = [] as Parameters<typeof criticarItensDaMarcacao>[0]['recursos'],
  jaLancados: number[] = [],
) =>
  criticarItensDaMarcacao({
    marcacao: 1,
    inicio: T0,
    itens,
    nomes: new Map([[20, 'Consulta pré']]),
    historico,
    recursos,
    jaLancados,
  });

describe('criticarItensDaMarcacao', () => {
  it('pré-requisito realizado dentro da validade; só marcado não basta; fora do prazo bloqueia; alerta quando não bloqueia', () => {
    const req = {
      tipo: 'item_realizado' as const,
      item: 20,
      descricao: null,
      prazoMaximoDias: 30,
      bloqueia: true,
    };
    const r = critica([regra({ requisitos: [req] })]);
    expect(r.bloqueios.map((b) => b.codigo)).toEqual(['requisito-nao-realizado']);
    expect(r.bloqueios[0]!.mensagem).toContain('Consulta pré');
    const feito = { item: 20, inicio: T0 - 10 * 24 * H, realizado: true, marcacao: 2 };
    expect(critica([regra({ requisitos: [req] })], [feito]).bloqueios).toEqual([]);
    expect(critica([regra({ requisitos: [req] })], [{ ...feito, realizado: false }]).bloqueios).toHaveLength(
      1,
    );
    expect(
      critica([regra({ requisitos: [req] })], [{ ...feito, inicio: T0 - 40 * 24 * H }]).bloqueios,
    ).toHaveLength(1);
    const marcado = { ...req, tipo: 'item_marcado' as const };
    expect(critica([regra({ requisitos: [marcado] })], [{ ...feito, realizado: false }]).bloqueios).toEqual(
      [],
    );
    const so = critica([regra({ requisitos: [{ ...req, bloqueia: false }] })]);
    expect([so.bloqueios.length, so.alertas.map((a) => a.codigo)]).toEqual([0, ['requisito-nao-realizado']]);
    const doc = critica([
      regra({
        requisitos: [
          {
            tipo: 'documento',
            item: null,
            descricao: 'Termo assinado',
            prazoMaximoDias: null,
            bloqueia: true,
          },
        ],
      }),
    ]);
    expect([doc.bloqueios.length, doc.alertas[0]!.mensagem]).toEqual([
      0,
      expect.stringContaining('Termo assinado'),
    ]);
  });
  it('conflito pelo sentido da regra, na mesma marcação e repetição mínima', () => {
    const c = (direcao: 'antes' | 'depois' | 'ambos') =>
      regra({ conflitos: [{ item: 20, intervaloMinimoHoras: 48, direcao }] });
    const antes = { item: 20, inicio: T0 - 24 * H, realizado: false, marcacao: 2 };
    expect(critica([c('ambos')], [antes]).bloqueios.map((b) => b.codigo)).toEqual(['conflito-entre-itens']);
    expect(critica([c('antes')], [antes]).bloqueios).toHaveLength(1);
    expect(critica([c('depois')], [antes]).bloqueios).toHaveLength(0);
    expect(critica([c('ambos')], [{ ...antes, inicio: T0 - 49 * H }]).bloqueios).toHaveLength(0);
    // A própria marcação não conta como histórico; o par na mesma marcação bloqueia.
    expect(critica([c('ambos')], [{ ...antes, marcacao: 1 }]).bloqueios).toHaveLength(0);
    expect(critica([c('ambos'), regra({ id: 20, descricao: 'Consulta pré' })]).bloqueios[0]!.codigo).toBe(
      'conflito-na-marcacao',
    );
    // Lançamento em dois passos: o item 20 já está nesta marcação (pedido anterior); o novo conflita com ele.
    expect(
      critica([c('ambos')], [{ ...antes, marcacao: 1 }], [], [20]).bloqueios.map((b) => b.codigo),
    ).toEqual(['conflito-na-marcacao']);
    const rep = regra({ intervaloRepeticaoMinutos: 60 * 24 });
    expect(
      critica([rep], [{ item: 10, inicio: T0 + 2 * H, realizado: false, marcacao: 3 }]).bloqueios[0]!.codigo,
    ).toBe('repeticao-antes-do-intervalo');
  });
  it('equipamento livre pela capacidade e recurso inativo; item inativo', () => {
    const it2 = regra({ recursos: [{ recurso: 7, papel: 'exigido', quantidade: 1 }] });
    const livre = { recurso: 7, descricao: 'Endoscópio', ativo: true, capacidade: 2, ocupado: 1 };
    expect(critica([it2], [], [livre]).bloqueios).toEqual([]);
    expect(critica([it2], [], [{ ...livre, ocupado: 2 }]).bloqueios.map((b) => b.codigo)).toEqual([
      'equipamento-ocupado',
    ]);
    expect(critica([it2], [], [{ ...livre, ativo: false }]).bloqueios[0]!.codigo).toBe('recurso-inativo');
    expect(critica([regra({ ativo: false })]).bloqueios[0]!.codigo).toBe('item-inativo');
    // Pacote com 2 sessões: o recurso é pedido 2 vezes (1 livre de capacidade 2, com 1 ocupado, não basta).
    expect(critica([{ ...it2, quantidade: 2 }], [], [livre]).bloqueios.map((b) => b.codigo)).toEqual([
      'equipamento-ocupado',
    ]);
  });
});

describe('montarPreparo e desdobrarItens', () => {
  it('junta a orientação padrão e a do convênio, com a data de início e o aviso de tempo', () => {
    const p = montarPreparo({
      item: 1,
      data: '2030-03-12',
      hoje: '2030-03-11',
      diasPreparo: 3,
      orientacaoPadrao: 'Dieta sem resíduos.',
      orientacaoFonte: 'Levar a guia autorizada.',
    });
    expect(p.inicioPreparo).toBe('2030-03-09');
    expect(p.tempoInsuficiente).toBe(true);
    expect(p.texto).toBe(
      'Começar o preparo 3 dia(s) antes: a partir de 09/03/2030.\nDieta sem resíduos.\nOrientação do convênio: Levar a guia autorizada.',
    );
    const s = montarPreparo({
      item: 1,
      data: '2030-03-12',
      hoje: '2030-03-01',
      diasPreparo: null,
      orientacaoPadrao: null,
      orientacaoFonte: null,
    });
    expect([s.texto, s.tempoInsuficiente]).toEqual([null, false]);
  });
  it('desdobra o pacote com a quantidade da composição, sem repetir (soma as quantidades)', () => {
    const comp = new Map([
      [
        1,
        [
          { componente: 3, quantidade: 2 },
          { componente: 5, quantidade: 1 },
        ],
      ],
    ]);
    expect(desdobrarItens([1, 3, 4], comp)).toEqual([
      { item: 3, quantidade: 3, pacote: 1 },
      { item: 5, quantidade: 1, pacote: 1 },
      { item: 4, quantidade: 1, pacote: null },
    ]);
  });
  it('o preparo do pacote vem antes do preparo do componente, com o início mais cedo', () => {
    const pacote = { item: 1, texto: 'Jejum de 8 h.', inicioPreparo: '2030-03-10', tempoInsuficiente: false };
    const proprio = { item: 3, texto: 'Levar exames.', inicioPreparo: '2030-03-11', tempoInsuficiente: true };
    expect(combinarPreparo(pacote, proprio)).toEqual({
      item: 3,
      texto: 'Jejum de 8 h.\nLevar exames.',
      inicioPreparo: '2030-03-10',
      tempoInsuficiente: true,
    });
    expect(combinarPreparo(null, proprio)).toBe(proprio);
  });
});
