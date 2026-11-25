// Homologação do fornecedor por questionário pontuado (09-AREA linha 66): o questionário com pesos e opções, a nota
// ponderada com as parcelas, a eliminatória, a faixa e a situação, a validade (requalificação), o ranking, a exceção com
// segregação e o cancelamento com motivo.
import { describe, expect, it } from 'vitest';
import {
  calcularNotaHomologacao,
  classificarHomologacao,
  conferirCancelamentoHomologacao,
  conferirExcecaoHomologacao,
  conferirFornecedorDaCategoria,
  conferirQuestionarioHomologacao,
  type FaixaHomologacao,
  faixaDaNotaHomologacao,
  type HomologacaoResumo,
  opcoesDaPergunta,
  type PerguntaHomologacao,
  type QuestionarioHomologacaoEntrada,
  rankingHomologacao,
  situacaoNaDataHomologacao,
  validadeHomologacao,
} from './index.js';

const ESCALA = [
  { ordem: 1, texto: 'Não atende', pontos: 0 },
  { ordem: 2, texto: 'Atende parcialmente', pontos: 5 },
  { ordem: 3, texto: 'Atende plenamente', pontos: 10 },
];

const Q: QuestionarioHomologacaoEntrada = {
  codigo: 'MED-2026',
  descricao: 'Fornecedores de medicamentos',
  categoria: null,
  notaMinima: 70,
  validadeMeses: 12,
  instrucoes: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  perguntas: [
    {
      identificador: 'AFE',
      texto: 'Tem autorização de funcionamento da vigilância sanitária vigente?',
      peso: 3,
      tipoResposta: 'sim_nao',
      opcoes: [],
      obrigatoria: true,
      eliminatoria: true,
    },
    {
      identificador: 'PRAZO',
      texto: 'Cumprimento de prazo de entrega',
      peso: 2,
      tipoResposta: 'escala',
      opcoes: ESCALA,
      obrigatoria: true,
      eliminatoria: false,
    },
    {
      identificador: 'ISO',
      texto: 'Certificação de qualidade',
      peso: 1,
      tipoResposta: 'multipla_escolha',
      opcoes: ESCALA,
      obrigatoria: false,
      eliminatoria: false,
    },
    {
      identificador: null,
      texto: 'Observações da visita',
      peso: 1,
      tipoResposta: 'texto',
      opcoes: [],
      obrigatoria: false,
      eliminatoria: false,
    },
  ],
};

const PERGUNTAS: PerguntaHomologacao[] = Q.perguntas.map((p, i) => ({ ...p, id: 100 + i, sequencia: i + 1 }));

const FAIXAS: FaixaHomologacao[] = [
  { id: 1, codigo: 'R', descricao: 'Reprovado', notaInicial: 0, notaFinal: 59.9999, resultado: 'reprovado' },
  {
    id: 2,
    codigo: 'C',
    descricao: 'Regular',
    notaInicial: 60,
    notaFinal: 80,
    resultado: 'aprovado_restricao',
  },
  { id: 3, codigo: 'B', descricao: 'Ótimo', notaInicial: 80, notaFinal: 100, resultado: 'aprovado' },
];

