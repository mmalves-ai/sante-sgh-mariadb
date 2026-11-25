<script setup lang="ts">
// F3.8, 07-FIN linha 109: o tributo que o tomador reteve ao pagar a fatura do hospital, na ficha do título a receber.
// A sugestão vem da regra vigente no recebimento (valor da fatura e data), com o valor editável (o tomador arredonda);
// um clique registra todos os tributos sugeridos, o saldo da parcela cai na hora e a baixa recebe o líquido em
// dinheiro. A conta é conferida antes do envio (soma dentro do saldo). O estorno pede o motivo e não apaga nada.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  estornarRetencaoSofrida,
  lerRetencaoSofrida,
  registrarRetencaoSofrida,
} from '../api-retencao-sofrida.js';

const props = defineProps<{ titulo: number; data: string; pode: boolean }>();
const emit = defineEmits<{ saldo: [number] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Tributos retidos pelo tomador',
      explicacao:
        'O convênio ou órgão pagador desconta o tributo da fatura e recolhe em nome do hospital. O retido quita a parcela junto com o dinheiro e fica como crédito a compensar.',
      tributo: 'Tributo',
      base: 'Base',
      aliquota: 'Alíquota (%)',
      valor: 'Retido',
      data: 'Data',
      situacao: 'Situação',
      compensada: 'compensada',
      aCompensar: 'a compensar',
      nenhuma: 'Nenhuma retenção registrada neste título.',
      sugestao: 'Sugestão pela regra vigente no recebimento',
      semRegra: 'Nenhuma regra de retenção no recebimento vigente nesta data para os tributos que faltam.',
      dispensada: 'dispensada (igual ou abaixo do mínimo)',
      retidoDe: 'Retido de {tributo} ({base} × {aliquota}%)',
      registrar: 'Registrar retenção do tomador',
      total: 'Total retido agora: {total}. Líquido a receber em dinheiro: {liquido}.',
      passa: 'A soma do retido passa do saldo em aberto da parcela ({saldo}).',
      estornar: 'Estornar',
      motivo: 'Motivo do estorno de {tributo}',
      confirmar: 'Confirmar estorno',
      motivoCurto: 'Diga o motivo (5 letras ou mais).',
    },
  },
});
const qc = useQueryClient();
const dia = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(props.data) ? props.data : ''));
const dados = useQuery({
  queryKey: computed(() => ['financeiro', 'retencao-sofrida', props.titulo, dia.value]),
  queryFn: () => lerRetencaoSofrida(props.titulo, dia.value),
  enabled: computed(() => props.titulo > 0 && !!dia.value),
});
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.'));
/** O valor de cada tributo sugerido, editável (texto com vírgula). */
const valores = reactive<Record<number, string>>({});
const aplicaveis = computed(() => (dados.data.value?.sugestoes ?? []).filter((s) => !s.dispensada));
watch(
  aplicaveis,
  (lista) => {
    for (const s of lista) if (valores[s.tributoId] === undefined) valores[s.tributoId] = brl(s.valor);
  },
  { immediate: true },
);
const itens = computed(() =>
  aplicaveis.value
    .map((s) => ({
      tributo: s.tributoId,
      base: s.base,
      aliquota: s.aliquota,
      valor: num(valores[s.tributoId] ?? ''),
    }))
    .filter((i) => i.valor > 0),
);
const total = computed(() => Math.round(itens.value.reduce((s, i) => s + i.valor, 0) * 100) / 100);
const saldo = computed(() => dados.data.value?.saldoParcela ?? 0);
const passa = computed(() => total.value > saldo.value);
const invalido = computed(() => itens.value.some((i) => !(i.valor > 0) || i.valor > i.base));
const pronto = computed(() => itens.value.length > 0 && !passa.value && !invalido.value);
const erro = ref<unknown>(null);
const ok = ref('');
const gravando = ref(false);
const estornando = ref<number | null>(null);
const motivo = ref('');

