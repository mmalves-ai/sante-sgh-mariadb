<script setup lang="ts">
// Exames do dia (ficha do M18, seção 7): `/agenda/exames/dia`. As marcações de um dia (todas as agendas ou uma), com
// a situação do horário, o exame escolhido e o vínculo pelo prontuário; o nome do paciente vem mascarado e o
// detalhe (com o contato) abre na marcação.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { dataBr } from '../../agenda/formato.js';
import { listarMarcacoesExame } from '../api-exames.js';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const { t } = useI18n();
const rota = useRoute();
const { opcoes, opcoesAgenda } = usarExames();
const data = ref(typeof rota.query['data'] === 'string' ? rota.query['data'] : '');
const agenda = ref('');
const dia = computed(() => data.value || opcoes.data.value?.hoje || '');
const lista = useQuery({
  queryKey: computed(() => ['exames', 'dia', dia.value, agenda.value]),
  queryFn: () => listarMarcacoesExame(dia.value || null, agenda.value ? Number(agenda.value) : null),
  enabled: computed(() => dia.value !== ''),
});
const escolhas = computed(() => [{ valor: '', rotulo: t('exames.todasAgendas') }, ...opcoesAgenda.value]);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dia-exame-titulo" data-testid="tela-dia-exame">
    <h1 id="dia-exame-titulo">{{ t('exames.dia.titulo') }}</h1>
    <p>{{ t('exames.dia.texto') }}</p>
    <div class="filtros">
      <div class="campo">
        <label for="dia-exame-data">{{ t('exames.data') }}</label>
        <input id="dia-exame-data" v-model="data" type="date" data-testid="dia-exame-data" />
      </div>
      <SanteSelecao v-model="agenda" :rotulo="t('exames.agenda')" :opcoes="escolhas" />
    </div>
    <ErroExame v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('exames.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.itens.length === 0">{{ t('exames.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-dia-exame">
        <caption>
          {{
            t('exames.dia.legenda', { n: lista.data.value.itens.length, data: dataBr(dia) })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('exames.hora') }}</th>
            <th scope="col">{{ t('exames.agenda') }}</th>
            <th scope="col">{{ t('exames.paciente') }}</th>
            <th scope="col">{{ t('exames.exame') }}</th>
            <th scope="col">{{ t('exames.marcacao.situacao') }}</th>
            <th scope="col">{{ t('exames.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in lista.data.value.itens" :key="m.id">
            <td>{{ m.hora }}</td>
            <td>{{ m.agendaNome }}</td>
            <td>
              {{ m.paciente }}
              <span v-if="m.vinculo === 'sem-vinculo'" class="secundario">
                · {{ t('exames.dia.semProntuario') }}</span
              >
            </td>
            <td>{{ m.exameEscolhido?.nome ?? '—' }}</td>
            <td>{{ m.estadoRotulo }}</td>
            <td>
              <RouterLink
                :to="`/agenda/exames/marcacoes/${m.id}`"
                :aria-label="t('exames.dia.abrir', { hora: m.hora })"
              >
                {{ t('exames.dia.abrirCurto') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
