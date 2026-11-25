<script setup lang="ts">
// Apuração do período (ficha do M33, seção 7): `/repasse/apuracao`. Uma apuração por período e empresa num só sistema
// (regra 10: o período apurado no outro sistema é mostrado e não se grava outra); apurar ou recalcular a aberta, os
// totais com as parcelas por beneficiário, as pendências por motivo, conferir, aprovar (quem apurou não aprova; regra
// 9) ou devolver, e os lançamentos de cada beneficiário pela apuração aprovada. O demonstrativo de cada um abre com a
// memória de cálculo; a dos itens pendentes (sem executante, sem regra...) fica nesta tela, com o motivo, as regras
// descartadas e a conta, o atendimento e o procedimento de cada item (link para a conta), filtrável pelo motivo e
// paginada; quem apurou, conferiu e aprovou à vista. Os indicadores do repasse com as parcelas impressas.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  apurar,
  decidirApuracao,
  lancarApuracao,
  lerApuracao,
  lerIndicadores,
  lerPendentes,
  novaChave,
} from '../api-repasse.js';
import { opcoes, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, tem, motivo } = usarRepasse();
const competencia = ref('');
const consultada = ref('');
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !competencia.value) {
      competencia.value = h.slice(0, 7);
      consultada.value = competencia.value;
    }
  },
  { immediate: true },
);
const apuracao = useQuery({
  queryKey: computed(() => ['repasse', 'apuracao', consultada.value]),
  queryFn: () => lerApuracao(1, consultada.value),
  enabled: computed(() => consultada.value !== ''),
});
const indicadores = useQuery({ queryKey: ['repasse', 'indicadores'], queryFn: () => lerIndicadores() });
const eventos = computed(() => opcoes(apoio.data.value?.eventos));
const evento = ref('');
watch(eventos, (e) => {
  if (!evento.value && e[0]) evento.value = e[0].valor;
});
const consultar = () => (consultada.value = competencia.value);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const justificativa = ref('');
async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['repasse'] });
  } catch (e) {
    erro.value = e;
  }
}
const a = computed(() => apuracao.data.value);
const fazerApuracao = () =>
  agir(() => apurar({ empresa: 1, competencia: consultada.value }, novaChave('apurar')));
const decidir = (acao: 'conferir' | 'aprovar' | 'devolver') =>
  agir(() =>
    decidirApuracao(
      a.value!.id!,
      { acao, ...(acao === 'devolver' ? { justificativa: justificativa.value } : {}) },
      novaChave(acao),
    ),
  );
const lancar = () => agir(() => lancarApuracao(a.value!.id!, Number(evento.value), novaChave('lancar')));

