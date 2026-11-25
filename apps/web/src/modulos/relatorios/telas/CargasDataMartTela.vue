<script setup lang="ts">
// Cargas do data mart (01-REL L113): `/relatorios/datamart/cargas`. A última carga em destaque (situação, linhas,
// duração), a lista das cargas do estabelecimento (agendadas e manuais, com quem pediu) e o detalhe com as etapas por
// dimensão e fato. "Carregar agora" (`relatorio.datamart.acionar`) pede a carga manual: o worker a assume em até 5
// minutos; com outra carga aberta, a recusa aparece na hora. A lista se atualiza sozinha enquanto há carga aberta.
// Só contagens e tempos: nenhum dado de pessoa.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { codigoDaRecusa } from '../../exames/api-exames.js';
import {
  type CargaDataMart,
  lerCargaDataMart,
  lerCargasDataMart,
  pedirCargaDataMart,
} from '../api-datamart.js';

const { t } = useI18n();
const cliente = useQueryClient();
const podePedir = pode('relatorio.datamart.acionar');
const ABERTAS = ['aguardando', 'em_execucao'];
const cargas = useQuery({
  queryKey: ['relatorios', 'datamart', 'cargas'],
  queryFn: lerCargasDataMart,
  refetchInterval: (q) =>
    (q.state.data?.itens ?? []).some((c) => ABERTAS.includes(c.situacao)) ? 15_000 : false,
});
const ultima = computed<CargaDataMart | null>(() => cargas.data.value?.itens[0] ?? null);
const aberta = computed(() => (cargas.data.value?.itens ?? []).some((c) => ABERTAS.includes(c.situacao)));

const aberto = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['relatorios', 'datamart', 'carga', aberto.value]),
  queryFn: () => lerCargaDataMart(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});

const erro = ref<unknown>(null);
const aviso = ref('');
const pedindo = ref(false);
async function pedir(): Promise<void> {
  erro.value = null;
  aviso.value = '';
  pedindo.value = true;
  try {
    await pedirCargaDataMart();
    aviso.value = t('relatorios.datamart.pedida');
  } catch (e) {
    if (codigoDaRecusa(e) === 'carga-em-andamento') aviso.value = t('relatorios.datamart.emAndamento');
    else erro.value = e;
  } finally {
    pedindo.value = false;
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'datamart'] });
  }
}

const quando = (v: string | null) =>
  v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const numero = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR'));
function duracao(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return t('relatorios.datamart.ms', { n: ms });
  const s = Math.round(ms / 1000);
  return s < 60
    ? t('relatorios.datamart.segundos', { n: s })
    : t('relatorios.datamart.minutos', { n: Math.round(s / 60) });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="datamart-titulo" data-testid="tela-cargas-datamart">
    <h1 id="datamart-titulo">{{ t('relatorios.datamart.titulo') }}</h1>
    <p>{{ t('relatorios.datamart.texto') }}</p>
    <div class="filtros">
      <SanteBotao
        v-if="podePedir"
        data-testid="datamart-pedir"
        :rotulo="t('relatorios.datamart.pedir')"
        :desabilitado="pedindo || aberta"
        @acionar="pedir"
      />
      <span v-if="podePedir && aberta" class="secundario">{{ t('relatorios.datamart.aguarde') }}</span>
    </div>
    <p v-if="aviso" role="status" data-testid="datamart-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="cargas.isError.value" :erro="cargas.error.value" />
    <p v-else-if="!cargas.data.value" role="status">{{ t('relatorios.carregando') }}</p>
    <template v-else>
      <p v-if="ultima" role="status" data-testid="datamart-ultima">
        {{
          t('relatorios.datamart.ultima', {
            situacao: t(`relatorios.datamart.situacoes.${ultima.situacao}`),
            quando: quando(ultima.ocorridoEm),
            linhas: numero(ultima.linhasGravadas),
            duracao: duracao(ultima.duracaoMs),
          })
        }}
      </p>
      <p v-if="cargas.data.value.itens.length === 0" data-testid="datamart-vazio">
        {{ t('relatorios.datamart.nenhuma') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-cargas-datamart">
        <caption>
          {{
            t('relatorios.datamart.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('relatorios.datamart.inicio') }}</th>
            <th scope="col">{{ t('relatorios.datamart.disparo') }}</th>
            <th scope="col">{{ t('relatorios.datamart.situacao') }}</th>
            <th scope="col">{{ t('relatorios.datamart.linhas') }}</th>
            <th scope="col">{{ t('relatorios.datamart.rejeitadas') }}</th>
            <th scope="col">{{ t('relatorios.datamart.duracao') }}</th>
            <th scope="col">{{ t('relatorios.datamart.mensagem') }}</th>
            <th scope="col">{{ t('relatorios.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cargas.data.value.itens" :key="c.id" :data-testid="`carga-${c.id}`">
            <td>{{ quando(c.ocorridoEm) }}</td>
            <td>
              {{ t(`relatorios.datamart.disparos.${c.disparo}`) }}
              <span v-if="c.pedidoPor" class="secundario">{{ c.pedidoPor }}</span>
            </td>
            <td :data-testid="`carga-${c.id}-situacao`">
              {{ t(`relatorios.datamart.situacoes.${c.situacao}`) }}
            </td>
            <td>{{ numero(c.linhasGravadas) }}</td>
            <td>{{ numero(c.linhasRejeitadas) }}</td>
            <td>{{ duracao(c.duracaoMs) }}</td>
            <td>{{ c.mensagemErro ?? '—' }}</td>
            <td>
              <SanteBotao
                v-if="c.etapas > 0"
                variante="secundario"
                :data-testid="`carga-${c.id}-etapas`"
                :rotulo="t('relatorios.datamart.verEtapas', { n: c.etapas })"
                @acionar="aberto = aberto === c.id ? null : c.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="aberto !== null">
        <MensagemErro v-if="detalhe.isError.value" :erro="detalhe.error.value" />
        <table v-else-if="detalhe.data.value" class="tabela" data-testid="tabela-etapas-datamart">
          <caption>
            {{
              t('relatorios.datamart.etapasDe', { quando: quando(detalhe.data.value.ocorridoEm) })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{{ t('relatorios.datamart.objeto') }}</th>
              <th scope="col">{{ t('relatorios.datamart.tipo') }}</th>
              <th scope="col">{{ t('relatorios.datamart.linhas') }}</th>
              <th scope="col">{{ t('relatorios.datamart.duracao') }}</th>
              <th scope="col">{{ t('relatorios.datamart.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in detalhe.data.value.itens" :key="e.sequencia">
              <td>{{ e.sequencia }}</td>
              <td>{{ e.objeto }}</td>
              <td>{{ t(`relatorios.datamart.tipos.${e.tipoObjeto}`) }}</td>
              <td>{{ numero(e.linhas) }}</td>
              <td>{{ duracao(e.duracaoMs) }}</td>
              <td>{{ t(`relatorios.datamart.situacoesEtapa.${e.situacao}`) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>
