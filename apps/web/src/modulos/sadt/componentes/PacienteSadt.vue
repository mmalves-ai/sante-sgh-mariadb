<script setup lang="ts">
// O paciente nas listas do diagnóstico: nome, prontuário e idade (as telas de trabalho com a permissão do setor).
import type { PacienteSadt } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';

defineProps<{ paciente: PacienteSadt }>();
const { t } = useI18n();
</script>

<template>
  <span>
    <strong>{{ paciente.nome }}</strong>
    <span class="secundario">
      · {{ t('sadt.prontuario', { n: paciente.prontuario }) }}
      <template v-if="paciente.idadeAnos !== null">
        · {{ t('sadt.idade', { n: paciente.idadeAnos }) }}</template
      >
    </span>
  </span>
</template>
