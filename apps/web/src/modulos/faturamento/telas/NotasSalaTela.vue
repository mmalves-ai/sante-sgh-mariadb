<script setup lang="ts">
// Nota de sala e consumo para a conta (ficha do M30, seção 7): `/cirurgia/notas-sala`. As cirurgias dos últimos 30 dias
// com a conta; a nota abre em `/cirurgia/cirurgias/:id/nota-sala`.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { listarCirurgias } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { data } from '../usar-faturamento.js';

const { t } = useI18n();
const q = useQuery({ queryKey: ['faturamento', 'cirurgias'], queryFn: () => listarCirurgias() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ns-titulo" data-testid="tela-faturamento-notas">
    <h1 id="ns-titulo">{{ t('faturamento.notas.titulo') }}</h1>
    <p>{{ t('faturamento.notas.texto') }}</p>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <table v-else class="tabela" data-testid="ns-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('faturamento.notas.cirurgia') }}</th>
          <th scope="col">{{ t('faturamento.data') }}</th>
          <th scope="col">{{ t('faturamento.notas.sala') }}</th>
          <th scope="col">{{ t('faturamento.contaRotulo') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="q.data.value.length === 0">
          <td colspan="4">{{ t('faturamento.nenhum') }}</td>
        </tr>
        <tr v-for="c in q.data.value" :key="c.id">
          <td>
            <RouterLink :to="`/cirurgia/cirurgias/${c.id}/nota-sala`" :data-testid="`ns-${c.id}`">{{
              c.id
            }}</RouterLink>
          </td>
          <td>{{ data(c.data) }}</td>
          <td>{{ c.sala }}</td>
          <td>{{ c.conta ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
