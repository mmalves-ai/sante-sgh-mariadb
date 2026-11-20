<script setup lang="ts">
// W0-09: "Voltar a pendente" no item do critério de liberação do setor (ondas 1 a 4). É fato novo com motivo: a
// situação anterior fica na história (evento e trilha). O item calculado pelo sistema não se registra nem se volta.
import { SanteBotao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { voltarCriterioPendente } from '../api.js';
import AcaoCicloDialogo from './AcaoCicloDialogo.vue';

/** Itens calculados pelo sistema (a API recusa com `item-calculado`); espelho da lista do servidor. */
const CALCULADOS: readonly string[] = ['operacoes-conferidas', 'pentest-sem-critico'];

const props = defineProps<{ setor: string; item: string; rotulo: string; situacao: string; onda: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const aberto = ref(false);
const mostra = computed(() => props.situacao !== 'pendente' && !CALCULADOS.includes(props.item));
const executar = (motivo: string) => voltarCriterioPendente(props.setor, props.item, motivo);
const feito = () => cliente.invalidateQueries({ queryKey: ['coexistencia', props.onda] });
</script>

<template>
  <template v-if="mostra">
    <SanteBotao
      :rotulo="t('coexistencia.ciclo.voltarPendente')"
      variante="texto"
      :data-testid="`voltar-pendente-${props.setor}-${props.item}`"
      @acionar="aberto = true"
    />
    <AcaoCicloDialogo
      v-model:visivel="aberto"
      :titulo="t('coexistencia.ciclo.voltarPendenteTitulo', { item: props.rotulo })"
      :texto="t('coexistencia.ciclo.voltarPendenteTexto')"
      :rotulo="t('coexistencia.ciclo.voltarPendente')"
      :executar="executar"
      @feito="feito"
    />
  </template>
</template>
