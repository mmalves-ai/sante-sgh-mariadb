// Regras dos ajustes de valor na conta (F3.7, 06-FAT linhas 17, 18 e 20).
import { describe, expect, it } from 'vitest';
import {
  etapaDaAlcada,
  acrescimoDoItem,
  alertasDoPacote,
  classificarItens,
  classesDaPartilha,
  partilharItens,
  composicaoDaVersao,
  conferirAlcadaDoValor,
  conferirDecisaoAjuste,
  diaDaSemana,
  diasDePermanenciaPacote,
  type FaixaHorarioEspecial,
  faixaDoHorario,
  faixasDoAto,
  itemDeAnestesia,
  totaisDosAjustes,
  validarAjusteConta,
  validarFaixaHorario,
  validarNovaVersao,
  versaoVigente,
  vespera,
} from '../index.js';

const faixa = (x: Partial<FaixaHorarioEspecial>): FaixaHorarioEspecial => ({
  id: 1,
  codigo: 'N',
  tipoHorario: 'noturno',
  diaSemana: null,
  aplicaFeriado: false,
  horaInicio: '19:00',
  horaFim: '07:00',
  percentual: 30,
  percentualHonorario: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  fontePagadoraId: null,
  ativo: true,
  ...x,
});

describe('horário especial (linha 17)', () => {
  const noturno = faixa({});
  const fds = faixa({
    id: 2,
    codigo: 'F',
    tipoHorario: 'fim_de_semana',
    horaInicio: null,
    horaFim: null,
    percentual: 20,
  });
  const feriado = faixa({
    id: 3,
    codigo: 'H',
    tipoHorario: 'feriado',
    horaInicio: null,
    horaFim: null,
    percentual: 25,
  });
  const todas = [noturno, fds, feriado];
  it('dia da semana sem fuso', () => {
    expect(diaDaSemana('2026-11-22')).toBe(0); // domingo
    expect(diaDaSemana('2026-11-24')).toBe(2);
  });
  it('noturno vira a meia-noite; dia útil de dia fica normal', () => {
    expect(
      faixaDoHorario({ quando: '2026-11-24T23:30', feriado: false, fontePagadoraId: 9 }, todas)?.codigo,
    ).toBe('N');
    expect(
      faixaDoHorario({ quando: '2026-11-24T03:00', feriado: false, fontePagadoraId: 9 }, todas)?.codigo,
    ).toBe('N');
    expect(
      faixaDoHorario({ quando: '2026-11-24T10:00', feriado: false, fontePagadoraId: 9 }, todas),
    ).toBeNull();
    expect(
      faixaDoHorario({ quando: '2026-11-24T07:00', feriado: false, fontePagadoraId: 9 }, todas),
    ).toBeNull();
  });
  it('não acumula: vale o maior percentual; o do acordo vence o geral', () => {
    // sábado à noite: noturno 30 e fim de semana 20 → 30
    expect(
      faixaDoHorario({ quando: '2026-11-28T22:00', feriado: false, fontePagadoraId: 9 }, todas)?.codigo,
    ).toBe('N');
    expect(
      faixaDoHorario({ quando: '2026-11-28T10:00', feriado: false, fontePagadoraId: 9 }, todas)?.codigo,
    ).toBe('F');
    expect(
      faixaDoHorario({ quando: '2026-11-24T10:00', feriado: true, fontePagadoraId: 9 }, todas)?.codigo,
    ).toBe('H');
    const doAcordo = faixa({ id: 9, codigo: 'A', fontePagadoraId: 9, percentual: 10 });
    expect(
      faixaDoHorario({ quando: '2026-11-24T23:00', feriado: false, fontePagadoraId: 9 }, [...todas, doAcordo])
        ?.codigo,
    ).toBe('A');
    expect(
      faixaDoHorario({ quando: '2026-11-24T23:00', feriado: false, fontePagadoraId: 8 }, [...todas, doAcordo])
        ?.codigo,
    ).toBe('N');
  });
  it('fora do expediente da tabela e vigência', () => {
    const apos = faixa({
      id: 4,
      codigo: 'X',
      tipoHorario: 'apos_horario',
      horaInicio: null,
      horaFim: null,
      percentual: 15,
    });
    const exp = [{ diaSemana: 2, horaInicio: '07:00', horaFim: '18:00' }];
    expect(
      faixaDoHorario({ quando: '2026-11-24T18:30', feriado: false, fontePagadoraId: 1 }, [apos], exp)?.codigo,
    ).toBe('X');
    expect(
      faixaDoHorario({ quando: '2026-11-24T17:59', feriado: false, fontePagadoraId: 1 }, [apos], exp),
    ).toBeNull();
    expect(
      faixaDoHorario({ quando: '2026-11-24T18:30', feriado: false, fontePagadoraId: 1 }, [apos], []),
    ).toBeNull();
    const vencida = faixa({ vigenciaFim: '2026-06-30' });
    expect(
      faixaDoHorario({ quando: '2026-11-24T23:00', feriado: false, fontePagadoraId: 1 }, [vencida]),
    ).toBeNull();
  });
  it('acréscimo com percentual próprio do honorário', () => {
    expect(acrescimoDoItem(200, 0, noturno)).toBe(60);
    expect(acrescimoDoItem(200, 100, faixa({ percentualHonorario: 50 }))).toBe(80);
  });
  it('validação da faixa', () => {
    const ok = {
      codigo: 'N',
      descricao: 'Noturno',
      tipoHorario: 'noturno',
      diaSemana: null,
      aplicaFeriado: false,
      horaInicio: '19:00',
      horaFim: '07:00',
      percentual: 30,
      percentualHonorario: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    expect(validarFaixaHorario(ok)).toEqual({});
    expect(Object.keys(validarFaixaHorario({ ...ok, horaFim: null }))).toContain('horaFim');
    expect(Object.keys(validarFaixaHorario({ ...ok, percentual: 0, diaSemana: 8 }))).toEqual([
      'diaSemana',
      'percentual',
    ]);
    expect(Object.keys(validarFaixaHorario({ ...ok, vigenciaFim: '2025-01-01' }))).toEqual(['vigenciaFim']);
  });
});

describe('ajuste da conta (linha 18)', () => {
  const ctx = { valorItens: 1000, descontosEmVigor: 0, acrescimosEmVigor: 0 };
  const base = {
    tipo: 'desconto' as const,
    forma: 'valor' as const,
    valor: 100,
    percentual: null,
    justificativa: 'Acordo comercial firmado',
  };
  it('calcula e confere', () => {
    expect(validarAjusteConta(base, { tipoAjuste: 'desconto', ativo: true }, ctx)).toEqual({
      erros: {},
      valor: 100,
    });
    expect(
      validarAjusteConta(
        { ...base, forma: 'percentual', percentual: 12.5 },
        { tipoAjuste: 'desconto', ativo: true },
        ctx,
      ).valor,
    ).toBe(125);
    expect(
      Object.keys(validarAjusteConta(base, { tipoAjuste: 'acrescimo', ativo: true }, ctx).erros),
    ).toEqual(['motivoId']);
    expect(Object.keys(validarAjusteConta({ ...base, justificativa: 'curta' }, null, ctx).erros)).toEqual([
      'motivoId',
      'justificativa',
    ]);
    expect(
      validarAjusteConta(
        { ...base, valor: 950 },
        { tipoAjuste: 'desconto', ativo: true },
        { ...ctx, descontosEmVigor: 100 },
      ).erros['valor'],
    ).toContain('passa');
    expect(
      validarAjusteConta(base, { tipoAjuste: 'desconto', ativo: true }, { ...ctx, valorItens: 0 }).erros[
        'valor'
      ],
    ).toBeTruthy();
  });
  it('alçada: quem pede não decide', () => {
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 5, 'aprovar')).toContain('não pode');
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 6, 'aprovar')).toBeNull();
    expect(conferirDecisaoAjuste('aprovado', 5, 6, 'recusar')).toContain('já foi');
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 6, 'cancelar')).toContain('Só quem');
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 5, 'cancelar')).toBeNull();
  });
  it('só aprovado entra no total', () => {
    expect(
      totaisDosAjustes([
        { tipo: 'acrescimo', situacao: 'aprovado', valor: 10 },
        { tipo: 'desconto', situacao: 'aprovado', valor: 5.5 },
        { tipo: 'desconto', situacao: 'pendente_aprovacao', valor: 99 },
        { tipo: 'acrescimo', situacao: 'recusado', valor: 99 },
      ]),
    ).toEqual({ acrescimo: 10, desconto: 5.5 });
  });
});

