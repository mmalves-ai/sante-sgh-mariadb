// Estados do exame (ficha do M26, regra 1; cap-05b §5.10 "Estados"): solicitado → coletado → recebido → em análise →
// digitado → liberado → emitido ou visualizado. Solicitado, digitado, liberado e emitido são as marcas do legado
// (PEND_SADT, DIGRES, RESLIB, EMIRES); coletado, recebido e em análise vêm do rastreio de amostra (só no novo);
// visualizado, da visualização no portal. O estado é DERIVADO das marcas (nunca guardado à parte), e as ações de cada
// tela são permitidas pelo estado: resultado liberado não muda no novo (só a retificação, regra 4).
import type { EstadoAmostra, EstadoExame } from './vocabulario.js';

export interface MarcasExame {
  /** PEND_SADT: F (recebido ou executado), T (pendente), S (suspenso no prontuário). */
  readonly pendSadt: string;
  readonly digitado: boolean;
  readonly liberado: boolean;
  readonly emitido: boolean;
  /** Alguma visualização registrada no portal (data e IP). */
  readonly visualizado?: boolean;
  /** Estado da amostra no rastreio do novo (quando tem). */
  readonly amostra?: EstadoAmostra | null;
}

const ORDEM: readonly EstadoExame[] = [
  'solicitado',
  'coletado',
  'recebido',
  'emAnalise',
  'digitado',
  'liberado',
  'emitido',
  'visualizado',
];

/** O estado do exame pelas marcas do legado e pelo rastreio do novo. */
export function estadoDoExame(m: MarcasExame): EstadoExame {
  const pend = m.pendSadt.trim().toUpperCase();
  if (pend === 'S') return 'suspenso';
  if (m.liberado) {
    if (m.visualizado) return 'visualizado';
    return m.emitido ? 'emitido' : 'liberado';
  }
  if (m.digitado) return 'digitado';
  if (pend === 'T')
    return m.amostra === 'coletada' || m.amostra === 'emTransporte' ? 'coletado' : 'solicitado';
  // Recebido no setor (PEND_SADT = F): o rastreio refina em análise.
  if (m.amostra === 'emAnalise') return 'emAnalise';
  return 'recebido';
}

/** Posição do estado na sequência (o suspenso fica fora). */
export function ordemDoEstado(e: EstadoExame): number {
  return ORDEM.indexOf(e);
}

export type AcaoExame =
  'receber' | 'coletar' | 'digitar' | 'liberar' | 'retificar' | 'emitir' | 'suspender' | 'laudar';

/** Ações permitidas por estado; o motivo da recusa em português quando não pode. */
export function podeNoEstado(
  acao: AcaoExame,
  estado: EstadoExame,
): { readonly pode: boolean; readonly motivo: string | null } {
  const nao = (motivo: string) => ({ pode: false, motivo });
  const sim = { pode: true, motivo: null } as const;
  if (estado === 'suspenso') return nao('O pedido foi suspenso no prontuário.');
  switch (acao) {
    case 'coletar':
      return estado === 'solicitado' || estado === 'recebido' ? sim : nao('A amostra já foi coletada.');
    case 'receber':
      return estado === 'solicitado' || estado === 'coletado'
        ? sim
        : nao('O pedido já foi recebido pelo setor.');
    case 'digitar':
    case 'laudar':
      if (estado === 'solicitado' || estado === 'coletado')
        return nao('Receba o pedido no setor antes de digitar o resultado.');
      return ordemDoEstado(estado) >= ordemDoEstado('liberado')
        ? nao('Resultado liberado não muda: use a retificação, com o motivo.')
        : sim;
    case 'liberar':
      return estado === 'digitado'
        ? sim
        : ordemDoEstado(estado) >= ordemDoEstado('liberado')
          ? nao('O resultado já foi liberado.')
          : nao('Digite todos os elementos antes de liberar.');
    case 'retificar':
      return ordemDoEstado(estado) >= ordemDoEstado('liberado')
        ? sim
        : nao('Só o resultado liberado é retificado; antes de liberar, corrija na digitação.');
    case 'emitir':
      return ordemDoEstado(estado) >= ordemDoEstado('liberado')
        ? sim
        : nao('O laudo só é emitido depois da liberação.');
    case 'suspender':
      return estado === 'solicitado' || estado === 'coletado'
        ? sim
        : nao('Só o pedido ainda não recebido é suspenso.');
  }
}

/** Exame pendente ou suspenso não fatura (regra 2): só o recebido ou executado vai à conta. */
export function fatura(pendSadt: string): boolean {
  return pendSadt.trim().toUpperCase() === 'F';
}
