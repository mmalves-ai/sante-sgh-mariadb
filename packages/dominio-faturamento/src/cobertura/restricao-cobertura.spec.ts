import { describe, expect, it } from 'vitest';
import {
  avaliarCobertura,
  criterioBate,
  diaDaSemanaCobertura,
  type LancamentoCobertura,
  type ParCompatibilidade,
  paresAplicaveis,
  type RestricaoCobertura,
  tipoAtendimentoDaNatureza,
  validarExcecaoCobertura,
  validarParCompatibilidade,
  validarRestricaoCobertura,
} from './restricao-cobertura.js';

const lanc = (x: Partial<LancamentoCobertura> = {}): LancamentoCobertura => ({
  contexto: 'lancamento',
  estabelecimentoId: 1,
  fontePagadoraId: 10,
  planoId: 20,
  itemId: 100,
  grupoId: 5,
  tabelaId: 7,
  data: '2026-11-25',
  hora: '10:00',
  setorId: 3,
  idade: 40,
  profissionalId: 9,
  empresaId: null,
  tipoAtendimento: 'ambulatorial',
  quantidade: 1,
  valorTotal: 100,
  autorizado: false,
  justificado: false,
  anteriores: {},
  naConta: [],
  ...x,
});

const restr = (x: Partial<RestricaoCobertura> = {}): RestricaoCobertura => ({
  id: 1,
  descricao: 'Exame não coberto',
  estabelecimentoId: null,
  fontePagadoraId: 10,
  planoId: null,
  itemId: 100,
  grupoId: null,
  tabelaId: null,
  tipo: 'nao_coberto',
  acao: 'bloquear',
  tipoAtendimento: null,
  valorLimite: null,
  quantidadeLimite: null,
  mensagem: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  criterios: [],
  ...x,
});

const par = (x: Partial<ParCompatibilidade> = {}): ParCompatibilidade => ({
  id: 50,
  fontePagadoraId: null,
  itemId: 100,
  relacionadoId: 200,
  tipo: 'incompativel',
  exigeItem: false,
  quantidadeLimite: null,
  validadeDias: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});

