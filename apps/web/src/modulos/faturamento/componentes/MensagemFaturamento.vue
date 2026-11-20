<script setup lang="ts">
// Mensagem de sucesso de uma gravação (com os avisos do servidor).
import { SanteAlerta } from '@sgh/ui';

defineProps<{ texto: string | null; avisos?: readonly string[]; testid?: string }>();
</script>

<template>
  <div v-if="texto" role="status" :data-testid="testid ?? 'fat-mensagem'">
    <SanteAlerta variante="info" :texto="texto" />
    <p v-for="a in avisos ?? []" :key="a" class="secundario">{{ a }}</p>
  </div>
</template>
