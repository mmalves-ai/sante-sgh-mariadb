<script setup lang="ts">
// Abas da tela "Testes de assinatura de dados" (M35, ficha seção 7): as operações e assinaturas (M03) e a
// prontidão por setor (M35, o mesmo item do menu). A aba de prontidão só aparece com config.coexistencia.ler. M38: a
// vigilância diária de gravação em produção, com config.assinatura.ler.
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';

defineProps<{ atual: 'operacoes' | 'prontidao' }>();
const { t } = useI18n();
const verProntidao = pode('config.coexistencia.ler');
const verOperacoes = pode('config.assinatura.ler');
</script>

<template>
  <nav class="abas" :aria-label="t('config.prontidao.abas')" data-testid="abas-assinaturas">
    <RouterLink
      v-if="verOperacoes"
      to="/administracao/coexistencia/assinaturas"
      :aria-current="atual === 'operacoes' ? 'page' : undefined"
      data-testid="aba-operacoes"
      >{{ t('config.prontidao.abaOperacoes') }}</RouterLink
    >
    <RouterLink
      v-if="verProntidao"
      to="/administracao/coexistencia/prontidao"
      :aria-current="atual === 'prontidao' ? 'page' : undefined"
      data-testid="aba-prontidao"
      >{{ t('config.prontidao.abaProntidao') }}</RouterLink
    >
  </nav>
</template>

<style scoped>
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
  border-block-end: 1px solid var(--sgh-borda);
}
.abas a {
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.abas a[aria-current='page'] {
  font-weight: 600;
  border-block-end: 3px solid currentcolor;
}
</style>
