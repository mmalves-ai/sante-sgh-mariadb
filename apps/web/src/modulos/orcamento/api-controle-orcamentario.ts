// Cliente das rotas do controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130):
// /api/financeiro/controle-orcamentario.
import {
  ACOES_CONTROLE,
  DOCUMENTOS_CONTROLE,
  DOCUMENTOS_RESERVA,
  PERIODOS_APURACAO,
  SITUACOES_EXCECAO,
  SITUACOES_RESERVA,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/financeiro/controle-orcamentario';
const n = z.number().nullable();
const s = z.string().nullable();
const opcao = z.object({ id: z.number(), nome: z.string() });

export const esquemaRegra = z.object({
  id: z.number(),
  versao: z.number(),
  acao: z.enum(ACOES_CONTROLE),
  tipoDocumento: z.enum(DOCUMENTOS_CONTROLE),
  planoOrcamentario: n,
  versaoOrcamento: n,
  centroCusto: n,
  contaOrcamentaria: n,
  naturezaFinanceira: n,
  tolerancia: z.number(),
  periodo: z.enum(PERIODOS_APURACAO),
  prioridade: z.number(),
  vigenciaInicio: z.string(),
  vigenciaFim: s,
  ativo: z.boolean(),
});
export type RegraLida = z.infer<typeof esquemaRegra>;

export const esquemaPainel = z.object({
  regras: z.array(esquemaRegra),
  excecoes: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      numero: z.string(),
      tipoDocumento: z.string(),
      documento: n,
      documentoNumero: s,
      linha: n,
      competencia: z.string(),
      conta: s,
      valor: z.number(),
      saldoDisponivel: n,
      justificativa: z.string(),
      solicitante: z.number(),
      solicitanteNome: s,
      situacao: z.enum(SITUACOES_EXCECAO),
      aprovadorNome: s,
      parecer: s,
      reserva: n,
    }),
  ),
  reservas: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      numero: z.string(),
      tipoDocumento: z.string(),
      documento: n,
      documentoNumero: s,
      linha: z.number(),
      centro: s,
      competencia: z.string(),
      reservado: z.number(),
      consumido: z.number(),
      liberado: z.number(),
      aberto: z.number(),
      excedeuSaldo: z.boolean(),
      situacao: z.enum(SITUACOES_RESERVA),
      motivoLiberacao: s,
    }),
  ),
  linhas: z.array(opcao),
  documentos: z.array(
    z.object({
      tipoDocumento: z.enum(DOCUMENTOS_RESERVA),
      id: z.number(),
      numero: z.string(),
      fornecedor: s,
      valor: z.number(),
      reservado: z.number(),
    }),
  ),
  contas: z.array(opcao),
  centros: z.array(opcao),
  naturezas: z.array(opcao),
  planos: z.array(opcao),
  usuario: n,
});
export type PainelControle = z.infer<typeof esquemaPainel>;

export const esquemaSaldo = z.object({
  orcado: z.number(),
  comprometido: z.number(),
  realizado: z.number(),
  disponivel: z.number(),
  regra: z.object({ id: z.number(), acao: z.enum(ACOES_CONTROLE), tolerancia: z.number() }).nullable(),
  acao: z.enum(ACOES_CONTROLE),
  periodo: z.enum(PERIODOS_APURACAO),
});
export type SaldoLido = z.infer<typeof esquemaSaldo>;

const gravado = z.object({ id: z.number().nullable().optional() }).passthrough();

export const lerPainelControle = () => ler(B, esquemaPainel);
export const lerSaldoControle = (q: {
  linha: number;
  competencia: string;
  tipoDocumento: string;
  conta: number | null;
}) =>
  ler(
    `${B}/saldo?linha=${q.linha}&competencia=${q.competencia}&tipoDocumento=${q.tipoDocumento}${
      q.conta ? `&conta=${q.conta}` : ''
    }`,
    esquemaSaldo,
  );

export interface RegraProposta {
  acao: string;
  tipoDocumento: string;
  planoOrcamentario: number | null;
  versaoOrcamento: number | null;
  centroCusto: number | null;
  contaOrcamentaria: number | null;
  naturezaFinanceira: number | null;
  tolerancia: number;
  periodo: string;
  prioridade: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
  versao?: number;
}
export const salvarRegraControle = (alvo: number | null, r: RegraProposta) =>
  enviar(alvo === null ? `${B}/regras` : `${B}/regras/${alvo}`, r, gravado, novaChave('orc-regra'));

export interface ReservaProposta {
  tipoDocumento: string;
  documento: number;
  linha: number;
  competencia: string;
  contaOrcamentaria: number | null;
  valor: number | null;
  ciente: boolean;
}
export const reservarOrcamento = (r: ReservaProposta) =>
  enviar(`${B}/reservas`, r, gravado, novaChave('orc-reservar'));
/** Reserva pelo documento: o sistema acha a linha oficial do centro (o mesmo caminho da aprovação). */
export const controlarDocumento = (d: { tipoDocumento: string; documento: number; ciente: boolean }) =>
  enviar(`${B}/documento`, d, gravado, novaChave('orc-documento'));
export const pedirExcecao = (
  r: Omit<ReservaProposta, 'ciente' | 'valor' | 'contaOrcamentaria'> & {
    contaOrcamentaria: number;
    valor: number;
    justificativa: string;
  },
) => enviar(`${B}/excecoes`, r, gravado, novaChave('orc-excecao'));
export const decidirExcecao = (id: number, d: { versao: number; aprovar: boolean; parecer: string | null }) =>
  enviar(`${B}/excecoes/${id}/decidir`, d, gravado, novaChave('orc-decidir'));
export const registrarNotaReserva = (
  id: number,
  d: {
    versao: number;
    valorRealizado: number;
    final: boolean;
    numeroDocumento: string | null;
    ciente: boolean;
  },
) => enviar(`${B}/reservas/${id}/nota`, d, gravado, novaChave('orc-nota'));
export const liberarReserva = (id: number, d: { versao: number; motivo: string }) =>
  enviar(`${B}/reservas/${id}/liberar`, d, gravado, novaChave('orc-liberar'));
