<script setup lang="ts">
// Balancete, DRE e balanço (M54.3, etapa F3; item `Controladoria > Contabilidade > Balancete, DRE e balanço`;
// `contabil.demonstracao.ler`): as abas Balancete, Diário, DRE, Balanço e Apuração do resultado, todas lidas dos
// lançamentos gravados, com as parcelas e a conferência impressas e a exportação em PDF/A ou XLSX. O razão de uma
// conta é o da tela dos lançamentos (o link do balancete leva até ela). O servidor confere de novo cada permissão.
import type { ApoioDemonstracoes } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../casca/MensagemErro.vue';
import AbaApuracao from './AbaApuracao.vue';
import AbaBalancete from './AbaBalancete.vue';
import AbaBalanco from './AbaBalanco.vue';
import AbaDiario from './AbaDiario.vue';
import AbaDre from './AbaDre.vue';
import { lerApoioDemonstracoes } from './api-demonstracoes.js';

type Aba = 'balancete' | 'diario' | 'dre' | 'balanco' | 'apuracao';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const router = useRouter();
const empresa = ref(1);
const apoio = useQuery({
  queryKey: computed(() => ['contabil', 'apoio-demonstracoes', empresa.value]),
  queryFn: () => lerApoioDemonstracoes(empresa.value),
});
const a = computed<ApoioDemonstracoes | null>(() => apoio.data.value ?? null);
const hoje = computed(() => props.hoje ?? a.value?.hoje ?? new Date().toISOString().slice(0, 10));
watch(a, (x) => {
  if (x && x.empresas.length > 0 && !x.empresas.includes(empresa.value)) empresa.value = x.empresas[0]!;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas.length ? a.value.empresas : [1]).map((e) => ({
    valor: e,
    rotulo: t('contabil.empresaN', { n: e }),
  })),
);
const aba = ref<Aba>('balancete');
const abas: readonly Aba[] = ['balancete', 'diario', 'dre', 'balanco', 'apuracao'];
function abrirRazao(f: { conta: string; de: string; ate: string }) {
  void router?.push({ path: '/contabil/lancamentos', query: { aba: 'razao', ...f } });
}
</script>

<template>
  <section class="tela-contabil" aria-labelledby="demonstracoes-titulo" data-testid="tela-demonstracoes">
    <h1 id="demonstracoes-titulo">{{ t('contabil.demonstracoes.titulo') }}</h1>
    <p>{{ t('contabil.demonstracoes.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('contabil.carregando') }}</p>
    <SanteAlerta
      v-else-if="!a.ligada"
      :texto="a.motivo ?? t('contabil.desligada')"
      variante="info"
      data-testid="contabil-desligada"
    />
    <template v-else>
      <div class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('contabil.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="demonstracoes-empresa"
        />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`contabil.demonstracoes.abas.${x}`)"
          :data-testid="`demonstracoes-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <p v-if="a.podeVerSped">
        <RouterLink to="/contabil/sped" data-testid="demonstracoes-ir-sped">
          {{ t('contabil.demonstracoes.irParaSped') }}
        </RouterLink>
      </p>
      <AbaBalancete
        v-if="aba === 'balancete'"
        :key="`b-${empresa}`"
        :apoio="a"
        :empresa="empresa"
        :hoje="hoje"
        @razao="abrirRazao"
      />
      <AbaDiario
        v-else-if="aba === 'diario'"
        :key="`d-${empresa}`"
        :apoio="a"
        :empresa="empresa"
        :hoje="hoje"
      />
      <AbaDre v-else-if="aba === 'dre'" :key="`r-${empresa}`" :apoio="a" :empresa="empresa" :hoje="hoje" />
      <AbaBalanco
        v-else-if="aba === 'balanco'"
        :key="`p-${empresa}`"
        :apoio="a"
        :empresa="empresa"
        :hoje="hoje"
      />
      <AbaApuracao v-else :key="`a-${empresa}`" :apoio="a" :empresa="empresa" :hoje="hoje" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
