<script setup lang="ts">
// F3.8, 07-FIN linha 109: as regras de retenção na fonte com vigência (o lançamento do título recebe a sugestão da regra
// vigente, não um valor digitado) e o recolhimento do retido da competência: um clique por tributo gera o título a
// pagar da guia, com o código de receita e o vencimento no mês seguinte, e liga as retenções a ele.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  gerarRecolhimento,
  gravarRegraRetencao,
  lerRegrasRetencao,
  lerRetidoEmAberto,
} from '../api-contabil-fiscal.js';

const props = defineProps<{ competencia: string; podeEditar: boolean; podeRecolher: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      regras: 'Regras de retenção na fonte',
      tributo: 'Tributo',
      aliquota: 'Alíquota (%)',
      base: 'Base (% do valor)',
      minimo: 'Mínimo para reter',
      vigencia: 'Vigência',
      participante: 'Participante',
      encerrar: 'Encerrar vigência hoje',
      emAberto: 'Retido em aberto na competência',
      receita: 'Código de receita',
      credor: 'Órgão arrecadador (código do credor)',
      natureza: 'Natureza (código interno)',
      gerar: 'Gerar título do recolhimento',
      nada: 'Nenhuma retenção em aberto.',
      ate: 'até',
    },
  },
});
const qc = useQueryClient();
const regras = useQuery({ queryKey: ['financeiro', 'regras-retencao'], queryFn: () => lerRegrasRetencao() });
const aberto = useQuery({
  queryKey: computed(() => ['financeiro', 'retido-aberto', props.competencia]),
  queryFn: () => lerRetidoEmAberto(props.competencia),
  enabled: computed(() => /^\d{4}-\d{2}$/.test(props.competencia)),
});
const erro = ref<unknown>(null);
const ok = ref('');
const credor = ref<number | null>(null);
const natureza = ref<number | null>(null);
const receitas = ref<Record<number, string>>({});
const hoje = () => new Date().toISOString().slice(0, 10);

async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  ok.value = '';
  try {
    ok.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'regras-retencao'] });
    await qc.invalidateQueries({ queryKey: ['financeiro', 'retido-aberto'] });
  } catch (e) {
    erro.value = e;
  }
}
const encerrar = (id: number) =>
  agir(() => gravarRegraRetencao({ acao: 'encerrar', id, vigenciaFim: hoje() }, novaChave('regra')));
const recolher = (tributo: number, receita: string | null) =>
  agir(() =>
    gerarRecolhimento(
      {
        competencia: props.competencia,
        tributo,
        credor: credor.value,
        natureza: natureza.value,
        codigoReceita: receitas.value[tributo]?.trim() || receita,
      },
      novaChave('recolhimento'),
    ),
  );
</script>

<template>
  <section aria-labelledby="rt-titulo" data-testid="rt-painel">
    <h2 id="rt-titulo">{{ t('regras') }}</h2>
    <ErroFaturamento v-if="erro || regras.error.value" :erro="erro ?? regras.error.value" />
    <p v-if="ok" role="status" class="secundario" data-testid="rt-ok">{{ ok }}</p>
    <table class="tabela" data-testid="rt-regras">
      <thead>
        <tr>
          <th scope="col">{{ t('tributo') }}</th>
          <th scope="col">{{ t('participante') }}</th>
          <th scope="col">{{ t('base') }}</th>
          <th scope="col">{{ t('aliquota') }}</th>
          <th scope="col">{{ t('minimo') }}</th>
          <th scope="col">{{ t('vigencia') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('encerrar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras.data.value" :key="r.id">
          <th scope="row">{{ `${r.tributo} - ${r.descricao}` }}</th>
          <td>{{ r.participante }}</td>
          <td>{{ r.percentualBase }}</td>
          <td>{{ r.aliquota }}</td>
          <td>{{ r.minimo.toFixed(2) }}</td>
          <td>
            {{ r.vigenciaInicio }}
            <template v-if="r.vigenciaFim">{{ t('ate') }} {{ r.vigenciaFim }}</template>
          </td>
          <td>
            <button v-if="podeEditar && !r.vigenciaFim" type="button" @click="encerrar(r.id)">
              {{ t('encerrar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <h2>{{ t('emAberto') }} {{ competencia }}</h2>
    <p v-if="!aberto.data.value?.length">{{ t('nada') }}</p>
    <template v-else>
      <span class="campo">
        <label for="rt-credor">{{ t('credor') }}</label>
        <input id="rt-credor" v-model.number="credor" type="number" min="1" data-testid="rt-credor" />
      </span>
      <span class="campo">
        <label for="rt-natureza">{{ t('natureza') }}</label>
        <input id="rt-natureza" v-model.number="natureza" type="number" min="1" data-testid="rt-natureza" />
      </span>
      <table class="tabela" data-testid="rt-aberto">
        <tbody>
          <tr v-for="a in aberto.data.value" :key="a.tributo">
            <th scope="row">{{ a.sigla }}</th>
            <td>{{ a.retencoes }}</td>
            <td>{{ a.valor.toFixed(2) }}</td>
            <td>
              <input
                v-model="receitas[a.tributo]"
                :placeholder="a.codigoReceita ?? ''"
                :aria-label="`${t('receita')} ${a.sigla}`"
                maxlength="10"
              />
            </td>
            <td>
              <button
                type="button"
                :disabled="!podeRecolher || !credor"
                :data-testid="`rt-gerar-${a.sigla}`"
                @click="recolher(a.tributo, a.codigoReceita)"
              >
                {{ t('gerar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
