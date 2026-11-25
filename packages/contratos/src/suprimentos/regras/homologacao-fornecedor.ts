// Homologação do fornecedor por questionário pontuado (09-AREA linha 66). Prática de mercado (ONA e ISO 9001, 8.4:
// controle dos fornecedores externos): critérios com peso, nota mínima por categoria de fornecimento, pergunta
// eliminatória, exceção justificada aprovada por outra pessoa (segregação) e requalificação periódica pela validade.
//   - o questionário: código, nota mínima de 0 a 100, validade em meses, vigência e as perguntas (peso, tipo de resposta
//     e as opções com os pontos de 0 a 10; "sim/não" vale 10 e 0; texto livre não entra na nota);
//   - a nota: 100 × Σ(peso × pontos ÷ pontos máximos da pergunta) ÷ Σ(pesos respondidos), com as parcelas impressas; a
//     pergunta opcional sem resposta sai da conta; a eliminatória com a opção de menor pontuação reprova;
//   - a classificação: a faixa da nota (cadastro das faixas de avaliação) e a situação (homologado ou reprovado);
//   - a exceção: só sobre a reprovada, com justificativa, por quem não avaliou;
//   - o ranking: a avaliação mais recente de cada fornecedor por questionário, homologados primeiro, pela nota.
// Datas em AAAA-MM-DD. Funções puras: a gravação confere de novo.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const TIPOS_RESPOSTA_HOMOLOGACAO = ['sim_nao', 'escala', 'multipla_escolha', 'texto'] as const;
export type TipoRespostaHomologacao = (typeof TIPOS_RESPOSTA_HOMOLOGACAO)[number];
export const SITUACOES_HOMOLOGACAO = [
  'em_avaliacao',
  'homologado',
  'reprovado',
  'vencido',
  'cancelado',
] as const;
export type SituacaoHomologacao = (typeof SITUACOES_HOMOLOGACAO)[number];
export type ResultadoFaixaHomologacao = 'aprovado' | 'aprovado_restricao' | 'reprovado';

export const PONTOS_MAXIMOS_OPCAO = 10;
export const PERGUNTAS_MAXIMAS_HOMOLOGACAO = 60;
export const OPCOES_MAXIMAS_HOMOLOGACAO = 10;
export const VALIDADE_MAXIMA_HOMOLOGACAO_MESES = 60;
export const JUSTIFICATIVA_MINIMA_EXCECAO = 20;
export const MOTIVO_MINIMO_CANCELAMENTO = 10;
/** Dias antes do vencimento em que a homologação aparece "a requalificar". */
export const AVISO_REQUALIFICACAO_DIAS = 30;

export interface OpcaoHomologacao {
  readonly ordem: number;
  readonly texto: string;
  readonly pontos: number;
}

export interface PerguntaHomologacaoEntrada {
  readonly identificador: string | null;
  readonly texto: string;
  readonly peso: number;
  readonly tipoResposta: TipoRespostaHomologacao;
  /** Vazio no "sim/não" (o sistema põe Sim = 10 e Não = 0) e no texto livre. */
  readonly opcoes: readonly OpcaoHomologacao[];
  readonly obrigatoria: boolean;
  readonly eliminatoria: boolean;
}

export interface QuestionarioHomologacaoEntrada {
  readonly codigo: string;
  readonly descricao: string;
  /** Nulo: vale para todas as categorias de fornecimento. */
  readonly categoria: number | null;
  readonly notaMinima: number;
  readonly validadeMeses: number;
  readonly instrucoes: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly perguntas: readonly PerguntaHomologacaoEntrada[];
}

/** A pergunta gravada (com o id e a sequência) que a avaliação responde. */
export interface PerguntaHomologacao extends PerguntaHomologacaoEntrada {
  readonly id: number;
  readonly sequencia: number;
}

export interface RespostaHomologacaoEntrada {
  readonly pergunta: number;
  /** A ordem da opção escolhida (sim/não: 1 = Sim, 2 = Não); nulo no texto livre ou sem resposta. */
  readonly opcao: number | null;
  readonly texto: string | null;
}

