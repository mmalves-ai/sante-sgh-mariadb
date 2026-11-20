<script setup lang="ts">
// A senha de novo nas gravações críticas (reautenticação; SBIS-07): nunca guardada, enviada só com o pedido.
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

const senha = defineModel<string>({ required: true });
defineProps<{ testid: string }>();
const { t } = useI18n();
const id = `senha-${useId()}`;
</script>

<template>
  <div class="campo">
    <label :for="id">{{ t('adm.comum.senha') }}</label>
    <input
      :id="id"
      v-model="senha"
      type="password"
      autocomplete="current-password"
      required
      :aria-describedby="`${id}-ajuda`"
      :data-testid="testid"
    />
    <small :id="`${id}-ajuda`">{{ t('adm.comum.senhaAjuda') }}</small>
  </div>
</template>

<style scoped>
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 24rem;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
</style>