// Os itens pendentes: os primeiros vêm com a apuração; o filtro pelo motivo e as páginas seguintes, pela rota paginada.
// Cada linha leva a conta, o atendimento, o prontuário e o procedimento, com o link para a conta (corrigir o executante).
const TAMANHO_PENDENTES = 50;
const motivoPendente = ref('');
const paginaPendentes = ref(1);
watch([() => a.value?.id, motivoPendente], () => (paginaPendentes.value = 1));
const daApuracao = computed(
  () =>
    motivoPendente.value === '' &&
    paginaPendentes.value === 1 &&
    (a.value?.pendentes ?? 0) <= (a.value?.itensPendentes.length ?? 0),
);
const pendentes = useQuery({
  queryKey: computed(() => [
    'repasse',
    'pendentes',
    a.value?.id ?? 0,
    motivoPendente.value,
    paginaPendentes.value,
  ]),
  queryFn: () =>
    lerPendentes(a.value!.id!, {
      ...(motivoPendente.value ? { motivo: motivoPendente.value } : {}),
      pagina: paginaPendentes.value,
      tamanho: TAMANHO_PENDENTES,
    }),
  enabled: computed(() => !!a.value?.id && a.value.pendentes > 0 && !daApuracao.value),
});
const listaPendentes = computed(() =>
  daApuracao.value ? (a.value?.itensPendentes ?? []) : (pendentes.data.value?.itens ?? []),
);
const totalPendentes = computed(() =>
  daApuracao.value ? (a.value?.pendentes ?? 0) : (pendentes.data.value?.total ?? 0),
);
const tamanhoPagina = computed(() => (daApuracao.value ? listaPendentes.value.length : TAMANHO_PENDENTES));
const deItem = computed(() => (paginaPendentes.value - 1) * tamanhoPagina.value + 1);
const ateItem = computed(() => deItem.value + listaPendentes.value.length - 1);
const motivosPendentes = computed(() => [
  { valor: '', rotulo: t('repasse.apuracao.todosMotivos') },
  ...Object.keys(a.value?.pendenciasPorMotivo ?? {}).map((m) => ({
    valor: m,
    rotulo: `${t(`repasse.apuracao.pendencia.${m}`)} (${a.value!.pendenciasPorMotivo[m]})`,
  })),
]);
const podeAbrirConta = computed(() => tem('faturamento.conta.ler'));
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="ap-titulo" data-testid="tela-rep-apuracao">
    <h1 id="ap-titulo">{{ t('repasse.apuracao.titulo') }}</h1>
    <form class="filtros" @submit.prevent="consultar">
      <span class="campo">
        <label for="ap-comp">{{ t('repasse.competencia') }}</label>
        <input id="ap-comp" v-model="competencia" type="month" data-testid="ap-competencia" />
      </span>
      <button type="submit" data-testid="ap-consultar">{{ t('repasse.consultar') }}</button>
    </form>
    <ErroFaturamento v-if="apuracao.error.value" :erro="apuracao.error.value" />
    <template v-if="a">
      <p v-if="a.aviso" role="note" data-testid="ap-aviso">{{ a.aviso }}</p>
      <p v-if="a.sistema === 'novo'" data-testid="ap-estado">
        {{ t('repasse.apuracao.titulo') }} {{ a.id }} — {{ t(`repasse.apuracao.estado.${a.estado}`) }}
      </p>
      <dl v-if="a.sistema === 'novo'" class="totais" data-testid="ap-quem">
        <div>
          <dt>{{ t('repasse.apuracao.apuradoPor') }}</dt>
          <dd data-testid="ap-apurado-por">{{ a.apuradoPor ?? t('repasse.apuracao.ninguem') }}</dd>
        </div>
        <div>
          <dt>{{ t('repasse.apuracao.conferidoPor') }}</dt>
          <dd data-testid="ap-conferido-por">{{ a.conferidoPor ?? t('repasse.apuracao.ninguem') }}</dd>
        </div>
        <div>
          <dt>{{ t('repasse.apuracao.aprovadoPor') }}</dt>
          <dd data-testid="ap-aprovado-por">{{ a.aprovadoPor ?? t('repasse.apuracao.ninguem') }}</dd>
        </div>
      </dl>
      <div class="acoes">
        <button
          v-if="a.sistema !== 'outro-sistema' && (a.estado === null || a.estado === 'aberta')"
          type="button"
          :disabled="!pode('apurar', 'repasse.apuracao.apurar')"
          :title="motivo('apurar') ?? undefined"
          data-testid="ap-apurar"
          @click="fazerApuracao"
        >
          {{ t('repasse.apuracao.apurar') }}
        </button>
        <button
          v-if="a.estado === 'aberta'"
          type="button"
          :disabled="!pode('apurar', 'repasse.apuracao.apurar')"
          data-testid="ap-conferir"
          @click="decidir('conferir')"
        >
          {{ t('repasse.apuracao.conferir') }}
        </button>
        <template v-if="a.estado === 'conferida' && tem('repasse.apuracao.aprovar')">
          <button type="button" data-testid="ap-aprovar" @click="decidir('aprovar')">
            {{ t('repasse.apuracao.aprovar') }}
          </button>
          <label for="ap-just" class="oculto">{{ t('repasse.justificativa') }}</label>
          <input id="ap-just" v-model="justificativa" :placeholder="t('repasse.justificativa')" />
          <button type="button" data-testid="ap-devolver" @click="decidir('devolver')">
            {{ t('repasse.apuracao.devolver') }}
          </button>
        </template>
        <template v-if="a.estado === 'aprovada' && tem('repasse.lancamento.criar')">
          <span class="campo">
            <SanteSelecao
              v-model="evento"
              :rotulo="t('repasse.evento')"
              :opcoes="eventos"
              data-testid="ap-evento"
            />
          </span>
          <button
            type="button"
            :disabled="a.simulacao || !pode('repasse.lancarEvento', 'repasse.lancamento.criar')"
            :title="a.simulacao ? t('repasse.apuracao.simulacaoSemLancamento') : undefined"
            data-testid="ap-lancar"
            @click="lancar"
          >
            {{ t('repasse.lancamentos.titulo') }}
          </button>
          <p v-if="a.simulacao" role="note" data-testid="ap-lancar-motivo">
            {{ t('repasse.apuracao.simulacaoSemLancamento') }}
          </p>
        </template>
      </div>
      <dl v-if="a.sistema === 'novo'" class="totais" data-testid="ap-totais">
        <div>
          <dt>{{ t('repasse.apuracao.itens') }}</dt>
          <dd>{{ a.itens }}</dd>
        </div>
        <div>
          <dt>{{ t('repasse.apuracao.comRepasse') }}</dt>
          <dd>{{ a.comRepasse }}</dd>
        </div>
        <div>
          <dt>{{ t('repasse.apuracao.pendentes') }}</dt>
          <dd>{{ a.pendentes }}</dd>
        </div>
        <div>
          <dt>{{ t('repasse.apuracao.baseTotal') }}</dt>
          <dd>{{ reais(a.base) }}</dd>
        </div>
        <div>
          <dt>{{ t('repasse.apuracao.repasseTotal') }}</dt>
          <dd>{{ reais(a.valor) }}</dd>
        </div>
      </dl>
      <ul v-if="Object.keys(a.pendenciasPorMotivo).length" data-testid="ap-pendencias">
        <li v-for="(n, m) in a.pendenciasPorMotivo" :key="m">
          {{ t(`repasse.apuracao.pendencia.${m}`) }}: {{ n }}
        </li>
      </ul>
      <section
        v-if="a.id && a.pendentes > 0"
        aria-labelledby="ap-pend-titulo"
        data-testid="ap-pendentes-secao"
      >
        <h2 id="ap-pend-titulo">{{ t('repasse.apuracao.itensPendentes') }}</h2>
        <div class="filtros">
          <span class="campo">
            <SanteSelecao
              v-model="motivoPendente"
              :rotulo="t('repasse.apuracao.filtroMotivo')"
              :opcoes="motivosPendentes"
              data-testid="ap-pend-motivo"
            />
          </span>
        </div>
        <ErroFaturamento v-if="pendentes.error.value" :erro="pendentes.error.value" />
        <table v-if="listaPendentes.length" class="tabela" data-testid="ap-itens-pendentes">
          <thead>
            <tr>
              <th scope="col">{{ t('repasse.apuracao.conta') }}</th>
              <th scope="col">{{ t('repasse.apuracao.atendimento') }}</th>
              <th scope="col">{{ t('repasse.apuracao.procedimento') }}</th>
              <th scope="col">{{ t('repasse.apuracao.realizadoEm') }}</th>
              <th scope="col">{{ t('repasse.apuracao.profissional') }}</th>
              <th scope="col">{{ t('repasse.apuracao.motivo') }}</th>
              <th scope="col">{{ t('repasse.apuracao.memoria') }}</th>
              <th scope="col">{{ t('repasse.apuracao.regrasDescartadas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in listaPendentes" :key="i.item" :data-testid="`ap-pendente-${i.item}`">
              <td>
                <RouterLink
                  v-if="podeAbrirConta"
                  :to="`/faturamento/contas/${i.referencia.conta}`"
                  :aria-label="t('repasse.apuracao.abrirConta', { numero: i.referencia.contaNumero })"
                  :data-testid="`ap-pend-conta-${i.item}`"
                >
                  {{ i.referencia.contaNumero }}
                </RouterLink>
                <template v-else>{{ i.referencia.contaNumero }}</template>
              </td>
              <td>
                {{ i.referencia.atendimento }}
                <span class="secundario">
                  {{ t('repasse.apuracao.prontuario', { numero: i.referencia.prontuario }) }}</span
                >
              </td>
              <td>
                {{ i.referencia.procedimento }}
                <span class="secundario">{{ i.referencia.procedimentoDescricao }}</span>
              </td>
              <td>{{ i.referencia.realizadoEm ?? '—' }}</td>
              <td>{{ i.referencia.profissional ?? t('repasse.apuracao.semProfissional') }}</td>
              <td>{{ i.pendencia ? t(`repasse.apuracao.pendencia.${i.pendencia}`) : '—' }}</td>
              <td>
                {{ i.conta
                }}<span v-if="i.dimensoes.length" class="secundario"> ({{ i.dimensoes.join(', ') }})</span>
              </td>
              <td>
                <template v-if="i.ignoradas.length">
                  <span v-for="g in i.ignoradas" :key="g.regra" class="opcao">
                    {{ t('repasse.apuracao.regraDescartada', { regra: g.regra, motivo: g.motivo }) }}
                  </span>
                </template>
                <span v-else class="secundario">{{ t('repasse.apuracao.semDescartadas') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="totalPendentes > 0" class="acoes" data-testid="ap-pend-paginas">
          <span role="status">{{
            t('repasse.apuracao.paginaDe', { de: deItem, ate: ateItem, total: totalPendentes })
          }}</span>
          <button
            type="button"
            :disabled="paginaPendentes === 1"
            data-testid="ap-pend-anterior"
            @click="paginaPendentes -= 1"
          >
            {{ t('repasse.apuracao.anterior') }}
          </button>
          <button
            type="button"
            :disabled="ateItem >= totalPendentes"
            data-testid="ap-pend-proxima"
            @click="paginaPendentes += 1"
          >
            {{ t('repasse.apuracao.proxima') }}
          </button>
        </div>
      </section>
      <table v-if="a.porBeneficiario.length" class="tabela" data-testid="ap-beneficiarios">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.prestador') }}</th>
            <th scope="col">{{ t('repasse.apuracao.itens') }}</th>
            <th scope="col">{{ t('repasse.apuracao.baseTotal') }}</th>
            <th scope="col">{{ t('repasse.valor') }}</th>
            <th scope="col">{{ t('repasse.apuracao.demonstrativo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in a.porBeneficiario" :key="b.prestador">
            <td>{{ b.prestador }}</td>
            <td>{{ b.itens }}</td>
            <td>{{ reais(b.base) }}</td>
            <td>{{ reais(b.valor) }}</td>
            <td>
              <RouterLink
                :to="`/repasse/apuracao/${a.id}/${b.prestador}`"
                :data-testid="`ap-demo-${b.prestador}`"
              >
                {{ t('repasse.abrir') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>{{ t('repasse.total') }}</td>
            <td>{{ a.comRepasse }}</td>
            <td>{{ reais(a.base) }}</td>
            <td>{{ reais(a.valor) }}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ap-mensagem" />

    <h2>{{ t('repasse.indicadores') }}</h2>
    <ul v-if="indicadores.data.value" data-testid="ap-indicadores">
      <li v-for="i in indicadores.data.value" :key="i.codigo">
        {{ i.rotulo }}: <strong>{{ i.valor ?? '—' }}{{ i.unidade === '%' ? '%' : ` ${i.unidade}` }}</strong>
        <span class="secundario"> ({{ i.parcelas }})</span>
      </li>
    </ul>
  </section>
</template>

<style src="../estilo-repasse.css"></style>
