<script setup lang="ts">
// Aba Balancete (M54.3; regra 5): o balancete de verificação de um intervalo de até 12 meses, até o nível escolhido
// do plano, com ou sem as contas zeradas e o filtro de centro de custo: saldo anterior, débitos, créditos e saldo
// final de cada conta (com "D" ou "C"), as sintéticas em destaque, os totais só das analíticas e a conferência impressa
// (débitos = créditos; saldos devedores = saldos credores). Período aberto aparece avisado. Do saldo de uma analítica,
// o razão dela.
import type { ApoioDemonstracoes } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import BotoesExportar from './BotoesExportar.vue';
import { type FiltroBalanceteTela, lerBalancete } from './api-demonstracoes.js';
import { reais, rotuloCompetencia } from './comum-contabil.js';
import { intervaloDoAno, problemaDoIntervalo, saldoDC } from './comum-demonstracoes.js';
import { diasDaCompetencia } from './comum-lancamentos.js';
import { competenciasAte } from '../folha/comum-folha.js';

const props = defineProps<{ apoio: ApoioDemonstracoes; empresa: number; hoje: string }>();
const emit = defineEmits<{ razao: [f: { conta: string; de: string; ate: string }] }>();
const { t } = useI18n();

const padrao = intervaloDoAno(props.hoje);
const de = ref<string | null>(padrao.de);
const ate = ref<string | null>(padrao.ate);
const nivel = ref<number | null>(null);
const zeradas = ref(false);
const centro = ref<number | null>(null);
const competencias = computed(() =>
  competenciasAte(props.hoje, 36).map((c) => ({ valor: c as string | null, rotulo: rotuloCompetencia(c) })),
);
const niveis = computed(() => [
  { valor: null as number | null, rotulo: t('contabil.demonstracoes.todosNiveis') },
  ...Array.from({ length: props.apoio.niveis }, (_, i) => ({
    valor: (i + 1) as number | null,
    rotulo: t('contabil.demonstracoes.ateNivel', { n: i + 1 }),
  })),
]);
// Centros de custo do estabelecimento com busca (ADR 0027); o inativo fica na lista (balancete de período antigo).
const centros = computed(() => [
  { valor: null as number | null, rotulo: t('contabil.demonstracoes.todosCentros') },
  ...props.apoio.centros.map((c) => ({
    valor: c.codigo as number | null,
    rotulo: `${c.codigo} · ${c.nome}${c.ativo ? '' : ` (${t('contabil.demonstracoes.centroInativo')})`}`,
  })),
]);
const problema = computed(() => problemaDoIntervalo(de.value, ate.value));
const pedido = ref<FiltroBalanceteTela | null>(null);
function consultar() {
  if (problema.value) return;
  pedido.value = {
    empresa: props.empresa,
    de: de.value!,
    ate: ate.value!,
    nivel: nivel.value,
    incluirZeradas: zeradas.value,
    centroCusto: centro.value,
  };
}
const balancete = useQuery({
  queryKey: computed(() => ['contabil', 'balancete', pedido.value]),
  queryFn: () => lerBalancete(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const b = computed(() => (pedido.value ? (balancete.data.value ?? null) : null));
/** O razão da conta no mesmo intervalo (do primeiro dia do início ao último dia do fim). */
function abrirRazao(conta: string) {
  if (!pedido.value) return;
  emit('razao', {
    conta,
    de: diasDaCompetencia(pedido.value.de).de,
    ate: diasDaCompetencia(pedido.value.ate).ate,
  });
}
</script>

<template>
  <section class="bloco" aria-labelledby="balancete-titulo" data-testid="aba-balancete">
    <h2 id="balancete-titulo">{{ t('contabil.demonstracoes.balancete.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.demonstracoes.balancete.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="de"
        :rotulo="t('contabil.demonstracoes.de')"
        :opcoes="competencias"
        busca
        data-testid="balancete-de"
      />
      <SanteSelecao
        v-model="ate"
        :rotulo="t('contabil.demonstracoes.ate')"
        :opcoes="competencias"
        busca
        data-testid="balancete-ate"
      />
      <SanteSelecao
        v-model="nivel"
        :rotulo="t('contabil.demonstracoes.nivel')"
        :opcoes="niveis"
        data-testid="balancete-nivel"
      />
      <SanteSelecao
        v-model="centro"
        :rotulo="t('contabil.lancamentos.centroCusto')"
        :opcoes="centros"
        busca
        data-testid="balancete-centro"
      />
      <label class="marca">
        <input v-model="zeradas" type="checkbox" data-testid="balancete-zeradas" />
        {{ t('contabil.demonstracoes.incluirZeradas') }}
      </label>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.demonstracoes.consultar')"
          :desabilitado="problema !== null"
          data-testid="balancete-consultar"
          @acionar="consultar"
        />
      </div>
    </div>
    <p v-if="problema && problema !== 'intervaloIncompleto'" class="erro" data-testid="balancete-problema">
      {{ t(`contabil.demonstracoes.problemas.${problema}`) }}
    </p>
    <p v-if="!pedido" data-testid="balancete-escolha">{{ t('contabil.demonstracoes.escolhaPeriodo') }}</p>
    <MensagemErro v-else-if="balancete.isError.value" :erro="balancete.error.value" />
    <p v-else-if="!b" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="b.competenciasAbertas.length > 0"
        variante="info"
        :texto="
          t('contabil.demonstracoes.abertas', {
            lista: b.competenciasAbertas.map(rotuloCompetencia).join(', '),
          })
        "
        data-testid="balancete-abertas"
      />
      <SanteAlerta
        v-if="b.equilibrado === false"
        variante="alerta"
        :texto="t('contabil.demonstracoes.balancete.desequilibrado')"
        data-testid="balancete-desequilibrado"
      />
      <p v-if="b.equilibrado === null" class="secundario" data-testid="balancete-centro-aviso">
        {{ t('contabil.demonstracoes.balancete.comCentro') }}
      </p>
      <p v-if="b.linhas.length === 0" data-testid="balancete-vazio">
        {{ t('contabil.demonstracoes.semMovimento') }}
      </p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="tabela-balancete">
          <caption class="secundario">
            {{
              t('contabil.demonstracoes.balancete.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.lancamentos.conta') }}</th>
              <th scope="col">{{ t('contabil.demonstracoes.nome') }}</th>
              <th scope="col">{{ t('contabil.razao.saldoAnterior') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.debitos') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.creditos') }}</th>
              <th scope="col">{{ t('contabil.razao.saldoFinal') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in b.linhas"
              :key="l.codigo"
              :class="{ sintetica: l.tipo === 'sintetica' }"
              :data-testid="`balancete-linha-${l.codigo}`"
            >
              <th scope="row">
                <SanteBotao
                  v-if="l.tipo === 'analitica' && !l.foraDoPlano"
                  variante="secundario"
                  :rotulo="l.codigo"
                  :data-testid="`balancete-razao-${l.codigo}`"
                  @acionar="abrirRazao(l.codigo)"
                />
                <template v-else>{{ l.codigo }}</template>
              </th>
              <td :style="{ paddingInlineStart: `${(l.nivel - 1) * 0.75}rem` }">
                {{ l.nome }}
                <strong v-if="l.foraDoPlano" class="erro">{{
                  t('contabil.demonstracoes.foraDoPlano')
                }}</strong>
              </td>
              <td>{{ saldoDC(l.saldoAnteriorCentavos) }}</td>
              <td>{{ reais(l.debitosCentavos) }}</td>
              <td>{{ reais(l.creditosCentavos) }}</td>
              <td>{{ saldoDC(l.saldoFinalCentavos) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl class="dados" data-testid="balancete-totais">
        <dt>{{ t('contabil.demonstracoes.balancete.anteriorDevedor') }}</dt>
        <dd>{{ reais(b.totais.saldoAnteriorDevedorCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.balancete.anteriorCredor') }}</dt>
        <dd>{{ reais(b.totais.saldoAnteriorCredorCentavos) }}</dd>
        <dt>{{ t('contabil.lancamentos.debitos') }}</dt>
        <dd>{{ reais(b.totais.debitosCentavos) }}</dd>
        <dt>{{ t('contabil.lancamentos.creditos') }}</dt>
        <dd>{{ reais(b.totais.creditosCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.balancete.finalDevedor') }}</dt>
        <dd>{{ reais(b.totais.saldoFinalDevedorCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.balancete.finalCredor') }}</dt>
        <dd>{{ reais(b.totais.saldoFinalCredorCentavos) }}</dd>
      </dl>
      <h3>{{ t('contabil.razao.conferencia') }}</h3>
      <ul data-testid="balancete-conferencia">
        <li v-for="(c, i) in b.conferencia" :key="i">{{ c }}</li>
      </ul>
      <BotoesExportar :filtro="{ tipo: 'balancete', ...pedido! }" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
<style scoped>
.sintetica td,
.sintetica th {
  font-weight: 600;
}
</style>
