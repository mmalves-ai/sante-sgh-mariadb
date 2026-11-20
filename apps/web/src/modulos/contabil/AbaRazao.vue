<script setup lang="ts">
// Aba Razão (M54.2): o razão de uma conta analítica num intervalo (até 12 meses; centro de custo opcional): o saldo
// anterior, os movimentos com o saldo a cada linha, os totais e a conferência impressa (saldo anterior + débitos −
// créditos = saldo final, na natureza da conta). Os movimentos vêm em páginas do servidor (a ficha pede paginado), com
// o saldo inicial de cada página; os totais são sempre do intervalo inteiro.
import type { ApoioLancamentos } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { lerRazao } from './api-lancamentos.js';
import { dataBr, reais } from './comum-contabil.js';
import { diasDaCompetencia } from './comum-lancamentos.js';

const props = defineProps<{
  apoio: ApoioLancamentos;
  empresa: number;
  hoje: string;
  /** Vindo do balancete (M54.3): a conta já escolhida e consultada no mês de hoje. */
  contaInicial?: string | null;
  deInicial?: string | null;
  ateInicial?: string | null;
}>();
defineEmits<{ lancamento: [conta: string] }>();
const { t } = useI18n();

const mes = diasDaCompetencia(props.hoje.slice(0, 7));
const conta = ref<string | null>(props.contaInicial ?? null);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const de = ref<string | null>(props.deInicial && DATA.test(props.deInicial) ? props.deInicial : mes.de);
const ate = ref<string | null>(props.ateInicial && DATA.test(props.ateInicial) ? props.ateInicial : mes.ate);
const centro = ref('');
/** O pedido só vai ao servidor ao consultar (o filtro em edição não dispara leitura). */
const pedido = ref<{
  conta: string;
  de: string;
  ate: string;
  centroCusto: number | null;
  pagina: number;
} | null>(null);
const opcoesConta = computed(() =>
  props.apoio.contas.map((c) => ({ valor: c.codigo as string | null, rotulo: `${c.codigo} ${c.nome}` })),
);
const podeConsultar = computed(
  () =>
    !!conta.value &&
    !!de.value &&
    !!ate.value &&
    (centro.value.trim() === '' || /^\d+$/.test(centro.value.trim())),
);
function consultar() {
  if (!podeConsultar.value) return;
  pedido.value = {
    conta: conta.value!,
    de: de.value!,
    ate: ate.value!,
    centroCusto: centro.value.trim() ? Number(centro.value.trim()) : null,
    pagina: 1,
  };
}
if (props.contaInicial && props.apoio.contas.some((c) => c.codigo === props.contaInicial)) consultar();
function irParaPagina(n: number) {
  if (pedido.value && n >= 1) pedido.value = { ...pedido.value, pagina: n };
}
const razao = useQuery({
  queryKey: computed(() => ['contabil', 'razao', props.empresa, pedido.value]),
  queryFn: () => lerRazao({ empresa: props.empresa, ...pedido.value! }),
  enabled: computed(() => pedido.value !== null),
});
const r = computed(() => (pedido.value ? (razao.data.value ?? null) : null));
</script>

<template>
  <section class="bloco" aria-labelledby="razao-titulo" data-testid="aba-razao">
    <h2 id="razao-titulo">{{ t('contabil.razao.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.razao.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="conta"
        :rotulo="t('contabil.lancamentos.conta')"
        :opcoes="opcoesConta"
        busca
        data-testid="razao-conta"
      />
      <SanteData v-model="de" :rotulo="t('contabil.razao.de')" editavel data-testid="razao-de" />
      <SanteData v-model="ate" :rotulo="t('contabil.razao.ate')" editavel data-testid="razao-ate" />
      <SanteCampoTexto
        v-model="centro"
        :rotulo="t('contabil.lancamentos.centroCusto')"
        :max-bytes="9"
        data-testid="razao-centro"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.razao.consultar')"
          :desabilitado="!podeConsultar"
          data-testid="razao-consultar"
          @acionar="consultar"
        />
      </div>
    </div>
    <p v-if="!pedido" data-testid="razao-escolha">{{ t('contabil.razao.escolhaConta') }}</p>
    <MensagemErro v-else-if="razao.isError.value" :erro="razao.error.value" />
    <p v-else-if="!r" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <h3>{{ r.conta }} {{ r.contaNome }}</h3>
      <p class="secundario">
        {{ t('contabil.razao.natureza', { natureza: t(`contabil.razao.naturezas.${r.natureza}`) }) }}
      </p>
      <dl class="dados" data-testid="razao-totais">
        <dt>{{ t('contabil.razao.saldoAnterior') }}</dt>
        <dd>{{ reais(r.saldoAnteriorCentavos) }}</dd>
        <dt>{{ t('contabil.lancamentos.debitos') }}</dt>
        <dd>{{ reais(r.debitosCentavos) }}</dd>
        <dt>{{ t('contabil.lancamentos.creditos') }}</dt>
        <dd>{{ reais(r.creditosCentavos) }}</dd>
        <dt>{{ t('contabil.razao.saldoFinal') }}</dt>
        <dd>{{ reais(r.saldoFinalCentavos) }}</dd>
        <dt>{{ t('contabil.razao.conferencia') }}</dt>
        <dd data-testid="razao-conferencia">{{ r.conferencia }}</dd>
      </dl>
      <p v-if="r.pagina > 1 || r.parcial" class="secundario" data-testid="razao-pagina">
        {{ t('contabil.razao.pagina', { n: r.pagina, saldo: reais(r.saldoInicialPaginaCentavos) }) }}
      </p>
      <p v-if="r.parcial" class="secundario" data-testid="razao-parcial">{{ t('contabil.razao.parcial') }}</p>
      <p v-if="r.movimentos.length === 0" data-testid="razao-vazio">{{ t('contabil.razao.semMovimento') }}</p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="tabela-razao">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.data') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.numero') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.historico') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.centroCusto') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.debito') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.credito') }}</th>
              <th scope="col">{{ t('contabil.razao.saldo') }}</th>
              <th scope="col">{{ t('contabil.razao.conciliado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in r.movimentos" :key="m.partida" :data-testid="`razao-movimento-${m.partida}`">
              <td>{{ dataBr(m.data) }}</td>
              <td>{{ m.lancamento }}</td>
              <td>
                {{ m.historico }}
                <span class="secundario">({{ t(`contabil.lancamentos.tipos.${m.tipo}`) }})</span>
              </td>
              <td>{{ m.centroCusto ?? '—' }}</td>
              <td>{{ m.debitoCentavos ? reais(m.debitoCentavos) : '' }}</td>
              <td>{{ m.creditoCentavos ? reais(m.creditoCentavos) : '' }}</td>
              <td>{{ reais(m.saldoCentavos) }}</td>
              <td>{{ m.conciliado ? t('contabil.sim') : t('contabil.nao') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="acoes">
        <SanteBotao
          v-if="r.pagina > 1"
          variante="secundario"
          :rotulo="t('contabil.razao.paginaAnterior')"
          data-testid="razao-pagina-anterior"
          @acionar="irParaPagina(r.pagina - 1)"
        />
        <SanteBotao
          v-if="r.parcial"
          variante="secundario"
          :rotulo="t('contabil.razao.proximaPagina')"
          data-testid="razao-proxima-pagina"
          @acionar="irParaPagina(r.pagina + 1)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.abas.lancamentos')"
          data-testid="razao-ver-lancamentos"
          @acionar="$emit('lancamento', r.conta)"
        />
      </div>
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
