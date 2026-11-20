<script setup lang="ts">
// Itens SUS da conta (ficha do M30, seção 7): `/faturamento/contas/:id/sigtap`. O vínculo com a tabela SUS de cada
// honorário e exame que o lançamento automático gravou (somente leitura).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { lerSigtap } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const id = computed(() => Number(props.id));
const s = useQuery({
  queryKey: computed(() => ['faturamento', 'sigtap', id.value]),
  queryFn: () => lerSigtap(id.value),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sig-titulo" data-testid="tela-faturamento-sigtap">
    <h1 id="sig-titulo">{{ t('faturamento.sigtap.titulo', { id }) }}</h1>
    <p>{{ t('faturamento.sigtap.texto') }}</p>
    <p>
      <RouterLink :to="`/faturamento/contas/${id}`">{{ t('faturamento.conta.titulo', { id }) }}</RouterLink>
    </p>
    <ErroFaturamento v-if="s.error.value" :erro="s.error.value" />
    <p v-else-if="!s.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <table v-else class="tabela" data-testid="sig-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('faturamento.codigo') }}</th>
          <th scope="col">{{ t('faturamento.nome') }}</th>
          <th scope="col">{{ t('faturamento.sigtap.coluna') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="s.data.value.length === 0">
          <td colspan="3">{{ t('faturamento.nenhum') }}</td>
        </tr>
        <tr v-for="x in s.data.value" :key="x.item">
          <td>{{ x.codigo }}</td>
          <td>{{ x.nome }}</td>
          <td>{{ x.sigtapCodigo ?? x.sigtap ?? t('faturamento.sigtap.semVinculo') }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
