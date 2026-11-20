<script setup lang="ts">
// Aviso de que a funcionalidade está só em consulta (ainda não liberada para gravar neste estabelecimento ou setor),
// com o motivo do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso-atd" data-testid="atendimento-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('atendimento.emConsulta')" />
    <p>{{ motivo }}</p>
  </div>
</template>

<style scoped>
.aviso-atd {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.aviso-atd p {
  margin: 0;
}
</style>
