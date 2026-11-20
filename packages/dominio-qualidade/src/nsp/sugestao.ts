// Sugestão automática de notificação, etapa 2 do M48 (ficha, regra 4; cap-05b §5.11): ao registrar uma dose não
// administrada por falta do item ou ausência do paciente (omissão de dose), uma dose não administrada depois dos avisos
// dos nove certos (erro interceptado: quase erro), uma reação transfusional ou uma exceção no checklist de cirurgia
// segura (e, desde o W0-03 M4, uma lesão por pressão adquirida na internação), o sistema SUGERE a notificação a quem
// registrou; quem decide notificar é o usuário (nunca automática).
// A sugestão some quando o usuário notifica a partir dela ou a dispensa. Regra 1: o que marca a sugestão como resolvida
// é um resumo da origem com o login (a API guarda só o SHA-256): nada no banco liga a pessoa à notificação, e a
// notificação anônima guarda só a fonte da sugestão (o indicador de origem), sem o ID do registro.
import {
  ESTAGIOS_GRAVES_LPP,
  type EstagioLpp,
  FONTES_SUGESTAO,
  FORMATO_ORIGEM_SUGESTAO,
  type FonteSugestao,
  MOTIVOS_NAO_ADMINISTRACAO,
  ROTULOS_ESTAGIO_LPP,
  type SugestaoNotificacao,
} from '@sgh/contratos';

/** Motivos da não administração que são omissão de dose (os outros são decisão clínica ou do paciente). */
export const MOTIVOS_OMISSAO_DE_DOSE: readonly string[] = ['faltaItem', 'ausente'];
/** Janela da sugestão: os registros dos últimos 7 dias. */
export const DIAS_JANELA_SUGESTAO = 7;
/** Teto de sugestões por fonte (a leitura do banco também tem teto). */
export const TETO_SUGESTOES_POR_FONTE = 50;

export function origemDe(fonte: FonteSugestao, id: number): string {
  return `${fonte}:${String(id)}`;
}

export function lerOrigem(origem: string): { fonte: FonteSugestao; id: number } | null {
  if (!FORMATO_ORIGEM_SUGESTAO.test(origem)) return null;
  const [f, n] = origem.split(':');
  const id = Number(n);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { fonte: f as FonteSugestao, id };
}

/** O que vai em SGH_QUA_NOTIFICACAO.ORIGEM_SUGESTAO: a origem inteira na identificada; só a fonte na anônima. */
export function origemParaGravar(origem: string | null, anonima: boolean): string | null {
  if (origem === null) return null;
  const o = lerOrigem(origem);
  if (!o) return null;
  return anonima ? o.fonte : origem;
}

/** O texto que a API resume (SHA-256) para marcar a sugestão como resolvida, sem guardar a origem nem o login. */
export function semeDaSugestaoResolvida(hospital: string, login: string, origem: string): string {
  return `sante-nsp-sugestao:${hospital}:${login.trim().toUpperCase()}:${origem}`;
}

export interface ChecagemCandidata {
  readonly id: number;
  /** A situação do horário (A administrado, N não administrado). */
  readonly situacao: string;
  readonly motivo: string | null;
  /** Avisos dos nove certos conferidos na checagem (texto). */
  readonly avisos: string | null;
  readonly horaReal: string;
  readonly atendimento: number | null;
}

export interface ReacaoCandidata {
  readonly id: number;
  readonly inicioEm: string;
  readonly grau: number;
  /** A notificação de hemovigilância já foi enviada (pelo fluxo da agência). */
  readonly enviada: boolean;
}

/**
 * O horário da prescrição marcado como não administrado sem o registro da checagem do Sante (outro sistema ou outro
 * processo, durante a coexistência): sem o motivo codificado, a sugestão é a da dose não administrada, para conferir.
 */
export interface HorarioNaoAdministradoCandidato {
  readonly id: number;
  readonly quando: string;
  readonly atendimento: number | null;
}

export interface ChecklistCandidato {
  readonly id: number;
  readonly excecaoEm: string;
}

/**
 * A lesão por pressão registrada pelo usuário (W0-03, M4): a leitura já traz só a LPP cuja ficha vigente é a
 * finalizada; a regra confere de novo a origem (adquirida, não presente na admissão) e a inativação.
 */
export interface LesaoCandidata {
  readonly id: number;
  readonly estagio: EstagioLpp | null;
  readonly presenteNaAdmissao: boolean;
  readonly inativada: boolean;
  /** AAAA-MM-DDTHH:mm(:ss): quando a lesão foi identificada. */
  readonly identificadaEm: string;
  readonly atendimento: number | null;
}

/** A LPP adquirida, não inativada, vira sugestão; grave nos estágios 3, 4, não classificável e tissular profunda. */
export function lesaoSugere(l: LesaoCandidata): { sugerir: boolean; grave: boolean } {
  const sugerir = !l.presenteNaAdmissao && !l.inativada;
  return { sugerir, grave: sugerir && l.estagio !== null && ESTAGIOS_GRAVES_LPP.includes(l.estagio) };
}