export interface RespostaPontuada {
  readonly pergunta: number;
  readonly sequencia: number;
  readonly resposta: string | null;
  /** Só no "sim/não": a resposta atende (Sim) ou não. */
  readonly atende: boolean | null;
  readonly pontuacao: number;
  readonly peso: number;
}

export interface NotaHomologacao {
  /** 0 a 100, 4 casas. */
  readonly nota: number;
  readonly pesoConsiderado: number;
  readonly respostas: readonly RespostaPontuada[];
  /** As perguntas eliminatórias reprovadas (sequência e texto). */
  readonly eliminatorias: readonly string[];
  readonly parcelas: readonly string[];
}

export interface FaixaHomologacao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly notaInicial: number;
  readonly notaFinal: number;
  readonly resultado: ResultadoFaixaHomologacao;
}

export interface ClassificacaoHomologacao {
  readonly situacao: 'homologado' | 'reprovado';
  readonly faixa: FaixaHomologacao | null;
  readonly comRestricao: boolean;
  readonly motivos: readonly string[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO = /^[A-Za-z0-9._-]{1,30}$/;
const IDENTIFICADOR = /^[A-Za-z0-9._-]{1,30}$/;
const quatro = (n: number): number => Math.round(n * 10000) / 10000;
const fmt = (n: number): string => String(quatro(n)).replace('.', ',');
const dataValida = (d: string): boolean => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

const SIM_NAO: readonly OpcaoHomologacao[] = [
  { ordem: 1, texto: 'Sim', pontos: PONTOS_MAXIMOS_OPCAO },
  { ordem: 2, texto: 'Não', pontos: 0 },
];

/** As opções que a pergunta oferece (o "sim/não" é fixo; o texto livre não tem). */
export function opcoesDaPergunta(
  p: Pick<PerguntaHomologacaoEntrada, 'tipoResposta' | 'opcoes'>,
): readonly OpcaoHomologacao[] {
  if (p.tipoResposta === 'sim_nao') return SIM_NAO;
  if (p.tipoResposta === 'texto') return [];
  return [...p.opcoes].sort((a, b) => a.ordem - b.ordem);
}

export const perguntaPontuavel = (p: Pick<PerguntaHomologacaoEntrada, 'tipoResposta'>): boolean =>
  p.tipoResposta !== 'texto';

/** O questionário: código, nota mínima, validade, vigência e as perguntas com peso e opções pontuadas. */
export function conferirQuestionarioHomologacao(q: QuestionarioHomologacaoEntrada): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!CODIGO.test(q.codigo.trim()))
    r.push(
      recusa('questionario-codigo', 'O código tem de 1 a 30 letras, números, ponto, hífen ou sublinhado.', [
        'codigo',
      ]),
    );
  if (q.descricao.trim() === '' || q.descricao.trim().length > 150)
    r.push(recusa('questionario-descricao', 'Informe a descrição (até 150 caracteres).', ['descricao']));
  if (!(q.notaMinima >= 0 && q.notaMinima <= 100))
    r.push(recusa('questionario-nota-minima', 'A nota mínima fica entre 0 e 100.', ['notaMinima']));
  if (
    !Number.isInteger(q.validadeMeses) ||
    q.validadeMeses < 1 ||
    q.validadeMeses > VALIDADE_MAXIMA_HOMOLOGACAO_MESES
  )
    r.push(
      recusa(
        'questionario-validade',
        `A validade da homologação vai de 1 a ${VALIDADE_MAXIMA_HOMOLOGACAO_MESES} meses (requalificação periódica).`,
        ['validadeMeses'],
      ),
    );
  if (!dataValida(q.vigenciaInicio))
    r.push(recusa('questionario-vigencia', 'Informe o início da vigência.', ['vigenciaInicio']));
  if (q.vigenciaFim !== null && (!dataValida(q.vigenciaFim) || q.vigenciaFim < q.vigenciaInicio))
    r.push(
      recusa('questionario-vigencia', 'O fim da vigência não pode ser antes do início.', ['vigenciaFim']),
    );
  if (q.perguntas.length === 0)
    return [...r, recusa('questionario-perguntas', 'Informe ao menos uma pergunta.', ['perguntas'])];
  if (q.perguntas.length > PERGUNTAS_MAXIMAS_HOMOLOGACAO)
    r.push(
      recusa('questionario-perguntas', `No máximo ${PERGUNTAS_MAXIMAS_HOMOLOGACAO} perguntas.`, [
        'perguntas',
      ]),
    );
  if (!q.perguntas.some(perguntaPontuavel))
    r.push(
      recusa('questionario-perguntas', 'Ao menos uma pergunta precisa ser pontuada (não só texto livre).', [
        'perguntas',
      ]),
    );
  const identificadores = new Set<string>();
  q.perguntas.forEach((p, i) => {
    const n = i + 1;
    const campo = `perguntas.${i}`;
    if (p.texto.trim() === '' || p.texto.trim().length > 500)
      r.push(
        recusa('pergunta-texto', `Pergunta ${n}: informe o texto (até 500 caracteres).`, [`${campo}.texto`]),
      );
    if (p.identificador !== null && p.identificador.trim() !== '') {
      const id = p.identificador.trim().toUpperCase();
      if (!IDENTIFICADOR.test(id))
        r.push(
          recusa('pergunta-identificador', `Pergunta ${n}: identificador inválido.`, [
            `${campo}.identificador`,
          ]),
        );
      else if (identificadores.has(id))
        r.push(
          recusa('pergunta-identificador', `Pergunta ${n}: identificador repetido.`, [
            `${campo}.identificador`,
          ]),
        );
      identificadores.add(id);
    }
    if (!(p.peso > 0 && p.peso <= 100))
      r.push(recusa('pergunta-peso', `Pergunta ${n}: o peso fica acima de 0 e até 100.`, [`${campo}.peso`]));
    if (p.tipoResposta === 'texto') {
      if (p.eliminatoria)
        r.push(
          recusa(
            'pergunta-eliminatoria',
            `Pergunta ${n}: texto livre não pontua e não pode ser eliminatória.`,
            [`${campo}.eliminatoria`],
          ),
        );
      return;
    }
    if (p.tipoResposta === 'sim_nao') return;
    const ops = p.opcoes;
    if (ops.length < 2 || ops.length > OPCOES_MAXIMAS_HOMOLOGACAO) {
      r.push(
        recusa('pergunta-opcoes', `Pergunta ${n}: de 2 a ${OPCOES_MAXIMAS_HOMOLOGACAO} opções.`, [
          `${campo}.opcoes`,
        ]),
      );
      return;
    }
    const ordens = new Set<number>();
    const textos = new Set<string>();
    for (const o of ops) {
      if (o.texto.trim() === '' || o.texto.trim().length > 150)
        r.push(
          recusa('pergunta-opcoes', `Pergunta ${n}: toda opção tem texto (até 150).`, [`${campo}.opcoes`]),
        );
      if (!(o.pontos >= 0 && o.pontos <= PONTOS_MAXIMOS_OPCAO))
        r.push(
          recusa('pergunta-opcoes', `Pergunta ${n}: os pontos da opção vão de 0 a ${PONTOS_MAXIMOS_OPCAO}.`, [
            `${campo}.opcoes`,
          ]),
        );
      if (ordens.has(o.ordem) || textos.has(o.texto.trim().toLowerCase()))
        r.push(recusa('pergunta-opcoes', `Pergunta ${n}: opção repetida.`, [`${campo}.opcoes`]));
      ordens.add(o.ordem);
      textos.add(o.texto.trim().toLowerCase());
    }
    const pts = ops.map((o) => o.pontos);
    if (Math.max(...pts) <= 0)
      r.push(
        recusa('pergunta-opcoes', `Pergunta ${n}: ao menos uma opção vale pontos.`, [`${campo}.opcoes`]),
      );
    if (p.eliminatoria && Math.max(...pts) === Math.min(...pts))
      r.push(
        recusa(
          'pergunta-eliminatoria',
          `Pergunta ${n}: a eliminatória precisa de opções com pontos diferentes.`,
          [`${campo}.eliminatoria`],
        ),
      );
  });
  return r;
}

