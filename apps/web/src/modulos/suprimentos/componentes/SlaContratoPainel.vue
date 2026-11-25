<script setup lang="ts">
// SLA do contrato com fornecedor (09-AREA linha 88), uma aba do contrato aberto: os SLAs com o modelo, a meta, o horário
// e os dias cobertos; o SLA novo com a validação na hora (a faixa seguinte começa onde a anterior termina: só se digita o
// "até" e a penalidade); a medição do chamado, da parada ou do realizado com o tempo coberto calculado na hora; a prévia
// da apuração do período com as parcelas impressas antes de registrar; o histórico das medições e apurações, que nunca
// some. O servidor confere tudo de novo e conta também os feriados do cadastro.
import {
  conferirSlaContrato,
  type FaixaSlaEntrada,
  minutosCobertosSla,
  minutosNaUnidadeSla,
  PENALIDADES_SLA,
  type PenalidadeSla,
  type SlaContratoEntrada,
  TIPOS_REGRA_SLA,
  type TipoRegraSla,
  type UnidadeSla,
  unidadesDoModeloSla,
  type ApuracaoSla,
} from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apurarSlaTela,
  encerrarSlaTela,
  gravarSlaTela,
  lerPainelSla,
  medirSlaTela,
  previaApuracaoSla,
} from '../api-sla-contrato.js';
import { novaChaveContrato } from '../api-contrato.js';
import { data, reais } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ contrato: number; podeEditar: boolean; podeAvaliar: boolean }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratoFornecedor.sla.${s}`, p ?? {});
const tid = (s: string) => `ctr-sla-${s}`;
const consulta = useQuery({
  queryKey: computed(() => ['contratos', 'sla', props.contrato]),
  queryFn: () => lerPainelSla(props.contrato),
});
const p = computed(() => consulta.data.value ?? null);
const mensagem = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const numero = (v: unknown): number | null => (v === '' || v === null || v === undefined ? null : Number(v));
const texto = (v: string) => (v.trim() === '' ? null : v);

async function executar(fn: () => Promise<{ mensagem: string }>, depois?: () => void): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    depois?.();
    await consulta.refetch();
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}

// ── O SLA escolhido ──
const escolhido = ref<number | null>(null);
watch(
  () => p.value?.slas,
  (slas) => {
    if (slas && (escolhido.value === null || !slas.some((s) => s.id === escolhido.value)))
      escolhido.value = slas.find((s) => s.vigente)?.id ?? slas[0]?.id ?? null;
  },
  { immediate: true },
);
const sla = computed(() => p.value?.slas.find((s) => s.id === escolhido.value) ?? null);
const cobertura = (s: {
  horarioInicio: string | null;
  horarioFim: string | null;
  somenteDiasUteis: boolean;
}) =>
  `${s.horarioInicio ? `${s.horarioInicio}–${s.horarioFim}` : k('vinteQuatro')} · ${s.somenteDiasUteis ? k('diasUteis') : k('todosDias')}`;
const vigencia = (i: string, f: string | null) => `${data(i)} – ${f ? data(f) : '…'}`;

// ── SLA novo ──
interface LinhaFaixa {
  codigo: string;
  descricao: string;
  ate: number | null;
  penalidade: PenalidadeSla;
  glosa: number | null;
  multa: number | null;
}
const form = reactive({
  descricao: '',
  servico: null as number | null,
  tipoRegra: 'tempo_atendimento' as TipoRegraSla,
  unidade: 'hora' as UnidadeSla,
  meta: null as number | null,
  horarioInicio: '',
  horarioFim: '',
  somenteDiasUteis: false,
  vigenciaInicio: '',
  vigenciaFim: '',
  faixas: [
    { codigo: 'A', descricao: '', ate: null, penalidade: 'nenhuma', glosa: null, multa: null },
  ] as LinhaFaixa[],
});
watch(
  () => p.value?.hoje,
  (h) => {
    if (h && !form.vigenciaInicio) form.vigenciaInicio = h;
  },
  { immediate: true },
);
watch(
  () => form.tipoRegra,
  (tipo) => {
    const us = unidadesDoModeloSla(tipo);
    if (!us.includes(form.unidade)) form.unidade = us[0]!;
  },
);
const opcoesModelo = TIPOS_REGRA_SLA.map((x) => ({ valor: x, rotulo: k(`modelos.${x}`) }));
const opcoesUnidade = computed(() =>
  unidadesDoModeloSla(form.tipoRegra).map((x) => ({ valor: x, rotulo: k(`unidades.${x}`) })),
);
const opcoesPenalidade = PENALIDADES_SLA.map((x) => ({ valor: x, rotulo: k(`penalidades.${x}`) }));
const opcoesServico = computed(() => [
  { valor: null, rotulo: k('novo.contratoInteiro') },
  ...(p.value?.servicos ?? []).map((s) => ({ valor: s.id, rotulo: `${s.codigo} · ${s.descricao}` })),
]);
const faixasDoForm = computed<FaixaSlaEntrada[]>(() =>
  form.faixas.map((f, i) => ({
    codigo: f.codigo.trim(),
    descricao: f.descricao.trim() || f.codigo.trim(),
    desempenhoInicio: i === 0 ? 0 : (numero(form.faixas[i - 1]!.ate) ?? 0),
    desempenhoFim: numero(f.ate),
    penalidade: f.penalidade,
    percentualGlosa: f.penalidade === 'glosa' || f.penalidade === 'glosa_e_multa' ? numero(f.glosa) : null,
    valorMulta: f.penalidade === 'multa' || f.penalidade === 'glosa_e_multa' ? numero(f.multa) : null,
  })),
);
const entrada = computed<SlaContratoEntrada>(() => ({
  servico: form.servico,
  descricao: form.descricao.trim(),
  tipoRegra: form.tipoRegra,
  unidade: form.unidade,
  meta: numero(form.meta) ?? 0,
  horarioInicio: texto(form.horarioInicio),
  horarioFim: texto(form.horarioFim),
  somenteDiasUteis: form.somenteDiasUteis,
  vigenciaInicio: form.vigenciaInicio,
  vigenciaFim: texto(form.vigenciaFim),
  faixas: faixasDoForm.value,
}));
const recusasNovo = computed(() =>
  p.value ? conferirSlaContrato(entrada.value, p.value.contrato).map((r) => r.mensagem) : [],
);
function maisFaixa(): void {
  const letra = String.fromCharCode(65 + form.faixas.length);
  form.faixas.push({
    codigo: letra,
    descricao: '',
    ate: null,
    penalidade: 'nenhuma',
    glosa: null,
    multa: null,
  });
}
let chaveSla = novaChaveContrato('sla');
function gravarSla(): Promise<void> {
  return executar(
    () => gravarSlaTela(props.contrato, entrada.value, chaveSla),
    () => {
      chaveSla = novaChaveContrato('sla');
      form.descricao = '';
      form.meta = null;
    },
  );
}

// ── Medição ──
const medicao = reactive({ inicio: '', fim: '', quantidade: null as number | null, descricao: '' });
const producao = computed(() => sla.value?.tipoRegra === 'producao');
const parada = computed(() => sla.value?.tipoRegra === 'disponibilidade');
const previaCoberta = computed(() => {
  const s = sla.value;
  if (!s || producao.value || !medicao.inicio || !medicao.fim) return '';
  const min = minutosCobertosSla(medicao.inicio, medicao.fim, { ...s, feriados: new Set() });
  return parada.value
    ? k('medir.cobertoParada', { valor: num(min) })
    : k('medir.coberto', {
        valor: num(minutosNaUnidadeSla(min, s.unidade)),
        unidade: k(`unidades.${s.unidade}`),
        meta: `${num(s.meta)} ${k(`unidades.${s.unidade}`)}`,
      });
});
let chaveMedicao = novaChaveContrato('sla-medicao');
function medir(): Promise<void> {
  const s = sla.value;
  if (!s) return Promise.resolve();
  const inicio = producao.value && medicao.inicio.length === 10 ? `${medicao.inicio}T00:00` : medicao.inicio;
  return executar(
    () =>
      medirSlaTela(
        props.contrato,
        s.id,
        {
          inicio,
          fim: producao.value ? null : texto(medicao.fim),
          quantidade: producao.value ? numero(medicao.quantidade) : null,
          descricao: medicao.descricao.trim(),
        },
        chaveMedicao,
      ),
    () => {
      chaveMedicao = novaChaveContrato('sla-medicao');
      Object.assign(medicao, { inicio: '', fim: '', quantidade: null, descricao: '' });
    },
  );
}

// ── Apuração ──
const apuracao = reactive({ inicio: '', fim: '', valorFatura: null as number | null });
const previa = ref<ApuracaoSla | null>(null);
watch([() => apuracao.inicio, () => apuracao.fim, () => apuracao.valorFatura, escolhido], () => {
  previa.value = null;
});
const periodo = () => ({
  inicio: apuracao.inicio,
  fim: apuracao.fim,
  valorFatura: numero(apuracao.valorFatura),
});
async function verPrevia(): Promise<void> {
  const s = sla.value;
  if (!s) return;
  erro.value = null;
  try {
    previa.value = await previaApuracaoSla(props.contrato, s.id, periodo());
  } catch (e) {
    erro.value = e;
  }
}
let chaveApuracao = novaChaveContrato('sla-apuracao');
function apurar(): Promise<void> {
  const s = sla.value;
  if (!s) return Promise.resolve();
  return executar(
    () => apurarSlaTela(props.contrato, s.id, periodo(), chaveApuracao),
    () => {
      chaveApuracao = novaChaveContrato('sla-apuracao');
      previa.value = null;
    },
  );
}

// ── Encerramento ──
const fimSla = ref('');
function encerrar(): Promise<void> {
  const s = sla.value;
  if (!s || !fimSla.value) return Promise.resolve();
  return executar(
    () => encerrarSlaTela(props.contrato, s.id, fimSla.value, s.versao),
    () => (fimSla.value = ''),
  );
}
</script>

<template>
  <section class="sla-contrato" :data-testid="tid('painel')">
    <p class="secundario">{{ k('explica') }}</p>
    <ErroSuprimentos v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-if="mensagem" role="status" :data-testid="tid('mensagem')">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <template v-if="p">
      <p v-if="p.slas.length === 0" :data-testid="tid('nenhum')">{{ k('nenhum') }}</p>
      <div v-else class="rolagem">
        <table class="grade">
          <thead>
            <tr>
              <th scope="col">{{ k('colDescricao') }}</th>
              <th scope="col">{{ k('colModelo') }}</th>
              <th scope="col">{{ k('colMeta') }}</th>
              <th scope="col">{{ k('colCobertura') }}</th>
              <th scope="col">{{ k('colVigencia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in p.slas"
              :key="s.id"
              :aria-selected="s.id === escolhido"
              :data-testid="tid(`linha-${s.id}`)"
            >
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="s.descricao"
                  :aria-label="k('abrir', { descricao: s.descricao })"
                  :data-testid="tid(`abrir-${s.id}`)"
                  @acionar="escolhido = s.id"
                />
                <span v-if="s.servicoDescricao" class="secundario"> · {{ s.servicoDescricao }}</span>
              </td>
              <td>{{ k(`modelos.${s.tipoRegra}`) }}</td>
              <td>{{ num(s.meta) }} {{ k(`unidades.${s.unidade}`) }}</td>
              <td>{{ cobertura(s) }}</td>
              <td>
                {{ vigencia(s.vigenciaInicio, s.vigenciaFim) }} ·
                {{ s.vigente ? k('vigente') : k('foraVigencia') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="sla">
        <h3 :data-testid="tid('escolhido')">{{ sla.descricao }}</h3>
        <ul class="secundario" :data-testid="tid('faixas')">
          <li v-for="f in sla.faixas" :key="f.codigo">
            {{ f.codigo }} · {{ f.descricao }}: {{ num(f.desempenhoInicio) }}%
            {{ f.desempenhoFim === null ? '+' : `– ${num(f.desempenhoFim)}%` }} ·
            {{ k(`penalidades.${f.penalidade}`) }}
            <template v-if="f.percentualGlosa !== null"> {{ num(f.percentualGlosa) }}%</template>
            <template v-if="f.valorMulta !== null"> {{ reais(f.valorMulta) }}</template>
          </li>
        </ul>

        <form v-if="podeEditar && sla.vigente" class="formulario-contrato" @submit.prevent="medir">
          <h4>{{ k('medir.titulo') }}</h4>
          <div class="barra">
            <span class="campo">
              <label for="ctr-sla-med-inicio">{{
                producao ? k('medir.dia') : parada ? k('medir.inicioParada') : k('medir.inicioTempo')
              }}</label>
              <input
                id="ctr-sla-med-inicio"
                v-model="medicao.inicio"
                :type="producao ? 'date' : 'datetime-local'"
                :max="producao ? p.hoje : p.agora"
                :data-testid="tid('med-inicio')"
              />
            </span>
            <span v-if="!producao" class="campo">
              <label for="ctr-sla-med-fim">{{ parada ? k('medir.fimParada') : k('medir.fimTempo') }}</label>
              <input
                id="ctr-sla-med-fim"
                v-model="medicao.fim"
                type="datetime-local"
                :min="medicao.inicio"
                :max="p.agora"
                :data-testid="tid('med-fim')"
              />
            </span>
            <span v-else class="campo">
              <label for="ctr-sla-med-qtd">{{ k('medir.quantidade') }}</label>
              <input
                id="ctr-sla-med-qtd"
                v-model.number="medicao.quantidade"
                type="number"
                min="0"
                step="any"
                :data-testid="tid('med-quantidade')"
              />
            </span>
          </div>
          <span class="campo campo-largo">
            <label for="ctr-sla-med-desc">{{ k('medir.descricao') }}</label>
            <input
              id="ctr-sla-med-desc"
              v-model="medicao.descricao"
              maxlength="2000"
              :data-testid="tid('med-descricao')"
            />
          </span>
          <p v-if="previaCoberta" role="status" :data-testid="tid('med-previa')">{{ previaCoberta }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="k('medir.gravar')"
            :desabilitado="enviando || !medicao.inicio || !medicao.descricao.trim()"
            :data-testid="tid('med-gravar')"
          />
        </form>

        <h4>{{ k('medicoes') }}</h4>
        <p v-if="sla.medicoes.length === 0">{{ k('semMedicao') }}</p>
        <div v-else class="rolagem">
          <table class="grade" :data-testid="tid('medicoes')">
            <thead>
              <tr>
                <th scope="col">{{ k('colInicio') }}</th>
                <th scope="col">{{ k('colFim') }}</th>
                <th scope="col">{{ k('colMedido') }}</th>
                <th scope="col">{{ k('medir.descricao') }}</th>
                <th scope="col">{{ k('colUsuario') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in sla.medicoes" :key="m.id" :data-testid="tid(`medicao-${m.id}`)">
                <td>{{ data(m.inicio) }} {{ m.inicio.slice(11, 16) }}</td>
                <td>{{ m.fim ? `${data(m.fim)} ${m.fim.slice(11, 16)}` : '—' }}</td>
                <td>{{ m.medido === null ? '—' : num(m.medido) }}</td>
                <td>{{ m.descricao }}</td>
                <td>{{ m.usuario ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <form v-if="podeAvaliar" class="formulario-contrato" @submit.prevent="apurar">
          <h4>{{ k('apurar.titulo') }}</h4>
          <div class="barra">
            <span class="campo">
              <label for="ctr-sla-ap-inicio">{{ k('apurar.inicio') }}</label>
              <input
                id="ctr-sla-ap-inicio"
                v-model="apuracao.inicio"
                type="date"
                :min="sla.vigenciaInicio"
                :data-testid="tid('ap-inicio')"
              />
            </span>
            <span class="campo">
              <label for="ctr-sla-ap-fim">{{ k('apurar.fim') }}</label>
              <input
                id="ctr-sla-ap-fim"
                v-model="apuracao.fim"
                type="date"
                :min="apuracao.inicio"
                :data-testid="tid('ap-fim')"
              />
            </span>
            <span class="campo">
              <label for="ctr-sla-ap-fatura">{{ k('apurar.valorFatura') }}</label>
              <input
                id="ctr-sla-ap-fatura"
                v-model.number="apuracao.valorFatura"
                type="number"
                min="0"
                step="0.01"
                :data-testid="tid('ap-fatura')"
              />
            </span>
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="k('apurar.previa')"
            :desabilitado="!apuracao.inicio || !apuracao.fim"
            :data-testid="tid('ap-previa')"
            @acionar="verPrevia"
          />
          <div v-if="previa" role="status" :data-testid="tid('ap-resultado')">
            <p>
              {{
                k('apurar.desempenho', {
                  valor: num(previa.desempenho),
                  faixa: previa.faixa?.codigo ?? '—',
                  total: reais(previa.total),
                })
              }}
            </p>
            <ul>
              <li v-for="(x, i) in previa.parcelas" :key="i">{{ x }}</li>
            </ul>
          </div>
          <SanteBotao
            tipo="submit"
            :rotulo="k('apurar.gravar')"
            :desabilitado="enviando || !previa"
            :data-testid="tid('ap-gravar')"
          />
        </form>

        <h4>{{ k('apuracoes') }}</h4>
        <p v-if="sla.apuracoes.length === 0">{{ k('semApuracao') }}</p>
        <div v-else class="rolagem">
          <table class="grade" :data-testid="tid('apuracoes')">
            <thead>
              <tr>
                <th scope="col">{{ k('colPeriodo') }}</th>
                <th scope="col">{{ k('colDesempenho') }}</th>
                <th scope="col">{{ k('colFaixa') }}</th>
                <th scope="col">{{ k('colTotal') }}</th>
                <th scope="col">{{ k('colUsuario') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in sla.apuracoes" :key="a.id" :data-testid="tid(`apuracao-${a.id}`)">
                <td>{{ vigencia(a.inicio, a.fim) }}</td>
                <td>{{ num(a.desempenho) }}%</td>
                <td>{{ a.faixa ?? '—' }}</td>
                <td :title="a.parcelas.join('\n')">{{ reais(a.total) }}</td>
                <td>{{ a.usuario ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <form
          v-if="podeEditar && sla.vigenciaFim === null"
          class="formulario-contrato"
          @submit.prevent="encerrar"
        >
          <h4>{{ k('encerrar.titulo') }}</h4>
          <span class="campo">
            <label for="ctr-sla-fim">{{ k('encerrar.fim') }}</label>
            <input
              id="ctr-sla-fim"
              v-model="fimSla"
              type="date"
              :min="sla.vigenciaInicio"
              :data-testid="tid('fim')"
            />
          </span>
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="k('encerrar.gravar')"
            :desabilitado="enviando || !fimSla"
            :data-testid="tid('encerrar')"
          />
        </form>
      </template>

      <form v-if="podeEditar" class="formulario-contrato" @submit.prevent="gravarSla">
        <h3>{{ k('novo.titulo') }}</h3>
        <div class="barra">
          <span class="campo campo-largo">
            <label for="ctr-sla-descricao">{{ k('novo.descricao') }}</label>
            <input
              id="ctr-sla-descricao"
              v-model="form.descricao"
              maxlength="150"
              :data-testid="tid('descricao')"
            />
          </span>
          <SanteSelecao
            v-model="form.servico"
            :rotulo="k('novo.servico')"
            :opcoes="opcoesServico"
            :data-testid="tid('servico')"
          />
          <SanteSelecao
            v-model="form.tipoRegra"
            :rotulo="k('novo.modelo')"
            :opcoes="opcoesModelo"
            :data-testid="tid('modelo')"
          />
          <SanteSelecao
            v-model="form.unidade"
            :rotulo="k('novo.unidade')"
            :opcoes="opcoesUnidade"
            :data-testid="tid('unidade')"
          />
          <span class="campo">
            <label for="ctr-sla-meta">{{ k('novo.meta') }}</label>
            <input
              id="ctr-sla-meta"
              v-model.number="form.meta"
              type="number"
              min="0"
              step="any"
              :data-testid="tid('meta')"
            />
          </span>
        </div>
        <div class="barra">
          <span class="campo">
            <label for="ctr-sla-hi">{{ k('novo.horarioInicio') }}</label>
            <input
              id="ctr-sla-hi"
              v-model="form.horarioInicio"
              type="time"
              :data-testid="tid('horario-inicio')"
            />
          </span>
          <span class="campo">
            <label for="ctr-sla-hf">{{ k('novo.horarioFim') }}</label>
            <input id="ctr-sla-hf" v-model="form.horarioFim" type="time" :data-testid="tid('horario-fim')" />
          </span>
          <span class="campo">
            <label for="ctr-sla-uteis">
              <input
                id="ctr-sla-uteis"
                v-model="form.somenteDiasUteis"
                type="checkbox"
                :data-testid="tid('dias-uteis')"
              />
              {{ k('novo.diasUteis') }}
            </label>
          </span>
          <span class="campo">
            <label for="ctr-sla-vi">{{ k('novo.vigenciaInicio') }}</label>
            <input
              id="ctr-sla-vi"
              v-model="form.vigenciaInicio"
              type="date"
              :min="p.contrato.inicio"
              :data-testid="tid('vigencia-inicio')"
            />
          </span>
          <span class="campo">
            <label for="ctr-sla-vf">{{ k('novo.vigenciaFim') }}</label>
            <input
              id="ctr-sla-vf"
              v-model="form.vigenciaFim"
              type="date"
              :min="form.vigenciaInicio"
              :data-testid="tid('vigencia-fim')"
            />
          </span>
        </div>
        <h4>{{ k('novo.faixas') }}</h4>
        <div class="rolagem">
          <table class="grade" :data-testid="tid('faixas-form')">
            <thead>
              <tr>
                <th scope="col">{{ k('novo.faixaCodigo') }}</th>
                <th scope="col">{{ k('novo.faixaDescricao') }}</th>
                <th scope="col">{{ k('novo.faixaDe') }}</th>
                <th scope="col">{{ k('novo.faixaAte') }}</th>
                <th scope="col">{{ k('novo.faixaPenalidade') }}</th>
                <th scope="col">{{ k('novo.faixaGlosa') }}</th>
                <th scope="col">{{ k('novo.faixaMulta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in form.faixas" :key="i">
                <td>
                  <input
                    v-model="f.codigo"
                    maxlength="5"
                    size="4"
                    :aria-label="k('novo.faixaCodigo')"
                    :data-testid="tid(`faixa-${i}-codigo`)"
                  />
                </td>
                <td>
                  <input
                    v-model="f.descricao"
                    maxlength="60"
                    :aria-label="k('novo.faixaDescricao')"
                    :data-testid="tid(`faixa-${i}-descricao`)"
                  />
                </td>
                <td>{{ num(faixasDoForm[i]!.desempenhoInicio) }}%</td>
                <td>
                  <input
                    v-model.number="f.ate"
                    type="number"
                    min="0"
                    step="any"
                    :aria-label="k('novo.faixaAte')"
                    :data-testid="tid(`faixa-${i}-ate`)"
                  />
                </td>
                <td>
                  <SanteSelecao
                    v-model="f.penalidade"
                    :rotulo="k('novo.faixaPenalidade')"
                    :opcoes="opcoesPenalidade"
                    :data-testid="tid(`faixa-${i}-penalidade`)"
                  />
                </td>
                <td>
                  <input
                    v-model.number="f.glosa"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    :disabled="f.penalidade !== 'glosa' && f.penalidade !== 'glosa_e_multa'"
                    :aria-label="k('novo.faixaGlosa')"
                    :data-testid="tid(`faixa-${i}-glosa`)"
                  />
                </td>
                <td>
                  <input
                    v-model.number="f.multa"
                    type="number"
                    min="0"
                    step="0.01"
                    :disabled="f.penalidade !== 'multa' && f.penalidade !== 'glosa_e_multa'"
                    :aria-label="k('novo.faixaMulta')"
                    :data-testid="tid(`faixa-${i}-multa`)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="barra">
          <SanteBotao
            variante="secundario"
            :rotulo="k('novo.maisFaixa')"
            :desabilitado="form.faixas.length >= 10"
            :data-testid="tid('mais-faixa')"
            @acionar="maisFaixa"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('novo.menosFaixa')"
            :desabilitado="form.faixas.length <= 1"
            :data-testid="tid('menos-faixa')"
            @acionar="form.faixas.pop()"
          />
        </div>
        <SanteAlerta
          v-for="(r, i) in recusasNovo"
          :key="i"
          variante="aviso"
          :texto="r"
          :data-testid="tid(`recusa-${i}`)"
        />
        <p class="secundario">{{ k('novo.substitui') }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('novo.gravar')"
          :desabilitado="enviando || recusasNovo.length > 0"
          :data-testid="tid('gravar')"
        />
      </form>
    </template>
  </section>
</template>
