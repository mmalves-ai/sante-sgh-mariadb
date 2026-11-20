<script setup lang="ts">
// Erro do atendimento: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação; o resto, a
// mensagem geral com o código de correlação (nunca o texto do servidor). W1-05: a recusa com dependentes (regra 4 do
// CRUD) lista quantos e quais registros impedem a exclusão.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { codigoDaRecusa } from '../api-atendimento.js';
import { dependentesDoErro } from '../regras-tela.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`atendimento.recusas.${c}`) ? `atendimento.recusas.${c}` : null;
});
const dependentes = computed(() =>
  props.erro instanceof ErroApi ? dependentesDoErro(props.erro.problema) : [],
);
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-atendimento">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
    <ul v-if="dependentes.length" data-testid="recusa-dependentes">
      <li v-for="d in dependentes" :key="d.rotulo">
        {{ t('atendimento.cancelar.dependente', { rotulo: d.rotulo, n: d.quantidade }) }}
        <span v-if="d.amostra.length" class="secundario">
          ({{ t('atendimento.cancelar.exemplos', { lista: d.amostra.join(', ') }) }})</span
        >
      </li>
    </ul>
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