describe('pacote na conta (linha 20)', () => {
  const v = (id: number, numero: number, i: string, f: string | null) => ({
    id,
    numero,
    vigenciaInicio: i,
    vigenciaFim: f,
    valor: 1000 * numero,
  });
  it('versão vigente e nova versão', () => {
    const vs = [v(1, 1, '2026-01-01', '2026-06-30'), v(2, 2, '2026-07-01', null)];
    expect(versaoVigente(vs, '2026-03-10')?.numero).toBe(1);
    expect(versaoVigente(vs, '2026-08-01')?.numero).toBe(2);
    expect(versaoVigente(vs, '2025-12-31')).toBeNull();
    expect(validarNovaVersao(vs, '2026-07-01', 10)['vigenciaInicio']).toContain('depois');
    expect(validarNovaVersao(vs, '2026-09-01', 10)).toEqual({});
    expect(vespera('2026-03-01')).toBe('2026-02-28');
  });
  const it1 = (id: number, itemId: number, grupoId: number | null, quantidade = 1, valor = 100) => ({
    id,
    itemId,
    grupoId,
    setorId: null,
    quantidade,
    valor,
  });
  it('classifica: exceção vence inclusão; limite manda o excedente à parte', () => {
    const itens = [it1(1, 10, 1), it1(2, 11, 1, 3), it1(3, 12, 2), it1(4, 13, 3), it1(5, 11, 1, 1)];
    const c = classificarItens(
      itens,
      [
        { itemId: null, grupoId: 1, setorId: null, quantidadeLimite: null },
        { itemId: 11, grupoId: null, setorId: null, quantidadeLimite: 3 },
      ],
      [
        { itemId: 12, grupoId: null, setorId: null, categoriaAcomodacaoId: null, efeito: 'cobrar_a_parte' },
        { itemId: null, grupoId: 3, setorId: null, categoriaAcomodacaoId: null, efeito: 'descaracteriza' },
      ],
      null,
    );
    expect([...c.entries()]).toEqual([
      [1, 'incluso'],
      [2, 'incluso'],
      [3, 'a_parte'],
      [4, 'descaracteriza'],
      [5, 'incluso'],
    ]);
    const c2 = classificarItens(
      itens,
      [{ itemId: 11, grupoId: null, setorId: null, quantidadeLimite: 3 }],
      [],
      null,
    );
    expect(c2.get(2)).toBe('incluso');
    expect(c2.get(5)).toBe('a_parte');
    expect(c2.get(1)).toBe('a_parte');
    expect(classificarItens(itens, [], [], null).get(4)).toBe('incluso');
  });
  it('tetos e diárias geram alerta, sem descaracterizar sozinho', () => {
    const itens = [it1(1, 10, 1, 2, 300), it1(2, 11, 2, 1, 50)];
    const cl = classificarItens(itens, [], [], null);
    const a = alertasDoPacote(
      itens,
      cl,
      [{ id: 1, grupoId: null, diasTeto: 3, quantidadeTeto: null, valorTeto: 200, descaracteriza: true }],
      5,
      2,
    );
    expect(a.map((x) => x.tipo)).toEqual(['teto', 'teto', 'diarias']);
    expect(a[0]!.descaracteriza).toBe(true);
    expect(alertasDoPacote(itens, cl, [], 1, 2)).toEqual([]);
    expect(diasDePermanenciaPacote('2026-01-01', '2026-01-03')).toBe(2);
    expect(diasDePermanenciaPacote('2026-01-01', '2026-01-01')).toBe(1);
  });
});

