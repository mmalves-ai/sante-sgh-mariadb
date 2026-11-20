// Estoque de hemocomponentes da agência própria (ficha do M47, etapa 2, regra 3; cap-05b §5.11; ECF.12 rastreio):
//   - a bolsa recebida do hemocentro entra em quarentena; só sai liberada na entrada com a inspeção boa e a temperatura
//     de chegada na faixa da classe; vencida não entra;
//   - liberar, bloquear, reservar para a requisição, cancelar a reserva, descartar e devolver seguem a máquina abaixo;
//     bolsa vencida não é liberada nem reservada; a transfundida (o ato da etapa 1 deu baixa) não se movimenta mais;
//   - liberar da quarentena a bolsa com a temperatura fora da faixa ou a inspeção reprovada pede o motivo; a de inspeção
//     reprovada pede também a reinspeção aprovada, que a gravação registra na bolsa;
//   - o descarte e a devolução vão à trilha como BOLSA_DESCARTADA (regra 11).
import {
  type AcaoBolsa,
  type ClasseHemocomponente,
  conferirMovimentoBolsa,
  FAIXA_TEMPERATURA_RECEBIMENTO,
  MENSAGENS_ESTOQUE,
  TIPO_DO_MOVIMENTO,
  TRANSICOES_BOLSA,
  temperaturaNaFaixaDoHemocomponente,
  type FatorRh,
  type GrupoAbo,
  type ResumoEstoque,
  type SituacaoBolsaEstoque,
} from '@sgh/contratos';

export { MENSAGENS_ESTOQUE, temperaturaNaFaixaDoHemocomponente, TIPO_DO_MOVIMENTO };
const TRANSICOES = TRANSICOES_BOLSA;

/** As ações que a tela oferece para a situação (as demais o servidor recusa). */
export function acoesPossiveis(situacao: SituacaoBolsaEstoque, vencida: boolean): readonly AcaoBolsa[] {
  return (Object.keys(TRANSICOES) as AcaoBolsa[]).filter(
    (a) => TRANSICOES[a].de.includes(situacao) && !(vencida && (a === 'liberar' || a === 'reservar')),
  );
}

/** A situação que a tela mostra: a transfundida vem do ato (a baixa é o próprio ato da etapa 1). */
export function situacaoEfetiva(guardada: SituacaoBolsaEstoque, temAto: boolean): SituacaoBolsaEstoque {
  return temAto ? 'transfundida' : guardada;
}

export function vencida(validade: string, agora: string): boolean {
  return validade.slice(0, 16) <= agora.slice(0, 16);
}

/**
 * Confere o movimento pedido; devolve a situação seguinte ou os bloqueios (a mesma função do adaptador, nos contratos):
 * a liberação da quarentena da bolsa com a temperatura de chegada fora da faixa ou a inspeção reprovada pede o motivo,
 * e a da inspeção reprovada pede a reinspeção aprovada.
 */
export const conferirMovimento = conferirMovimentoBolsa;

/** A temperatura de chegada está na faixa da classe. */
export function temperaturaNaFaixa(classe: ClasseHemocomponente, temperaturaC: number): boolean {
  const f = FAIXA_TEMPERATURA_RECEBIMENTO[classe];
  return temperaturaC >= f.min && temperaturaC <= f.max;
}

/** A situação de entrada: quarentena, ou liberada só com a inspeção e a temperatura boas e o pedido de liberar. */
export function situacaoNoRecebimento(c: {
  readonly classe: ClasseHemocomponente;
  readonly temperaturaC: number;
  readonly inspecaoOk: boolean;
  readonly liberarNaEntrada: boolean;
  readonly validade: string;
  readonly agora: string;
}): {
  readonly situacao: SituacaoBolsaEstoque | null;
  readonly bloqueios: readonly string[];
  readonly alertas: readonly string[];
} {
  if (vencida(c.validade, c.agora))
    return { situacao: null, bloqueios: ['bolsa-vencida-no-recebimento'], alertas: [] };
  const alertas: string[] = [];
  if (!temperaturaNaFaixa(c.classe, c.temperaturaC)) alertas.push('temperatura-fora-da-faixa');
  if (!c.inspecaoOk) alertas.push('inspecao-reprovada');
  const situacao: SituacaoBolsaEstoque =
    c.liberarNaEntrada && alertas.length === 0 ? 'liberada' : 'quarentena';
  return { situacao, bloqueios: [], alertas };
}

/** Vence nos próximos `dias` (ou já venceu). */
export function venceEm(validade: string, agora: string, dias: number): boolean {
  const limite = new Date(new Date(`${agora.slice(0, 19)}Z`).getTime() + dias * 86_400_000)
    .toISOString()
    .slice(0, 16);
  return validade.slice(0, 16) <= limite;
}

/** O painel do estoque: por hemocomponente e tipagem, as utilizáveis (fora das vencidas) e as que vencem em 3 dias. */
export function resumoEstoque(
  bolsas: readonly {
    readonly hemocomponente: string;
    readonly abo: GrupoAbo | null;
    readonly rh: FatorRh | null;
    readonly situacao: SituacaoBolsaEstoque;
    readonly validade: string;
  }[],
  agora: string,
): readonly ResumoEstoque[] {
  const m = new Map<string, { -readonly [K in keyof ResumoEstoque]: ResumoEstoque[K] }>();
  for (const b of bolsas) {
    if (!['quarentena', 'liberada', 'reservada'].includes(b.situacao) || vencida(b.validade, agora)) continue;
    const k = `${b.hemocomponente}|${b.abo ?? ''}|${b.rh ?? ''}`;
    const x = m.get(k) ?? {
      hemocomponente: b.hemocomponente,
      abo: b.abo,
      rh: b.rh,
      liberadas: 0,
      reservadas: 0,
      quarentena: 0,
      vencendo: 0,
    };
    if (b.situacao === 'liberada') x.liberadas++;
    else if (b.situacao === 'reservada') x.reservadas++;
    else x.quarentena++;
    if (venceEm(b.validade, agora, 3)) x.vencendo++;
    m.set(k, x);
  }
  return [...m.values()].sort(
    (a, b) =>
      a.hemocomponente.localeCompare(b.hemocomponente) ||
      `${a.abo ?? ''}${a.rh ?? ''}`.localeCompare(`${b.abo ?? ''}${b.rh ?? ''}`),
  );
}
