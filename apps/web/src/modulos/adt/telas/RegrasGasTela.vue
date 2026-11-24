<script setup lang="ts">
// Regra de cobrança dos gases medicinais (F3.4, 04-INT linha 82): `/internacao/gases/regras`. Uma tela só para a
// regra do gás: unidade, tolerância, fração, arredondamento, faixas por horas acumuladas e o tratamento do uso
// simultâneo com outro gás. A validação roda na hora pela mesma regra do domínio que a API aplica; encerrar a vigência
// não apaga nada (a conta já lançada guarda a regra na memória).
import {
  ARREDONDAMENTOS_GAS,
  conferirRegraCobrancaGas,
  TRATAMENTOS_SIMULTANEO_GAS,
  UNIDADES_COBRANCA_GAS,
  type RegraCobrancaGas,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { encerrarRegraGas, incluirRegraGas, lerRegrasGas, type RegraGas } from '../api-gases.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const hoje = () => new Date().toISOString().slice(0, 10);

const gasBusca = ref<number | null>(null);
const regras = useQuery({
  queryKey: computed(() => ['adt', 'gases', 'regras', gasBusca.value]),
  queryFn: () => lerRegrasGas(gasBusca.value!),
  enabled: computed(() => !!gasBusca.value && gasBusca.value > 0),
});

type Faixa = { horasInicio: number; horasFim: number | null; item: number | null; quantidade: number };
type Simultaneo = { gas: number | null; tratamento: string; percentual: number | null };
const f = reactive({
  cobranca: null as number | null,
  fonte: null as number | null,
  plano: null as number | null,
  unidade: 'hora',
  toleranciaMinutos: 0,
  fracaoMinimaMinutos: null as number | null,
  arredondamento: 'para_cima',
  percentualSimultaneo: null as number | null,
  vigenciaInicio: hoje(),
  vigenciaFim: '' as string,
  faixas: [] as Faixa[],
  simultaneos: [] as Simultaneo[],
});
const op = (lista: readonly string[], grupo: string) =>
  lista.map((v) => ({ valor: v, rotulo: t(`adt.gases.regras.${grupo}.${v}`) }));
const opUnidades = computed(() => op(UNIDADES_COBRANCA_GAS, 'unidades'));
const opArred = computed(() => op(ARREDONDAMENTOS_GAS, 'arredondamentos'));
const opTrat = computed(() => op(TRATAMENTOS_SIMULTANEO_GAS, 'tratamentos'));

// Validação na hora: a mesma conferência do domínio, mais o que a API confere fora dele.
const problemas = computed(() => {
  if (!gasBusca.value || gasBusca.value <= 0) return [t('adt.gases.regras.semGas')];
  const regra: RegraCobrancaGas = {
    unidade: f.unidade as RegraCobrancaGas['unidade'],
    toleranciaMinutos: Number(f.toleranciaMinutos) || 0,
    fracaoMinimaMinutos: f.fracaoMinimaMinutos || null,
    arredondamento: f.arredondamento as RegraCobrancaGas['arredondamento'],
    percentualSimultaneo: f.percentualSimultaneo ?? null,
    faixas: f.faixas,
    simultaneos: f.simultaneos
      .filter((s) => !!s.gas)
      .map((s) => ({
        gas: s.gas!,
        tratamento: s.tratamento as RegraCobrancaGas['simultaneos'][number]['tratamento'],
        percentual: s.percentual ?? null,
      })),
  };
  const p = conferirRegraCobrancaGas(regra, gasBusca.value).map((x) => x.mensagem);
  if (f.plano && !f.fonte) p.push(t('adt.gases.regras.planoSemFonte'));
  if (f.vigenciaFim && f.vigenciaFim < f.vigenciaInicio) p.push(t('adt.gases.regras.fimAntes'));
  if (f.simultaneos.some((s) => !s.gas)) p.push(t('adt.gases.regras.simultaneoSemGas'));
  return p;
});

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    void cliente.invalidateQueries({ queryKey: ['adt', 'gases', 'regras'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const salvar = () =>
  acao.mutate(async () => {
    await incluirRegraGas({
      gas: gasBusca.value!,
      cobranca: f.cobranca || null,
      fonte: f.fonte || null,
      plano: f.plano || null,
      unidade: f.unidade,
      toleranciaMinutos: Number(f.toleranciaMinutos) || 0,
      fracaoMinimaMinutos: f.unidade === 'fracao_hora' ? f.fracaoMinimaMinutos || null : null,
      arredondamento: f.arredondamento,
      percentualSimultaneo: f.percentualSimultaneo ?? null,
      vigenciaInicio: f.vigenciaInicio,
      vigenciaFim: f.vigenciaFim || null,
      faixas: f.faixas.map((x) => ({ ...x, horasFim: x.horasFim ?? null, item: x.item || null })),
      simultaneos: f.simultaneos.map((s) => ({
        gas: s.gas!,
        tratamento: s.tratamento,
        percentual: s.tratamento === 'cobra_com_desconto' ? (s.percentual ?? null) : null,
      })),
    });
    aviso.value = t('adt.gases.regras.salva');
  });
const encerrar = (r: RegraGas) =>
  acao.mutate(async () => {
    await encerrarRegraGas(r.id, r.versao, hoje());
    aviso.value = t('adt.gases.regras.encerrada');
  });
const novaFaixa = () => {
  const ult = f.faixas[f.faixas.length - 1];
  f.faixas.push({ horasInicio: ult?.horasFim ?? 0, horasFim: null, item: null, quantidade: 1 });
};
const novoSimultaneo = () => f.simultaneos.push({ gas: null, tratamento: 'cobra_maior', percentual: null });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="regras-gas-titulo" data-testid="tela-regras-gas">
    <h1 id="regras-gas-titulo">{{ t('adt.gases.regras.titulo') }}</h1>
    <p>{{ t('adt.gases.regras.texto') }}</p>
    <ErroAdt v-if="regras.isError.value" :erro="regras.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="regras-gas-aviso">{{ aviso }}</p>

    <form class="filtros" data-testid="regra-gas-form" @submit.prevent="salvar">
      <label
        >{{ t('adt.gases.regras.gas') }}
        <input v-model.number="gasBusca" type="number" min="1" required data-testid="regra-gas"
      /></label>
      <label
        >{{ t('adt.gases.regras.cobranca') }}
        <input v-model.number="f.cobranca" type="number" min="1" data-testid="regra-cobranca"
      /></label>
      <label
        >{{ t('adt.gases.regras.fonte') }}
        <input v-model.number="f.fonte" type="number" min="1" data-testid="regra-fonte"
      /></label>
      <label
        >{{ t('adt.gases.regras.plano') }}
        <input v-model.number="f.plano" type="number" min="1" data-testid="regra-plano"
      /></label>
      <SanteSelecao
        v-model="f.unidade"
        :rotulo="t('adt.gases.regras.unidade')"
        :opcoes="opUnidades"
        data-testid="regra-unidade"
      />
      <label
        >{{ t('adt.gases.regras.tolerancia') }}
        <input
          v-model.number="f.toleranciaMinutos"
          type="number"
          min="0"
          max="1440"
          data-testid="regra-tolerancia"
      /></label>
      <label v-if="f.unidade === 'fracao_hora'"
        >{{ t('adt.gases.regras.fracao') }}
        <input
          v-model.number="f.fracaoMinimaMinutos"
          type="number"
          min="1"
          max="60"
          data-testid="regra-fracao"
      /></label>
      <SanteSelecao
        v-model="f.arredondamento"
        :rotulo="t('adt.gases.regras.arredondamento')"
        :opcoes="opArred"
        data-testid="regra-arredondamento"
      />
      <label
        >{{ t('adt.gases.regras.inicio') }}
        <input v-model="f.vigenciaInicio" type="date" required data-testid="regra-inicio"
      /></label>
      <label
        >{{ t('adt.gases.regras.fim') }} <input v-model="f.vigenciaFim" type="date" data-testid="regra-fim"
      /></label>

      <fieldset data-testid="regra-faixas">
        <legend>{{ t('adt.gases.regras.faixas') }}</legend>
        <div v-for="(x, i) in f.faixas" :key="`fx${i}`" :data-testid="`regra-faixa-${i}`">
          <label
            >{{ t('adt.gases.regras.deHoras') }}
            <input v-model.number="x.horasInicio" type="number" min="0" step="0.5"
          /></label>
          <label
            >{{ t('adt.gases.regras.ateHoras') }}
            <input v-model.number="x.horasFim" type="number" min="0" step="0.5"
          /></label>
          <label
            >{{ t('adt.gases.regras.quantidade') }}
            <input v-model.number="x.quantidade" type="number" min="0"
          /></label>
          <label
            >{{ t('adt.gases.regras.itemFaixa') }} <input v-model.number="x.item" type="number" min="1"
          /></label>
          <button type="button" @click="f.faixas.splice(i, 1)">{{ t('adt.gases.regras.remover') }}</button>
        </div>
        <button type="button" data-testid="regra-nova-faixa" @click="novaFaixa">
          {{ t('adt.gases.regras.novaFaixa') }}
        </button>
      </fieldset>

      <fieldset data-testid="regra-simultaneos">
        <legend>{{ t('adt.gases.regras.simultaneos') }}</legend>
        <label
          >{{ t('adt.gases.regras.percentualSimultaneo') }}
          <input v-model.number="f.percentualSimultaneo" type="number" min="0" max="100"
        /></label>
        <div v-for="(s, i) in f.simultaneos" :key="`sm${i}`" :data-testid="`regra-simultaneo-${i}`">
          <label
            >{{ t('adt.gases.regras.outroGas') }} <input v-model.number="s.gas" type="number" min="1"
          /></label>
          <SanteSelecao v-model="s.tratamento" :rotulo="t('adt.gases.regras.tratamento')" :opcoes="opTrat" />
          <label v-if="s.tratamento === 'cobra_com_desconto'"
            >{{ t('adt.gases.regras.percentual') }}
            <input v-model.number="s.percentual" type="number" min="0" max="100"
          /></label>
          <button type="button" @click="f.simultaneos.splice(i, 1)">
            {{ t('adt.gases.regras.remover') }}
          </button>
        </div>
        <button type="button" data-testid="regra-novo-simultaneo" @click="novoSimultaneo">
          {{ t('adt.gases.regras.novoSimultaneo') }}
        </button>
      </fieldset>

      <ul v-if="problemas.length" class="problemas" data-testid="regra-problemas">
        <li v-for="p in problemas" :key="p">{{ p }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemas.length > 0 || acao.isPending.value"
        data-testid="regra-salvar"
      >
        {{ t('adt.gases.regras.salvar') }}
      </button>
    </form>

    <p v-if="regras.data.value && regras.data.value.itens.length === 0" data-testid="regras-gas-nenhuma">
      {{ t('adt.gases.regras.nenhuma') }}
    </p>
    <table v-else-if="regras.data.value" class="tabela" data-testid="tabela-regras-gas">
      <thead>
        <tr>
          <th scope="col">{{ t('adt.gases.regras.unidade') }}</th>
          <th scope="col">{{ t('adt.gases.regras.fonte') }}</th>
          <th scope="col">{{ t('adt.gases.regras.inicio') }}</th>
          <th scope="col">{{ t('adt.gases.regras.fim') }}</th>
          <th scope="col">{{ t('adt.gases.regras.faixas') }}</th>
          <th scope="col">{{ t('adt.gases.regras.simultaneos') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras.data.value.itens" :key="r.id" :data-testid="`regra-gas-${r.id}`">
          <td>{{ t(`adt.gases.regras.unidades.${r.regra.unidade}`) }}</td>
          <td>{{ r.fonte ?? t('adt.gases.regras.todas') }}</td>
          <td>{{ r.vigenciaInicio }}</td>
          <td>{{ r.vigenciaFim ?? '' }}</td>
          <td>{{ r.regra.faixas.length }}</td>
          <td>{{ r.regra.simultaneos.length }}</td>
          <td>
            <button v-if="!r.vigenciaFim" type="button" :disabled="acao.isPending.value" @click="encerrar(r)">
              {{ t('adt.gases.regras.encerrar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