describe('questionário de homologação', () => {
  it('aceita o questionário bem formado', () => {
    expect(conferirQuestionarioHomologacao(Q)).toEqual([]);
  });

  it('recusa nota mínima, validade, vigência, peso, opções e eliminatória de texto livre', () => {
    const r = conferirQuestionarioHomologacao({
      ...Q,
      codigo: 'código com espaço',
      notaMinima: 120,
      validadeMeses: 0,
      vigenciaFim: '2025-12-31',
      perguntas: [
        { ...Q.perguntas[1]!, peso: 0, opcoes: [{ ordem: 1, texto: 'Só uma', pontos: 5 }] },
        { ...Q.perguntas[3]!, eliminatoria: true },
        { ...Q.perguntas[2]!, opcoes: [ESCALA[0]!, { ...ESCALA[0]!, ordem: 2 }] },
      ],
    }).map((x) => x.codigo);
    expect(r).toEqual(
      expect.arrayContaining([
        'questionario-codigo',
        'questionario-nota-minima',
        'questionario-validade',
        'questionario-vigencia',
        'pergunta-peso',
        'pergunta-opcoes',
        'pergunta-eliminatoria',
      ]),
    );
  });

  it('recusa questionário só com texto livre e identificador repetido', () => {
    const r = conferirQuestionarioHomologacao({
      ...Q,
      perguntas: [
        { ...Q.perguntas[3]!, identificador: 'X' },
        { ...Q.perguntas[3]!, identificador: 'x' },
      ],
    }).map((x) => x.codigo);
    expect(r).toEqual(expect.arrayContaining(['questionario-perguntas', 'pergunta-identificador']));
    expect(conferirQuestionarioHomologacao({ ...Q, perguntas: [] }).map((x) => x.codigo)).toEqual([
      'questionario-perguntas',
    ]);
  });

  it('a eliminatória precisa de opções com pontos diferentes; sim/não é fixo; opções ordenadas', () => {
    const r = conferirQuestionarioHomologacao({
      ...Q,
      perguntas: [
        {
          ...Q.perguntas[1]!,
          eliminatoria: true,
          opcoes: [
            { ordem: 1, texto: 'A', pontos: 5 },
            { ordem: 2, texto: 'B', pontos: 5 },
          ],
        },
      ],
    }).map((x) => x.codigo);
    expect(r).toContain('pergunta-eliminatoria');
    expect(opcoesDaPergunta({ tipoResposta: 'sim_nao', opcoes: [] }).map((o) => o.pontos)).toEqual([10, 0]);
    expect(opcoesDaPergunta({ tipoResposta: 'texto', opcoes: ESCALA })).toEqual([]);
    expect(
      opcoesDaPergunta({ tipoResposta: 'escala', opcoes: [ESCALA[2]!, ESCALA[0]!] }).map((o) => o.ordem),
    ).toEqual([1, 3]);
  });
});

describe('nota ponderada', () => {
  it('soma peso × pontos ÷ máximo sobre os pesos respondidos, com as parcelas; o opcional sem resposta sai', () => {
    const { recusas, nota } = calcularNotaHomologacao(PERGUNTAS, [
      { pergunta: 100, opcao: 1, texto: null },
      { pergunta: 101, opcao: 2, texto: 'atrasou duas vezes' },
      { pergunta: 103, opcao: null, texto: 'Visita feita' },
    ]);
    expect(recusas).toEqual([]);
    // (3 × 10/10 + 2 × 5/10) ÷ (3 + 2) × 100 = 4 ÷ 5 × 100 = 80.
    expect(nota!.nota).toBe(80);
    expect(nota!.pesoConsiderado).toBe(5);
    expect(nota!.eliminatorias).toEqual([]);
    expect(nota!.parcelas).toContain('Pergunta 3 (ISO): sem resposta (opcional), fora da conta');
    expect(nota!.parcelas.at(-1)).toBe('Nota = 100 × 4 ÷ 5 = 80');
    expect(nota!.respostas.map((r) => [r.sequencia, r.resposta, r.atende, r.pontuacao, r.peso])).toEqual([
      [1, 'Sim', true, 10, 3],
      [2, 'Atende parcialmente — atrasou duas vezes', null, 5, 2],
      [4, 'Visita feita', null, 0, 1],
    ]);
  });

  it('a eliminatória com a menor pontuação fica marcada; a nota sai com 4 casas', () => {
    const { nota } = calcularNotaHomologacao(PERGUNTAS, [
      { pergunta: 100, opcao: 2, texto: null },
      { pergunta: 101, opcao: 3, texto: null },
      { pergunta: 102, opcao: 2, texto: null },
    ]);
    // (0 + 2 + 0,5) ÷ 6 × 100 = 41,6667.
    expect(nota!.nota).toBe(41.6667);
    expect(nota!.eliminatorias).toEqual([
      'Pergunta 1 (AFE): Tem autorização de funcionamento da vigilância sanitária vigente?',
    ]);
    expect(nota!.respostas[0]!.atende).toBe(false);
  });

  it('recusa obrigatória sem resposta, opção inexistente, pergunta alheia e repetida', () => {
    const r = calcularNotaHomologacao(PERGUNTAS, [
      { pergunta: 101, opcao: 9, texto: null },
      { pergunta: 999, opcao: 1, texto: null },
      { pergunta: 102, opcao: 1, texto: null },
      { pergunta: 102, opcao: 2, texto: null },
    ]);
    expect(r.nota).toBeNull();
    expect(r.recusas.map((x) => x.codigo)).toEqual([
      'resposta-pergunta',
      'resposta-pergunta',
      'resposta-obrigatoria',
      'resposta-opcao',
    ]);
  });

  it('recusa avaliação sem nenhuma pergunta pontuada respondida', () => {
    const so = PERGUNTAS.filter((p) => !p.obrigatoria);
    expect(calcularNotaHomologacao(so, []).recusas.map((x) => x.codigo)).toEqual(['resposta-obrigatoria']);
  });
});

