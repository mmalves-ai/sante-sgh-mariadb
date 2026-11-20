// W0-04 (M5): as regras puras da comissão de revisão de prontuários (CFM 1.638/2002). Sem banco nem Nest.
//   - sorteio reproduzível: o universo (as altas da competência) em ordem de internação, embaralhado por um gerador
//     determinístico semeado pela semente registrada (FNV-1a de 32 bits na semente, mulberry32 no embaralhamento de
//     Fisher-Yates); a mesma semente sobre o mesmo universo dá sempre a mesma amostra, na mesma ordem;
//   - a revisão pelo checklist: todos os itens respondidos, nenhum de fora; o não conforme vira pendência ao médico
//     assistente; a situação é "não conforme" quando há ao menos um item não conforme;
//   - o aval: revisado e sem pendência aberta;
//   - o percentual conforme por clínica, com a conta das parcelas.
import type {
  ConformidadeClinicaRevisao,
  ItemChecklistRevisao,
  RecusaRevisaoProntuario,
  RespostaItemRevisao,
  SituacaoRevisaoProntuario,
} from '@sgh/contratos';
import { duasCasas, numeroBr } from './comum.js';

// ── Sorteio ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** FNV-1a de 32 bits (a semente texto vira o estado inicial do gerador). */
export function fnv1a32(texto: string): number {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(texto)) {
    h ^= c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** O gerador mulberry32 (determinístico; período 2^32), que devolve números em [0, 1). */
export function gerador(semente: string): () => number {
  let a = fnv1a32(semente);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A amostra: o universo em ordem crescente da chave (o número da internação) embaralhado pela semente; os
 * `quantidade` primeiros. Não muda a lista recebida.
 */
export function sortearAmostra<T extends { readonly reg: number }>(
  universo: readonly T[],
  semente: string,
  quantidade: number,
): T[] {
  const lista = [...universo].sort((a, b) => a.reg - b.reg);
  const rnd = gerador(semente);
  const n = Math.min(quantidade, lista.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (lista.length - i));
    [lista[i], lista[j]] = [lista[j]!, lista[i]!];
  }
  return lista.slice(0, n);
}

/** O texto canônico do universo (os números de internação ordenados), que o servidor resume em SHA-256. */
export const universoCanonico = (regs: readonly number[]): string =>
  [...new Set(regs)].sort((a, b) => a - b).join(',');

/** A amostra sugerida: 10% das altas, ao menos 10 (ou todas, se forem menos), no máximo `teto`. */
export function amostraSugerida(universo: number, teto = 200): number {
  if (universo <= 0) return 0;
  return Math.min(universo, teto, Math.max(10, Math.ceil(universo * 0.1)));
}

/** A semente gerada quando a comissão não informa (a data da competência e um número aleatório). */
export function sementeGerada(competencia: string, aleatorio: number): string {
  return `${competencia}-${Math.floor(aleatorio * 1_000_000_000)
    .toString(36)
    .toUpperCase()}`;
}

// ── Checklist e revisão ─────────────────────────────────────────────────────────────────────────────────────────

/** A publicação do checklist: a primeira sem motivo; a seguinte com motivo e sobre a vigente que a tela leu. */
export function recusaPublicacaoChecklist(e: {
  readonly vigente: { readonly id: number; readonly versao: number } | null;
  readonly lido: { readonly id: number; readonly versao: number } | null;
  readonly motivo: string | null;
}): RecusaRevisaoProntuario | null {
  if (e.vigente === null) return e.lido === null ? null : 'checklist-vigente-desatualizado';
  if (!e.lido || e.lido.id !== e.vigente.id || e.lido.versao !== e.vigente.versao)
    return 'checklist-vigente-desatualizado';
  if ((e.motivo?.trim().length ?? 0) < 10) return 'motivo-obrigatorio';
  return null;
}

export interface AvaliacaoRevisao {
  readonly situacao: Exclude<SituacaoRevisaoProntuario, 'aRevisar'>;
  /** Os itens não conformes (cada um vira uma pendência). */
  readonly naoConformes: readonly {
    readonly item: string;
    readonly titulo: string;
    readonly observacao: string | null;
  }[];
}

/** A revisão pelo checklist do sorteio: todos os itens, nenhum de fora; não conforme se houver item não conforme. */
export function avaliarRevisao(
  checklist: readonly ItemChecklistRevisao[],
  respostas: readonly RespostaItemRevisao[],
): { ok: true; avaliacao: AvaliacaoRevisao } | { ok: false; motivo: RecusaRevisaoProntuario } {
  const itens = new Map(checklist.map((i) => [i.codigo, i]));
  const vistos = new Set<string>();
  for (const r of respostas) {
    if (!itens.has(r.item)) return { ok: false, motivo: 'item-fora-do-checklist' };
    vistos.add(r.item);
  }
  if (vistos.size !== itens.size || respostas.length !== itens.size)
    return { ok: false, motivo: 'resposta-incompleta' };
  const naoConformes = respostas
    .filter((r) => r.resultado === 'naoConforme')
    .map((r) => ({ item: r.item, titulo: itens.get(r.item)!.titulo, observacao: r.observacao }));
  return {
    ok: true,
    avaliacao: { situacao: naoConformes.length ? 'naoConforme' : 'conforme', naoConformes },
  };
}

/** O texto da pendência ao profissional (o item e a observação da comissão). */
export function descricaoPendencia(titulo: string, observacao: string | null): string {
  const base = `Item não conforme: ${titulo}.`;
  return (observacao?.trim() ? `${base} ${observacao.trim()}` : base).slice(0, 500);
}

/** A correção da revisão já gravada: só antes do aval e com a justificativa. */
export function recusaRevisao(e: {
  readonly situacaoAtual: SituacaoRevisaoProntuario;
  readonly avalEm: string | null;
  readonly justificativa: string | null;
  readonly sorteioCancelado: boolean;
}): RecusaRevisaoProntuario | null {
  if (e.sorteioCancelado) return 'sorteio-cancelado';
  if (e.avalEm) return 'revisao-com-aval';
  if (e.situacaoAtual !== 'aRevisar' && (e.justificativa?.trim().length ?? 0) < 10)
    return 'justificativa-obrigatoria';
  return null;
}

/** O aval cabe: revisado, sem aval e sem pendência aberta. */
export function recusaAval(e: {
  readonly situacao: SituacaoRevisaoProntuario;
  readonly avalEm: string | null;
  readonly pendenciasAbertas: number;
}): RecusaRevisaoProntuario | null {
  if (e.situacao === 'aRevisar') return 'nao-revisado';
  if (e.avalEm) return 'aval-ja-registrado';
  if (e.pendenciasAbertas > 0) return 'pendencia-aberta';
  return null;
}

/** O cancelamento do sorteio: só enquanto nenhum prontuário foi revisado. */
export function recusaCancelamentoSorteio(e: {
  readonly canceladoEm: string | null;
  readonly revisados: number;
}): RecusaRevisaoProntuario | null {
  if (e.canceladoEm) return 'sorteio-cancelado';
  if (e.revisados > 0) return 'sorteio-com-revisao';
  return null;
}

/** A resposta do profissional: só a própria pendência, aberta. */
export function recusaRespostaPendencia(e: {
  readonly situacao: string;
  readonly profissionalLogin: string | null;
  readonly login: string;
}): RecusaRevisaoProntuario | null {
  if (!e.profissionalLogin || e.profissionalLogin.toUpperCase() !== e.login.toUpperCase())
    return 'pendencia-nao-e-sua';
  if (e.situacao !== 'aberta') return 'pendencia-encerrada';
  return null;
}

// ── Indicador ───────────────────────────────────────────────────────────────────────────────────────────────────

const conformidade = (clinica: string, revisados: number, conformes: number): ConformidadeClinicaRevisao => {
  const percentual = revisados > 0 ? duasCasas((conformes / revisados) * 100) : null;
  return {
    clinica,
    revisados,
    conformes,
    percentual,
    conta:
      percentual === null
        ? null
        : `${numeroBr(conformes, 0)} ÷ ${numeroBr(revisados, 0)} × 100 = ${numeroBr(percentual)}%`,
  };
};

/** O percentual conforme por clínica e o total (só os revisados de sorteio não cancelado), com as parcelas. */
export function conformidadePorClinica(
  revisoes: readonly { readonly clinica: string; readonly situacao: SituacaoRevisaoProntuario }[],
): { total: ConformidadeClinicaRevisao; porClinica: ConformidadeClinicaRevisao[] } {
  const m = new Map<string, { revisados: number; conformes: number }>();
  for (const r of revisoes) {
    if (r.situacao === 'aRevisar') continue;
    const x = m.get(r.clinica) ?? { revisados: 0, conformes: 0 };
    x.revisados++;
    if (r.situacao === 'conforme') x.conformes++;
    m.set(r.clinica, x);
  }
  const porClinica = [...m.entries()]
    .map(([c, x]) => conformidade(c, x.revisados, x.conformes))
    .sort((a, b) => a.clinica.localeCompare(b.clinica, 'pt-BR'));
  const t = porClinica.reduce((s, c) => ({ r: s.r + c.revisados, c: s.c + c.conformes }), { r: 0, c: 0 });
  return { total: conformidade('Todas as clínicas', t.r, t.c), porClinica };
}

/** O texto do aval que o SAME mostra e grava (sem dado do paciente). */
export function textoDoAval(avalEm: string, avalPor: string): string {
  const [a, m, d] = avalEm.slice(0, 10).split('-');
  return `Revisão de prontuário: aval ${d}/${m}/${a} ${avalPor}`.slice(0, 60);
}
