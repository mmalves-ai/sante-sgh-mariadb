<script setup lang="ts">
// Origem e indicação do paciente na abertura do atendimento (F3.1, 02-CAD linha 12): a recepção registra de onde o
// paciente veio sem sair da abertura. Fica recolhido e só consulta ao abrir (a abertura não paga a leitura de quem não
// vai usar); aberto, é o mesmo componente da ficha, com a mesma validação na hora e a mesma regra do servidor. Só
// aparece para quem lê o cadastro do paciente; o formulário, para quem edita.
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerOpcoes, type Opcoes } from '../api-vinculos.js';
import CaptacaoPaciente from './CaptacaoPaciente.vue';

const props = defineProps<{ idPaciente: number }>();
const { t } = useI18n();
const aberto = ref(false);
const opcoes = ref<Opcoes | null>(null);
function alternar(e: Event): void {
  aberto.value = (e.target as HTMLDetailsElement).open;
  if (aberto.value && !opcoes.value)
    void lerOpcoes()
      .then((o) => {
        opcoes.value = o;
      })
      .catch(() => undefined);
}
// Trocar o paciente recolhe: a origem mostrada nunca é a do paciente anterior.
watch(
  () => props.idPaciente,
  () => {
    aberto.value = false;
  },
);
</script>

<template>
  <details
    v-if="pode('cadastro.paciente.ler')"
    :key="idPaciente"
    data-testid="abrir-atd-origem"
    @toggle="alternar"
  >
    <summary>{{ t('vinculos.captacao.titulo') }}</summary>
    <CaptacaoPaciente
      v-if="aberto"
      :id-paciente="idPaciente"
      :pode-editar="pode('cadastro.paciente.editar')"
      :opcoes="opcoes"
    />
  </details>
</template>
