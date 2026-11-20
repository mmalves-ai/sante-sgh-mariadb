<script setup lang="ts">
// Aba "Custo de pessoal" (M53.9, etapa F8; `pessoas.integracao.ler`; ficha do M53, regra 11): o custo de pessoal por
// centro de custo (proventos mais encargos da empresa) dos lançamentos do período, somado dos fatos contábeis, com a conta
// impressa (cada centro é uma parcela do total). A controladoria recebe o mesmo custo pela fila de eventos.
import type { ApoioIntegracaoFolha } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { competenciasAte, reais, rotuloCompetencia } from '../comum-folha.js';
import { anosAte, periodoSugerido } from '../fechamento/comum-fechamento.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerCusto } from './api-integracao.js';

const props = defineProps<{ apoio: ApoioIntegracaoFolha; empresa: number }>();
const { t } = useI18n();

const periodo = ref<string>(periodoSugerido('mensal', props.apoio.hoje));
const opcoes = [
  ...competenciasAte(props.apoio.hoje, 24).map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) })),
  ...anosAte(props.apoio.hoje).map((a) => ({
    valor: a,
    rotulo: t('folha.integracao.rotuloAnual', { ano: a }),
  })),
];
const custo = useQuery({
  queryKey: computed(() => ['folha', 'integracao', 'custo', props.empresa, periodo.value]),
  queryFn: () => lerCusto(props.empresa, periodo.value),
});
const c = computed(() => custo.data.value ?? null);
const conta = computed(() =>
  c.value && c.value.centros.length
    ? t('folha.integracao.custo.conta', {
        parcelas: c.value.centros.map((x) => reais(x.total)).join(' + '),
        total: reais(c.value.total),
      })
    : '',
);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.integracao.abas.custo')" data-testid="integracao-custo">
    <h2>{{ t('folha.integracao.abas.custo') }}</h2>
    <p class="secundario">{{ t('folha.integracao.custo.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="periodo"
        :rotulo="t('folha.integracao.custo.periodo')"
        :opcoes="opcoes"
        busca
        data-testid="integracao-custo-periodo"
      />
    </div>
    <ErroFolha v-if="custo.isError.value" :erro="custo.error.value" />
    <p v-else-if="!c" role="status">{{ t('folha.integracao.carregando') }}</p>
    <p v-else-if="c.centros.length === 0" data-testid="integracao-custo-vazio">
      {{ t('folha.integracao.custo.nenhum') }}
    </p>
    <template v-else>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.integracao.abas.custo')">
        <table class="tabela" data-testid="integracao-custo-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.integracao.custo.centro') }}</th>
              <th scope="col">{{ t('folha.integracao.custo.proventos') }}</th>
              <th scope="col">{{ t('folha.integracao.custo.encargos') }}</th>
              <th scope="col">{{ t('folha.integracao.custo.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in c.centros"
              :key="x.centroCusto"
              :data-testid="`integracao-custo-centro-${x.centroCusto}`"
            >
              <th scope="row">{{ x.centroCusto }}</th>
              <td>{{ reais(x.proventos) }}</td>
              <td>{{ reais(x.encargos) }}</td>
              <td>{{ reais(x.total) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{{ t('folha.integracao.custo.totalGeral') }}</th>
              <td></td>
              <td></td>
              <td data-testid="integracao-custo-total">{{ reais(c.total) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p data-testid="integracao-custo-conta">{{ conta }}</p>
      <p class="secundario">{{ t('folha.integracao.custo.lancamentos', { n: c.lancamentos }) }}</p>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
