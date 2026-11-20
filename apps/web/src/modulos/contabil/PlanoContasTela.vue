<script setup lang="ts">
// Plano de contas e regras (M54.1, etapa F1; item `Controladoria > Contabilidade > Plano de contas e plano referencial`;
// `contabil.plano.ler` / `contabil.plano.editar`, `contabil.regra.publicar`): a empresa com busca (ADR 0027) e três
// abas: o plano (árvore, detalhe, inclusão e alteração da conta), as regras de contabilização (versões, editor da nova
// versão, simulação com os fatos do período e publicação com a senha) e os problemas do plano. Com a contabilidade
// desligada, a tela mostra o motivo (POL-3) e nada grava; o servidor confere de novo cada leitura e gravação.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import AbaCadastrosContabil from './AbaCadastrosContabil.vue';
import AbaPlano from './AbaPlano.vue';
import AbaProblemas from './AbaProblemas.vue';
import AbaRegras from './AbaRegras.vue';
import { lerApoioContabil, lerPlano } from './api-contabil.js';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const apoio = useQuery({ queryKey: ['contabil', 'apoio'], queryFn: lerApoioContabil });
const a = computed(() => apoio.data.value ?? null);
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);

const empresa = ref<number>(1);
watch(a, (x) => {
  if (x && !x.empresas.includes(empresa.value)) empresa.value = x.empresas[0] ?? 1;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas ?? [1]).map((e) => ({ valor: e, rotulo: t('contabil.empresaN', { n: e }) })),
);
const plano = useQuery({
  queryKey: computed(() => ['contabil', 'plano', empresa.value]),
  queryFn: () => lerPlano(empresa.value),
  enabled: computed(() => a.value?.ligada === true),
});
const p = computed(() => plano.data.value ?? null);

type Aba = 'plano' | 'regras' | 'problemas' | 'cadastros';
// A aba Cadastros (receita genérica do M08) vale também com a contabilidade desligada; aparece com o que o perfil consulta.
const abas = computed<Aba[]>(() => [
  ...(a.value?.ligada ? (['plano', 'regras', 'problemas'] as const) : []),
  ...(a.value && a.value.cadastros.length > 0 ? (['cadastros'] as const) : []),
]);
const aba = ref<Aba>('plano');
watch(abas, (l) => {
  if (l.length > 0 && !l.includes(aba.value)) aba.value = l[0]!;
});
const rotuloAba = (x: Aba) =>
  x === 'problemas' && p.value
    ? t('contabil.abas.problemasN', { n: p.value.problemas.length })
    : t(`contabil.abas.${x}`);
</script>

<template>
  <section class="tela-contabil" aria-labelledby="plano-titulo" data-testid="tela-plano-contas">
    <h1 id="plano-titulo">{{ t('contabil.plano.titulo') }}</h1>
    <p>{{ t('contabil.plano.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.ligada"
        :texto="a.motivo ?? t('contabil.desligada')"
        variante="info"
        data-testid="contabil-desligada"
      />
      <div v-if="a.ligada" class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('contabil.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="plano-empresa"
        />
      </div>
      <div v-if="abas.length > 1 || a.ligada" class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="rotuloAba(x)"
          :data-testid="`plano-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <AbaCadastrosContabil v-if="aba === 'cadastros'" :cadastros="a.cadastros" />
      <template v-else-if="!a.ligada" />
      <MensagemErro v-else-if="plano.isError.value" :erro="plano.error.value" />
      <p v-else-if="!p" role="status">{{ t('contabil.carregando') }}</p>
      <template v-else>
        <AbaPlano v-if="aba === 'plano'" :apoio="a" :plano="p" />
        <AbaRegras v-else-if="aba === 'regras'" :apoio="a" :plano="p" :hoje="hoje" />
        <AbaProblemas v-else :plano="p" />
      </template>
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
