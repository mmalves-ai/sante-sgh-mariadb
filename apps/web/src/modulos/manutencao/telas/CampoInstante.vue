<script setup lang="ts">
// Data e hora de um instante da manutenção (início e fim do reparo, volta ao uso): os dois campos do sistema, juntos.
import { SanteData, SanteHora } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ rotulo: string; maximo?: string | null }>();
const data = defineModel<string | null>('data', { required: true });
const hora = defineModel<string | null>('hora', { required: true });
const { t } = useI18n();
</script>

<template>
  <fieldset class="instante">
    <legend>{{ rotulo }}</legend>
    <SanteData v-model="data" editavel :rotulo="t('manutencao.data')" :maximo="maximo ?? null" />
    <SanteHora v-model="hora" editavel :rotulo="t('manutencao.hora')" />
  </fieldset>
</template>

<style scoped>
.instante {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
</style>
