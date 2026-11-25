// Cliente do cadastro do fornecedor (05-SUP linha 23): o painel (categorias, bancos e o que o usuário pode), a busca,
// a ficha e as gravações (incluir e alterar o fornecedor com contatos, categorias e autorizações sanitárias; incluir e
// inativar conta bancária ou Pix, a mesma do financeiro; avaliação periódica; ocorrência e andamento). Toda gravação
// leva o CSRF e a Idempotency-Key.
import type {
  AvaliacaoPeriodicaEntrada,
  AvisoFornecedor,
  ContaBancariaFornecedorEntrada,
  FornecedorEntrada,
  OcorrenciaFornecedorEntrada,
  SituacaoNaDataAutorizacao,
  SituacaoOcorrenciaFornecedor,
} from '@sgh/dominio-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveContrato } from './api-contrato.js';

export interface PainelCadastroFornecedorTela {
  readonly hoje: string;
  readonly categorias: readonly { id: number; descricao: string; exigeAutorizacao: boolean }[];
  readonly bancos: readonly { id: number; descricao: string }[];
  readonly pode: { editar: boolean; avaliar: boolean };
}

export interface FornecedorResumoTela {
  readonly id: number;
  readonly versao: number;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly tipoPessoa: 'juridica' | 'fisica';
  readonly documento: string;
  readonly situacao: string;
}

export interface ContaFornecedorTela {
  readonly id: number;
  readonly versao: number;
  readonly banco: string | null;
  readonly tipoConta: string;
  readonly agencia: string | null;
  readonly contaMascarada: string;
  readonly tipoChavePix: string | null;
  readonly titularNome: string;
  readonly preferencial: boolean;
  readonly ativo: boolean;
}

export interface AvaliacaoFornecedorTela {
  readonly id: number;
  readonly avaliadoEm: string;
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
  readonly notas: Record<string, number>;
  readonly media: number;
  readonly resultado: string;
  readonly conta: string;
  readonly mediaPeriodo: number | null;
  readonly parecer: string | null;
  readonly avaliador: number;
}

export interface OcorrenciaFornecedorTela {
  readonly id: number;
  readonly versao: number;
  readonly numero: number;
  readonly tipo: string;
  readonly gravidade: string;
  readonly ocorridoEm: string;
  readonly quantidadeAfetada: number | null;
  readonly valorAfetado: number | null;
  readonly descricao: string;
  readonly situacao: SituacaoOcorrenciaFornecedor;
  readonly notificadoEm: string | null;
  readonly emailNotificacao: string | null;
  readonly tratativa: string | null;
  readonly resolvidaEm: string | null;
}

export interface FornecedorFichaTela extends FornecedorResumoTela {
  readonly dados: Omit<FornecedorEntrada, 'contatos' | 'autorizacoes' | 'categorias' | 'categoriaPrincipal'>;
  readonly categorias: readonly number[];
  readonly categoriaPrincipal: number | null;
  readonly contatos: readonly (FornecedorEntrada['contatos'][number] & { id: number })[];
  readonly autorizacoes: readonly (FornecedorEntrada['autorizacoes'][number] & {
    id: number;
    situacaoNaData: SituacaoNaDataAutorizacao;
    dias: number | null;
  })[];
  readonly contas: readonly ContaFornecedorTela[];
  readonly avaliacoes: readonly AvaliacaoFornecedorTela[];
  readonly ocorrencias: readonly OcorrenciaFornecedorTela[];
  readonly proximaAvaliacao: string | null;
  readonly avisos: readonly AvisoFornecedor[];
}

export interface GravacaoFornecedor {
  readonly ok: true;
  readonly id?: number;
  readonly numero?: number;
  readonly conta?: string;
  readonly resultado?: string;
  readonly mensagem: string;
}

const B = '/api/suprimentos/cadastro-fornecedor';

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

export const lerPainelCadastroFornecedor = () => ler<PainelCadastroFornecedorTela>(B);

export const buscarFornecedoresCadastro = (termo: string) =>
  ler<{ itens: FornecedorResumoTela[] }>(`${B}/busca?termo=${encodeURIComponent(termo)}`);

export const lerFichaFornecedor = (id: number) => ler<FornecedorFichaTela>(`${B}/${id}`);

export const incluirFornecedor = (fornecedor: FornecedorEntrada, chave = novaChaveContrato('forn-incluir')) =>
  enviar<GravacaoFornecedor>(B, fornecedor, chave);

export const alterarFornecedor = (
  id: number,
  versao: number,
  fornecedor: FornecedorEntrada,
  chave = novaChaveContrato('forn-alterar'),
) => enviar<GravacaoFornecedor>(`${B}/${id}/alteracao`, { versao, fornecedor }, chave);

export const incluirContaFornecedor = (
  id: number,
  conta: ContaBancariaFornecedorEntrada,
  chave = novaChaveContrato('forn-conta'),
) => enviar<GravacaoFornecedor>(`${B}/${id}/contas`, conta, chave);

export const inativarContaFornecedor = (
  id: number,
  conta: number,
  versao: number,
  chave = novaChaveContrato('forn-conta-inativar'),
) => enviar<GravacaoFornecedor>(`${B}/${id}/contas/${conta}/inativacao`, { versao }, chave);

export const avaliarFornecedorPeriodo = (
  id: number,
  avaliacao: AvaliacaoPeriodicaEntrada,
  chave = novaChaveContrato('forn-avaliar'),
) => enviar<GravacaoFornecedor>(`${B}/${id}/avaliacoes`, avaliacao, chave);

export const registrarOcorrenciaFornecedor = (
  id: number,
  ocorrencia: OcorrenciaFornecedorEntrada,
  chave = novaChaveContrato('forn-ocorrencia'),
) => enviar<GravacaoFornecedor>(`${B}/${id}/ocorrencias`, ocorrencia, chave);

export const andamentoOcorrenciaFornecedor = (
  ocorrencia: number,
  corpo: {
    situacao: SituacaoOcorrenciaFornecedor;
    tratativa: string | null;
    email: string | null;
    versao: number;
  },
  chave = novaChaveContrato('forn-ocorrencia-andamento'),
) => enviar<GravacaoFornecedor>(`${B}/ocorrencias/${ocorrencia}/andamento`, corpo, chave);
