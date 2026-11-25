import { describe, expect, it } from 'vitest';
import {
  type CredenciamentoCobranca,
  conferirCobranca,
  diaAnterior,
  type EquivalenciaItemFonte,
  escolherEquivalencia,
  type ExcecaoCredenciamento,
  itemNaFonte,
  type PedidoCobranca,
  precoReferenciaNaData,
  quantidadeNaFonte,
  validarCredenciamentoCobranca,
  validarEquivalencia,
  validarExcecaoCredenciamento,
  valorDaReferencia,
} from './cobranca-fonte.js';

const eq = (o: Partial<EquivalenciaItemFonte>): EquivalenciaItemFonte => ({
  id: 1,
  itemId: null,
  grupoId: null,
  planoId: null,
  tipoContaId: null,
  tipoAtendimento: 'todos',
  codigo: 'X',
  descricao: null,
  fatorMultiplicacao: 1,
  fatorDivisao: 1,
  percentual: null,
  vigenciaInicio: '2025-01-01',
  vigenciaFim: null,
  ...o,
});

const ped = {
  itemId: 10,
  grupoId: 3,
  planoId: 7,
  planoSuperiorId: 6,
  tipoContaId: 2,
  tipoAtendimento: 'internacao' as const,
  data: '2026-05-10',
};

describe('de-para do item para a fonte pagadora', () => {
  it('item vence grupo; plano do paciente vence o superior; específico vence "todos"', () => {
    const c = [
      eq({ id: 1, grupoId: 3, codigo: 'G' }),
      eq({ id: 2, itemId: 10, codigo: 'I' }),
      eq({ id: 3, itemId: 10, planoId: 6, codigo: 'SUP' }),
      eq({ id: 4, itemId: 10, planoId: 7, codigo: 'PL' }),
      eq({ id: 5, itemId: 10, planoId: 7, tipoAtendimento: 'internacao', codigo: 'PL-INT' }),
      eq({ id: 6, itemId: 10, planoId: 7, tipoAtendimento: 'ambulatorial', codigo: 'PL-AMB' }),
    ];
    expect(escolherEquivalencia(c, ped)?.codigo).toBe('PL-INT');
    expect(escolherEquivalencia(c.slice(0, 4), ped)?.codigo).toBe('PL');
    expect(escolherEquivalencia(c.slice(0, 3), ped)?.codigo).toBe('SUP');
    expect(escolherEquivalencia(c.slice(0, 1), ped)?.codigo).toBe('G');
    expect(escolherEquivalencia(c.slice(0, 1), { ...ped, grupoId: 99 })).toBeNull();
  });

  it('fora da vigência ou de outro tipo de conta não vale; a vigência mais nova desempata', () => {
    expect(escolherEquivalencia([eq({ itemId: 10, vigenciaFim: '2026-01-01' })], ped)).toBeNull();
    expect(escolherEquivalencia([eq({ itemId: 10, tipoContaId: 9 })], ped)).toBeNull();
    const r = escolherEquivalencia(
      [
        eq({ id: 1, itemId: 10, codigo: 'A' }),
        eq({ id: 2, itemId: 10, codigo: 'B', vigenciaInicio: '2026-01-01' }),
      ],
      ped,
    );
    expect(r?.codigo).toBe('B');
  });

  it('quantidade pelos fatores e validação na hora', () => {
    expect(quantidadeNaFonte(3, { fatorMultiplicacao: 10, fatorDivisao: 4 })).toBe(7.5);
    expect(
      validarEquivalencia({
        itemId: 1,
        grupoId: 2,
        codigo: ' ',
        tipoAtendimento: 'x',
        fatorMultiplicacao: 0,
        fatorDivisao: 1,
        percentual: null,
        vigenciaInicio: '2026-02-01',
        vigenciaFim: '2026-01-01',
      }),
    ).toEqual({
      itemId: expect.any(String),
      codigo: expect.any(String),
      tipoAtendimento: expect.any(String),
      fatorMultiplicacao: expect.any(String),
      vigenciaFim: expect.any(String),
    });
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
  });
});

