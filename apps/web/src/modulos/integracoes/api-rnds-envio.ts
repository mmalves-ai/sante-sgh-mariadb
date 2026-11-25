// Cliente das rotas do envio à RNDS (F7, 08-INTG L130): /api/integracoes/rnds (rnds-envio.controller.ts). A visão por
// paciente traz só o TIPO da identificação (cpf, cns ou nenhuma), nunca o número. Gravações com CSRF e Idempotency-Key.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/integracoes/rnds';

export const TIPOS_VERSAO_RNDS = ['original', 'substituicao', 'cancelamento'] as const;
export type TipoVersaoRnds = (typeof TIPOS_VERSAO_RNDS)[number];
export const SITUACOES_ENVIO_RNDS = [
  'pendente',
  'enviado',
  'aceito',
  'rejeitado',
  'substituido',
  'cancelado',
  'erro',
] as const;
/** O motivo da substituição e do cancelamento (conferido na tela; o servidor confere de novo). */
export const MOTIVO_MINIMO_RNDS = 10;

const tipoVersao = z.enum(TIPOS_VERSAO_RNDS);

export const esquemaEnvioRnds = z.object({
  id: z.number(),
  tipo: z.string(),
  paciente: z.number(),
  registro: z.number().nullable(),
  identificadorLocal: z.string(),
  identificadorNacional: z.string().nullable(),
  versaoAtual: z.number(),
  situacao: z.string(),
  situacaoVersao: z.string().nullable(),
  tipoVersao: tipoVersao.nullable(),
  tentativas: z.number(),
  enviadoEm: z.string().nullable(),
  aceitoEm: z.string().nullable(),
  motivo: z.string().nullable(),
});
export type EnvioRnds = z.infer<typeof esquemaEnvioRnds>;

export const esquemaVersaoRnds = z.object({
  numero: z.number(),
  tipo: tipoVersao,
  situacao: z.string(),
  ocorridoEm: z.string().nullable(),
  respondidoEm: z.string().nullable(),
  codigoRetorno: z.string().nullable(),
  mensagem: z.string().nullable(),
  identificadorNacional: z.string().nullable(),
  motivo: z.string().nullable(),
});
export type VersaoRnds = z.infer<typeof esquemaVersaoRnds>;

export const esquemaDocumentoRnds = z.object({
  tipo: z.enum(['sumario_alta', 'resultado_exame']),
  registro: z.number(),
  descricao: z.string(),
  data: z.string().nullable(),
  situacaoRegistro: z.string(),
  envio: esquemaEnvioRnds.nullable(),
  bloqueio: z.string().nullable(),
  acoes: z.array(tipoVersao),
});
export type DocumentoRnds = z.infer<typeof esquemaDocumentoRnds>;

export const esquemaPacienteRnds = z.object({
  paciente: z.number(),
  identificacao: z.enum(['cpf', 'cns', 'nenhuma']),
  documentos: z.array(esquemaDocumentoRnds),
});
export type PacienteRnds = z.infer<typeof esquemaPacienteRnds>;

export const lerPacienteRnds = (id: number) => ler(`${B}/pacientes/${id}`, esquemaPacienteRnds);

export const lerEnviosRnds = async (paciente: number | null, situacao: string | null) => {
  const q = new URLSearchParams();
  if (paciente) q.set('paciente', String(paciente));
  if (situacao) q.set('situacao', situacao);
  return (await ler(`${B}/envios?${q.toString()}`, z.object({ itens: z.array(esquemaEnvioRnds) }))).itens;
};

export const lerVersoesRnds = async (envio: number) =>
  (await ler(`${B}/envios/${envio}/versoes`, z.object({ itens: z.array(esquemaVersaoRnds) }))).itens;

export const solicitarEnvioRnds = (d: {
  tipo: DocumentoRnds['tipo'];
  registro: number;
  operacao: TipoVersaoRnds;
  motivo: string | null;
}) =>
  enviar(
    `${B}/envios`,
    d,
    z.object({ id: z.number(), versao: z.number(), tipoVersao: tipoVersao, mensagem: z.number() }),
    novaChave('rnds'),
  );