describe('classificação, validade e ranking', () => {
  it('faixa pela nota (no limite comum vale a de cima) e situação pela mínima, eliminatória e faixa', () => {
    expect(faixaDaNotaHomologacao(80, FAIXAS)?.codigo).toBe('B');
    expect(faixaDaNotaHomologacao(65, FAIXAS)?.codigo).toBe('C');
    expect(faixaDaNotaHomologacao(101, FAIXAS)).toBeNull();
    const ok = classificarHomologacao({ nota: 85, eliminatorias: [] }, 70, FAIXAS);
    expect(ok).toMatchObject({ situacao: 'homologado', comRestricao: false, motivos: [] });
    const restricao = classificarHomologacao({ nota: 72, eliminatorias: [] }, 70, FAIXAS);
    expect(restricao).toMatchObject({ situacao: 'homologado', comRestricao: true });
    const abaixo = classificarHomologacao({ nota: 65, eliminatorias: [] }, 70, FAIXAS);
    expect(abaixo.situacao).toBe('reprovado');
    expect(abaixo.motivos).toEqual(['Nota 65 abaixo da mínima 70.']);
    const elim = classificarHomologacao({ nota: 90, eliminatorias: ['Pergunta 1: AFE'] }, 70, FAIXAS);
    expect(elim).toMatchObject({ situacao: 'reprovado', comRestricao: false });
    const faixaReprova = classificarHomologacao({ nota: 50, eliminatorias: [] }, 40, FAIXAS);
    expect(faixaReprova.motivos).toEqual(['Faixa Reprovado reprova.']);
  });

  it('validade em meses (fim do mês quando falta o dia) e situação na data', () => {
    expect(validadeHomologacao('2026-01-31', 1)).toBe('2026-02-28');
    expect(validadeHomologacao('2026-11-25 10:00:00', 12)).toBe('2027-11-25');
    expect(validadeHomologacao('2026-03-15', 24)).toBe('2028-03-15');
    expect(
      situacaoNaDataHomologacao({ situacao: 'homologado', validoAte: '2026-11-24' }, '2026-11-25'),
    ).toEqual({
      situacao: 'vencido',
      requalificar: true,
    });
    expect(
      situacaoNaDataHomologacao({ situacao: 'homologado', validoAte: '2026-12-20' }, '2026-11-25'),
    ).toEqual({
      situacao: 'homologado',
      requalificar: true,
    });
    expect(
      situacaoNaDataHomologacao({ situacao: 'homologado', validoAte: '2027-06-01' }, '2026-11-25'),
    ).toEqual({
      situacao: 'homologado',
      requalificar: false,
    });
    expect(situacaoNaDataHomologacao({ situacao: 'reprovado', validoAte: null }, '2026-11-25').situacao).toBe(
      'reprovado',
    );
  });

  it('ranking: a mais recente de cada fornecedor, homologados (pela nota, exceção depois), vencidos e reprovados', () => {
    const h = (o: Partial<HomologacaoResumo> & { id: number; fornecedor: number }): HomologacaoResumo => ({
      fornecedorNome: `Fornecedor ${o.fornecedor}`,
      questionario: 1,
      situacao: 'homologado',
      nota: 80,
      excecao: false,
      avaliadoEm: '2026-06-01 10:00:00',
      validoAte: '2027-06-01',
      ...o,
    });
    const r = rankingHomologacao(
      [
        h({ id: 1, fornecedor: 1, nota: 70, avaliadoEm: '2025-01-01 10:00:00', validoAte: '2026-01-01' }),
        h({ id: 2, fornecedor: 1, nota: 95 }),
        h({ id: 3, fornecedor: 2, nota: 85 }),
        h({ id: 4, fornecedor: 3, nota: 60, situacao: 'homologado', excecao: true }),
        h({ id: 5, fornecedor: 4, nota: 99, validoAte: '2026-10-01' }),
        h({ id: 6, fornecedor: 5, nota: 40, situacao: 'reprovado', validoAte: null }),
        h({ id: 7, fornecedor: 6, nota: 100, situacao: 'cancelado' }),
        h({ id: 8, fornecedor: 7, nota: 100, questionario: 2 }),
      ],
      1,
      '2026-11-25',
    );
    expect(r.map((x) => [x.posicao, x.id, x.situacaoNaData])).toEqual([
      [1, 2, 'homologado'],
      [2, 3, 'homologado'],
      [3, 4, 'homologado'],
      [4, 5, 'vencido'],
      [5, 6, 'reprovado'],
    ]);
  });
});

