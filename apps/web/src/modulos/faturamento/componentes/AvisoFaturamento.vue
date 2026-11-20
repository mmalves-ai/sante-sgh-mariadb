<script setup lang="ts">
// Aviso de que a funcionalidade está só em consulta (ainda não liberada neste estabelecimento, setor ou pessoa), com o
// motivo do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null | undefined }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso-faturamento" data-testid="faturamento-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('faturamento.emConsulta')" />
    <p>{{ motivo }}</p>
  </div>
</template>

<style scoped>
.aviso-faturamento {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.aviso-faturamento p {
  margin: 0;
}
</style>
