<script setup lang="ts">
// Escrituração de entradas (ficha do M32, seção 7): `/financeiro/fiscal/entradas`. As notas de entrada da competência
// com o CFOP por item, para a conferência (a nota com item sem CFOP fica marcada).
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerEntradas } from '../api-financeiro.js';
import { data } from '../usar-financeiro.js';

const { t } = useI18n();
const filtro = reactive({ competencia: '' });
const pedido = ref<{ ano?: string; mes?: string }>({});
const lista = useQuery({
  queryKey: computed(() => ['financeiro', 'entradas', pedido.value]),
  queryFn: () => lerEntradas(pedido.value),
});
function consultar() {
  const [ano, mes] = filtro.competencia.split('-');
  pedido.value = filtro.competencia ? { ano: ano!, mes: String(Number(mes)) } : {};
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="en-titulo" data-testid="tela-fin-entradas">
    <h1 id="en-titulo">{{ t('financeiro.entradas.titulo') }}</h1>
    <p>{{ t('financeiro.entradas.texto') }}</p>
    <p>
      <RouterLink to="/cadastros/dominios/grupo/financeiroEscrituracao" data-testid="entradas-cadastros">
        {{ t('financeiro.tabelasDoItem') }}
      </RouterLink>
    </p>
    <form class="filtros" @submit.prevent="consultar">
      <span class="campo">
        <label for="en-competencia">{{ t('financeiro.competencia') }}</label>
        <input id="en-competencia" v-model="filtro.competencia" type="month" data-testid="en-competencia" />
      </span>
      <button type="submit" data-testid="en-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="en-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.entradas.numero') }}</th>
          <th scope="col">{{ t('financeiro.emissao') }}</th>
          <th scope="col">{{ t('financeiro.entradas.fornecedor') }}</th>
          <th scope="col">{{ t('financeiro.entradas.cfop') }}</th>
          <th scope="col">{{ t('financeiro.entradas.tipoDocumento') }}</th>
          <th scope="col">{{ t('financeiro.entradas.chave') }}</th>
          <th scope="col">{{ t('financeiro.entradas.itensComCfop') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in lista.data.value" :key="n.nota">
          <td>{{ n.numero }}</td>
          <td>{{ data(n.emissao) }}</td>
          <td>{{ n.fornecedor }}</td>
          <td>{{ n.cfop ?? '—' }}</td>
          <td>{{ n.tipoDocumento ?? '—' }}</td>
          <td>{{ n.chaveNfe || '—' }}</td>
          <td>
            {{ n.itensComCfop }} / {{ n.itens }}
            <span v-if="n.itensComCfop < n.itens" class="secundario">
              ({{ n.itens - n.itensComCfop }} {{ t('financeiro.entradas.semCfop') }})
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
