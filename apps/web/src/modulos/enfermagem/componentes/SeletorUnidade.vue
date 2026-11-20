<script setup lang="ts">
// A unidade de internação da tela (lembrada neste navegador).
import { SanteSelecao } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ modelValue: string; opcoes: readonly { valor: string; rotulo: string }[] }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
const { t } = useI18n();
</script>

<template>
  <SanteSelecao
    :model-value="modelValue"
    :rotulo="t('enfermagem.comum.unidade')"
    :opcoes="opcoes"
    data-testid="enf-unidade"
    @update:model-value="emit('update:modelValue', String($event))"
  />
</template>
