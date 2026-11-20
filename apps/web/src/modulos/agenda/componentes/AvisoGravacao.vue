<script setup lang="ts">
// Aviso de que a agenda está só em consulta (funcionalidade ainda não liberada: POL-3), com o motivo.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso" data-testid="agenda-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('agenda.emConsulta')" />
    <p>{{ motivo }}</p>
  </div>
</template>

<style scoped>
.aviso {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.aviso p {
  margin: 0;
}
</style>
