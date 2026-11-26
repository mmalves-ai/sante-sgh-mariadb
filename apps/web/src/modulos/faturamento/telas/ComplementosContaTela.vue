<script setup lang="ts">
// Complementos da conta (F3.7, 06-FAT linha 12): `/faturamento/contas/:id/complementos`. Duas partes numa tela só:
// - Períodos da conta parcial: o próximo período já vem sugerido (do fim do último, ou do 1º dia do mês seguinte quando
//   o último fechou o mês, até o fim do mês ou da conta) e entra
//   num clique; a faixa livre é conferida enquanto se digita (mesma regra do servidor). Retirar pede motivo e a faixa
//   fica no histórico, marcada.
// - Segurado na conta: preenchido a partir da cobertura do paciente; carteira vencida no início da conta só avisa.
//   Trocar a carteira preserva a anterior no histórico.
// - Guias da conta: cada guia TISS com os campos obrigatórios da operadora que faltam, o link para preenchê-los e o
//   link para o cadastro dos campos da operadora.
// - Faturamento por período (PeriodosFaturamentoConta): itens, valor e guias de cada faixa, fechamento parcial e
//   reabertura com motivo.
import { sugerirProximoPeriodo, validarPeriodoConta, validarSeguradoConta } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  gravarSegurado,
  incluirPeriodo,
  lerGuiasAtributosConta,
  lerPeriodos,
  lerSegurado,
  retirarPeriodo,
  type Segurado,
} from '../api-complementos.js';
import { novaChave } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import PeriodosFaturamentoConta from '../componentes/PeriodosFaturamentoConta.vue';
import { quando } from '../usar-faturamento.js';

