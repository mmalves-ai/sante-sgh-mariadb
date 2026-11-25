<script setup lang="ts">
// F3.8, 07-FIN linha 67: o credor do adiantamento escolhido pelo nome, documento ou código, nunca pelo código interno
// digitado às cegas. Vale para o fornecedor, o médico e o prestador terceiro (C1-026; o tipo vem da tela); digita-se parte do nome, a lista
// aparece logo abaixo e um clique escolhe. Trocar o tipo ou o texto desfaz a escolha (o par tipo e código não se mistura).
// A consulta recusada ou falha aparece escrita (nunca um campo mudo com o botão de gravar desligado sem explicação).
import type { CredorEncontrado } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarCredores } from '../api-financeiro.js';
import { buscarPrestadores } from '../api-pagamento-eletronico.js';

const props = defineProps<{
  tipo: 'fornecedor' | 'profissional' | 'prestador';
  rotulo: string;
  prefixo: string;
  /** O código escolhido (vazio: nada escolhido). A tela limpa o campo depois de gravar. */
  modelValue: number | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [number | null] }>();
const { t } = useI18n();
const termo = ref('');
const escolhido = ref<CredorEncontrado | null>(null);
const achados = useQuery({
  queryKey: computed(() => ['financeiro', 'busca-credor', props.tipo, termo.value.trim()]),
  queryFn: () =>
    props.tipo === 'prestador'
      ? buscarPrestadores(termo.value.trim())
      : buscarCredores(props.tipo, termo.value.trim()),
  // Duas letras ou mais; o código vale com um dígito só.
  enabled: computed(
    () => (termo.value.trim().length >= 2 || /^\d$/.test(termo.value.trim())) && !escolhido.value,
  ),
  retry: false,
});
function escolher(c: CredorEncontrado) {
  escolhido.value = c;
  termo.value = c.nome;
  emit('update:modelValue', c.id);
}
function digitado(v: string) {
  termo.value = v;
  if (escolhido.value) {
    escolhido.value = null;
    emit('update:modelValue', null);
  }
}
watch(
  () => props.tipo,
  () => {
    termo.value = '';
    escolhido.value = null;
    emit('update:modelValue', null);
  },
);
watch(
  () => props.modelValue,
  (v) => {
    if (v === null && escolhido.value) {
      escolhido.value = null;
      termo.value = '';
    }
  },
);
</script>

<template>
  <span class="campo">
    <label :for="`${prefixo}-busca`">{{ props.rotulo }}</label>
    <input
      :id="`${prefixo}-busca`"
      :value="termo"
      :placeholder="t('financeiro.adiantamentos.credorDica')"
      maxlength="100"
      autocomplete="off"
      :data-testid="`${prefixo}-busca`"
      @input="digitado(($event.target as HTMLInputElement).value)"
    />
    <small v-if="escolhido" class="secundario" role="status" :data-testid="`${prefixo}-escolhido`">
      {{ t('financeiro.adiantamentos.credorEscolhido', { nome: escolhido.nome, codigo: escolhido.id }) }}
    </small>
    <ul v-else-if="achados.data.value?.length" class="lista-simples" :data-testid="`${prefixo}-achados`">
      <li v-for="c in achados.data.value" :key="c.id">
        <button type="button" :data-testid="`${prefixo}-opcao-${c.id}`" @click="escolher(c)">
          {{ c.nome }}<template v-if="c.documento"> ({{ c.documento }})</template>
        </button>
      </li>
    </ul>
    <small v-else-if="achados.isError.value" class="secundario" role="alert" :data-testid="`${prefixo}-erro`">
      {{ t('financeiro.adiantamentos.credorErro') }}
    </small>
    <small v-else-if="achados.data.value" class="secundario" role="status" :data-testid="`${prefixo}-nenhum`">
      {{ t('financeiro.adiantamentos.credorNenhum') }}
    </small>
  </span>
</template>
