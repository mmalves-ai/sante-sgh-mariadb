// C2-102 (08-SGO L115): promoção da saúde e gestão de crônicos (RN ANS 264 e 265/2011).
import { describe, expect, it } from 'vitest';
import {
  adesaoAsAtividades,
  agendaDeVisitas,
  avaliarElegibilidadePrograma,
  classificarRisco,
  type CriterioElegibilidade,
  custoDoParticipante,
  direitoABonificacao,
  idadeNoPrograma,
  inicioDaJanela,
  type PerfilElegibilidade,
  type PerguntaQuestionario,
  problemasDaBaixaDoContato,
  problemasDaBonificacao,
  problemasDaEntrada,
  problemasDaSaida,
  problemasDoContato,
  problemasDoCriterio,
  problemasDoPrograma,
  programaVigente,
  pontuarQuestionario,
} from './programa-saude.js';

const cods = (p: readonly { codigo: string }[]) => p.map((x) => x.codigo);
const crit = (c: Partial<CriterioElegibilidade>): CriterioElegibilidade => ({
  tipo: 'cid',
  termo: null,
  grupoPatologia: null,
  ocorrenciasMinimas: null,
  periodoMeses: 12,
  idadeMinima: null,
  idadeMaxima: null,
  custoMensalMinimo: null,
  custoPeriodoMinimo: null,
  escoreMinimo: null,
  formaAlerta: 'sugerir',
  ativo: true,
  ...c,
});
const perfil = (p: Partial<PerfilElegibilidade>): PerfilElegibilidade => ({
  idade: 50,
  ocorrencias: {},
  internacoes: 0,
  prontoSocorro: 0,
  custoPeriodo: 0,
  meses: 12,
  escore: null,
  ...p,
});
const programa = {
  codigo: 'DIAB',
  nome: 'Cuidado do diabético',
  tipo: 'gestao_cronicos',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  registradoAns: false,
  numeroRegistroAns: null,
  situacao: 'ativo',
};

describe('programa de saúde', () => {
  it('aceita o programa completo e exige o número quando registrado na ANS', () => {
    expect(problemasDoPrograma(programa)).toEqual([]);
    expect(cods(problemasDoPrograma({ ...programa, registradoAns: true }))).toEqual([
      'programa-registro-ans',
    ]);
    expect(cods(problemasDoPrograma({ ...programa, tipo: 'x', vigenciaFim: '2025-01-01' }))).toEqual([
      'programa-tipo',
      'programa-vigencia',
    ]);
  });
  it('vigente só ativo e dentro das datas', () => {
    expect(programaVigente(programa, '2026-11-25')).toBe(true);
    expect(programaVigente({ ...programa, situacao: 'suspenso' }, '2026-11-25')).toBe(false);
    expect(programaVigente({ ...programa, vigenciaFim: '2026-06-30' }, '2026-11-25')).toBe(false);
  });
});

