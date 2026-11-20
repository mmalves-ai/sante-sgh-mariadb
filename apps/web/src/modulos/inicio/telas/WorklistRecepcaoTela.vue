<script setup lang="ts">
// Recepção: senhas e guias pendentes (ficha do M27, seção 7; regra 5; cap-03 §3.5): `/inicio/recepcao`. As senhas
// aguardando pela prioridade legal (Lei 13.466/2017: acima de 80 anos, depois as demais prioridades, depois a ordem de
// chegada) com a espera, as chegadas do dia (as marcações e se o paciente já chegou) e as guias aguardando a
// autorização do convênio, a mais antiga primeiro. Só leitura: chamar a senha é no guichê; a guia abre o atendimento
// para registrar a autorização. Filtro pela recepção; ao vivo pelo canal de eventos (sem ele, relê a cada 15 s).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';
import { dataHoraDe, horaDe } from '../../recepcao/formato.js';
import { lerApoio } from '../../recepcao/api-recepcao.js';
import { usarCanalAvisos } from '../../../casca/avisos/canal.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { CANAL_RECEPCAO, donoDaSessao, lerWorklistRecepcao } from '../api-inicio.js';
import ErroTrabalho from '../componentes/ErroTrabalho.vue';

const { t } = useI18n();
const recepcao = ref('');
const { sessao } = usarSessao();
const apoio = useQuery({
  queryKey: ['recepcao', 'apoio'],
  queryFn: () => lerApoio(),
  staleTime: 60_000,
  retry: 0,
});
const recepcoes = computed(() => [
  { valor: '', rotulo: t('trabalho.recepcao.todas') },
  ...(apoio.data.value?.recepcoes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
]);
// O canal só diz "mudou" (a senha emitida ou chamada aqui ou no outro sistema, pelo vigia); sem ele, relê a cada 15 s.
const canal = usarCanalAvisos(
  CANAL_RECEPCAO,
  () => true,
  () => void fila.refetch(),
);
const fila = useQuery({
  queryKey: computed(() => ['inicio', 'recepcao', recepcao.value || null, donoDaSessao(sessao.value)]),
  queryFn: () => lerWorklistRecepcao(recepcao.value ? Number(recepcao.value) : null),
  refetchInterval: computed(() => canal.intervalo()),
});
const podeGuiche = computed(() => pode('recepcao.senha.ler'));
const podeAtendimento = computed(() => pode('atendimento.atendimento.ler'));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="wl-rec-titulo" data-testid="tela-worklist-recepcao">
    <h1 id="wl-rec-titulo">{{ t('trabalho.recepcao.titulo') }}</h1>
    <p>{{ t('trabalho.recepcao.texto') }}</p>
    <div class="filtros">
      <SanteSelecao
        v-if="recepcoes.length > 1"
        v-model="recepcao"
        :rotulo="t('trabalho.recepcao.recepcao')"
        :opcoes="recepcoes"
        data-testid="wl-rec-recepcao"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('trabalho.atualizar')"
        data-testid="wl-rec-atualizar"
        @acionar="fila.refetch()"
      />
      <RouterLink v-if="podeGuiche" to="/recepcao/guiche">{{ t('trabalho.recepcao.guiche') }}</RouterLink>
    </div>
    <ErroTrabalho v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('trabalho.carregando') }}</p>
    <template v-else>
      <p class="secundario" role="status">
        {{ t('trabalho.atualizada', { hora: horaDe(fila.data.value.geradaEm) }) }}
      </p>
      <section class="painel" aria-labelledby="wl-rec-senhas">
        <h2 id="wl-rec-senhas">{{ t('trabalho.recepcao.senhas') }} ({{ fila.data.value.senhas.length }})</h2>
        <p v-if="fila.data.value.senhas.length === 0">{{ t('trabalho.recepcao.senhasVazio') }}</p>
        <table v-else class="tabela" data-testid="tabela-wl-senhas">
          <caption class="sgh-visualmente-oculto">
            {{
              t('trabalho.recepcao.senhas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('trabalho.recepcao.senha') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.prioridade') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.servico') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.espera') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in fila.data.value.senhas"
              :key="s.id"
              :class="{ prioritaria: s.prioridade !== '2' }"
              :data-testid="`wl-senha-${s.id}`"
            >
              <td>
                <strong>{{ s.senha }}</strong>
              </td>
              <td>
                {{ t(`trabalho.recepcao.prioridades.${s.prioridade}`) }}
                <span v-if="s.grupoDescricao" class="secundario"> · {{ s.grupoDescricao }}</span>
              </td>
              <td>{{ s.gerador }}</td>
              <td>{{ t('trabalho.recepcao.esperaMin', { n: s.esperaMinutos }) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="painel" aria-labelledby="wl-rec-guias">
        <h2 id="wl-rec-guias">{{ t('trabalho.recepcao.guias') }} ({{ fila.data.value.guias.length }})</h2>
        <p v-if="fila.data.value.guias.length === 0">{{ t('trabalho.recepcao.guiasVazio') }}</p>
        <table v-else class="tabela" data-testid="tabela-wl-guias">
          <caption class="sgh-visualmente-oculto">
            {{
              t('trabalho.recepcao.guias')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('trabalho.recepcao.atendimento') }}</th>
              <th scope="col">{{ t('trabalho.medico.paciente') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.convenio') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.abertoEm') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.espera') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in fila.data.value.guias" :key="g.reg" :data-testid="`wl-guia-${g.reg}`">
              <td>
                <RouterLink
                  v-if="podeAtendimento"
                  :to="`/recepcao/atendimento/${g.reg}/segurado`"
                  :aria-label="t('trabalho.recepcao.abrirAtendimento', { reg: g.reg })"
                  >{{ g.reg }}</RouterLink
                >
                <template v-else>{{ g.reg }}</template>
              </td>
              <td>{{ g.paciente }}</td>
              <td>{{ g.convenio }}</td>
              <td>{{ dataHoraDe(g.abertoEm) }}</td>
              <td>{{ t('trabalho.recepcao.esperaMin', { n: g.esperaMinutos }) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="painel" aria-labelledby="wl-rec-chegadas">
        <h2 id="wl-rec-chegadas">
          {{ t('trabalho.recepcao.chegadas') }} ({{ fila.data.value.chegadas.length }})
        </h2>
        <p v-if="fila.data.value.chegadas.length === 0">{{ t('trabalho.recepcao.chegadasVazio') }}</p>
        <table v-else class="tabela" data-testid="tabela-wl-chegadas">
          <caption class="sgh-visualmente-oculto">
            {{
              t('trabalho.recepcao.chegadas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('trabalho.recepcao.hora') }}</th>
              <th scope="col">{{ t('trabalho.medico.paciente') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.agenda') }}</th>
              <th scope="col">{{ t('trabalho.recepcao.chegou') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in fila.data.value.chegadas" :key="c.marcacao">
              <td>{{ c.hora.length === 4 ? `${c.hora.slice(0, 2)}:${c.hora.slice(2)}` : c.hora }}</td>
              <td>{{ c.paciente }}</td>
              <td>{{ c.agenda }}</td>
              <td>{{ c.chegou ? t('trabalho.recepcao.chegou') : t('trabalho.recepcao.aguardando') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p v-if="fila.data.value.cortada" class="secundario">{{ t('trabalho.cortada') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.prioritaria td:first-child {
  border-left: 4px solid var(--sgh-borda-forte);
}
</style>
