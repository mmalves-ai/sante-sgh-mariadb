// Construtor de formulários novos (M45, etapa 1): regra 14 (publicado imutável pelo content_hash; publicação só com
// casos verdes e aprovação de outra pessoa), regra 3 (total sempre calculado), regra 15 (valor nunca visto recusado),
// o plano de publicação no formato do formulário de origem e o registro-resumo. Dados sintéticos ("SINTETICO M45").
import type { CasoFormularioNovo, DefinicaoFormularioNovo, PerguntaFormularioNovo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarFormularioNovo,
  casosVerdes,
  executarCaso,
  executarCasos,
  valorParaRegra,
} from './avaliacao.js';
import {
  conferirAposentadoria,
  conferirDecisaoRevisao,
  conferirEnvioRevisao,
  conferirPublicacao,
  conferirSalvar,
  conteudoCanonicoFormularioNovo,
  contentHashFormularioNovo,
  ErroCicloFormularioNovo,
  proximaVersao,
  publicadoIntegro,
  type VersaoNoCiclo,
} from './ciclo.js';
import { conferirDefinicao, ordemDeCalculo, percorrerPerguntas } from './definicao.js';
import {
  codigoModeloDaVersao,
  CONSTANTES_DUBLE,
  contagemDoPlano,
  ErroPlanoPublicacao,
  type PerguntaBancoLegado,
  perguntaCompativel,
  planoDePublicacao,
  sugerirReuso,
  tipoDoTipoperg,
} from './plano.js';
import { blocosDoResumo, rtfDoResumo } from './resumo.js';
import { CONSTANTES_SINTETICAS } from './sintetico.js';

const P = (
  p: Partial<PerguntaFormularioNovo> & Pick<PerguntaFormularioNovo, 'linkId'>,
): PerguntaFormularioNovo => ({
  tipo: 'texto',
  titulo: `Pergunta ${p.linkId}`,
  obrigatorio: false,
  unidade: null,
  minimo: null,
  maximo: null,
  opcoes: [],
  habilitar: null,
  calcular: null,
  reuso: null,
  itens: [],
  ...p,
});

/** Escala sintética de duas perguntas pontuadas e o total calculado (forma de Braden/Morse). */
const DEF: DefinicaoFormularioNovo = {
  codigo: 'SGHESC',
  titulo: 'Escala sintética SINTETICO M45',
  tipoRegistro: 'evolucao',
  especialidades: [40, 12, 40],
  perguntas: [
    P({
      linkId: 'avaliacao',
      tipo: 'secao',
      titulo: 'Avaliação',
      itens: [
        P({
          linkId: 'mobilidade',
          tipo: 'escolha',
          titulo: 'Mobilidade',
          obrigatorio: true,
          opcoes: [
            { codigo: 'acamado', texto: 'Acamado', pontos: 1 },
            { codigo: 'limitada', texto: 'Limitada', pontos: 2 },
            { codigo: 'deambula', texto: 'Deambula', pontos: 4 },
          ],
        }),
        P({
          linkId: 'riscos',
          tipo: 'multipla',
          titulo: 'Fatores de risco',
          opcoes: [
            { codigo: 'umidade', texto: 'Umidade', pontos: 1 },
            { codigo: 'friccao', texto: 'Fricção', pontos: 2 },
          ],
        }),
        P({
          linkId: 'total',
          tipo: 'inteiro',
          titulo: 'Total',
          calcular: { '+': [{ var: 'mobilidade' }, { var: 'riscos' }] },
        }),
        P({
          linkId: 'conduta',
          tipo: 'texto-formatado',
          titulo: 'Conduta',
          habilitar: { '<=': [{ var: 'total' }, 3] },
        }),
        P({ linkId: 'peso', tipo: 'decimal', titulo: 'Peso', unidade: 'kg', minimo: 0.5, maximo: 400 }),
        P({ linkId: 'avaliado_em', tipo: 'data', titulo: 'Avaliado em' }),
      ],
    }),
  ],
};

const CASOS: CasoFormularioNovo[] = [
  {
    nome: 'acamado com fricção',
    respostas: { mobilidade: 'acamado', riscos: ['friccao'] },
    esperado: { total: 3 },
    habilitadasEsperadas: ['avaliacao', 'mobilidade', 'riscos', 'total', 'conduta', 'peso', 'avaliado_em'],
  },
  {
    nome: 'deambula',
    respostas: { mobilidade: 'deambula', riscos: [] },
    esperado: { total: 4 },
    habilitadasEsperadas: ['avaliacao', 'mobilidade', 'riscos', 'total', 'peso', 'avaliado_em'],
  },
];