describe('restrição de cobertura por fonte pagadora', () => {
  it('bloqueia o item não coberto da fonte e ignora outra fonte, plano diferente e fora da vigência', () => {
    expect(avaliarCobertura(lanc(), [restr()], [], []).situacao).toBe('bloqueio');
    expect(avaliarCobertura(lanc(), [restr({ fontePagadoraId: 11 })], [], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc(), [restr({ planoId: 21 })], [], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc(), [restr({ vigenciaFim: '2026-06-30' })], [], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc(), [restr({ ativo: false })], [], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc(), [restr({ estabelecimentoId: 2 })], [], []).situacao).toBe('livre');
  });

  it('alcança pelo grupo e pela tabela, e a ação alertar só avisa', () => {
    expect(avaliarCobertura(lanc(), [restr({ itemId: null, grupoId: 5 })], [], []).situacao).toBe('bloqueio');
    expect(avaliarCobertura(lanc(), [restr({ itemId: null, tabelaId: 7 })], [], []).situacao).toBe(
      'bloqueio',
    );
    expect(avaliarCobertura(lanc(), [restr({ acao: 'alertar' })], [], []).situacao).toBe('alerta');
    expect(avaliarCobertura(lanc(), [restr({ tipo: 'somente_aviso' })], [], []).situacao).toBe('alerta');
  });

  it('critérios se somam: setor, idade, horário que vira a meia-noite, dia da semana, profissional e tipo', () => {
    const l = lanc({ hora: '23:30' });
    expect(criterioBate({ tipo: 'setor', setorId: 3 }, l)).toBe(true);
    expect(criterioBate({ tipo: 'setor', setorId: 4 }, l)).toBe(false);
    expect(criterioBate({ tipo: 'faixa_idade', idadeMinima: 60 }, l)).toBe(false);
    expect(criterioBate({ tipo: 'faixa_idade', idadeMaxima: 40 }, l)).toBe(true);
    expect(criterioBate({ tipo: 'faixa_idade', idadeMinima: 0 }, lanc({ idade: null }))).toBe(false);
    expect(criterioBate({ tipo: 'horario', horaInicio: '22:00', horaFim: '06:00' }, l)).toBe(true);
    expect(criterioBate({ tipo: 'horario', horaInicio: '22:00', horaFim: '06:00' }, lanc())).toBe(false);
    expect(diaDaSemanaCobertura('2026-11-25')).toBe(4);
    expect(criterioBate({ tipo: 'horario', horaInicio: '00:00', horaFim: '23:59', diaSemana: 1 }, l)).toBe(
      false,
    );
    expect(criterioBate({ tipo: 'profissional', profissionalId: 9 }, l)).toBe(true);
    expect(criterioBate({ tipo: 'prestador', prestadorId: 4, prestadorProfissionalId: 9 }, l)).toBe(true);
    expect(criterioBate({ tipo: 'tipo_atendimento', tipoAtendimento: 'internacao' }, l)).toBe(false);
    const r = restr({
      criterios: [
        { tipo: 'setor', setorId: 3 },
        { tipo: 'faixa_idade', idadeMinima: 60 },
      ],
    });
    expect(avaliarCobertura(lanc(), [r], [], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc({ idade: 61 }), [r], [], []).situacao).toBe('bloqueio');
  });

  it('quantidade no período, limite de quantidade e de valor', () => {
    const porMes = restr({
      criterios: [{ tipo: 'quantidade_periodo', quantidadeMaxima: 2, periodo: 'mes' }],
    });
    expect(avaliarCobertura(lanc({ anteriores: { mes: 1 } }), [porMes], [], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc({ anteriores: { mes: 2 } }), [porMes], [], []).situacao).toBe('bloqueio');
    const qtd = restr({ tipo: 'limite_quantidade', quantidadeLimite: 3 });
    expect(avaliarCobertura(lanc({ quantidade: 3 }), [qtd], [], []).situacao).toBe('livre');
    expect(
      avaliarCobertura(lanc({ quantidade: 2, anteriores: { atendimento: 2 } }), [qtd], [], []).situacao,
    ).toBe('bloqueio');
    const val = restr({ tipo: 'limite_valor', valorLimite: 500 });
    expect(avaliarCobertura(lanc({ valorTotal: 500 }), [val], [], []).situacao).toBe('livre');
    const r = avaliarCobertura(lanc({ valorTotal: 800 }), [val], [], []);
    expect(r.situacao).toBe('bloqueio');
    expect(r.achados[0]?.motivo).toContain('800.00');
  });

  it('exige autorização e justificativa: passa quando o lançamento as traz', () => {
    const aut = restr({ tipo: 'exige_autorizacao' });
    expect(avaliarCobertura(lanc(), [aut], [], []).situacao).toBe('bloqueio');
    expect(avaliarCobertura(lanc({ autorizado: true }), [aut], [], []).situacao).toBe('livre');
    const jus = restr({ tipo: 'exige_justificativa' });
    expect(avaliarCobertura(lanc({ justificado: true }), [jus], [], []).situacao).toBe('livre');
  });

  it('a exceção do atendimento libera o bloqueio, respeitando tipo de atendimento e quantidade', () => {
    const ex = {
      id: 77,
      restricaoId: 1,
      itemId: 100,
      grupoId: null,
      quantidadeAutorizada: 2,
      tiposAtendimento: ['ambulatorial' as const],
    };
    const r = avaliarCobertura(lanc(), [restr()], [ex], []);
    expect(r.situacao).toBe('livre');
    expect(r.achados[0]).toMatchObject({ efeito: 'liberado', excecaoId: 77 });
    expect(avaliarCobertura(lanc({ quantidade: 3 }), [restr()], [ex], []).situacao).toBe('bloqueio');
    expect(avaliarCobertura(lanc({ tipoAtendimento: 'internacao' }), [restr()], [ex], []).situacao).toBe(
      'bloqueio',
    );
    const avulsa = { ...ex, restricaoId: null, itemId: null, grupoId: 5, quantidadeAutorizada: null };
    expect(avaliarCobertura(lanc(), [restr()], [avulsa], []).situacao).toBe('livre');
    expect(avaliarCobertura(lanc(), [restr()], [{ ...ex, restricaoId: 2 }], []).situacao).toBe('bloqueio');
  });

  it('na prescrição o bloqueio vira alerta (não impede o ato assistencial)', () => {
    const r = avaliarCobertura(lanc({ contexto: 'prescricao' }), [restr()], [], [par()]);
    expect(r.situacao).toBe('alerta');
    expect(
      avaliarCobertura(
        lanc({ contexto: 'prescricao', naConta: [{ itemId: 200, data: '2026-11-25', quantidade: 1 }] }),
        [],
        [],
        [par()],
      ).achados.every((a) => a.efeito === 'alerta'),
    ).toBe(true);
  });

  it('natureza da conta vira tipo de atendimento', () => {
    expect(tipoAtendimentoDaNatureza('pronto_atendimento')).toBe('urgencia');
    expect(tipoAtendimentoDaNatureza('internacao')).toBe('internacao');
    expect(tipoAtendimentoDaNatureza('outro')).toBe('ambulatorial');
  });
});

