<script setup lang="ts">
// Aviso de que a ação está só em consulta (ainda não liberada neste estabelecimento, unidade ou pessoa), com o motivo
// do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null | undefined }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso-farmacia" data-testid="farmacia-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('farmacia.emConsulta')" />
    <p>{{ motivo }}</p>
  </div>
</template>

<style scoped>
.aviso-farmacia {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.aviso-farmacia p {
  margin: 0;
}
</style>