const versao = (v: Partial<VersaoNoCiclo> = {}): VersaoNoCiclo => ({
  estado: 'revisao',
  definicao: DEF,
  casos: CASOS,
  autor: 'conta-a',
  autores: ['conta-a'],
  aprovadoPor: 'conta-b',
  contentHash: null,
  ...v,
});

const recusa = async (f: () => unknown | Promise<unknown>) => {
  try {
    await f();
  } catch (e) {
    if (e instanceof ErroCicloFormularioNovo) return e.codigo;
    throw e;
  }
  return 'aceito';
};

describe('definição', () => {
  it('ordem no formato do formulário de origem (2 dígitos por nível) e pré-ordem', () => {
    const t = percorrerPerguntas(DEF);
    expect(t.map((x) => x.ordem)).toEqual(['01', '0101', '0102', '0103', '0104', '0105', '0106']);
    expect(t[1]).toMatchObject({ nivel: 2, pai: 'avaliacao' });
  });

  it('sem problemas na definição sintética; cálculo em ordem', () => {
    expect(conferirDefinicao(DEF)).toEqual([]);
    expect(ordemDeCalculo(DEF)).toEqual(['total']);
  });

  it('acusa link repetido, seção vazia/obrigatória, itens fora de seção, opções e faixas', () => {
    const ruim: DefinicaoFormularioNovo = {
      ...DEF,
      perguntas: [
        P({ linkId: 'a', tipo: 'secao', obrigatorio: true }),
        P({ linkId: 'b', itens: [P({ linkId: 'c' })] }),
        P({ linkId: 'a' }),
        P({ linkId: 'd', tipo: 'escolha' }),
        P({ linkId: 'e', opcoes: [{ codigo: 'x', texto: 'X', pontos: null }] }),
        P({
          linkId: 'f',
          tipo: 'escolha',
          opcoes: [
            { codigo: 'x', texto: 'X', pontos: null },
            { codigo: 'y', texto: ' x ', pontos: null },
          ],
        }),
        P({ linkId: 'g', tipo: 'decimal', minimo: 5, maximo: 1 }),
        P({ linkId: 'h', minimo: 1 }),
      ],
    };
    const codigos = conferirDefinicao(ruim).map((p) => p.codigo);
    for (const c of [
      'link-repetido',
      'secao-vazia',
      'secao-obrigatoria',
      'itens-fora-de-secao',
      'opcoes-ausentes',
      'opcoes-indevidas',
      'opcao-repetida',
      'faixa-invalida',
    ])
      expect(codigos, c).toContain(c);
  });

  it('acusa regra com operação desconhecida, variável inexistente, autorreferência e ciclo', () => {
    const r = (perguntas: PerguntaFormularioNovo[]) =>
      conferirDefinicao({ ...DEF, perguntas }).map((p) => p.codigo);
    expect(r([P({ linkId: 'a', tipo: 'inteiro', calcular: { exec: ['x'] } })])).toContain('regra-invalida');
    expect(r([P({ linkId: 'a', tipo: 'inteiro', calcular: { '+': [1], '-': [2] } })])).toContain(
      'regra-invalida',
    );
    expect(r([P({ linkId: 'a', tipo: 'inteiro', calcular: { var: 'zz' } })])).toContain(
      'regra-variavel-inexistente',
    );
    expect(r([P({ linkId: 'a', tipo: 'inteiro', calcular: { var: 'a' } })])).toContain('regra-circular');
    expect(
      r([
        P({ linkId: 'a', tipo: 'inteiro', calcular: { var: 'b' } }),
        P({ linkId: 'b', tipo: 'inteiro', calcular: { var: 'a' } }),
      ]),
    ).toContain('regra-circular');
    expect(r([P({ linkId: 'a', tipo: 'data', calcular: 1 })])).toContain('calculo-em-tipo-invalido');
    expect(r([P({ linkId: 's', tipo: 'secao', itens: [] })])).toContain('sem-pergunta-respondivel');
  });

  it('acusa níveis demais (máximo 6, como o formulário de origem)', () => {
    let p = P({ linkId: 'n7' });
    for (let i = 6; i >= 1; i--) p = P({ linkId: `n${i}`, tipo: 'secao', itens: [p] });
    expect(conferirDefinicao({ ...DEF, perguntas: [p] }).map((x) => x.codigo)).toContain('niveis-demais');
  });
});

