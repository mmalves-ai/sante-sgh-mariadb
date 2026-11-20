<script setup lang="ts">
// O indicador aberto: a ficha técnica inteira (regra 9: nome, fórmula, numerador, denominador, fonte, periodicidade,
// meta, polaridade, responsável, referência e programas), o valor com a conta das parcelas, a análise crítica da
// competência (fora da meta, com as causas e o plano) e as análises anteriores. W0-04 (M2 e M3): a série mensal dos
// últimos seis meses, cada um com a conta das parcelas.
import { SanteBotao, SanteCampoTexto, SanteData } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  type IndicadorTela,
  lerHistoricoAnalises,
  lerSerieIndicador,
  novaChaveGestao,
  registrarAnalise,
} from '../api-gestao.js';
import { classeDaMeta, competenciaBr, montarAnalise, valorDoIndicador } from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ indicador: IndicadorTela; podeAnalisar: boolean }>();
const emit = defineEmits<{ gravado: []; fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const fi = computed(() => props.indicador.ficha);

const historico = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'analises', fi.value.codigo]),
  queryFn: () => lerHistoricoAnalises(fi.value.codigo),
});

const MESES_SERIE = 6;
const serie = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'serie', fi.value.codigo, props.indicador.competencia]),
  queryFn: () => lerSerieIndicador(fi.value.codigo, props.indicador.competencia, MESES_SERIE),
});

