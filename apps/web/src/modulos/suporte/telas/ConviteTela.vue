<script setup lang="ts">
// Convite (ADR 0021): a pessoa do suporte técnico define a própria senha pelo token de uso único que a
// plataforma lhe entregou. O token vem no endereço e vai só ao servidor (que guarda apenas o hash dele).
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { aceitarConvite } from '../api-suporte.js';

const { t } = useI18n();
const rota = useRoute();
const senha = ref('');
const pronto = ref(false);
const erro = ref('');
const enviando = ref(false);

async function enviar(): Promise<void> {
  const token = typeof rota.query['token'] === 'string' ? rota.query['token'] : '';
  if (enviando.value) return;
  enviando.value = true;
  erro.value = '';
  try {
    await aceitarConvite(token, senha.value);
    senha.value = '';
    pronto.value = true;
  } catch {
    erro.value = t('suporte.conviteInvalido');
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="convite" aria-labelledby="convite-titulo">
    <h1 id="convite-titulo">{{ t('suporte.conviteTitulo') }}</h1>
    <template v-if="pronto">
      <p role="status" data-testid="convite-pronto">{{ t('suporte.senhaDefinida') }}</p>
      <RouterLink to="/entrar">{{ t('suporte.irEntrar') }}</RouterLink>
    </template>
    <form v-else class="convite__form" @submit.prevent="enviar">
      <label class="convite__campo">
        <span>{{ t('suporte.senha') }}</span>
        <input v-model="senha" type="password" autocomplete="new-password" minlength="12" required />
        <small>{{ t('suporte.senhaAjuda') }}</small>
      </label>
      <p v-if="erro" role="alert">{{ erro }}</p>
      <SanteBotao :rotulo="t('suporte.definirSenha')" tipo="submit" :desabilitado="enviando" />
    </form>
  </section>
</template>

<style scoped>
.convite__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 26rem;
}
.convite__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.convite__campo input {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
}
</style>