describe('critério e elegibilidade', () => {
  it('valida cada tipo de critério', () => {
    expect(cods(problemasDoCriterio(crit({})))).toEqual(['criterio-termo']);
    expect(problemasDoCriterio(crit({ grupoPatologia: 3 }))).toEqual([]);
    expect(cods(problemasDoCriterio(crit({ tipo: 'idade', periodoMeses: null })))).toEqual([
      'criterio-idade',
    ]);
    expect(cods(problemasDoCriterio(crit({ tipo: 'idade', idadeMinima: 60, idadeMaxima: 40 })))).toEqual([
      'criterio-idade',
    ]);
    expect(cods(problemasDoCriterio(crit({ tipo: 'custo', periodoMeses: null })))).toEqual([
      'criterio-custo',
      'criterio-periodo',
    ]);
    expect(cods(problemasDoCriterio(crit({ tipo: 'escore' })))).toEqual(['criterio-escore']);
  });
  it('CID com ocorrências mínimas na janela elege e diz o motivo', () => {
    const c = [crit({ termo: 7, ocorrenciasMinimas: 2 })];
    expect(avaliarElegibilidadePrograma(c, perfil({ ocorrencias: { 'cid:7': 1 } })).elegivel).toBe(false);
    const r = avaliarElegibilidadePrograma(c, perfil({ ocorrencias: { 'cid:7': 3 } }));
    expect(r).toEqual({ elegivel: true, motivos: ['diagnóstico em 3 conta(s)'], forma: 'sugerir' });
    expect(avaliarElegibilidadePrograma(c, perfil({ ocorrencias: { 'cid:8': 3 } })).elegivel).toBe(false);
  });
  it('grupo de doenças conta pelo grupo', () => {
    const c = [crit({ grupoPatologia: 4 })];
    expect(avaliarElegibilidadePrograma(c, perfil({ ocorrencias: { 'grupo:4': 1 } })).elegivel).toBe(true);
  });
  it('a idade é recorte; os demais são gatilhos (basta um) e a forma mais forte vence', () => {
    const c = [
      crit({ tipo: 'idade', idadeMinima: 60 }),
      crit({ tipo: 'internacao', ocorrenciasMinimas: 2 }),
      crit({ tipo: 'custo', custoPeriodoMinimo: 10000, formaAlerta: 'incluir_automaticamente' }),
    ];
    expect(avaliarElegibilidadePrograma(c, perfil({ idade: 59, internacoes: 3 })).elegivel).toBe(false);
    expect(avaliarElegibilidadePrograma(c, perfil({ idade: 70 })).elegivel).toBe(false);
    const r = avaliarElegibilidadePrograma(c, perfil({ idade: 70, internacoes: 2, custoPeriodo: 12000 }));
    expect(r.elegivel).toBe(true);
    expect(r.forma).toBe('incluir_automaticamente');
    expect(r.motivos).toHaveLength(3);
  });
  it('só idade: o recorte elege; critério inativo não conta; sem critério ninguém é elegível', () => {
    expect(
      avaliarElegibilidadePrograma([crit({ tipo: 'idade', idadeMaxima: 12 })], perfil({ idade: 8 })).elegivel,
    ).toBe(true);
    expect(
      avaliarElegibilidadePrograma(
        [crit({ termo: 7, ativo: false })],
        perfil({ ocorrencias: { 'cid:7': 9 } }),
      ).elegivel,
    ).toBe(false);
    expect(avaliarElegibilidadePrograma([], perfil({})).elegivel).toBe(false);
  });
  it('custo mensal pela média da janela e escore da avaliação', () => {
    expect(
      avaliarElegibilidadePrograma(
        [crit({ tipo: 'custo', custoMensalMinimo: 1000 })],
        perfil({ custoPeriodo: 11000 }),
      ).elegivel,
    ).toBe(false);
    expect(
      avaliarElegibilidadePrograma(
        [crit({ tipo: 'custo', custoMensalMinimo: 1000 })],
        perfil({ custoPeriodo: 12000 }),
      ).elegivel,
    ).toBe(true);
    expect(
      avaliarElegibilidadePrograma([crit({ tipo: 'escore', escoreMinimo: 5 })], perfil({ escore: 6 }))
        .elegivel,
    ).toBe(true);
    expect(
      avaliarElegibilidadePrograma([crit({ tipo: 'escore', escoreMinimo: 5 })], perfil({ escore: null }))
        .elegivel,
    ).toBe(false);
  });
  it('idade em anos completos e início da janela', () => {
    expect(idadeNoPrograma('1960-12-01', '2026-11-25')).toBe(65);
    expect(idadeNoPrograma('1960-11-25', '2026-11-25')).toBe(66);
    expect(idadeNoPrograma(null, '2026-11-25')).toBeNull();
    expect(inicioDaJanela('2026-11-25', 12)).toBe('2025-11-26');
  });
});

