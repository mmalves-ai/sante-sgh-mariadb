<script setup lang="ts">
// Abas da tela "Saúde do sistema" (o mesmo item do menu): os painéis de saúde (M09) e a conferência da instalação
// (M60, etapa 2) e a fumaça do servidor (M60, etapa 3). As duas exigem sistema.saude.ler; a casca já barrou quem não tem.
import { useI18n } from 'vue-i18n';

defineProps<{ atual: 'paineis' | 'conferencia' | 'fumaca' }>();
const { t } = useI18n();
</script>

<template>
  <nav class="abas" :aria-label="t('implantacao.abas.rotulo')" data-testid="abas-saude">
    <RouterLink
      to="/administracao/saude"
      :aria-current="atual === 'paineis' ? 'page' : undefined"
      data-testid="aba-paineis"
      >{{ t('implantacao.abas.paineis') }}</RouterLink
    >
    <RouterLink
      to="/administracao/saude/instalacao"
      :aria-current="atual === 'conferencia' ? 'page' : undefined"
      data-testid="aba-conferencia"
      >{{ t('implantacao.abas.conferencia') }}</RouterLink
    >
    <RouterLink
      to="/administracao/saude/fumaca"
      :aria-current="atual === 'fumaca' ? 'page' : undefined"
      data-testid="aba-fumaca"
      >{{ t('implantacao.abas.fumaca') }}</RouterLink
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
