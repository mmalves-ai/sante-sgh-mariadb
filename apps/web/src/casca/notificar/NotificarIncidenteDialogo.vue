<script setup lang="ts">
// Diálogo global "Notificar incidente" (M48, etapa 1; ficha, seção 7): aberto pelo botão da barra superior ou pela
// paleta (Ctrl+K), em qualquer tela, para todo perfil de pessoa (qualidade.notificacao.criar) com a funcionalidade
// liberada. O formulário é o mesmo da tela /qualidade/notificar; a tela de origem vai como o caminho da rota aberta.
import { SanteDialogo } from '@sgh/ui';
import { defineAsyncComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const rota = useRoute();
// Carregado sob demanda: quem não abre o diálogo não baixa o formulário.
const FormularioNotificacao = defineAsyncComponent(
  () => import('../../modulos/qualidade/componentes/FormularioNotificacao.vue'),
);
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="t('qualidade.notificar.titulo')"
    largura="40rem"
    data-testid="dialogo-notificar"
  >
    <FormularioNotificacao v-if="visivel" :caminho-origem="rota.path" />
    <p class="dialogo-notificar__rodape">
      <RouterLink to="/qualidade/notificar" data-testid="notificar-tela-cheia" @click="visivel = false">{{
        t('qualidade.notificar.abrirTela')
      }}</RouterLink>
      <!-- Quem é responsável por uma ação do plano de segurança nem sempre analisa: a entrada de todo usuário. -->
      <RouterLink to="/qualidade/acoes" data-testid="notificar-minhas-acoes" @click="visivel = false">{{
        t('qualidade.minhas.titulo')
      }}</RouterLink>
    </p>
  </SanteDialogo>
</template>

<style scoped>
.dialogo-notificar__rodape {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  margin: var(--sgh-espaco-3) 0 0;
  font-size: var(--sgh-fonte-pequena);
}
</style>
