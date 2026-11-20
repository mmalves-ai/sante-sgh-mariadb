<script setup lang="ts">
// Erro das telas das especialidades e do lactário: a recusa de negócio conhecida (código do Problem Details) com o texto
// da aplicação e o detalhe do servidor quando ele traz as parcelas (dose divergente); o resto, a mensagem geral com o
// código de correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { codigoDaRecusa } from '../api-especialidades.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`especialidades.recusas.${c}`) ? `especialidades.recusas.${c}` : null;
});
const detalhe = computed(() =>
  props.erro instanceof ErroApi && codigoDaRecusa(props.erro) === 'dose-divergente'
    ? (props.erro.problema?.detail ?? null)
    : null,
);
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-especialidade">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
    <p v-if="detalhe">{{ detalhe }}</p>
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
