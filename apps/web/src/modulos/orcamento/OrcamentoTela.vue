<script setup lang="ts">
// Orçamento empresarial (M54, etapa 7; item `Financeiro > Orçamento empresarial`; `financeiro.orcamento.ler` /
// `financeiro.orcamento.editar` / `financeiro.orcamento.aprovar`): as versões do ano (criar vazia, cópia ou do
// realizado do ano anterior com ajuste), a versão aberta com os valores por mês (grade centro × item × mês), a aprovação
// com segregação, o descarte com motivo e o orçado × realizado; os cenários (C1-125); e os parâmetros do orçamento, só
// para consulta. As ações
// aparecem só com a permissão e a liberação; o servidor confere de novo.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AbaCenariosOrcamento from './AbaCenariosOrcamento.vue';
import AbaEstatisticasOrcamento from './AbaEstatisticasOrcamento.vue';
import AbaVersoesOrcamento from './AbaVersoesOrcamento.vue';
import { lerApoioOrcamento } from './api-orcamento.js';
import ErroOrcamento from './ErroOrcamento.vue';
import VersaoOrcamento from './VersaoOrcamento.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const apoio = useQuery({ queryKey: ['orcamento', 'apoio'], queryFn: lerApoioOrcamento });
const a = computed(() => apoio.data.value ?? null);
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);

type Aba = 'versoes' | 'cenarios' | 'estatisticas' | 'parametros';
const ABAS: readonly Aba[] = ['versoes', 'cenarios', 'estatisticas', 'parametros'];
const aba = ref<Aba>('versoes');
const aberta = ref<number | null>(null);
const ano = ref<number>(Number(hoje.slice(0, 4)));

const aviso = computed(() => {
  const x = a.value;
  if (!x) return null;
  if (!x.chaveLigada) return t('orcamentoEmpresarial.desligada');
  if (!x.acoes.editar && !x.acoes.aprovar) return t('orcamentoEmpresarial.semPermissaoGravar');
  return null;
});
const simNao = (v: boolean | null) =>
  v === null
    ? t('orcamentoEmpresarial.parametros.vazio')
    : v
      ? t('orcamentoEmpresarial.parametros.sim')
      : t('orcamentoEmpresarial.parametros.nao');
const ouVazio = (v: number | string | null) =>
  v === null || v === '' ? t('orcamentoEmpresarial.parametros.vazio') : String(v);
</script>

<template>
  <section class="tela-orcamento" aria-labelledby="orc-titulo" data-testid="tela-orcamento">
    <h1 id="orc-titulo">{{ t('orcamentoEmpresarial.titulo') }}</h1>
    <p>{{ t('orcamentoEmpresarial.subtitulo') }}</p>
    <ErroOrcamento v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('orcamentoEmpresarial.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="orc-aviso-gravacao" />
      <VersaoOrcamento v-if="aberta !== null" :id="aberta" :apoio="a" :hoje="hoje" @voltar="aberta = null" />
      <template v-else>
        <div class="acoes" role="tablist">
          <SanteBotao
            v-for="x in ABAS"
            :key="x"
            role="tab"
            :aria-selected="aba === x"
            :variante="aba === x ? 'primario' : 'secundario'"
            :rotulo="t(`orcamentoEmpresarial.abas.${x}`)"
            :data-testid="`orc-aba-${x}`"
            @acionar="aba = x"
          />
        </div>
        <AbaVersoesOrcamento
          v-if="aba === 'versoes'"
          v-model:ano="ano"
          :apoio="a"
          :hoje="hoje"
          @abrir="aberta = $event"
        />
        <AbaCenariosOrcamento v-else-if="aba === 'cenarios'" :pode-editar="a.acoes.editar" />
        <AbaEstatisticasOrcamento
          v-else-if="aba === 'estatisticas'"
          :hoje="hoje"
          :pode-editar="a.acoes.editar && a.chaveLigada"
        />
        <section v-else class="bloco" aria-labelledby="orc-param-titulo" data-testid="orc-parametros">
          <h2 id="orc-param-titulo">{{ t('orcamentoEmpresarial.parametros.titulo') }}</h2>
          <p class="secundario">{{ t('orcamentoEmpresarial.parametros.ajuda') }}</p>
          <dl class="dados">
            <dt>{{ t('orcamentoEmpresarial.parametros.anoInicial') }}</dt>
            <dd>{{ ouVazio(a.parametros.anoInicial) }}</dd>
            <dt>{{ t('orcamentoEmpresarial.parametros.mesInicial') }}</dt>
            <dd>{{ ouVazio(a.parametros.mesInicial) }}</dd>
            <dt>{{ t('orcamentoEmpresarial.parametros.digitaCentro') }}</dt>
            <dd>{{ simNao(a.parametros.digitaCentro) }}</dd>
            <dt>{{ t('orcamentoEmpresarial.parametros.regime') }}</dt>
            <dd>{{ ouVazio(a.parametros.regime) }}</dd>
          </dl>
          <p>
            <RouterLink
              to="/consultas/item/financeiro.orcamento-empresarial"
              data-testid="orc-consulta-parametros"
              >{{ t('orcamentoEmpresarial.parametros.consulta') }}</RouterLink
            >
          </p>
          <h3>{{ t('orcamentoEmpresarial.parametros.naturezas') }}</h3>
          <dl class="dados" data-testid="orc-naturezas">
            <template v-for="n in a.naturezas" :key="n.codigo">
              <dt>{{ n.rotulo }}</dt>
              <dd>{{ n.descricao }}</dd>
            </template>
          </dl>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
