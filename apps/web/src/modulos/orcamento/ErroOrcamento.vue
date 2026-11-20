<script setup lang="ts">
// Erro da tela do orçamento empresarial (M54, etapa 7): o código da recusa (versão fechada, desatualizada, segregação,
// sem linhas, outra empresa, limite) vira o texto da tela; o resto segue o erro padrão.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../exames/api-exames.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`orcamentoEmpresarial.recusa.${c}`) ? t(`orcamentoEmpresarial.recusa.${c}`) : null;
});
</script>

<template>
  <SanteAlerta v-if="texto" :texto="texto" variante="aviso" anunciar data-testid="recusa-orcamento" />
  <MensagemErro v-else :erro="erro" />
</template>
