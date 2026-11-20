<script setup lang="ts">
// Indicadores da recepção (M19; ficha, seção 7): senhas por hora de emissão, por dia, por serviço, por prioridade e
// por situação no período (até 366 dias), e as esperas (emissão → chamada, chamada → fim; prioritárias × normais;
// por hora e por guichê; a primeira chamada feita em outro terminal entra pelo vigia do painel). Só agregados.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerApoio, lerIndicadores } from '../api-recepcao.js';
import { dataDe, diaRelativo, minutosOu } from '../formato.js';

const { t, te } = useI18n();
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(diaRelativo(hoje, -6));
const ate = ref(hoje);
const recepcao = ref('');
const pedido = ref({ de: de.value, ate: ate.value, recepcao: '' });
const apoio = useQuery({ queryKey: ['recepcao', 'apoio'], queryFn: () => lerApoio(), staleTime: 60_000 });
const consulta = useQuery({
  queryKey: computed(() => ['recepcao', 'indicadores', pedido.value]),
  queryFn: () =>
    lerIndicadores(
      pedido.value.de,
      pedido.value.ate,
      pedido.value.recepcao ? Number(pedido.value.recepcao) : null,
    ),
});
const opcoes = computed(() => [
  { valor: '', rotulo: t('recepcao.supervisor.todas') },
  ...(apoio.data.value?.recepcoes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
]);
const consultar = () => (pedido.value = { de: de.value, ate: ate.value, recepcao: recepcao.value });
const maxHora = computed(() => Math.max(1, ...(consulta.data.value?.porHora ?? []).map((h) => h.emitidas)));
const sem = computed(() => t('recepcao.indicadores.semMedida'));
const situacao = (s: string) => (te(`recepcao.situacoes.${s}`) ? t(`recepcao.situacoes.${s}`) : s);
const prioridade = (p: string) => t(`recepcao.prioridades.${p === '0' || p === '1' ? p : '2'}`);
const nomeRecepcao = (id: number) =>
  apoio.data.value?.recepcoes.find((r) => r.id === id)?.descricao ?? String(id);
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="indicadores-titulo" data-testid="tela-indicadores-recepcao">
    <h1 id="indicadores-titulo">{{ t('recepcao.indicadores.titulo') }}</h1>
    <p>{{ t('recepcao.indicadores.texto') }}</p>
    <div class="filtros">
      <div class="campo">
        <label for="ind-de">{{ t('recepcao.indicadores.de') }}</label>
        <input id="ind-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="ind-ate">{{ t('recepcao.indicadores.ate') }}</label>
        <input id="ind-ate" v-model="ate" type="date" />
      </div>
      <SanteSelecao v-model="recepcao" :rotulo="t('recepcao.recepcao')" :opcoes="opcoes" />
      <SanteBotao
        :rotulo="t('recepcao.indicadores.consultar')"
        :desabilitado="!de || !ate"
        data-testid="consultar-indicadores"
        @acionar="consultar"
      />
    </div>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <template v-else>
      <p role="status" data-testid="indicadores-total">
        {{ t('recepcao.indicadores.total', { n: consulta.data.value.total }) }} ·
        {{ t('recepcao.indicadores.naoLocalizado', { n: consulta.data.value.naoLocalizado }) }}
      </p>
      <p>
        {{
          t('recepcao.indicadores.esperas', {
            medidas: consulta.data.value.esperas.medidas,
            chegada: minutosOu(consulta.data.value.esperas.chegadaChamadaMedia, sem),
            fim: minutosOu(consulta.data.value.esperas.chamadaFimMedia, sem),
            prio: minutosOu(consulta.data.value.esperas.prioritariasMedia, sem),
            normais: minutosOu(consulta.data.value.esperas.normaisMedia, sem),
          })
        }}
      </p>
      <table class="tabela">
        <caption>
          {{
            t('recepcao.indicadores.porHora')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.indicadores.hora') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.emitidas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in consulta.data.value.porHora" :key="h.hora">
            <td>{{ t('recepcao.indicadores.horaDe', { h: String(h.hora).padStart(2, '0') }) }}</td>
            <td>
              <span
                class="barra"
                :style="{ width: `${Math.round((h.emitidas / maxHora) * 12)}rem` }"
                aria-hidden="true"
              ></span>
              {{ h.emitidas }}
            </td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="indicadores-espera-hora">
        <caption>
          {{
            t('recepcao.indicadores.esperaPorHora')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.indicadores.hora') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.medidas') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.esperaMedia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in consulta.data.value.esperaPorHora" :key="h.hora">
            <td>{{ t('recepcao.indicadores.horaDe', { h: String(h.hora).padStart(2, '0') }) }}</td>
            <td>{{ h.medidas }}</td>
            <td>{{ minutosOu(h.esperaMedia, sem) }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="indicadores-por-guiche">
        <caption>
          {{
            t('recepcao.indicadores.porGuiche')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.indicadores.guiche') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.chamadas') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.esperaMedia') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.chamadaFim') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in consulta.data.value.porGuiche" :key="`${g.recepcao}-${g.guiche}`">
            <td>{{ t('recepcao.indicadores.guicheDe', { g: g.guiche, r: nomeRecepcao(g.recepcao) }) }}</td>
            <td>{{ g.chamadas }}</td>
            <td>{{ minutosOu(g.esperaMedia, sem) }}</td>
            <td>{{ minutosOu(g.chamadaFimMedia, sem) }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela">
        <caption>
          {{
            t('recepcao.indicadores.porDia')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.indicadores.dia') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.emitidas') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.concluidas') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.suspensas') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.atendidas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in consulta.data.value.porDia" :key="d.data">
            <td>{{ dataDe(d.data) }}</td>
            <td>{{ d.emitidas }}</td>
            <td>{{ d.liberadas }}</td>
            <td>{{ d.suspensas }}</td>
            <td>{{ d.atendidas }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela">
        <caption>
          {{
            t('recepcao.indicadores.porServico')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.servico') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.senhas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in consulta.data.value.porServico" :key="s.gerador">
            <td>{{ s.servico }}</td>
            <td>{{ s.senhas }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela">
        <caption>
          {{
            t('recepcao.indicadores.porPrioridade')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.prioridade') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.senhas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in consulta.data.value.prioridade" :key="p.prioridade">
            <td>{{ prioridade(p.prioridade) }}</td>
            <td>{{ p.senhas }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela">
        <caption>
          {{
            t('recepcao.indicadores.porSituacao')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.indicadores.situacao') }}</th>
            <th scope="col">{{ t('recepcao.indicadores.senhas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in consulta.data.value.porSituacao" :key="s.situacao">
            <td>{{ situacao(s.situacao) }}</td>
            <td>{{ s.senhas }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
