// Cliente das rotas da regulação de entrada (C1-080, 02-REC linha 38): /api/nir/regulacao/recebidos.
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const R = '/api/nir/regulacao/recebidos';

export const esquemaOpcoesRegulacaoEntrada = z.object({
  centrais: z.array(
    z.object({
      id: z.number(),
      sigla: z.string(),
      nome: z.string(),
      conexao: z.string(),
      telefone: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  especialidades: z.array(z.object({ id: z.number(), nome: z.string() })),
});
export type OpcoesRegulacaoEntrada = z.infer<typeof esquemaOpcoesRegulacaoEntrada>;

export const esquemaRegulacaoRecebida = z.object({
  id: z.number(),
  versao: z.number(),
  central: z.object({ id: z.number(), sigla: z.string(), nome: z.string(), conexao: z.string() }),
  numero: z.string(),
  tipo: z.string(),
  prioridade: z.string().nullable(),
  situacao: z.string(),
  paciente: z.object({ id: z.number(), prontuario: z.number(), nome: z.string() }),
  solicitadoEm: z.string(),
  reguladoEm: z.string().nullable(),
  encerradoEm: z.string().nullable(),
  resumoClinico: z.string().nullable(),
  observacao: z.string().nullable(),
  mensagemCentral: z.string().nullable(),
  listaEspera: z.number().nullable(),
  eventos: z.array(
    z.object({
      id: z.number(),
      tipo: z.string(),
      anterior: z.string().nullable(),
      nova: z.string().nullable(),
      observacao: z.string().nullable(),
      motivo: z.string().nullable(),
      devolucao: z.string().nullable(),
      por: z.string().nullable(),
      em: z.string(),
    }),
  ),
});
export type RegulacaoRecebida = z.infer<typeof esquemaRegulacaoRecebida>;

export interface RecebimentoRegulacaoEntrada {
  central: number;
  numero: string;
  tipo: string;
  prioridade: string;
  paciente: number;
  solicitadoEm: string | null;
  resumoClinico: string | null;
  observacao: string | null;
}

export interface RespostaRegulacaoEntrada {
  decisao: 'aceitar' | 'recusar';
  motivo: string | null;
  complemento: string | null;
  especialidade: number | null;
  versao: number;
}

const comId = z.object({ id: z.number() }).passthrough();
const resposta = z
  .object({
    id: z.number(),
    situacao: z.string(),
    listaEspera: z.number().nullable(),
    devolucao: z.string(),
  })
  .passthrough();

export const lerOpcoesRegulacaoEntrada = () => ler(`${R}/opcoes`, esquemaOpcoesRegulacaoEntrada);
export const listarRegulacoesRecebidas = (f: { todos?: 'sim' }) =>
  ler(`${R}${qs(f)}`, z.object({ itens: z.array(esquemaRegulacaoRecebida) }));
export const receberRegulacao = (corpo: RecebimentoRegulacaoEntrada) =>
  enviar(R, corpo, comId, novaChave('regulacao-receber'));
export const responderRegulacao = (id: number, corpo: RespostaRegulacaoEntrada) =>
  enviar(`${R}/${id}/resposta`, corpo, resposta, novaChave('regulacao-responder'));
