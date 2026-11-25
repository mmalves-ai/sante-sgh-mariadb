// Cliente da auditoria da profilaxia antimicrobiana cirúrgica (C2-012, 04-CC linha 106): o painel da CCIH (cirurgias
// do período com a auditoria vigente e os indicadores), a auditoria do ato e o protocolo do estabelecimento
// (/api/cirurgia/profilaxia).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const criterio = z.boolean().nullable();
const auditoria = z.object({
  id: z.number(),
  versao: z.number(),
  situacao: z.string(),
  avaliavel: z.boolean(),
  antimicrobiano: z.string().nullable(),
  administradoEm: z.string().nullable(),
  drogaAdequada: criterio,
  doseAdequada: criterio,
  momentoAdequado: criterio,
  viaAdequada: criterio,
  repiqueAdequado: criterio,
  duracaoAdequada: criterio,
  avaliadoEm: z.string().nullable(),
  justificativa: z.string().nullable(),
});
export type AuditoriaProfilaxia = z.infer<typeof auditoria>;

const esquemaPainel = z.object({
  de: z.string(),
  ate: z.string(),
  indicadores: z.object({
    cirurgias: z.number(),
    auditadas: z.number(),
    conformes: z.number(),
    naoConformes: z.number(),
    momentoAdequado: z.number(),
    duracaoAdequada: z.number(),
    percentualConforme: z.number().nullable(),
  }),
  cirurgias: z.array(
    z.object({
      ato: z.number(),
      numero: z.string(),
      atendimento: z.number(),
      prontuario: z.string().nullable(),
      paciente: z.string(),
      procedimento: z.string().nullable(),
      incisao: z.string().nullable(),
      fim: z.string().nullable(),
      auditoria: auditoria.nullable(),
    }),
  ),
});
export type PainelProfilaxia = z.infer<typeof esquemaPainel>;

const opcao = z.object({ id: z.number(), rotulo: z.string() });
const esquemaProtocolos = z.object({
  protocolos: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      ativo: z.boolean(),
      procedimento: z.number().nullable(),
      procedimentoDescricao: z.string().nullable(),
      grupo: z.number().nullable(),
      grupoDescricao: z.string().nullable(),
      classeDescricao: z.string().nullable(),
      antimicrobiano: z.number(),
      antimicrobianoDescricao: z.string(),
      dose: z.number(),
      dosePorKg: z.boolean(),
      unidadeSigla: z.string(),
      viaDescricao: z.string().nullable(),
      janelaMaxima: z.number(),
      intervaloRepiqueHoras: z.number().nullable(),
      duracaoMaximaHoras: z.number().nullable(),
      alternativaAlergia: z.boolean(),
      ordem: z.number(),
      vigenciaInicio: z.string(),
      vigenciaFim: z.string().nullable(),
    }),
  ),
  opcoes: z.object({
    procedimentos: z.array(opcao),
    grupos: z.array(opcao),
    classes: z.array(opcao),
    antimicrobianos: z.array(opcao.extend({ janelaLonga: z.boolean() })),
    unidades: z.array(opcao),
    vias: z.array(opcao),
  }),
});
export type ProtocolosProfilaxia = z.infer<typeof esquemaProtocolos>;

const resultadoAuditoria = z
  .object({ id: z.number().nullable(), situacao: z.string(), motivos: z.array(z.string()) })
  .passthrough();
const gravado = z.object({ id: z.number().nullable() }).passthrough();
const P = '/api/cirurgia/profilaxia';

export const lerPainelProfilaxia = (de: string, ate: string) =>
  ler(`${P}/painel?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`, esquemaPainel);

export const auditarProfilaxiaDoAto = (ato: number, justificativa: string | null) =>
  enviar(`${P}/atos/${ato}/auditar`, { justificativa }, resultadoAuditoria, novaChave('profilaxia-auditar'));

export const lerProtocolosProfilaxia = () => ler(`${P}/protocolos`, esquemaProtocolos);

export interface ProtocoloProfilaxiaPedido {
  procedimento: number | null;
  grupo: number | null;
  classeContaminacao: number | null;
  antimicrobiano: number;
  dose: number;
  dosePorKg: boolean;
  unidade: number;
  via: number | null;
  antesMaximo: number | null;
  intervaloRepiqueHoras: number | null;
  duracaoMaximaHoras: number | null;
  alternativaAlergia: boolean;
  ordem: number;
  vigenciaInicio: string;
}

export const incluirProtocoloProfilaxia = (p: ProtocoloProfilaxiaPedido) =>
  enviar(`${P}/protocolos`, p, gravado, novaChave('profilaxia-protocolo'));

/** Ativa ou desativa o protocolo pela versão lida (nada apagado). */
export const ativarProtocoloProfilaxia = (id: number, versao: number, ativo: boolean) =>
  enviar(`${P}/protocolos/${id}/ativo`, { versao, ativo }, gravado, novaChave('profilaxia-protocolo-ativo'));