const props = defineProps<{ id: string }>();
const conta = computed(() => Number(props.id));
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Complementos da conta',
      voltar: 'Voltar à conta',
      periodos: 'Períodos da conta parcial',
      semPeriodos: 'A conta ainda não foi dividida em períodos.',
      sugestao: 'Próximo período sugerido: {inicio} a {fim} (competência {competencia}).',
      aceitar: 'Incluir o período sugerido',
      outro: 'Outro período',
      inicio: 'Início',
      fim: 'Fim',
      competencia: 'Competência',
      incluir: 'Incluir período',
      retirar: 'Retirar',
      motivo: 'Motivo da retirada',
      confirmar: 'Confirmar retirada',
      todos: 'Todos os lançamentos',
      tipo: 'Tipo de lançamento',
      fechada: 'A conta não está aberta: reabra-a para mudar os períodos e o segurado.',
      segurado: 'Segurado na conta',
      sugeridoCobertura: 'Dados sugeridos da cobertura do paciente: confira e grave.',
      substituidos: 'Carteiras anteriores no histórico: {n}.',
      carteira: 'Número da carteira',
      validade: 'Validade da carteira',
      parentesco: 'Parentesco com o titular',
      matricula: 'Matrícula funcional',
      cargo: 'Cargo',
      unidade: 'Unidade administrativa',
      gravar: 'Gravar segurado',
      gravado: 'Gravado.',
      guias: 'Guias da conta e campos da operadora',
      semGuias: 'A conta ainda não tem guia TISS montada.',
      guia: 'Guia',
      situacaoGuia: 'Situação',
      pendentes: 'Obrigatórios que faltam',
      completa: 'Completa',
      semCampos: 'A operadora não pede campo adicional',
      preencher: 'Preencher campos',
      camposOperadora: 'Campos adicionais da operadora',
    },
  },
});
const qc = useQueryClient();
const periodos = useQuery({
  queryKey: ['faturamento', 'periodos', conta],
  queryFn: () => lerPeriodos(conta.value),
});
const guias = useQuery({
  queryKey: ['faturamento', 'guias-atributos', conta],
  queryFn: () => lerGuiasAtributosConta(conta.value),
});
const seg = useQuery({
  queryKey: ['faturamento', 'segurado', conta],
  queryFn: () => lerSegurado(conta.value),
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('complementos');
async function acao(f: () => Promise<unknown>, alertas = false) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    // O resultado da operação é plano: os alertas vêm num texto só.
    const r = (await f()) as { alertas?: string };
    mensagem.value = alertas && r.alertas ? r.alertas : t('gravado');
    chave = novaChave('complementos');
    retirando.value = null;
    motivo.value = '';
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// ── Períodos ─────────────────────────────────────────────────────────
const dados = computed(() => periodos.data.value);
const contaDom = computed(() =>
  dados.value
    ? { situacao: dados.value.situacao, inicio: dados.value.inicioConta, fim: dados.value.fimConta }
    : null,
);
const sugestao = computed(() =>
  contaDom.value && dados.value?.editavel
    ? sugerirProximoPeriodo(contaDom.value, dados.value.periodos)
    : null,
);
const novo = reactive({ inicio: '', fim: '', competencia: '' });
const conferencia = computed(() => {
  if (!contaDom.value || !novo.inicio || !novo.fim) return null;
  return validarPeriodoConta(contaDom.value, dados.value?.periodos ?? [], {
    inicio: novo.inicio,
    fim: novo.fim,
    tipoLancamentoId: null,
    competencia: novo.competencia || null,
  });
});
const errosPeriodo = computed(() => Object.values(conferencia.value?.erros ?? {}));
const aceitar = () => {
  const s = sugestao.value;
  if (s) void acao(() => incluirPeriodo(conta.value, { inicio: s.inicio, fim: s.fim }, chave));
};
const incluirOutro = () =>
  acao(() =>
    incluirPeriodo(
      conta.value,
      { inicio: novo.inicio, fim: novo.fim, competencia: novo.competencia || null },
      chave,
    ),
  );
const retirando = ref<number | null>(null);
const motivo = ref('');
const retirar = (id: number, versao: number) => acao(() => retirarPeriodo(id, versao, motivo.value, chave));
const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

// ── Segurado ─────────────────────────────────────────────────────────
const form = reactive<Segurado>({
  id: null,
  sequencia: null,
  coberturaPacienteId: null,
  titularCoberturaId: null,
  numeroCarteira: '',
  validadeCarteira: null,
  matriculaFuncional: null,
  cargo: null,
  padraoFuncional: null,
  classeFuncional: null,
  unidadeAdministrativa: null,
  parentescoTitular: null,
  numeroOrdem: null,
  versao: null,
});
watch(
  () => seg.data.value,
  (d) => {
    // A conta migrada pode vir sem carteira: o campo fica vazio para informar (nunca "null").
    if (d) Object.assign(form, { ...d.segurado, numeroCarteira: d.segurado.numeroCarteira ?? '' });
  },
  { immediate: true },
);
const conferenciaSegurado = computed(() =>
  dados.value ? validarSeguradoConta(dados.value.situacao, dados.value.inicioConta, form) : null,
);
const errosSegurado = computed(() => Object.values(conferenciaSegurado.value?.erros ?? {}));
const vazio = (v: string | null) => (v && v.trim() ? v.trim() : null);
const gravarSeg = () =>
  acao(
    () =>
      gravarSegurado(
        conta.value,
        {
          ...form,
          validadeCarteira: vazio(form.validadeCarteira),
          matriculaFuncional: vazio(form.matriculaFuncional),
          cargo: vazio(form.cargo),
          unidadeAdministrativa: vazio(form.unidadeAdministrativa),
          parentescoTitular: vazio(form.parentescoTitular),
        },
        chave,
      ),
    true,
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cc-titulo" data-testid="tela-complementos-conta">
    <h1 id="cc-titulo">{{ t('titulo') }}</h1>
    <RouterLink :to="{ name: 'faturamento.conta', params: { id: props.id } }">{{ t('voltar') }}</RouterLink>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="dados && !dados.editavel" role="status">{{ t('fechada') }}</p>

    <h2>{{ t('periodos') }}</h2>
    <ErroFaturamento v-if="periodos.error.value" :erro="periodos.error.value" />
    <table v-else-if="dados?.periodos.length" class="tabela" data-testid="cc-periodos">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{{ t('inicio') }}</th>
          <th scope="col">{{ t('fim') }}</th>
          <th scope="col">{{ t('competencia') }}</th>
          <th scope="col">{{ t('tipo') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in dados.periodos" :key="p.id">
          <td>{{ p.sequencia }}</td>
          <td>{{ quando(p.inicio) }}</td>
          <td>{{ quando(p.fim) }}</td>
          <td>{{ mes(p.competencia) }}</td>
          <td>{{ p.tipoLancamento ?? t('todos') }}</td>
          <td>
            <template v-if="dados.editavel">
              <button v-if="retirando !== p.id" type="button" @click="retirando = p.id">
                {{ t('retirar') }}
              </button>
              <span v-else>
                <label>
                  {{ t('motivo') }}
                  <input v-model="motivo" data-testid="cc-motivo" maxlength="300" />
                </label>
                <button
                  type="button"
                  :disabled="gravando || motivo.trim().length < 5"
                  data-testid="cc-confirmar-retirada"
                  @click="retirar(p.id, p.versao)"
                >
                  {{ t('confirmar') }}
                </button>
              </span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="dados">{{ t('semPeriodos') }}</p>

    <p v-if="sugestao" class="resumo" data-testid="cc-sugestao">
      {{
        t('sugestao', {
          inicio: quando(sugestao.inicio),
          fim: quando(sugestao.fim),
          competencia: mes(sugestao.competencia),
        })
      }}
      <button type="button" :disabled="gravando" data-testid="cc-aceitar" @click="aceitar">
        {{ t('aceitar') }}
      </button>
    </p>
    <fieldset v-if="dados?.editavel">
      <legend>{{ t('outro') }}</legend>
      <label
        >{{ t('inicio') }} <input v-model="novo.inicio" type="datetime-local" data-testid="cc-inicio"
      /></label>
      <label>{{ t('fim') }} <input v-model="novo.fim" type="datetime-local" data-testid="cc-fim" /></label>
      <label>
        {{ t('competencia') }}
        <input
          :value="novo.competencia.slice(0, 7)"
          type="month"
          @input="
            novo.competencia = ($event.target as HTMLInputElement).value
              ? `${($event.target as HTMLInputElement).value}-01`
              : ''
          "
        />
      </label>
      <ul v-if="errosPeriodo.length" class="erros" role="alert" data-testid="cc-erros-periodo">
        <li v-for="e in errosPeriodo" :key="e">{{ e }}</li>
      </ul>
      <button
        type="button"
        :disabled="gravando || !conferencia || errosPeriodo.length > 0"
        data-testid="cc-incluir"
        @click="incluirOutro"
      >
        {{ t('incluir') }}
      </button>
    </fieldset>

    <PeriodosFaturamentoConta :conta="conta" />

    <h2>{{ t('segurado') }}</h2>
    <ErroFaturamento v-if="seg.error.value" :erro="seg.error.value" />
    <template v-else-if="seg.data.value">
      <p v-if="!seg.data.value.gravado">{{ t('sugeridoCobertura') }}</p>
      <p v-if="seg.data.value.substituidos">{{ t('substituidos', { n: seg.data.value.substituidos }) }}</p>
      <form class="formulario" data-testid="cc-segurado" @submit.prevent="gravarSeg">
        <label
          >{{ t('carteira') }}
          <input v-model="form.numeroCarteira" maxlength="40" required data-testid="cc-carteira"
        /></label>
        <label>{{ t('validade') }} <input v-model="form.validadeCarteira" type="date" /></label>
        <label>{{ t('parentesco') }} <input v-model="form.parentescoTitular" maxlength="30" /></label>
        <label>{{ t('matricula') }} <input v-model="form.matriculaFuncional" maxlength="30" /></label>
        <label>{{ t('cargo') }} <input v-model="form.cargo" maxlength="60" /></label>
        <label>{{ t('unidade') }} <input v-model="form.unidadeAdministrativa" maxlength="100" /></label>
        <ul v-if="errosSegurado.length" class="erros" role="alert">
          <li v-for="e in errosSegurado" :key="e">{{ e }}</li>
        </ul>
        <p v-for="a in conferenciaSegurado?.alertas ?? []" :key="a" role="status">{{ a }}</p>
        <button
          type="submit"
          :disabled="gravando || errosSegurado.length > 0"
          data-testid="cc-gravar-segurado"
        >
          {{ t('gravar') }}
        </button>
      </form>
    </template>

    <h2>{{ t('guias') }}</h2>
    <ErroFaturamento v-if="guias.error.value" :erro="guias.error.value" />
    <template v-else-if="guias.data.value">
      <RouterLink
        :to="`/faturamento/fontes/${guias.data.value.fontePagadoraId}/atributos-guia`"
        data-testid="cc-campos-operadora"
        >{{ t('camposOperadora') }}</RouterLink
      >
      <p v-if="!guias.data.value.guias.length">{{ t('semGuias') }}</p>
      <table v-else class="tabela" data-testid="cc-guias">
        <thead>
          <tr>
            <th>{{ t('guia') }}</th>
            <th>{{ t('situacaoGuia') }}</th>
            <th>{{ t('pendentes') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in guias.data.value.guias" :key="g.id" :data-testid="`cc-guia-${g.id}`">
            <td>{{ g.numero }} · {{ g.tipoGuia }}</td>
            <td>{{ g.situacao }}</td>
            <td :class="{ erros: g.faltam.length > 0 }" data-testid="cc-guia-faltam">
              {{ g.faltam.length ? g.faltam.join(', ') : g.campos ? t('completa') : t('semCampos') }}
            </td>
            <td>
              <RouterLink :to="`/faturamento/guias/${g.id}/atributos`" data-testid="cc-guia-preencher">{{
                t('preencher')
              }}</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
