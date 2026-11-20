// Recuperação pós-anestésica (ficha do M46, regra 4; cap-05a §5.5; Resolução CFM 2.174/2017, art. 4º): admissão e
// alta pelo índice de Aldrete-Kroulik, com dor e náusea e vômito, em avaliações a cada 15 minutos; a alta só com o
// índice mínimo da regra versionada (REGRA_ALTA_SRPA_V1). Regras puras.
import {
  CODIGOS_ITEM_ALDRETE,
  INTERVALO_AVALIACAO_SRPA_MIN,
  REGRA_ALTA_SRPA_V1,
  type AldreteEntrada,
  type DestinoAltaSrpa,
  type MomentoSrpa,
  type RecusaAnestesia,
  type RegraAltaSrpa,
} from '@sgh/contratos';
import { instanteDosMinutos, minutosDoInstante } from '../ficha/instante.js';

export function totalAldrete(a: AldreteEntrada): number {
  return CODIGOS_ITEM_ALDRETE.reduce((s, i) => s + a[i], 0);
}

export function algumItemZero(a: AldreteEntrada): boolean {
  return CODIGOS_ITEM_ALDRETE.some((i) => a[i] === 0);
}

export interface AvaliacaoSrpa {
  readonly momento: MomentoSrpa;
  readonly em: string;
  readonly aldrete: AldreteEntrada;
  readonly dor: number;
  readonly nvpo: number;
}

const ordenar = (h: readonly AvaliacaoSrpa[]) =>
  [...h].sort((a, b) => minutosDoInstante(a.em) - minutosDoInstante(b.em));

/** Uma admissão, depois avaliações, e no fim uma alta; nada depois da alta; nada antes da última avaliação. */
export function conferirAvaliacao(
  historico: readonly AvaliacaoSrpa[],
  nova: Pick<AvaliacaoSrpa, 'momento' | 'em'>,
): { ok: true } | { ok: false; codigo: RecusaAnestesia } {
  const h = ordenar(historico);
  if (h.some((a) => a.momento === 'alta')) return { ok: false, codigo: 'srpa-ja-com-alta' };
  const temAdmissao = h.some((a) => a.momento === 'admissao');
  if (nova.momento === 'admissao' && temAdmissao) return { ok: false, codigo: 'srpa-fora-de-ordem' };
  if (nova.momento !== 'admissao' && !temAdmissao) return { ok: false, codigo: 'srpa-sem-admissao' };
  const ultima = h.at(-1);
  if (ultima && minutosDoInstante(nova.em) < minutosDoInstante(ultima.em))
    return { ok: false, codigo: 'srpa-fora-de-ordem' };
  return { ok: true };
}

/** Até quando vale a última avaliação (a próxima vence 15 minutos depois); null sem admissão ou com alta. */
export function proximaAvaliacaoAte(historico: readonly AvaliacaoSrpa[]): string | null {
  const h = ordenar(historico);
  const ultima = h.at(-1);
  if (!ultima || ultima.momento === 'alta') return null;
  return instanteDosMinutos(minutosDoInstante(ultima.em) + INTERVALO_AVALIACAO_SRPA_MIN);
}

export function avaliacaoVencida(historico: readonly AvaliacaoSrpa[], agora: string): boolean {
  const ate = proximaAvaliacaoAte(historico);
  return ate !== null && minutosDoInstante(agora) > minutosDoInstante(ate);
}

/** Intervalos entre avaliações seguidas acima de 15 minutos (os buracos da série). */
export function buracosDaSerie(historico: readonly AvaliacaoSrpa[]): number {
  const h = ordenar(historico);
  let n = 0;
  for (let i = 1; i < h.length; i++)
    if (minutosDoInstante(h[i]!.em) - minutosDoInstante(h[i - 1]!.em) > INTERVALO_AVALIACAO_SRPA_MIN) n++;
  return n;
}

export interface PedidoDeAlta {
  readonly em: string;
  readonly aldrete: AldreteEntrada;
  readonly dor: number;
  readonly nvpo: number;
  readonly destino: DestinoAltaSrpa;
  readonly motivoDestino: string | null;
}

/**
 * O que impede a alta (vazio = pode dar alta), pela regra versionada: a avaliação da alta é a última da série. Ir
 * para a UTI dispensa o índice, a dor, o vômito e a permanência, mas exige o motivo. Série com buraco acima de 15
 * minutos também impede (a avaliação vencida tem de ser registrada com a justificativa antes).
 */
export function impedimentosDaAlta(
  historico: readonly AvaliacaoSrpa[],
  alta: PedidoDeAlta,
  regra: RegraAltaSrpa = REGRA_ALTA_SRPA_V1,
): RecusaAnestesia[] {
  const ordem = conferirAvaliacao(historico, { momento: 'alta', em: alta.em });
  if (!ordem.ok) return [ordem.codigo];
  const h = ordenar(historico);
  const admissao = h.find((a) => a.momento === 'admissao')!;
  const p: RecusaAnestesia[] = [];
  const serie: AvaliacaoSrpa[] = [...h, { momento: 'alta', ...alta }];
  if (buracosDaSerie(serie) > 0) p.push('srpa-avaliacao-vencida');
  if (regra.destinosSemIndice.includes(alta.destino)) {
    if ((alta.motivoDestino ?? '').trim().length < 5) p.push('srpa-motivo-obrigatorio');
    return p;
  }
  if (totalAldrete(alta.aldrete) < regra.aldreteMinimo) p.push('srpa-indice-insuficiente');
  if (regra.nenhumItemZero && algumItemZero(alta.aldrete)) p.push('srpa-item-zero');
  if (alta.dor > regra.dorMaxima) p.push('srpa-dor-alta');
  if (regra.semVomito && alta.nvpo >= 2) p.push('srpa-vomito');
  if (minutosDoInstante(alta.em) - minutosDoInstante(admissao.em) < regra.permanenciaMinimaMin)
    p.push('srpa-permanencia-curta');
  return p;
}
