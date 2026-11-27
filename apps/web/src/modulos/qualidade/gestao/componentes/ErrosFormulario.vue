<script setup lang="ts">
// Os erros da conferência do formulário (antes de ir ao servidor), em lista anunciada ao leitor de tela.
// O alerta envolve a lista: role="alert" na própria <ul> tira a semântica de lista e o axe acusa "listitem".
defineProps<{ erros: Readonly<Record<string, string>> }>();
</script>

<template>
  <div v-if="Object.keys(erros).length" role="alert" data-testid="erros-gestao">
    <ul class="lista-ccih erros-gestao">
      <li v-for="(m, c) in erros" :key="c" :data-campo="c">{{ m }}</li>
    </ul>
  </div>
</template>

<style scoped>
.erros-gestao {
  color: var(--sgh-alerta);
}
</style>
