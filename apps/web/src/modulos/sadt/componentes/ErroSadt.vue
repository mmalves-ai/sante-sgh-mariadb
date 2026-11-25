<script setup lang="ts">
// Erro do diagnóstico: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação; o resto, a
// mensagem geral com o código de correlação (nunca o texto do servidor). O 503 do tipo "indisponivel" sem código (a
// função precisa do banco do cliente e a fonte de dados não o tem) vira o aviso próprio, não um erro genérico.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-sadt.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const semBanco = (e: unknown): boolean =>
  e instanceof ErroApi && e.status === 503 && String(e.problema?.type ?? '').endsWith('indisponivel');
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro) ?? (semBanco(props.erro) ? 'indisponivel' : null);
  return c && te(`sadt.recusas.${c}`) ? `sadt.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-sadt">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
