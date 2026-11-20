<script setup lang="ts">
// Indicadores da classificação de risco (ficha do M44, regra 5): `/pa/classificacao/indicadores`. Porta →
// classificação, porta → médico, atendidos dentro do tempo-alvo por cor e reclassificações, cada número com o
// numerador e o denominador impressos, das marcas reais de chegada e de atendimento médico do quadro do PA (a saída
// nunca é copiada da entrada).
import { SanteBotao, SanteData } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerIndicadoresClassificacao } from '../api-classificacao.js';
import ErroClassificacao from '../componentes/ErroClassificacao.vue';
import MarcaRisco from '../componentes/MarcaRisco.vue';

const { t } = useI18n();
const inicio = ref<string | null>(null);
const fim = ref<string | null>(null);
const pedido = ref<{ inicio: string | null; fim: string | null }>({ inicio: null, fim: null });
const ind = useQuery({
  queryKey: computed(() => ['classificacao', 'indicadores', pedido.value.inicio, pedido.value.fim]),
  queryFn: () => lerIndicadoresClassificacao(pedido.value.inicio, pedido.value.fim),
});
const p = (v: number | null) =>
  v === null ? t('classificacao.indicadores.semPercentual') : `${String(v).replace('.', ',')}%`;
const min = (v: number | null) => (v === null ? t('classificacao.indicadores.semMediana') : String(v));
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="ind-class-titulo"
    data-testid="tela-indicadores-classificacao"
  >
    <h1 id="ind-class-titulo">{{ t('classificacao.indicadores.titulo') }}</h1>
    <p>{{ t('classificacao.indicadores.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/pa/classificacao">{{ t('classificacao.fila.titulo') }}</RouterLink>
    </p>
    <div class="acoes">
      <SanteData v-model="inicio" :rotulo="t('classificacao.indicadores.inicio')" />
      <SanteData v-model="fim" :rotulo="t('classificacao.indicadores.fim')" />
      <SanteBotao
        variante="secundario"
        :rotulo="t('classificacao.indicadores.consultar')"
        data-testid="ind-consultar"
        @acionar="pedido = { inicio, fim }"
      />
    </div>
    <ErroClassificacao v-if="ind.isError.value" :erro="ind.error.value" />
    <p v-else-if="!ind.data.value" role="status">{{ t('classificacao.carregando') }}</p>
    <template v-else>
      <ul class="lista-simples" data-testid="ind-resultado">
        <li>
          {{
            t('classificacao.indicadores.portaClassificacao', {
              min: min(ind.data.value.portaClassificacao.medianaMin),
              n: ind.data.value.portaClassificacao.comMarca,
              d: ind.data.value.portaClassificacao.atendimentos,
            })
          }}
        </li>
        <li>
          {{
            t('classificacao.indicadores.portaMedico', {
              min: min(ind.data.value.portaMedico.medianaMin),
              n: ind.data.value.portaMedico.comMarca,
              d: ind.data.value.portaMedico.atendimentos,
            })
          }}
        </li>
        <li>
          {{
            t('classificacao.indicadores.reclassificacoes', {
              n: ind.data.value.reclassificacoes.numerador,
              d: ind.data.value.reclassificacoes.denominador,
              p: p(ind.data.value.reclassificacoes.percentual),
            })
          }}
        </li>
      </ul>
      <h2>{{ t('classificacao.indicadores.dentroDoAlvo') }}</h2>
      <ul class="lista-simples">
        <li v-for="x in ind.data.value.dentroDoAlvo" :key="x.cor">
          <MarcaRisco :cor="x.cor" />
          {{
            t('classificacao.indicadores.linhaCor', {
              cor: t(`classificacao.cores.${x.cor}`),
              n: x.numerador,
              d: x.denominador,
              p: p(x.percentual),
            })
          }}
        </li>
      </ul>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
