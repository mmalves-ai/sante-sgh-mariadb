<script setup lang="ts">
// Resíduo da agenda de exames (ficha do M18, seção 7): `/agenda/exames/residuo`. Os horários "confirmado sem
// paciente" (cancelamento antigo pela integração do portal) e os "ocupados sem a marcação" (marcação incompleta),
// por agenda, para a central corrigir pela marcação; só contagens e a lista por horário, sem nome de paciente.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { lerResiduoExame } from '../api-exames.js';
import ErroExame from '../componentes/ErroExame.vue';

const { t } = useI18n();
const de = ref('');
const ate = ref('');
const filtro = ref({ de: '', ate: '' });
const r = useQuery({
  queryKey: computed(() => ['exames', 'residuo', filtro.value]),
  queryFn: () => lerResiduoExame(filtro.value.de || null, filtro.value.ate || null),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="residuo-titulo" data-testid="tela-residuo-exame">
    <h1 id="residuo-titulo">{{ t('exames.residuo.titulo') }}</h1>
    <p>{{ t('exames.residuo.texto') }}</p>
    <form class="filtros" @submit.prevent="filtro = { de, ate }">
      <div class="campo">
        <label for="residuo-de">{{ t('exames.de') }}</label>
        <input id="residuo-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="residuo-ate">{{ t('exames.ate') }}</label>
        <input id="residuo-ate" v-model="ate" type="date" />
      </div>
      <SanteBotao tipo="submit" :rotulo="t('exames.filtrar')" />
    </form>
    <ErroExame v-if="r.isError.value" :erro="r.error.value" />
    <p v-else-if="!r.data.value" role="status">{{ t('exames.carregando') }}</p>
    <template v-else>
      <ul class="cartoes" data-testid="residuo-totais">
        <li>
          <strong>{{ r.data.value.confirmadosSemPaciente }}</strong>
          {{ t('exames.residuo.confirmados') }}
        </li>
        <li>
          <strong>{{ r.data.value.ocupadosSemMarcacao }}</strong>
          {{ t('exames.residuo.ocupados') }}
        </li>
        <li>
          <strong>{{ r.data.value.total }}</strong>
          {{ t('exames.residuo.total') }}
        </li>
      </ul>
      <p class="secundario">
        {{ t('exames.residuo.periodo', { de: dataBr(r.data.value.de), ate: dataBr(r.data.value.ate) }) }}
      </p>
      <SanteAlerta v-if="r.data.value.truncado" variante="info" :texto="t('exames.truncado')" />
      <table v-if="r.data.value.porAgenda.length" class="tabela">
        <caption>
          {{
            t('exames.residuo.porAgenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('exames.agenda') }}</th>
            <th scope="col">{{ t('exames.residuo.confirmados') }}</th>
            <th scope="col">{{ t('exames.residuo.ocupados') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in r.data.value.porAgenda" :key="a.agenda">
            <td>{{ a.agendaNome }}</td>
            <td>{{ a.confirmadosSemPaciente }}</td>
            <td>{{ a.ocupadosSemMarcacao }}</td>
          </tr>
        </tbody>
      </table>
      <table v-if="r.data.value.horarios.length" class="tabela" data-testid="tabela-residuo">
        <caption>
          {{
            t('exames.residuo.horarios')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('exames.agenda') }}</th>
            <th scope="col">{{ t('exames.data') }}</th>
            <th scope="col">{{ t('exames.hora') }}</th>
            <th scope="col">{{ t('exames.residuo.tipo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(h, i) in r.data.value.horarios" :key="i">
            <td>{{ h.agendaNome }}</td>
            <td>{{ dataBr(h.data) }}</td>
            <td>{{ h.hora }}</td>
            <td>{{ h.tipo }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
