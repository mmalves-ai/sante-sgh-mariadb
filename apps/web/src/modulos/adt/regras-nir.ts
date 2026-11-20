// Regras puras das telas do NIR (M44, etapa 2; testadas em regras-nir.spec.ts): o tempo de espera escrito, a hora
// curta, o perfil em texto, o destino da admissão ou da transferência que atende a solicitação reservada e a ordem das
// ações que a tela oferece por estado (o servidor confere de novo).
import { chaveTextoLeito, type SolicitacaoNir } from '@sgh/contratos';

/** "75" → "1 h 15 min"; "40" → "40 min". */
export function tempoEscrito(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "2026-10-24T14:30:00" → "24/10 14:30". */
export function horaCurta(iso: string | null | undefined): string {
  const s = iso ?? '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
}

/** "2026-10-24" → "24/10/2026". */
export function dataCurta(iso: string | null | undefined): string {
  const s = iso ?? '';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
}

/**
 * Onde o NIR conclui a solicitação reservada: a internação aberta muda de leito pela transferência; as demais pela
 * admissão, já com o paciente, o leito reservado, a solicitação e a origem do pronto atendimento.
 */
export function destinoDaConclusao(s: SolicitacaoNir): string | null {
  if (!s.reserva) return null;
  const leito = encodeURIComponent(chaveTextoLeito(s.reserva.leito));
  if (s.origem === 'internado' && s.internacao)
    return `/leitos/transferencias?internacao=${s.internacao}&destino=${leito}&solicitacao=${s.id}`;
  const pa = s.origem === 'pa' && s.atendimento ? `&origem=pa&atendimento=${s.atendimento}` : '';
  const pront = s.paciente.prontuario ? `&prontuario=${s.paciente.prontuario}` : '';
  return `/internacao/admissao?paciente=${s.paciente.id}${pront}&leito=${leito}&solicitacao=${s.id}${pa}`;
}

export type AcaoTela =
  'analisar' | 'escolherLeito' | 'confirmar' | 'transito' | 'concluir' | 'priorizar' | 'encerrar';

/** As ações da tela por estado (a ordem em que aparecem). */
export function acoesDaTela(s: Pick<SolicitacaoNir, 'estado' | 'reserva'>): AcaoTela[] {
  switch (s.estado) {
    case 'solicitado':
      return ['analisar', 'escolherLeito', 'priorizar', 'encerrar'];
    case 'em_analise':
      return ['escolherLeito', 'priorizar', 'encerrar'];
    case 'reservado':
      return [
        ...(s.reserva?.situacao === 'ativa' ? (['confirmar'] as const) : []),
        'transito',
        'concluir',
        'priorizar',
        'encerrar',
      ];
    case 'em_transito':
      return ['concluir', 'priorizar', 'encerrar'];
    default:
      return [];
  }
}
