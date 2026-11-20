<script setup lang="ts">
// Nota de sala (ficha do M30, seção 7): `/cirurgia/cirurgias/:id/nota-sala`. Os procedimentos, a equipe por função e os
// itens que a cirurgia gerou na conta (consumo e honorários; somente leitura: a gravação do ato é a do centro cirúrgico).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { lerNotaSala } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { data, num, reais } from '../usar-faturamento.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const id = computed(() => Number(props.id));
const n = useQuery({
  queryKey: computed(() => ['faturamento', 'nota', id.value]),
  queryFn: () => lerNotaSala(id.value),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nota-titulo" data-testid="tela-faturamento-nota">
    <h1 id="nota-titulo">{{ t('faturamento.notas.titulo') }} · {{ id }}</h1>
    <ErroFaturamento v-if="n.error.value" :erro="n.error.value" />
    <p v-else-if="!n.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <p>{{ data(n.data.value.data) }} · {{ t('faturamento.notas.sala') }} {{ n.data.value.sala }}</p>
      <h2>{{ t('faturamento.notas.procedimentos') }}</h2>
      <ul>
        <li v-for="p in n.data.value.procedimentos" :key="p.codigo">{{ p.codigo }} · {{ p.nome }}</li>
      </ul>
      <h2>{{ t('faturamento.notas.equipe') }}</h2>
      <ul>
        <li v-for="e in n.data.value.equipe" :key="e.funcao">{{ e.funcao }}: {{ e.profissional }}</li>
      </ul>
      <h2>{{ t('faturamento.notas.itensConta') }}</h2>
      <p v-if="!n.data.value.conta">{{ t('faturamento.notas.semConta') }}</p>
      <template v-else>
        <p>
          <RouterLink :to="`/faturamento/contas/${n.data.value.conta}/lancamentos`">{{
            t('faturamento.conta.titulo', { id: n.data.value.conta })
          }}</RouterLink>
        </p>
        <table class="tabela" data-testid="nota-itens">
          <thead>
            <tr>
              <th scope="col">{{ t('faturamento.grupo') }}</th>
              <th scope="col">{{ t('faturamento.codigo') }}</th>
              <th scope="col">{{ t('faturamento.nome') }}</th>
              <th scope="col">{{ t('faturamento.quantidade') }}</th>
              <th scope="col">{{ t('faturamento.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in n.data.value.itensConta" :key="i.id">
              <td>{{ i.grupo }}</td>
              <td>{{ i.codigo }}</td>
              <td>{{ i.nome }}</td>
              <td>{{ num(i.quantidade) }}</td>
              <td>{{ reais(i.valor) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
