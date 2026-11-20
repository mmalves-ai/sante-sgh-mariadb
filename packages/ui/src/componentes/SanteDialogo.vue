<script setup lang="ts">
// Janela modal: foco preso, Esc fecha e devolve o foco a quem abriu (OpenVue Dialog).
import Dialog from 'openvue/dialog';

defineProps<{ titulo: string; largura?: string }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ aberto: []; fechado: [] }>();
</script>

<template>
  <Dialog
    v-model:visible="visivel"
    modal
    dismissable-mask
    :header="titulo"
    :style="{ width: largura ?? '36rem', maxWidth: '96vw' }"
    @show="emit('aberto')"
    @after-hide="emit('fechado')"
  >
    <slot />
    <template v-if="$slots.rodape" #footer><slot name="rodape" /></template>
  </Dialog>
</template>
