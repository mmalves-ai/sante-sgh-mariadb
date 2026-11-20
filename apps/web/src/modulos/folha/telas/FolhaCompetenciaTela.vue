<script setup lang="ts">
// Folha da competência, parte F0 (M53.1; item `Gestão de pessoas > Folha de pagamento`; `pessoas.folha.ler`, gravações
// com `pessoas.folha.exportar`, `pessoas.folha.importar` e `pessoas.afastamento.registrar`): a interface com a folha
// externa (gerar e baixar o lote da competência, importar o retorno e conferir contagem e soma nos dois sentidos) e os
// afastamentos que o lote leva. Empresa e competência com busca (ADR 0027). O servidor confere tudo de novo.
// M53.3 (etapa F2): as abas do cálculo mensal (prévia, cálculo, prova da soma, memória), dos salários contratuais
// (`pessoas.salario.ler`, só para quem o tem) e dos parâmetros da folha da empresa, com o apoio próprio do cálculo.
// M53.4 (etapa F3): as abas de férias (`pessoas.ferias.ler`) e do 13º salário, com o apoio próprio, pedido só ao abri-las.
// M53.5 (etapa F4): a aba da rescisão (`pessoas.rescisao.ler`), com o apoio próprio, pedido só ao abri-la.
// M53.7 (etapa F6): a aba do fechamento do período (lista do ano, conferência, fechar e reabrir com
// `pessoas.folha.fechar`); `?aba=fechamento` abre direto nela (o painel dos periódicos do eSocial leva até aqui).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerApoioFolha } from '../api-folha.js';
import AbaCalculo from '../calculo/AbaCalculo.vue';
import AbaParametros from '../calculo/AbaParametros.vue';
import AbaSalarios from '../calculo/AbaSalarios.vue';
import { lerApoioCalculo } from '../calculo/api-calculo.js';
import { competenciasAte, rotuloCompetencia } from '../comum-folha.js';
import AbaDecimo from '../ferias/AbaDecimo.vue';
import AbaFerias from '../ferias/AbaFerias.vue';
import { lerApoioFerias } from '../ferias/api-ferias.js';
import AbaFechamentoFolha from '../fechamento/AbaFechamentoFolha.vue';
import AbaRescisao from '../rescisao/AbaRescisao.vue';
import { lerApoioRescisao } from '../rescisao/api-rescisao.js';
import AbaAfastamentos from './AbaAfastamentos.vue';
import AbaInterface from './AbaInterface.vue';
import ErroFolha from './ErroFolha.vue';

const { t } = useI18n();
// M53.2 (D-MENU-532): o item do menu abre esta tela; as rubricas, incidências e tabelas legais ficam a um clique.
// D-ABRIR-532: o item abre para quem tem qualquer parte da área; quem não consulta a folha da competência (a sessão já
// carregada sem `pessoas.folha.ler`) vai direto às rubricas e tabelas legais, sem pedir o apoio da folha.
const { permissoes, sessao } = usarSessao();
const veRubricas = computed(
  () => permissoes.value.has('pessoas.rubrica.ler') || permissoes.value.has('pessoas.tabelaLegalFolha.ler'),
);
const soOutraParte = computed(() => !!sessao.value && !permissoes.value.has('pessoas.folha.ler'));
const router = useRouter();
watch(
  soOutraParte,
  (v) => {
    if (v) void router?.replace('/pessoas/folha/rubricas');
  },
  { immediate: true },
);
const apoio = useQuery({
  queryKey: ['folha', 'apoio'],
  queryFn: lerApoioFolha,
  // Na casca a sessão já vem do cache: quem não consulta a folha não chega a pedir o apoio.
  enabled: computed(() => !soOutraParte.value),
});
const a = computed(() => apoio.data.value ?? null);
const apoioCalculo = useQuery({
  queryKey: ['folha', 'calculo', 'apoio'],
  queryFn: lerApoioCalculo,
  enabled: computed(() => !soOutraParte.value),
});
const ac = computed(() => apoioCalculo.data.value ?? null);
type Aba =
  | 'calculo'
  | 'salarios'
  | 'parametros'
  | 'ferias'
  | 'decimo'
  | 'rescisao'
  | 'fechamento'
  | 'interface'
  | 'afastamentos';
