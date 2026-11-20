<script setup lang="ts">
// Cancelamentos (ficha do M17, seção 7): `/agenda/consultas/cancelamentos`. Lista paginada no servidor, por
// período (até 31 dias por consulta), agenda e motivo padronizado, com o motivo padronizado e quem pediu; o nome do paciente vem
// mascarado. O cancelamento em si fica no detalhe da marcação.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listarCancelamentos } from '../api-agenda.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const { t } = useI18n();
const { opcoesAgenda, opcoes } = usarAgenda();
const de = ref('');
const ate = ref('');
const agenda = ref('');
const motivo = ref('');
const filtro = ref({ de: '', ate: '', agenda: '', motivo: '' });
const pagina = ref(1);
const lista = useQuery({
  queryKey: computed(() => ['agenda', 'cancelamentos', filtro.value, pagina.value]),
  queryFn: () =>
    listarCancelamentos({
      de: filtro.value.de || null,
      ate: filtro.value.ate || null,
      agenda: filtro.value.agenda ? Number(filtro.value.agenda) : null,
      motivo: filtro.value.motivo || null,
      pagina: pagina.value,
    }),
});
const escolhas = computed(() => [{ valor: '', rotulo: t('agenda.todas') }, ...opcoesAgenda.value]);
const motivos = computed(() => [
  { valor: '', rotulo: t('agenda.cancelamentos.todosMotivos') },
  ...(opcoes.data.value?.motivosCancelamento ?? []).map((m) => ({ valor: m.codigo, rotulo: m.texto })),
]);
const ultima = computed(() => {
  const l = lista.data.value;
  return l ? Math.max(1, Math.ceil(l.total / l.porPagina)) : 1;
});
function filtrar(): void {
  filtro.value = { de: de.value, ate: ate.value, agenda: agenda.value, motivo: motivo.value };
  pagina.value = 1;
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cancel-titulo" data-testid="tela-cancelamentos">
    <h1 id="cancel-titulo">{{ t('agenda.cancelamentos.titulo') }}</h1>
    <p>{{ t('agenda.cancelamentos.texto') }}</p>
    <form class="filtros" role="search" @submit.prevent="filtrar">
      <div class="campo">
        <label for="cancel-de">{{ t('agenda.de') }}</label>
        <input id="cancel-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="cancel-ate">{{ t('agenda.ate') }}</label>
        <input id="cancel-ate" v-model="ate" type="date" />
      </div>
      <SanteSelecao v-model="agenda" :rotulo="t('agenda.agenda')" :opcoes="escolhas" />
      <SanteSelecao v-model="motivo" :rotulo="t('agenda.motivo')" :opcoes="motivos" />
      <SanteBotao tipo="submit" :rotulo="t('agenda.cancelamentos.filtrar')" />
    </form>
    <ErroAgenda v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="lista.data.value.recortada"
        variante="info"
        :texto="t('agenda.recortada', { dias: 31 })"
      />
      <p v-if="lista.data.value.itens.length === 0">{{ t('agenda.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-cancelamentos">
        <caption>
          {{
            t('agenda.cancelamentos.legenda', {
              total: lista.data.value.total,
              de: dataBr(lista.data.value.de),
              ate: dataBr(lista.data.value.ate),
            })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.protocolo') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.agenda') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.consulta') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.paciente') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.em') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.por') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.motivo') }}</th>
            <th scope="col">{{ t('agenda.cancelamentos.colunas.solicitante') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lista.data.value.itens" :key="c.protocolo">
            <td>{{ c.protocolo }}</td>
            <td>{{ c.agenda }}</td>
            <td>{{ dataBr(c.data) }} {{ horaBr(c.hora) }}</td>
            <td>{{ c.paciente }}</td>
            <td>{{ c.canceladoEm }}</td>
            <td>{{ c.canceladoPor ?? '—' }}</td>
            <td>{{ c.motivo }}</td>
            <td>{{ c.solicitante ? t(`agenda.marcacao.solicitantes.${c.solicitante}`) : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <nav class="acoes" :aria-label="t('agenda.cancelamentos.pagina', { pagina })">
        <SanteBotao
          variante="secundario"
          :rotulo="t('agenda.cancelamentos.anterior')"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('agenda.cancelamentos.pagina', { pagina }) }} / {{ ultima }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('agenda.cancelamentos.proxima')"
          :desabilitado="pagina >= ultima"
          @acionar="pagina++"
        />
      </nav>
    </template>
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
