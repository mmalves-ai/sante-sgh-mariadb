<script setup lang="ts">
// Vínculos do paciente na ficha (F3.1): coberturas e origem e indicação, com as opções carregadas uma vez.
import { ref } from 'vue';
import { lerOpcoes, type Opcoes } from '../api-vinculos.js';
import CaptacaoPaciente from './CaptacaoPaciente.vue';
import CoberturasPaciente from './CoberturasPaciente.vue';

const props = defineProps<{ idPaciente: number; podeEditar: boolean }>();
const opcoes = ref<Opcoes | null>(null);
void lerOpcoes()
  .then((o) => {
    opcoes.value = o;
  })
  .catch(() => undefined);
</script>

<template>
  <CoberturasPaciente :id-paciente="props.idPaciente" :pode-editar="podeEditar" :opcoes="opcoes" />
  <CaptacaoPaciente :id-paciente="props.idPaciente" :pode-editar="podeEditar" :opcoes="opcoes" />
</template>
