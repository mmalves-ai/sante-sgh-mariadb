<script setup lang="ts">
// Escolha de um bem pela plaqueta ou descrição (F8, 07-FIN linha 149): o termo vai ao servidor (lista paginada dos
// bens) e o resultado entra num combo; o modelo é o id do bem (null sem escolha). Bens baixados ficam de fora.
import { SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { lerBens } from './api-patrimonio.js';

const props = defineProps<{ rotuloBusca: string; rotulo: string; excluir?: number | null; testid: string }>();
const modelo = defineModel<number | null>({ required: true });
const termo = ref('');
// O termo vai ao servidor 300 ms depois da última tecla.
const termoAdiado = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(termo, (v) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termoAdiado.value = v), 300);
});
onBeforeUnmount(() => clearTimeout(espera));
const consulta = useQuery({
  queryKey: computed(() => ['patrimonio', 'busca-bem', termoAdiado.value.trim()]),
  queryFn: () => lerBens({ busca: termoAdiado.value.trim(), situacao: null, pagina: 1, tamanho: 30 }),
  enabled: computed(() => termoAdiado.value.trim().length >= 2),
  retry: false,
});
const opcoes = computed(() =>
  (consulta.data.value?.bens ?? [])
    .filter((b) => b.situacao !== 'baixado' && b.id !== props.excluir)
    .map((b) => ({ valor: String(b.id), rotulo: `${b.plaqueta} — ${b.descricao}` })),
);
const escolhido = computed({
  get: () => (modelo.value === null ? '' : String(modelo.value)),
  set: (v: string) => (modelo.value = v === '' ? null : Number(v)),
});
</script>

<template>
  <SanteCampoTexto v-model="termo" :rotulo="rotuloBusca" :max-bytes="60" :data-testid="`${testid}-busca`" />
  <SanteSelecao
    v-model="escolhido"
    :rotulo="rotulo"
    :opcoes="[{ valor: '', rotulo: '—' }, ...opcoes]"
    :data-testid="testid"
  />
</template>
