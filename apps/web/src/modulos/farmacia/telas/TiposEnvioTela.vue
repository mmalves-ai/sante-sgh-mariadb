<script setup lang="ts">
// Tipos de envio à avaliação farmacêutica (ficha do M29, seção 7): `/farmacia/avaliacao/tipos`. Consulta.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { lerTipos } from '../api-farmacia.js';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';

const { t } = useI18n();
const l = useQuery({ queryKey: ['farmacia', 'tipos'], queryFn: () => lerTipos() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tp-titulo" data-testid="tela-farmacia-tipos">
    <h1 id="tp-titulo">{{ t('farmacia.tipos.titulo') }}</h1>
    <p>{{ t('farmacia.tipos.texto') }}</p>
    <ErroFarmacia v-if="l.error.value" :erro="l.error.value" />
    <table class="tabela">
      <caption class="sgh-visualmente-oculto">
        {{
          t('farmacia.tipos.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('farmacia.tipos.nome') }}</th>
          <th scope="col">{{ t('farmacia.tipos.ativo') }}</th>
          <th scope="col">{{ t('farmacia.tipos.centros') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in l.data.value ?? []" :key="x.id">
          <td>{{ x.id }} · {{ x.nome }}</td>
          <td>{{ x.ativo ? 'sim' : 'não' }}</td>
          <td>{{ x.centros }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
