<script setup lang="ts">
// Aviso de que a funcionalidade do diagnóstico está só em consulta (ainda não liberada para gravar neste
// estabelecimento ou setor), com o motivo do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null | undefined }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso-sadt" data-testid="sadt-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('sadt.emConsulta')" />
    <p>{{ motivo }}</p>
  </div>
</template>

<style scoped>
.aviso-sadt {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.aviso-sadt p {
  margin: 0;
}
</style>