describe('correções da revisão (linhas 17, 18 e 20)', () => {
  it('horário: percentual por componente e item de anestesia', () => {
    const f = faixa({ percentualHonorario: 50, percentualCustoOperacional: 10, percentualFilme: 0 });
    // 300 = 100 honorário (50%) + 100 custo operacional (10%) + 50 filme (0%) + 50 resto (30%)
    expect(acrescimoDoItem(300, { honorario: 100, custoOperacional: 100, filme: 50 }, f)).toBe(75);
    // componentes acima da base são cortados
    expect(acrescimoDoItem(100, { honorario: 80, custoOperacional: 80 }, f)).toBe(42);
    expect(acrescimoDoItem(100, { honorario: 0, anestesia: true }, faixa({ percentualAnestesia: 40 }))).toBe(
      40,
    );
    expect(acrescimoDoItem(100, { honorario: 0, anestesia: true }, faixa({}))).toBe(30);
  });
  it('horário: a faixa do acordo vence a da fonte, que vence a geral; acordo de outro não vale', () => {
    const geral = faixa({ id: 1, percentual: 50 });
    const fonte = faixa({ id: 2, fontePagadoraId: 7, percentual: 40 });
    const acordo = faixa({ id: 3, fontePagadoraId: 7, contratoId: 9, percentual: 20 });
    const h = { quando: '2026-01-20T23:00', feriado: false, fontePagadoraId: 7 };
    expect(faixaDoHorario({ ...h, contratoId: 9 }, [geral, fonte, acordo])?.id).toBe(3);
    expect(faixaDoHorario({ ...h, contratoId: 8 }, [geral, fonte, acordo])?.id).toBe(2);
    expect(faixaDoHorario({ ...h, fontePagadoraId: 1 }, [geral, fonte, acordo])?.id).toBe(1);
  });
  it('alçada por valor: nível do usuário ou do perfil, faixa de valor, sem alçada cadastrada vale a separação', () => {
    const niveis = [
      { id: 1, nivel: 1, perfilId: 10, usuarioId: null, valorMinimo: 0, valorMaximo: 100 },
      { id: 2, nivel: 2, perfilId: null, usuarioId: 5, valorMinimo: 0, valorMaximo: null },
    ];
    expect(conferirAlcadaDoValor(50, niveis, 3, [10]).nivel?.id).toBe(1);
    expect(conferirAlcadaDoValor(150, niveis, 3, [10]).motivo).toContain('passa a sua alçada (até 100.00)');
    expect(conferirAlcadaDoValor(150, niveis, 3, [11]).motivo).toContain('não está na alçada');
    expect(conferirAlcadaDoValor(9999, niveis, 5, []).nivel?.id).toBe(2);
    expect(conferirAlcadaDoValor(9999, [], 3, [])).toEqual({ nivel: null, motivo: null });
  });
  it('alçada em série: níveis cuja faixa contém o valor, um após o outro, cada um por uma pessoa', () => {
    const niveis = [
      { id: 1, nivel: 1, perfilId: 10, usuarioId: null, valorMinimo: 0, valorMaximo: null },
      { id: 2, nivel: 2, perfilId: null, usuarioId: 5, valorMinimo: 1000, valorMaximo: null },
      { id: 3, nivel: 3, perfilId: 20, usuarioId: null, valorMinimo: 0, valorMaximo: 50 },
      {
        id: 4,
        nivel: 4,
        perfilId: 30,
        usuarioId: null,
        valorMinimo: 0,
        valorMaximo: null,
        obrigatorio: false,
      },
    ];
    const serie = { modo: 'serie' as const, permiteAutoaprovacao: false };
    // 5000: níveis 1 e 2 (o 3 não alcança, o 4 não é obrigatório); o nível 2 não decide antes do 1.
    expect(etapaDaAlcada(5000, niveis, serie, [], 5, []).motivo).toContain('nível 1');
    const n1 = etapaDaAlcada(5000, niveis, serie, [], 3, [10]);
    expect([n1.nivel?.id, n1.conclui, n1.faltam]).toEqual([1, false, [1, 2]]);
    // Quem aprovou o nível 1 não aprova o 2, nem pelo usuário.
    expect(etapaDaAlcada(5000, niveis, serie, [{ nivel: 1, usuarioId: 5 }], 5, []).motivo).toContain(
      'já aprovou',
    );
    const n2 = etapaDaAlcada(5000, niveis, serie, [{ nivel: 1, usuarioId: 3 }], 5, []);
    expect([n2.nivel?.id, n2.conclui]).toEqual([2, true]);
    // 30: níveis 1 e 3; em paralelo o 3 decide antes do 1.
    const par = etapaDaAlcada(30, niveis, { modo: 'paralelo', permiteAutoaprovacao: false }, [], 7, [20]);
    expect([par.nivel?.id, par.conclui, par.faltam]).toEqual([3, false, [1, 3]]);
    expect(etapaDaAlcada(30, niveis, serie, [], 7, [20]).motivo).toContain('nível 1');
    // Fora da alçada e cargo sem alçada.
    expect(etapaDaAlcada(30, niveis, serie, [], 9, [99]).motivo).toContain('não está na alçada');
    const so = [{ id: 9, nivel: 1, perfilId: 10, usuarioId: null, valorMinimo: 0, valorMaximo: 100 }];
    expect(etapaDaAlcada(150, so, serie, [], 3, [10]).motivo).toContain('passa a alçada cadastrada');
    // Só não obrigatórios alcançam o valor: um deles basta.
    const opc = [{ ...niveis[3]! }];
    expect(etapaDaAlcada(10, opc, serie, [], 1, [30]).conclui).toBe(true);
    expect(etapaDaAlcada(10, [], serie, [], 1, []).conclui).toBe(true);
  });
  it('autoaprovação só quando a alçada permite e só para aprovar', () => {
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 5, 'aprovar', true)).toBeNull();
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 5, 'recusar', true)).toContain('não pode');
    expect(conferirDecisaoAjuste('pendente_aprovacao', 5, 5, 'aprovar', false)).toContain('não pode');
  });
  it('pacote: versão encerrada vale pelo retrato; a aberta pela composição atual', () => {
    const atual = { inclusoes: [{ itemId: 1 }], excecoes: [{ itemId: 2 }], tetos: [], diarias: [] };
    const retrato = JSON.stringify({ inclusoes: [], excecoes: [], tetos: [{ id: 1 }], diarias: [] });
    expect(composicaoDaVersao({ vigenciaFim: '2025-12-31' }, retrato, atual)).toEqual({
      inclusoes: [],
      excecoes: [],
      tetos: [{ id: 1 }],
      diarias: [],
    });
    expect(composicaoDaVersao({ vigenciaFim: null }, retrato, atual)).toBe(atual);
    expect(composicaoDaVersao({ vigenciaFim: '2025-12-31' }, 'ilegível', atual)).toBe(atual);
    expect(composicaoDaVersao(null, retrato, atual)).toBe(atual);
  });
  it('pacote: diárias além das incluídas trazem a proposta de lançamento', () => {
    const a = alertasDoPacote([], new Map(), [], 5, 2, { itemId: 44, valor: 150 });
    expect(a).toEqual([
      {
        tipo: 'diarias',
        descaracteriza: false,
        mensagem: '3 diária(s) além das 2 incluídas: cobradas à parte a 150.00 cada.',
        proposta: { itemId: 44, quantidade: 3, valorUnitario: 150 },
      },
    ]);
  });
});

