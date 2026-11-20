<script setup lang="ts">
// Recálculo de saldos (ficha do M28, seção 7): `/suprimentos/recalculos`. Consulta auditada dos recálculos de saldo
// já executados (início, fim, quem, competência e se terminou). A execução do recálculo não é feita por esta tela.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { lerRecalculos } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { quando } from '../usar-suprimentos.js';

const { t } = useI18n();
const r = useQuery({ queryKey: ['suprimentos', 'recalculos'], queryFn: () => lerRecalculos() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rec-titulo" data-testid="tela-suprimentos-recalculos">
    <h1 id="rec-titulo">{{ t('suprimentos.recalculos.titulo') }}</h1>
    <p>{{ t('suprimentos.recalculos.texto') }}</p>
    <ErroSuprimentos v-if="r.error.value" :erro="r.error.value" />
    <p v-else-if="!r.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="rec-tabela">
        <caption>
          {{
            t('suprimentos.recalculos.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.recalculos.inicio') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.fim') }}</th>
            <th scope="col">{{ t('suprimentos.usuario') }}</th>
            <th scope="col">{{ t('suprimentos.competencia') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.terminado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in r.data.value.itens" :key="x.id">
            <td>{{ quando(x.inicio) }}</td>
            <td>{{ quando(x.fim) }}</td>
            <td>{{ x.usuario }}</td>
            <td>{{ x.competencia }}</td>
            <td>{{ x.terminado ? t('suprimentos.sim') : t('suprimentos.nao') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="r.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
