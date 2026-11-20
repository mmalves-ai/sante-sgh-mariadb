<script setup lang="ts">
// Erro da classificação: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação; a recusa
// com detalhe do servidor (o texto de produto da regra), esse detalhe; o resto, a mensagem geral com a correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-classificacao.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (c && te(`classificacao.recusas.${c}`)) return t(`classificacao.recusas.${c}`);
  if (c && te(`classificacao.protocolo.problemas.${c}`)) return t(`classificacao.protocolo.problemas.${c}`);
  const e = props.erro;
  if (e instanceof ErroApi && e.status >= 400 && e.status < 500 && e.problema?.detail)
    return e.problema.detail;
  return null;
});
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-classificacao">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
