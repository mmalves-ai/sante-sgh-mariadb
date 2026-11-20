// Portal de resultados (ficha do M26, regra 9; cap-05b §5.10 "Portal" e "Decisão"; cap-07 §7.6): só exames liberados de
// setores publicados; o médico externo vê só os pedidos em que é o solicitante (DP-43, proposta técnica); credencial
// própria com limite de tentativas e de taxa (a senha por atendimento do portal do outro sistema, ofuscada, não é
// usada); toda visualização registra data e IP; resultado não liberado, evolução e prescrição nunca aparecem.

/** Estado das tentativas de uma credencial do portal. */
export interface TentativasPortal {
  readonly erradas: number;
  readonly bloqueadaAte: string | null;
}

/** A credencial está bloqueada agora? */
export function bloqueada(t: TentativasPortal, agora: string): boolean {
  return t.bloqueadaAte !== null && Date.parse(t.bloqueadaAte) > Date.parse(agora);
}

/** Depois de uma tentativa: zera no acerto; bloqueia ao esgotar o limite (minutos de bloqueio). */
export function depoisDaTentativa(
  t: TentativasPortal,
  acertou: boolean,
  agora: string,
  limite: number,
  minutosBloqueio: number,
): TentativasPortal {
  if (acertou) return { erradas: 0, bloqueadaAte: null };
  const erradas = (bloqueada(t, agora) ? t.erradas : t.bloqueadaAte ? 0 : t.erradas) + 1;
  if (erradas >= limite)
    return { erradas, bloqueadaAte: new Date(Date.parse(agora) + minutosBloqueio * 60_000).toISOString() };
  return { erradas, bloqueadaAte: null };
}

/** Limite de taxa por origem (janela deslizante simples: N pedidos por minuto). */
export function dentroDaTaxa(instantes: readonly number[], agora: number, porMinuto: number): boolean {
  return instantes.filter((x) => agora - x < 60_000).length < porMinuto;
}

export interface LaudoCandidato {
  readonly liberado: boolean;
  /** Setor do exame (o ato) publicado no portal. */
  readonly setorPublicado: boolean;
  /** Situação da liberação (1 liberado para visualização). */
  readonly situacao: number;
  readonly paciente: number;
  /** O médico solicitante do pedido (o do cadastro de solicitantes ou o conselho do vínculo). */
  readonly solicitante: { readonly conselho: string; readonly uf: string; readonly numero: string } | null;
}

export type SessaoPortalRegra =
  | { readonly perfil: 'paciente'; readonly paciente: number }
  | {
      readonly perfil: 'medicoExterno';
      readonly conselho: string;
      readonly uf: string;
      readonly numero: string;
    };

const numero = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

/** O laudo aparece no portal para a sessão (regra 9). */
export function visivelNoPortal(l: LaudoCandidato, s: SessaoPortalRegra): boolean {
  if (!l.liberado || !l.setorPublicado || l.situacao !== 1) return false;
  if (s.perfil === 'paciente') return l.paciente === s.paciente;
  return (
    l.solicitante !== null &&
    l.solicitante.conselho.toUpperCase() === s.conselho.toUpperCase() &&
    l.solicitante.uf.toUpperCase() === s.uf.toUpperCase() &&
    numero(l.solicitante.numero) === numero(s.numero)
  );
}

/** O código do protocolo do paciente: 10 caracteres sem ambiguidade (sem 0/O e 1/I), gerado de bytes aleatórios. */
export function codigoProtocolo(bytes: Uint8Array): string {
  const ALF = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  if (bytes.length < 10) throw new Error('Bytes insuficientes para o código do protocolo.');
  return [...bytes.slice(0, 10)].map((b) => ALF[b % ALF.length]).join('');
}

/** O IP como o portal do outro sistema grava (até 50 caracteres; IPv6 mapeado em IPv4 vira o IPv4). */
export function ipParaGravar(ip: string): string {
  const t = ip.trim().replace(/^::ffff:/i, '');
  return t.slice(0, 50) || 'desconhecido';
}
