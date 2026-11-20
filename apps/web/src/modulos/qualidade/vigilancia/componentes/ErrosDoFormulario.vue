<script setup lang="ts">
// Os erros da conferência do formulário (antes de ir ao servidor), em lista anunciada ao leitor de tela.
defineProps<{ erros: Readonly<Record<string, string>> }>();
</script>

<template>
  <ul
    v-if="Object.keys(erros).length"
    role="alert"
    class="lista-ccih erros-agravo"
    data-testid="erros-agravo"
  >
    <li v-for="(m, c) in erros" :key="c" :data-campo="c">{{ m }}</li>
  </ul>
</template>

<style scoped>
.erros-agravo {
  color: var(--sgh-alerta);
}
</style>