async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  ok.value = '';
  gravando.value = true;
  try {
    ok.value = (await fn()).mensagem;
    for (const k of Object.keys(valores)) delete valores[Number(k)];
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
    const novo = await dados.refetch();
    if (novo.data) emit('saldo', novo.data.saldoParcela);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const registrar = () =>
  agir(() =>
    registrarRetencaoSofrida(
      { titulo: props.titulo, versao: dados.data.value?.versao ?? null, data: dia.value, itens: itens.value },
      novaChave('retencao-sofrida'),
    ),
  );
const estornar = (retencao: number) =>
  agir(async () => {
    const r = await estornarRetencaoSofrida(
      { titulo: props.titulo, retencao, motivo: motivo.value.trim() },
      novaChave('estorno-retencao-sofrida'),
    );
    estornando.value = null;
    motivo.value = '';
    return r;
  });
</script>

<template>
  <section aria-labelledby="rs-titulo" data-testid="rs-bloco">
    <h2 id="rs-titulo">{{ t('titulo') }}</h2>
    <p class="secundario">{{ t('explicacao') }}</p>
    <ErroFaturamento v-if="erro || dados.error.value" :erro="erro ?? dados.error.value" />
    <p v-if="ok" role="status" class="secundario" data-testid="rs-ok">{{ ok }}</p>
    <template v-if="dados.data.value">
      <p v-if="!dados.data.value.retencoes.length" class="secundario" data-testid="rs-nenhuma">
        {{ t('nenhuma') }}
      </p>
      <table v-else class="tabela" data-testid="rs-registradas">
        <thead>
          <tr>
            <th scope="col">{{ t('tributo') }}</th>
            <th scope="col">{{ t('base') }}</th>
            <th scope="col">{{ t('aliquota') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('data') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in dados.data.value.retencoes" :key="r.id">
            <th scope="row">{{ r.tributo }}</th>
            <td>{{ brl(r.base) }}</td>
            <td>{{ r.aliquota }}</td>
            <td>{{ brl(r.valor) }}</td>
            <td>{{ r.data }}</td>
            <td>
              <template v-if="r.compensada">{{ t('compensada') }}</template>
              <template v-else>
                {{ t('aCompensar') }}
                <button
                  v-if="pode && estornando !== r.id"
                  type="button"
                  :data-testid="`rs-estornar-${r.tributo}`"
                  @click="((estornando = r.id), (motivo = ''))"
                >
                  {{ t('estornar') }}
                </button>
                <span v-if="estornando === r.id" class="campo">
                  <label :for="`rs-motivo-${r.id}`">{{ t('motivo', { tributo: r.tributo }) }}</label>
                  <input :id="`rs-motivo-${r.id}`" v-model="motivo" maxlength="300" data-testid="rs-motivo" />
                  <small v-if="motivo.trim().length < 5" class="secundario">{{ t('motivoCurto') }}</small>
                  <button
                    type="button"
                    :disabled="gravando || motivo.trim().length < 5"
                    data-testid="rs-confirmar-estorno"
                    @click="estornar(r.id)"
                  >
                    {{ t('confirmar') }}
                  </button>
                </span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="dados.data.value.emAberto"
        class="formulario"
        data-testid="rs-sugestao"
        @submit.prevent="pronto && registrar()"
      >
        <h3>{{ t('sugestao') }}</h3>
        <small
          v-if="!dados.data.value.sugestoes.length"
          class="secundario"
          role="status"
          data-testid="rs-sem-regra"
        >
          {{ t('semRegra') }}
        </small>
        <span v-for="s in dados.data.value.sugestoes" :key="s.tributoId" class="campo">
          <label :for="`rs-valor-${s.tributoId}`">
            {{ t('retidoDe', { tributo: s.tributo, base: brl(s.base), aliquota: s.aliquota }) }}
          </label>
          <small v-if="s.dispensada" class="secundario">{{ brl(s.valor) }}: {{ t('dispensada') }}</small>
          <input
            v-else
            :id="`rs-valor-${s.tributoId}`"
            v-model="valores[s.tributoId]"
            inputmode="decimal"
            :data-testid="`rs-valor-${s.tributo}`"
          />
        </span>
        <template v-if="aplicaveis.length">
          <small v-if="passa" class="secundario" role="alert" data-testid="rs-passa">
            {{ t('passa', { saldo: brl(saldo) }) }}
          </small>
          <small v-else class="secundario" role="status" data-testid="rs-total">
            {{ t('total', { total: brl(total), liquido: brl(Math.max(0, saldo - total)) }) }}
          </small>
          <button type="submit" :disabled="gravando || !pode || !pronto" data-testid="rs-registrar">
            {{ t('registrar') }}
          </button>
        </template>
      </form>
    </template>
  </section>
</template>
