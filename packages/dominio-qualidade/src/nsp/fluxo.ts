// Fluxo da notificação no NSP, etapa 1 do M48 (manual m17 "Como o NSP trata uma notificação"; ficha, seção 5:
// qualidade.triarNotificacao, qualidade.distribuirNotificacao, qualidade.devolverAoNotificador):
//   - recebida → triada (confirma ou corrige a classificação; corrigir o que o notificador respondeu exige justificativa)
//     ou descartada (motivo e justificativa; duplicada aponta o protocolo que fica);
//   - triada → triada de novo (reclassificação, com justificativa) → distribuída ao gestor da área, com prazo da
//     análise a partir de hoje; redistribuir é permitido enquanto a análise não começou (etapa 2);
//   - devolutiva ao notificador em qualquer situação depois da triagem (inclusive a descartada: o notificador sabe o
//     porquê); nunca na recebida (ainda não há o que devolver);
//   - transcrição no Notivisa só depois da triagem, uma vez (o número do portal não muda); instante não futuro e não
//     anterior à ocorrência;
//   - controle otimista pela versão (a contagem de eventos que a tela leu): outra pessoa mexeu → recusa.
// Nada é apagado: cada passo é uma linha em SGH_QUA_NOTIF_EVENTO.
import type {
  ClassificacaoOms,
  GrauDano,
  SituacaoNotificacao,
  SituacaoNotivisa,
  TipoEventoNotificacao,
  TipoIncidente,
} from '@sgh/contratos';
import { conferirClassificacao, notivisaObrigatorio, type ProblemaClassificacao } from './classificacao.js';
import { msLocal } from './prazos.js';

export type RecusaFluxo =
  | 'versao-desatualizada'
  | 'situacao-nao-permite'
  | 'justificativa-obrigatoria'
  | 'prazo-no-passado'
  | 'ja-transcrita'
  | 'instante-futuro'
  | 'antes-da-ocorrencia'
  | 'duplicada-sem-protocolo'
  | 'duplicada-de-si-mesma'
  | ProblemaClassificacao;

export type ResultadoFluxo<T> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly motivo: RecusaFluxo };

const recusa = <T>(motivo: RecusaFluxo): ResultadoFluxo<T> => ({ ok: false, motivo });

/** O estado atual que o fluxo confere (lido de SGH_QUA_NOTIFICACAO). */
export interface EstadoNotificacao {
  readonly protocolo: string;
  readonly situacao: SituacaoNotificacao;
  readonly versao: number;
  readonly ocorridoEm: string;
  readonly tipo: TipoIncidente;
  readonly classificacao: ClassificacaoOms;
  readonly dano: GrauDano;
  readonly neverEvent: boolean;
  /** Já triada alguma vez (a classificação deixou de ser só a proposta do notificador). */
  readonly triada: boolean;
  readonly notivisaExportadaEm: string | null;
  readonly notivisaTranscritaEm: string | null;
}

const DEPOIS_DA_TRIAGEM: ReadonlySet<SituacaoNotificacao> = new Set([
  'triada',
  'distribuida',
  'emAnalise',
  'concluida',
  'descartada',
]);

function versaoConfere(e: EstadoNotificacao, versao: number): boolean {
  return e.versao === versao;
}

/** A triagem (ou a reclassificação de uma já triada). */
export function conferirTriagem(
  e: EstadoNotificacao,
  t: {
    readonly versao: number;
    readonly tipo: TipoIncidente;
    readonly classificacao: ClassificacaoOms;
    readonly dano: GrauDano;
    readonly neverEvent: boolean;
    readonly justificativa: string | null;
  },
): ResultadoFluxo<{ readonly eventos: readonly TipoEventoNotificacao[]; readonly mudou: boolean }> {
  if (!versaoConfere(e, t.versao)) return recusa('versao-desatualizada');
  if (e.situacao !== 'recebida' && e.situacao !== 'triada' && e.situacao !== 'distribuida')
    return recusa('situacao-nao-permite');
  const problema = conferirClassificacao(t.classificacao, t.dano);
  if (problema) return recusa(problema);
  const mudou =
    t.tipo !== e.tipo ||
    t.classificacao !== e.classificacao ||
    t.dano !== e.dano ||
    t.neverEvent !== e.neverEvent;
  if (mudou && (t.justificativa === null || t.justificativa.trim().length < 10))
    return recusa('justificativa-obrigatoria');
  // Já triada e nada mudou: nenhum evento (a tela não grava de novo).
  const eventos: TipoEventoNotificacao[] = e.triada ? [] : ['triada'];
  if (mudou) eventos.push('reclassificada');
  return { ok: true, valor: { eventos, mudou } };
}

