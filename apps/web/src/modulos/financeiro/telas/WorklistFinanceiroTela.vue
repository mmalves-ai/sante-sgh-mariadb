<script setup lang="ts">
// Cartões da fila do financeiro (ficha do M32, seção 7): `/inicio/financeiro`. Títulos a aprovar, a pagar hoje,
// contas apresentadas sem título, créditos não identificados (das contas do escopo) e as obrigações fiscais e contábeis
// a gerar (EFD-REINF e lote contábil da competência anterior, DMED do ano anterior), conforme a permissão de cada cartão.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerWorklist } from '../api-financeiro.js';
import { data } from '../usar-financeiro.js';

const { t } = useI18n();
const fila = useQuery({ queryKey: ['financeiro', 'worklist'], queryFn: () => lerWorklist() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="wf-titulo" data-testid="tela-fin-worklist">
    <h1 id="wf-titulo">{{ t('financeiro.fila.titulo') }}</h1>
    <p>{{ t('financeiro.fila.texto') }}</p>
    <ErroFaturamento v-if="fila.error.value" :erro="fila.error.value" />
    <p v-else-if="fila.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <ul v-else-if="fila.data.value?.cartoes.length" class="cartoes" data-testid="wf-cartoes">
      <li v-for="c in fila.data.value.cartoes" :key="c.codigo" :data-testid="`wf-cartao-${c.codigo}`">
        <RouterLink :to="c.rota">
          <strong>{{ c.quantidade }}</strong> {{ c.titulo }}
        </RouterLink>
        <span class="secundario">{{ t('financeiro.fila.prazo') }}: {{ data(c.prazo) }}</span>
      </li>
    </ul>
    <p v-else>{{ t('financeiro.fila.vazia') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
