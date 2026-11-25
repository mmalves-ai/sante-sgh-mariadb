// Cliente das rotas do transplante para a central estadual (F8, 06-SUS linha 65): /api/sus/transplante.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/transplante';
const comId = z.object({ id: z.number() }).passthrough();

export const esquemaNotificacaoDoador = z.object({
  id: z.number(),
  numero: z.string(),
  paciente: z.number(),
  pacienteNome: z.string(),
  prontuario: z.string(),
  tipoDoador: z.string(),
  notificadoEm: z.string(),
  notificante: z.number(),
  notificanteNome: z.string().nullable(),
  atendimento: z.number().nullable(),
  central: z.number().nullable(),
  centralNome: z.string().nullable(),
  protocoloCentral: z.string().nullable(),
  obitoEm: z.string().nullable(),
  protocoloInicioEm: z.string().nullable(),
  protocoloFimEm: z.string().nullable(),
  abordagemFamiliarEm: z.string().nullable(),
  familiaConsentiu: z.boolean().nullable(),
  orgaosDoados: z.array(z.string()),
  desfecho: z.string().nullable(),
  desfechoEm: z.string().nullable(),
  situacao: z.string(),
  observacao: z.string().nullable(),
  versao: z.number(),
});
export type NotificacaoDoador = z.infer<typeof esquemaNotificacaoDoador>;

export const esquemaInscricao = z.object({
  id: z.number(),
  paciente: z.number(),
  pacienteNome: z.string(),
  prontuario: z.string(),
  cns: z.string().nullable(),
  orgao: z.number(),
  orgaoDescricao: z.string(),
  tipoPaciente: z.string(),
  numeroCentral: z.string().nullable(),
  dataInscricao: z.string(),
  prioridade: z.string(),
  situacao: z.string(),
  apto: z.boolean(),
  motivo: z.string().nullable(),
  dataTransplante: z.string().nullable(),
  notificacaoDoador: z.number().nullable(),
  responsavel: z.number().nullable(),
  pendentesEnvio: z.number(),
  versao: z.number(),
});
export type Inscricao = z.infer<typeof esquemaInscricao>;

const esquemaHistorico = z.object({
  id: z.number(),
  operacao: z.string(),
  ocorridoEm: z.string(),
  motivo: z.string().nullable(),
  enviadoCentralEm: z.string().nullable(),
});
export type HistoricoInscricao = z.infer<typeof esquemaHistorico>;

const esquemaOpcoes = z.object({
  orgaos: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), tipo: z.string() })),
  centrais: z.array(z.object({ id: z.number(), sigla: z.string(), nome: z.string() })),
  profissionais: z.array(z.object({ id: z.number(), nome: z.string() })),
});
export type OpcoesTransplante = z.infer<typeof esquemaOpcoes>;
const esquemaPaciente = z.object({
  id: z.number(),
  nome: z.string(),
  prontuario: z.string(),
  cns: z.string().nullable(),
});
export type PacienteTransplante = z.infer<typeof esquemaPaciente>;

export interface CorpoNotificacao {
  tipoDoador: string;
  notificadoEm: string;
  notificante: number;
  central: number | null;
  obitoEm: string | null;
  protocoloInicioEm: string | null;
  protocoloFimEm: string | null;
  abordagemFamiliarEm: string | null;
  familiaConsentiu: boolean | null;
  orgaosDoados: string[];
  desfecho: string | null;
  desfechoEm: string | null;
  situacao: string;
  observacao: string | null;
}
export interface CorpoInscricao {
  dataInscricao: string;
  prioridade: string;
  situacao: string;
  apto: boolean;
  motivo: string | null;
  dataTransplante: string | null;
  notificacaoDoador: number | null;
  responsavel: number | null;
  numeroCentral: string | null;
}

const consulta = (q: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const lerOpcoesTransplante = () => ler(`${B}/opcoes`, esquemaOpcoes);
export const buscarPacientesTransplante = (busca: string) =>
  ler(`${B}/pacientes${consulta({ busca })}`, z.object({ itens: z.array(esquemaPaciente) }));
export const lerNotificacoesDoador = (paciente?: number) =>
  ler(`${B}/notificacoes${consulta({ paciente })}`, z.object({ itens: z.array(esquemaNotificacaoDoador) }));
export const notificarDoador = (corpo: CorpoNotificacao & { paciente: number }) =>
  enviar(
    `${B}/notificacoes`,
    corpo,
    z.object({ id: z.number(), numero: z.string() }).passthrough(),
    novaChave('sus-tx-notificar'),
  );
export const alterarNotificacaoDoador = (id: number, corpo: CorpoNotificacao & { versao: number }) =>
  enviar(`${B}/notificacoes/${id}`, corpo, comId, novaChave('sus-tx-notificacao'));
export const registrarProtocoloDoador = (id: number, corpo: { protocoloCentral: string; versao: number }) =>
  enviar(`${B}/notificacoes/${id}/protocolo`, corpo, comId, novaChave('sus-tx-protocolo'));
export const lerInscricoesTransplante = (f: { situacao?: string; pendentes?: boolean; paciente?: number }) =>
  ler(`${B}/inscricoes${consulta(f)}`, z.object({ itens: z.array(esquemaInscricao) }));
export const lerInscricaoTransplante = (id: number) =>
  ler(`${B}/inscricoes/${id}`, esquemaInscricao.extend({ historico: z.array(esquemaHistorico) }));
export const urlConferenciaTransplante = (f: { situacao?: string; pendentes?: boolean }) =>
  `${B}/inscricoes/conferencia${consulta(f)}`;
export const inscreverReceptor = (corpo: CorpoInscricao & { paciente: number; orgao: number }) =>
  enviar(`${B}/inscricoes`, corpo, comId, novaChave('sus-tx-inscrever'));
export const alterarInscricaoTransplante = (id: number, corpo: CorpoInscricao & { versao: number }) =>
  enviar(`${B}/inscricoes/${id}`, corpo, comId, novaChave('sus-tx-inscricao'));
export const registrarCentralInscricao = (
  id: number,
  corpo: { numeroCentral: string | null; versao: number },
) => enviar(`${B}/inscricoes/${id}/central`, corpo, comId, novaChave('sus-tx-central'));
