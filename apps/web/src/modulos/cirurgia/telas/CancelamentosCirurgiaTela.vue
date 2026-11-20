<script setup lang="ts">
// Cirurgias canceladas (ficha do M18, seção 7): `/cirurgia/cancelamentos`. Os agendamentos tirados da sala no
// período (a cópia do agendamento fica guardada), com o motivo codificado quando o cancelamento foi por estas telas;
// o nome do paciente vem mascarado. Até 31 dias por consulta. Abaixo, o histórico da agenda no período (inclusões e
// remarcações pelo momento da operação), para a coordenação auditar o mapa.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { listarCanceladas, listarHistoricoAgenda } from '../api-cirurgia.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const de = ref('');
const ate = ref('');
const filtro = ref({ de: '', ate: '' });
const lista = useQuery({
  queryKey: computed(() => ['cirurgia', 'cancelamentos', filtro.value]),
  queryFn: () => listarCanceladas(filtro.value.de || null, filtro.value.ate || null),
});
const hDe = ref('');
const hAte = ref('');
const hFiltro = ref({ de: '', ate: '' });
const historico = useQuery({
  queryKey: computed(() => ['cirurgia', 'historico', hFiltro.value]),
  queryFn: () => listarHistoricoAgenda(hFiltro.value.de || null, hFiltro.value.ate || null),
});
const dataHora = (v: string | null) => (v ? `${dataBr(v.slice(0, 10))} ${v.slice(11, 16)}` : '');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cancel-cir-titulo" data-testid="tela-cancelamentos-cirurgia">
    <h1 id="cancel-cir-titulo">{{ t('cirurgia.cancelamentos.titulo') }}</h1>
    <p>{{ t('cirurgia.cancelamentos.texto') }}</p>
    <form class="filtros" @submit.prevent="filtro = { de, ate }">
      <div class="campo">
        <label for="cancel-cir-de">{{ t('cirurgia.de') }}</label>
        <input id="cancel-cir-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="cancel-cir-ate">{{ t('cirurgia.ate') }}</label>
        <input id="cancel-cir-ate" v-model="ate" type="date" />
      </div>
      <SanteBotao tipo="submit" :rotulo="t('cirurgia.filtrar')" />
    </form>
    <ErroCirurgia v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="lista.data.value.truncado" variante="info" :texto="t('cirurgia.truncado')" />
      <p v-if="lista.data.value.itens.length === 0">{{ t('cirurgia.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-cancelamentos-cirurgia">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cancelamentos.marcadaPara') }}</th>
            <th scope="col">{{ t('cirurgia.sala') }}</th>
            <th scope="col">{{ t('cirurgia.paciente') }}</th>
            <th scope="col">{{ t('cirurgia.procedimento') }}</th>
            <th scope="col">{{ t('cirurgia.cancelamentos.em') }}</th>
            <th scope="col">{{ t('cirurgia.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lista.data.value.itens" :key="c.id">
            <td>{{ dataBr(c.data) }} {{ c.hora }}</td>
            <td>{{ c.sala }}</td>
            <td>{{ c.paciente }}</td>
            <td>{{ c.procedimento }}</td>
            <td>{{ c.canceladoEm }}</td>
            <td>{{ c.motivo ?? t('cirurgia.cancelamentos.semMotivo') }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <section class="painel" aria-labelledby="historico-agenda-titulo" data-testid="historico-agenda">
      <h2 id="historico-agenda-titulo">{{ t('cirurgia.historicoAgenda.titulo') }}</h2>
      <p>{{ t('cirurgia.historicoAgenda.texto') }}</p>
      <form class="filtros" @submit.prevent="hFiltro = { de: hDe, ate: hAte }">
        <div class="campo">
          <label for="hist-cir-de">{{ t('cirurgia.de') }}</label>
          <input id="hist-cir-de" v-model="hDe" type="date" />
        </div>
        <div class="campo">
          <label for="hist-cir-ate">{{ t('cirurgia.ate') }}</label>
          <input id="hist-cir-ate" v-model="hAte" type="date" />
        </div>
        <SanteBotao tipo="submit" :rotulo="t('cirurgia.filtrar')" />
      </form>
      <ErroCirurgia v-if="historico.isError.value" :erro="historico.error.value" />
      <p v-else-if="!historico.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
      <template v-else>
        <SanteAlerta v-if="historico.data.value.truncado" variante="info" :texto="t('cirurgia.truncado')" />
        <p v-if="historico.data.value.itens.length === 0">{{ t('cirurgia.nenhuma') }}</p>
        <table v-else class="tabela" data-testid="tabela-historico-agenda">
          <thead>
            <tr>
              <th scope="col">{{ t('cirurgia.historicoAgenda.quando') }}</th>
              <th scope="col">{{ t('cirurgia.historicoAgenda.operacao') }}</th>
              <th scope="col">{{ t('cirurgia.paciente') }}</th>
              <th scope="col">{{ t('cirurgia.historicoAgenda.de') }}</th>
              <th scope="col">{{ t('cirurgia.historicoAgenda.para') }}</th>
              <th scope="col">{{ t('cirurgia.historicoAgenda.usuario') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in historico.data.value.itens" :key="i">
              <td>{{ dataHora(h.quando) }}</td>
              <td>{{ h.operacao }}</td>
              <td>{{ h.paciente }}</td>
              <td>
                <template v-if="h.salaAnterior !== null">
                  {{
                    t('cirurgia.historicoAgenda.salaEm', {
                      sala: h.salaAnterior,
                      quando: dataHora(h.inicioAnterior),
                    })
                  }}
                </template>
              </td>
              <td>
                <template v-if="h.sala !== null">
                  {{ t('cirurgia.historicoAgenda.salaEm', { sala: h.sala, quando: dataHora(h.inicio) }) }}
                </template>
              </td>
              <td>{{ h.usuario }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
