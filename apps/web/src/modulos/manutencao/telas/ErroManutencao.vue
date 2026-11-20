<script setup lang="ts">
// Erro de uma ação da manutenção (M55, etapa 1): a recusa de negócio conhecida (código do Problem Details) com o texto
// da aplicação, para quem abre, atende, cadastra ou planeja saber o motivo e o caminho; o resto, a mensagem geral com
// o código de correlação (nunca o texto cru do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-manutencao.js';

// `grupo` (W0-08): o grupo de recusas procurado primeiro (o alerta e o ciclo de vida têm `desatualizado` e outros próprios).
const props = defineProps<{ erro: unknown; grupo?: 'alerta' | 'ciclo' | 'pmoc' }>();
const { t, te } = useI18n();
const GRUPOS = ['abertura', 'acao', 'execucao', 'cobertura', 'servidor'] as const;
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (!c) return null;
  const g = [...(props.grupo ? [props.grupo] : []), ...GRUPOS].find((x) =>
    te(`manutencao.recusas.${x}.${c}`),
  );
  return g ? `manutencao.recusas.${g}.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-manutencao">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
