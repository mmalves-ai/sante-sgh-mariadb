<script setup lang="ts">
// Um indicador com as parcelas impressas (regra 5): o valor em destaque e a conta "numerador ÷ denominador × fator".
import { computed } from 'vue';
import { contaDaParcela, type ParcelaTexto, valorDaParcela } from '../regras-ccih.js';

const props = defineProps<{ parcela: ParcelaTexto }>();
const valor = computed(() => valorDaParcela(props.parcela));
const conta = computed(() => contaDaParcela(props.parcela));
</script>

<template>
  <span class="parcela">
    <strong>{{ valor }}</strong>
    <span class="secundario conta">{{ conta }}</span>
  </span>
</template>

<style scoped>
.parcela {
  display: inline-flex;
  flex-direction: column;
}
.conta {
  font-variant-numeric: tabular-nums;
}
</style>
