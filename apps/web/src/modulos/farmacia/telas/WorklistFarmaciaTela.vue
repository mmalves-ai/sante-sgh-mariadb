<script setup lang="ts">
// Início › Minha fila de trabalho › Farmácia: prescrições a validar (ficha do M29, seção 7): `/inicio/farmacia`. Os
// itens da fila humana das unidades com internados, os de maior prioridade primeiro; relê em tempo real.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { CANAL_AVALIACAO, lerWorklist } from '../api-farmacia.js';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario, usarAvisosFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const w = useQuery({
  queryKey: ['farmacia', 'worklist'],
  queryFn: () => lerWorklist(),
  refetchInterval: 60_000,
});
usarAvisosFarmacia(CANAL_AVALIACAO, () => void w.refetch());
</script>

<template>
  <section class="tela-agenda" aria-labelledby="wf-titulo" data-testid="tela-worklist-farmacia">
    <h1 id="wf-titulo">{{ t('farmacia.worklist.titulo') }}</h1>
    <p>{{ t('farmacia.worklist.texto') }}</p>
    <SanteBotao variante="secundario" :rotulo="t('farmacia.atualizar')" @acionar="() => void w.refetch()" />
    <ErroFarmacia v-if="w.error.value" :erro="w.error.value" />
    <dl v-if="w.data.value" class="resumo" data-testid="wf-resumo">
      <dt>{{ t('farmacia.worklist.aValidar') }}</dt>
      <dd>{{ w.data.value.aValidar }}</dd>
      <dt>{{ t('farmacia.worklist.altoRisco') }}</dt>
      <dd>{{ w.data.value.altoRisco }}</dd>
      <dt>{{ t('farmacia.worklist.antimicrobianos') }}</dt>
      <dd>{{ w.data.value.antimicrobianos }}</dd>
      <dt>{{ t('farmacia.worklist.intervencoes') }}</dt>
      <dd>{{ w.data.value.intervencoesAbertas }}</dd>
    </dl>
    <ul>
      <li v-for="i in w.data.value?.itens ?? []" :key="i.item">
        {{ i.prioridade }} · {{ i.leito }} · {{ i.descricao }} · {{ t(`farmacia.classes.${i.classe}`) }} ·
        {{ horario(i.desde) }}
      </li>
    </ul>
    <RouterLink to="/farmacia/avaliacao" data-testid="wf-abrir">{{
      t('farmacia.worklist.abrir')
    }}</RouterLink>
  </section>
</template>
