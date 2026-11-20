<script setup lang="ts">
// Quando a tela abre pelo menu sem um cadastro escolhido: orienta a buscar primeiro (o histórico é por
// cadastro; nunca a tabela inteira).
defineProps<{ texto: string; destino: string; rotulo: string }>();
</script>

<template>
  <p>{{ texto }}</p>
  <RouterLink :to="destino">{{ rotulo }}</RouterLink>
</template>
