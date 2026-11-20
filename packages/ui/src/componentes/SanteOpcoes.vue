<script setup lang="ts" generic="V extends string">
// Grupo de opções (rádio nativo em fieldset): acessível por teclado e leitor de tela.
import { useId } from 'vue';

defineProps<{
  legenda: string;
  opcoes: readonly { readonly valor: V; readonly rotulo: string }[];
  nome?: string;
}>();
const valor = defineModel<V>({ required: true });
const id = useId();
</script>

<template>
  <fieldset class="sgh-opcoes">
    <legend class="sgh-opcoes__legenda">{{ legenda }}</legend>
    <label v-for="o in opcoes" :key="o.valor" class="sgh-opcoes__opcao">
      <input v-model="valor" type="radio" :name="nome ?? `sgh-opcoes-${id}`" :value="o.valor" />
      <span>{{ o.rotulo }}</span>
    </label>
  </fieldset>
</template>

<style scoped>
.sgh-opcoes {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2) var(--sgh-espaco-4);
}
.sgh-opcoes__legenda {
  font-weight: 600;
  padding: 0 var(--sgh-espaco-1);
}
.sgh-opcoes__opcao {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
  cursor: pointer;
}
.sgh-opcoes__opcao input {
  width: 1.1em;
  height: 1.1em;
  accent-color: var(--sgh-primaria);
}
.sgh-opcoes__opcao input:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
