<script setup lang="ts">
// Início › Notificar incidente em tela cheia (M48, etapa 1): para o celular e para o acompanhamento da devolutiva
// (aba "Acompanhar", pelo número e o código). O formulário é o mesmo do diálogo global.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AcompanharNotificacao from '../componentes/AcompanharNotificacao.vue';
import FormularioNotificacao from '../componentes/FormularioNotificacao.vue';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const aba = computed(() => (rota.query['aba'] === 'acompanhar' ? 'acompanhar' : 'notificar'));
function irPara(a: 'notificar' | 'acompanhar'): void {
  void roteador.replace({ query: a === 'acompanhar' ? { aba: a } : {} });
}
</script>

<template>
  <section class="tela-notificar" aria-labelledby="notificar-titulo" data-testid="tela-notificar">
    <h1 id="notificar-titulo">
      {{ aba === 'acompanhar' ? t('qualidade.acompanhar.titulo') : t('qualidade.notificar.titulo') }}
    </h1>
    <div role="tablist" class="abas" :aria-label="t('qualidade.notificar.titulo')">
      <button
        type="button"
        role="tab"
        :aria-selected="aba === 'notificar'"
        data-testid="aba-notificar"
        @click="irPara('notificar')"
      >
        {{ t('qualidade.notificar.titulo') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="aba === 'acompanhar'"
        data-testid="aba-acompanhar"
        @click="irPara('acompanhar')"
      >
        {{ t('qualidade.acompanhar.titulo') }}
      </button>
    </div>
    <p class="tela-notificar__minhas">
      <RouterLink to="/qualidade/acoes" data-testid="notificar-tela-minhas-acoes">{{
        t('qualidade.minhas.titulo')
      }}</RouterLink>
    </p>
    <div role="tabpanel">
      <AcompanharNotificacao v-if="aba === 'acompanhar'" />
      <FormularioNotificacao v-else caminho-origem="/qualidade/notificar" />
    </div>
  </section>
</template>

<style scoped>
.tela-notificar {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 44rem;
}
.tela-notificar__minhas {
  margin: 0;
  font-size: var(--sgh-fonte-pequena);
}
.abas {
  display: flex;
  gap: var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.abas button {
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border: 0;
  border-bottom: 3px solid transparent;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.abas button[aria-selected='true'] {
  border-bottom-color: var(--sgh-primaria);
  font-weight: 600;
}
</style>
