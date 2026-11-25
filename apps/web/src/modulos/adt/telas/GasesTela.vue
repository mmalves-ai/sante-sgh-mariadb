<script setup lang="ts">
// Gases medicinais do paciente (F3.4, 04-INT linha 82): `/internacao/atendimentos/:atd/gases`. Visão por paciente:
// os usos do atendimento, o início com fluxo e local, a troca de fluxo numa ação só (encerra o atual e abre o
// seguinte), o encerramento, o cancelamento com motivo (nada se apaga) e o lançamento na conta pelo tempo acumulado.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarUsoGas,
  encerrarUsoGas,
  iniciarUsoGas,
  lancarGasesNaConta,
  lerUsosGas,
  type UsoGas,
} from '../api-gases.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const props = defineProps<{ atd: string | number }>();
// O atalho da regra aparece só para quem pode ver o contrato (a enfermagem registra o uso; a regra é do convênio).
const podeRegras = computed(() => pode('convenio.contrato.ler'));
const { t } = useI18n();
const atd = computed(() => Number(props.atd));
const cliente = useQueryClient();
const usos = useQuery({
  queryKey: computed(() => ['adt', 'gases', atd.value]),
  queryFn: () => lerUsosGas(atd.value),
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'gases'] });
const LOCAIS = [
  'leito',
  'centro_cirurgico',
  'sala_procedimento',
  'pronto_atendimento',
  'transporte',
  'outro',
];
const insumo = ref<number | null>(null);
const fluxo = ref<number | null>(null);
const local = ref('leito');
const opLocais = computed(() =>
  LOCAIS.map((l) => ({ valor: l as string, rotulo: t(`adt.gases.locais.${l}`) })),
);
const motivo = ref('');
const aviso = ref('');
const erro = ref<unknown>(null);
const valido = computed(() => !!insumo.value && insumo.value > 0 && (fluxo.value ?? 0) >= 0);

const acao = useMutation({
  mutationFn: (f: () => Promise<unknown>) => f(),
  onSuccess: () => {
    erro.value = null;
    void recarregar();
  },
  onError: (e) => {
    erro.value = e;
  },
});
const iniciar = (anterior: UsoGas | null) =>
  acao.mutate(() =>
    iniciarUsoGas({
      atendimento: atd.value,
      insumo: anterior?.insumo ?? insumo.value!,
      local: local.value,
      fluxoLitrosMinuto: fluxo.value,
      usoAnterior: anterior?.id ?? null,
    }),
  );
const encerrar = (u: UsoGas) => acao.mutate(() => encerrarUsoGas(u.id, u.versao));
const cancelar = (u: UsoGas) => acao.mutate(() => cancelarUsoGas(u.id, u.versao, motivo.value.trim()));
const lancar = () =>
  acao.mutate(async () => {
    const r = await lancarGasesNaConta(atd.value);
    aviso.value = t('adt.gases.lancado', { n: r.itens.length });
  });
const hora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gases-titulo" data-testid="tela-gases">
    <h1 id="gases-titulo">{{ t('adt.gases.titulo') }}</h1>
    <p>{{ t('adt.gases.texto') }}</p>
    <p>
      <template v-if="podeRegras">
        <RouterLink :to="{ name: 'adt.gases.regras' }" data-testid="gases-ir-regras">{{
          t('adt.gases.irRegras')
        }}</RouterLink>
        ·
      </template>
      <RouterLink :to="{ name: 'adt.gases.setores' }" data-testid="gases-ir-setores">{{
        t('adt.gasesSetor.irSetores')
      }}</RouterLink>
    </p>
    <ErroAdt v-if="usos.isError.value" :erro="usos.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="gases-aviso">{{ aviso }}</p>
    <form class="filtros" @submit.prevent="iniciar(null)">
      <label
        >{{ t('adt.gases.gas') }}
        <input v-model.number="insumo" type="number" min="1" required data-testid="gas-insumo"
      /></label>
      <label
        >{{ t('adt.gases.fluxo') }}
        <input v-model.number="fluxo" type="number" min="0" step="0.5" data-testid="gas-fluxo"
      /></label>
      <SanteSelecao
        v-model="local"
        :rotulo="t('adt.gases.local')"
        :opcoes="opLocais"
        data-testid="gas-local"
      />
      <button type="submit" :disabled="!valido || acao.isPending.value" data-testid="gas-iniciar">
        {{ t('adt.gases.iniciar') }}
      </button>
      <button type="button" :disabled="acao.isPending.value" data-testid="gas-lancar" @click="lancar">
        {{ t('adt.gases.lancar') }}
      </button>
    </form>
    <p v-if="!usos.data.value" role="status">{{ t('adt.carregando') }}</p>
    <p v-else-if="usos.data.value.itens.length === 0" data-testid="gases-nenhum">
      {{ t('adt.gases.nenhum') }}
    </p>
    <template v-else>
      <label
        >{{ t('adt.gases.motivo') }} <input v-model="motivo" maxlength="400" data-testid="gas-motivo"
      /></label>
      <table class="tabela" data-testid="tabela-gases">
        <thead>
          <tr>
            <th scope="col">{{ t('adt.gases.gas') }}</th>
            <th scope="col">{{ t('adt.gases.fluxo') }}</th>
            <th scope="col">{{ t('adt.gases.inicio') }}</th>
            <th scope="col">{{ t('adt.gases.fim') }}</th>
            <th scope="col">{{ t('adt.gases.horas') }}</th>
            <th scope="col">{{ t('adt.gases.situacao') }}</th>
            <th scope="col">{{ t('adt.gases.faturado') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in usos.data.value.itens" :key="u.id" :data-testid="`gas-uso-${u.id}`">
            <td>{{ u.gasNome }}</td>
            <td>{{ u.fluxoLitrosMinuto ?? '' }}</td>
            <td>{{ hora(u.inicio) }}</td>
            <td>{{ hora(u.fim) }}</td>
            <td>{{ u.horasUso ?? '' }}</td>
            <td>{{ t(`adt.gases.situacoes.${u.situacao}`) }}</td>
            <td>{{ u.faturado ? t('adt.sim') : t('adt.nao') }}</td>
            <td>
              <template v-if="u.situacao === 'em_uso'">
                <button type="button" :disabled="acao.isPending.value" @click="iniciar(u)">
                  {{ t('adt.gases.trocar') }}
                </button>
                <button type="button" :disabled="acao.isPending.value" @click="encerrar(u)">
                  {{ t('adt.gases.encerrar') }}
                </button>
              </template>
              <button
                v-if="!u.faturado && u.situacao !== 'cancelado'"
                type="button"
                :disabled="acao.isPending.value || motivo.trim().length < 5"
                @click="cancelar(u)"
              >
                {{ t('adt.gases.cancelar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
