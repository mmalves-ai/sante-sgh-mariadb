// F7 (04-CC linha 102): autorização prévia da cirurgia eletiva junto à operadora, por etapas, e a trava da confirmação.
// Padrão TISS/ANS: a cirurgia eletiva de convênio só é confirmada (e só entra no bloco) com a guia autorizada e a
// senha da operadora; a urgência e a emergência seguem sem senha, com a exceção registrada (justificativa) e a
// comunicação à operadora depois. Regras puras, sem banco: a gravação reconfere sob a transação.

/** Etapas da autorização vistas pelo agendamento cirúrgico (derivadas da guia ligada; nada é gravado em duplicidade). */
export const ETAPAS_AUTORIZACAO_CIRURGIA = [
  'sem_guia',
  'guia_em_preparo',
  'pronta_envio',
  'aguardando_operadora',
  'pendente_documentacao',
  'autorizada',
  'autorizada_parcial',
  'negada',
  'nao_exigida',
] as const;
export type EtapaAutorizacaoCirurgia = (typeof ETAPAS_AUTORIZACAO_CIRURGIA)[number];

/** A guia de solicitação ligada ao agendamento: a situação do pedido à operadora e a senha da última resposta. */
export interface GuiaDaCirurgia {
  situacao: string;
  senha: string | null;
}

export interface SituacaoAutorizacaoCirurgia {
  tipoCobertura: 'convenio' | 'particular' | 'sus' | string;
  /** Natureza do caráter da cirurgia (eletiva, urgencia, emergencia, acidente, outro). */
  natureza: string;
  /** Senha já gravada no agendamento (digitada ou trazida pela resposta da operadora). */
  senha: string | null;
  /** A guia ligada mais recente não cancelada (ou null). */
  guia: GuiaDaCirurgia | null;
}

const preenchido = (s: string | null | undefined): s is string => !!s && s.trim().length > 0;

/** A natureza que dispensa a senha antes do ato (comunicação posterior à operadora). */
export function naturezaDeUrgencia(natureza: string): boolean {
  return natureza === 'urgencia' || natureza === 'emergencia' || natureza === 'acidente';
}

/** A senha que vale para o agendamento: a gravada nele ou a da guia autorizada ligada. */
export function senhaDaCirurgia(s: Pick<SituacaoAutorizacaoCirurgia, 'senha' | 'guia'>): string | null {
  if (preenchido(s.senha)) return s.senha.trim();
  if (s.guia && s.guia.situacao.startsWith('autorizada') && preenchido(s.guia.senha))
    return s.guia.senha.trim();
  return null;
}

/** A etapa em que a autorização da cirurgia está, para a agenda e a tela da autorização. */
export function etapaAutorizacaoCirurgia(s: SituacaoAutorizacaoCirurgia): EtapaAutorizacaoCirurgia {
  if (s.tipoCobertura !== 'convenio') return 'nao_exigida';
  if (preenchido(s.senha)) return 'autorizada';
  const g = s.guia;
  if (!g) return 'sem_guia';
  switch (g.situacao) {
    case 'rascunho':
      return 'guia_em_preparo';
    case 'pronta_envio':
      return 'pronta_envio';
    case 'enviada':
    case 'em_analise':
      return 'aguardando_operadora';
    case 'aguardando_documentacao':
    case 'erro_envio':
      return 'pendente_documentacao';
    case 'autorizada':
      return preenchido(g.senha) ? 'autorizada' : 'aguardando_operadora';
    case 'autorizada_parcial':
      return preenchido(g.senha) ? 'autorizada_parcial' : 'aguardando_operadora';
    case 'negada':
      return 'negada';
    default:
      return 'sem_guia';
  }
}

/** Situações do agendamento que exigem a senha na cirurgia eletiva de convênio: confirmada e dentro do bloco. */
export const SITUACOES_QUE_EXIGEM_SENHA = ['confirmado', 'no_bloco', 'em_andamento'] as const;

export type ConferenciaConfirmacao =
  | { ok: true; comunicarDepois: boolean }
  | { ok: false; codigo: 'autorizacao-pendente' | 'justificativa-urgencia'; mensagem: string };

const TEXTO_ETAPA: Record<EtapaAutorizacaoCirurgia, string> = {
  sem_guia: 'não há guia de solicitação ligada à cirurgia',
  guia_em_preparo: 'a guia de solicitação está em preparo',
  pronta_envio: 'a guia está pronta, mas ainda não foi levada à operadora',
  aguardando_operadora: 'a guia aguarda a resposta da operadora',
  pendente_documentacao: 'a operadora pediu documentação ou o envio falhou',
  autorizada: 'autorizada',
  autorizada_parcial: 'autorizada em parte',
  negada: 'a operadora negou a guia',
  nao_exigida: 'não exigida',
};

/**
 * Pode a cirurgia ir à situação `nova`? A eletiva de convênio sem senha é recusada com a etapa em que está; a urgência
 * sem senha passa com a justificativa registrada (mínimo de 10 letras) e fica marcada para comunicar à operadora.
 */
export function conferirConfirmacaoCirurgia(
  s: SituacaoAutorizacaoCirurgia,
  nova: string,
  justificativa: string | null,
): ConferenciaConfirmacao {
  if (!(SITUACOES_QUE_EXIGEM_SENHA as readonly string[]).includes(nova))
    return { ok: true, comunicarDepois: false };
  if (s.tipoCobertura !== 'convenio' || senhaDaCirurgia(s) !== null)
    return { ok: true, comunicarDepois: false };
  if (naturezaDeUrgencia(s.natureza)) {
    if ((justificativa ?? '').trim().length < 10)
      return {
        ok: false,
        codigo: 'justificativa-urgencia',
        mensagem:
          'Cirurgia de urgência sem senha da operadora: registre a justificativa (mínimo de 10 letras); a guia é comunicada depois.',
      };
    return { ok: true, comunicarDepois: true };
  }
  return {
    ok: false,
    codigo: 'autorizacao-pendente',
    mensagem: `Cirurgia eletiva de convênio só é confirmada com a senha da operadora: ${TEXTO_ETAPA[etapaAutorizacaoCirurgia(s)]}.`,
  };
}
