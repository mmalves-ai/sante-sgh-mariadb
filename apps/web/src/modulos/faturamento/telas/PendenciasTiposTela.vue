<script setup lang="ts">
// Tipos de pendência (ficha do M30, seção 7): `/faturamento/pendencias-tipos`. Os tipos de pendência da conta e os
// módulos em que valem, e o controle da pendência na conta. A manutenção fica desligada (POL-3): o nome do tipo é texto
// longo, que o cadastro genérico ainda não grava (D-CRUD-30).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { lerTiposPendencia } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t } = useI18n();
const q = useQuery({ queryKey: ['faturamento', 'tipos'], queryFn: () => lerTiposPendencia() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tip-titulo" data-testid="tela-faturamento-tipos">
    <h1 id="tip-titulo">{{ t('faturamento.tipos.titulo') }}</h1>
    <p>{{ t('faturamento.tipos.texto') }}</p>
    <AvisoFaturamento :motivo="t('faturamento.tipos.soConsulta')" />
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tip-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.codigo') }}</th>
            <th scope="col">{{ t('faturamento.nome') }}</th>
            <th scope="col">{{ t('faturamento.tipos.modulos') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in q.data.value.tipos" :key="x.id">
            <td>{{ x.id }}</td>
            <td>{{ x.nome }}</td>
            <td>{{ x.modulos.join(', ') || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('faturamento.tipos.controles') }}</h2>
      <ul>
        <li v-for="c in q.data.value.controles" :key="c.id">{{ c.id }} · {{ c.nome }}</li>
      </ul>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
