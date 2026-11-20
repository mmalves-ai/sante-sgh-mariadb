// Regra 16 (cap-12 §12.3, Parceiros que leem o banco): quem lê o banco por visões (índices de UTI, BI do faturamento,
// agenda) CONTINUA lendo — nada é desligado nem repontado (cap-12, Decisão). O canal novo é oferecido nesta ordem:
// (1) a API do parceiro, alimentada pela outbox; (2) arquivo agendado; (3) a API de consulta do Sante SGH. A oferta
// leva em conta o que o parceiro aceita; a leitura direta só é desligada pela TI quando o canal novo estiver
// homologado e o parceiro concordar.
import type { PacoteCanalNovo } from '@sgh/contratos';

/** Parceiros que leem o banco hoje (por prefixo das visões no banco de cada estabelecimento). */
export const PARCEIROS_QUE_LEEM_O_BANCO = [
  { parceiro: 'Epimed (índices de UTI)', prefixo: 'V_EPIMED_' },
  { parceiro: 'First (gestão e qualidade)', prefixo: 'V_FIRST_' },
  { parceiro: 'Media Plus (agenda cirúrgica)', prefixo: 'V_MEDIA_PLUS_' },
  { parceiro: 'ZG (faturamento e glosa)', prefixo: 'VW_ZG_' },
] as const;

export interface CapacidadesParceiro {
  /** O parceiro tem API para receber eventos (o canal preferido). */
  readonly temApi: boolean;
  /** Aceita receber arquivo agendado (SFTP, pasta compartilhada). */
  readonly aceitaArquivo: boolean;
  /** Pode consultar uma API (pull) do Sante SGH com credencial própria. */
  readonly consultaApi: boolean;
}

/** Os pacotes de canal novo a oferecer, na ordem da regra 16, filtrados pelo que o parceiro aceita. */
export function ofertaDeCanal(c: CapacidadesParceiro): PacoteCanalNovo[] {
  const r: PacoteCanalNovo[] = [];
  if (c.temApi) r.push('api-do-parceiro-pela-outbox');
  if (c.aceitaArquivo) r.push('arquivo-agendado');
  if (c.consultaApi) r.push('api-de-consulta');
  return r;
}

/** O parceiro de cada visão (o prefixo), ou null se a visão não for de parceiro conhecido. */
export function parceiroDaVisao(visao: string): string | null {
  return PARCEIROS_QUE_LEEM_O_BANCO.find((p) => visao.startsWith(p.prefixo))?.parceiro ?? null;
}

/**
 * A leitura direta pode ser desligada? Só com o canal novo homologado E a concordância do parceiro (e quem desliga é
 * a TI do hospital, não o Sante SGH).
 */
export function podeDesligarLeituraDireta(s: {
  readonly canalNovoHomologado: boolean;
  readonly parceiroConcorda: boolean;
}): boolean {
  return s.canalNovoHomologado && s.parceiroConcorda;
}
