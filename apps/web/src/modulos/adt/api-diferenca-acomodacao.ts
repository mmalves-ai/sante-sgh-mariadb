// Cliente das rotas da diferença de acomodação cobrada do paciente (F3.4, 04-INT linha 81):
// /api/internacao/diferenca-acomodacao.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const S = '/api/internacao/diferenca-acomodacao';
const ok = z.object({ ok: z.boolean(), mensagem: z.string() }).passthrough();
const opcao = z.object({ id: z.number(), rotulo: z.string() });
const situacao = z.enum(['proposta', 'aceita', 'recusada', 'encerrada', 'cancelada']);

export const esquemaDiferencas = z.object({
  atendimento: z.string(),
  internacao: z.number(),
  situacaoInternacao: z.string(),
  acomodacaoAtual: opcao.nullable(),
  diferencas: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      direito: opcao,
      utilizada: opcao,
      item: opcao.nullable(),
      valorDiario: z.number(),
      inicio: z.string(),
      fim: z.string().nullable(),
      situacao,
      aceiteEm: z.string().nullable(),
      responsavel: z.string().nullable(),
      conta: z.string().nullable(),
      diasCobrados: z.number(),
      totalCobrado: z.number(),
    }),
  ),
  contasParticulares: z.array(opcao),
  acomodacoes: z.array(opcao),
  itens: z.array(opcao),
  hoje: z.string(),
});
export type DiferencasTela = z.infer<typeof esquemaDiferencas>;

export const lerDiferencas = (numero: string) =>
  ler(`${S}?atendimento=${encodeURIComponent(numero)}`, esquemaDiferencas);
export const registrarDiferenca = (corpo: {
  internacao: number;
  direito: number;
  utilizada: number;
  item: number | null;
  valorDiario: number;
  inicio: string;
  fim: string | null;
}) => enviar(S, corpo, ok, novaChave('diferenca-registrar'));
export const aceitarDiferenca = (corpo: {
  diferenca: number;
  versao: number;
  responsavel: string;
  conta: number | null;
}) => enviar(`${S}/aceite`, corpo, ok, novaChave('diferenca-aceite'));
export const decidirDiferenca = (corpo: {
  diferenca: number;
  versao: number;
  acao: 'recusar' | 'encerrar' | 'cancelar';
  fim?: string | null;
}) => enviar(`${S}/decisao`, corpo, ok, novaChave('diferenca-decisao'));
