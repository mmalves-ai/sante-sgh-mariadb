<script setup lang="ts">
// Conta corrente de convênios (ficha do M32, seção 7): `/financeiro/receber/convenios`. Os créditos dos convênios no
// movimento bancário; só consulta nesta fase.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { contaCorrenteConvenios } from '../api-financeiro.js';
import { data, reais } from '../usar-financeiro.js';

const { t } = useI18n();
const lista = useQuery({ queryKey: ['financeiro', 'convenios'], queryFn: () => contaCorrenteConvenios() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cc-titulo" data-testid="tela-fin-convenios">
    <h1 id="cc-titulo">{{ t('financeiro.convenios.titulo') }}</h1>
    <p>{{ t('financeiro.convenios.texto') }}</p>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="cc-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.data') }}</th>
          <th scope="col">{{ t('financeiro.receber.devedor') }}</th>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.historico') }}</th>
          <th scope="col">{{ t('financeiro.conta') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value" :key="x.id">
          <td>{{ data(x.data) }}</td>
          <td>{{ x.devedor }} {{ x.codigo }}</td>
          <td>{{ x.documento }}</td>
          <td>{{ x.historico }}</td>
          <td>{{ x.conta ?? '—' }}</td>
          <td>{{ reais(x.valor) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
