<script setup lang="ts">
// Busca de item faturável por código ou descrição para a restrição de cobertura (a tela nunca pede id digitado).
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarItensCobertura, type ItemCobertura } from '../api-cobertura.js';

const props = defineProps<{ rotulo: string; testid: string; rotuloAtual?: string | null }>();
const item = defineModel<number | null>({ required: true });
const emit = defineEmits<{ escolhido: [ItemCobertura] }>();
const { t } = useI18n();
const termo = ref('');
const achados = ref<ItemCobertura[]>([]);
const atual = ref<string | null>(props.rotuloAtual ?? null);
const buscando = ref(false);

async function buscar() {
  if (termo.value.trim().length < 2) return;
  buscando.value = true;
  try {
    achados.value = await buscarItensCobertura(termo.value.trim());
  } finally {
    buscando.value = false;
  }
}
function escolher(i: ItemCobertura) {
  item.value = i.id;
  atual.value = `${i.codigo} ${i.descricao}`;
  achados.value = [];
  termo.value = '';
  emit('escolhido', i);
}
function trocar() {
  item.value = null;
  atual.value = null;
}
</script>

<template>
  <fieldset class="campo" :data-testid="testid">
    <legend>{{ rotulo }}</legend>
    <p v-if="item !== null && atual" :data-testid="`${testid}-escolhido`">
      {{ atual }}
      <button type="button" :data-testid="`${testid}-trocar`" @click="trocar">
        {{ t('cobertura.trocar') }}
      </button>
    </p>
    <template v-else>
      <label
        >{{ t('cobertura.buscar') }}
        <input
          v-model="termo"
          minlength="2"
          maxlength="60"
          :data-testid="`${testid}-termo`"
          @keydown.enter.prevent="buscar"
      /></label>
      <button type="button" :disabled="buscando" :data-testid="`${testid}-buscar`" @click="buscar">
        {{ t('cobertura.buscarBotao') }}
      </button>
      <ul v-if="achados.length">
        <li v-for="i in achados" :key="i.id">
          <button type="button" :data-testid="`${testid}-op-${i.codigo}`" @click="escolher(i)">
            {{ i.codigo }} · {{ i.descricao }}
          </button>
        </li>
      </ul>
    </template>
  </fieldset>
</template>
