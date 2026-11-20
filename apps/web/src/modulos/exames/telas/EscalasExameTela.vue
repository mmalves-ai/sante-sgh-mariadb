<script setup lang="ts">
// Escala semanal da agenda de exames (ficha do M18, seção 7): `/agenda/exames/escalas`. A escala que a última
// geração gravou (dia, faixa, duração e tipo de exame) e as gerações por período; a escala é mantida pelo cadastro de
// domínios (incluir e alterar linhas) e a próxima geração parte dela.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { dataBr } from '../../agenda/formato.js';
import { lerAgendaExame } from '../api-exames.js';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const { t } = useI18n();
const rota = useRoute();
const { opcoesAgenda } = usarExames();
const agenda = ref(typeof rota.query['agenda'] === 'string' ? rota.query['agenda'] : '');
const escolhas = computed(() => [{ valor: '', rotulo: t('exames.escolha') }, ...opcoesAgenda.value]);
const detalhe = useQuery({
  queryKey: computed(() => ['exames', 'agenda', Number(agenda.value || 0)]),
  queryFn: () => lerAgendaExame(Number(agenda.value)),
  enabled: computed(() => agenda.value !== ''),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="escalas-exame-titulo" data-testid="tela-escalas-exame">
    <h1 id="escalas-exame-titulo">{{ t('exames.escalas.titulo') }}</h1>
    <p>{{ t('exames.escalas.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/cadastros/dominios/agenda/escalaExame">{{ t('exames.escalas.cadastro') }}</RouterLink>
      <RouterLink to="/agenda/exames/gerar">{{ t('exames.gerar.titulo') }}</RouterLink>
    </p>
    <SanteSelecao v-model="agenda" :rotulo="t('exames.agenda')" :opcoes="escolhas" />
    <ErroExame v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <template v-else-if="detalhe.data.value">
      <table v-if="detalhe.data.value.escala.length" class="tabela" data-testid="tabela-escala-exame">
        <caption>
          {{
            t('exames.escalas.legenda', { agenda: detalhe.data.value.agenda.nome })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('exames.escalas.dia') }}</th>
            <th scope="col">{{ t('exames.escalas.faixa') }}</th>
            <th scope="col">{{ t('exames.agendas.duracao') }}</th>
            <th scope="col">{{ t('exames.tipo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in detalhe.data.value.escala" :key="`${l.semana}-${l.inicio}`">
            <td>{{ l.dia }}</td>
            <td>{{ t('exames.intervalo', { de: l.inicio, ate: l.fim }) }}</td>
            <td>{{ l.duracao }}</td>
            <td>{{ l.exame }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('exames.escalas.vazia') }}</p>
      <section class="painel" aria-labelledby="escalas-geracoes">
        <h2 id="escalas-geracoes">{{ t('exames.escalas.geracoes') }}</h2>
        <table v-if="detalhe.data.value.geracoes.length" class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('exames.escalas.periodo') }}</th>
              <th scope="col">{{ t('exames.escalas.dias') }}</th>
              <th scope="col">{{ t('exames.escalas.criadaEm') }}</th>
              <th scope="col">{{ t('exames.escalas.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(g, i) in detalhe.data.value.geracoes" :key="i">
              <td>{{ t('exames.intervalo', { de: dataBr(g.inicio), ate: dataBr(g.fim) }) }}</td>
              <td>{{ g.dias.map((d) => t(`exames.dias.${d}`)).join(', ') }}</td>
              <td>{{ dataBr(g.criadaEm) }} {{ g.hora }}</td>
              <td>{{ g.situacao }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('exames.nenhuma') }}</p>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
