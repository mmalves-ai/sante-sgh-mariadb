// Dados comuns das telas do SADT: o estado da gravação (as funcionalidades por setor, cada ação e a habilitação da
// sessão) e o apoio (prestadores, executantes, exames, recipientes, convênios e motivos de rejeição).
import { useQuery } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { lerApoioSadt, lerGravacaoSadt } from './api-sadt.js';

export function usarSadt(setor?: Ref<string>) {
  const gravacao = useQuery({
    queryKey: ['sadt', 'gravacao'],
    queryFn: () => lerGravacaoSadt(),
    staleTime: 30_000,
  });
  const apoio = useQuery({
    queryKey: computed(() => ['sadt', 'apoio', setor?.value ?? '']),
    queryFn: () => lerApoioSadt(setor?.value || null),
    staleTime: 60_000,
  });
  /** A operação grava agora no prefixo (setor, requisicao, orcamento, rastreio, critico, portal)? */
  const pode = (prefixo: string, op: string) =>
    gravacao.data.value?.operacoes[`${prefixo}:${op}`]?.ligada ?? false;
  const motivo = (prefixo: string, op: string) =>
    gravacao.data.value?.operacoes[`${prefixo}:${op}`]?.motivo ?? null;
  const motivoSetor = computed(() => {
    const g = gravacao.data.value;
    const s = (setor?.value || 'laboratorio') as keyof NonNullable<typeof g>['setores'];
    return g && !g.setores[s]?.ligada ? (g.setores[s]?.motivo ?? null) : null;
  });
  return { gravacao, apoio, pode, motivo, motivoSetor };
}

/** Data de hoje no relógio do navegador (AAAA-MM-DD), o padrão dos filtros. */
export function hojeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "AAAA-MM-DDTHH:MM:SS" → "DD/MM/AAAA HH:MM". */
export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [d, h] = iso.split('T');
  return `${(d ?? '').split('-').reverse().join('/')}${h ? ` ${h.slice(0, 5)}` : ''}`;
}

/** Os valores das variáveis de fórmula como a tela os tem (texto) → `variaveis` da gravação (só os preenchidos). */
export function variaveisDigitadas(valores: Record<number, string>): { codigo: number; valor: number }[] {
  return Object.entries(valores)
    .filter(([, v]) => String(v ?? '').trim() !== '')
    .map(([k, v]) => ({ codigo: Number(k), valor: Number(String(v).replace(',', '.')) }))
    .filter((x) => Number.isFinite(x.valor));
}

/** Os valores gravados das variáveis → os campos da tela. */
export function valoresDasVariaveis(
  vs: readonly { codigo: number; valor: number | null }[] | undefined,
): Record<number, string> {
  return Object.fromEntries((vs ?? []).map((v) => [v.codigo, v.valor === null ? '' : String(v.valor)]));
}
