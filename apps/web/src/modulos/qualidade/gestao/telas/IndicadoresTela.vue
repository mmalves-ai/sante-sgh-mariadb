<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Indicadores (M48, etapa 5; ficha, seção 7; regra 9; manual
// "Indicadores da qualidade"). O painel da competência: os indicadores do censo diário e os da CCIH e da segurança do
// paciente, cada um com o valor, a conta com as parcelas, a meta e a situação; a análise crítica pendente fica
// destacada. A ficha técnica e a análise abrem no próprio painel. W0-04 (M2 e M3): os indicadores da segurança do
// paciente e das linhas de cuidado entram no mesmo catálogo, e a planilha das parcelas da competência se exporta.
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { baixarTexto } from '../../../internacao/formato.js';
import { exportarIndicadores, type IndicadorTela, lerIndicadores, lerResumoGestao } from '../api-gestao.js';
import ErroGestao from '../componentes/ErroGestao.vue';
import FichaIndicador from '../componentes/FichaIndicador.vue';
import NavGestao from '../componentes/NavGestao.vue';
import { classeDaMeta, competenciaBr, competenciasRecentes, valorDoIndicador } from '../regras-gestao.js';

const { t } = useI18n();
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const competencia = ref('');
const opCompetencias = computed(() =>
  resumo.data.value
    ? competenciasRecentes(resumo.data.value.agora.slice(0, 7)).map((c) => ({
        valor: c,
        rotulo: competenciaBr(c),
      }))
    : [],
);
watch(
  opCompetencias,
  (op) => {
    // A competência fechada mais recente (a anterior à atual) é a que se analisa.
    if (!competencia.value && op.length > 1) competencia.value = op[1]?.valor ?? '';
  },
  { immediate: true },
);
const lista = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'indicadores', competencia.value]),
  queryFn: () => lerIndicadores(competencia.value),
  enabled: computed(() => competencia.value !== ''),
});
const aberto = ref<string | null>(null);
const indicadorAberto = computed<IndicadorTela | null>(
  () => lista.data.value?.itens.find((i) => i.ficha.codigo === aberto.value) ?? null,
);
const aviso = ref<string | null>(null);
watch(competencia, () => {
  aberto.value = null;
});
const erroExportar = ref<unknown>(null);
const exportando = ref(false);
async function exportar(): Promise<void> {
  erroExportar.value = null;
  exportando.value = true;
  try {
    baixarTexto(
      await exportarIndicadores(competencia.value),
      `indicadores-qualidade-${competencia.value}.csv`,
    );
    aviso.value = t('gestaoQualidade.indicadores.exportado', {
      competencia: competenciaBr(competencia.value),
    });
  } catch (e) {
    erroExportar.value = e;
  } finally {
    exportando.value = false;
  }
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="indicadores-titulo" data-testid="tela-indicadores">
    <NavGestao />
    <h1 id="indicadores-titulo">{{ t('gestaoQualidade.indicadores.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.indicadores.explicacao') }}</p>
    <SanteAlerta
      v-if="lista.data.value && !lista.data.value.ligada"
      variante="info"
      :texto="lista.data.value.motivo ?? t('gestaoQualidade.desligado')"
      data-testid="gestao-desligada"
    />
    <ErroGestao v-if="resumo.isError.value" :erro="resumo.error.value" />
    <div class="linha-ccih">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('gestaoQualidade.competencia')"
        :opcoes="opCompetencias"
        data-testid="ind-competencia"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('gestaoQualidade.indicadores.exportar')"
        :desabilitado="exportando || !lista.data.value"
        data-testid="ind-exportar"
        @acionar="exportar"
      />
    </div>
    <ErroGestao v-if="erroExportar" :erro="erroExportar" />
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>

    <FichaIndicador
      v-if="indicadorAberto"
      :key="`${indicadorAberto.ficha.codigo}-${indicadorAberto.competencia}`"
      :indicador="indicadorAberto"
      :pode-analisar="lista.data.value?.podeAnalisar ?? false"
      @gravado="aviso = t('gestaoQualidade.indicadores.analise.gravada')"
      @fechar="aberto = null"
    />

    <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <table v-else class="tabela" data-testid="tabela-indicadores">
      <caption>
        {{
          `${t('gestaoQualidade.indicadores.legenda')} ${competenciaBr(lista.data.value.competencia)}`
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colIndicador') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colValor') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colConta') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colMeta') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colSituacao') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colAnalise') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="i in lista.data.value.itens"
          :key="i.ficha.codigo"
          :data-testid="`indicador-${i.ficha.codigo}`"
        >
          <td>
            <SanteBotao
              variante="texto"
              :rotulo="i.ficha.nome"
              :data-testid="`abrir-indicador-${i.ficha.codigo}`"
              @acionar="aberto = i.ficha.codigo"
            />
            <div class="secundario">{{ t(`gestaoQualidade.indicadores.origem.${i.ficha.origem}`) }}</div>
          </td>
          <td>
            {{ valorDoIndicador(i.valor, i.ficha.unidade) }}
            <div v-if="i.parcial" class="secundario">{{ t('gestaoQualidade.indicadores.parcial') }}</div>
          </td>
          <td>{{ i.conta ?? '—' }}</td>
          <td>
            {{
              i.meta === null
                ? t('gestaoQualidade.indicadores.semMeta')
                : valorDoIndicador(i.meta, i.ficha.unidade)
            }}
          </td>
          <td>
            <span :class="classeDaMeta(i.situacaoMeta)">{{
              t(`gestaoQualidade.indicadores.situacaoMeta.${i.situacaoMeta}`)
            }}</span>
          </td>
          <td>
            <span
              v-if="i.pendente"
              class="prazo prazo--vencido"
              :data-testid="`pendente-${i.ficha.codigo}`"
              >{{ t('gestaoQualidade.indicadores.pendente') }}</span
            >
            <span v-else-if="i.analise" class="prazo prazo--cumprido">{{
              t('gestaoQualidade.indicadores.analisada')
            }}</span>
            <span v-else class="secundario">{{ t('gestaoQualidade.indicadores.semAnalise') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
