<script setup lang="ts">
// Botão do Sante SGH sobre o OpenVue. Ação destrutiva usa contorno e confirmação, nunca o vinho cheio.
import Button from 'openvue/button';
import Dialog from 'openvue/dialog';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    rotulo: string;
    variante?: 'primario' | 'secundario' | 'destrutivo' | 'texto';
    /** Pergunta de confirmação (obrigatória na variante destrutiva). */
    confirmacao?: string;
    desabilitado?: boolean;
    tipo?: 'button' | 'submit';
  }>(),
  { variante: 'primario', confirmacao: '', desabilitado: false, tipo: 'button' },
);
defineOptions({ inheritAttrs: false });
const emit = defineEmits<{ acionar: [] }>();
const { t } = useI18n();
const confirmando = ref(false);

if (props.variante === 'destrutivo' && props.confirmacao.trim() === '') {
  throw new Error('SanteBotao destrutivo exige a pergunta de confirmação');
}

function clicar(): void {
  if (props.variante === 'destrutivo') confirmando.value = true;
  else emit('acionar');
}
function confirmar(): void {
  confirmando.value = false;
  emit('acionar');
}
</script>

<template>
  <Button
    :label="rotulo"
    :type="tipo"
    :disabled="desabilitado"
    :severity="variante === 'destrutivo' ? 'danger' : variante === 'secundario' ? 'secondary' : undefined"
    :outlined="variante === 'destrutivo'"
    :text="variante === 'texto'"
    :data-variante="variante"
    class="sgh-botao"
    v-bind="$attrs"
    @click="clicar"
  />
  <Dialog
    v-if="variante === 'destrutivo'"
    v-model:visible="confirmando"
    modal
    :header="t('ui.confirmar.titulo')"
    :closable="true"
    :pt="{ root: { 'data-testid': 'confirmacao' } }"
  >
    <p>{{ confirmacao }}</p>
    <template #footer>
      <Button :label="t('ui.confirmar.nao')" severity="secondary" @click="confirmando = false" />
      <Button :label="t('ui.confirmar.sim')" severity="danger" outlined @click="confirmar" />
    </template>
  </Dialog>
</template>

<style scoped>
.sgh-botao {
  min-height: var(--sgh-alvo-minimo);
}
</style>
