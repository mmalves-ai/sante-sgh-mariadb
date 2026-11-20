<script setup lang="ts">
// Renegociação de títulos (ficha do M32, seção 7): `/financeiro/receber/renegociacoes`. O histórico; só consulta.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { listarRenegociacoes } from '../api-financeiro.js';
import { quando } from '../usar-financeiro.js';

const { t } = useI18n();
const lista = useQuery({ queryKey: ['financeiro', 'renegociacoes'], queryFn: () => listarRenegociacoes() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rn-titulo" data-testid="tela-fin-renegociacoes">
    <h1 id="rn-titulo">{{ t('financeiro.renegociacoes.titulo') }}</h1>
    <p>{{ t('financeiro.renegociacoes.texto') }}</p>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="rn-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.renegociacoes.em') }}</th>
          <th scope="col">{{ t('financeiro.renegociacoes.responsavel') }}</th>
          <th scope="col">{{ t('financeiro.renegociacoes.titulos') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value" :key="x.id">
          <td>{{ quando(x.em) }}</td>
          <td>{{ x.responsavel }}</td>
          <td>{{ x.titulos }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
