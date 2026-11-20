// W0-04 (M5): o cliente da comissão de revisão de prontuários, validado na chegada. As gravações levam a
// Idempotency-Key (uma por intenção) e, nas críticas (cancelar o sorteio, dar o aval), a senha no corpo, que o servidor
// confere e descarta (reautenticação em diálogo).
import {
  CODIGOS_RESULTADO_REVISAO,
  type ItemChecklistRevisao,
  type RespostaItemRevisao,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../../exames/api-exames.js';

const R = '/api/qualidade/revisao-prontuarios';
const n = z.number();
const s = z.string();
const sN = z.string().nullable();
const b = z.boolean();

const esquemaItem = z.object({ codigo: s, titulo: s });
const esquemaComissoes = z.object({
  itens: z.array(z.object({ id: n, nome: s, ativa: b })),
  sugerido: z.array(esquemaItem),
  tetoAmostra: n,
  ligada: b,
  motivo: sN,
  podeRegistrar: b,
});
export type ComissoesRevisaoTela = z.infer<typeof esquemaComissoes>;

const esquemaChecklist = z.object({
  id: n,
  comissao: n,
  revisao: n,
  itens: z.array(esquemaItem),
  situacao: z.enum(['vigente', 'substituida', 'inativa']),
  motivo: sN,
  publicadoPor: s,
  publicadoEm: s,
  inativadoPor: sN,
  inativadoEm: sN,
  /** Revisão do W0-04: o motivo da inativação (o `motivo` é o da publicação). */
  motivoInativacao: sN.optional().default(null),
  versao: n,
});
export type ChecklistRevisaoTela = z.infer<typeof esquemaChecklist>;

const esquemaAltas = z.object({
  competencia: s,
  universo: n,
  cortada: b,
  sugerida: n,
  porClinica: z.array(z.object({ clinica: s, altas: n })),
});
export type AltasRevisaoTela = z.infer<typeof esquemaAltas>;

const esquemaSorteio = z.object({
  id: n,
  comissao: n,
  checklist: n,
  checklistRevisao: n,
  competencia: s,
  semente: s,
  quantidade: n,
  universo: n,
  resumoUniverso: s,
  sorteadoPor: s,
  sorteadoEm: s,
  canceladoEm: sN,
  canceladoPor: sN,
  motivoCancelamento: sN,
  revisados: n,
  versao: n,
});
export type SorteioRevisaoTela = z.infer<typeof esquemaSorteio>;

const esquemaPendencia = z.object({
  id: n,
  prontuario: n,
  reg: n,
  item: s,
  descricao: s,
  profissionalNome: sN,
  profissionalLogin: sN,
  prazo: s,
  situacao: z.enum(['aberta', 'resolvida', 'cancelada']),
  vencida: b,
  resposta: sN,
  resolvidaPor: sN,
  resolvidaEm: sN,
  canceladaPor: sN,
  canceladaEm: sN,
  motivoCancelamento: sN,
  criadaEm: s,
  versao: n,
});
export type PendenciaRevisaoTela = z.infer<typeof esquemaPendencia>;

const esquemaResposta = z.object({
  item: s,
  resultado: z.enum(CODIGOS_RESULTADO_REVISAO),
  observacao: sN,
});
const esquemaProntuario = z.object({
  id: n,
  ordem: n,
  reg: n,
  alta: s,
  clinica: s,
  medico: sN,
  situacao: z.enum(['aRevisar', 'conforme', 'naoConforme']),
  respostas: z.array(esquemaResposta),
  observacao: sN,
  revisadoPor: sN,
  revisadoEm: sN,
  avalPor: sN,
  avalEm: sN,
  podeAval: b,
  pendencias: z.array(esquemaPendencia),
  versao: n,
});
export type ProntuarioRevisaoTela = z.infer<typeof esquemaProntuario>;

const esquemaDetalhe = z.object({
  sorteio: esquemaSorteio,
  checklist: esquemaChecklist.nullable(),
  prontuarios: z.array(esquemaProntuario),
  podeRegistrar: b,
});
export type DetalheSorteioTela = z.infer<typeof esquemaDetalhe>;

const esquemaConformidade = z.object({
  clinica: s,
  revisados: n,
  conformes: n,
  percentual: n.nullable(),
  conta: sN,
});
const esquemaIndicador = z.object({
  competencia: s,
  total: esquemaConformidade,
  porClinica: z.array(esquemaConformidade),
  pendenciasAbertas: n,
  pendenciasVencidas: n,
});
export type IndicadorRevisaoTela = z.infer<typeof esquemaIndicador>;

const esquemaConferencia = z.object({
  semente: s,
  universoIgual: b,
  amostraIgual: b,
  universo: n,
  universoNoSorteio: n,
  /** Revisão do W0-04: a leitura de hoje cortada pelo teto não prova a reprodução. */
  cortada: b.optional().default(false),
});
export type ConferenciaSorteioTela = z.infer<typeof esquemaConferencia>;

const esquemaGravado = z.object({ versao: n });

export const lerComissoesRevisao = () => ler(`${R}/comissoes`, esquemaComissoes);
export const lerChecklistsRevisao = (comissao: number) =>
  ler(`${R}/checklists${qs({ comissao })}`, z.object({ itens: z.array(esquemaChecklist) }));
export const lerAltasRevisao = (competencia: string) => ler(`${R}/altas${qs({ competencia })}`, esquemaAltas);
export const lerSorteiosRevisao = (comissao: number) =>
  ler(`${R}/sorteios${qs({ comissao })}`, z.object({ itens: z.array(esquemaSorteio) }));
export const lerSorteioRevisao = (id: number) => ler(`${R}/sorteios/${String(id)}`, esquemaDetalhe);
export const conferirSorteioRevisao = (id: number) =>
  ler(`${R}/sorteios/${String(id)}/conferencia`, esquemaConferencia);
export const lerIndicadorRevisao = (comissao: number, competencia: string) =>
  ler(`${R}/indicador${qs({ comissao, competencia })}`, esquemaIndicador);
export const lerMinhasPendencias = () =>
  ler(`${R}/minhas-pendencias`, z.object({ itens: z.array(esquemaPendencia) }));

export const publicarChecklistRevisao = (
  e: {
    comissao: number;
    itens: ItemChecklistRevisao[];
    motivo: string | null;
    vigente: { id: number; versao: number } | null;
  },
  chave: string,
) => enviar(`${R}/checklists`, e, z.object({ id: n, revisao: n }), chave);
export const inativarChecklistRevisao = (id: number, versao: number, justificativa: string, chave: string) =>
  enviar(`${R}/checklists/${String(id)}/inativacao`, { versao, justificativa }, esquemaGravado, chave);
export const sortearRevisao = (
  e: { comissao: number; competencia: string; quantidade: number; semente: string | null },
  chave: string,
) => enviar(`${R}/sorteios`, e, z.object({ id: n, semente: s, quantidade: n, universo: n }), chave);
export const cancelarSorteioRevisao = (
  id: number,
  versao: number,
  m: { justificativa: string; senha: string },
  chave: string,
) => enviar(`${R}/sorteios/${String(id)}/cancelamento`, { versao, ...m }, esquemaGravado, chave);
export const revisarProntuario = (
  id: number,
  e: {
    versao: number;
    respostas: RespostaItemRevisao[];
    observacao: string | null;
    justificativa: string | null;
  },
  chave: string,
) =>
  enviar(
    `${R}/prontuarios/${String(id)}/revisao`,
    e,
    // Revisão do W0-04: se o médico foi avisado na central e se a pendência ficou sem destinatário.
    z.object({
      versao: n,
      avisado: b.optional().default(false),
      semDestinatario: b.optional().default(false),
    }),
    chave,
  );
export const avalRevisao = (id: number, versao: number, senha: string, chave: string) =>
  enviar(`${R}/prontuarios/${String(id)}/aval`, { versao, senha }, esquemaGravado, chave);
export const responderPendencia = (id: number, versao: number, resposta: string, chave: string) =>
  enviar(`${R}/pendencias/${String(id)}/resposta`, { versao, resposta }, esquemaGravado, chave);
export const cancelarPendencia = (id: number, versao: number, justificativa: string, chave: string) =>
  enviar(`${R}/pendencias/${String(id)}/cancelamento`, { versao, justificativa }, esquemaGravado, chave);