describe('avaliação (regras 3 e 15)', () => {
  it('total sempre calculado, mesmo quando a resposta traz um valor digitado', () => {
    const e = avaliarFormularioNovo(
      DEF,
      { mobilidade: 'limitada', riscos: ['umidade'], total: 99 },
      '2026-10-24',
    );
    expect(e.valores['total']).toBe(3);
  });

  it('habilitação pela regra e pendência da obrigatória habilitada', () => {
    const e = avaliarFormularioNovo(DEF, {}, '2026-10-24');
    expect(e.pendentes).toEqual(['mobilidade']);
    expect(e.habilitadas.has('conduta')).toBe(true); // total 0 ≤ 3
  });

  it('pergunta dentro de seção desabilitada fica desabilitada', () => {
    const d: DefinicaoFormularioNovo = {
      ...DEF,
      perguntas: [
        P({ linkId: 'q', tipo: 'inteiro' }),
        P({ linkId: 's', tipo: 'secao', habilitar: { '>': [{ var: 'q' }, 0] }, itens: [P({ linkId: 'x' })] }),
      ],
    };
    expect(avaliarFormularioNovo(d, { q: 0 }, '2026-10-24').habilitadas.has('x')).toBe(false);
    expect(avaliarFormularioNovo(d, { q: 1 }, '2026-10-24').habilitadas.has('x')).toBe(true);
  });

  it('valor nunca visto é recusado (opção inexistente, tipo, faixa, pergunta inexistente)', () => {
    expect(() => avaliarFormularioNovo(DEF, { mobilidade: 'voando' }, '2026-10-24')).toThrow(/não existe/);
    expect(() => avaliarFormularioNovo(DEF, { riscos: ['nada'] }, '2026-10-24')).toThrow(/não existe/);
    expect(() => avaliarFormularioNovo(DEF, { peso: 1000 }, '2026-10-24')).toThrow(/faixa/);
    expect(() => avaliarFormularioNovo(DEF, { peso: 'leve' }, '2026-10-24')).toThrow(/numérica/);
    expect(() => avaliarFormularioNovo(DEF, { avaliado_em: '24/10/2026' }, '2026-10-24')).toThrow(/AAAA/);
    expect(() => avaliarFormularioNovo(DEF, { inventada: 1 }, '2026-10-24')).toThrow(/não existe/);
  });

  it('escolha sem pontos vale a posição na lista; seção não é respondida; inteiro e hora', () => {
    const p = P({
      linkId: 'x',
      tipo: 'escolha-com-texto',
      opcoes: [
        { codigo: 'a', texto: 'A', pontos: null },
        { codigo: 'b', texto: 'B', pontos: null },
      ],
    });
    expect(valorParaRegra(p, 'b')).toBe(1);
    expect(() => valorParaRegra(P({ linkId: 's', tipo: 'secao' }), 'x')).toThrow();
    expect(() => valorParaRegra(P({ linkId: 'i', tipo: 'inteiro' }), 1.5)).toThrow(/inteiro/);
    expect(valorParaRegra(P({ linkId: 'h', tipo: 'hora' }), '07:30')).toBe('07:30');
    expect(() => valorParaRegra(P({ linkId: 'h', tipo: 'hora' }), '7h')).toThrow();
    expect(() => valorParaRegra(P({ linkId: 't' }), 3)).toThrow();
    expect(() => valorParaRegra(P({ linkId: 'm', tipo: 'multipla' }), 'a')).toThrow();
    expect(valorParaRegra(P({ linkId: 't' }), null)).toBeNull();
  });
});

