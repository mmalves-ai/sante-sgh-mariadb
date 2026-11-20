<script setup lang="ts">
// Erro das telas da notificação de incidentes: a recusa de negócio conhecida (código do Problem Details) com o texto da
// aplicação (as do fluxo do NSP vêm do domínio, as mesmas da API); o resto, a mensagem geral com o código de
// correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api.js';
import { RECUSAS_NOTIFICACAO, RECUSAS_OCORRENCIA } from '../i18n.js';
import { RECUSAS_ANALISE, RECUSAS_VIGILANCIA } from '../i18n-seguranca.js';

// `recusas`: as da tela, conferidas antes (ex.: a análise e a vigilância de produto têm a própria versão desatualizada).
const props = defineProps<{ erro: unknown; recusas?: Readonly<Record<string, string>> }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (!c) return null;
  if (props.recusas && c in props.recusas) return props.recusas[c] ?? null;
  if (c in RECUSAS_NOTIFICACAO) return RECUSAS_NOTIFICACAO[c as keyof typeof RECUSAS_NOTIFICACAO];
  if (c in RECUSAS_OCORRENCIA) return RECUSAS_OCORRENCIA[c as keyof typeof RECUSAS_OCORRENCIA];
  if (c in RECUSAS_ANALISE) return RECUSAS_ANALISE[c as keyof typeof RECUSAS_ANALISE];
  if (c in RECUSAS_VIGILANCIA) return RECUSAS_VIGILANCIA[c as keyof typeof RECUSAS_VIGILANCIA];
  return te(`qualidade.recusasApi.${c}`) ? t(`qualidade.recusasApi.${c}`) : null;
});
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-qualidade">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
