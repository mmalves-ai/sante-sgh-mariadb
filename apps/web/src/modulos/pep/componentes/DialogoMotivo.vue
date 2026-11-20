<script setup lang="ts">
// Motivo de acesso (M15, regra 11): a primeira abertura de cada paciente na sessão pede o motivo, de uma lista
// fechada. O motivo vai à trilha com cada leitura; sem ele, o servidor não abre o prontuário.
import {
  MOTIVOS_ACESSO_PRONTUARIO,
  type MotivoAcessoProntuario,
  ROTULOS_MOTIVO_ACESSO,
} from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteOpcoes } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { informarMotivo } from '../api-pep.js';

const props = defineProps<{ paciente: number; restricaoAtendimento: boolean }>();
const emit = defineEmits<{ informado: [motivo: MotivoAcessoProntuario]; cancelado: [] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const motivo = ref<MotivoAcessoProntuario>('assistencia');
const enviando = ref(false);
const erro = ref<unknown>(null);
const opcoes = MOTIVOS_ACESSO_PRONTUARIO.map((v) => ({ valor: v, rotulo: ROTULOS_MOTIVO_ACESSO[v] }));

async function confirmar(): Promise<void> {
  enviando.value = true;
  erro.value = null;
  try {
    await informarMotivo(props.paciente, motivo.value);
    visivel.value = false;
    emit('informado', motivo.value);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('pep.motivo.titulo')" @fechado="emit('cancelado')">
    <div data-testid="dialogo-motivo">
      <p>{{ t('pep.motivo.texto') }}</p>
      <p v-if="restricaoAtendimento">{{ t('pep.motivo.restricao') }}</p>
      <SanteOpcoes
        v-model="motivo"
        :legenda="t('pep.motivo.legenda')"
        :opcoes="opcoes"
        nome="motivo-acesso"
      />
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('pep.motivo.confirmar')"
          :desabilitado="enviando"
          data-testid="confirmar-motivo"
          @acionar="confirmar"
        />
        <SanteBotao :rotulo="t('pep.motivo.cancelar')" variante="secundario" @acionar="visivel = false" />
      </div>
    </div>
  </SanteDialogo>
</template>

<style scoped>
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
</style>