/** A distribuição ao gestor da área (`hoje`: AAAA-MM-DD local). */
export function conferirDistribuicao(
  e: EstadoNotificacao,
  d: { readonly versao: number; readonly prazoAnalise: string },
  hoje: string,
): ResultadoFluxo<{ readonly evento: TipoEventoNotificacao }> {
  if (!versaoConfere(e, d.versao)) return recusa('versao-desatualizada');
  if (e.situacao !== 'triada' && e.situacao !== 'distribuida') return recusa('situacao-nao-permite');
  if (d.prazoAnalise < hoje) return recusa('prazo-no-passado');
  return { ok: true, valor: { evento: 'distribuida' } };
}

/** A devolutiva ao notificador. */
export function conferirDevolutiva(
  e: EstadoNotificacao,
  versao: number,
): ResultadoFluxo<{ readonly evento: TipoEventoNotificacao }> {
  if (!versaoConfere(e, versao)) return recusa('versao-desatualizada');
  if (!DEPOIS_DA_TRIAGEM.has(e.situacao)) return recusa('situacao-nao-permite');
  return { ok: true, valor: { evento: 'devolutiva' } };
}

/** O descarte na triagem. */
export function conferirDescarte(
  e: EstadoNotificacao,
  d: {
    readonly versao: number;
    readonly motivo: 'duplicada' | 'naoEIncidente' | 'outroCanal';
    readonly duplicadaDe: string | null;
  },
): ResultadoFluxo<{ readonly evento: TipoEventoNotificacao }> {
  if (!versaoConfere(e, d.versao)) return recusa('versao-desatualizada');
  if (e.situacao !== 'recebida' && e.situacao !== 'triada') return recusa('situacao-nao-permite');
  if (d.motivo === 'duplicada' && d.duplicadaDe === null) return recusa('duplicada-sem-protocolo');
  if (d.duplicadaDe !== null && d.duplicadaDe === e.protocolo) return recusa('duplicada-de-si-mesma');
  return { ok: true, valor: { evento: 'descartada' } };
}

/** O registro da transcrição no portal do Notivisa. */
export function conferirTranscricaoNotivisa(
  e: EstadoNotificacao,
  t: { readonly versao: number; readonly transcritaEm: string },
  agora: string,
): ResultadoFluxo<{ readonly evento: TipoEventoNotificacao }> {
  if (!versaoConfere(e, t.versao)) return recusa('versao-desatualizada');
  if (!e.triada || e.situacao === 'descartada' || e.situacao === 'recebida')
    return recusa('situacao-nao-permite');
  if (e.notivisaTranscritaEm !== null) return recusa('ja-transcrita');
  if (msLocal(t.transcritaEm) > msLocal(agora)) return recusa('instante-futuro');
  if (msLocal(t.transcritaEm) < msLocal(e.ocorridoEm)) return recusa('antes-da-ocorrencia');
  return { ok: true, valor: { evento: 'notivisaTranscrita' } };
}

/** O instante da ocorrência informado pelo notificador: não pode ser futuro nem de mais de um ano atrás. */
export function conferirOcorrencia(
  ocorridoEm: string,
  agora: string,
): 'instante-futuro' | 'muito-antigo' | null {
  const o = msLocal(ocorridoEm);
  const a = msLocal(agora);
  // Tolerância de 5 minutos para o relógio do aparelho.
  if (o > a + 5 * 60_000) return 'instante-futuro';
  if (a - o > 366 * 86_400_000) return 'muito-antigo';
  return null;
}

/** A situação perante o Notivisa (a coluna da lista e o filtro da fila de prazos). */
export function situacaoNotivisa(e: {
  readonly classificacao: ClassificacaoOms;
  readonly situacao: SituacaoNotificacao;
  readonly notivisaExportadaEm: string | null;
  readonly notivisaTranscritaEm: string | null;
}): SituacaoNotivisa {
  if (e.notivisaTranscritaEm !== null) return 'transcrita';
  if (e.notivisaExportadaEm !== null) return 'exportada';
  if (e.situacao === 'descartada' || !notivisaObrigatorio(e.classificacao)) return 'naoObrigatoria';
  return 'pendente';
}
