<script setup lang="ts">
// Alerta clínico ou aviso: vermelho distinto do vinho da marca, sempre com ícone e texto.
import { computed } from 'vue';
import SanteIcone from '../icones/SanteIcone.vue';
import type { NomeIcone } from '../icones/caminhos.js';

const props = withDefaults(
  defineProps<{
    texto: string;
    variante?: 'alerta' | 'aviso' | 'info';
    icone?: NomeIcone;
    anunciar?: boolean;
  }>(),
  { variante: 'alerta', icone: 'alerta', anunciar: false },
);
if (props.texto.trim() === '') throw new Error('SanteAlerta exige texto: cor nunca é a única informação');
const classe = computed(() => `sgh-alerta--${props.variante}`);
</script>

<template>
  <span class="sgh-alerta" :class="classe" :role="anunciar ? 'alert' : undefined" :data-variante="variante">
    <SanteIcone :nome="icone" />
    <span>{{ texto }}</span>
  </span>
</template>

<style scoped>
.sgh-alerta {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-radius: 4px;
  font-weight: 700;
  border: 1px solid currentColor;
}
.sgh-alerta--alerta {
  color: var(--sgh-alerta);
  background: var(--sgh-fundo-elevado);
}
.sgh-alerta--aviso {
  color: var(--sgh-aviso);
  background: var(--sgh-fundo-elevado);
}
.sgh-alerta--info {
  color: var(--sgh-info);
  background: var(--sgh-fundo-elevado);
}
</style>