// A aba dos salários só aparece para quem consulta salário (permissão sensível própria, D-PERM-533); a das férias, para
// quem as consulta (`pessoas.ferias.ler`); a do 13º, para quem consulta a folha (a lista das parcelas); a da rescisão,
// para quem a consulta (`pessoas.rescisao.ler`).
const abas = computed<Aba[]>(() => [
  'calculo',
  ...(ac.value?.acoes.verSalario ? (['salarios'] as const) : []),
  'parametros',
  ...(permissoes.value.has('pessoas.ferias.ler') ? (['ferias'] as const) : []),
  'decimo',
  ...(permissoes.value.has('pessoas.rescisao.ler') ? (['rescisao'] as const) : []),
  'fechamento',
  'interface',
  'afastamentos',
]);
const rota = useRoute();
const aba = ref<Aba>(rota?.query['aba'] === 'fechamento' ? 'fechamento' : 'calculo');
watch(abas, (xs) => {
  if (!xs.includes(aba.value)) aba.value = 'calculo';
});
const abaFerias = computed(() => aba.value === 'ferias' || aba.value === 'decimo');
const apoioFerias = useQuery({
  queryKey: ['folha', 'ferias', 'apoio'],
  queryFn: lerApoioFerias,
  enabled: abaFerias,
});
const af = computed(() => apoioFerias.data.value ?? null);
const apoioRescisao = useQuery({
  queryKey: ['folha', 'rescisao', 'apoio'],
  queryFn: lerApoioRescisao,
  enabled: computed(() => aba.value === 'rescisao'),
});
const ar = computed(() => apoioRescisao.data.value ?? null);
const empresa = ref<number | null>(null);
const competencia = ref<string | null>(null);
watch(a, (x) => {
  if (!x) return;
  if (competencia.value === null) competencia.value = x.competenciaSugerida;
  if (empresa.value === null && x.empresas.length === 1) empresa.value = x.empresas[0]!.codigo;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas ?? []).map((e) => ({ valor: e.codigo, rotulo: e.rotulo })),
);
const opcoesCompetencia = computed(() =>
  a.value ? competenciasAte(a.value.hoje, 36).map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) })) : [],
);
const consulta = computed(
  () =>
    !!a.value &&
    !a.value.acoes.exportar &&
    !a.value.acoes.importar &&
    !a.value.acoes.afastamento &&
    !ac.value?.acoes.calcular &&
    !ac.value?.acoes.salario &&
    !ac.value?.acoes.parametros,
);
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="folha-titulo" data-testid="tela-folha">
    <h1 id="folha-titulo">{{ t('folha.titulo') }}</h1>
    <p>{{ t('folha.subtitulo') }}</p>
    <p v-if="veRubricas">
      <RouterLink to="/pessoas/folha/rubricas" data-testid="folha-abrir-rubricas">{{
        t('folha.rubricas')
      }}</RouterLink>
    </p>
    <p v-if="soOutraParte" role="status">{{ t('folha.carregando') }}</p>
    <ErroFolha v-else-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('folha.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? ''"
        variante="info"
        data-testid="folha-gravacao-desligada"
      />
      <SanteAlerta
        v-else-if="consulta"
        :texto="a.acoes.motivo ?? t('folha.soConsulta')"
        variante="info"
        data-testid="folha-so-consulta"
      />
      <div class="campos" data-testid="folha-filtros">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('folha.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="folha-empresa"
        />
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('folha.competencia')"
          :opcoes="opcoesCompetencia"
          busca
          data-testid="folha-competencia"
        />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`folha.abas.${x}`)"
          :data-testid="`folha-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <template v-if="abaFerias">
        <ErroFolha v-if="apoioFerias.isError.value" :erro="apoioFerias.error.value" />
        <p v-else-if="!af" role="status">{{ t('folha.carregando') }}</p>
        <template v-else>
          <SanteAlerta
            v-if="!af.gravacao.ligada && a.gravacao.ligada"
            :texto="af.gravacao.motivo ?? ''"
            variante="info"
            data-testid="folha-ferias-gravacao-desligada"
          />
          <AbaFerias v-if="aba === 'ferias'" :apoio="af" :empresa="empresa" />
          <AbaDecimo v-else :apoio="af" :empresa="empresa" />
        </template>
      </template>
      <AbaFechamentoFolha v-else-if="aba === 'fechamento'" :hoje="a.hoje" :empresa="empresa" />
      <template v-else-if="aba === 'rescisao'">
        <ErroFolha v-if="apoioRescisao.isError.value" :erro="apoioRescisao.error.value" />
        <p v-else-if="!ar" role="status">{{ t('folha.carregando') }}</p>
        <template v-else>
          <SanteAlerta
            v-if="!ar.gravacao.ligada && a.gravacao.ligada"
            :texto="ar.gravacao.motivo ?? ''"
            variante="info"
            data-testid="folha-rescisao-gravacao-desligada"
          />
          <AbaRescisao :apoio="ar" :empresa="empresa" />
        </template>
      </template>
      <ErroFolha
        v-else-if="apoioCalculo.isError.value && aba !== 'interface' && aba !== 'afastamentos'"
        :erro="apoioCalculo.error.value"
      />
      <p v-else-if="aba !== 'interface' && aba !== 'afastamentos' && !ac" role="status">
        {{ t('folha.carregando') }}
      </p>
      <AbaCalculo
        v-else-if="aba === 'calculo' && ac"
        :apoio="ac"
        :empresa="empresa"
        :competencia="competencia"
      />
      <AbaSalarios v-else-if="aba === 'salarios' && ac" :apoio="ac" :competencia="competencia" />
      <AbaParametros
        v-else-if="aba === 'parametros' && ac"
        :apoio="ac"
        :empresa="empresa"
        :competencia="competencia"
      />
      <AbaInterface
        v-else-if="aba === 'interface'"
        :apoio="a"
        :empresa="empresa"
        :competencia="competencia"
      />
      <AbaAfastamentos v-else-if="aba === 'afastamentos'" :apoio="a" :competencia="competencia" />
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
