<script setup lang="ts">
// Faturas e nota fiscal (F3.7, 06-FAT linha 36): `/faturamento/faturas`. A lista das faturas ao pagador do
// estabelecimento com a documentação fiscal de cada uma (valor a documentar, documentado pelas notas, o que falta e a
// situação), filtrada pela competência e pela situação da documentação; cada linha abre a tela da nota fiscal da
// fatura num clique. A situação e os valores vêm da mesma regra do domínio da tela da fatura (a nota cancelada não
// conta).
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { listarFaturasDocumentacao, type SituacaoDocumentacao } from '../api-nota-vinculo.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Faturas e nota fiscal',
      texto:
        'Faturas ao pagador com quanto as notas fiscais de serviço já documentam. Abra a fatura para ligar a nota.',
      competencia: 'Competência',
      documentacao: 'Documentação',
      todas: 'Todas',
      filtrar: 'Filtrar',
      fatura: 'Fatura',
      fonte: 'Fonte pagadora',
      situacao: 'Situação da fatura',
      valor: 'Valor a documentar',
      documentado: 'Documentado',
      falta: 'Falta',
      notas: 'Notas',
      abrir: 'Nota fiscal',
      vazio: 'Nenhuma fatura no filtro.',
      sem_nota: 'Sem nota',
      parcial: 'Documentada em parte',
      documentada: 'Documentada',
    },
  },
});

const competencia = ref('');
const documentacao = ref<SituacaoDocumentacao | ''>('');
const filtro = ref<{ competencia: string; documentacao: SituacaoDocumentacao | '' }>({
  competencia: '',
  documentacao: '',
});
const opcoesDocumentacao = computed(() => [
  { valor: '', rotulo: t('todas') },
  ...(['sem_nota', 'parcial', 'documentada'] as const).map((s) => ({ valor: s, rotulo: t(s) })),
]);
const consulta = useQuery({
  queryKey: ['faturamento', 'faturas-nota', filtro],
  queryFn: () => listarFaturasDocumentacao(filtro.value),
});
const faturas = computed(() => consulta.data.value ?? []);
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mes = (c: string | null) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '—');
function filtrar() {
  filtro.value = { competencia: competencia.value, documentacao: documentacao.value };
}
</script>

<template>
  <section class="tela" aria-labelledby="fnf-titulo" data-testid="faturas-nota">
    <h1 id="fnf-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <form class="filtros" @submit.prevent="filtrar">
      <span class="campo">
        <label for="fnf-competencia">{{ t('competencia') }}</label>
        <input
          id="fnf-competencia"
          v-model="competencia"
          type="month"
          data-testid="fnf-competencia"
          @change="filtrar"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="documentacao"
          :rotulo="t('documentacao')"
          :opcoes="opcoesDocumentacao"
          data-testid="fnf-documentacao"
          @update:model-value="filtrar"
        />
      </span>
      <button type="submit" data-testid="fnf-filtrar">{{ t('filtrar') }}</button>
    </form>
    <ErroFaturamento v-if="consulta.error.value" :erro="consulta.error.value" />
    <table v-else-if="faturas.length" class="tabela" data-testid="fnf-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('fatura') }}</th>
          <th scope="col">{{ t('competencia') }}</th>
          <th scope="col">{{ t('fonte') }}</th>
          <th scope="col">{{ t('situacao') }}</th>
          <th scope="col">{{ t('valor') }}</th>
          <th scope="col">{{ t('documentado') }}</th>
          <th scope="col">{{ t('falta') }}</th>
          <th scope="col">{{ t('notas') }}</th>
          <th scope="col">{{ t('documentacao') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in faturas" :key="f.id" :data-testid="`fnf-linha-${f.id}`">
          <td>{{ f.numero }}</td>
          <td>{{ mes(f.competencia) }}</td>
          <td>{{ f.fontePagadora ?? '—' }}</td>
          <td>{{ f.situacao }}</td>
          <td>{{ dinheiro(f.valorDocumentavel) }}</td>
          <td>{{ dinheiro(f.valorDocumentado) }}</td>
          <td :data-testid="`fnf-falta-${f.id}`">{{ dinheiro(f.saldo) }}</td>
          <td>{{ f.notasLigadas }}</td>
          <td :data-testid="`fnf-documentacao-${f.id}`">{{ t(f.documentacao) }}</td>
          <td>
            <RouterLink
              :to="`/faturamento/faturas/${f.id}/notas-fiscais`"
              :data-testid="`fnf-abrir-${f.id}`"
              >{{ t('abrir') }}</RouterLink
            >
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!consulta.isLoading.value" data-testid="fnf-vazio">{{ t('vazio') }}</p>
  </section>
</template>
