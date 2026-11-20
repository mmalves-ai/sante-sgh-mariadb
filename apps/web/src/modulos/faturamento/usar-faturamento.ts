// Dados comuns das telas da conta do paciente: o estado da gravação (cada funcionalidade e ação), o dia do banco e os
// formatos (data, moeda, competência).
import { useQuery } from '@tanstack/vue-query';
import { lerApoio, lerGravacao } from './api-faturamento.js';

/** `particular`: as telas do caixa e do orçamento (o perfil do caixa não lê contas). */
export function usarFaturamento(particular = false) {
  const gravacao = useQuery({
    queryKey: ['faturamento', 'gravacao', particular],
    queryFn: () => lerGravacao(particular),
    staleTime: 30_000,
  });
  const apoio = useQuery({
    queryKey: ['faturamento', 'apoio', particular],
    queryFn: () => lerApoio(particular),
    staleTime: 60_000,
  });
  const pode = (op: string) => gravacao.data.value?.operacoes[op]?.ligada ?? false;
  const motivo = (op: string) => gravacao.data.value?.operacoes[op]?.motivo ?? null;
  const motivoFuncionalidade = (f: string) => {
    const x = gravacao.data.value?.funcionalidades[f];
    return x && !x.ligada ? (x.motivo ?? null) : null;
  };
  return { gravacao, apoio, pode, motivo, motivoFuncionalidade };
}

export function data(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('/');
}
export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [d, h] = iso.split('T');
  return `${data(d)}${h ? ` ${h.slice(0, 5)}` : ''}`;
}
const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
export const reais = (v: number) => REAIS.format(v);
export const num = (v: number) => NUM.format(v);
export const numero = (t: string | number): number =>
  Number(String(t).trim().replace(/\./g, '').replace(',', '.'));
export const competenciaTexto = (ano: number, mes: number) => `${String(mes).padStart(2, '0')}/${ano}`;
export const competenciaAtual = (hoje: string | undefined) =>
  hoje ? hoje.slice(0, 7) : new Date().toISOString().slice(0, 7);