describe('compatibilidade entre procedimentos', () => {
  const ja = (itemId: number, data = '2026-11-25', quantidade = 1) => ({ itemId, data, quantidade });

  it('incompatível bloqueia nos dois sentidos e respeita a janela em dias', () => {
    expect(avaliarCobertura(lanc({ naConta: [ja(200)] }), [], [], [par()]).situacao).toBe('bloqueio');
    expect(avaliarCobertura(lanc({ itemId: 200, naConta: [ja(100)] }), [], [], [par()]).situacao).toBe(
      'bloqueio',
    );
    expect(
      avaliarCobertura(lanc({ naConta: [ja(200, '2026-11-01')] }), [], [], [par({ validadeDias: 7 })])
        .situacao,
    ).toBe('livre');
    expect(avaliarCobertura(lanc({ naConta: [ja(300)] }), [], [], [par()]).situacao).toBe('livre');
  });

  it('exige o relacionado: alerta enquanto ele falta; quantidade limite do par bloqueia o excesso', () => {
    const exige = par({ tipo: 'associado', exigeItem: true });
    expect(avaliarCobertura(lanc(), [], [], [exige]).situacao).toBe('alerta');
    expect(avaliarCobertura(lanc({ naConta: [ja(200)] }), [], [], [exige]).situacao).toBe('livre');
    const lim = par({ tipo: 'compativel', quantidadeLimite: 2 });
    expect(avaliarCobertura(lanc({ naConta: [ja(200), ja(100)] }), [], [], [lim]).situacao).toBe('livre');
    expect(
      avaliarCobertura(lanc({ naConta: [ja(200), ja(100, '2026-11-25', 2)] }), [], [], [lim]).situacao,
    ).toBe('bloqueio');
  });

  it('a regra da fonte prevalece sobre a geral do mesmo par', () => {
    const geral = par({ id: 1 });
    const daFonte = par({ id: 2, fontePagadoraId: 10 });
    const outra = par({ id: 3, fontePagadoraId: 11 });
    expect(paresAplicaveis([geral, daFonte, outra], 100, 10, '2026-11-25').map((p) => p.id)).toEqual([2]);
    expect(paresAplicaveis([geral, outra], 100, 10, '2026-11-25').map((p) => p.id)).toEqual([1]);
  });
});

describe('validação do cadastro', () => {
  const base = {
    descricao: 'X',
    fontePagadoraId: 10,
    itemId: 100,
    grupoId: null,
    tabelaId: null,
    tipo: 'nao_coberto',
    acao: 'bloquear',
    valorLimite: null,
    quantidadeLimite: null,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    criterios: [],
  };
  it('restrição: alvo, limites, vigência e critérios', () => {
    expect(validarRestricaoCobertura(base)).toEqual({});
    const e = validarRestricaoCobertura({
      ...base,
      itemId: null,
      tipo: 'limite_valor',
      vigenciaFim: '2025-01-01',
      criterios: [{ tipo: 'faixa_idade', idadeMinima: 50, idadeMaxima: 10 }, { tipo: 'prestador' }],
    });
    expect(Object.keys(e).sort()).toEqual([
      'criterios.0',
      'criterios.1',
      'itemId',
      'valorLimite',
      'vigenciaFim',
    ]);
  });
  it('par e exceção', () => {
    expect(
      Object.keys(
        validarParCompatibilidade({
          itemId: 1,
          relacionadoId: 1,
          tipo: 'x',
          quantidadeLimite: 0,
          validadeDias: -1,
          vigenciaInicio: '',
          vigenciaFim: null,
        }),
      ).sort(),
    ).toEqual(['quantidadeLimite', 'relacionadoId', 'tipo', 'validadeDias', 'vigenciaInicio']);
    expect(
      Object.keys(
        validarExcecaoCobertura({
          itemId: null,
          grupoId: null,
          justificativaId: null,
          observacao: null,
          quantidadeAutorizada: 0,
          tiposAtendimento: [],
        }),
      ).sort(),
    ).toEqual(['itemId', 'justificativaId', 'quantidadeAutorizada', 'tiposAtendimento']);
  });
});
