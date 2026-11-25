// Cliente das rotas dos laudos específicos e das sessões da APAC (F7, 06-SUS linha 56): /api/sus/apac-complementos.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/apac-complementos';
export type LaudoEspecifico = 'oncologia' | 'auditiva' | 'medicamento' | 'odontologia';
export const LAUDOS: readonly LaudoEspecifico[] = ['oncologia', 'auditiva', 'medicamento', 'odontologia'];

const dados = z.record(z.string(), z.unknown());
export const esquemaSessaoApac = z.object({
  id: z.number(),
  data: z.string(),
  procedimento: z.string(),
  quantidade: z.number(),
  comparecimento: z.string(),
  modalidade: z.string().nullable(),
  kits: z.number().nullable(),
  competencia: z.string(),
  tipoApac: z.string(),
  aberta: z.boolean(),
  registradaPor: z.string().nullable(),
  versao: z.number(),
});
export type SessaoApac = z.infer<typeof esquemaSessaoApac>;
const opcao = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
export const esquemaComplementosApac = z.object({
  id: z.number(),
  versao: z.number(),
  situacao: z.string(),
  procedimento: z.string(),
  familia: z.string(),
  exigido: z.enum(['oncologia', 'auditiva', 'medicamento', 'odontologia', 'nefrologia']).nullable(),
  pendente: z.boolean(),
  validadeInicio: z.string().nullable(),
  validadeFim: z.string().nullable(),
  laudos: z.object({
    oncologia: dados.nullable(),
    auditiva: dados.nullable(),
    medicamento: dados.nullable(),
    odontologia: dados.nullable(),
  }),
  sessoes: z.array(esquemaSessaoApac),
  opcoes: z.record(z.string(), z.array(opcao)),
});
export type ComplementosApac = z.infer<typeof esquemaComplementosApac>;

const comId = z.object({ id: z.number() }).passthrough();

export const lerComplementosApac = (laudo: number) => ler(`${B}/${laudo}`, esquemaComplementosApac);
export const gravarLaudoEspecifico = (
  laudo: number,
  tipo: LaudoEspecifico,
  corpo: { versao: number; dados: Record<string, unknown> },
) => enviar(`${B}/${laudo}/laudos/${tipo}`, corpo, comId, novaChave('sus-apac-laudo'));
export const retirarLaudoEspecifico = (laudo: number, tipo: LaudoEspecifico, versao: number) =>
  enviar(`${B}/${laudo}/laudos/${tipo}/retirar`, { versao }, comId, novaChave('sus-apac-laudo-retirar'));
export const registrarSessaoApac = (
  laudo: number,
  corpo: {
    versao: number;
    data: string;
    procedimento: string;
    quantidade: number;
    comparecimento: 'compareceu' | 'faltou' | 'falta_justificada';
    modalidade: string | null;
    kits: number | null;
  },
) => enviar(`${B}/${laudo}/sessoes`, corpo, comId, novaChave('sus-apac-sessao'));
export const cancelarSessaoApac = (id: number, versao: number) =>
  enviar(`${B}/sessoes/${id}/cancelar`, { versao }, comId, novaChave('sus-apac-sessao-cancelar'));
