// Dados comuns das telas do estoque e das compras: o estado da gravação (cada funcionalidade e ação) e o apoio
// (locais, centros de custo, competência, mês fechado e o escopo do usuário do estoque).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerApoio, lerGravacao } from './api-suprimentos.js';

export function usarSuprimentos() {
  const gravacao = useQuery({
    queryKey: ['suprimentos', 'gravacao'],
    queryFn: () => lerGravacao(),
    staleTime: 30_000,
  });
  const apoio = useQuery({
    queryKey: ['suprimentos', 'apoio'],
    queryFn: () => lerApoio(),
    staleTime: 60_000,
  });
  /** A ação grava agora (permissão + liberação + catálogo)? */
  const pode = (op: string) => gravacao.data.value?.operacoes[op]?.ligada ?? false;
  const motivo = (op: string) => gravacao.data.value?.operacoes[op]?.motivo ?? null;
  const motivoFuncionalidade = (f: string) => {
    const x = gravacao.data.value?.funcionalidades[f];
    return x && !x.ligada ? (x.motivo ?? null) : null;
  };
  const locais = computed(() => apoio.data.value?.locais ?? []);
  /** Os locais em que o usuário do estoque faz o tipo de movimento (o escopo; S, E, D, TO, TD, I, R, V). */
  const locaisDoTipo = (tipo: string) => {
    const e = apoio.data.value?.escopo;
    if (!e) return [];
    return e.locais
      .filter((l) => l.tipos.includes(tipo))
      .map((l) => ({ codigo: l.local, nome: l.localNome }));
  };
  const centros = computed(() => apoio.data.value?.centrosCusto ?? []);
  const nomeLocal = (c: number | null | undefined) =>
    locais.value.find((l) => l.codigo === c)?.nome ?? (c ? String(c) : '—');
  return { gravacao, apoio, pode, motivo, motivoFuncionalidade, locais, locaisDoTipo, centros, nomeLocal };
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function data(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

/** "AAAA-MM-DDTHH:MM…" → "DD/MM/AAAA HH:MM". */
export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [d, h] = iso.split('T');
  return `${data(d)}${h ? ` ${h.slice(0, 5)}` : ''}`;
}

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
export const reais = (v: number) => REAIS.format(v);
export const qtd = (v: number) => QTD.format(v);
/** Número digitado com vírgula decimal ("1,5") ou ponto ("1.5"). */
export const numero = (t: string | number): number => Number(String(t).trim().replace(',', '.'));
/** Documento ano/mês/número. */
export const chaveDoc = (c: { ano: number; mes: number; doc: number }) =>
  `${c.doc} (${String(c.mes).padStart(2, '0')}/${c.ano})`;
