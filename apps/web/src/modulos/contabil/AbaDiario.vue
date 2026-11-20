<script setup lang="ts">
// Aba Diário (M54.3): o livro diário de um intervalo de datas (até 12 meses), em páginas do servidor: cada lançamento
// com data, número, tipo, histórico e as partidas (conta, débito ou crédito, centro de custo); os totais do intervalo
// inteiro com as parcelas por tipo e a conferência. A exportação leva o intervalo inteiro.
import type { ApoioDemonstracoes } from '@sgh/contratos';
import { SanteBotao, SanteData } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import BotoesExportar from './BotoesExportar.vue';
import { type FiltroDiarioTela, lerDiario } from './api-demonstracoes.js';
import { dataBr, reais } from './comum-contabil.js';
import { problemaDoIntervalo } from './comum-demonstracoes.js';
import { diasDaCompetencia } from './comum-lancamentos.js';

const props = defineProps<{ apoio: ApoioDemonstracoes; empresa: number; hoje: string }>();
const { t } = useI18n();

const mes = diasDaCompetencia(props.hoje.slice(0, 7));
const de = ref<string | null>(mes.de);
const ate = ref<string | null>(mes.ate);
const problema = computed(() => problemaDoIntervalo(de.value, ate.value));
const pedido = ref<FiltroDiarioTela | null>(null);
function consultar() {
  if (problema.value) return;
  pedido.value = { empresa: props.empresa, de: de.value!, ate: ate.value!, pagina: 1 };
}
function irPara(n: number) {
  if (pedido.value && n >= 1) pedido.value = { ...pedido.value, pagina: n };
}
const diario = useQuery({
  queryKey: computed(() => ['contabil', 'diario', pedido.value]),
  queryFn: () => lerDiario(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const d = computed(() => (pedido.value ? (diario.data.value ?? null) : null));
const exportacao = computed(() =>
  pedido.value
    ? { tipo: 'diario' as const, empresa: pedido.value.empresa, de: pedido.value.de, ate: pedido.value.ate }
    : null,
);
</script>

<template>
  <section class="bloco" aria-labelledby="diario-titulo" data-testid="aba-diario">
    <h2 id="diario-titulo">{{ t('contabil.demonstracoes.diario.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.demonstracoes.diario.ajuda') }}</p>
    <div class="campos">
      <SanteData v-model="de" :rotulo="t('contabil.razao.de')" editavel data-testid="diario-de" />
      <SanteData v-model="ate" :rotulo="t('contabil.razao.ate')" editavel data-testid="diario-ate" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.demonstracoes.consultar')"
          :desabilitado="problema !== null"
          data-testid="diario-consultar"
          @acionar="consultar"
        />
      </div>
    </div>
    <p v-if="problema && problema !== 'intervaloIncompleto'" class="erro" data-testid="diario-problema">
      {{ t(`contabil.demonstracoes.problemas.${problema}`) }}
    </p>
    <p v-if="!pedido" data-testid="diario-escolha">{{ t('contabil.demonstracoes.escolhaPeriodo') }}</p>
    <MensagemErro v-else-if="diario.isError.value" :erro="diario.error.value" />
    <p v-else-if="!d" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <dl class="dados" data-testid="diario-totais">
        <dt>{{ t('contabil.demonstracoes.diario.lancamentos') }}</dt>
        <dd>{{ d.totais.lancamentos }}</dd>
        <dt>{{ t('contabil.lancamentos.debitos') }}</dt>
        <dd>{{ reais(d.totais.debitosCentavos) }}</dd>
        <dt>{{ t('contabil.lancamentos.creditos') }}</dt>
        <dd>{{ reais(d.totais.creditosCentavos) }}</dd>
        <dt>{{ t('contabil.razao.conferencia') }}</dt>
        <dd data-testid="diario-conferencia">{{ d.conferencia }}</dd>
      </dl>
      <ul v-if="d.parcelas.length > 0" class="secundario" data-testid="diario-parcelas">
        <li v-for="p in d.parcelas" :key="p.tipo">
          {{
            t('contabil.demonstracoes.diario.parcela', {
              tipo: t(`contabil.lancamentos.tipos.${p.tipo}`),
              n: p.lancamentos,
              valor: reais(p.debitosCentavos),
            })
          }}
        </li>
      </ul>
      <p v-if="d.lancamentos.length === 0" data-testid="diario-vazio">
        {{ t('contabil.demonstracoes.semMovimento') }}
      </p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="tabela-diario">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.data') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.numero') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.conta') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.historico') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.centroCusto') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.debito') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.credito') }}</th>
            </tr>
          </thead>
          <tbody v-for="l in d.lancamentos" :key="l.id" :data-testid="`diario-lancamento-${l.id}`">
            <tr class="cabeca">
              <td>{{ dataBr(l.data) }}</td>
              <th scope="row">{{ l.id }}</th>
              <td>{{ l.tipoRotulo }}</td>
              <td>
                {{ l.historico }}
                <span v-if="l.estornaId" class="secundario">
                  {{ t('contabil.demonstracoes.diario.estorna', { n: l.estornaId }) }}
                </span>
              </td>
              <td></td>
              <td>{{ reais(l.debitosCentavos) }}</td>
              <td>{{ reais(l.creditosCentavos) }}</td>
            </tr>
            <tr v-for="(p, i) in l.partidas" :key="i">
              <td></td>
              <td></td>
              <td>{{ p.conta }}</td>
              <td>{{ p.contaNome }}</td>
              <td>{{ p.centroCusto ?? '—' }}</td>
              <td>{{ p.lado === 'D' ? reais(p.valorCentavos) : '' }}</td>
              <td>{{ p.lado === 'C' ? reais(p.valorCentavos) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="acoes">
        <SanteBotao
          v-if="d.pagina > 1"
          variante="secundario"
          :rotulo="t('contabil.razao.paginaAnterior')"
          data-testid="diario-pagina-anterior"
          @acionar="irPara(d.pagina - 1)"
        />
        <span v-if="d.pagina > 1 || d.parcial" class="secundario" data-testid="diario-pagina">
          {{ t('contabil.demonstracoes.diario.pagina', { n: d.pagina }) }}
        </span>
        <SanteBotao
          v-if="d.parcial"
          variante="secundario"
          :rotulo="t('contabil.razao.proximaPagina')"
          data-testid="diario-proxima-pagina"
          @acionar="irPara(d.pagina + 1)"
        />
      </div>
      <BotoesExportar v-if="exportacao" :filtro="exportacao" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
<style scoped>
.cabeca td,
.cabeca th {
  font-weight: 600;
  border-top: 2px solid currentColor;
}
</style>
