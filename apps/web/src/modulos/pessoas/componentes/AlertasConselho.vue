<script setup lang="ts">
// Painel dos alertas de conselho para o RH (M52.1; regra 3; ficha, seção 4): o retrato diário (só contagens, gravado
// pelo worker) e a lista da hora dos registros vencidos, a vencer na janela do parâmetro e sem validade conferida, do
// mais urgente ao menos urgente. Quem está com o conselho vencido não entra na escala (F2).
import { SITUACOES_HABILITACAO, type SituacaoHabilitacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { lerPainelConselho } from '../api-pessoas.js';
import { dataBr } from '../comum.js';
import ErroPessoas from './ErroPessoas.vue';

const props = defineProps<{ janelaDias: number }>();
const { t } = useI18n();
type Filtro = 'todas' | 'vencida' | 'aVencer' | 'semValidade';
const situacao = ref<Filtro>('todas');
const depois = ref<number[]>([]);
const painel = useQuery({
  queryKey: computed(() => ['pessoas', 'conselho', situacao.value, depois.value.at(-1) ?? null]),
  queryFn: () =>
    lerPainelConselho({
      situacao: situacao.value,
      limite: 20,
      ...(depois.value.length ? { depois: depois.value.at(-1)! } : {}),
    }),
});
const opcoes = computed(() => [
  { valor: 'todas' as Filtro, rotulo: t('pessoas.conselho.todas') },
  { valor: 'vencida' as Filtro, rotulo: SITUACOES_HABILITACAO.vencida },
  { valor: 'aVencer' as Filtro, rotulo: SITUACOES_HABILITACAO.aVencer },
  { valor: 'semValidade' as Filtro, rotulo: SITUACOES_HABILITACAO.semValidade },
]);
const variante = (s: SituacaoHabilitacao) =>
  s === 'vencida' ? 'alerta' : s === 'aVencer' ? 'aviso' : 'info';
function prazo(dias: number | null): string {
  if (dias === null) return '';
  return dias < 0
    ? t('pessoas.conselho.vencidoHa', { dias: -dias })
    : t('pessoas.conselho.diasParaVencer', { dias });
}
</script>

<template>
  <section class="bloco" aria-labelledby="pes-alertas-titulo" data-testid="alertas-conselho">
    <h2 id="pes-alertas-titulo">{{ t('pessoas.conselho.alertas') }}</h2>
    <p class="secundario">{{ t('pessoas.conselho.alertasAjuda', { dias: props.janelaDias }) }}</p>
    <p v-if="painel.data.value?.retrato" data-testid="retrato-conselho">
      {{
        t('pessoas.conselho.retrato', {
          dia: dataBr(painel.data.value.retrato.dia),
          vencidos: painel.data.value.retrato.vencidos,
          aVencer: painel.data.value.retrato.aVencer,
          semValidade: painel.data.value.retrato.semValidade,
          registros: painel.data.value.retrato.registros,
        })
      }}
    </p>
    <p v-else-if="painel.data.value" class="secundario">{{ t('pessoas.conselho.semRetrato') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('pessoas.conselho.situacaoFiltro')"
        :opcoes="opcoes"
        data-testid="alertas-situacao"
        @update:model-value="depois = []"
      />
    </div>
    <ErroPessoas v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('pessoas.carregando') }}</p>
    <p v-else-if="painel.data.value.itens.length === 0">{{ t('pessoas.conselho.nenhumAlerta') }}</p>
    <table v-else class="tabela" data-testid="tabela-alertas">
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.conselho.colaborador') }}</th>
          <th scope="col">{{ t('pessoas.conselho.conselhoNome') }}</th>
          <th scope="col">{{ t('pessoas.conselho.validade') }}</th>
          <th scope="col">{{ t('pessoas.conselho.situacaoFiltro') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in painel.data.value.itens" :key="a.registro" :data-testid="`alerta-${a.registro}`">
          <th scope="row">
            <RouterLink v-if="a.vinculo" :to="`/pessoas/colaboradores/${a.vinculo}`">{{ a.nome }}</RouterLink>
            <span v-else>{{ a.nome }}</span>
          </th>
          <td>{{ a.conselho ?? '' }}</td>
          <td>{{ dataBr(a.validade) }}</td>
          <td>
            <SanteAlerta
              :texto="`${SITUACOES_HABILITACAO[a.situacao]} ${prazo(a.diasParaVencer)}`.trim()"
              :variante="variante(a.situacao)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="painel.data.value" class="acoes">
      <SanteBotao
        v-if="depois.length"
        :rotulo="t('pessoas.colaboradores.paginaAnterior')"
        variante="texto"
        @acionar="depois = depois.slice(0, -1)"
      />
      <SanteBotao
        v-if="painel.data.value.depois !== null"
        :rotulo="t('pessoas.colaboradores.paginaSeguinte')"
        variante="texto"
        @acionar="depois = [...depois, painel.data.value!.depois!]"
      />
    </div>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