describe('participante', () => {
  const base = {
    programa,
    beneficiarioSituacao: 'ativo',
    entrada: '2026-11-01',
    hoje: '2026-11-25',
    participacaoAberta: false,
  };
  it('entra com o programa ativo, beneficiário ativo e sem participação aberta', () => {
    expect(problemasDaEntrada(base)).toEqual([]);
    expect(
      cods(
        problemasDaEntrada({
          ...base,
          programa: { ...programa, situacao: 'planejado' },
          beneficiarioSituacao: 'suspenso',
          participacaoAberta: true,
          entrada: '2026-12-01',
        }),
      ),
    ).toEqual(['entrada-futura', 'programa-inativo', 'beneficiario-inativo', 'participacao-aberta']);
    expect(cods(problemasDaEntrada({ ...base, entrada: '2025-12-01' }))).toEqual(['entrada-fora-vigencia']);
  });
  it('a saída exige motivo e data entre a entrada e hoje', () => {
    const s = {
      situacao: 'ativo',
      entrada: '2026-01-10',
      saida: '2026-11-20',
      motivo: 'alta_programa',
      hoje: '2026-11-25',
    };
    expect(problemasDaSaida(s)).toEqual([]);
    expect(cods(problemasDaSaida({ ...s, saida: '2026-01-01', motivo: 'x' }))).toEqual([
      'saida-motivo',
      'saida-antes-entrada',
    ]);
    expect(cods(problemasDaSaida({ ...s, situacao: 'encerrado' }))).toEqual(['participacao-encerrada']);
  });
});

describe('acompanhamento e agenda de visitas', () => {
  const agora = '2026-11-25T10:00:00';
  it('contato novo agendado no futuro ou realizado no passado', () => {
    expect(
      problemasDoContato(
        {
          tipo: 'visita_domiciliar',
          agendadoPara: '2026-11-30T09:00',
          realizadoEm: null,
          situacao: 'agendado',
        },
        agora,
      ),
    ).toEqual([]);
    expect(
      cods(
        problemasDoContato(
          { tipo: 'telefone', agendadoPara: '2026-11-01T09:00', realizadoEm: null, situacao: 'agendado' },
          agora,
        ),
      ),
    ).toEqual(['contato-agenda-passada']);
    expect(
      cods(
        problemasDoContato(
          { tipo: 'telefone', agendadoPara: null, realizadoEm: '2026-11-26T09:00', situacao: 'realizado' },
          agora,
        ),
      ),
    ).toEqual(['contato-realizado-futuro']);
    expect(
      cods(
        problemasDoContato(
          { tipo: 'x', agendadoPara: null, realizadoEm: null, situacao: 'cancelado' },
          agora,
        ),
      ),
    ).toEqual(['contato-tipo', 'contato-situacao']);
  });
  it('só o agendado recebe baixa', () => {
    expect(problemasDaBaixaDoContato('agendado', 'realizado', '2026-11-25T09:00', agora)).toEqual([]);
    expect(cods(problemasDaBaixaDoContato('agendado', 'realizado', null, agora))).toEqual([
      'contato-realizado',
    ]);
    expect(cods(problemasDaBaixaDoContato('realizado', 'cancelado', null, agora))).toEqual([
      'contato-transicao',
    ]);
  });
  it('separa atrasados, de hoje e próximos', () => {
    const a = agendaDeVisitas(
      [
        { id: 1, agendadoPara: '2026-11-20T08:00', situacao: 'agendado' },
        { id: 2, agendadoPara: '2026-11-25T15:00', situacao: 'agendado' },
        { id: 3, agendadoPara: '2026-12-02T08:00', situacao: 'agendado' },
        { id: 4, agendadoPara: '2026-11-19T08:00', situacao: 'realizado' },
      ],
      '2026-11-25',
    );
    expect([a.atrasados.map((x) => x.id), a.hoje.map((x) => x.id), a.proximos.map((x) => x.id)]).toEqual([
      [1],
      [2],
      [3],
    ]);
  });
});