describe('pacote na conta: partilha do limite e diárias lançadas (linha 20, 3ª volta)', () => {
  const item = (id: number, itemId: number, quantidade: number) => ({
    id,
    itemId,
    grupoId: 1,
    setorId: null,
    quantidade,
    valor: quantidade * 10,
  });
  const limite3 = [{ itemId: 11, grupoId: null, setorId: null, quantidadeLimite: 3 }];
  it('o item que passa do limite é partido: o que cabe fica incluso e só o resto vai à parte', () => {
    const p = partilharItens([item(1, 11, 2), item(2, 11, 2), item(3, 11, 1)], limite3, [], null);
    expect(p.get(1)).toEqual({ classe: 'incluso', quantidadeInclusa: 2 });
    expect(p.get(2)).toEqual({ classe: 'incluso', quantidadeInclusa: 1 });
    expect(p.get(3)).toEqual({ classe: 'a_parte', quantidadeInclusa: 0 });
    // Depois de partido (2 inclusa + 1 à parte em outro lançamento), a nova partilha é estável.
    const depois = partilharItens(
      [item(1, 11, 2), item(2, 11, 1), item(3, 11, 1), item(4, 11, 1)],
      limite3,
      [],
      null,
    );
    expect([...depois.values()].map((x) => x.quantidadeInclusa)).toEqual([2, 1, 0, 0]);
    expect(classesDaPartilha(depois).get(4)).toBe('a_parte');
  });
  it('exceção vence o limite; sem limite cobre tudo; pacote fechado inclui o que não é exceção', () => {
    const ex = [
      {
        itemId: 11,
        grupoId: null,
        setorId: null,
        categoriaAcomodacaoId: 7,
        efeito: 'descaracteriza' as const,
      },
    ];
    expect(partilharItens([item(1, 11, 5)], limite3, ex, 7).get(1)).toEqual({
      classe: 'descaracteriza',
      quantidadeInclusa: 0,
    });
    expect(partilharItens([item(1, 11, 5)], limite3, ex, 8).get(1)!.quantidadeInclusa).toBe(3);
    expect(partilharItens([item(1, 12, 5)], [], [], null).get(1)).toEqual({
      classe: 'incluso',
      quantidadeInclusa: 5,
    });
    expect(
      partilharItens([item(1, 11, 0.5)], [{ ...limite3[0]!, quantidadeLimite: null }], [], null).get(1)!
        .quantidadeInclusa,
    ).toBe(0.5);
  });
  it('diárias já lançadas pela apuração reduzem a proposta; todas lançadas: sem proposta', () => {
    const ad = { itemId: 44, valor: 150 };
    expect(alertasDoPacote([], new Map(), [], 5, 2, ad, 1)[0]).toEqual({
      tipo: 'diarias',
      descaracteriza: false,
      mensagem: '1 de 3 diária(s) além das 2 incluídas: cobradas à parte a 150.00 cada.',
      proposta: { itemId: 44, quantidade: 2, valorUnitario: 150 },
    });
    expect(alertasDoPacote([], new Map(), [], 5, 2, ad, 3)[0]).toEqual({
      tipo: 'diarias',
      descaracteriza: false,
      mensagem: '3 diária(s) além das 2 incluídas: já lançada(s) à parte a 150.00 cada.',
    });
  });
});

