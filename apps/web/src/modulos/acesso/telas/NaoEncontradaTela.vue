<script setup lang="ts">
import { PERMISSOES_ACESSO } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';

// W1-01 (parte 10c): sem permissão, o botão "Pedir acesso" abre o formulário do pedido (perfil, setor, período, motivo).
defineProps<{ motivo?: 'nao-encontrada' | 'sem-permissao' }>();
const { t } = useI18n();
// `pode` lê a sessão já carregada pela casca (sem consulta própria: a tela também abre fora do cliente de consultas).
const podePedir = computed(
  () => pode(PERMISSOES_ACESSO.preferenciaLer) && pode(PERMISSOES_ACESSO.preferenciaEditar),
);
</script>

<template>
  <section class="tela" aria-labelledby="ne-titulo">
    <template v-if="motivo === 'sem-permissao'">
      <h1 id="ne-titulo">{{ t('erros.sem-permissao.titulo') }}</h1>
      <p>{{ t('erros.sem-permissao.texto') }}</p>
      <p v-if="podePedir">
        <RouterLink
          class="ne__pedir"
          :to="{ path: '/preferencias/pedidos-acesso', query: { novo: '1' } }"
          data-testid="pedir-acesso"
          >{{ t('acesso.pedidos.pedir') }}</RouterLink
        >
      </p>
    </template>
    <template v-else>
      <h1 id="ne-titulo">{{ t('naoEncontrada.titulo') }}</h1>
      <p>{{ t('naoEncontrada.texto') }}</p>
    </template>
    <RouterLink to="/inicio">{{ t('naoEncontrada.voltar') }}</RouterLink>
  </section>
</template>