const fonte = (c: FonteSugestao) => FONTES_SUGESTAO.find((f) => f.codigo === c)!;
const dataHora = (i: string) => `${i.slice(8, 10)}/${i.slice(5, 7)}/${i.slice(0, 4)} às ${i.slice(11, 16)}`;
const rotuloMotivo = (m: string | null) =>
  m !== null && m in MOTIVOS_NAO_ADMINISTRACAO
    ? MOTIVOS_NAO_ADMINISTRACAO[m as keyof typeof MOTIVOS_NAO_ADMINISTRACAO]
    : 'sem motivo informado';

/** A fonte da sugestão de uma checagem (ou null: a checagem não sugere notificação). */
export function fonteDaChecagem(c: ChecagemCandidata): 'omitida' | 'interceptado' | null {
  if (c.situacao !== 'N') return null;
  if ((c.avisos ?? '').trim() !== '') return 'interceptado';
  if (c.motivo !== null && MOTIVOS_OMISSAO_DE_DOSE.includes(c.motivo)) return 'omitida';
  return null;
}

/**
 * As sugestões pendentes do usuário (`resolvida`: a origem já notificada ou dispensada por ele), das mais recentes
 * para as mais antigas, no máximo `TETO_SUGESTOES_POR_FONTE` por fonte.
 */
export function sugestoesDoUsuario(
  c: {
    readonly checagens: readonly ChecagemCandidata[];
    readonly reacoes: readonly ReacaoCandidata[];
    readonly checklists: readonly ChecklistCandidato[];
    readonly horarios?: readonly HorarioNaoAdministradoCandidato[];
    readonly lesoes?: readonly LesaoCandidata[];
  },
  resolvida: (origem: string) => boolean,
): SugestaoNotificacao[] {
  const r: SugestaoNotificacao[] = [];
  const porFonte = new Map<FonteSugestao, number>();
  const empurra = (s: SugestaoNotificacao) => {
    if (resolvida(s.origem)) return;
    const n = porFonte.get(s.fonte) ?? 0;
    if (n >= TETO_SUGESTOES_POR_FONTE) return;
    porFonte.set(s.fonte, n + 1);
    r.push(s);
  };
  for (const ch of c.checagens) {
    const f = fonteDaChecagem(ch);
    if (f === null) continue;
    empurra({
      origem: origemDe(f, ch.id),
      fonte: f,
      tipo: 'medicacao',
      titulo: fonte(f).rotulo,
      quando: ch.horaReal,
      atendimento: ch.atendimento,
      // A omissão chegou ao paciente (a dose faltou); o erro interceptado não chegou (quase erro).
      chegouAoPaciente: f === 'omitida',
      descricao:
        f === 'omitida'
          ? `Dose não administrada em ${dataHora(ch.horaReal)} (motivo: ${rotuloMotivo(ch.motivo)}).`
          : `Administração interrompida em ${dataHora(ch.horaReal)} depois dos avisos da conferência dos nove certos.`,
    });
  }
  for (const h of c.horarios ?? [])
    empurra({
      origem: origemDe('naoAdministrada', h.id),
      fonte: 'naoAdministrada',
      tipo: 'medicacao',
      titulo: fonte('naoAdministrada').rotulo,
      quando: h.quando,
      atendimento: h.atendimento,
      chegouAoPaciente: true,
      descricao: `Dose marcada como não administrada em ${dataHora(h.quando)} (sem o motivo codificado: confira se foi omissão de dose antes de notificar).`,
    });
  for (const re of c.reacoes) {
    if (re.enviada) continue;
    empurra({
      origem: origemDe('reacao', re.id),
      fonte: 'reacao',
      tipo: 'transfusao',
      titulo: fonte('reacao').rotulo,
      quando: re.inicioEm,
      atendimento: null,
      chegouAoPaciente: true,
      descricao: `Reação transfusional (grau ${String(re.grau)}) iniciada em ${dataHora(re.inicioEm)}.`,
    });
  }
  for (const ck of c.checklists)
    empurra({
      origem: origemDe('checklist', ck.id),
      fonte: 'checklist',
      tipo: 'cirurgia',
      titulo: fonte('checklist').rotulo,
      quando: ck.excecaoEm,
      atendimento: null,
      chegouAoPaciente: false,
      descricao: `Incisão liberada por exceção no checklist de cirurgia segura em ${dataHora(ck.excecaoEm)}.`,
    });
  for (const le of c.lesoes ?? []) {
    const { sugerir, grave } = lesaoSugere(le);
    if (!sugerir) continue;
    const estagio = le.estagio ? ROTULOS_ESTAGIO_LPP[le.estagio].split(':')[0]! : 'estágio não informado';
    empurra({
      origem: origemDe('lesao', le.id),
      fonte: 'lesao',
      tipo: 'lesaoPressao',
      titulo: fonte('lesao').rotulo,
      quando: le.identificadaEm,
      atendimento: le.atendimento,
      chegouAoPaciente: true,
      descricao:
        `Lesão por pressão adquirida na internação (${estagio}), identificada em ${dataHora(le.identificadaEm)}.` +
        (grave ? ' Estágio grave: avalie a notificação como evento adverso grave.' : ''),
    });
  }
  return r.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
}
