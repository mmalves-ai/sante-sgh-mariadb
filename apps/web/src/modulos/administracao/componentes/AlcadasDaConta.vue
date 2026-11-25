<script setup lang="ts">
// Visão da conta nas alçadas de aprovação (01-ADM L59), na ficha do usuário: em que documentos e níveis a conta
// aprova hoje, direto pela conta ou pelo perfil vigente, com a faixa de valor; e o atalho para a tela das alçadas.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { faixa } from '../alcadas-tela.js';
import { buscarAlcadas } from '../api-alcadas.js';

const props = defineProps<{ login: string }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Alçadas de aprovação',
      nenhuma: 'A conta não aprova em nenhuma alçada vigente.',
      nivel: 'nível {n}',
      conta: 'pela conta',
      perfil: 'pelo perfil {perfil}',
      abrir: 'Abrir as alçadas',
      carregando: 'Carregando…',
    },
  },
});
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const consulta = useQuery({
  queryKey: computed(() => ['adm', 'alcadas', 'conta', props.login]),
  queryFn: () => buscarAlcadas(props.login),
});
const linhas = computed(() => consulta.data.value?.doUsuario ?? []);
</script>

<template>
  <section class="cartao" aria-labelledby="ficha-alcadas" data-testid="ficha-alcadas">
    <h2 id="ficha-alcadas" class="cartao__titulo">{{ t('titulo') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('carregando') }}</p>
    <p v-else-if="linhas.length === 0" class="nota" data-testid="ficha-alcadas-vazio">{{ t('nenhuma') }}</p>
    <ul v-else>
      <li v-for="l in linhas" :key="`${l.alcada}-${l.nivel}-${l.via}-${l.perfil}`">
        {{ l.descricao }} ({{ l.documento }}), {{ t('nivel', { n: l.nivel }) }},
        {{ l.via === 'conta' ? t('conta') : t('perfil', { perfil: l.perfil }) }}:
        {{ faixa(l.valorMinimo, l.valorMaximo, moeda) }}
      </li>
    </ul>
    <router-link :to="{ name: 'adm.alcadas' }" data-testid="ficha-abrir-alcadas">{{
      t('abrir')
    }}</router-link>
  </section>
</template>

<style scoped>
.nota {
  color: var(--sgh-texto-secundario);
  margin: 0;
}
</style>
