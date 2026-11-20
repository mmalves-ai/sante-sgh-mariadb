<script setup lang="ts">
// Painel da higienização em tempo real (ficha do M21, seção 7): `/higienizacao/painel`, para a tela e para a TV. As
// limpezas em aberto (as atrasadas primeiro, pelo prazo), as contagens por etapa e as antigas paradas no primeiro
// estado só como contagem. O canal de eventos avisa cada mudança e o painel relê; sem o canal, a cada 15 s.
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CANAL_HIGIENIZACAO, lerPainelHigienizacao } from '../api-adt.js';
import CartaoLimpeza from '../componentes/CartaoLimpeza.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { usarAvisos } from '../vigia.js';

const { t } = useI18n();
const avisos = usarAvisos(CANAL_HIGIENIZACAO, () => void painel.refetch());
const painel = useQuery({
  queryKey: ['adt', 'hig', 'painel'],
  queryFn: () => lerPainelHigienizacao(),
  refetchInterval: computed(() => avisos.intervalo()),
});
const agora = ref(Date.now());
const relogio = setInterval(() => (agora.value = Date.now()), 30_000);
onBeforeUnmount(() => clearInterval(relogio));
const agoraServidor = computed(() => {
  const l = painel.data.value?.lidoEm;
  return l
    ? Date.parse(l.length <= 19 ? `${l}Z` : l) + (agora.value - (painel.dataUpdatedAt.value || agora.value))
    : agora.value;
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="hig-painel-titulo" data-testid="tela-painel-higienizacao">
    <h1 id="hig-painel-titulo">{{ t('adt.hig.painel') }}</h1>
    <p>{{ t('adt.hig.painelTexto') }}</p>
    <p class="acoes">
      <RouterLink to="/higienizacao/solicitacoes">{{ t('adt.hig.solicitacoes') }}</RouterLink>
      <RouterLink to="/higienizacao/inspecao">{{ t('adt.hig.inspecao') }}</RouterLink>
      <RouterLink to="/m/higienizacao">{{ t('adt.hig.app') }}</RouterLink>
      <RouterLink to="/higienizacao/indicadores" data-testid="hig-link-indicadores">{{
        t('adt.hig.indicadores')
      }}</RouterLink>
    </p>
    <ErroAdt v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ul class="cartoes" data-testid="hig-contagens">
        <li v-for="(n, etapa) in painel.data.value.contagens" :key="etapa">
          {{ t(`adt.hig.etapas.${etapa}`) }}: {{ n }}
        </li>
        <li>
          <strong>{{ t('adt.hig.atrasadas', { n: painel.data.value.atrasadas }) }}</strong>
        </li>
      </ul>
      <p class="secundario">{{ t('adt.hig.paradas', { n: painel.data.value.paradasAntigas }) }}</p>
      <p v-if="painel.data.value.itens.length === 0">{{ t('adt.nenhum') }}</p>
      <div class="grade-limpezas">
        <CartaoLimpeza
          v-for="i in painel.data.value.itens"
          :key="i.solicitacao"
          :item="i"
          :agora="agoraServidor"
        />
      </div>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.grade-limpezas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
}
</style>
