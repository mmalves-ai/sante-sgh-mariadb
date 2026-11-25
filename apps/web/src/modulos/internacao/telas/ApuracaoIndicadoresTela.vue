<script setup lang="ts">
// Apuração dos indicadores obrigatórios de internação (01-REL L112): /relatorios/apuracao-indicadores, aberta pelos
// Indicadores hospitalares. Uma tela, dois passos: escolher a competência (conferida na hora pela regra do domínio:
// formato e mês que ainda não começou) e "Apurar" (relatorio.indicador.apurar), que grava a prévia em
// apuracao_indicador e já devolve a tabela com numerador, denominador, valor, meta e situação. Só agregados.
import { conferirCompetenciaApuracao } from '@sgh/dominio-relatorio';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  apurarIndicadoresInternacao,
  lerApuracoesInternacao,
  type ResultadoApuracao,
} from '../api-apuracao-indicadores.js';
import { formatarDataHora, formatarMes, formatarNumero, hojeNoEstabelecimento } from '../formato.js';
import { mensagensApuracaoIndicadores } from '../i18n-apuracao-indicadores.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensApuracaoIndicadores });
const cliente = useQueryClient();
const podeApurar = pode('relatorio.indicador.apurar');
const mesAtual = hojeNoEstabelecimento().slice(0, 7);
const [a, m] = mesAtual.split('-').map(Number) as [number, number];
const mesAnterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;

const competencia = ref(mesAnterior);
const vista = ref(mesAnterior);
const erroCompetencia = computed(
  () => conferirCompetenciaApuracao(competencia.value, mesAtual)[0]?.mensagem ?? '',
);

const lidas = useQuery({
  queryKey: computed(() => ['relatorio', 'apuracao-internacao', vista.value]),
  queryFn: () => lerApuracoesInternacao(vista.value),
});
const ver = () => {
  if (!erroCompetencia.value) vista.value = competencia.value;
};

const erro = ref<unknown>(null);
const apurando = ref(false);
const resultado = ref<ResultadoApuracao | null>(null);
async function apurar(): Promise<void> {
  if (erroCompetencia.value) return;
  erro.value = null;
  resultado.value = null;
  apurando.value = true;
  try {
    const r = await apurarIndicadoresInternacao(competencia.value);
    resultado.value = r;
    vista.value = r.competencia;
    cliente.setQueryData(['relatorio', 'apuracao-internacao', r.competencia], {
      competencia: r.competencia,
      apuracoes: r.apuracoes,
    });
  } catch (e) {
    erro.value = e;
  } finally {
    apurando.value = false;
  }
}

const rotuloMeta = (s: string) =>
  t(`situacoesMeta.${s}`) === `situacoesMeta.${s}` ? s : t(`situacoesMeta.${s}`);
const rotuloSituacao = (s: string) => (t(`situacoes.${s}`) === `situacoes.${s}` ? s : t(`situacoes.${s}`));
</script>

<template>
  <section class="tela" aria-labelledby="apuracao-titulo" data-testid="tela-apuracao-indicadores">
    <h1 id="apuracao-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <p>
      <RouterLink to="/relatorios/indicadores" data-testid="apuracao-voltar">{{ t('voltar') }}</RouterLink>
    </p>
    <form class="linha" @submit.prevent="ver">
      <label for="apuracao-competencia">{{ t('competencia') }}</label>
      <input
        id="apuracao-competencia"
        v-model="competencia"
        type="month"
        min="2020-01"
        :max="mesAtual"
        data-testid="apuracao-competencia"
        :aria-invalid="erroCompetencia ? 'true' : 'false'"
        aria-describedby="apuracao-competencia-erro"
      />
      <SanteBotao
        :rotulo="t('ver')"
        tipo="submit"
        :desabilitado="!!erroCompetencia"
        data-testid="apuracao-ver"
      />
      <SanteBotao
        v-if="podeApurar"
        :rotulo="apurando ? t('apurando') : t('apurar')"
        :desabilitado="apurando || !!erroCompetencia"
        data-testid="apuracao-apurar"
        @acionar="apurar"
      />
    </form>
    <p
      v-if="erroCompetencia"
      id="apuracao-competencia-erro"
      role="alert"
      data-testid="apuracao-competencia-erro"
    >
      {{ erroCompetencia }}
    </p>
    <SanteAlerta
      v-if="resultado"
      variante="info"
      data-testid="apuracao-resultado"
      :texto="
        t('resultado', {
          competencia: formatarMes(resultado.competencia),
          incluidas: resultado.incluidas,
          atualizadas: resultado.atualizadas,
          mantidas: resultado.mantidasFechadas,
          sem: resultado.semMudanca,
        })
      "
    />
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="lidas.isError.value" :erro="lidas.error.value" />
    <p v-else-if="lidas.isPending.value" role="status">{{ t('carregando') }}</p>
    <template v-else-if="lidas.data.value">
      <p v-if="lidas.data.value.apuracoes.length === 0" data-testid="apuracao-vazia">
        {{ t('nenhuma', { competencia: formatarMes(lidas.data.value.competencia) }) }}
      </p>
      <table v-else class="tabela" data-testid="tabela-apuracao">
        <caption>
          {{
            `${t('titulo')} · ${formatarMes(lidas.data.value.competencia)}`
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('indicador') }}</th>
            <th scope="col">{{ t('numerador') }}</th>
            <th scope="col">{{ t('denominador') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('meta') }}</th>
            <th scope="col">{{ t('situacaoMeta') }}</th>
            <th scope="col">{{ t('registro') }}</th>
            <th scope="col">{{ t('dadosAte') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ap in lidas.data.value.apuracoes"
            :key="ap.codigo"
            :data-testid="`apuracao-${ap.codigo}`"
          >
            <th scope="row">{{ ap.nome }}</th>
            <td>{{ formatarNumero(ap.numerador) }}</td>
            <td>{{ formatarNumero(ap.denominador) }}</td>
            <td :data-testid="`apuracao-${ap.codigo}-valor`">{{ formatarNumero(ap.valor) }}</td>
            <td>{{ formatarNumero(ap.valorMeta) }}</td>
            <td :data-testid="`apuracao-${ap.codigo}-meta`">{{ rotuloMeta(ap.situacaoMeta) }}</td>
            <td>{{ rotuloSituacao(ap.situacao) }}</td>
            <td>{{ formatarDataHora(ap.dadosAte) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
