// Cliente da homologação do fornecedor por questionário pontuado (09-AREA linha 66): o painel (questionários, faixas,
// avaliações e ranking), a busca do fornecedor, a avaliação aberta com as respostas e as gravações (questionário,
// encerramento, avaliação, exceção, cancelamento) com o CSRF e a Idempotency-Key.
import type {
  FaixaHomologacao,
  PerguntaHomologacao,
  QuestionarioHomologacaoEntrada,
  RespostaHomologacaoEntrada,
  SituacaoHomologacao,
} from '@sgh/dominio-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveContrato } from './api-contrato.js';

export interface QuestionarioTela {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: number | null;
  readonly categoriaDescricao: string | null;
  readonly notaMinima: number;
  readonly validadeMeses: number;
  readonly instrucoes: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly vigente: boolean;
  readonly perguntas: PerguntaHomologacao[];
}

export interface HomologacaoTela {
  readonly id: number;
  readonly versao: number;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly questionario: number;
  readonly questionarioDescricao: string;
  readonly categoriaDescricao: string | null;
  readonly insumoDescricao: string | null;
  readonly situacao: SituacaoHomologacao;
  readonly situacaoNaData: SituacaoHomologacao;
  readonly requalificar: boolean;
  readonly nota: number | null;
  readonly excecao: boolean;
  readonly justificativa: string | null;
  readonly faixa: string | null;
  readonly avaliadoEm: string;
  readonly validoAte: string | null;
  readonly avaliador: number;
  readonly avaliadorLogin: string | null;
  /** O motivo do cancelamento (da trilha), só na cancelada. */
  readonly motivoCancelamento: string | null;
}

export interface PosicaoRankingTela {
  readonly posicao: number;
  readonly id: number;
  readonly fornecedorNome: string;
  readonly questionario: number;
  readonly nota: number | null;
  readonly excecao: boolean;
  readonly situacaoNaData: SituacaoHomologacao;
  readonly requalificar: boolean;
  readonly validoAte: string | null;
}

export interface PainelHomologacaoTela {
  readonly hoje: string;
  readonly usuario: number | null;
  readonly questionarios: QuestionarioTela[];
  readonly faixas: FaixaHomologacao[];
  readonly categorias: { id: number; codigo: string; descricao: string }[];
  readonly homologacoes: HomologacaoTela[];
  readonly ranking: PosicaoRankingTela[];
  readonly pode: { editar: boolean; avaliar: boolean; excecao: boolean };
}

export interface HomologacaoDetalheTela extends HomologacaoTela {
  readonly respostas: {
    sequencia: number;
    pergunta: string;
    resposta: string | null;
    atende: boolean | null;
    pontuacao: number;
    peso: number;
  }[];
}

export interface ResultadoAvaliacaoTela {
  readonly id: number;
  readonly nota: number;
  readonly situacao: 'homologado' | 'reprovado';
  readonly faixa: string | null;
  readonly comRestricao: boolean;
  readonly validoAte: string | null;
  readonly motivos: string[];
  readonly parcelas: string[];
  readonly mensagem: string;
}

const B = '/api/suprimentos/homologacao-fornecedor';

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, corpo: unknown, chave: string): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const lerPainelHomologacao = () => ler<PainelHomologacaoTela>(B);

export const lerHomologacao = (id: number) => ler<HomologacaoDetalheTela>(`${B}/${id}`);

/** Com o questionário de categoria, a API devolve só os fornecedores que fornecem a categoria. */
export const buscarFornecedoresHomologacao = (termo: string, questionario: number | null = null) =>
  ler<{ itens: { id: number; nome: string; documento: string | null; situacao: string }[] }>(
    `${B}/fornecedores?${new URLSearchParams(
      questionario === null ? { termo } : { termo, questionario: String(questionario) },
    ).toString()}`,
  );

export const gravarQuestionarioTela = (
  e: QuestionarioHomologacaoEntrada,
  chave = novaChaveContrato('homol-quest'),
) => enviar<{ id: number; mensagem: string }>(`${B}/questionarios`, e, chave);

export const encerrarQuestionarioTela = (
  id: number,
  fim: string,
  versao: number,
  chave = novaChaveContrato('homol-quest-fim'),
) =>
  enviar<{ id: number; mensagem: string }>(`${B}/questionarios/${id}/encerramento`, { fim, versao }, chave);

export const avaliarFornecedorTela = (
  e: {
    fornecedor: number;
    questionario: number;
    insumo: number | null;
    respostas: RespostaHomologacaoEntrada[];
  },
  chave = novaChaveContrato('homol-avaliar'),
) => enviar<ResultadoAvaliacaoTela>(`${B}/avaliacoes`, e, chave);

export const aprovarExcecaoTela = (
  id: number,
  justificativa: string,
  versao: number,
  chave = novaChaveContrato('homol-excecao'),
) =>
  enviar<{ id: number; validoAte: string | null; mensagem: string }>(
    `${B}/${id}/excecao`,
    { justificativa, versao },
    chave,
  );

export const cancelarHomologacaoTela = (
  id: number,
  motivo: string,
  versao: number,
  chave = novaChaveContrato('homol-cancelar'),
) => enviar<{ id: number; mensagem: string }>(`${B}/${id}/cancelamento`, { motivo, versao }, chave);
