<script setup lang="ts">
// Adiantamentos a fornecedores e médicos (ficha do M32, seção 7): `/financeiro/pagar/adiantamentos`. Consulta do
// adiantamento, do compensado e do saldo; nesta fase não há operação de gravar (o adiantamento ganha operação depois).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { listarAdiantamentos } from '../api-financeiro.js';
import { data, reais } from '../usar-financeiro.js';

const { t } = useI18n();
const lista = useQuery({ queryKey: ['financeiro', 'adiantamentos'], queryFn: () => listarAdiantamentos() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ad-titulo" data-testid="tela-fin-adiantamentos">
    <h1 id="ad-titulo">{{ t('financeiro.adiantamentos.titulo') }}</h1>
    <p>{{ t('financeiro.adiantamentos.texto') }}</p>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="ad-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.credor') }}</th>
          <th scope="col">{{ t('financeiro.tipo') }}</th>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.emissao') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.compensado') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.saldo') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in lista.data.value" :key="a.id">
          <td>{{ a.credor }}</td>
          <td>{{ a.tipoCredor }}</td>
          <td>{{ a.documento }}</td>
          <td>{{ data(a.emissao) }}</td>
          <td>{{ reais(a.valor) }}</td>
          <td>{{ reais(a.compensado) }}</td>
          <td>{{ reais(a.saldo) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
