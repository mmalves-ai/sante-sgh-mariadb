<script setup lang="ts">
// "Alertas e gatilhos do sistema" (M10, ficha seção 7): só consulta nesta fase.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarAlertas } from '../api.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['adm', 'alertas'], queryFn: () => buscarAlertas() });
</script>

<template>
  <section class="tela" aria-labelledby="alertas-titulo">
    <h1 id="alertas-titulo">{{ t('adm.alertas.titulo') }}</h1>
    <p>{{ t('adm.alertas.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <p v-if="consulta.data.value.alertas.length === 0">{{ t('adm.alertas.nenhum') }}</p>
      <article v-for="a in consulta.data.value.alertas" :key="a.id" class="cartao" data-testid="alerta">
        <h2>{{ a.nome }}</h2>
        <p>
          {{ a.ativo ? t('adm.comum.ativo') : t('adm.comum.inativo') }} ·
          {{ t(`adm.alertas.origem.${a.origem}`) }}
          <span v-if="a.idadeInicial !== null">
            · {{ t('adm.alertas.idade', { a: a.idadeInicial, b: a.idadeFinal ?? '' }) }}</span
          >
          <span v-if="a.cenario"> · {{ a.cenario }}</span>
          · {{ t('adm.alertas.usuarios', { n: a.usuarios }) }}
        </p>
        <h3>{{ t('adm.alertas.gatilhos') }}</h3>
        <ul>
          <li v-for="(g, i) in a.gatilhos" :key="i">{{ g.opcao }} — {{ g.evento }}</li>
        </ul>
      </article>
    </template>
  </section>
</template>

<style scoped>
.cartao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-2);
}
</style>
