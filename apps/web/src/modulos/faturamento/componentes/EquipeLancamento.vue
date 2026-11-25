<script setup lang="ts">
// Equipe do ato no lançamento manual (F3.7, 06-FAT linha 15): o item e a equipe saem no mesmo pedido
// (POST /api/faturamento/contas/:id/itens-com-equipe). As funções e os profissionais sugeridos vêm da leitura dos
// movimentos da conta; a busca acha outros pelo nome ou pela inscrição no conselho. A regra é a do domínio
// (validarEquipeItem), a mesma do servidor, para o erro aparecer enquanto se escolhe; o valor do ato sai do honorário
// que o servidor calcula ao lançar, por isso aqui aparece só o percentual da função.
import { type FuncaoEquipe, validarEquipeItem } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarProfissionais, lerMovimentos, type ParticipantePedido } from '../api-movimentos.js';
import ErroFaturamento from './ErroFaturamento.vue';

const props = defineProps<{ conta: number }>();
const participantes = defineModel<ParticipantePedido[]>({ required: true });
const emit = defineEmits<{ valida: [boolean] }>();
const { t } = useI18n();

const q = useQuery({
  queryKey: computed(() => ['faturamento', 'movimentos', props.conta]),
  queryFn: () => lerMovimentos(props.conta),
});
const erro = ref<unknown>(null);
const busca = ref('');
const encontrados = ref<{ id: number; nome: string; inscricao: string }[]>([]);
const semResultado = ref(false);
async function buscar() {
  if (busca.value.trim().length < 3) return;
  erro.value = null;
  try {
    const r = await buscarProfissionais(busca.value.trim());
    const ja = new Set(encontrados.value.map((p) => p.id));
    encontrados.value = [...encontrados.value, ...r.filter((p) => !ja.has(p.id))];
    semResultado.value = r.length === 0;
  } catch (e) {
    erro.value = e;
  }
}
const opcoesProfissional = computed(() => {
  const m = new Map<number, string>();
  for (const p of q.data.value?.profissionais ?? []) m.set(p.id, p.nome);
  for (const p of encontrados.value) m.set(p.id, p.inscricao ? `${p.nome} · ${p.inscricao}` : p.nome);
  return [
    { valor: 0, rotulo: t('movimentosConta.escolhaProfissional'), desabilitada: true },
    ...[...m].map(([id, nome]) => ({ valor: id, rotulo: nome })),
  ];
});
const funcoes = computed(() => (q.data.value?.funcoes ?? []).filter((f) => f.ativo));
const opcoesFuncao = computed(() => [
  { valor: 0, rotulo: t('movimentosConta.lancamentoEquipe.escolhaFuncao'), desabilitada: true },
  ...funcoes.value.map((f) => ({ valor: f.id, rotulo: f.descricao })),
]);
const funcoesMapa = computed(
  () =>
    new Map<number, FuncaoEquipe>(
      (q.data.value?.funcoes ?? []).map((f) => [
        f.id,
        {
          id: f.id,
          tipo: f.tipo as FuncaoEquipe['tipo'],
          ativo: f.ativo,
          percentual: f.percentual,
          grau: f.grau,
          ordemAuxiliar: f.ordemAuxiliar,
          ordemApresentacao: f.ordemApresentacao,
        },
      ]),
    ),
);
// Participante incompleto (sem profissional ou sem função) também trava o lançamento: nada sai pela metade.
const incompletos = computed(() =>
  participantes.value.map((p, k) => (p.profissionalId > 0 && p.funcaoId > 0 ? -1 : k)).filter((k) => k >= 0),
);
const erros = computed(() =>
  validarEquipeItem(
    participantes.value.map((p) => ({
      profissional: p.profissionalId,
      funcao: p.funcaoId,
      grau: p.grauId ?? null,
      percentual: p.percentual ?? null,
      formaPagamento: 'via_hospital' as const,
    })),
    funcoesMapa.value,
  ),
);
const erroDe = (k: number) =>
  incompletos.value.includes(k)
    ? t('movimentosConta.lancamentoEquipe.incompleto')
    : (erros.value[`participantes.${k}.profissional`] ??
      erros.value[`participantes.${k}.funcao`] ??
      erros.value[`participantes.${k}.percentual`] ??
      null);