describe('casos de teste', () => {
  it('os casos sintéticos passam', () => {
    const r = executarCasos(DEF, CASOS);
    expect(r.every((x) => x.passou)).toBe(true);
    expect(casosVerdes(r)).toBe(true);
    expect(casosVerdes([])).toBe(false);
  });

  it('valor e habilitação diferentes aparecem como diferença', () => {
    const r = executarCaso(DEF, {
      ...CASOS[0]!,
      esperado: { total: 5 },
      habilitadasEsperadas: ['mobilidade'],
    });
    expect(r.passou).toBe(false);
    expect(r.diferencas.find((d) => d.motivo === 'valor')).toMatchObject({
      linkId: 'total',
      esperado: 5,
      obtido: 3,
    });
    expect(r.diferencas.some((d) => d.motivo === 'habilitacao')).toBe(true);
  });

  it('resposta inválida no caso vira caso vermelho (não quebra a execução)', () => {
    const r = executarCaso(DEF, { ...CASOS[0]!, respostas: { mobilidade: 'voando' } });
    expect(r).toMatchObject({
      passou: false,
      diferencas: [{ linkId: 'mobilidade', motivo: 'resposta-invalida' }],
    });
  });
});

describe('ciclo de vida e imutabilidade (regra 14)', () => {
  it('content_hash estável (JCS): ordem de chaves e especialidades repetidas não mudam o hash', async () => {
    const { perguntas, ...resto } = DEF;
    const reordenado = JSON.parse(JSON.stringify({ perguntas, ...resto, especialidades: [12, 40] }));
    expect(conteudoCanonicoFormularioNovo(reordenado)).toBe(conteudoCanonicoFormularioNovo(DEF));
    const h = await contentHashFormularioNovo(DEF);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentHashFormularioNovo({ ...DEF, titulo: 'Outro título' })).not.toBe(h);
  });

  it('publica só aprovada por outra pessoa, com casos verdes e o hash que a tela mostrou', async () => {
    const h = await contentHashFormularioNovo(DEF);
    expect(await conferirPublicacao(versao(), h, 'conta-b')).toBe(h);
    expect(await recusa(() => conferirPublicacao(versao({ aprovadoPor: null }), h, 'conta-b'))).toBe(
      'sem-aprovacao',
    );
    expect(await recusa(() => conferirPublicacao(versao({ aprovadoPor: 'conta-a' }), h, 'conta-b'))).toBe(
      'aprovador-e-autor',
    );
    expect(await recusa(() => conferirPublicacao(versao({ estado: 'rascunho' }), h, 'conta-b'))).toBe(
      'estado-invalido',
    );
    expect(await recusa(() => conferirPublicacao(versao({ casos: [] }), h, 'conta-b'))).toBe('sem-casos');
    const vermelho = [{ ...CASOS[0]!, esperado: { total: 9 } }];
    expect(await recusa(() => conferirPublicacao(versao({ casos: vermelho }), h, 'conta-b'))).toBe(
      'casos-vermelhos',
    );
    expect(await recusa(() => conferirPublicacao(versao(), '0'.repeat(64), 'conta-b'))).toBe(
      'hash-divergente',
    );
    // Quatro olhos sobre toda a história (D-APROV-45): quem publica não escreveu, nem salvou antes do último autor.
    expect(await recusa(() => conferirPublicacao(versao(), h, 'conta-a'))).toBe('publicador-e-autor');
    expect(await recusa(() => conferirPublicacao(versao(), h, 'CONTA-A'))).toBe('publicador-e-autor');
    const coautor = versao({ autor: 'conta-c', autores: ['conta-a', 'conta-c'], aprovadoPor: 'conta-a' });
    expect(await recusa(() => conferirPublicacao(coautor, h, 'conta-b'))).toBe('aprovador-e-autor');
    const outraComissao = versao({
      autor: 'conta-c',
      autores: ['conta-a', 'conta-c'],
      aprovadoPor: 'conta-b',
    });
    expect(await recusa(() => conferirPublicacao(outraComissao, h, 'conta-a'))).toBe('publicador-e-autor');
    expect(await conferirPublicacao(outraComissao, h, 'conta-b')).toBe(h);
    const ruim = { ...DEF, perguntas: [P({ linkId: 'x', tipo: 'escolha' })] };
    expect(await recusa(() => conferirPublicacao(versao({ definicao: ruim }), h, 'conta-b'))).toBe(
      'definicao-com-problema',
    );
  });

  it('publicado e aposentado são imutáveis; revisão não se edita; só o rascunho vai à revisão', async () => {
    expect(await recusa(() => conferirSalvar(null))).toBe('aceito');
    expect(await recusa(() => conferirSalvar({ estado: 'rascunho' }))).toBe('aceito');
    expect(await recusa(() => conferirSalvar({ estado: 'publicado' }))).toBe('imutavel');
    expect(await recusa(() => conferirSalvar({ estado: 'aposentado' }))).toBe('imutavel');
    expect(await recusa(() => conferirSalvar({ estado: 'revisao' }))).toBe('estado-invalido');
    expect(await recusa(() => conferirEnvioRevisao(versao({ estado: 'rascunho' })))).toBe('aceito');
    expect(await recusa(() => conferirEnvioRevisao(versao()))).toBe('estado-invalido');
    expect(await recusa(() => conferirDecisaoRevisao(versao(), 'conta-b'))).toBe('aceito');
    expect(await recusa(() => conferirDecisaoRevisao(versao(), 'conta-a'))).toBe('aprovador-e-autor');
    // Dois autores: A escreveu, B salvou por último (o AUTOR passa a ser B); A continua sem poder aprovar.
    const doisAutores = versao({ autor: 'conta-b', autores: ['conta-a', 'conta-b'], aprovadoPor: null });
    expect(await recusa(() => conferirDecisaoRevisao(doisAutores, 'conta-a'))).toBe('aprovador-e-autor');
    expect(await recusa(() => conferirDecisaoRevisao(doisAutores, 'Conta-A'))).toBe('aprovador-e-autor');
    expect(await recusa(() => conferirDecisaoRevisao(doisAutores, 'conta-c'))).toBe('aceito');
    expect(await recusa(() => conferirDecisaoRevisao(versao({ estado: 'rascunho' }), 'conta-b'))).toBe(
      'estado-invalido',
    );
    expect(await recusa(() => conferirAposentadoria({ estado: 'publicado' }))).toBe('aceito');
    expect(await recusa(() => conferirAposentadoria({ estado: 'revisao' }))).toBe('estado-invalido');
  });

  it('integridade do publicado e numeração das versões', async () => {
    const h = await contentHashFormularioNovo(DEF);
    expect(await publicadoIntegro({ definicao: DEF, contentHash: h })).toBe(true);
    expect(await publicadoIntegro({ definicao: { ...DEF, titulo: 'Alterado' }, contentHash: h })).toBe(false);
    expect(await publicadoIntegro({ definicao: DEF, contentHash: null })).toBe(false);
    expect(proximaVersao([])).toBe(1);
    expect(proximaVersao([1, 3, 2])).toBe(4);
  });
});

