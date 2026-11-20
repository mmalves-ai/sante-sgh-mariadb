<script setup lang="ts">
// Diálogo de justificativa do faturamento SUS (M51, etapa 1): justificar um aviso da crítica ou reabrir a competência
// fechada (supervisor). O texto tem no mínimo 10 caracteres; o servidor confere a versão e grava a trilha.
import { SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from './ErroFaturamento.vue';

const props = defineProps<{
  titulo: string;
  ajuda: string;
  rotuloAcao: string;
  gravar: (texto: string) => Promise<void>;
}>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const texto = ref('');
const erro = ref<unknown>(null);
const gravando = ref(false);
const valido = computed(() => texto.value.trim().length >= 10);

watch(visivel, (v) => {
  if (v) {
    texto.value = '';
    erro.value = null;
  }
});

async function confirmar(): Promise<void> {
  if (!valido.value) return;
  erro.value = null;
  gravando.value = true;
  try {
    await props.gravar(texto.value.trim());
    visivel.value = false;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="titulo">
    <form class="form" data-testid="form-justificativa-sus" @submit.prevent="confirmar">
      <p>{{ ajuda }}</p>
      <SanteCampoTexto
        v-model="texto"
        :rotulo="t('faturamentoSus.competencias.justificativa')"
        :max-bytes="500"
        multilinha
        obrigatorio
        data-testid="justificativa-sus"
      />
      <ErroFaturamento v-if="erro" :erro="erro" />
      <div class="linha">
        <SanteBotao
          :rotulo="rotuloAcao"
          tipo="submit"
          :desabilitado="gravando || !valido"
          data-testid="botao-confirmar-justificativa"
        />
        <SanteBotao
          :rotulo="t('faturamentoSus.criticas.cancelar')"
          variante="texto"
          @acionar="visivel = false"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
