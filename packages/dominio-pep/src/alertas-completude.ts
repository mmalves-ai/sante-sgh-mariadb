// Alertas de completude (ficha do M23, regra 14; ref 01 §3.16; cap-05b §5.6): contam os registros dos DOIS sistemas.
// Internado sem evolução médica há mais de 24 h (suspensa não conta; evolução médica = CBO 225), assinatura pendente,
// alta sem sumário, crítico sem ciência e parecer atrasado. Os 13 sinalizadores da auditoria clínica (sem evolução
// médica, só registro não médico, nenhum registro, UTI sem registro médico anterior, CID Z, CID Z com UTI, óbito sem
// evolução, evasão após UTI, transferência sem evolução, última evolução > 24 h antes da alta, densidade < 1 evolução
// médica/dia (≥ 2 dias), > 10 dias com ≤ 1 evolução, UTI direta com CID sintomático) são os casos de teste.
import type { AlertaCompletude } from '@sgh/contratos';
import { semEvolucaoMedica24h } from './worklist/sem-evolucao.js';

export interface RegistroDoEpisodio {
  /** ISO do horário clínico. */
  readonly em: string;
  /** CBO do autor (225… = médico). */
  readonly cbo: string | null;
  readonly suspenso: boolean;
}

export interface EstadoAtendimento {
  readonly internado: boolean;
  readonly registros: readonly RegistroDoEpisodio[];
  readonly assinaturasPendentes: number;
  readonly altaMedica: boolean;
  readonly sumarioFinalizado: boolean;
  readonly criticosSemCiencia: number;
  readonly pareceresAtrasados: number;
  readonly entrada: string | null;
}

const ehMedica = (r: RegistroDoEpisodio) => !r.suspenso && (r.cbo ?? '').replace(/\D/g, '').startsWith('225');

export function alertasCompletude(e: EstadoAtendimento, agora: Date): AlertaCompletude[] {
  const r: AlertaCompletude[] = [];
  // M27 (regra 3): a mesma regra da fila do médico (worklist/sem-evolucao.ts).
  if (
    semEvolucaoMedica24h({
      internado: e.internado,
      evolucoes: e.registros.map((x) => ({ em: x.em, cbo: x.cbo, suspensa: x.suspenso })),
      entrada: e.entrada,
      agora,
    })
  )
    r.push({ tipo: 'sem-evolucao-medica-24h', texto: 'Sem evolução médica há mais de 24 horas.' });
  if (e.assinaturasPendentes > 0)
    r.push({
      tipo: 'assinatura-pendente',
      texto: `${e.assinaturasPendentes} documento(s) aguardando assinatura.`,
    });
  if (e.altaMedica && !e.sumarioFinalizado)
    r.push({ tipo: 'alta-sem-sumario', texto: 'Alta médica sem sumário finalizado.' });
  if (e.criticosSemCiencia > 0)
    r.push({
      tipo: 'critico-sem-ciencia',
      texto: `${e.criticosSemCiencia} resultado(s) crítico(s) sem ciência.`,
    });
  if (e.pareceresAtrasados > 0)
    r.push({ tipo: 'parecer-atrasado', texto: `${e.pareceresAtrasados} parecer(es) fora do prazo.` });
  return r;
}

// ── Sinalizadores da auditoria clínica (ref 01 §3.16) ───────────────────────────────────────────────────

export const SINALIZADORES = [
  'sem-evolucao-medica',
  'so-registro-nao-medico',
  'nenhum-registro',
  'uti-sem-registro-medico-anterior',
  'cid-z',
  'cid-z-com-uti',
  'obito-sem-evolucao',
  'evasao-apos-uti',
  'transferencia-sem-evolucao',
  'ultima-evolucao-24h-antes-alta',
  'densidade-baixa',
  'dias-sem-evolucao',
  'uti-direta-cid-sintomatico',
] as const;
export type Sinalizador = (typeof SINALIZADORES)[number];

export interface InternacaoAuditada {
  readonly entrada: string;
  readonly alta: string;
  readonly cidPrincipal: string | null;
  /** Nível de cuidado pelo primeiro trecho (uti_direto, uti_depois, apartamento, enfermaria, nao_classificado). */
  readonly nivel: 'uti_direto' | 'uti_depois' | 'apartamento' | 'enfermaria' | 'nao_classificado';
  readonly passouUti: boolean;
  /** Entrada na UTI (ISO), quando passou. */
  readonly entradaUti: string | null;
  readonly desfecho: 'alta' | 'obito' | 'evasao' | 'transferencia';
  readonly registros: readonly RegistroDoEpisodio[];
}

const DIA = 86_400_000;

export function sinalizadores(i: InternacaoAuditada): Sinalizador[] {
  const s: Sinalizador[] = [];
  const validos = i.registros.filter((r) => !r.suspenso);
  const medicos = validos.filter(ehMedica);
  const alta = new Date(i.alta).getTime();
  const entrada = new Date(i.entrada).getTime();
  const dias = Math.max(1, Math.ceil((alta - entrada) / DIA));
  if (medicos.length === 0) s.push('sem-evolucao-medica');
  if (validos.length > 0 && medicos.length === 0) s.push('so-registro-nao-medico');
  if (validos.length === 0) s.push('nenhum-registro');
  if (
    i.passouUti &&
    i.entradaUti &&
    !medicos.some((r) => new Date(r.em).getTime() <= new Date(i.entradaUti!).getTime())
  )
    s.push('uti-sem-registro-medico-anterior');
  const cidZ = (i.cidPrincipal ?? '').toUpperCase().startsWith('Z');
  if (cidZ) s.push('cid-z');
  if (cidZ && i.passouUti) s.push('cid-z-com-uti');
  if (i.desfecho === 'obito' && medicos.length === 0) s.push('obito-sem-evolucao');
  if (i.desfecho === 'evasao' && i.passouUti) s.push('evasao-apos-uti');
  if (i.desfecho === 'transferencia' && medicos.length === 0) s.push('transferencia-sem-evolucao');
  const ultima = medicos.length ? Math.max(...medicos.map((r) => new Date(r.em).getTime())) : null;
  if (ultima !== null && alta - ultima > DIA) s.push('ultima-evolucao-24h-antes-alta');
  if (dias >= 2 && medicos.length / dias < 1) s.push('densidade-baixa');
  if (dias > 10 && medicos.length <= 1) s.push('dias-sem-evolucao');
  const sintomatico = /^[RGMZ]/.test((i.cidPrincipal ?? '').toUpperCase());
  if (i.nivel === 'uti_direto' && sintomatico) s.push('uti-direta-cid-sintomatico');
  return s;
}
