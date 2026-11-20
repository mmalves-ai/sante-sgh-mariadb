<script setup lang="ts">
// Histórico de alterações do profissional (M11): as versões que o trigger do sistema atual grava, com os
// telefones de cada versão. Sem profissional escolhido, a busca de profissionais abre em modo histórico.
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerHistoricoProfissional } from '../api-cadastro.js';
import LinhaDoTempo from '../componentes/LinhaDoTempo.vue';
import PaginacaoCadastro from '../componentes/PaginacaoCadastro.vue';
import ProfissionaisTela from './ProfissionaisTela.vue';

const props = defineProps<{ id?: string }>();
const { t } = useI18n();
const idNumero = computed(() => (props.id ? Number(props.id) : 0));
const pagina = ref(1);
watch(idNumero, () => (pagina.value = 1));
const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'historico-profissional', idNumero.value, pagina.value]),
  queryFn: () => lerHistoricoProfissional(idNumero.value, pagina.value),
  enabled: computed(() => idNumero.value > 0),
});
const h = computed(() => consulta.data.value);
</script>

<template>
  <ProfissionaisTela v-if="!idNumero" historico />
  <section v-else class="tela" aria-labelledby="hist-prof-titulo" data-testid="tela-historico-profissional">
    <h1 id="hist-prof-titulo">{{ t('cadastro.profissionais.historico') }}</h1>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!h">{{ t('cadastro.carregando') }}</p>
    <template v-else>
      <p>
        <RouterLink :to="`/cadastros/profissionais/${h.id}`">{{
          t('cadastro.profissionais.ficha')
        }}</RouterLink>
      </p>
      <LinhaDoTempo :legenda="t('cadastro.historico.legenda', { nome: h.nome })" :versoes="h.versoes" />
      <PaginacaoCadastro
        v-model="pagina"
        :total="h.total"
        :por-pagina="h.porPagina"
        :rotulo="t('cadastro.profissionais.historico')"
      />
    </template>
  </section>
</template>

<style scoped>
/* Alvo mínimo de toque (WCAG 2.5.8): links de ação e de lista. */
nav a,
.acoes a,
li a,
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
</style>
