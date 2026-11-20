<script setup lang="ts">
// As pendências do SESMT (alerta: já descumpre a norma; aviso: está para vencer), em lista curta.
import type { PendenciaResposta } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';

defineProps<{ pendencias: readonly PendenciaResposta[] }>();
const { t } = useI18n();
</script>

<template>
  <ul v-if="pendencias.length" class="pendencias" :aria-label="t('sesmt.pendencias')">
    <li v-for="p in pendencias" :key="p.codigo" :class="p.gravidade" :data-testid="`pendencia-${p.codigo}`">
      {{ p.texto }}
    </li>
  </ul>
  <span v-else class="secundario">{{ t('sesmt.semPendencias') }}</span>
</template>

<style scoped>
.pendencias {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.pendencias li {
  padding: 0.125rem 0.5rem;
  border-radius: 0.75rem;
  border: 1px solid currentColor;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
}
.pendencias li.alerta {
  color: var(--sgh-alerta);
}
.pendencias li.aviso {
  color: var(--sgh-aviso);
}
.secundario {
  color: var(--p-text-muted-color);
}
</style>
