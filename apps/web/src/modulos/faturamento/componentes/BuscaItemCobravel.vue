<script setup lang="ts">
// Escolha de item cobrável por código ou descrição (serviços acessórios, F8 06-FAT linha 23): digita-se parte do
// código ou da descrição e escolhe-se na lista; o item já gravado na regra aparece com o código e a descrição.
import { SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { buscarItensCobraveis, type ItemCobravel } from '../api-servicos-acessorios.js';

const props = defineProps<{
  rotulo: string;
  rotuloBusca: string;
  conhecidos: readonly ItemCobravel[];
  testid: string;
}>();
const modelo = defineModel<number>({ required: true });
const termo = ref('');
const achados = ref<ItemCobravel[]>([]);
let pedido = 0;
watch(termo, async (t) => {
  const meu = ++pedido;
  if (t.trim().length < 2) {
    achados.value = [];
    return;
  }
  try {
    const r = await buscarItensCobraveis(t.trim());
    if (meu === pedido) achados.value = r;
  } catch {
    if (meu === pedido) achados.value = [];
  }
});
const opcoes = computed(() => {
  const vistos = new Map<number, ItemCobravel>();
  for (const i of [...props.conhecidos, ...achados.value]) vistos.set(i.id, i);
  return [
    { valor: 0, rotulo: '' },
    ...[...vistos.values()].map((i) => ({ valor: i.id, rotulo: `${i.codigo} - ${i.descricao}` })),
  ];
});
</script>

<template>
  <div class="busca-item">
    <label>
      {{ props.rotuloBusca }}
      <input v-model="termo" type="search" autocomplete="off" :data-testid="`${props.testid}-busca`" />
    </label>
    <SanteSelecao v-model="modelo" :rotulo="props.rotulo" :opcoes="opcoes" :data-testid="props.testid" />
  </div>
</template>
