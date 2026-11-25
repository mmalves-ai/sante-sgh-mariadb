<script setup lang="ts">
// Consumo de gases medicinais por setor (C1-050, 05-SUP linha 30): `/internacao/gases/setores`. Numa tela só: a
// apuração por setor e gás no período (uso dos pacientes + consumo do setor sem paciente, com as parcelas impressas), o
// registro do consumo do setor sem paciente (fluxo × tempo ou volume medido), validado na hora pela mesma regra do
// domínio que a API aplica, e a lista dos consumos do setor com encerrar e cancelar com motivo (nada se apaga).
import { conferirConsumoGasSetor } from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type ConsumoGasSetor,
  cancelarConsumoGasSetor,
  encerrarConsumoGasSetor,
  lerApuracaoGasSetor,
  lerConsumosGasSetor,
  lerOpcoesGasSetor,
  registrarConsumoGasSetor,
} from '../api-gases-setor.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const diaIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = new Date();
const de = ref(diaIso(new Date(hoje.getTime() - 6 * 86_400_000)));
const ate = ref(diaIso(hoje));
const filtroSetor = ref<number | ''>('');
const periodoValido = computed(() => !!de.value && !!ate.value && de.value <= ate.value);
const periodo = computed(() => ({
  de: de.value,
  ate: ate.value,
  setor: filtroSetor.value === '' ? null : filtroSetor.value,
}));

const opcoes = useQuery({ queryKey: ['adt', 'gases-setor', 'opcoes'], queryFn: lerOpcoesGasSetor });
const apuracao = useQuery({
  queryKey: computed(() => ['adt', 'gases-setor', 'apuracao', periodo.value]),
  queryFn: () => lerApuracaoGasSetor(periodo.value),
  enabled: periodoValido,
});
const consumos = useQuery({
  queryKey: computed(() => ['adt', 'gases-setor', 'consumos', periodo.value]),
  queryFn: () => lerConsumosGasSetor(periodo.value),
  enabled: periodoValido,
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'gases-setor'] });

const opSetores = computed(() => [
  { valor: '' as number | '', rotulo: t('adt.gasesSetor.escolha') },
  ...(opcoes.data.value?.setores ?? []).map((s) => ({ valor: s.id as number | '', rotulo: s.nome })),
]);
const opFiltroSetor = computed(() => [
  { valor: '' as number | '', rotulo: t('adt.gasesSetor.todos') },
  ...(opcoes.data.value?.setores ?? []).map((s) => ({ valor: s.id as number | '', rotulo: s.nome })),
]);
const opGases = computed(() => [
  { valor: '' as number | '', rotulo: t('adt.gasesSetor.escolha') },
  ...(opcoes.data.value?.gases ?? []).map((g) => ({ valor: g.id as number | '', rotulo: g.nome })),
]);
const opModos = computed(() =>
  (['fluxo', 'volume'] as const).map((m) => ({ valor: m as string, rotulo: t(`adt.gasesSetor.modos.${m}`) })),
);

// Registro do consumo do setor sem paciente.
const setor = ref<number | ''>('');
const gas = ref<number | ''>('');
const modo = ref<string>('fluxo');
const fluxo = ref<number | null>(null);
const volume = ref<number | null>(null);
const inicio = ref('');
const fim = ref('');
const observacao = ref('');
const motivo = ref('');
const aviso = ref('');
const erro = ref<unknown>(null);
const quando = (s: string) => (s ? new Date(s) : null);
const problemas = computed(() =>
  conferirConsumoGasSetor({
    setor: setor.value === '' ? null : setor.value,
    gas: gas.value === '' ? null : gas.value,
    fluxoLitrosMinuto: modo.value === 'fluxo' ? (fluxo.value ?? null) : null,
    quantidadeLitros: modo.value === 'volume' ? (volume.value ?? null) : null,
    inicio: quando(inicio.value) ?? new Date(),
    fim: quando(fim.value),
    agora: new Date(),
  }).map((p) => p.mensagem),
);

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
const registrar = () =>
  acao.mutate(async () => {
    await registrarConsumoGasSetor({
      setor: Number(setor.value),
      insumo: Number(gas.value),
      fluxoLitrosMinuto: modo.value === 'fluxo' ? fluxo.value : null,
      quantidadeLitros: modo.value === 'volume' ? volume.value : null,
      inicio: (quando(inicio.value) ?? new Date()).toISOString(),
      fim: quando(fim.value)?.toISOString() ?? null,
      observacao: observacao.value.trim() || null,
    });
    aviso.value = t('adt.gasesSetor.registrado');
    fluxo.value = null;
    volume.value = null;
    inicio.value = '';
    fim.value = '';
    observacao.value = '';
  });