const cred = (o: Partial<CredenciamentoCobranca>): CredenciamentoCobranca => ({
  id: 1,
  profissionalId: 50,
  prestadorId: null,
  planoId: null,
  tipoContaId: null,
  grupoAtoId: null,
  vigenciaInicio: '2025-01-01',
  vigenciaFim: null,
  ...o,
});
const exc = (o: Partial<ExcecaoCredenciamento>): ExcecaoCredenciamento => ({
  id: 100,
  credenciamentoId: null,
  profissionalId: 50,
  prestadorId: null,
  equipeId: null,
  fonteId: null,
  planoId: null,
  tipoAtendimento: 'todos',
  grupoId: null,
  itemId: null,
  efeito: 'proibe',
  motivo: 'fora do contrato',
  vigenciaInicio: '2025-01-01',
  vigenciaFim: null,
  ...o,
});
const pc: PedidoCobranca = {
  fonteId: 1,
  particular: false,
  profissionalId: 50,
  prestadorId: null,
  equipeIds: [70],
  planoId: 7,
  planoSuperiorId: null,
  tipoContaId: 2,
  tipoAtendimento: 'internacao',
  itemId: 10,
  grupoId: 3,
  grupoAtoId: 4,
  data: '2026-05-10',
};

describe('credenciamento de cobrança com exceção', () => {
  it('credenciado vigente pode; sem credenciamento não pode; particular sempre pode', () => {
    expect(conferirCobranca([cred({})], [], pc)).toMatchObject({ permitido: true, origem: 'credenciamento' });
    expect(conferirCobranca([cred({ grupoAtoId: 9 })], [], pc)).toMatchObject({
      permitido: false,
      origem: 'sem-credenciamento',
    });
    expect(conferirCobranca([cred({ vigenciaFim: '2026-01-01' })], [], pc).permitido).toBe(false);
    expect(conferirCobranca([], [], { ...pc, particular: true }).permitido).toBe(true);
  });

  it('exceção por procedimento proíbe; a da equipe permite sem credenciamento; proibição vence empate', () => {
    const r = conferirCobranca([cred({})], [exc({ itemId: 10 })], pc);
    expect(r).toMatchObject({ permitido: false, origem: 'excecao', excecaoId: 100 });
    expect(r.motivo).toContain('fora do contrato');
    expect(conferirCobranca([cred({})], [exc({ itemId: 11 })], pc).permitido).toBe(true);
    expect(
      conferirCobranca([], [exc({ profissionalId: null, equipeId: 70, efeito: 'permite', grupoId: 3 })], pc),
    ).toMatchObject({ permitido: true, origem: 'excecao' });
    expect(
      conferirCobranca(
        [cred({})],
        [exc({ id: 1, efeito: 'permite', itemId: 10 }), exc({ id: 2, efeito: 'proibe', itemId: 10 })],
        pc,
      ).permitido,
    ).toBe(false);
    // A exceção do item vence a do grupo, mesmo permitindo.
    expect(
      conferirCobranca(
        [cred({})],
        [exc({ id: 1, grupoId: 3 }), exc({ id: 2, efeito: 'permite', itemId: 10 })],
        pc,
      ).permitido,
    ).toBe(true);
    // Exceção de outra fonte pagadora não vale.
    expect(conferirCobranca([cred({})], [exc({ fonteId: 2, itemId: 10 })], pc).permitido).toBe(true);
  });

  it('a permissão do próprio profissional abre exceção dentro da proibição da equipe para o mesmo item', () => {
    const equipeProibe = exc({ id: 1, profissionalId: null, equipeId: 70, itemId: 10 });
    const profPermite = exc({ id: 2, efeito: 'permite', motivo: null, itemId: 10 });
    expect(conferirCobranca([cred({})], [equipeProibe, profPermite], pc)).toMatchObject({
      permitido: true,
      excecaoId: 2,
    });
    // Sem a permissão individual, a proibição da equipe vale para o profissional da equipe.
    expect(conferirCobranca([cred({})], [equipeProibe], pc)).toMatchObject({
      permitido: false,
      excecaoId: 1,
    });
    // Mas a proibição da equipe para o item vence a permissão individual de todo o grupo (procedimento primeiro).
    expect(
      conferirCobranca([cred({})], [equipeProibe, exc({ id: 3, efeito: 'permite', grupoId: 3 })], pc)
        .permitido,
    ).toBe(false);
  });

  it('a exceção presa ao credenciamento geral vale mesmo com um credenciamento do plano mais específico', () => {
    const geral = cred({ id: 1 });
    const doPlano = cred({ id: 2, planoId: 7 });
    const x = exc({ credenciamentoId: 1, profissionalId: null, itemId: 10 });
    expect(conferirCobranca([geral, doPlano], [x], pc)).toMatchObject({
      permitido: false,
      credenciamentoId: 2,
      excecaoId: 100,
    });
    // Exceção de um credenciamento que não serve ao pedido (de outro profissional ou vencido) não entra.
    expect(
      conferirCobranca([geral, doPlano], [exc({ credenciamentoId: 99, profissionalId: null })], pc),
    ).toMatchObject({ permitido: true, origem: 'credenciamento' });
    expect(
      conferirCobranca(
        [cred({ id: 1, vigenciaFim: '2026-01-01' }), doPlano],
        [exc({ credenciamentoId: 1, profissionalId: null })],
        pc,
      ).permitido,
    ).toBe(true);
  });

  it('validações', () => {
    expect(
      validarCredenciamentoCobranca({
        profissionalId: null,
        prestadorId: null,
        codigoNaFonte: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).toHaveProperty('profissionalId');
    expect(
      validarExcecaoCredenciamento({
        credenciamentoId: 1,
        profissionalId: null,
        prestadorId: null,
        equipeId: null,
        tipoAtendimento: 'todos',
        efeito: 'proibe',
        motivo: '',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).toEqual({ motivo: expect.any(String) });
  });
});

describe('referência de mercado de mat/med', () => {
  const precos = [
    { edicaoId: 1, vigenciaInicio: '2025-01-01', operacao: 'inclusao', pf: 10, pmc: 13 },
    { edicaoId: 2, vigenciaInicio: '2026-01-01', operacao: 'alteracao', pf: 11, pmc: 14.5 },
    { edicaoId: 3, vigenciaInicio: '2026-06-01', operacao: 'exclusao', pf: null, pmc: null },
  ];
  it('a maior vigência até a data; a exclusão retira; a tabela escolhe PF ou PMC', () => {
    expect(precoReferenciaNaData(precos, '2025-06-01')?.pf).toBe(10);
    expect(valorDaReferencia(precoReferenciaNaData(precos, '2026-03-01'), 'pmc')).toBe(14.5);
    expect(valorDaReferencia(precoReferenciaNaData(precos, '2026-03-01'), 'pf')).toBe(11);
    expect(precoReferenciaNaData(precos, '2026-07-01')).toBeNull();
    expect(precoReferenciaNaData(precos, '2024-01-01')).toBeNull();
  });
});

describe('de-para: casos de borda da escolha', () => {
  it('equivalência de outro item, sem item nem grupo, ou de outro grupo não serve', () => {
    expect(escolherEquivalencia([eq({ itemId: 11 })], ped)).toBeNull();
    expect(escolherEquivalencia([eq({})], ped)).toBeNull();
    expect(escolherEquivalencia([eq({ grupoId: 4 })], ped)).toBeNull();
    expect(escolherEquivalencia([eq({ grupoId: 3 })], { ...ped, grupoId: null })).toBeNull();
    expect(escolherEquivalencia([], ped)).toBeNull();
  });

  it('plano: o superior vale mesmo sem o plano do paciente; plano alheio, tipo de conta ou atendimento diferente não', () => {
    // Pedido sem plano do paciente, mas com o superior: a equivalência do superior serve.
    expect(escolherEquivalencia([eq({ id: 5, itemId: 10, planoId: 6 })], { ...ped, planoId: null })?.id).toBe(
      5,
    );
    expect(escolherEquivalencia([eq({ itemId: 10, planoId: 8 })], ped)).toBeNull();
    expect(
      escolherEquivalencia([eq({ itemId: 10, planoId: 6 })], { ...ped, planoSuperiorId: null }),
    ).toBeNull();
    expect(escolherEquivalencia([eq({ itemId: 10, tipoContaId: 9 })], ped)).toBeNull();
    expect(escolherEquivalencia([eq({ itemId: 10, tipoAtendimento: 'urgencia' })], ped)).toBeNull();
    // Pedido sem tipo de atendimento: só a equivalência de "todos" serve.
    expect(
      escolherEquivalencia(
        [eq({ id: 1, itemId: 10, tipoAtendimento: 'internacao' }), eq({ id: 2, itemId: 10 })],
        { ...ped, tipoAtendimento: null },
      )?.id,
    ).toBe(2);
    // Vigência que ainda não começou não vale.
    expect(escolherEquivalencia([eq({ itemId: 10, vigenciaInicio: '2026-06-01' })], ped)).toBeNull();
  });

  it('empate de pontos: a vigência mais nova vence em qualquer ordem; a mais antiga não troca a escolhida', () => {
    const nova = eq({ id: 2, itemId: 10, vigenciaInicio: '2026-01-01' });
    const velha = eq({ id: 1, itemId: 10, vigenciaInicio: '2025-01-01' });
    expect(escolherEquivalencia([nova, velha], ped)?.id).toBe(2);
    expect(escolherEquivalencia([velha, nova], ped)?.id).toBe(2);
    // Mesma vigência: fica a primeira.
    expect(escolherEquivalencia([eq({ id: 3, itemId: 10 }), eq({ id: 4, itemId: 10 })], ped)?.id).toBe(3);
    // Pontos: item 1000 + plano 100 + conta 20 + atendimento 10 vence item + superior (1000 + 50 + 20 + 10).
    expect(
      escolherEquivalencia(
        [
          eq({ id: 6, itemId: 10, planoId: 6, tipoContaId: 2, tipoAtendimento: 'internacao' }),
          eq({ id: 7, itemId: 10, planoId: 7, tipoContaId: 2, tipoAtendimento: 'internacao' }),
        ],
        ped,
      )?.id,
    ).toBe(7);
  });

  it('quantidade arredonda a quatro casas e a validação aceita a equivalência correta', () => {
    expect(quantidadeNaFonte(1, { fatorMultiplicacao: 1, fatorDivisao: 3 })).toBe(0.3333);
    expect(quantidadeNaFonte(2, { fatorMultiplicacao: 1, fatorDivisao: 3 })).toBe(0.6667);
    const ok = {
      itemId: null,
      grupoId: 3,
      codigo: ' 10101012 ',
      tipoAtendimento: 'todos',
      fatorMultiplicacao: 1,
      fatorDivisao: 1,
      percentual: 1000,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: '2026-01-01',
    };
    expect(validarEquivalencia(ok)).toEqual({});
    expect(validarEquivalencia({ ...ok, codigo: 'X'.repeat(21) })).toEqual({ codigo: expect.any(String) });
    expect(validarEquivalencia({ ...ok, codigo: ` ${'X'.repeat(20)} ` })).toEqual({});
    expect(validarEquivalencia({ ...ok, fatorDivisao: 0 })).toEqual({ fatorDivisao: expect.any(String) });
    expect(validarEquivalencia({ ...ok, fatorMultiplicacao: Number.NaN })).toEqual({
      fatorMultiplicacao: expect.any(String),
    });
    expect(validarEquivalencia({ ...ok, percentual: 0 })).toEqual({ percentual: expect.any(String) });
    expect(validarEquivalencia({ ...ok, percentual: 1000.01 })).toEqual({ percentual: expect.any(String) });
    expect(validarEquivalencia({ ...ok, percentual: null })).toEqual({});
    expect(validarEquivalencia({ ...ok, itemId: null, grupoId: null })).toEqual({
      itemId: expect.any(String),
    });
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31');
    expect(diaAnterior('2028-03-01')).toBe('2028-02-29');
  });
});

describe('credenciamento de cobrança: casos de borda', () => {
  it('item sem profissional nem prestador não pede credenciamento', () => {
    expect(conferirCobranca([], [], { ...pc, profissionalId: null, prestadorId: null })).toEqual({
      permitido: true,
      origem: 'particular',
      credenciamentoId: null,
      excecaoId: null,
      motivo: null,
    });
  });

  it('o prestador credenciado pode cobrar; credenciamento de outro, futuro, de outro plano ou tipo de conta não', () => {
    const doPrestador = { ...pc, profissionalId: null, prestadorId: 80 };
    expect(
      conferirCobranca([cred({ profissionalId: null, prestadorId: 80 })], [], doPrestador),
    ).toMatchObject({
      permitido: true,
      origem: 'credenciamento',
    });
    expect(
      conferirCobranca([cred({ profissionalId: null, prestadorId: 81 })], [], doPrestador).permitido,
    ).toBe(false);
    expect(conferirCobranca([cred({})], [], doPrestador).permitido).toBe(false);
    expect(conferirCobranca([cred({ vigenciaInicio: '2026-06-01' })], [], pc).permitido).toBe(false);
    expect(conferirCobranca([cred({ planoId: 8 })], [], pc).permitido).toBe(false);
    expect(conferirCobranca([cred({ tipoContaId: 3 })], [], pc).permitido).toBe(false);
    const r = conferirCobranca([cred({})], [], { ...pc, planoId: null });
    expect(r).toMatchObject({ permitido: true, credenciamentoId: 1 });
    expect(conferirCobranca([cred({ planoId: 7 })], [], { ...pc, planoId: null }).permitido).toBe(false);
    expect(
      conferirCobranca([cred({ planoId: 6 })], [], { ...pc, planoId: 9, planoSuperiorId: 6 }).permitido,
    ).toBe(true);
  });

  it('o credenciamento mais específico decide; empate fica com o de maior id em qualquer ordem', () => {
    const geral = cred({ id: 1 });
    const contaEGrupo = cred({ id: 2, tipoContaId: 2, grupoAtoId: 4 });
    const doPlano = cred({ id: 3, planoId: 7 });
    // plano do paciente (300) vence o geral com conta e grupo de ato (100 + 10 + 10).
    expect(conferirCobranca([geral, contaEGrupo, doPlano], [], pc).credenciamentoId).toBe(3);
    expect(conferirCobranca([geral, contaEGrupo], [], pc).credenciamentoId).toBe(2);
    expect(conferirCobranca([cred({ id: 5 }), cred({ id: 4 })], [], pc).credenciamentoId).toBe(5);
    expect(conferirCobranca([cred({ id: 4 }), cred({ id: 5 })], [], pc).credenciamentoId).toBe(5);
  });

  it('exceção fora da vigência, de outro sujeito, plano, atendimento ou grupo não vale', () => {
    const base = [cred({})];
    const permitido = (x: ExcecaoCredenciamento) => conferirCobranca(base, [x], pc).permitido;
    expect(permitido(exc({ vigenciaFim: '2026-01-01' }))).toBe(true);
    expect(permitido(exc({ profissionalId: 51 }))).toBe(true);
    expect(permitido(exc({ profissionalId: null, equipeId: 71 }))).toBe(true);
    expect(permitido(exc({ planoId: 8 }))).toBe(true);
    expect(permitido(exc({ tipoAtendimento: 'urgencia' }))).toBe(true);
    expect(permitido(exc({ grupoId: 4 }))).toBe(true);
    // As que servem: plano do paciente, atendimento igual, mesma fonte, prestador do pedido.
    expect(permitido(exc({ planoId: 7 }))).toBe(false);
    expect(permitido(exc({ tipoAtendimento: 'internacao' }))).toBe(false);
    expect(permitido(exc({ fonteId: 1 }))).toBe(false);
    expect(
      conferirCobranca(
        [cred({ profissionalId: null, prestadorId: 80 })],
        [exc({ profissionalId: null, prestadorId: 80 })],
        { ...pc, profissionalId: null, prestadorId: 80 },
      ).permitido,
    ).toBe(false);
  });

  it('desempate das exceções: atendimento e fonte específicos somam; proibição só troca a permissão empatada', () => {
    // Mesma especificidade de procedimento e sujeito: o atendimento específico (+5) vence o "todos".
    expect(
      conferirCobranca(
        [cred({})],
        [exc({ id: 1 }), exc({ id: 2, efeito: 'permite', tipoAtendimento: 'internacao' })],
        pc,
      ),
    ).toMatchObject({ permitido: true, excecaoId: 2 });
    // A fonte informada (+2) vence a de todas as fontes.
    expect(
      conferirCobranca([cred({})], [exc({ id: 1 }), exc({ id: 2, efeito: 'permite', fonteId: 1 })], pc)
        .excecaoId,
    ).toBe(2);
    // Permissão depois da proibição empatada não troca; duas proibições empatadas: fica a primeira.
    expect(
      conferirCobranca([cred({})], [exc({ id: 1 }), exc({ id: 2, efeito: 'permite' })], pc).excecaoId,
    ).toBe(1);
    expect(conferirCobranca([cred({})], [exc({ id: 1 }), exc({ id: 2 })], pc).excecaoId).toBe(1);
  });

  it('motivo: a proibição sem motivo explica com ponto final; a permissão não traz motivo', () => {
    expect(conferirCobranca([], [exc({ motivo: null })], pc)).toEqual({
      permitido: false,
      origem: 'excecao',
      credenciamentoId: null,
      excecaoId: 100,
      motivo: 'Exceção ao credenciamento proíbe a cobrança.',
    });
    expect(conferirCobranca([cred({})], [exc({ motivo: 'fora do contrato' })], pc).motivo).toBe(
      'Exceção ao credenciamento proíbe a cobrança: fora do contrato',
    );
    expect(conferirCobranca([cred({})], [exc({ efeito: 'permite' })], pc)).toEqual({
      permitido: true,
      origem: 'excecao',
      credenciamentoId: 1,
      excecaoId: 100,
      motivo: null,
    });
    expect(conferirCobranca([], [], pc).motivo).toBe(
      'Sem credenciamento vigente para cobrar este item nesta fonte pagadora.',
    );
  });

  it('validação do credenciamento de cobrança', () => {
    const ok = {
      profissionalId: 50,
      prestadorId: null,
      codigoNaFonte: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    expect(validarCredenciamentoCobranca(ok)).toEqual({});
    expect(validarCredenciamentoCobranca({ ...ok, prestadorId: 80 })).toEqual({
      profissionalId: expect.any(String),
    });
    expect(validarCredenciamentoCobranca({ ...ok, codigoNaFonte: ` ${'9'.repeat(20)} ` })).toEqual({});
    expect(validarCredenciamentoCobranca({ ...ok, codigoNaFonte: '9'.repeat(21) })).toEqual({
      codigoNaFonte: 'O código na fonte pagadora tem até 20 caracteres.',
    });
    expect(validarCredenciamentoCobranca({ ...ok, vigenciaFim: '2026-01-01' })).toEqual({});
    expect(validarCredenciamentoCobranca({ ...ok, vigenciaFim: '2025-12-31' })).toEqual({
      vigenciaFim: 'O fim da vigência não pode ser antes do início.',
    });
  });

  it('validação da exceção ao credenciamento', () => {
    const ok = {
      credenciamentoId: null,
      profissionalId: null,
      prestadorId: null,
      equipeId: 70,
      tipoAtendimento: 'urgencia',
      efeito: 'permite',
      motivo: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    // Permissão não pede motivo.
    expect(validarExcecaoCredenciamento(ok)).toEqual({});
    expect(validarExcecaoCredenciamento({ ...ok, profissionalId: 50, equipeId: null })).toEqual({});
    expect(validarExcecaoCredenciamento({ ...ok, prestadorId: 80, equipeId: null })).toEqual({});
    expect(validarExcecaoCredenciamento({ ...ok, equipeId: null })).toEqual({
      profissionalId: 'Informe a quem a exceção vale: credenciamento, profissional, prestador ou equipe.',
    });
    expect(validarExcecaoCredenciamento({ ...ok, efeito: 'bloqueia' })).toEqual({
      efeito: 'O efeito é permitir ou proibir.',
    });
    expect(validarExcecaoCredenciamento({ ...ok, efeito: 'proibe', motivo: null })).toEqual({
      motivo: 'Informe o motivo da proibição (vai para quem lança a conta).',
    });
    expect(validarExcecaoCredenciamento({ ...ok, efeito: 'proibe', motivo: '  ' })).toHaveProperty('motivo');
    expect(validarExcecaoCredenciamento({ ...ok, efeito: 'proibe', motivo: 'glosa' })).toEqual({});
    expect(validarExcecaoCredenciamento({ ...ok, tipoAtendimento: 'domiciliar' })).toEqual({
      tipoAtendimento: 'Tipo de atendimento inválido.',
    });
    expect(validarExcecaoCredenciamento({ ...ok, vigenciaFim: '2025-12-31' })).toEqual({
      vigenciaFim: 'O fim da vigência não pode ser antes do início.',
    });
  });
});

describe('referência de mercado de mat/med: casos de borda', () => {
  it('na mesma vigência vale a edição mais nova, em qualquer ordem de entrada', () => {
    const a = { edicaoId: 4, vigenciaInicio: '2026-01-01', operacao: 'alteracao', pf: 20, pmc: 25 };
    const b = { edicaoId: 5, vigenciaInicio: '2026-01-01', operacao: 'alteracao', pf: 21, pmc: 26 };
    const velho = { edicaoId: 9, vigenciaInicio: '2025-01-01', operacao: 'inclusao', pf: 1, pmc: 2 };
    expect(precoReferenciaNaData([a, b, velho], '2026-02-01')?.edicaoId).toBe(5);
    expect(precoReferenciaNaData([velho, b, a], '2026-02-01')?.edicaoId).toBe(5);
    // A exclusão da edição mais nova na mesma vigência retira o preço.
    expect(precoReferenciaNaData([a, { ...b, operacao: 'exclusao' }], '2026-02-01')).toBeNull();
    expect(precoReferenciaNaData([], '2026-02-01')).toBeNull();
  });

  it('sem tabela definida cobra o máximo ao consumidor; sem ele, o de fábrica', () => {
    const p = { edicaoId: 1, vigenciaInicio: '2026-01-01', operacao: 'inclusao', pf: 10, pmc: 13 };
    expect(valorDaReferencia(p, null)).toBe(13);
    expect(valorDaReferencia({ ...p, pmc: null }, 'pmc')).toBe(10);
    expect(valorDaReferencia({ ...p, pf: null }, 'pf')).toBeNull();
    expect(valorDaReferencia(null, 'pf')).toBeNull();
  });
});

describe('de-para aplicado ao item da guia', () => {
  const item = { codigo: 'H-1', descricao: 'ITEM DO HOSPITAL', quantidade: 2, valorUnitario: 15 };
  const base = { codigo: 'F-9', descricao: null, fatorMultiplicacao: 1, fatorDivisao: 1, percentual: null };
  it('troca o código e mantém a descrição do hospital quando a fonte não dá uma', () => {
    expect(itemNaFonte(item, base)).toEqual({ ...item, codigo: 'F-9' });
    expect(itemNaFonte(item, { ...base, descricao: 'NA FONTE' }).descricao).toBe('NA FONTE');
  });
  it('a troca de unidade reparte o mesmo total pela nova quantidade', () => {
    const r = itemNaFonte(item, { ...base, fatorMultiplicacao: 10 });
    expect(r.quantidade).toBe(20);
    expect(r.valorUnitario).toBe(1.5);
    const t = itemNaFonte({ ...item, quantidade: 1, valorUnitario: 10 }, { ...base, fatorMultiplicacao: 3 });
    expect(Math.round(t.quantidade * t.valorUnitario * 100)).toBe(1000);
  });
  it('o percentual de cobrança muda o total; sem percentual vale 100%', () => {
    const r = itemNaFonte(item, { ...base, percentual: 70 });
    expect(r.quantidade * r.valorUnitario).toBeCloseTo(21, 4);
    const d = itemNaFonte(item, { ...base, fatorDivisao: 2, percentual: 150 });
    expect(d.quantidade).toBe(1);
    expect(d.valorUnitario).toBe(45);
  });
});
