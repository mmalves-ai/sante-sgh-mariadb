<script setup lang="ts">
// Aviso de que a tela está só em consulta (sem a permissão de agir, ou a funcionalidade ainda não liberada para gravar
// neste estabelecimento ou setor), com o motivo do servidor.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ motivo: string | null }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="motivo" class="aviso" data-testid="nutricao-em-consulta">
    <SanteAlerta variante="aviso" :texto="t('nutricao.emConsulta')" />
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