const valida = computed(
  () =>
    participantes.value.length === 0 ||
    (incompletos.value.length === 0 && Object.keys(erros.value).length === 0),
);
watch(valida, (v) => emit('valida', v), { immediate: true });

const percentualDa = (funcaoId: number) => {
  const f = funcoesMapa.value.get(funcaoId);
  if (!f) return null;
  return f.percentual ?? (f.tipo === 'cirurgiao' ? 100 : null);
};
function incluir() {
  participantes.value = [
    ...participantes.value,
    { profissionalId: 0, funcaoId: 0, grauId: null, percentual: null, formaPagamento: 'via_hospital' },
  ];
}
function definirPercentual(k: number, v: string) {
  participantes.value = participantes.value.map((p, i) =>
    i === k ? { ...p, percentual: v.trim() === '' ? null : Number(v) } : p,
  );
}
function retirar(k: number) {
  participantes.value = participantes.value.filter((_, i) => i !== k);
}
</script>

<template>
  <fieldset class="filtros" data-testid="lan-equipe">
    <legend>{{ t('movimentosConta.lancamentoEquipe.titulo') }}</legend>
    <p class="secundario">{{ t('movimentosConta.lancamentoEquipe.texto') }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <template v-if="participantes.length">
      <span class="campo">
        <label for="lan-eq-busca">{{ t('movimentosConta.buscarProfissional') }}</label>
        <input
          id="lan-eq-busca"
          v-model="busca"
          type="search"
          minlength="3"
          data-testid="lan-eq-busca"
          @keydown.enter.prevent="buscar"
        />
      </span>
      <button type="button" data-testid="lan-eq-buscar" @click="buscar">
        {{ t('movimentosConta.buscar') }}
      </button>
      <p v-if="semResultado" role="status">{{ t('movimentosConta.nenhumProfissional') }}</p>
    </template>
    <div v-for="(p, k) in participantes" :key="k" class="filtros" :data-testid="`lan-eq-participante-${k}`">
      <span class="campo">
        <SanteSelecao
          v-model="p.profissionalId"
          :rotulo="t('movimentosConta.profissional')"
          :opcoes="opcoesProfissional"
          obrigatorio
          :data-testid="`lan-eq-profissional-${k}`"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="p.funcaoId"
          :rotulo="t('movimentosConta.funcao')"
          :opcoes="opcoesFuncao"
          obrigatorio
          :data-testid="`lan-eq-funcao-${k}`"
        />
      </span>
      <span class="campo">
        <label :for="`lan-eq-pct-${k}`">{{ t('movimentosConta.percentual') }}</label>
        <input
          :id="`lan-eq-pct-${k}`"
          :value="p.percentual ?? ''"
          type="number"
          min="0"
          max="100"
          step="0.01"
          size="6"
          :placeholder="
            percentualDa(p.funcaoId) === null
              ? t('movimentosConta.lancamentoEquipe.semPercentual')
              : t('movimentosConta.lancamentoEquipe.percentual', { pct: percentualDa(p.funcaoId) })
          "
          :data-testid="`lan-eq-percentual-${k}`"
          @input="definirPercentual(k, ($event.target as HTMLInputElement).value)"
        />
      </span>
      <span v-if="erroDe(k)" role="alert" :data-testid="`lan-eq-erro-${k}`">{{ erroDe(k) }}</span>
      <button type="button" :data-testid="`lan-eq-retirar-${k}`" @click="retirar(k)">
        {{ t('movimentosConta.retirar') }}
      </button>
    </div>
    <button type="button" :disabled="!q.data.value" data-testid="lan-eq-incluir" @click="incluir">
      {{ t('movimentosConta.incluir') }}
    </button>
  </fieldset>
</template>