/**
 * A nota ponderada da avaliação, com as respostas pontuadas e as parcelas impressas. Recusa a resposta de pergunta de
 * outro questionário, a repetida, a opção inexistente e a pergunta obrigatória sem resposta.
 */
export function calcularNotaHomologacao(
  perguntas: readonly PerguntaHomologacao[],
  respostas: readonly RespostaHomologacaoEntrada[],
): { recusas: RecusaSuprimentos[]; nota: NotaHomologacao | null } {
  const recusas: RecusaSuprimentos[] = [];
  const porId = new Map(perguntas.map((p) => [p.id, p]));
  const dadas = new Map<number, RespostaHomologacaoEntrada>();
  for (const x of respostas) {
    if (!porId.has(x.pergunta))
      recusas.push(
        recusa('resposta-pergunta', 'Há resposta para pergunta que não é deste questionário.', ['respostas']),
      );
    else if (dadas.has(x.pergunta))
      recusas.push(recusa('resposta-pergunta', 'Há duas respostas para a mesma pergunta.', ['respostas']));
    else dadas.set(x.pergunta, x);
  }
  const ordenadas = [...perguntas].sort((a, b) => a.sequencia - b.sequencia);
  const pontuadas: RespostaPontuada[] = [];
  const parcelas: string[] = [];
  const eliminatorias: string[] = [];
  let soma = 0;
  let pesos = 0;
  for (const p of ordenadas) {
    const x = dadas.get(p.id);
    const rotulo = `Pergunta ${p.sequencia}${p.identificador ? ` (${p.identificador})` : ''}`;
    if (!perguntaPontuavel(p)) {
      const txt = x?.texto?.trim() ?? '';
      if (txt === '' && p.obrigatoria)
        recusas.push(
          recusa('resposta-obrigatoria', `${rotulo}: resposta obrigatória.`, [`respostas.${p.id}`]),
        );
      if (txt !== '')
        pontuadas.push({
          pergunta: p.id,
          sequencia: p.sequencia,
          resposta: txt.slice(0, 2000),
          atende: null,
          pontuacao: 0,
          peso: p.peso,
        });
      continue;
    }
    const ops = opcoesDaPergunta(p);
    if (!x || x.opcao === null) {
      if (p.obrigatoria)
        recusas.push(
          recusa('resposta-obrigatoria', `${rotulo}: resposta obrigatória.`, [`respostas.${p.id}`]),
        );
      else parcelas.push(`${rotulo}: sem resposta (opcional), fora da conta`);
      continue;
    }
    const o = ops.find((y) => y.ordem === x.opcao);
    if (!o) {
      recusas.push(
        recusa('resposta-opcao', `${rotulo}: a opção escolhida não existe.`, [`respostas.${p.id}`]),
      );
      continue;
    }
    const max = Math.max(...ops.map((y) => y.pontos));
    const min = Math.min(...ops.map((y) => y.pontos));
    const parte = (p.peso * o.pontos) / max;
    soma += parte;
    pesos += p.peso;
    parcelas.push(`${rotulo} (peso ${fmt(p.peso)}): ${fmt(o.pontos)} de ${fmt(max)} pontos = ${fmt(parte)}`);
    if (p.eliminatoria && o.pontos === min) eliminatorias.push(`${rotulo}: ${p.texto.trim()}`);
    const complemento = x.texto?.trim() ?? '';
    pontuadas.push({
      pergunta: p.id,
      sequencia: p.sequencia,
      resposta: (complemento ? `${o.texto} — ${complemento}` : o.texto).slice(0, 2000),
      atende: p.tipoResposta === 'sim_nao' ? o.pontos > 0 : null,
      pontuacao: o.pontos,
      peso: p.peso,
    });
  }
  if (recusas.length > 0) return { recusas, nota: null };
  if (pesos <= 0)
    return {
      recusas: [recusa('resposta-obrigatoria', 'Responda ao menos uma pergunta pontuada.', ['respostas'])],
      nota: null,
    };
  const nota = quatro((100 * soma) / pesos);
  parcelas.push(`Nota = 100 × ${fmt(soma)} ÷ ${fmt(pesos)} = ${fmt(nota)}`);
  return {
    recusas: [],
    nota: { nota, pesoConsiderado: quatro(pesos), respostas: pontuadas, eliminatorias, parcelas },
  };
}

