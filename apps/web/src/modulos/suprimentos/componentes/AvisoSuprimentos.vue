<script setup lang="ts">
// Aviso de que a funcionalidade está só em consulta (ainda não liberada para gravar neste estabelecimento, local ou
// pessoa), com o motivo do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null | undefined }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso-suprimentos" data-testid="suprimentos-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('suprimentos.emConsulta')" />
    <p>{{ motivo }}</p>
  </div>
</template>

<style scoped>
.aviso-suprimentos {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.aviso-suprimentos p {
  margin: 0;
}
</style>