describe('plano de publicação (pep.publicarFormularioNovo)', () => {
  const BANCO: PerguntaBancoLegado[] = [
    { id: 900, descricao: ' peso ', tipoperg: '6', unidade: 'KG', ativo: true, opcoes: [] },
    { id: 901, descricao: 'Mobilidade', tipoperg: '13', unidade: null, ativo: false, opcoes: ['Acamado'] },
  ];
  const entrada = (over: Partial<Parameters<typeof planoDePublicacao>[0]> = {}) => ({
    definicao: DEF,
    versao: 1,
    codigosExistentes: new Set(['ENF021', 'MORSE']),
    banco: BANCO,
    respostasCadastradas: [{ cod: 77, descricao: 'ACAMADO' }],
    constantes: CONSTANTES_SINTETICAS,
    ...over,
  });

  it('sem o tipo de atendimento e a fonte do cenário (o dublê), o plano recusa em vez de gravar nulo', () => {
    const pendente = (constantes: typeof CONSTANTES_DUBLE) => {
      try {
        planoDePublicacao(entrada({ constantes }));
        return 'montou';
      } catch (e) {
        return e instanceof ErroPlanoPublicacao ? e.codigo : 'outro';
      }
    };
    expect(pendente(CONSTANTES_DUBLE)).toBe('constantes-pendentes');
    expect(pendente({ ...CONSTANTES_SINTETICAS, tipoAtendimento: null })).toBe('constantes-pendentes');
    expect(pendente({ ...CONSTANTES_SINTETICAS, fonteVinculo: ' ' })).toBe('constantes-pendentes');
    expect(pendente(CONSTANTES_SINTETICAS)).toBe('montou');
  });

  it('alinhado à referência de perfil: sentinelas 0, unidade vazia como texto vazio, tipo e fonte preenchidos', () => {
    const plano = planoDePublicacao(entrada());
    const modelo = plano.linhas[0]!.colunas;
    expect(modelo['TP_ATENDIMENTO']).toEqual({ classe: 'entrada', valor: 1 });
    expect(modelo['HIST_CLINICO_ABA']).toEqual({ classe: 'constante', valor: 0 });
    expect(modelo['HIST_CLINICO_PERIODO']).toEqual({ classe: 'constante', valor: 0 });
    const conduta = plano.linhas.find((l) => l.chave === 'pergunta:conduta')!.colunas;
    expect(conduta['UNIDPERG']).toEqual({ classe: 'entrada', valor: '' });
    expect(conduta['ALTURA_COMPONENTE']).toEqual({ classe: 'constante', valor: 0 });
    expect(conduta['LARGURA_COMPONENTE']).toEqual({ classe: 'constante', valor: 0 });
    const vinculos = plano.linhas.filter((l) => l.tabela === 'PRPADEVOL');
    expect(vinculos.every((l) => l.colunas['FONTE']?.classe === 'entrada')).toBe(true);
    expect(vinculos.every((l) => (l.colunas['FONTE'] as { valor: unknown }).valor === 'SINTETICO M45')).toBe(
      true,
    );
    // A resposta da própria pergunta: COD nulo e ORDEM 0, como entrada (a receita declara as duas como entrada).
    const propria = plano.linhas.find((l) => l.chave === 'resposta:conduta')!.colunas;
    expect(propria['COD']).toEqual({ classe: 'entrada', valor: null });
    expect(propria['ORDEM']).toEqual({ classe: 'entrada', valor: 0 });
  });

  it('código do modelo: nunca reaproveita; versão seguinte com sufixo dentro de 10', () => {
    expect(codigoModeloDaVersao('SGHESC', 1, new Set())).toBe('SGHESC');
    expect(codigoModeloDaVersao('ABCDEFGHIJ', 2, new Set())).toBe('ABCDEFGHV2');
    expect(() => codigoModeloDaVersao('MORSE', 1, new Set(['MORSE']))).toThrow(/já existe/);
  });

  it('reuso do banco: só pergunta ativa, mesmo título, tipo, unidade e opções', () => {
    const peso = percorrerPerguntas(DEF).find((x) => x.pergunta.linkId === 'peso')!.pergunta;
    expect(perguntaCompativel(peso, BANCO[0]!)).toBe(true);
    expect(perguntaCompativel({ ...peso, unidade: 'g' }, BANCO[0]!)).toBe(false);
    expect([...sugerirReuso(DEF, BANCO)]).toEqual([['peso', 900]]);
    expect(tipoDoTipoperg('4')).toBe('escolha');
    expect(tipoDoTipoperg(' 12 ')).toBe('multipla');
    expect(tipoDoTipoperg('19')).toBeNull();
  });

  it('linhas em ordem, com chaves lógicas e reuso; nada é alterado no legado', () => {
    const def = {
      ...DEF,
      perguntas: [
        {
          ...DEF.perguntas[0]!,
          itens: DEF.perguntas[0]!.itens.map((p) => (p.linkId === 'peso' ? { ...p, reuso: 900 } : p)),
        },
      ],
    };
    const plano = planoDePublicacao(entrada({ definicao: def }));
    expect(plano.codigoModelo).toBe('SGHESC');
    const tabelas = plano.linhas.map((l) => l.tabela);
    expect(tabelas[0]).toBe('PREVOLUCAO');
    expect(tabelas.lastIndexOf('PRPERGUNTA')).toBeLessThan(tabelas.indexOf('PRPADEVOL'));
    expect(contagemDoPlano(plano)).toEqual({
      PREVOLUCAO: 1,
      PRCADRESP: 4, // Limitada, Deambula, Umidade, Fricção (Acamado reaproveitada)
      PRPERGUNTA: 6, // seção + 5 perguntas novas (peso reaproveitado)
      PRRESPOSTA: 8, // 3 + 2 opções + total, conduta e data (ORDEM 0)
      PRPADEVOL: 7,
      PREVOLESPEC: 2,
    });
    expect([...plano.reusadas]).toEqual([['peso', 900]]);
    expect([...plano.respostasReusadas]).toEqual([['ACAMADO', 77]]);
    const vinc = plano.linhas.find((l) => l.chave === 'vinculo:peso')!;
    expect(vinc.colunas['ID_PRPERGUNTA']).toEqual({ classe: 'entrada', valor: 900 });
    expect(vinc.colunas['ORDEM']).toEqual({ classe: 'entrada', valor: '0105' });
    const mob = plano.linhas.find((l) => l.chave === 'vinculo:mobilidade')!;
    expect(mob.colunas['CAMPOOBRIG']).toEqual({ classe: 'entrada', valor: 'T' });
    const resp = plano.linhas.find((l) => l.chave === 'resposta:mobilidade:acamado')!;
    expect(resp.colunas['COD']).toEqual({ classe: 'entrada', valor: 77 });
    expect(resp.colunas['ORDEM']).toEqual({ classe: 'entrada', valor: 1 });
    const modelo = plano.linhas[0]!;
    expect(modelo.colunas['ID_EVOLUCAO']).toEqual({ classe: 'generator' });
    expect(modelo.colunas['ID_PRTPCOMP']).toEqual({ classe: 'entrada', valor: 2 });
  });

  it('reuso que não existe, está inativo ou mudou é recusado (condição relida)', () => {
    const comReuso = (id: number) => ({
      ...DEF,
      perguntas: [
        {
          ...DEF.perguntas[0]!,
          itens: DEF.perguntas[0]!.itens.map((p) => (p.linkId === 'mobilidade' ? { ...p, reuso: id } : p)),
        },
      ],
    });
    expect(() => planoDePublicacao(entrada({ definicao: comReuso(901) }))).toThrow(/reaproveitada/);
    expect(() => planoDePublicacao(entrada({ definicao: comReuso(5) }))).toThrow(/reaproveitada/);
  });
});