/** A faixa da nota: a de maior nota inicial que a contém (as faixas são fechadas nos dois limites). */
export function faixaDaNotaHomologacao(
  nota: number,
  faixas: readonly FaixaHomologacao[],
): FaixaHomologacao | null {
  return (
    [...faixas]
      .filter((f) => nota >= f.notaInicial && nota <= f.notaFinal)
      .sort((a, b) => b.notaInicial - a.notaInicial)[0] ?? null
  );
}

/** Homologado ou reprovado: a nota mínima do questionário, as eliminatórias e o resultado da faixa. */
export function classificarHomologacao(
  n: Pick<NotaHomologacao, 'nota' | 'eliminatorias'>,
  notaMinima: number,
  faixas: readonly FaixaHomologacao[],
): ClassificacaoHomologacao {
  const faixa = faixaDaNotaHomologacao(n.nota, faixas);
  const motivos: string[] = [];
  if (n.nota < notaMinima) motivos.push(`Nota ${fmt(n.nota)} abaixo da mínima ${fmt(notaMinima)}.`);
  for (const e of n.eliminatorias) motivos.push(`Eliminatória não atendida — ${e}.`);
  if (faixa?.resultado === 'reprovado') motivos.push(`Faixa ${faixa.descricao} reprova.`);
  return {
    situacao: motivos.length > 0 ? 'reprovado' : 'homologado',
    faixa,
    comRestricao: motivos.length === 0 && faixa?.resultado === 'aprovado_restricao',
    motivos,
  };
}

