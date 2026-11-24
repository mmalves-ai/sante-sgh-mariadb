// Cliente das rotas dos controles da internação (F78.04-1; 04-INT linhas 74, 75 e 78): /api/internacao/controles.
// Formulários numerados da declaração de óbito, auditoria do isolamento (com os avisos à CCIH) e quadro clínico e
// evolução da regulação.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/internacao/controles';
const n = z.number();
const txt = z.string();

// ── Formulários de declaração de óbito ──
export const SITUACOES_FORMULARIO = [
  'disponivel',
  'utilizado',
  'cancelado',
  'extraviado',
  'devolvido',
] as const;
export const esquemaFormularioObito = z.object({
  id: n,
  numero: txt,
  lote: txt.nullable(),
  recebidoEm: txt,
  orgao: txt.nullable(),
  situacao: z.enum(SITUACOES_FORMULARIO),
  declaracao: z.object({ id: n, numero: txt, situacao: txt, paciente: n }).nullable(),
  utilizadoEm: txt.nullable(),
  motivo: txt.nullable(),
  versao: n,
});
export type FormularioObito = z.infer<typeof esquemaFormularioObito>;
const esquemaFormularios = z.object({
  itens: z.array(esquemaFormularioObito),
  resumo: z.object({
    porSituacao: z.record(z.string(), n),
    viasADevolver: n,
    estoqueBaixo: z.boolean(),
  }),
  declaracoesSemFormulario: n,
});
export type TelaFormulariosObito = z.infer<typeof esquemaFormularios>;

export const lerFormulariosObito = (situacao: string | null) =>
  ler(
    `${C}/formularios-obito${situacao ? `?situacao=${encodeURIComponent(situacao)}` : ''}`,
    esquemaFormularios,
  );
export const receberLoteObito = (corpo: {
  inicial: string;
  final: string;
  lote: string | null;
  recebidoEm: string;
  orgao: string | null;
}) =>
  enviar(
    `${C}/formularios-obito/lotes`,
    corpo,
    z.object({ quantidade: n, primeiro: n }).passthrough(),
    novaChave('obito-lote'),
  );
export const conciliarFormulariosObito = () =>
  enviar(
    `${C}/formularios-obito/conciliar`,
    {},
    z.object({ ligados: n, semFormulario: n }).passthrough(),
    novaChave('obito-conciliar'),
  );
export const acaoFormularioObito = (
  id: number,
  corpo: { acao: string; declaracao: number | null; motivo: string | null; versao: number },
) => enviar(`${C}/formularios-obito/${id}/acao`, corpo, z.object({}).passthrough(), novaChave('obito-acao'));

// ── Auditoria do isolamento ──
export const esquemaIsolamentoAuditar = z.object({
  isolamento: n,
  paciente: n,
  internacao: n.nullable(),
  leito: txt.nullable(),
  tipoPrecaucao: z.object({ id: n, descricao: txt }),
  inicio: txt.nullable(),
  ultimaAuditoria: txt.nullable(),
  proximaAuditoria: txt.nullable(),
  auditoriaPendente: z.boolean(),
  criterios: n,
});
export type IsolamentoAuditar = z.infer<typeof esquemaIsolamentoAuditar>;
export const esquemaCriterio = z.object({
  id: n,
  ordem: n,
  descricao: txt,
  orientacao: txt.nullable(),
  acao: z.enum(['registrar', 'alertar', 'bloquear']),
  validadeDias: n.nullable(),
});
export type CriterioIsolamento = z.infer<typeof esquemaCriterio>;
export const esquemaAvisoIsolamento = z.object({
  id: n,
  paciente: n.nullable(),
  auditoria: n,
  isolamento: n,
  titulo: txt,
  mensagem: txt,
  prioridade: txt,
  situacao: txt,
  geradoEm: txt.nullable(),
  resolvidoEm: txt.nullable(),
  versao: n,
});
export type AvisoIsolamento = z.infer<typeof esquemaAvisoIsolamento>;

export const lerIsolamentosAuditar = () =>
  ler(`${C}/isolamentos`, z.object({ itens: z.array(esquemaIsolamentoAuditar) }));
