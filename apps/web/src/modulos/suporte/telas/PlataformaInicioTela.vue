<script setup lang="ts">
// Início da conta da plataforma (ADR 0021): quem está entrando, o "Entrar como" (plataforma, ou suporte ativo
// com estabelecimento) e a tela "Suporte técnico" (designação e auditoria: só a plataforma; o suporte vê as
// próprias sessões para corrigir). Sem sessão da plataforma, vai ao login da plataforma.
import type { EuPlataforma } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { defineAsyncComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { buscarEu, sairPlataforma } from '../api-suporte.js';

const EntrarComoModal = defineAsyncComponent(() => import('../componentes/EntrarComoModal.vue'));
const { t } = useI18n();
const roteador = useRouter();
const eu = ref<EuPlataforma | null>(null);
const modal = ref(false);

onMounted(async () => {
  try {
    eu.value = await buscarEu();
  } catch {
    await roteador.replace('/plataforma/entrar');
  }
});

async function sair(): Promise<void> {
  await sairPlataforma().catch(() => undefined);
  window.location.assign('/plataforma/entrar');
}
</script>

<template>
  <section v-if="eu" class="plataforma" aria-labelledby="plataforma-titulo" data-testid="plataforma-inicio">
    <h1 id="plataforma-titulo">{{ t('suporte.inicioTitulo', { email: eu.conta.email }) }}</h1>
    <p>{{ t(`suporte.papel${eu.conta.papel}`) }}</p>
    <div class="plataforma__acoes">
      <SanteBotao
        v-if="eu.podeEntrarComo"
        :rotulo="t('suporte.entrarComo')"
        data-testid="abrir-como"
        @click="modal = true"
      />
      <p v-else data-testid="sem-como">{{ t('suporte.semComo') }}</p>
      <RouterLink to="/plataforma/suporte" data-testid="link-suporte">{{
        eu.podeDesignar ? t('suporte.suporteTecnico') : t('suporte.minhasSessoes')
      }}</RouterLink>
      <button type="button" class="plataforma__sair" data-testid="plataforma-sair" @click="sair">
        {{ t('suporte.sairConta') }}
      </button>
    </div>
    <EntrarComoModal v-if="modal" @fechar="modal = false" />
  </section>
</template>

<style scoped>
.plataforma__acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-3);
}
.plataforma__sair {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
}
</style>
