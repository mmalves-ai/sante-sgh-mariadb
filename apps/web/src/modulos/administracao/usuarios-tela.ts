// Regras de apresentação da tela "Usuários" (lista e ficha): iniciais do avatar, datas legíveis, CPF formatado e
// mascarado (cap-08 §8.13: só os 5 últimos dígitos à vista) e o resumo das gravações desligadas, agrupadas pelo
// motivo (o mesmo motivo aparece uma vez só, com as ações que ele desliga).
import { somenteDigitos } from '@sgh/contratos';
import { type Ref, ref, watch } from 'vue';

/** Duas letras para o avatar: a primeira e a última palavra do nome; sem nome, as duas primeiras do login. */
export function iniciais(nome: string | null | undefined, login: string): string {
  const palavras = (nome ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (palavras.length >= 2) return `${palavras[0]![0]}${palavras[palavras.length - 1]![0]}`.toUpperCase();
  if (palavras.length === 1) return palavras[0]!.slice(0, 2).toUpperCase();
  const letras = login.replace(/[^\p{L}\p{N}]/gu, '');
  return (letras.slice(0, 2) || '?').toUpperCase();
}

/** "AAAA-MM-DD" → "dd/mm/aaaa"; "AAAA-MM-DDThh:mm…" → "dd/mm/aaaa hh:mm"; outro texto volta igual. */
export function dataHora(texto: string | null | undefined): string {
  if (!texto) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(texto);
  if (!m) return texto;
  const data = `${m[3]}/${m[2]}/${m[1]}`;
  return m[4] ? `${data} ${m[4]}:${m[5]}` : data;
}

/** 000.000.000-00. */
export function formatarCpf(cpf: string): string {
  const d = somenteDigitos(cpf).padStart(11, '0').slice(-11);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** ***.***.789-01 (cap-08 §8.13). */
export function mascararCpf(cpf: string): string {
  const d = somenteDigitos(cpf).padStart(11, '0').slice(-11);
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}

export interface OperacaoFicha {
  readonly operacao: string;
  readonly rotulo: string;
  readonly ligada: boolean;
  readonly motivo: string | null;
}

/** As desligadas agrupadas pelo motivo, na ordem em que aparecem; `ignorar` fica de fora (tem cartão próprio). */
export function desligadasPorMotivo(
  operacoes: readonly OperacaoFicha[],
  ignorar: readonly string[] = [],
): { motivo: string; rotulos: string[] }[] {
  const grupos = new Map<string, string[]>();
  for (const o of operacoes) {
    if (o.ligada || ignorar.includes(o.operacao)) continue;
    const motivo = o.motivo ?? '';
    grupos.set(motivo, [...(grupos.get(motivo) ?? []), o.rotulo]);
  }
  return [...grupos].map(([motivo, rotulos]) => ({ motivo, rotulos }));
}

export const CAMINHO_LISTA_USUARIOS = '/administracao/acesso/usuarios';

/**
 * Para onde o "Voltar à lista" da ficha leva: a entrada anterior do histórico, quando é a própria lista (com a busca,
 * os filtros e a página na query); senão, a lista limpa.
 */
export function voltarParaLista(anterior: unknown): string {
  if (typeof anterior !== 'string') return CAMINHO_LISTA_USUARIOS;
  const caminho = anterior.split(/[?#]/)[0];
  return caminho === CAMINHO_LISTA_USUARIOS ? anterior : CAMINHO_LISTA_USUARIOS;
}

/** Filtros da lista na query da rota: lidos de volta ao voltar da ficha. */
export const SITUACOES_USUARIOS = ['todos', 'ativos', 'inativos', 'bloqueados'] as const;
export type SituacaoUsuarios = (typeof SITUACOES_USUARIOS)[number];
export interface FiltrosUsuarios {
  busca: string;
  grupo: string;
  situacao: SituacaoUsuarios;
  pagina: number;
}
const texto = (v: unknown) => (typeof v === 'string' ? v : '');
export function filtrosDaQuery(q: Record<string, unknown>): FiltrosUsuarios {
  const situacao = texto(q['situacao']);
  const pagina = Number.parseInt(texto(q['pagina']), 10);
  return {
    busca: texto(q['busca']),
    grupo: texto(q['grupo']),
    situacao: (SITUACOES_USUARIOS as readonly string[]).includes(situacao)
      ? (situacao as SituacaoUsuarios)
      : 'todos',
    pagina: Number.isFinite(pagina) && pagina > 1 ? pagina : 1,
  };
}
/** Só o que difere do padrão vai à query (a URL da lista limpa continua limpa). */
export function queryDosFiltros(f: FiltrosUsuarios): Record<string, string | undefined> {
  return {
    busca: f.busca || undefined,
    grupo: f.grupo || undefined,
    situacao: f.situacao === 'todos' ? undefined : f.situacao,
    pagina: f.pagina > 1 ? String(f.pagina) : undefined,
  };
}

/**
 * Abas que podem não caber (celular): diz se há abas escondidas antes e depois, para a borda em degradê avisar que a
 * lista rola.
 */
export function usarAbasRolaveis(alvo: Ref<HTMLElement | null>): {
  antes: Ref<boolean>;
  depois: Ref<boolean>;
} {
  const antes = ref(false);
  const depois = ref(false);
  const medir = () => {
    const el = alvo.value;
    antes.value = !!el && el.scrollLeft > 2;
    depois.value = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
  };
  watch(
    alvo,
    (el, _anterior, aoLimpar) => {
      medir();
      if (!el) return;
      el.addEventListener('scroll', medir, { passive: true });
      const obs = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
      obs?.observe(el);
      aoLimpar(() => {
        el.removeEventListener('scroll', medir);
        obs?.disconnect();
      });
    },
    { immediate: true, flush: 'post' },
  );
  return { antes, depois };
}

/** Rola a lista de abas até a escolhida, se ela estiver fora da vista. */
export function mostrarAbaAtiva(lista: HTMLElement | null): void {
  lista
    ?.querySelector<HTMLElement>('[aria-selected="true"]')
    ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
