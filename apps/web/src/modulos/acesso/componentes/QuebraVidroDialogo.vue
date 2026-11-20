<script setup lang="ts">
// Diálogo de quebra de vidro (M06, regra 8; cap-08 §8.5): aviso de que o acesso é excepcional e auditado,
// motivo de uma lista, justificativa curta obrigatória (CP1252, o mesmo validador do servidor), a senha de
// novo (reautenticação) e o prazo. O alerta ao Auditor sai pelo servidor (fila e-mail). A permissão é
// acesso.emergencia.solicitar (só perfil assistencial com conselho; a tela só mostra, o servidor decide).
import { MOTIVOS_QUEBRA_DE_VIDRO, type EmergenciaAberta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { abrirEmergencia } from '../api-acesso.js';

const props = defineProps<{ idPaciente: number; atendimento?: number }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ aberta: [EmergenciaAberta] }>();
const { t } = useI18n();
const motivo = ref<(typeof MOTIVOS_QUEBRA_DE_VIDRO)[number]>('intercorrencia-outro-setor');
const justificativa = ref('');
const senha = ref('');
const enviando = ref(false);
const erro = ref<unknown>(null);
const opcoes = computed(() =>
  MOTIVOS_QUEBRA_DE_VIDRO.map((m) => ({ valor: m, rotulo: t(`acesso.emergencia.motivos.${m}`) })),
);
const pronto = computed(() => justificativa.value.trim().length >= 15 && senha.value.length > 0);

async function confirmar(): Promise<void> {
  enviando.value = true;
  erro.value = null;
  try {
    const r = await abrirEmergencia({
      idPaciente: props.idPaciente,
      ...(props.atendimento ? { atendimento: props.atendimento } : {}),
      motivo: motivo.value,
      justificativa: justificativa.value.trim(),
      senha: senha.value,
    });
    senha.value = '';
    emit('aberta', r);
    visivel.value = false;
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('acesso.emergencia.titulo')">
    <form class="quebra-vidro" data-testid="dialogo-quebra-vidro" @submit.prevent="confirmar">
      <SanteAlerta variante="aviso" :texto="t('acesso.emergencia.aviso')" />
      <SanteSelecao v-model="motivo" :rotulo="t('acesso.emergencia.motivo')" :opcoes="opcoes" />
      <SanteCampoTexto
        v-model="justificativa"
        :rotulo="t('acesso.emergencia.justificativa')"
        :max-bytes="500"
        multilinha
        obrigatorio
      />
      <label class="quebra-vidro__senha">
        <span>{{ t('acesso.emergencia.senha') }}</span>
        <input v-model="senha" type="password" autocomplete="current-password" required />
      </label>
      <p>{{ t('acesso.emergencia.prazo') }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="quebra-vidro__acoes">
        <SanteBotao
          :rotulo="t('acesso.emergencia.cancelar')"
          variante="secundario"
          @acionar="visivel = false"
        />
        <SanteBotao
          :rotulo="t('acesso.emergencia.confirmar')"
          tipo="submit"
          :desabilitado="!pronto || enviando"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.quebra-vidro {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.quebra-vidro__senha {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.quebra-vidro__acoes {
  display: flex;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
</style>
