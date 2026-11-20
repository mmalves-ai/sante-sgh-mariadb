<script setup lang="ts">
// Período obrigatório das consultas de auditoria (até 31 dias; o servidor confere de novo).
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

const inicio = defineModel<string>('inicio', { required: true });
const fim = defineModel<string>('fim', { required: true });
const { t } = useI18n();
const id = useId();
</script>

<template>
  <div class="campo">
    <label :for="`ini-${id}`">{{ t('adm.comum.inicio') }}</label>
    <input :id="`ini-${id}`" v-model="inicio" type="date" required data-testid="periodo-inicio" />
  </div>
  <div class="campo">
    <label :for="`fim-${id}`">{{ t('adm.comum.fim') }}</label>
    <input :id="`fim-${id}`" v-model="fim" type="date" required data-testid="periodo-fim" />
  </div>
</template>

<style scoped>
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