const a = props.indicador.analise;
const f = reactive({
  texto: a?.texto ?? '',
  causas: a?.causas ?? '',
  plano: a?.plano ?? '',
  responsavel: a?.responsavel ?? '',
  prazo: a?.prazo ?? (null as string | null),
});
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('analise');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarAnalise(props.indicador, f);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    await registrarAnalise(fi.value.codigo, m.entrada, chave);
    chave = novaChaveGestao('analise');
    await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
    emit('gravado');
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="ficha-indicador-titulo" data-testid="ficha-indicador">
    <h2 id="ficha-indicador-titulo">
      {{ t('gestaoQualidade.indicadores.ficha.titulo', { nome: fi.nome }) }}
    </h2>
    <div class="linha-ccih">
      <strong data-testid="ficha-valor">{{ valorDoIndicador(indicador.valor, fi.unidade) }}</strong>
      <span v-if="indicador.conta" data-testid="ficha-conta">{{ indicador.conta }}</span>
      <span :class="classeDaMeta(indicador.situacaoMeta)" data-testid="ficha-situacao">{{
        t(`gestaoQualidade.indicadores.situacaoMeta.${indicador.situacaoMeta}`)
      }}</span>
      <span v-if="indicador.parcial" class="selo selo--neutro">{{
        t('gestaoQualidade.indicadores.parcial')
      }}</span>
    </div>
    <dl class="ficha-gestao">
      <dt>{{ t('gestaoQualidade.indicadores.ficha.formula') }}</dt>
      <dd>{{ fi.formula }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.numerador') }}</dt>
      <dd>{{ fi.numerador }}</dd>
      <template v-if="fi.denominador">
        <dt>{{ t('gestaoQualidade.indicadores.ficha.denominador') }}</dt>
        <dd>{{ fi.denominador }}</dd>
      </template>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.fonte') }}</dt>
      <dd>{{ fi.fonte }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.origem') }}</dt>
      <dd>{{ t(`gestaoQualidade.indicadores.origem.${fi.origem}`) }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.periodicidade') }}</dt>
      <dd>{{ t('gestaoQualidade.indicadores.ficha.mensal') }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.colMeta') }}</dt>
      <dd>
        {{
          indicador.meta === null
            ? t('gestaoQualidade.indicadores.semMeta')
            : valorDoIndicador(indicador.meta, fi.unidade)
        }}
        <span class="secundario">{{ t('gestaoQualidade.indicadores.ficha.metaParametro') }}</span>
      </dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.polaridade') }}</dt>
      <dd>{{ t(`gestaoQualidade.indicadores.polaridade.${fi.polaridade}`) }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.responsavel') }}</dt>
      <dd>{{ fi.responsavel }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.referencia') }}</dt>
      <dd>{{ fi.referencia }}</dd>
      <dt>{{ t('gestaoQualidade.indicadores.ficha.programas') }}</dt>
      <dd>{{ fi.programas.map((p) => t(`gestaoQualidade.indicadores.programas.${p}`)).join(', ') }}</dd>
    </dl>

    <h3>{{ t('gestaoQualidade.indicadores.serie.titulo') }}</h3>
    <ErroGestao v-if="serie.isError.value" :erro="serie.error.value" />
    <p v-else-if="!serie.data.value" role="status">{{ t('gestaoQualidade.indicadores.serie.carregando') }}</p>
    <table v-else class="tabela" data-testid="serie-indicador">
      <caption>
        {{
          t('gestaoQualidade.indicadores.serie.legenda', {
            n: MESES_SERIE,
            competencia: competenciaBr(indicador.competencia),
          })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('gestaoQualidade.indicadores.serie.colCompetencia') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colValor') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colConta') }}</th>
          <th scope="col">{{ t('gestaoQualidade.indicadores.colSituacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in serie.data.value.itens" :key="p.competencia" :data-testid="`serie-${p.competencia}`">
          <th scope="row">{{ competenciaBr(p.competencia) }}</th>
          <td>
            {{ valorDoIndicador(p.valor, fi.unidade) }}
            <div v-if="p.parcial" class="secundario">{{ t('gestaoQualidade.indicadores.parcial') }}</div>
          </td>
          <td>{{ p.conta ?? '—' }}</td>
          <td>
            <span :class="classeDaMeta(p.situacaoMeta)">{{
              t(`gestaoQualidade.indicadores.situacaoMeta.${p.situacaoMeta}`)
            }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <form v-if="podeAnalisar" class="painel-ccih" data-testid="form-analise" @submit.prevent="gravar">
      <h3>
        {{
          t('gestaoQualidade.indicadores.analise.titulo', {
            competencia: competenciaBr(indicador.competencia),
          })
        }}
      </h3>
      <p class="secundario">{{ t('gestaoQualidade.indicadores.analise.valorNoRegistro') }}</p>
      <p
        v-if="indicador.situacaoMeta === 'fora-da-meta'"
        class="prazo prazo--vencido"
        data-testid="analise-fora"
      >
        {{ t('gestaoQualidade.indicadores.analise.foraDaMeta') }}
      </p>
      <SanteCampoTexto
        v-model="f.texto"
        :rotulo="t('gestaoQualidade.indicadores.analise.texto')"
        :max-bytes="4000"
        multilinha
        obrigatorio
        data-testid="analise-texto"
      />
      <SanteCampoTexto
        v-model="f.causas"
        :rotulo="t('gestaoQualidade.indicadores.analise.causas')"
        :max-bytes="2000"
        multilinha
        :obrigatorio="indicador.situacaoMeta === 'fora-da-meta'"
        data-testid="analise-causas"
      />
      <SanteCampoTexto
        v-model="f.plano"
        :rotulo="t('gestaoQualidade.indicadores.analise.plano')"
        :max-bytes="2000"
        multilinha
        :obrigatorio="indicador.situacaoMeta === 'fora-da-meta'"
        data-testid="analise-plano"
      />
      <div class="linha-ccih">
        <SanteCampoTexto
          v-model="f.responsavel"
          :rotulo="t('gestaoQualidade.indicadores.analise.responsavel')"
          :max-bytes="80"
          data-testid="analise-responsavel"
        />
        <SanteData
          v-model="f.prazo"
          :rotulo="t('gestaoQualidade.indicadores.analise.prazo')"
          editavel
          data-testid="analise-prazo"
        />
      </div>
      <ErrosFormulario :erros="erros" />
      <ErroGestao v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.gravar')"
          :desabilitado="gravando"
          data-testid="analise-gravar"
        />
        <SanteBotao :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="emit('fechar')" />
      </div>
    </form>
    <SanteBotao v-else :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="emit('fechar')" />

    <h3>{{ t('gestaoQualidade.indicadores.analise.historico') }}</h3>
    <ErroGestao v-if="historico.isError.value" :erro="historico.error.value" />
    <p v-else-if="historico.data.value && !historico.data.value.itens.length">
      {{ t('gestaoQualidade.indicadores.analise.nenhuma') }}
    </p>
    <ul v-else-if="historico.data.value" class="lista-ccih" data-testid="analise-historico">
      <li v-for="h in historico.data.value.itens" :key="h.id">
        <strong>{{ competenciaBr(h.competencia) }}</strong
        >: {{ t(`gestaoQualidade.indicadores.situacaoMeta.${h.situacaoMeta}`) }}. {{ h.texto }}
        <div class="secundario">
          {{
            t('gestaoQualidade.indicadores.analise.registrada', {
              usuario: h.atualizadaPor ?? h.registradaPor,
              data: dataHora(h.atualizadaEm ?? h.registradaEm),
              valor: valorDoIndicador(h.valor, fi.unidade),
              meta:
                h.meta === null
                  ? t('gestaoQualidade.indicadores.semMeta')
                  : valorDoIndicador(h.meta, fi.unidade),
            })
          }}
        </div>
      </li>
    </ul>
  </section>
</template>
