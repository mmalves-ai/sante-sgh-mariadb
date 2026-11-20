<script setup lang="ts">
// Integração da folha com o financeiro e o contábil (M53.9, etapa F8; item `Gestão de pessoas > Integração da folha com
// financeiro e contábil`; consulta com `pessoas.integracao.ler`, lançar com `pessoas.integracao.lancar`, o de-para com
// `pessoas.integracao.configurar`; ficha do M53, seções 4 a 8, regras 6, 10 e 11). A empresa com busca (ADR 0027) e as
// abas: lançar os títulos (origem do ano, prévia com a conta impressa, pendências, avisos, vencimentos ajustáveis e os
// fatos contábeis), os lançamentos do ano com os títulos e a situação no contas a pagar, o custo de pessoal por centro de
// custo e o de-para por vigência. O servidor confere tudo de novo.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import ErroFolha from '../telas/ErroFolha.vue';
import AbaCustoPessoal from './AbaCustoPessoal.vue';
import AbaDeParaFolha from './AbaDeParaFolha.vue';
import AbaLancamentosFolha from './AbaLancamentosFolha.vue';
import AbaLancarFolha from './AbaLancarFolha.vue';
import { lerApoioIntegracao } from './api-integracao.js';

const { t } = useI18n();
const rota = useRoute();
const { permissoes } = usarSessao();
const podeLancar = computed(() => permissoes.value.has('pessoas.integracao.lancar'));
const podeConfigurar = computed(() => permissoes.value.has('pessoas.integracao.configurar'));

const empresa = ref<number | null>(null);
const apoio = useQuery({
  queryKey: computed(() => ['folha', 'integracao', 'apoio', empresa.value]),
  queryFn: () => lerApoioIntegracao(empresa.value),
  // Trocar a empresa não apaga a tela enquanto o apoio dela chega.
  placeholderData: (anterior) => anterior,
});
const a = computed(() => apoio.data.value ?? null);
watch(a, (x) => {
  if (x && empresa.value === null && x.empresas.length === 1) empresa.value = x.empresas[0]!.codigo;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas ?? []).map((e) => ({ valor: e.codigo, rotulo: e.nome })),
);

type Aba = 'lancar' | 'lancamentos' | 'custo' | 'dePara';
const ABAS: readonly Aba[] = ['lancar', 'lancamentos', 'custo', 'dePara'];
const pedida = typeof rota?.query['aba'] === 'string' ? (rota.query['aba'] as Aba) : null;
const aba = ref<Aba>(pedida && ABAS.includes(pedida) ? pedida : 'lancar');
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="integracao-titulo" data-testid="tela-integracao-folha">
    <h1 id="integracao-titulo">{{ t('folha.integracao.titulo') }}</h1>
    <p>{{ t('folha.integracao.subtitulo') }}</p>
    <ErroFolha v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('folha.integracao.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!podeLancar && !podeConfigurar"
        :texto="t('folha.integracao.soConsulta')"
        variante="info"
        data-testid="integracao-so-consulta"
      />
      <div class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('folha.integracao.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="integracao-empresa"
        />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in ABAS"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`folha.integracao.abas.${x}`)"
          :data-testid="`integracao-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <p v-if="empresa === null" role="status" data-testid="integracao-escolha-empresa">
        {{ t('folha.integracao.escolhaEmpresa') }}
      </p>
      <AbaLancarFolha v-else-if="aba === 'lancar'" :apoio="a" :empresa="empresa" :pode-lancar="podeLancar" />
      <AbaLancamentosFolha v-else-if="aba === 'lancamentos'" :apoio="a" :empresa="empresa" />
      <AbaCustoPessoal v-else-if="aba === 'custo'" :apoio="a" :empresa="empresa" />
      <AbaDeParaFolha v-else :apoio="a" :empresa="empresa" :pode-configurar="podeConfigurar" />
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
