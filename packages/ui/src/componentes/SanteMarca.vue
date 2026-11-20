<script setup lang="ts">
// Marca na barra: símbolo da rede + nome do produto (ambos da configuração; DP-49) + selo "provisório"
// enquanto o logo não for validado (DP-9).
import { useI18n } from 'vue-i18n';
import type { PacoteMarca } from '../marca/index.js';

defineProps<{ pacote: PacoteMarca; produto: string; invertida?: boolean }>();
const { t } = useI18n();
</script>

<template>
  <span class="sgh-marca" data-testid="marca">
    <img :src="invertida ? pacote.simboloBranco : pacote.simbolo" alt="" class="sgh-marca__simbolo" />
    <span class="sgh-marca__produto">{{ produto }}</span>
    <span v-if="pacote.naoConfigurada" class="sgh-marca__provisoria" data-testid="marca-nao-configurada">{{
      t('ui.marcaNaoConfigurada')
    }}</span>
    <span v-if="pacote.provisoria" class="sgh-marca__provisoria" :title="t('ui.marcaProvisoria')">{{
      t('ui.provisorio')
    }}</span>
  </span>
</template>

<style scoped>
.sgh-marca {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.sgh-marca__simbolo {
  height: 2em;
  width: auto;
}
.sgh-marca__produto {
  font-family: var(--sgh-fonte-titulo);
  font-weight: 700;
  font-size: 1.15em;
}
.sgh-marca__provisoria {
  font-size: var(--sgh-fonte-pequena);
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 var(--sgh-espaco-1);
}
</style>
