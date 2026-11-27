// Cliente da declaração de saúde, da doença ou lesão preexistente com a cobertura parcial temporária (CPT) e da
// portabilidade de carências do beneficiário da operadora (08-SGO L95, C2-113; RN ANS 162/2007 e 438/2018), mais o
// pedido de cartão pelas rotas do cadastro complementar. Respostas validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/saude-beneficiario';
const C = '/api/operadora/complementar';
const n = z.number();
const tn = z.string().nullable();
const nn = n.nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();

export const SITUACOES_DECLARACAO = {
  rascunho: 'Rascunho',
  preenchida: 'Preenchida',
  em_analise: 'Em análise',
  analisada: 'Analisada',
  cancelada: 'Cancelada',
} as const;
export const FORMAS_IDENTIFICACAO = {
  declarada: 'Declarada pelo beneficiário',
  entrevista_qualificada: 'Entrevista qualificada',
  pericia: 'Perícia',
  auditoria: 'Auditoria',
} as const;
export const DECISOES_DOENCA = {
  em_analise: 'Em análise',
  cobertura_parcial_temporaria: 'Cobertura parcial temporária (CPT)',
  agravo: 'Agravo na mensalidade',
  sem_restricao: 'Sem restrição',
} as const;
export const SITUACOES_CPT = {
  vigente: 'Vigente',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
  cumprida: 'Cumprida',
} as const;
export const DIRECOES = {
  recebida: 'Recebida (vem de outra operadora)',
  concedida: 'Concedida (vai para outra)',
} as const;
export const MODALIDADES = {
  ordinaria: 'Ordinária',
  especial: 'Especial',
  extraordinaria: 'Extraordinária',
} as const;
export const SITUACOES_PORTABILIDADE = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
} as const;
export const CANAIS_CARTAO = { balcao: 'Balcão', portal: 'Portal', contratante: 'Pelo contratante' } as const;

const esquemaBeneficiarioAchado = z.object({ id: n, matricula: z.string(), situacao: z.string() });
export type BeneficiarioAchado = z.infer<typeof esquemaBeneficiarioAchado>;

const esquemaCid = z.object({ id: n, codigo: z.string(), descricao: z.string() });
export type CidAchado = z.infer<typeof esquemaCid>;

const esquemaQuestionario = z.object({
  id: n,
  codigo: z.string(),
  nome: z.string(),
  perguntas: z.array(
    z.object({
      id: n,
      sequencia: n,
      enunciado: z.string(),
      tipoResposta: z.string(),
      obrigatoria: z.boolean(),
    }),
  ),
});
export type QuestionarioDeclaracao = z.infer<typeof esquemaQuestionario>;

const esquemaPainel = z.object({
  beneficiario: z.object({
    id: n,
    matricula: z.string(),
    situacao: z.string(),
    adesao: tn,
    tipoContratacao: tn,
    participantesNoContrato: n,
  }),
  carencias: z.array(
    z.object({
      id: n,
      categoria: z.string(),
      dias: n,
      aproveitados: n,
      cumpridaEm: z.string(),
      cumprida: z.boolean(),
      portabilidade: nn,
    }),
  ),
  declaracoes: z.array(
    z.object({
      id: n,
      versao: n,
      preenchidaEm: z.string(),
      situacao: z.string(),
      entrevistaQualificada: z.boolean(),
      imc: nn,
      respostasSim: n,
    }),
  ),
  doencas: z.array(
    z.object({
      id: n,
      versao: n,
      declaracao: nn,
      cid: z.string(),
      descricao: z.string(),
      inicio: z.string(),
      forma: z.string(),
      decisao: z.string(),
      percentualAgravo: nn,
      cpt: nn,
    }),
  ),
  cpts: z.array(
    z.object({
      id: n,
      versao: n,
      cid: z.string(),
      inicio: z.string(),
      fimPrevisto: z.string(),
      prazoMeses: n,
      situacao: z.string(),
      encerradaEm: tn,
      vigenteHoje: z.boolean(),
    }),
  ),
  portabilidades: z.array(
    z.object({
      id: n,
      versao: n,
      numero: z.string(),
      direcao: z.string(),
      modalidade: z.string(),
      registroAnsOrigem: z.string(),
      nomeOperadoraOrigem: tn,
      solicitadoEm: z.string(),
      prazoResposta: tn,
      situacao: z.string(),
      motivoRecusa: tn,
      vencida: z.boolean(),
    }),
  ),
  cartoes: z.array(
    z.object({
      id: n,
      numero: z.string(),
      situacao: z.string(),
      solicitadoEm: tn,
      viaEmitida: nn,
    }),
  ),
});
export type PainelSaude = z.infer<typeof esquemaPainel>;