export const lerCriteriosIsolamento = (tipo: number) =>
  ler(`${C}/isolamentos/criterios?tipo=${tipo}`, z.object({ itens: z.array(esquemaCriterio) }));
export const incluirCriterioIsolamento = (corpo: {
  tipoPrecaucao: number;
  descricao: string;
  acao: string;
  validadeDias: number | null;
}) =>
  enviar(
    `${C}/isolamentos/criterios`,
    corpo,
    z.object({ id: n, ordem: n }).passthrough(),
    novaChave('iso-criterio'),
  );
export const registrarAuditoriaIsolamento = (corpo: {
  isolamento: number;
  observacao: string | null;
  respostas: {
    criterio: number;
    resposta: string;
    naoConformidade: string | null;
    acaoCorretiva: string | null;
  }[];
}) =>
  enviar(
    `${C}/isolamentos/auditorias`,
    corpo,
    z.object({ geral: txt, percentual: n.nullable(), aviso: n.nullable() }).passthrough(),
    novaChave('iso-auditoria'),
  );
export const lerAvisosIsolamento = () =>
  ler(`${C}/isolamentos/avisos`, z.object({ itens: z.array(esquemaAvisoIsolamento) }));
export const resolverAvisoIsolamento = (id: number, providencia: string, versao: number) =>
  enviar(
    `${C}/isolamentos/avisos/${id}/resolver`,
    { providencia, versao },
    z.object({}).passthrough(),
    novaChave('iso-aviso'),
  );

// ── Regulação: quadro clínico e evolução ──
const opcao = z.object({ id: n, descricao: txt });
export const esquemaApoioRegulacao = z.object({
  niveisConsciencia: z.array(opcao),
  suportesOxigenio: z.array(opcao.extend({ invasivo: z.boolean() })),
  faixasDiurese: z.array(opcao),
  germes: z.array(opcao),
});
export type ApoioRegulacao = z.infer<typeof esquemaApoioRegulacao>;
export const esquemaLinhaTempo = z.object({
  solicitacao: z.object({
    id: n,
    paciente: n,
    situacao: txt,
    numero: txt.nullable(),
    versao: n,
    solicitadoEm: txt.nullable(),
    reguladoEm: txt.nullable(),
    encerradoEm: txt.nullable(),
  }),
  quadros: z.array(
    z.object({
      id: n,
      sequencia: n,
      registradoEm: txt.nullable(),
      quadroClinico: txt,
      condicaoGeral: txt,
      consciencia: txt.nullable(),
      suporteOxigenio: txt.nullable(),
      diurese: txt.nullable(),
      saturacao: n.nullable(),
      frequenciaCardiaca: n.nullable(),
      usaDrogaVasoativa: z.boolean(),
      necessitaIsolamento: z.boolean(),
    }),
  ),
  eventos: z.array(
    z.object({
      id: n,
      tipo: txt,
      de: txt.nullable(),
      para: txt.nullable(),
      observacao: txt.nullable(),
      enviadoEm: txt.nullable(),
      em: txt.nullable(),
      por: txt.nullable(),
    }),
  ),
  envio: z.object({ automatico: z.boolean(), motivo: txt.nullable() }).passthrough(),
});
export type LinhaTempoRegulacao = z.infer<typeof esquemaLinhaTempo>;

export const lerApoioRegulacao = () => ler(`${C}/regulacao/apoio`, esquemaApoioRegulacao);
export const lerLinhaTempoRegulacao = (id: number) => ler(`${C}/regulacao/${id}`, esquemaLinhaTempo);
export const registrarQuadroRegulacao = (id: number, corpo: Record<string, unknown>) =>
  enviar(
    `${C}/regulacao/${id}/quadros`,
    corpo,
    z.object({ sequencia: n, sugerida: txt, aviso: txt.nullable() }).passthrough(),
    novaChave('reg-quadro'),
  );
export const registrarEventoRegulacao = (
  id: number,
  corpo: { tipo: string; situacaoNova: string | null; observacao: string | null; versao: number },
) =>
  enviar(
    `${C}/regulacao/${id}/eventos`,
    corpo,
    z.object({ situacao: txt }).passthrough(),
    novaChave('reg-evento'),
  );
