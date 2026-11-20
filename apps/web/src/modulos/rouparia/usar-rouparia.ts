// O painel da rouparia (enxoval, setores, cotas, envios abertos, movimentos de hoje, parâmetros e o estado da gravação)
// compartilhado pelas telas, e as opções dos combos (SanteSelecao com busca automática em lista grande, ADR 0027).
import {
  CATEGORIAS_PECA_ROUPA,
  LAVANDERIAS,
  MOTIVOS_PERDA_ROUPA,
  SITUACOES_MOVIMENTO_ROUPA,
  TIPOS_MOVIMENTO_ROUPA,
} from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerPainelRouparia } from './api-rouparia.js';

export const CHAVE_PAINEL_ROUPARIA = ['rouparia', 'painel'] as const;

export const ROTULO_TIPO = Object.fromEntries(
  TIPOS_MOVIMENTO_ROUPA.map((x) => [x.codigo, x.rotulo]),
) as Record<string, string>;
export const ROTULO_SITUACAO = Object.fromEntries(
  SITUACOES_MOVIMENTO_ROUPA.map((x) => [x.codigo, x.rotulo]),
) as Record<string, string>;
export const ROTULO_CATEGORIA = Object.fromEntries(
  CATEGORIAS_PECA_ROUPA.map((x) => [x.codigo, x.rotulo]),
) as Record<string, string>;
export const ROTULO_LAVANDERIA = Object.fromEntries(LAVANDERIAS.map((x) => [x.codigo, x.rotulo])) as Record<
  string,
  string
>;
export const ROTULO_MOTIVO = Object.fromEntries(
  MOTIVOS_PERDA_ROUPA.map((x) => [x.codigo, x.rotulo]),
) as Record<string, string>;

export const OPCOES_TIPO = TIPOS_MOVIMENTO_ROUPA.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
export const OPCOES_CATEGORIA = CATEGORIAS_PECA_ROUPA.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
export const OPCOES_LAVANDERIA = LAVANDERIAS.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
export const OPCOES_MOTIVO = MOTIVOS_PERDA_ROUPA.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));

export function usarPainelRouparia() {
  const painel = useQuery({ queryKey: CHAVE_PAINEL_ROUPARIA, queryFn: lerPainelRouparia, staleTime: 15_000 });
  const d = computed(() => painel.data.value ?? null);
  const pode = computed(() => d.value?.gravacao.operacoes['registrar']?.pode ?? false);
  const motivoPode = computed(() => d.value?.gravacao.operacoes['registrar']?.motivo ?? null);
  const aviso = computed(() => (d.value && !d.value.gravacao.ligada ? d.value.gravacao.motivo : null));
  const opcoesSetor = computed(() =>
    (d.value?.setores ?? []).map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` })),
  );
  const opcoesPeca = computed(() =>
    (d.value?.pecas ?? []).filter((p) => p.ativa).map((p) => ({ valor: p.id, rotulo: p.nome })),
  );
  const nomeSetor = (cc: number | null) =>
    cc === null ? null : (d.value?.setores.find((s) => s.codigo === cc)?.nome ?? `Setor ${cc}`);
  return { painel, d, pode, motivoPode, aviso, opcoesSetor, opcoesPeca, nomeSetor };
}