export interface NovaDeclaracao {
  questionario: number;
  preenchidaEm: string;
  pesoKg: number | null;
  alturaM: number | null;
  entrevistaQualificada: boolean;
  medicoOrientador: number | null;
  dispensouOrientacao: boolean;
  respostas: {
    pergunta: number;
    afirmativa: boolean | null;
    texto: string | null;
    complemento: string | null;
  }[];
  doencas: { termo: number; inicio: string; forma: string }[];
}
export interface DecisaoDoenca {
  versao: number;
  decisao: string;
  prazoMeses: number | null;
  percentualAgravo: number | null;
  observacao: string | null;
}
export interface EncerramentoCpt {
  versao: number;
  situacao: 'encerrada' | 'cancelada';
  data: string;
  motivo: string;
}
export interface NovaPortabilidade {
  direcao: string;
  modalidade: string;
  registroAnsOrigem: string;
  nomeOperadoraOrigem: string | null;
  registroProdutoOrigem: string | null;
  vinculoInicio: string | null;
  faixaPrecoCompativel: boolean;
  adimplente: boolean;
  solicitadoEm: string;
  observacao: string | null;
}
export interface DecisaoPortabilidade {
  versao: number;
  situacao: string;
  motivoRecusa: string | null;
  cumpriuCptNaOrigem: boolean;
  jaPortouAntes: boolean;
}
export interface PedidoCartao {
  primeiraVia: boolean;
  motivo: number | null;
  canal: string;
  observacao: string | null;
}

export const buscarBeneficiario = (matricula: string) =>
  ler(`${A}?${new URLSearchParams({ matricula }).toString()}`, z.array(esquemaBeneficiarioAchado));
export const buscarCids = (busca: string) =>
  ler(`${A}/cids?${new URLSearchParams({ busca }).toString()}`, z.array(esquemaCid));
export const lerQuestionariosDeclaracao = () => ler(`${A}/questionarios`, z.array(esquemaQuestionario));
export const lerPainelSaude = (beneficiario: number) => ler(`${A}/${beneficiario}`, esquemaPainel);
export const registrarDeclaracao = (beneficiario: number, d: NovaDeclaracao) =>
  enviar(`${A}/${beneficiario}/declaracoes`, d, gravado, novaChave('saude.declaracao'));
export const decidirDoenca = (doenca: number, d: DecisaoDoenca) =>
  enviar(`${A}/doencas/${doenca}/decisao`, d, gravado, novaChave('saude.doenca'));
export const encerrarCpt = (cpt: number, e: EncerramentoCpt) =>
  enviar(`${A}/cpts/${cpt}/encerramento`, e, gravado, novaChave('saude.cpt'));
export const registrarPortabilidade = (beneficiario: number, p: NovaPortabilidade) =>
  enviar(`${A}/${beneficiario}/portabilidades`, p, gravado, novaChave('saude.portabilidade'));
export const decidirPortabilidade = (portabilidade: number, d: DecisaoPortabilidade) =>
  enviar(
    `${A}/portabilidades/${portabilidade}/decisao`,
    d,
    gravado,
    novaChave('saude.portabilidade-decisao'),
  );
export const solicitarCartao = (beneficiario: number, p: PedidoCartao) =>
  enviar(`${C}/beneficiarios/${beneficiario}/cartoes`, p, gravado, novaChave('saude.cartao'));
export const avancarPedidoCartao = (pedido: number, para: 'emitido' | 'entregue' | 'cancelado') =>
  enviar(`${C}/cartoes/${pedido}/situacao`, { para }, gravado, novaChave('saude.cartao-passo'));