const encerrar = (c: ConsumoGasSetor) => acao.mutate(() => encerrarConsumoGasSetor(c.id, c.versao));
const cancelar = (c: ConsumoGasSetor) =>
  acao.mutate(() => cancelarConsumoGasSetor(c.id, c.versao, motivo.value.trim()));
const hora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '');
const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gases-setor-titulo" data-testid="tela-gases-setor">
    <h1 id="gases-setor-titulo">{{ t('adt.gasesSetor.titulo') }}</h1>
    <p>{{ t('adt.gasesSetor.texto') }}</p>
    <ErroAdt v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="gases-setor-aviso">{{ aviso }}</p>

    <form class="filtros" :aria-label="t('adt.gasesSetor.periodo')" @submit.prevent>
      <label
        >{{ t('adt.gasesSetor.de') }} <input v-model="de" type="date" required data-testid="gases-setor-de"
      /></label>
      <label
        >{{ t('adt.gasesSetor.ate') }}
        <input v-model="ate" type="date" required data-testid="gases-setor-ate"
      /></label>
      <SanteSelecao
        v-model="filtroSetor"
        :rotulo="t('adt.gasesSetor.setor')"
        :opcoes="opFiltroSetor"
        data-testid="gases-setor-filtro"
      />
    </form>
    <p v-if="!periodoValido" role="alert" data-testid="gases-setor-periodo-invalido">
      {{ t('adt.gasesSetor.periodoInvalido') }}
    </p>

    <h2>{{ t('adt.gasesSetor.apuracao') }}</h2>
    <ErroAdt v-if="apuracao.isError.value" :erro="apuracao.error.value" />
    <p v-else-if="periodoValido && !apuracao.data.value" role="status">{{ t('adt.carregando') }}</p>
    <p v-else-if="apuracao.data.value?.itens.length === 0" data-testid="gases-setor-nenhum">
      {{ t('adt.gasesSetor.nenhum') }}
    </p>
    <table v-else-if="apuracao.data.value" class="tabela" data-testid="tabela-apuracao-gas">
      <thead>
        <tr>
          <th scope="col">{{ t('adt.gasesSetor.setor') }}</th>
          <th scope="col">{{ t('adt.gasesSetor.gas') }}</th>
          <th scope="col">{{ t('adt.gasesSetor.pacientes') }}</th>
          <th scope="col">{{ t('adt.gasesSetor.doSetor') }}</th>
          <th scope="col">{{ t('adt.gasesSetor.total') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="a in apuracao.data.value.itens"
          :key="`${a.setor ?? 0}-${a.gas}`"
          :data-testid="`apuracao-gas-${a.setor ?? 0}-${a.gas}`"
        >
          <td>{{ a.setorNome ?? t('adt.gasesSetor.semSetor') }}</td>
          <td>{{ a.gasNome }}</td>
          <td>
            {{ t('adt.gasesSetor.registros', { n: a.pacientes.registros }) }} ·
            {{ t('adt.gasesSetor.horas', { n: n(a.pacientes.horas) }) }} ·
            {{ t('adt.gasesSetor.litros', { n: n(a.pacientes.litros) }) }}
            <template v-if="a.pacientes.semVolume"
              ><br />{{ t('adt.gasesSetor.semVolume', { n: a.pacientes.semVolume }) }}</template
            >
          </td>
          <td>
            {{ t('adt.gasesSetor.registros', { n: a.setorSemPaciente.registros }) }} ·
            {{ t('adt.gasesSetor.horas', { n: n(a.setorSemPaciente.horas) }) }} ·
            {{ t('adt.gasesSetor.litros', { n: n(a.setorSemPaciente.litros) }) }}
          </td>
          <td>
            {{ t('adt.gasesSetor.horas', { n: n(a.total.horas) }) }}<br />
            {{
              t('adt.gasesSetor.conta', {
                total: n(a.total.litros),
                pacientes: n(a.pacientes.litros),
                setor: n(a.setorSemPaciente.litros),
              })
            }}
          </td>
        </tr>
      </tbody>
    </table>

    <h2>{{ t('adt.gasesSetor.registrar') }}</h2>
    <form class="filtros" data-testid="gases-setor-form" @submit.prevent="registrar">
      <SanteSelecao
        v-model="setor"
        :rotulo="t('adt.gasesSetor.setor')"
        :opcoes="opSetores"
        obrigatorio
        data-testid="gases-setor-setor"
      />
      <SanteSelecao
        v-model="gas"
        :rotulo="t('adt.gasesSetor.gas')"
        :opcoes="opGases"
        obrigatorio
        data-testid="gases-setor-gas"
      />
      <SanteSelecao
        v-model="modo"
        :rotulo="t('adt.gasesSetor.modo')"
        :opcoes="opModos"
        data-testid="gases-setor-modo"
      />
      <label v-if="modo === 'fluxo'"
        >{{ t('adt.gasesSetor.fluxo') }}
        <input v-model.number="fluxo" type="number" min="0" step="0.5" data-testid="gases-setor-fluxo"
      /></label>
      <label v-else
        >{{ t('adt.gasesSetor.volume') }}
        <input v-model.number="volume" type="number" min="0" step="1" data-testid="gases-setor-volume"
      /></label>
      <label
        >{{ t('adt.gasesSetor.inicio') }}
        <input v-model="inicio" type="datetime-local" data-testid="gases-setor-inicio"
      /></label>
      <label
        >{{ t('adt.gasesSetor.fim') }}
        <input v-model="fim" type="datetime-local" data-testid="gases-setor-fim"
      /></label>
      <label
        >{{ t('adt.gasesSetor.observacao') }}
        <input v-model="observacao" maxlength="500" data-testid="gases-setor-observacao"
      /></label>
      <ul v-if="problemas.length" class="problemas" data-testid="gases-setor-problemas">
        <li v-for="p in problemas" :key="p">{{ p }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemas.length > 0 || acao.isPending.value"
        data-testid="gases-setor-gravar"
      >
        {{ t('adt.gasesSetor.gravar') }}
      </button>
    </form>

    <h2>{{ t('adt.gasesSetor.consumos') }}</h2>
    <ErroAdt v-if="consumos.isError.value" :erro="consumos.error.value" />
    <template v-else-if="consumos.data.value && consumos.data.value.itens.length">
      <label
        >{{ t('adt.gasesSetor.motivo') }}
        <input v-model="motivo" maxlength="400" data-testid="gases-setor-motivo"
      /></label>
      <table class="tabela" data-testid="tabela-consumos-gas-setor">
        <thead>
          <tr>
            <th scope="col">{{ t('adt.gasesSetor.setor') }}</th>
            <th scope="col">{{ t('adt.gasesSetor.gas') }}</th>
            <th scope="col">{{ t('adt.gasesSetor.fluxo') }}</th>
            <th scope="col">{{ t('adt.gasesSetor.inicio') }}</th>
            <th scope="col">{{ t('adt.gasesSetor.fim') }}</th>
            <th scope="col">{{ t('adt.gasesSetor.volume') }}</th>
            <th scope="col">{{ t('adt.gasesSetor.situacao') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in consumos.data.value.itens" :key="c.id" :data-testid="`consumo-gas-setor-${c.id}`">
            <td>{{ c.setorNome }}</td>
            <td>{{ c.gasNome }}</td>
            <td>{{ c.fluxoLitrosMinuto ?? '' }}</td>
            <td>{{ hora(c.inicio) }}</td>
            <td>{{ hora(c.fim) }}</td>
            <td>{{ c.quantidadeLitros ?? '' }}</td>
            <td>
              {{ t(`adt.gasesSetor.situacoes.${c.situacao}`) }}
              <template v-if="c.observacao"><br />{{ c.observacao }}</template>
            </td>
            <td>
              <button
                v-if="c.situacao === 'em_uso'"
                type="button"
                :disabled="acao.isPending.value"
                @click="encerrar(c)"
              >
                {{ t('adt.gasesSetor.encerrar') }}
              </button>
              <button
                v-if="c.situacao === 'em_uso' || c.situacao === 'encerrado'"
                type="button"
                :disabled="acao.isPending.value || motivo.trim().length < 5"
                @click="cancelar(c)"
              >
                {{ t('adt.gasesSetor.cancelar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
