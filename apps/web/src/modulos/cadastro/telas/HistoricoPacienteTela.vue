<script setup lang="ts">
// Histórico de alterações do cadastro do paciente (M11): a linha do tempo lida ao vivo das versões que o
// trigger do sistema atual grava a cada mudança, os telefones de cada versão e as unificações feitas no
// sistema atual. Sem paciente escolhido (aberta pelo menu), orienta a buscar primeiro.
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerHistorico } from '../api-cadastro.js';
import EscolhaPorBusca from '../componentes/EscolhaPorBusca.vue';
import LinhaDoTempo from '../componentes/LinhaDoTempo.vue';
import PaginacaoCadastro from '../componentes/PaginacaoCadastro.vue';
import { carimboBr } from '../formato.js';

const props = defineProps<{ id?: string }>();
const { t } = useI18n();
const idNumero = computed(() => (props.id ? Number(props.id) : 0));
const pagina = ref(1);
watch(idNumero, () => (pagina.value = 1));

const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'historico', idNumero.value, pagina.value]),
  queryFn: () => lerHistorico(idNumero.value, pagina.value),
  enabled: computed(() => Number.isInteger(idNumero.value) && idNumero.value > 0),
});
const h = computed(() => consulta.data.value);
</script>

<template>
  <section class="tela" aria-labelledby="historico-titulo" data-testid="tela-historico-paciente">
    <h1 id="historico-titulo">{{ t('cadastro.historico.titulo') }}</h1>
    <EscolhaPorBusca
      v-if="!idNumero"
      :texto="t('cadastro.historico.escolha')"
      destino="/cadastros/pacientes"
      :rotulo="t('cadastro.busca.titulo')"
    />
    <MensagemErro v-else-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!h">{{ t('cadastro.carregando') }}</p>
    <template v-else>
      <p>
        <RouterLink :to="`/cadastros/pacientes/${h.id}`">{{ t('cadastro.historico.abrirFicha') }}</RouterLink>
      </p>
      <LinhaDoTempo :legenda="t('cadastro.historico.legenda', { nome: h.nome })" :versoes="h.versoes" />
      <PaginacaoCadastro
        v-model="pagina"
        :total="h.total"
        :por-pagina="h.porPagina"
        :rotulo="t('cadastro.historico.titulo')"
      />
      <section v-if="h.unificacoes.length > 0" aria-labelledby="unificacoes-titulo">
        <h2 id="unificacoes-titulo">{{ t('cadastro.historico.unificacoes') }}</h2>
        <ul>
          <li v-for="u in h.unificacoes" :key="`${u.absorvido}-${u.sobrevivente}`">
            {{
              t('cadastro.historico.unificacao', {
                absorvido: u.absorvido,
                sobrevivente: u.sobrevivente,
                em: carimboBr(u.em),
              })
            }}
          </li>
        </ul>
      </section>
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