describe('registro-resumo (contorno, DP-27)', () => {
  const R = { mobilidade: 'acamado', riscos: ['umidade', 'friccao'], peso: 72.5, avaliado_em: '2026-10-20' };

  it('numera seções e perguntas respondidas, com o total calculado e a unidade', () => {
    const b = blocosDoResumo(DEF, R, '2026-10-24');
    expect(b.map((x) => x.rotulo)).toEqual([
      '1 - AVALIAÇÃO',
      '1.1 - Mobilidade',
      '1.2 - Fatores de risco',
      '1.3 - Total',
      '1.4 - Peso',
      '1.5 - Avaliado em',
    ]);
    expect(b[1]!.naLinha).toBe('Acamado');
    expect(b[3]!.naLinha).toBe('4');
    expect(b[4]!.naLinha).toBe('72,5 kg');
    expect(b[5]!.naLinha).toBe('20/10/2026');
    expect(b[2]!.valor).toHaveLength(2);
  });

  it('texto formatado em CP1252 com o título e a versão; conduta habilitada entra em parágrafos', () => {
    const rtf = rtfDoResumo(
      DEF,
      3,
      { mobilidade: 'acamado', conduta: 'Mudar decúbito\nHidratar pele' },
      '2026-10-24',
    );
    expect(rtf.startsWith('{\\rtf1\\ansi\\ansicpg1252')).toBe(true);
    expect(rtf).toContain('(versão 3)'.replace('ã', "\\'e3"));
    expect(rtf).toContain('Hidratar pele');
  });
});

