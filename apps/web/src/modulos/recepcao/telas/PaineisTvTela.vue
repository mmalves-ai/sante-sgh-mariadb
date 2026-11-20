<script setup lang="ts">
// Painéis de TV e central de comando (M19; ficha, seção 7): os painéis de TV de setores já cadastrados (leitura,
// com o conteúdo que cada um mostra aqui), o cadastro deles (CRUD genérico) e os aparelhos de TV de setor. O
// conteúdo de cada painel vem do módulo dono (leitos ao vivo do M16; higienização e bloco nos marcos deles).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { listarPaineisTv } from '../api-recepcao.js';
import DispositivosBloco from '../componentes/DispositivosBloco.vue';

const { t } = useI18n();
const paineis = useQuery({ queryKey: ['recepcao', 'paineis-tv'], queryFn: () => listarPaineisTv() });
const podeDispositivos = computed(() => pode('recepcao.dispositivo.ler'));
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="paineistv-titulo" data-testid="tela-paineis-tv">
    <h1 id="paineistv-titulo">{{ t('recepcao.paineisTv.titulo') }}</h1>
    <p>{{ t('recepcao.paineisTv.texto') }}</p>
    <section class="painel" aria-labelledby="paineistv-existentes">
      <h2 id="paineistv-existentes">{{ t('recepcao.paineisTv.existentes') }}</h2>
      <MensagemErro v-if="paineis.isError.value" :erro="paineis.error.value" />
      <p v-else-if="!paineis.data.value" role="status">{{ t('recepcao.carregando') }}</p>
      <p v-else-if="paineis.data.value.length === 0">{{ t('recepcao.nenhuma') }}</p>
      <ul v-else>
        <li v-for="p in paineis.data.value" :key="p.id">
          {{ p.nome }} —
          {{ t('recepcao.paineisTv.sugestao', { c: t(`recepcao.dispositivos.conteudos.${p.conteudo}`) }) }}
        </li>
      </ul>
    </section>
    <DominiosIndiceTela subitem="relatorioPaineisTv" embutido />
    <DispositivosBloco
      v-if="podeDispositivos"
      tipo="paineltv"
      :titulo="t('recepcao.dispositivos.paineisTv')"
    />
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
