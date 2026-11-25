<script setup lang="ts">
// F3.8, 07-FIN linha 109: o tributo que o tomador reteve ao pagar a fatura do hospital, na ficha do título a receber.
// A sugestão vem da regra vigente no recebimento (valor da fatura, data e município do serviço) e é só o preenchimento
// inicial: base, alíquota e valor são editáveis (o tomador arredonda ou retém sobre outra base), e o tributo retido fora
// da regra (sem regra vigente, dispensado pelo mínimo) entra pela lista dos tributos ativos. Um clique registra todos,
// o saldo da parcela cai na hora e a baixa recebe o líquido em dinheiro. A conta é conferida antes do envio (linha a
// linha e a soma dentro do saldo). O estorno pede o motivo e não apaga nada.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
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
      sugestao: 'Retido neste recebimento',
      semRegra:
        'Nenhuma regra de retenção no recebimento vigente nesta data para os tributos que faltam. Se o tomador reteve mesmo assim, inclua o tributo abaixo.',
      dispensada: 'dispensada pela regra (igual ou abaixo do mínimo); se o tomador reteve, inclua abaixo',
      sugeridoDe: '{tributo}: {valor}',
      grupo: 'Retenção de {tributo}',
      pelaRegra: 'sugerido pela regra',
      foraDaRegra: 'incluído fora da regra',
      baseDe: 'Base de {tributo}',
      aliquotaDe: 'Alíquota de {tributo} (%)',
      retidoDe: 'Retido de {tributo}',
      linhaInvalida:
        'Confira: base maior que zero, alíquota entre 0 e 100 e retido maior que zero, até a base.',
      retirar: 'Retirar {tributo}',
      outro: 'Incluir outro tributo retido',
      escolha: 'Escolha o tributo',
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
const dec = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4, useGrouping: false });
const num = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.'));
/** Uma linha da retenção a registrar: tudo editável, em texto com vírgula. */
interface Linha {
  tributoId: number;
  sigla: string;
  base: string;
  aliquota: string;
  valor: string;
  sugerida: boolean;
  /** O valor foi digitado: mexer na base ou na alíquota não o recalcula mais. */
  manual: boolean;
}
const linhas = ref<Linha[]>([]);
const aplicaveis = computed(() => (dados.data.value?.sugestoes ?? []).filter((s) => !s.dispensada));
const jaRetidos = computed(() => new Set((dados.data.value?.retencoes ?? []).map((r) => r.tributoId)));
/** Monta as linhas: a sugestão como preenchimento inicial, mantendo o que já foi editado e o incluído fora da regra. */
function montar(): void {
  const antes = linhas.value;
  const sugeridas = aplicaveis.value.map(
    (s) =>
      antes.find((l) => l.sugerida && l.tributoId === s.tributoId) ?? {
        tributoId: s.tributoId,
        sigla: s.tributo,
        base: brl(s.base),
        aliquota: dec(s.aliquota),
        valor: brl(s.valor),
        sugerida: true,
        manual: false,
      },
  );
  const ids = new Set(sugeridas.map((l) => l.tributoId));
  linhas.value = [
    ...sugeridas,
    ...antes.filter((l) => !l.sugerida && !ids.has(l.tributoId) && !jaRetidos.value.has(l.tributoId)),
  ];
}
watch(aplicaveis, montar, { immediate: true });
function recalcular(l: Linha): void {
  if (l.manual) return;
  const b = num(l.base);
  const a = num(l.aliquota);
  if (b > 0 && a > 0) l.valor = brl(Math.round(b * a) / 100);
}
/** Tributos que ainda podem entrar: os ativos que não estão na parcela nem na lista. */
const outro = ref<number | null>(null);
const opcoesOutro = computed(() => [
  { valor: null, rotulo: t('escolha') },
  ...(dados.data.value?.tributos ?? [])
    .filter((x) => !jaRetidos.value.has(x.id) && !linhas.value.some((l) => l.tributoId === x.id))
    .map((x) => ({ valor: x.id, rotulo: `${x.sigla} - ${x.descricao}` })),
]);
watch(outro, (id) => {
  if (id === null) return;
  const x = (dados.data.value?.tributos ?? []).find((y) => y.id === id);
  if (x && !linhas.value.some((l) => l.tributoId === id))
    linhas.value.push({
      tributoId: x.id,
      sigla: x.sigla,
      base: brl(dados.data.value?.valorFatura ?? 0),
      aliquota: '',
      valor: '',
      sugerida: false,
      manual: false,
    });
  outro.value = null;
});
const retirar = (id: number) => (linhas.value = linhas.value.filter((l) => l.tributoId !== id));
const linhaValida = (l: Linha) => {
  const [b, a, v] = [num(l.base), num(l.aliquota), num(l.valor)];
  return b > 0 && a > 0 && a <= 100 && v > 0 && v <= b;
};
/** A sugerida com o retido zerado fica de fora (o tomador não reteve); a incluída à mão tem de estar completa. */
const ignorada = (l: Linha) => l.sugerida && !(num(l.valor) > 0);
const comErro = (l: Linha) => !ignorada(l) && !linhaValida(l);
const itens = computed(() =>
  linhas.value
    .filter((l) => !ignorada(l))
    .map((l) => ({
      tributo: l.tributoId,
      base: num(l.base),
      aliquota: num(l.aliquota),
      valor: num(l.valor),
    })),
);
const total = computed(
  () => Math.round(itens.value.reduce((s, i) => s + (Number.isFinite(i.valor) ? i.valor : 0), 0) * 100) / 100,
);
const saldo = computed(() => dados.data.value?.saldoParcela ?? 0);
const passa = computed(() => total.value > saldo.value);
const invalido = computed(() => linhas.value.some(comErro));
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
    linhas.value = [];
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
    const novo = await dados.refetch();
    montar();
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
        <template v-for="s in dados.data.value.sugestoes" :key="`d-${s.tributoId}`">
          <small v-if="s.dispensada" class="secundario" :data-testid="`rs-dispensada-${s.tributo}`">
            {{ t('sugeridoDe', { tributo: s.tributo, valor: brl(s.valor) }) }}: {{ t('dispensada') }}
          </small>
        </template>
        <div
          v-for="l in linhas"
          :key="l.tributoId"
          role="group"
          :aria-label="t('grupo', { tributo: l.sigla })"
          :data-testid="`rs-linha-${l.sigla}`"
        >
          <small class="secundario">
            {{ l.sigla }}: {{ l.sugerida ? t('pelaRegra') : t('foraDaRegra') }}
          </small>
          <span class="campo">
            <label :for="`rs-base-${l.tributoId}`">{{ t('baseDe', { tributo: l.sigla }) }}</label>
            <input
              :id="`rs-base-${l.tributoId}`"
              v-model="l.base"
              inputmode="decimal"
              :data-testid="`rs-base-${l.sigla}`"
              @input="recalcular(l)"
            />
          </span>
          <span class="campo">
            <label :for="`rs-aliquota-${l.tributoId}`">{{ t('aliquotaDe', { tributo: l.sigla }) }}</label>
            <input
              :id="`rs-aliquota-${l.tributoId}`"
              v-model="l.aliquota"
              inputmode="decimal"
              :data-testid="`rs-aliquota-${l.sigla}`"
              @input="recalcular(l)"
            />
          </span>
          <span class="campo">
            <label :for="`rs-valor-${l.tributoId}`">{{ t('retidoDe', { tributo: l.sigla }) }}</label>
            <input
              :id="`rs-valor-${l.tributoId}`"
              v-model="l.valor"
              inputmode="decimal"
              :data-testid="`rs-valor-${l.sigla}`"
              @input="l.manual = true"
            />
          </span>
          <small v-if="comErro(l)" class="secundario" role="alert" :data-testid="`rs-erro-${l.sigla}`">
            {{ t('linhaInvalida') }}
          </small>
          <button
            v-if="!l.sugerida"
            type="button"
            :data-testid="`rs-retirar-${l.sigla}`"
            @click="retirar(l.tributoId)"
          >
            {{ t('retirar', { tributo: l.sigla }) }}
          </button>
        </div>
        <span v-if="pode && opcoesOutro.length > 1" class="campo">
          <SanteSelecao
            v-model="outro"
            :rotulo="t('outro')"
            :opcoes="opcoesOutro"
            data-testid="rs-outro-tributo"
          />
        </span>
        <template v-if="linhas.length">
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
