// Regra 7 do M48 (cap-05b §5.11, Isolamento): a precaução do internado aparece no cabeçalho, no mapa de leitos e na
// lista da higienização do novo; em painel público, só o tipo. O mapa do M21 guarda UM estado "precaução" por leito
// (SGH_INT_LEITO_ESTADO): com duas precauções abertas, o leito mostra a mais restritiva (aerossóis > gotículas >
// contato); ao encerrar uma, o leito passa à mais restritiva das que restam (D-LEITO-48.3).
// Bloqueio do leito vizinho (a ficha: "quando a regra exigir"): aerossóis em quarto com outros leitos exige o bloqueio
// (quarto privativo); multirresistente ou gotículas em quarto compartilhado sugere (coorte), e a CCIH decide.
import type { MotivoPrecaucao, Precaucao } from '@sgh/contratos';
import { motivoMultirresistente } from '@sgh/contratos';

const ORDEM: Readonly<Record<Precaucao, number>> = { contato: 1, goticulas: 2, aerossois: 3 };

/** A precaução que o leito mostra (a mais restritiva das abertas), ou null sem nenhuma. */
export function precaucaoDoLeito(abertas: readonly Precaucao[]): Precaucao | null {
  return abertas.reduce<Precaucao | null>((m, p) => (m === null || ORDEM[p] > ORDEM[m] ? p : m), null);
}

export type BloqueioVizinho = 'exigido' | 'sugerido' | 'naoSeAplica';

export function bloqueioDoVizinho(
  tipo: Precaucao,
  motivo: MotivoPrecaucao,
  outrosLeitos: number,
): BloqueioVizinho {
  if (outrosLeitos <= 0) return 'naoSeAplica';
  if (tipo === 'aerossois') return 'exigido';
  return tipo === 'goticulas' || motivoMultirresistente(motivo) ? 'sugerido' : 'naoSeAplica';
}

export type RecusaPrecaucao =
  'sem-leito' | 'precaucao-ja-aberta' | 'bloqueio-vizinho-exigido' | 'precaucao-encerrada';

/**
 * A precaução nova cabe: o internado está num leito; o mesmo motivo não está aberto; aerossóis em quarto compartilhado
 * exige pedir o bloqueio dos vizinhos (só os livres são bloqueados: `vizinhosParaBloquear`).
 */
export function conferirPrecaucao(e: {
  readonly temLeito: boolean;
  readonly motivo: MotivoPrecaucao;
  readonly tipo: Precaucao;
  readonly motivosAbertos: readonly MotivoPrecaucao[];
  readonly bloquearVizinhos: boolean;
  readonly vizinhos: readonly { readonly ocupado: boolean }[];
}): RecusaPrecaucao | null {
  if (!e.temLeito) return 'sem-leito';
  if (e.motivo !== 'outro' && e.motivosAbertos.includes(e.motivo)) return 'precaucao-ja-aberta';
  const b = bloqueioDoVizinho(e.tipo, e.motivo, e.vizinhos.length);
  if (b === 'exigido' && !e.bloquearVizinhos) return 'bloqueio-vizinho-exigido';
  return null;
}

/**
 * Quais vizinhos bloquear: só os livres (o mapa não bloqueia leito ocupado). Os ocupados voltam como alerta: a precaução
 * é registrada na hora, e a CCIH e o NIR transferem o vizinho (ou o paciente) para o quarto privativo.
 */
export function vizinhosParaBloquear<T extends { readonly ocupado: boolean }>(
  vizinhos: readonly T[],
): { readonly bloquear: T[]; readonly ocupados: T[] } {
  return { bloquear: vizinhos.filter((v) => !v.ocupado), ocupados: vizinhos.filter((v) => v.ocupado) };
}

/** O que o painel público (totem, painel de chamada) pode mostrar: só o tipo. */
export function precaucaoPublica(p: { readonly tipo: Precaucao }): { readonly tipo: Precaucao } {
  return { tipo: p.tipo };
}

