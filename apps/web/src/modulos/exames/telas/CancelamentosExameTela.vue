<script setup lang="ts">
// Cancelamentos de exames (ficha do M18, seção 7): `/agenda/exames/cancelamentos`. Lista paginada no servidor pela
// data do cancelamento (até 31 dias por consulta) e pela agenda, com o motivo, quem cancelou e quem marcou; o nome do
// paciente vem mascarado. O cancelamento em si fica na marcação.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { listarCancelamentosExame } from '../api-exames.js';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const { t } = useI18n();
const { opcoesAgenda } = usarExames();
const de = ref('');
const ate = ref('');
const agenda = ref('');
const filtro = ref({ de: '', ate: '', agenda: '' });
const pagina = ref(1);
const lista = useQuery({
  queryKey: computed(() => ['exames', 'cancelamentos', filtro.value, pagina.value]),
  queryFn: () =>
    listarCancelamentosExame({
      de: filtro.value.de || null,
      ate: filtro.value.ate || null,
      agenda: filtro.value.agenda ? Number(filtro.value.agenda) : null,
      pagina: pagina.value,
    }),
});
const escolhas = computed(() => [{ valor: '', rotulo: t('exames.todasAgendas') }, ...opcoesAgenda.value]);
const ultima = computed(() => {
  const l = lista.data.value;
  return l ? Math.max(1, Math.ceil(l.total / l.porPagina)) : 1;
});
function filtrar(): void {
  filtro.value = { de: de.value, ate: ate.value, agenda: agenda.value };
  pagina.value = 1;
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cancel-exame-titulo" data-testid="tela-cancelamentos-exame">
    <h1 id="cancel-exame-titulo">{{ t('exames.cancelamentos.titulo') }}</h1>
    <p>{{ t('exames.cancelamentos.texto') }}</p>
    <form class="filtros" role="search" @submit.prevent="filtrar">
      <div class="campo">
        <label for="cancel-exame-de">{{ t('exames.de') }}</label>
        <input id="cancel-exame-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="cancel-exame-ate">{{ t('exames.ate') }}</label>
        <input id="cancel-exame-ate" v-model="ate" type="date" />
      </div>
      <SanteSelecao v-model="agenda" :rotulo="t('exames.agenda')" :opcoes="escolhas" />
      <SanteBotao tipo="submit" :rotulo="t('exames.filtrar')" />
    </form>
    <ErroExame v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('exames.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.itens.length === 0">{{ t('exames.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-cancelamentos-exame">
        <caption>
          {{
            t('exames.cancelamentos.legenda', { total: lista.data.value.total })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('exames.agenda') }}</th>
            <th scope="col">{{ t('exames.cancelamentos.exame') }}</th>
            <th scope="col">{{ t('exames.paciente') }}</th>
            <th scope="col">{{ t('exames.cancelamentos.em') }}</th>
            <th scope="col">{{ t('exames.cancelamentos.por') }}</th>
            <th scope="col">{{ t('exames.cancelamentos.marcadoPor') }}</th>
            <th scope="col">{{ t('exames.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in lista.data.value.itens" :key="i">
            <td>{{ c.agendaNome }}</td>
            <td>{{ dataBr(c.data) }} {{ c.hora }}</td>
            <td>{{ c.paciente }}</td>
            <td>{{ dataBr(c.canceladoEm.slice(0, 10)) }} {{ c.canceladoEm.slice(11) }}</td>
            <td>{{ c.canceladoPor || '—' }}</td>
            <td>{{ c.marcadoPor || '—' }}</td>
            <td>{{ c.motivo }}</td>
          </tr>
        </tbody>
      </table>
      <nav class="acoes" :aria-label="t('exames.paginacao')">
        <SanteBotao
          variante="secundario"
          :rotulo="t('exames.anterior')"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('exames.pagina', { pagina, ultima }) }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('exames.proxima')"
          :desabilitado="pagina >= ultima"
          @acionar="pagina++"
        />
      </nav>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
