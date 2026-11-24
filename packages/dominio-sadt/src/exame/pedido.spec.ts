import { describe, expect, it } from 'vitest';
import {
  conferirCancelamento,
  decisaoDoPedido,
  dentroDaJanela,
  itensDaVersaoDoKit,
  itensDoPedido,
  type RegraRestricao,
  restricoesAcionadas,
  type SolicitacaoAvaliada,
} from './pedido.js';

const ex = (exame: number, material: number | null = 7) => ({
  exame,
  setor: 1,
  material,
  quantidade: 1,
  urgente: false,
});
const regra = (o: Partial<RegraRestricao>): RegraRestricao => ({
  id: 1,
  exame: 10,
  tipo: 'bloqueio',
  setor: null,
  unidade: null,
  material: null,
  sexo: null,
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  tipoAtendimento: null,
  diaSemana: null,
  horaInicio: null,
  horaFim: null,
  intervaloMinimoDias: null,
  permiteExcecao: false,
  mensagem: 'Restrito.',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ...o,
});
const sol = (o: Partial<SolicitacaoAvaliada> = {}): SolicitacaoAvaliada => ({
  exame: 10,
  setor: 1,
  material: 7,
  unidade: 3,
  tipoAtendimento: 'ambulatorial',
  sexo: 'masculino',
  idadeDias: 365 * 30,
  data: '2026-11-24',
  hora: '10:00',
  anteriores: [],
  ...o,
});

describe('itens do pedido', () => {
  it('avulsos e kit, sem repetir exame e material, com a sequência e a versão do kit', () => {
    const r = itensDoPedido(
      [ex(10)],
      [{ kit: 5, versao: 50, numeroVersao: 2, itens: [ex(10), ex(11), { ...ex(12), quantidade: 2 }] }],
      true,
    );
    expect(r.map((i) => [i.sequencia, i.exame, i.kitVersao, i.urgente])).toEqual([
      [1, 10, null, false],
      [2, 11, 50, true],
      [3, 12, 50, true],
    ]);
  });
  it('pedido vazio, kit vazio e quantidade inválida são recusados', () => {
    expect(() => itensDoPedido([], [], false)).toThrow(/ao menos um exame/);
    expect(() => itensDoPedido([], [{ kit: 1, versao: 1, numeroVersao: 1, itens: [] }], false)).toThrow(
      /kit/,
    );
    expect(() => itensDoPedido([{ ...ex(1), quantidade: 0 }], [], false)).toThrow(/quantidade/);
  });
  it('a versão do kit numera os itens e recusa exame repetido', () => {
    expect(itensDaVersaoDoKit([ex(1), ex(2)]).map((i) => i.sequencia)).toEqual([1, 2]);
    expect(() => itensDaVersaoDoKit([ex(1), ex(1)])).toThrow(/duas vezes/);
    expect(() => itensDaVersaoDoKit([])).toThrow(/ao menos um/);
  });
});

describe('restrições clínicas da solicitação', () => {
  it('sexo, idade, material, atendimento, dia, horário e repetição', () => {
    const casos: [Partial<RegraRestricao>, Partial<SolicitacaoAvaliada>, string | null][] = [
      [{ sexo: 'feminino' }, {}, 'sexo'],
      [{ sexo: 'masculino' }, {}, null],
      [{ idadeMaximaDias: 365 * 12 }, {}, 'idade'],
      [{ idadeMinimaDias: 365 * 40 }, { idadeDias: null }, null],
      [{ material: 8 }, {}, 'material'],
      [{ tipoAtendimento: 'internacao' }, {}, 'atendimento'],
      [{ diaSemana: 1 }, {}, 'dia'], // 24/11/2026 é terça (3)
      [{ diaSemana: 3 }, {}, null],
      [{ horaInicio: '06:00:00', horaFim: '09:00:00' }, {}, 'horario'],
      [{ horaInicio: '22:00', horaFim: '06:00' }, { hora: '23:30' }, null],
      [{ intervaloMinimoDias: 7 }, { anteriores: ['2026-11-20'] }, 'repeticao'],
      [{ intervaloMinimoDias: 7 }, { anteriores: ['2026-11-10'] }, null],
    ];
    for (const [r, s, esperado] of casos)
      expect(restricoesAcionadas([regra(r)], sol(s))[0]?.motivo ?? null, JSON.stringify(r)).toBe(esperado);
  });
  it('a regra limitada a outro setor, unidade, exame ou fora da vigência não se aplica', () => {
    for (const r of [
      { sexo: 'feminino' as const, setor: 2 },
      { sexo: 'feminino' as const, unidade: 9 },
      { sexo: 'feminino' as const, exame: 11 },
      { sexo: 'feminino' as const, vigenciaFim: '2026-11-01' },
    ])
      expect(restricoesAcionadas([regra(r)], sol())).toEqual([]);
  });
  it('janela que atravessa a meia-noite', () => {
    expect(dentroDaJanela('05:59', '22:00', '06:00')).toBe(true);
    expect(dentroDaJanela('12:00', '22:00', '06:00')).toBe(false);
  });
  it('decisão: bloqueio recusa, exceção vigente libera, justificativa vira exceção nova, alerta pede confirmação', () => {
    const b = restricoesAcionadas([regra({ sexo: 'feminino' })], sol());
    expect(decisaoDoPedido(b, { confirmado: true, justificativa: 'x'.repeat(20) })).toMatchObject({
      segue: false,
      codigo: 'restricao-bloqueio',
    });
    const comExcecao = restricoesAcionadas([regra({ sexo: 'feminino' })], sol(), () => 99);
    expect(decisaoDoPedido(comExcecao, { confirmado: false, justificativa: null })).toMatchObject({
      segue: true,
      excecoesNovas: [],
    });
    const aceita = restricoesAcionadas([regra({ sexo: 'feminino', permiteExcecao: true })], sol());
    expect(decisaoDoPedido(aceita, { confirmado: true, justificativa: 'curta' }).codigo).toBe(
      'restricao-justificativa',
    );
    expect(
      decisaoDoPedido(aceita, { confirmado: true, justificativa: 'paciente transgênero' }),
    ).toMatchObject({
      segue: true,
      excecoesNovas: [1],
    });
    const alerta = restricoesAcionadas([regra({ tipo: 'alerta', sexo: 'feminino' })], sol());
    expect(decisaoDoPedido(alerta, { confirmado: false, justificativa: null }).codigo).toBe(
      'restricao-confirmar',
    );
    expect(decisaoDoPedido(alerta, { confirmado: true, justificativa: null }).segue).toBe(true);
  });
});

describe('cancelamento do item', () => {
  const m = { ativo: true, aplicaA: 'exame' as const, exigeComplemento: false };
  it('permite antes da liberação, com motivo ativo do exame e o complemento quando exigido', () => {
    expect(() => conferirCancelamento('coletado', m, null)).not.toThrow();
    expect(() => conferirCancelamento('liberado', m, null)).toThrow(/retifique/);
    expect(() => conferirCancelamento('cancelado', m, null)).toThrow(/já está cancelado/);
    expect(() => conferirCancelamento('solicitado', { ...m, ativo: false }, null)).toThrow(/motivo/);
    expect(() => conferirCancelamento('solicitado', { ...m, aplicaA: 'amostra' }, null)).toThrow(/motivo/);
    expect(() => conferirCancelamento('solicitado', { ...m, exigeComplemento: true }, '')).toThrow(
      /explicação/,
    );
    expect(() =>
      conferirCancelamento('solicitado', { ...m, exigeComplemento: true }, 'pedido em duplicidade'),
    ).not.toThrow();
  });
});