/** A data até a qual a homologação vale: a data da avaliação mais a validade em meses (fim do mês quando falta o dia). */
export function validadeHomologacao(avaliadoEm: string, meses: number): string {
  const [a, m, d] = avaliadoEm.slice(0, 10).split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export interface HomologacaoResumo {
  readonly id: number;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly questionario: number;
  readonly situacao: SituacaoHomologacao;
  readonly nota: number | null;
  readonly excecao: boolean;
  readonly avaliadoEm: string;
  readonly validoAte: string | null;
}

/** A situação na data: a homologada passada da validade está vencida (requalificar). */
export function situacaoNaDataHomologacao(
  h: Pick<HomologacaoResumo, 'situacao' | 'validoAte'>,
  hoje: string,
): { situacao: SituacaoHomologacao; requalificar: boolean } {
  if (h.situacao !== 'homologado' || h.validoAte === null)
    return { situacao: h.situacao, requalificar: false };
  if (h.validoAte < hoje) return { situacao: 'vencido', requalificar: true };
  const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) + AVISO_REQUALIFICACAO_DIAS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { situacao: 'homologado', requalificar: h.validoAte <= limite };
}

export interface PosicaoRanking extends HomologacaoResumo {
  readonly posicao: number;
  readonly situacaoNaData: SituacaoHomologacao;
  readonly requalificar: boolean;
}

const PESO_SITUACAO: Record<SituacaoHomologacao, number> = {
  homologado: 0,
  em_avaliacao: 1,
  vencido: 2,
  reprovado: 3,
  cancelado: 4,
};

