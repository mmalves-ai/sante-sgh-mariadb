<script setup lang="ts">
// Equipe realizada do ato cirúrgico (F3.4, 04-CC linha 95): a equipe membro a membro (troca no meio do ato e tempos
// por procedimento) e, para quem lança na conta, levar a equipe de cada procedimento ao item escolhido da mesma
// internação, numa gravação só. O repasse lê o participante do item da conta.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { type EquipeLevada, lerEquipeRealizada, levarEquipeParaConta } from '../api-equipe-realizada.js';
import ErroCirurgia from './ErroCirurgia.vue';

const props = defineProps<{ ato: number }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeLevar = computed(() => permissoes.value.has('faturamento.item.lancar'));

const chave = computed(() => ['cirurgia', 'equipe-realizada', props.ato]);
const equipe = useQuery({ queryKey: chave, queryFn: () => lerEquipeRealizada(props.ato) });

// O instante vem como a hora de parede do hospital em ISO: mostra HH:MM sem converter fuso.
const hora = (v: string | null) => (v ? v.slice(11, 16) : '—');
const escolhas = ref<Record<number, string>>({});
watch(
  () => equipe.data.value?.procedimentos,
  (procs) => {
    escolhas.value = Object.fromEntries((procs ?? []).map((p) => [p.id, '']));
  },
  { immediate: true },
);
const opcoesItem = computed(() => [
  { valor: '', rotulo: t('cirurgia.equipeRealizada.naoLevar') },
  ...(equipe.data.value?.itensConta ?? []).map((i) => ({
    valor: String(i.id),
    rotulo: t('cirurgia.equipeRealizada.itemRotulo', { conta: i.conta, descricao: i.descricao }),
  })),
]);
const pares = computed(() =>
  Object.entries(escolhas.value)
    .filter(([, item]) => item !== '')
    .map(([procedimento, item]) => ({ procedimento: Number(procedimento), item: Number(item) })),
);

const ocupado = ref(false);
const erro = ref<unknown>(null);
const resultado = ref<EquipeLevada | null>(null);
async function levar(): Promise<void> {
  if (pares.value.length === 0) return;
  ocupado.value = true;
  erro.value = null;
  resultado.value = null;
  try {
    resultado.value = await levarEquipeParaConta(props.ato, pares.value);
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const incluidos = computed(() => resultado.value?.itens.reduce((s, i) => s + i.incluidos, 0) ?? 0);
const fora = computed(() => resultado.value?.itens.reduce((s, i) => s + i.foraDaVaga.length, 0) ?? 0);
</script>

<template>
  <section class="painel" aria-labelledby="equipe-realizada-titulo" data-testid="equipe-realizada">
    <ErroCirurgia v-if="equipe.error.value" :erro="equipe.error.value" />
    <p v-else-if="!equipe.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <h3 id="equipe-realizada-titulo">
        {{ t('cirurgia.equipeRealizada.titulo', { numero: equipe.data.value.numero }) }}
      </h3>
      <p v-if="equipe.data.value.membros.length === 0">{{ t('cirurgia.equipeRealizada.semMembros') }}</p>
      <table v-else class="tabela" data-testid="equipe-realizada-membros">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.equipeRealizada.funcao') }}</th>
            <th scope="col">{{ t('cirurgia.equipeRealizada.profissional') }}</th>
            <th scope="col">{{ t('cirurgia.equipeRealizada.procedimento') }}</th>
            <th scope="col">{{ t('cirurgia.equipeRealizada.entrada') }}</th>
            <th scope="col">{{ t('cirurgia.equipeRealizada.saida') }}</th>
            <th scope="col">{{ t('cirurgia.equipeRealizada.minutos') }}</th>
            <th scope="col">{{ t('cirurgia.equipeRealizada.percentual') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in equipe.data.value.membros"
            :key="m.participante"
            :data-testid="`equipe-membro-${m.participante}`"
          >
            <td>
              {{ m.funcaoDescricao }}
              <span v-if="m.principal">{{ t('cirurgia.equipeRealizada.principal') }}</span>
            </td>
            <td>{{ m.profissionalNome ?? m.profissional }}</td>
            <td>{{ m.procedimentoDescricao ?? t('cirurgia.equipeRealizada.todos') }}</td>
            <td>{{ hora(m.entrada) }}</td>
            <td>{{ hora(m.saida) }}</td>
            <td>{{ m.minutos }}</td>
            <td>{{ m.percentual === null ? '—' : `${m.percentual}%` }}</td>
          </tr>
        </tbody>
      </table>

      <form v-if="podeLevar" data-testid="equipe-conta" @submit.prevent="levar">
        <h4>{{ t('cirurgia.equipeRealizada.conta') }}</h4>
        <p v-if="equipe.data.value.itensConta.length === 0">{{ t('cirurgia.equipeRealizada.semItens') }}</p>
        <template v-else>
          <p>{{ t('cirurgia.equipeRealizada.contaTexto') }}</p>
          <SanteSelecao
            v-for="p in equipe.data.value.procedimentos"
            :key="p.id"
            v-model="escolhas[p.id]!"
            :rotulo="t('cirurgia.equipeRealizada.itemDo', { procedimento: p.descricao })"
            :opcoes="opcoesItem"
            :data-testid="`equipe-conta-item-${p.sequencia}`"
          />
          <p v-if="pares.length === 0" role="status">{{ t('cirurgia.equipeRealizada.nadaEscolhido') }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('cirurgia.equipeRealizada.levar')"
            :desabilitado="ocupado || pares.length === 0"
            data-testid="equipe-conta-levar"
          />
        </template>
        <ErroCirurgia v-if="erro" :erro="erro" />
        <SanteAlerta
          v-if="resultado"
          variante="info"
          anunciar
          :texto="
            fora > 0
              ? `${t('cirurgia.equipeRealizada.levada', { n: incluidos })} ${t('cirurgia.equipeRealizada.foraDaVaga', { n: fora })}`
              : t('cirurgia.equipeRealizada.levada', { n: incluidos })
          "
          data-testid="equipe-conta-resultado"
        />
      </form>
      <SanteBotao variante="texto" :rotulo="t('cirurgia.equipeRealizada.fechar')" @acionar="emit('fechar')" />
    </template>
  </section>
</template>
