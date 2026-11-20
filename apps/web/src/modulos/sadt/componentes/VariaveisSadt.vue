<script setup lang="ts">
// As variáveis de fórmula do exame (cadastro do exame; o laudo estruturado do eco e os exames de laboratório com
// fórmula): um campo numérico por variável, com o valor já gravado. Quem usa monta `variaveis` com `variaveisDigitadas`.
import { useI18n } from 'vue-i18n';

defineProps<{
  variaveis: readonly { codigo: number; identificacao: string; descricao: string }[];
  bloqueado: boolean;
  prefixo: string;
}>();
const valores = defineModel<Record<number, string>>({ required: true });
const { t } = useI18n();
</script>

<template>
  <fieldset v-if="variaveis.length" class="variaveis-sadt" :data-testid="`${prefixo}-variaveis`">
    <legend>{{ t('sadt.digitacao.variaveis') }}</legend>
    <span v-for="v in variaveis" :key="v.codigo" class="campo">
      <label :for="`${prefixo}-var-${v.codigo}`">{{ v.identificacao }} · {{ v.descricao }}</label>
      <input
        :id="`${prefixo}-var-${v.codigo}`"
        v-model="valores[v.codigo]"
        inputmode="decimal"
        :disabled="bloqueado"
        :data-testid="`${prefixo}-var-${v.codigo}`"
      />
    </span>
  </fieldset>
</template>

<style scoped>
.variaveis-sadt {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 0;
  padding: 0;
  margin: 0;
}
</style>
