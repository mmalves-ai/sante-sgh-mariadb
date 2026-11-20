<script setup lang="ts">
// Aviso de que a rouparia está só em consulta (a funcionalidade não liberada neste estabelecimento, setor ou pessoa),
// com o motivo do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso" data-testid="rouparia-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('rouparia.emConsulta')" />
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
