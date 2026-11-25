<script setup lang="ts">
// Erro em português claro, sem detalhe técnico, com o código de correlação para o suporte (regra 15).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagemDoErro } from './erros/problem-details.js';

const props = defineProps<{ erro: unknown }>();
const { t } = useI18n();
const m = computed(() => mensagemDoErro(props.erro));
</script>

<template>
  <div class="erro" role="alert" data-testid="mensagem-erro">
    <SanteAlerta :texto="t(m.titulo)" variante="alerta" />
    <p>{{ t(m.texto) }}</p>
    <p v-if="m.motivo" class="erro__motivo" data-testid="mensagem-erro-motivo">{{ m.motivo }}</p>
    <p v-if="m.correlacao" class="erro__correlacao">{{ t('erros.correlacao', { codigo: m.correlacao }) }}</p>
  </div>
</template>

<style scoped>
.erro {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.erro p {
  margin: 0;
}
.erro__correlacao {
  font-family: var(--sgh-fonte-codigo);
  color: var(--sgh-texto-secundario);
}
</style>
