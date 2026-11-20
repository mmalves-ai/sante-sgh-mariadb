<script setup lang="ts">
// Busca de item do estoque (nome ou código) e a escolha; mostra se é rastreável (lote) ou controlado.
import type { ItemBusca } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarItens } from '../api-suprimentos.js';

const props = defineProps<{ rotulo?: string; testid?: string }>();
const emit = defineEmits<{ escolher: [item: ItemBusca] }>();
const { t } = useI18n();
const id = useId();
const termo = ref('');
const achados = ref<ItemBusca[]>([]);
const buscou = ref(false);
async function buscar(): Promise<void> {
  achados.value = await buscarItens(termo.value.trim());
  buscou.value = true;
}
function escolher(i: ItemBusca): void {
  emit('escolher', i);
  achados.value = [];
  termo.value = '';
  buscou.value = false;
}
const tid = (s: string) => `${props.testid ?? 'busca-item'}-${s}`;
</script>

<template>
  <div class="filtros">
    <span class="campo">
      <label :for="`busca-${id}`">{{ rotulo ?? t('suprimentos.item') }}</label>
      <input :id="`busca-${id}`" v-model="termo" :data-testid="tid('termo')" @keyup.enter="buscar" />
    </span>
    <SanteBotao
      variante="secundario"
      :rotulo="t('suprimentos.buscar')"
      :data-testid="tid('buscar')"
      @acionar="buscar"
    />
  </div>
  <ul v-if="achados.length" class="lista-busca">
    <li v-for="i in achados" :key="i.codigo">
      <SanteBotao
        variante="texto"
        :rotulo="`${i.codigo} · ${i.nome}${i.rastreavel ? ` · ${t('suprimentos.rastreavel')}` : ''}${i.controlado ? ` · ${t('suprimentos.controlado')}` : ''}`"
        :data-testid="tid(`opcao-${i.codigo}`)"
        @acionar="escolher(i)"
      />
    </li>
  </ul>
  <p v-else-if="buscou">{{ t('suprimentos.nenhum') }}</p>
</template>

<style scoped>
.lista-busca {
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