describe('formulário sintético compartilhado e o resumo em texto', () => {
  it('a escala sintética não tem problema e os dois casos passam', async () => {
    const { FORMULARIO_NOVO_SINTETICO, CASOS_FORMULARIO_NOVO_SINTETICO } = await import('./sintetico.js');
    expect(conferirDefinicao(FORMULARIO_NOVO_SINTETICO)).toEqual([]);
    expect(casosVerdes(executarCasos(FORMULARIO_NOVO_SINTETICO, CASOS_FORMULARIO_NOVO_SINTETICO))).toBe(true);
  });

  it('o texto do resumo numera como o registro e leva o total calculado, com acentos do CP1252', async () => {
    const { textoDoResumo } = await import('./resumo.js');
    const t = textoDoResumo(
      DEF,
      2,
      { mobilidade: 'acamado', riscos: ['friccao'], conduta: 'Mudança de decúbito' },
      '2026-10-24',
    );
    expect(t.split('\n')).toEqual([
      'Escala sintética SINTETICO M45 (versão 2)',
      '1 - AVALIAÇÃO',
      '1.1 - Mobilidade: Acamado',
      '1.2 - Fatores de risco',
      '    Fricção',
      '1.3 - Total: 3',
      '1.4 - Conduta',
      '    Mudança de decúbito',
    ]);
  });
});
