<script setup lang="ts">
import { computed } from 'vue';
import { CAMINHOS_ICONES, type NomeIcone } from './caminhos.js';

const props = withDefaults(defineProps<{ nome: NomeIcone; tamanho?: string }>(), { tamanho: '1.25em' });
const caminho = computed(() => CAMINHOS_ICONES[props.nome]);
</script>

<template>
  <!-- Decorativo: o texto ao lado sempre diz o que o ícone significa. -->
  <svg
    class="sgh-icone"
    :width="tamanho"
    :height="tamanho"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :data-icone="nome"
  >
    <path :d="caminho" />
  </svg>
</template>

<style scoped>
.sgh-icone {
  flex: none;
  vertical-align: -0.2em;
}
</style>
