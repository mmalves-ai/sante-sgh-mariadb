<script setup lang="ts">
// Portal do médico externo, W0-10: a confirmação do e-mail novo pelo link enviado a ele (sem sessão: o token do link é
// a prova). O médico confirma com um botão (o link aberto por um leitor automático de e-mail não troca nada sozinho); a
// conta passa ao e-mail novo e as sessões abertas dela terminam.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { confirmarTrocaEmailMedico } from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';

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
    pronto.value = (await confirmarTrocaEmailMedico(hospital.value, token.value)).emailMascarado || '—';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <main class="portal-medico" aria-labelledby="pm-confirmar-email" data-testid="pm-confirmar-email-tela">
    <p>{{ t('portalMedico.titulo') }}</p>
    <h1 id="pm-confirmar-email">{{ t('portalMedico.conta.confirmarEmail') }}</h1>
    <ErroPortalMedico v-if="erro" :erro="erro" />
    <section class="painel">
      <template v-if="!pronto">
        <p>{{ t('portalMedico.conta.confirmarEmailAjuda') }}</p>
        <SanteBotao
          :rotulo="t('portalMedico.conta.confirmarEmail')"
          :desabilitado="ocupado || !hospital || !token"
          data-testid="pm-confirmar-email"
          @acionar="confirmar"
        />
      </template>
      <template v-else>
        <SanteAlerta
          :texto="t('portalMedico.conta.emailConfirmado', { email: pronto })"
          variante="info"
          anunciar
        />
        <RouterLink :to="{ name: 'portal.resultados' }">{{ t('portalMedico.conta.irEntrar') }}</RouterLink>
      </template>
    </section>
  </main>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
