<script setup lang="ts">
// Paginação no servidor das telas do cadastro (anterior / próxima).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ total: number; porPagina: number; rotulo: string }>();
const pagina = defineModel<number>({ required: true });
const { t } = useI18n();
const totalPaginas = computed(() => Math.max(1, Math.ceil(props.total / props.porPagina)));
</script>

<template>
  <nav v-if="totalPaginas > 1" class="paginas" :aria-label="rotulo">
    <button type="button" :disabled="pagina <= 1" @click="pagina--">{{ t('cadastro.anterior') }}</button>
    <span>{{ t('cadastro.pagina', { pagina, total: totalPaginas }) }}</span>
    <button type="button" :disabled="pagina >= totalPaginas" @click="pagina++">
      {{ t('cadastro.proxima') }}
    </button>
  </nav>
</template>

<style scoped>
.paginas {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
</style>