describe('questionário de risco', () => {
  const perguntas: PerguntaQuestionario[] = [
    {
      id: 1,
      sequencia: 1,
      tipoResposta: 'sim_nao',
      obrigatoria: true,
      opcoes: [],
      respostaIndicativa: 'sim',
    },
    {
      id: 2,
      sequencia: 2,
      tipoResposta: 'escolha_unica',
      obrigatoria: true,
      opcoes: [
        { codigo: 'nunca', descricao: 'Nunca', pontos: 0 },
        { codigo: 'diario', descricao: 'Todo dia', pontos: 3 },
      ],
      respostaIndicativa: null,
    },
    { id: 3, sequencia: 3, tipoResposta: 'numero', obrigatoria: false, opcoes: [], respostaIndicativa: null },
  ];
  it('soma os pontos e classifica pela fração do máximo', () => {
    const r = pontuarQuestionario(
      perguntas,
      [
        { pergunta: 1, opcao: 'sim' },
        { pergunta: 2, opcao: 'diario' },
      ],
      false,
    );
    expect(r).toMatchObject({ escore: 4, maximo: 4, classificacao: 'muito_alto', problemas: [] });
    const b = pontuarQuestionario(
      perguntas,
      [
        { pergunta: 1, opcao: 'nao' },
        { pergunta: 2, opcao: 'nunca' },
        { pergunta: 3, numero: 82 },
      ],
      false,
    );
    expect(b).toMatchObject({ escore: 0, classificacao: 'baixo' });
  });
  it('recusa falta, opção inválida e pergunta de fora', () => {
    const r = pontuarQuestionario(
      perguntas,
      [
        { pergunta: 2, opcao: 'x' },
        { pergunta: 9, opcao: 'sim' },
      ],
      true,
    );
    expect(cods(r.problemas)).toEqual([
      'resposta-pergunta',
      'resposta-obrigatoria',
      'resposta-opcao',
      'resposta-obrigatoria',
    ]);
    expect(r.classificacao).toBeNull();
  });
  it('faixas da classificação', () => {
    expect([
      classificarRisco(1, 4),
      classificarRisco(2, 4),
      classificarRisco(3, 4),
      classificarRisco(4, 4),
      classificarRisco(0, 0),
    ]).toEqual(['baixo', 'moderado', 'alto', 'muito_alto', 'baixo']);
  });
});

describe('bonificação (RN ANS 265/2011)', () => {
  const regra = {
    codigo: 'DESC5',
    descricao: 'Desconto pela participação',
    tipoBeneficio: 'desconto_mensalidade',
    percentualDesconto: 5,
    valorBonus: null,
    adesaoMinimaPercentual: 75,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    ativo: true,
  };
  it('valida a regra', () => {
    expect(problemasDaBonificacao(regra)).toEqual([]);
    expect(cods(problemasDaBonificacao({ ...regra, percentualDesconto: null }))).toEqual([
      'bonificacao-valor',
    ]);
    expect(cods(problemasDaBonificacao({ ...regra, adesaoMinimaPercentual: 120 }))).toEqual([
      'bonificacao-adesao',
    ]);
  });
  it('adesão pelos contatos devidos e direito pela mínima', () => {
    const a = adesaoAsAtividades(
      [
        { situacao: 'realizado', agendadoPara: null },
        { situacao: 'realizado', agendadoPara: null },
        { situacao: 'realizado', agendadoPara: null },
        { situacao: 'nao_localizado', agendadoPara: '2026-10-01' },
        { situacao: 'agendado', agendadoPara: '2026-12-01' },
        { situacao: 'cancelado', agendadoPara: '2026-10-01' },
      ],
      '2026-11-25',
    );
    expect(a).toEqual({ realizados: 3, devidos: 4, percentual: 75 });
    expect(direitoABonificacao(regra, 75, '2026-11-25').direito).toBe(true);
    expect(direitoABonificacao(regra, 74.99, '2026-11-25').direito).toBe(false);
    expect(direitoABonificacao({ ...regra, vigenciaFim: '2026-06-30' }, 100, '2026-11-25').direito).toBe(
      false,
    );
    expect(direitoABonificacao(regra, null, '2026-11-25').direito).toBe(false);
  });
});

describe('custo do crônico', () => {
  it('média antes e depois da entrada com a variação', () => {
    const r = custoDoParticipante(
      [
        { competencia: '2025-12', valor: 3000 },
        { competencia: '2026-02', valor: 3000 },
        { competencia: '2026-03', valor: 1000 },
        { competencia: '2026-05', valor: 500 },
        { competencia: '2027-04', valor: 9999 },
      ],
      '2026-03-10',
      '2026-05-31',
      3,
    );
    expect(r).toEqual({
      antes: { total: 6000, meses: 3, media: 2000 },
      depois: { total: 1500, meses: 3, media: 500 },
      variacaoPercentual: -75,
    });
  });
  it('sem custo antes não há variação', () => {
    expect(
      custoDoParticipante([{ competencia: '2026-03', valor: 100 }], '2026-03-01', '2026-03-31', 6)
        .variacaoPercentual,
    ).toBeNull();
  });
});
