<script setup lang="ts">
// Serviço social (ficha do M45, seção 7): `/servico-social`. Os internados com o risco da última avaliação social, as
// barreiras sociais de alta abertas e a avaliação sugerida (pessoa idosa ou menor, permanência longa, risco alto sem
// evolução recente). O registro de cada um abre na tela do paciente.
import { SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerFilaSocial } from '../api-nutricao.js';
import ErroNutricao from '../componentes/ErroNutricao.vue';
import { combinaBusca, instanteCurto, leitoTexto } from '../regras-nutricao.js';

const { t } = useI18n();
const fila = useQuery({
  queryKey: ['servico-social', 'fila'],
  queryFn: lerFilaSocial,
  refetchInterval: 60_000,
});
const busca = ref('');
const itens = computed(() =>
  (fila.data.value?.itens ?? []).filter((i) =>
    combinaBusca(busca.value, [i.nome, String(i.internacao), String(i.paciente), leitoTexto(i.leito)]),
  ),
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="social-fila-titulo" data-testid="tela-fila-social">
    <h1 id="social-fila-titulo">{{ t('nutricao.social.titulo') }}</h1>
    <p>{{ t('nutricao.social.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/altas-previstas">{{ t('nutricao.atalhos.nir') }}</RouterLink>
    </p>
    <ErroNutricao v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('nutricao.carregando') }}</p>
    <template v-else>
      <p v-if="fila.data.value.cortada" role="status">{{ t('nutricao.cortada') }}</p>
      <SanteCampoTexto
        v-if="fila.data.value.itens.length > 0"
        v-model="busca"
        :rotulo="t('nutricao.buscar')"
        :max-bytes="60"
        data-testid="social-busca"
      />
      <p v-if="fila.data.value.itens.length === 0">{{ t('nutricao.nenhum') }}</p>
      <p v-else-if="itens.length === 0" role="status">{{ t('nutricao.nenhumNaBusca') }}</p>
      <table v-else class="tabela" data-testid="tabela-fila-social">
        <caption>
          {{
            t('nutricao.social.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.paciente') }}</th>
            <th scope="col">{{ t('nutricao.leito') }}</th>
            <th scope="col">{{ t('nutricao.admissao') }}</th>
            <th scope="col">{{ t('nutricao.social.risco') }}</th>
            <th scope="col">{{ t('nutricao.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens" :key="i.internacao" :data-testid="`social-${i.internacao}`">
            <td>
              <strong>{{ i.nome }}</strong>
              <span class="secundario">
                · {{ i.idade === null ? t('nutricao.semIdade') : t('nutricao.idade', { n: i.idade }) }}</span
              >
              <span v-if="i.sugerida" class="chip">{{ t('nutricao.social.sugerida') }}</span>
            </td>
            <td>{{ leitoTexto(i.leito) }}</td>
            <td>{{ instanteCurto(i.admissao) }}</td>
            <td>
              <span v-if="i.ultima">{{
                t('nutricao.social.ultima', {
                  risco: t(`nutricao.social.riscos.${i.ultima.risco}`),
                  em: instanteCurto(i.ultima.em),
                })
              }}</span>
              <span v-else class="secundario">{{ t('nutricao.social.semRegistro') }}</span>
              <div v-if="i.barreirasSociais" class="secundario">
                {{ t('nutricao.social.barreiras', { n: i.barreirasSociais }) }}
              </div>
            </td>
            <td>
              <RouterLink
                :to="`/servico-social/${i.internacao}`"
                :data-testid="`social-abrir-${i.internacao}`"
                >{{ t('nutricao.social.abrir') }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.chip {
  display: inline-block;
  margin-inline-start: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
}
</style>
