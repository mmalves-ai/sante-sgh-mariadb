<script setup lang="ts">
// Faixa "AMBIENTE DE TREINAMENTO" (M37, ficha seção 7; cap-09 §9.12): com AMBIENTE=treino, em todas as telas e também
// nas impressões (não leva a classe que some na impressão), para ninguém confundir o treino com o atendimento real.
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div class="faixa-treino" role="note" data-testid="faixa-treino">{{ t('casca.treino') }}</div>
</template>

<style scoped>
.faixa-treino {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-3);
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.08em;
  color: var(--sgh-texto);
  background: var(--sgh-aviso-fundo);
  border-bottom: 2px solid var(--sgh-borda-forte);
}
</style>
