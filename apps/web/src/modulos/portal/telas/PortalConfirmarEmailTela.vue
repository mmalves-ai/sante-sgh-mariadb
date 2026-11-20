<script setup lang="ts">
// Portal do paciente, W0-10: a confirmação do e-mail novo pelo link enviado a ele (sem sessão: o token do link é a
// prova). O paciente confirma com um botão (o link aberto por um leitor automático de e-mail não troca nada sozinho);
// a conta passa ao e-mail novo e as sessões abertas dela terminam.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroPortal from '../componentes/ErroPortal.vue';
import { confirmarTrocaEmailPortal } from '../api-portal-paciente.js';

const { t } = useI18n();
const rota = useRoute();
const um = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));
const hospital = computed(() => um(rota.query['h']));
const token = computed(() => um(rota.query['t']));
const pronto = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function confirmar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    pronto.value = (await confirmarTrocaEmailPortal(hospital.value, token.value)).emailMascarado ?? '—';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <main class="portal-paciente" aria-labelledby="pac-confirmar-email" data-testid="portal-confirmar-email">
    <p class="portal-marca">{{ t('portal.titulo') }}</p>
    <h1 id="pac-confirmar-email">{{ t('portal.seguranca.confirmarEmail') }}</h1>
    <ErroPortal v-if="erro" :erro="erro" />
    <section class="portal-painel">
      <template v-if="!pronto">
        <p>{{ t('portal.seguranca.confirmarEmailAjuda') }}</p>
        <SanteBotao
          :rotulo="t('portal.seguranca.confirmarEmail')"
          :desabilitado="ocupado || !hospital || !token"
          data-testid="pac-confirmar-email"
          @acionar="confirmar"
        />
      </template>
      <template v-else>
        <SanteAlerta
          :texto="t('portal.seguranca.emailConfirmado', { email: pronto })"
          variante="info"
          anunciar
        />
        <RouterLink :to="`/paciente/${hospital}`">{{ t('portal.seguranca.irEntrar') }}</RouterLink>
      </template>
    </section>
  </main>
</template>

<style src="../componentes/estilo-portal.css"></style>
