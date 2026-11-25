<script setup lang="ts">
// Vínculos do paciente na ficha (F3.1): coberturas e origem e indicação, com as opções carregadas uma vez; os programas de
// saúde e linhas de cuidado (F8, 02-CAD linha 11) só com cadastro.linhaCuidado.ler (LGPD art. 11).
import { ref } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerOpcoes, type Opcoes } from '../api-vinculos.js';
import CaptacaoPaciente from './CaptacaoPaciente.vue';
import CoberturasPaciente from './CoberturasPaciente.vue';
import LinhasCuidadoPaciente from './LinhasCuidadoPaciente.vue';

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
  <LinhasCuidadoPaciente v-if="pode('cadastro.linhaCuidado.ler')" :id-paciente="props.idPaciente" />
</template>
