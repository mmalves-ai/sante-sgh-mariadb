<script setup lang="ts">
// F3.8, 07-FIN linhas 100 e 109: escolher o fornecedor pelo nome, documento ou código, nunca pelo código interno
// digitado às cegas. Digita-se parte do nome; a lista aparece logo abaixo e um clique escolhe.
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarFornecedores, type FornecedorEncontrado } from '../api-contabil-fiscal.js';

const props = defineProps<{ rotulo: string; prefixo: string; desabilitado?: boolean }>();
const emit = defineEmits<{ escolhido: [FornecedorEncontrado] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      dica: 'Digite parte do nome, o CNPJ, o CPF ou o código',
      nenhum: 'Nenhum fornecedor encontrado.',
      escolhido: 'Escolhido: {nome}',
    },
  },
});
const termo = ref('');
const escolhido = ref<FornecedorEncontrado | null>(null);
const achados = useQuery({
  queryKey: computed(() => ['financeiro', 'busca-fornecedor', termo.value.trim()]),
  queryFn: () => buscarFornecedores(termo.value.trim()),
  enabled: computed(() => termo.value.trim().length >= 2 && !escolhido.value),
});
function escolher(f: FornecedorEncontrado) {
  escolhido.value = f;
  termo.value = f.nome;
  emit('escolhido', f);
}
function digitado(v: string) {
  termo.value = v;
  escolhido.value = null;
}
</script>

<template>
  <span class="campo">
    <label :for="`${prefixo}-busca`">{{ props.rotulo }}</label>
    <input
      :id="`${prefixo}-busca`"
      :value="termo"
      :placeholder="t('dica')"
      :disabled="desabilitado"
      maxlength="100"
      autocomplete="off"
      :data-testid="`${prefixo}-busca`"
      @input="digitado(($event.target as HTMLInputElement).value)"
    />
    <small v-if="escolhido" class="secundario" role="status" :data-testid="`${prefixo}-escolhido`">
      {{ t('escolhido', { nome: escolhido.nome }) }}
    </small>
    <ul v-else-if="achados.data.value?.length" class="lista-simples" :data-testid="`${prefixo}-achados`">
      <li v-for="f in achados.data.value" :key="f.id">
        <button type="button" @click="escolher(f)">
          {{ f.nome }}<template v-if="f.documento"> ({{ f.documento }})</template>
        </button>
      </li>
    </ul>
    <small v-else-if="achados.data.value" class="secundario">{{ t('nenhum') }}</small>
  </span>
</template>
