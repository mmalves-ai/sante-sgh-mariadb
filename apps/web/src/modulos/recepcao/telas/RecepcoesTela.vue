<script setup lang="ts">
// Recepções e setores de senha (M19; ficha, seção 7): o cadastro das recepções (CRUD genérico) e, de cada uma, os
// locais de atendimento, os guichês e os encaminhamentos permitidos entre locais (a estrutura que o guichê usa).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { lerApoio } from '../api-recepcao.js';

const { t } = useI18n();
const apoio = useQuery({ queryKey: ['recepcao', 'apoio'], queryFn: () => lerApoio() });
const nomeLocal = (id: number) =>
  apoio.data.value?.recepcoes.flatMap((r) => r.locais).find((l) => l.id === id)?.descricao ?? String(id);
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="recepcoes-titulo" data-testid="tela-recepcoes">
    <h1 id="recepcoes-titulo">{{ t('recepcao.recepcoes.titulo') }}</h1>
    <p>{{ t('recepcao.recepcoes.texto') }}</p>
    <DominiosIndiceTela subitem="recepcaoRecepcoes" embutido />
    <section class="painel" aria-labelledby="estrutura-titulo">
      <h2 id="estrutura-titulo">{{ t('recepcao.recepcoes.estrutura') }}</h2>
      <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
      <p v-else-if="!apoio.data.value" role="status">{{ t('recepcao.carregando') }}</p>
      <template v-else>
        <article v-for="r in apoio.data.value.recepcoes" :key="r.id" :data-testid="`estrutura-${r.id}`">
          <h3>{{ r.descricao }}</h3>
          <p>
            {{ t('recepcao.recepcoes.guiches') }}:
            {{ r.guiches.length ? r.guiches.join(', ') : t('recepcao.recepcoes.qualquer') }}
          </p>
          <ul>
            <li v-for="l in r.locais" :key="l.id">
              {{ l.descricao }}<template v-if="!l.ativo"> ({{ t('recepcao.geradores.inativo') }})</template>
              <template v-if="l.encaminha.length">
                — {{ t('recepcao.recepcoes.encaminha', { lista: l.encaminha.map(nomeLocal).join(', ') }) }}
              </template>
            </li>
          </ul>
        </article>
      </template>
    </section>
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
