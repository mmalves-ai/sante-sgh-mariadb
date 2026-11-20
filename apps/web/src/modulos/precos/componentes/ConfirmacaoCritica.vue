<script setup lang="ts">
// Justificativa e a senha de novo (operação crítica, SBIS-07): os dois campos que toda gravação do M12 pede.
import { SanteCampoTexto } from '@sgh/ui';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

const justificativa = defineModel<string>('justificativa', { required: true });
const senha = defineModel<string>('senha', { required: true });
defineProps<{ testid: string }>();
const { t } = useI18n();
const id = `senha-${useId()}`;
</script>

<template>
  <div class="critica">
    <SanteCampoTexto
      v-model="justificativa"
      :rotulo="t('precos.comum.justificativa')"
      :max-bytes="200"
      obrigatorio
      :data-testid="`${testid}-justificativa`"
    />
    <div class="campo">
      <label :for="id">{{ t('precos.comum.senha') }}</label>
      <input
        :id="id"
        v-model="senha"
        type="password"
        autocomplete="current-password"
        required
        :data-testid="`${testid}-senha`"
      />
    </div>
  </div>
</template>

<style scoped>
.critica,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 40rem;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