// ── Reconciliação com a internação ao vivo (D-RECONC-48.3) ───────────────────────────────────────────
// A alta e a transferência continuam acontecendo no outro sistema: a precaução aberta só vale para o leito enquanto a
// internação dela está aberta NAQUELE leito. Transferida, ela segue com o paciente (cabeçalho e vigilância), mas sai do
// leito antigo e vira pendência da CCIH (encerrar e definir no leito novo); com a internação encerrada, sai de tudo e
// vira pendência (encerrar, o que solta os vizinhos que só ela bloqueava).

interface LeitoChave {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
}
const mesmoLeito = (a: LeitoChave, b: LeitoChave) =>
  a.bloco === b.bloco && a.acomodacao === b.acomodacao && a.leito === b.leito;
const textoChave = (l: LeitoChave) => `${l.bloco}|${l.acomodacao}|${l.leito}`;

export type SituacaoPrecaucao = 'vigente' | 'transferida' | 'internacaoEncerrada';

/** A situação da precaução aberta diante dos internados de agora (o mesmo REG no mesmo leito é a vigente). */
export function situacaoDaPrecaucao(
  p: { readonly reg: number; readonly leito: LeitoChave },
  internados: readonly (LeitoChave & { readonly reg: number })[],
): SituacaoPrecaucao {
  const i = internados.find((x) => x.reg === p.reg);
  if (!i) return 'internacaoEncerrada';
  return mesmoLeito(i, p.leito) ? 'vigente' : 'transferida';
}

/** As precauções abertas com a situação de cada uma. */
export function reconciliarPrecaucoes<P extends { readonly reg: number; readonly leito: LeitoChave }>(
  abertas: readonly P[],
  internados: readonly (LeitoChave & { readonly reg: number })[],
): (P & { readonly situacao: SituacaoPrecaucao })[] {
  return abertas.map((p) => ({ ...p, situacao: situacaoDaPrecaucao(p, internados) }));
}

/** Os tipos das precauções vigentes no leito (o mapa mostra a mais restritiva), sem a de `exceto`. */
export function tiposVigentesNoLeito(
  abertas: readonly {
    readonly id: number;
    readonly tipo: Precaucao;
    readonly leito: LeitoChave;
    readonly situacao: SituacaoPrecaucao;
  }[],
  leito: LeitoChave,
  exceto: number | null = null,
): Precaucao[] {
  return abertas
    .filter((p) => p.id !== exceto && p.situacao === 'vigente' && mesmoLeito(p.leito, leito))
    .map((p) => p.tipo);
}

/**
 * Os vizinhos pedidos que já estão na lista de outra precaução aberta (não se abre bloqueio de novo; a nova os
 * compartilha) e os que ainda precisam de bloqueio.
 */
export function separarBloqueiosCompartilhados<T extends LeitoChave>(
  pedidos: readonly T[],
  outrasAbertas: readonly { readonly bloqueios: readonly LeitoChave[] }[],
): { readonly bloquear: T[]; readonly compartilhar: T[] } {
  const ja = new Set(outrasAbertas.flatMap((p) => p.bloqueios.map(textoChave)));
  return {
    bloquear: pedidos.filter((v) => !ja.has(textoChave(v))),
    compartilhar: pedidos.filter((v) => ja.has(textoChave(v))),
  };
}

/** Os vizinhos que o encerramento libera: os desta precaução que nenhuma outra aberta ainda pede. */
export function bloqueiosALiberar<T extends LeitoChave>(
  encerrada: { readonly id: number; readonly bloqueios: readonly T[] },
  abertas: readonly { readonly id: number; readonly bloqueios: readonly LeitoChave[] }[],
): T[] {
  const ainda = new Set(
    abertas.filter((p) => p.id !== encerrada.id).flatMap((p) => p.bloqueios.map(textoChave)),
  );
  return encerrada.bloqueios.filter((v) => !ainda.has(textoChave(v)));
}
