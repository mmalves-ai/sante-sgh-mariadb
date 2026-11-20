<script setup lang="ts">
// Lançamentos automáticos dos módulos e razão (M54.2, etapa F2; item `Controladoria > Contabilidade > Lançamentos
// automáticos dos módulos e razão`; `contabil.lancamento.ler`): as abas Lançamentos (lista com filtros, detalhe com as
// partidas, estorno e o lançamento manual), Razão (saldo anterior, movimentos e a conferência impressa), Conciliação
// (marcar partidas que se compensam; desfazer com justificativa), Períodos (situação com as parcelas e os
// impedimentos; encerrar e reabrir com a senha) e Fatos dos módulos (a da etapa 1, com "Contabilizar"; só com
// `contabil.fato.ler`). O servidor confere de novo cada permissão.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../casca/MensagemErro.vue';
import AbaConciliacao from './AbaConciliacao.vue';
import AbaFatos from './AbaFatos.vue';
import AbaLancamentos from './AbaLancamentos.vue';
import AbaPeriodos from './AbaPeriodos.vue';
import AbaRazao from './AbaRazao.vue';
import { lerApoioLancamentos } from './api-lancamentos.js';

type Aba = 'lancamentos' | 'razao' | 'conciliacao' | 'periodos' | 'fatos';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const empresa = ref(1);
const apoio = useQuery({
  queryKey: computed(() => ['contabil', 'apoio-lancamentos', empresa.value]),
  queryFn: () => lerApoioLancamentos(empresa.value),
});
const a = computed(() => apoio.data.value ?? null);
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

// Vindo do balancete (M54.3): `?aba=razao&conta=<código>` abre o razão da conta já consultado.
const rota = useRoute();
const daRota = (k: string) => {
  const v = rota?.query[k];
  return typeof v === 'string' && v ? v : null;
};
const doRazao = { conta: daRota('conta'), de: daRota('de'), ate: daRota('ate') };
const aba = ref<Aba>(rota?.query['aba'] === 'razao' ? 'razao' : 'lancamentos');
const abas = computed(() =>
  (['lancamentos', 'razao', 'conciliacao', 'periodos', 'fatos'] as const).filter(
    (x) => x !== 'fatos' || a.value?.podeVerFatos === true,
  ),
);
/** Do razão ou do período para a lista: a conta ou a competência já filtradas. */
const contaInicial = ref<string | null>(null);
const competenciaInicial = ref<string | null>(null);
function abrirLancamentos(f: { conta?: string; competencia?: string }) {
  contaInicial.value = f.conta ?? null;
  competenciaInicial.value = f.competencia ?? null;
  aba.value = 'lancamentos';
}
</script>

<template>
  <section class="tela-contabil" aria-labelledby="lancamentos-titulo" data-testid="tela-lancamentos">
    <h1 id="lancamentos-titulo">{{ t('contabil.lancamentos.titulo') }}</h1>
    <p>{{ t('contabil.lancamentos.descricao') }}</p>
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
          data-testid="lancamentos-empresa"
        />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`contabil.abas.${x}`)"
          :data-testid="`lancamentos-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <AbaLancamentos
        v-if="aba === 'lancamentos'"
        :apoio="a"
        :empresa="empresa"
        :hoje="hoje"
        :conta-inicial="contaInicial"
        :competencia-inicial="competenciaInicial"
      />
      <AbaRazao
        v-else-if="aba === 'razao'"
        :apoio="a"
        :empresa="empresa"
        :hoje="hoje"
        :conta-inicial="doRazao.conta"
        :de-inicial="doRazao.de"
        :ate-inicial="doRazao.ate"
        @lancamento="(conta: string) => abrirLancamentos({ conta })"
      />
      <AbaConciliacao v-else-if="aba === 'conciliacao'" :apoio="a" :empresa="empresa" />
      <AbaPeriodos
        v-else-if="aba === 'periodos'"
        :apoio="a"
        :empresa="empresa"
        @lancamentos="(competencia: string) => abrirLancamentos({ competencia })"
        @fatos="aba = 'fatos'"
      />
      <AbaFatos v-else :hoje="hoje" :pode-contabilizar="a.podeLancar" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
