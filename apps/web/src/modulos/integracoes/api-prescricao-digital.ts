// Cliente das rotas da prescrição digital por plataforma externa (F8, 08-INTG L132):
// /api/integracoes/prescricao-digital (prescricao-digital.controller.ts). Gravações com CSRF e Idempotency-Key.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/integracoes/prescricao-digital';

export const esquemaEnvioPrescricao = z.object({
  id: z.number(),
  receita: z.number().nullable(),
  plataforma: z.string(),
  plataformaNome: z.string(),
  situacao: z.string(),
  situacaoExterna: z.string().nullable(),
  identificadorExterno: z.string().nullable(),
  codigoValidacao: z.string().nullable(),
  urlValidacao: z.string().nullable(),
  filaSituacao: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  retornoEm: z.string().nullable(),
  canceladoEm: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  criadoEm: z.string(),
  versao: z.number(),
});
export type EnvioPrescricao = z.infer<typeof esquemaEnvioPrescricao>;

export const esquemaReceitaPrescricao = z.object({
  id: z.number(),
  numero: z.string(),
  emitidaEm: z.string(),
  validadeAte: z.string().nullable(),
  situacao: z.string(),
  tipo: z.string(),
  controleEspecial: z.boolean(),
  prescritor: z.string().nullable(),
  assinatura: z.string().nullable(),
  nivelAssinatura: z.string().nullable(),
  envios: z.array(esquemaEnvioPrescricao),
});
export type ReceitaPrescricao = z.infer<typeof esquemaReceitaPrescricao>;

const esquemaPlataforma = z.object({ codigo: z.string(), nome: z.string(), parceiroApiAtivo: z.boolean() });
export type PlataformaPrescricao = z.infer<typeof esquemaPlataforma>;
const esquemaPaciente = z.object({ id: z.number(), nome: z.string(), prontuario: z.string() });
export type PacientePrescricao = z.infer<typeof esquemaPaciente>;

export const lerPlataformasPrescricao = async () =>
  (await ler(`${B}/plataformas`, z.object({ itens: z.array(esquemaPlataforma) }))).itens;

export const buscarPacientesPrescricao = async (termo: string) =>
  termo.trim().length < 2
    ? []
    : (
        await ler(
          `${B}/pacientes?busca=${encodeURIComponent(termo.trim())}`,
          z.object({ itens: z.array(esquemaPaciente) }),
        )
      ).itens;

export const lerReceitasDoPaciente = async (paciente: number) =>
  (await ler(`${B}/paciente/${paciente}`, z.object({ receitas: z.array(esquemaReceitaPrescricao) })))
    .receitas;

const comId = z.object({ id: z.number() }).passthrough();

export const enviarReceitaPlataforma = (receita: number, plataforma: string) =>
  enviar(`${B}/envios`, { receita, plataforma }, comId, novaChave('prescricao-digital'));

export const cancelarEnvioPrescricao = (id: number, motivo: string, versao: number) =>
  enviar(`${B}/envios/${id}/cancelar`, { motivo, versao }, comId, novaChave('prescricao-digital'));
