// Cliente dos documentos obrigatórios antes da cirurgia (C1-128, 04-CC linha 104): os exigidos com o estado na data da
// cirurgia, o registro (apresentado, dispensado, recusado; com o digitalizado do paciente) e a configuração dos tipos
// e das regras do estabelecimento (/api/cirurgia/agendamentos/:id/documentos e /api/cirurgia/documentos-exigidos).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const registro = z.object({
  id: z.number(),
  sequencia: z.number(),
  tipo: z.number(),
  situacao: z.string(),
  apresentadoEm: z.string().nullable(),
  validoAte: z.string().nullable(),
  arquivo: z.number().nullable(),
  observacao: z.string().nullable(),
  conferidoEm: z.string().nullable(),
  conferente: z.string().nullable(),
});
export type RegistroDocumentoCirurgia = z.infer<typeof registro>;

const esquemaDocumentos = z.object({
  agendamento: z.number(),
  numero: z.string(),
  situacao: z.string(),
  natureza: z.string(),
  dataCirurgia: z.string().nullable(),
  documentos: z.array(
    z.object({
      tipo: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      categoria: z.string(),
      validadeDias: z.number().nullable(),
      bloqueia: z.boolean(),
      geraPendencia: z.boolean(),
      estado: z.enum(['pendente', 'apresentado', 'vencido', 'dispensado', 'recusado']),
      vigente: registro.nullable(),
    }),
  ),
  historico: z.array(registro),
  tipos: z.array(
    z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), categoria: z.string() }),
  ),
  digitalizados: z.array(
    z.object({
      id: z.number(),
      descricao: z.string().nullable(),
      data: z.string().nullable(),
      tipo: z.string(),
    }),
  ),
});
export type DocumentosDaCirurgia = z.infer<typeof esquemaDocumentos>;

const opcao = z.object({ id: z.number(), rotulo: z.string() });
const esquemaConfiguracao = z.object({
  tipos: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      categoria: z.string(),
      ativo: z.boolean(),
      obrigatorio: z.boolean(),
      validadeDias: z.number().nullable(),
      geraPendencia: z.boolean(),
    }),
  ),
  regras: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      tipo: z.number(),
      tipoDescricao: z.string(),
      procedimento: z.number().nullable(),
      procedimentoDescricao: z.string().nullable(),
      fontePagadora: z.number().nullable(),
      fonteNome: z.string().nullable(),
      faixaEtaria: z.number().nullable(),
      faixaDescricao: z.string().nullable(),
      validadeDias: z.number().nullable(),
      bloqueiaEntradaSala: z.boolean(),
      geraPendencia: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  opcoes: z.object({ procedimentos: z.array(opcao), fontes: z.array(opcao), faixas: z.array(opcao) }),
});
export type ConfiguracaoDocumentos = z.infer<typeof esquemaConfiguracao>;

const gravado = z.object({ id: z.number().nullable() }).passthrough();

export const lerDocumentosDaCirurgia = (agendamento: number) =>
  ler(`/api/cirurgia/agendamentos/${agendamento}/documentos`, esquemaDocumentos);

export interface RegistroDocumentoPedido {
  tipo: number;
  situacao: 'apresentado' | 'dispensado' | 'recusado';
  apresentadoEm?: string | null;
  validoAte?: string | null;
  observacao?: string | null;
  digitalizado?: number | null;
}

export const registrarDocumentoDaCirurgia = (agendamento: number, p: RegistroDocumentoPedido) =>
  enviar(`/api/cirurgia/agendamentos/${agendamento}/documentos`, p, gravado, novaChave('documento-cirurgia'));

const C = '/api/cirurgia/documentos-exigidos';
export const lerConfiguracaoDocumentos = () => ler(C, esquemaConfiguracao);

export const incluirTipoDocumento = (p: {
  codigo: string;
  descricao: string;
  categoria: string;
  validadeDias: number | null;
  obrigatorio: boolean;
}) => enviar(`${C}/tipos`, p, gravado, novaChave('documento-tipo'));

export const incluirRegraDocumento = (p: {
  tipo: number;
  procedimento: number | null;
  fontePagadora: number | null;
  faixaEtaria: number | null;
  validadeDias: number | null;
  bloqueiaEntradaSala: boolean;
  geraPendencia: boolean;
}) => enviar(`${C}/regras`, p, gravado, novaChave('documento-regra'));

export const ativarRegraDocumento = (regra: number, versao: number, ativo: boolean) =>
  enviar(`${C}/regras/${regra}/ativo`, { versao, ativo }, gravado, novaChave('documento-regra-ativo'));