describe('horário especial: urgência, mesmo ato e anestesia (linha 17, 3ª volta)', () => {
  const quando = '2026-01-20T23:00'; // terça, 23h
  it('faixa só de urgência vale no atendimento urgente e não no eletivo', () => {
    const urg = faixa({ id: 7, codigo: 'U', exigeUrgencia: true, percentual: 30 });
    expect(faixaDoHorario({ quando, feriado: false, fontePagadoraId: 1, urgencia: true }, [urg])?.id).toBe(7);
    expect(faixaDoHorario({ quando, feriado: false, fontePagadoraId: 1, urgencia: false }, [urg])).toBeNull();
    expect(faixaDoHorario({ quando, feriado: false, fontePagadoraId: 1 }, [urg])).toBeNull();
    // A faixa sem a exigência vale nos dois; sem acúmulo, vence a de maior percentual.
    const geral = faixa({ id: 8, codigo: 'G', percentual: 20 });
    expect(
      faixaDoHorario({ quando, feriado: false, fontePagadoraId: 1, urgencia: true }, [urg, geral])?.id,
    ).toBe(7);
    expect(faixaDoHorario({ quando, feriado: false, fontePagadoraId: 1 }, [urg, geral])?.id).toBe(8);
  });
  it('mesmo ato: o acoplado segue a faixa do principal só quando ela replica', () => {
    const replica = faixa({ id: 1, aplicaProcedimentosVinculados: true });
    const naoReplica = faixa({ id: 2, aplicaProcedimentosVinculados: false });
    const outra = faixa({ id: 3, percentual: 50 });
    const r = faixasDoAto([
      { id: 10, principalId: null, faixa: replica },
      { id: 11, principalId: 10, faixa: null },
      { id: 12, principalId: 10, faixa: outra },
      { id: 20, principalId: null, faixa: naoReplica },
      { id: 21, principalId: 20, faixa: null },
      { id: 30, principalId: null, faixa: null },
      { id: 31, principalId: 30, faixa: outra },
      { id: 40, principalId: 999, faixa: null },
    ]);
    expect(r.get(10)?.id).toBe(1);
    expect(r.get(11)?.id).toBe(1);
    expect(r.get(12)?.id).toBe(1);
    expect(r.get(21)).toBeNull();
    expect(r.get(31)?.id).toBe(3);
    expect(r.get(40)).toBeNull();
  });
  it('anestesia pela função na equipe ou pelo grau TISS 06/07', () => {
    expect(itemDeAnestesia('anestesista', null)).toBe(true);
    expect(itemDeAnestesia('outro', '06')).toBe(true);
    expect(itemDeAnestesia(null, '07')).toBe(true);
    expect(itemDeAnestesia('cirurgiao', '00')).toBe(false);
    expect(itemDeAnestesia(null, null)).toBe(false);
    const f = faixa({ percentual: 30, percentualAnestesia: 50 });
    expect(acrescimoDoItem(100, { honorario: 0, anestesia: itemDeAnestesia('outro', '06') }, f)).toBe(50);
    expect(acrescimoDoItem(100, { honorario: 0, anestesia: itemDeAnestesia('cirurgiao', '00') }, f)).toBe(30);
  });
});