describe('exceção e cancelamento', () => {
  const reprovada = { situacao: 'reprovado' as const, avaliador: 7, excecao: false };
  const just = 'Único fornecedor do item na região; plano de ação com prazo de 90 dias.';

  it('aceita a exceção justificada por outra pessoa sobre a reprovada', () => {
    expect(conferirExcecaoHomologacao(reprovada, 8, just)).toEqual([]);
  });

  it('recusa o próprio avaliador, a justificativa curta e a homologação que não está reprovada', () => {
    expect(conferirExcecaoHomologacao(reprovada, 7, just).map((x) => x.codigo)).toEqual([
      'excecao-segregacao',
    ]);
    expect(conferirExcecaoHomologacao(reprovada, 8, 'curta').map((x) => x.codigo)).toEqual([
      'excecao-justificativa',
    ]);
    expect(
      conferirExcecaoHomologacao({ ...reprovada, situacao: 'homologado' }, 8, just).map((x) => x.codigo),
    ).toEqual(['excecao-situacao']);
    expect(conferirExcecaoHomologacao({ ...reprovada, excecao: true }, 8, just).map((x) => x.codigo)).toEqual(
      ['excecao-situacao'],
    );
  });

  it('cancelamento com motivo; a cancelada não se cancela de novo', () => {
    expect(conferirCancelamentoHomologacao('homologado', 'Avaliação lançada no fornecedor errado')).toEqual(
      [],
    );
    expect(conferirCancelamentoHomologacao('homologado', 'curto').map((x) => x.codigo)).toEqual([
      'cancelamento-motivo',
    ]);
    expect(
      conferirCancelamentoHomologacao('cancelado', 'Avaliação lançada no fornecedor errado').map(
        (x) => x.codigo,
      ),
    ).toEqual(['homologacao-cancelada']);
  });

  it('o questionário de categoria só avalia quem fornece a categoria; o sem categoria vale para todos', () => {
    expect(conferirFornecedorDaCategoria(null, [])).toEqual([]);
    expect(conferirFornecedorDaCategoria(4, [2, 4])).toEqual([]);
    const r = conferirFornecedorDaCategoria(4, [2]);
    expect(r.map((x) => [x.codigo, x.campos])).toEqual([['fornecedor-fora-categoria', ['fornecedor']]]);
    expect(conferirFornecedorDaCategoria(4, []).map((x) => x.codigo)).toEqual(['fornecedor-fora-categoria']);
  });
});
