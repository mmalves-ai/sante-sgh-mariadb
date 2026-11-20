<script setup lang="ts">
// Rouparia no celular (M55, fatia F2; PWA leve): `/m/rouparia`. Só o que se faz andando pelos setores: a coleta pesada
// de roupa suja no setor e a entrega de roupa limpa, com o mesmo formulário e a mesma conferência da tela completa.
import { SanteAlerta } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoRouparia from '../componentes/AvisoRouparia.vue';
import ErroRouparia from '../componentes/ErroRouparia.vue';
import FormMovimentoRoupa from '../componentes/FormMovimentoRoupa.vue';
import { usarPainelRouparia } from '../usar-rouparia.js';

const { t } = useI18n();
const { painel, d, pode, motivoPode, aviso } = usarPainelRouparia();
const mensagem = ref<string | null>(null);
</script>

<template>
  <section
    class="tela-agenda app-rouparia"
    aria-labelledby="app-rouparia-titulo"
    data-testid="tela-rouparia-celular"
  >
    <h1 id="app-rouparia-titulo">{{ t('rouparia.celular.titulo') }}</h1>
    <p>{{ t('rouparia.celular.texto') }}</p>
    <AvisoRouparia :motivo="aviso" />
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar />
    <ErroRouparia v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!d" role="status">{{ t('rouparia.carregando') }}</p>
    <p v-else-if="!pode" class="secundario">{{ motivoPode }}</p>
    <FormMovimentoRoupa
      v-else
      :painel="d"
      :tipos="['coleta', 'entrega']"
      prefixo="app-rouparia"
      @gravado="mensagem = $event"
    />
    <RouterLink to="/hotelaria/rouparia">{{ t('rouparia.celular.completa') }}</RouterLink>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-rouparia.css"></style>
<style scoped>
.app-rouparia {
  max-width: 36rem;
}
</style>