/**
 * O ranking do questionário: a avaliação mais recente de cada fornecedor (a cancelada não conta), homologados primeiro
 * (os por exceção depois dos homologados pela nota), depois vencidos e reprovados; dentro do grupo, a maior nota.
 */
export function rankingHomologacao(
  itens: readonly HomologacaoResumo[],
  questionario: number,
  hoje: string,
): PosicaoRanking[] {
  const recente = new Map<number, HomologacaoResumo>();
  for (const h of itens) {
    if (h.questionario !== questionario || h.situacao === 'cancelado') continue;
    const atual = recente.get(h.fornecedor);
    if (!atual || h.avaliadoEm > atual.avaliadoEm || (h.avaliadoEm === atual.avaliadoEm && h.id > atual.id))
      recente.set(h.fornecedor, h);
  }
  return [...recente.values()]
    .map((h) => {
      const s = situacaoNaDataHomologacao(h, hoje);
      return { ...h, situacaoNaData: s.situacao, requalificar: s.requalificar };
    })
    .sort(
      (a, b) =>
        PESO_SITUACAO[a.situacaoNaData] - PESO_SITUACAO[b.situacaoNaData] ||
        Number(a.excecao) - Number(b.excecao) ||
        (b.nota ?? -1) - (a.nota ?? -1) ||
        a.fornecedorNome.localeCompare(b.fornecedorNome, 'pt-BR'),
    )
    .map((h, i) => ({ ...h, posicao: i + 1 }));
}

/** A exceção: só sobre a reprovada (não cancelada), com justificativa, aprovada por quem não fez a avaliação. */
export function conferirExcecaoHomologacao(
  h: { readonly situacao: SituacaoHomologacao; readonly avaliador: number; readonly excecao: boolean },
  usuario: number,
  justificativa: string,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (h.situacao !== 'reprovado' || h.excecao)
    r.push(recusa('excecao-situacao', 'A exceção só se aprova sobre a homologação reprovada.'));
  if (h.avaliador === usuario)
    r.push(
      recusa('excecao-segregacao', 'Quem avaliou o fornecedor não aprova a exceção da própria avaliação.'),
    );
  if (justificativa.trim().length < JUSTIFICATIVA_MINIMA_EXCECAO || justificativa.trim().length > 2000)
    r.push(
      recusa(
        'excecao-justificativa',
        `Justifique a exceção (de ${JUSTIFICATIVA_MINIMA_EXCECAO} a 2000 caracteres).`,
        ['justificativa'],
      ),
    );
  return r;
}

/** O cancelamento: a avaliação fica no histórico com o motivo; a cancelada não se cancela de novo. */
export function conferirCancelamentoHomologacao(
  situacao: SituacaoHomologacao,
  motivo: string,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (situacao === 'cancelado')
    r.push(recusa('homologacao-cancelada', 'Esta homologação já está cancelada.'));
  if (motivo.trim().length < MOTIVO_MINIMO_CANCELAMENTO || motivo.trim().length > 500)
    r.push(
      recusa('cancelamento-motivo', `Informe o motivo (de ${MOTIVO_MINIMO_CANCELAMENTO} a 500 caracteres).`, [
        'motivo',
      ]),
    );
  return r;
}

/**
 * O fornecedor só é avaliado num questionário de categoria se fornece essa categoria (a principal ou uma das
 * vinculadas): a homologação grava a categoria do questionário, e homologar quem não a fornece distorce o ranking e a
 * nota mínima por categoria (ISO 9001 8.4). O questionário sem categoria vale para qualquer fornecedor.
 */
export function conferirFornecedorDaCategoria(
  categoriaQuestionario: number | null,
  categoriasFornecedor: readonly number[],
): RecusaSuprimentos[] {
  if (categoriaQuestionario === null || categoriasFornecedor.includes(categoriaQuestionario)) return [];
  return [
    recusa(
      'fornecedor-fora-categoria',
      'O fornecedor não atende a categoria de fornecimento deste questionário: vincule a categoria ao fornecedor ou use o questionário da categoria dele.',
      ['fornecedor'],
    ),
  ];
}
