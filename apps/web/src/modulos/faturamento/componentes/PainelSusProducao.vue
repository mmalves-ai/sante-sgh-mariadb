<script setup lang="ts">
// O painel produção × meta do contrato SUS (regra 11): na competência escolhida, o período de cada meta que vale nela, a
// meta do período, o realizado (pela produção do faturamento SUS ou das contas SUS, e por competência), o cumprimento, o
// escore e os pontos, com as parcelas impressas; o repasse estimado (partes do pré-fixado pela faixa, incentivos e
// pós-fixado) com as contas; as faixas e os avisos. A apuração fecha o período (faturamento.registrarApuracaoSus): na
// quantitativa o servidor lê a produção; na qualitativa o analista informa o resultado. A apuração registrada se corrige
// na mesma linha ("Corrigir a apuração"), pela versão dela (versaoVista).
import type { ResultadoMetaSus } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apurarMetaSus, lerPainelSus, novaChaveSus } from '../api-contratualizacao.js';
import { num } from '../usar-faturamento.js';
import {
  competenciaDoCampo,
  competenciaParaCampo,
  competenciaTexto,
  numeroDe,
  periodoEncerrado,
  reaisDeCentavos,
  rotuloEscore,
  rotuloFonte,
  rotuloOrigem,
  rotuloTipoMeta,
} from './contratualizacao-tela.js';
import ErroFaturamento from './ErroFaturamento.vue';

const props = defineProps<{
  contrato: number;
  competencia: string;
  competenciaAtual: string;
  pode: boolean;
}>();
const emit = defineEmits<{ apurado: [mensagem: string] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.painel.${s}`, p ?? {});

const campo = ref(competenciaParaCampo(props.competencia));
const escolhida = ref(props.competencia);
const painel = useQuery({
  queryKey: computed(() => ['contratualizacao', 'painel', props.contrato, escolhida.value]),
  queryFn: () => lerPainelSus(props.contrato, escolhida.value),
});
const dados = computed(() => painel.data.value ?? null);
function ver(): void {
  const c = competenciaDoCampo(campo.value);
  if (c) escolhida.value = c;
}

const pct = (v: number | null) => (v === null ? '—' : `${num(v)}%`);
const valor = (v: number | null) => (v === null ? '—' : num(v));

// A apuração de uma meta: registrar a do período fechado sem apuração, ou corrigir a já registrada pela versão dela
// (o servidor reapura a quantitativa pela produção e regrava a qualitativa com o resultado informado).
const apurando = ref<number | null>(null);
const corrigindo = ref(false);
const ap = reactive({ realizado: '', observacao: '' });
const erro = ref<unknown>(null);
const enviando = ref(false);
let chave = novaChaveSus('apuracao');
const podeApurar = (r: ResultadoMetaSus) =>
  props.pode && !r.apurada && periodoEncerrado(r.periodo.fim, props.competenciaAtual);
const podeCorrigir = (r: ResultadoMetaSus) => props.pode && r.apuracaoRegistrada !== null;
function abrirApuracao(r: ResultadoMetaSus): void {
  apurando.value = r.meta;
  corrigindo.value = false;
  ap.realizado = '';
  ap.observacao = '';
  erro.value = null;
  chave = novaChaveSus('apuracao');
}
function abrirCorrecao(r: ResultadoMetaSus): void {
  apurando.value = r.meta;
  corrigindo.value = true;
  ap.realizado =
    r.tipo === 'qualitativa' && r.realizado !== null ? String(r.realizado).replace('.', ',') : '';
  ap.observacao = r.apuracaoRegistrada?.observacao ?? '';
  erro.value = null;
  chave = novaChaveSus('apuracao');
}
function fechar(): void {
  apurando.value = null;
  corrigindo.value = false;
}
const faltaRealizado = (r: ResultadoMetaSus) => r.tipo === 'qualitativa' && numeroDe(ap.realizado) === null;
async function apurar(r: ResultadoMetaSus): Promise<void> {
  if (faltaRealizado(r)) return;
  erro.value = null;
  enviando.value = true;
  try {
    const x = await apurarMetaSus(
      r.meta,
      {
        competencia: r.periodo.fim,
        realizado: r.tipo === 'qualitativa' ? numeroDe(ap.realizado) : null,
        observacao: ap.observacao.trim() || null,
        versaoVista: corrigindo.value ? (r.apuracaoRegistrada?.versao ?? null) : null,
      },
      chave,
    );
    apurando.value = null;
    corrigindo.value = false;
    await painel.refetch();
    emit('apurado', x.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="painel-sus" aria-labelledby="ps-titulo" data-testid="ps-painel">
    <h3 id="ps-titulo">{{ k('titulo') }}</h3>
    <form class="barra" @submit.prevent="ver">
      <span class="campo">
        <label for="ps-competencia">{{ k('competencia') }}</label>
        <input id="ps-competencia" v-model="campo" type="month" required data-testid="ps-competencia" />
      </span>
      <SanteBotao tipo="submit" variante="secundario" :rotulo="k('atualizar')" data-testid="ps-ver" />
    </form>
    <ErroFaturamento v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!dados" role="status">{{ t('contratualizacaoSus.carregando') }}</p>
    <template v-else>
      <p class="secundario" data-testid="ps-fonte">
        {{ t('contratualizacaoSus.fonte', { fonte: rotuloFonte(dados.fonte) }) }}
      </p>
      <div v-if="dados.avisos.length" role="note" data-testid="ps-avisos">
        <SanteAlerta v-for="(a, i) in dados.avisos" :key="i" variante="aviso" :texto="a" />
      </div>
      <p v-if="!dados.resultados.length" data-testid="ps-vazio">{{ k('nenhumaMeta') }}</p>
      <div v-else class="rolagem">
        <table class="grade" data-testid="ps-resultados">
          <caption class="sgh-visualmente-oculto">
            {{
              k('titulo')
            }}
            ·
            {{
              competenciaTexto(dados.competencia)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ k('colMeta') }}</th>
              <th scope="col">{{ k('colPeriodo') }}</th>
              <th scope="col">{{ k('colMetaPeriodo') }}</th>
              <th scope="col">{{ k('colRealizado') }}</th>
              <th scope="col">{{ k('colCumprimento') }}</th>
              <th scope="col">{{ k('colEscore') }}</th>
              <th scope="col">{{ k('colPontos') }}</th>
              <th scope="col">{{ k('colConta') }}</th>
              <th scope="col">{{ k('colAcoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in dados.resultados" :key="r.meta" :data-testid="`ps-meta-${r.meta}`">
              <td>
                {{ r.descricao }}<br /><span class="secundario">{{ rotuloTipoMeta(r.tipo) }}</span>
              </td>
              <td>
                {{
                  k('periodo', {
                    inicio: competenciaTexto(r.periodo.inicio),
                    fim: competenciaTexto(r.periodo.fim),
                  })
                }}
              </td>
              <td>{{ valor(r.metaPeriodo) }}</td>
              <td :data-testid="`ps-realizado-${r.meta}`">
                {{ r.realizado === null ? k('semResultado') : valor(r.realizado) }}
                <details v-if="r.realizadoPorCompetencia.length">
                  <summary>{{ k('porCompetencia') }}</summary>
                  <ul>
                    <li v-for="p in r.realizadoPorCompetencia" :key="p.competencia">
                      {{ competenciaTexto(p.competencia) }}: {{ valor(p.quantidade) }}
                    </li>
                  </ul>
                </details>
              </td>
              <td>{{ pct(r.cumprimentoPct) }}</td>
              <td :data-testid="`ps-escore-${r.meta}`">
                {{ r.escore === null ? '—' : rotuloEscore(r.escore) }}
              </td>
              <td>{{ r.pontosObtidos === null ? '—' : `${valor(r.pontosObtidos)} / ${r.pontos}` }}</td>
              <td>
                <ul class="contas">
                  <li v-for="(c, i) in r.conta" :key="i">{{ c }}</li>
                </ul>
              </td>
              <td>
                <template v-if="apurando !== r.meta && r.apurada">
                  <span>{{ k('apurada', { origem: rotuloOrigem(r.origem) }) }}</span>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="k('corrigir')"
                    :desabilitado="!podeCorrigir(r)"
                    :data-testid="`ps-corrigir-${r.meta}`"
                    @acionar="abrirCorrecao(r)"
                  />
                </template>
                <span
                  v-else-if="apurando !== r.meta && !periodoEncerrado(r.periodo.fim, competenciaAtual)"
                  class="secundario"
                >
                  {{ k('periodoAberto', { fim: competenciaTexto(r.periodo.fim) }) }}
                </span>
                <SanteBotao
                  v-else-if="apurando !== r.meta"
                  variante="secundario"
                  :rotulo="k('registrar')"
                  :desabilitado="!podeApurar(r)"
                  :data-testid="`ps-apurar-${r.meta}`"
                  @acionar="abrirApuracao(r)"
                />
                <form
                  v-else
                  class="formulario-sus"
                  :data-testid="`ps-apuracao-${r.meta}`"
                  @submit.prevent="apurar(r)"
                >
                  <p v-if="corrigindo" class="secundario" :data-testid="`ps-corrigindo-${r.meta}`">
                    {{ k('explicaCorrecao') }}
                  </p>
                  <p v-if="r.tipo === 'quantitativa'" class="secundario">
                    {{ corrigindo ? k('explicaQuantiCorrecao') : k('explicaQuanti') }}
                  </p>
                  <span v-else class="campo">
                    <label :for="`ps-realizado-campo-${r.meta}`">{{ k('realizado') }}</label>
                    <input
                      :id="`ps-realizado-campo-${r.meta}`"
                      v-model="ap.realizado"
                      inputmode="decimal"
                      maxlength="14"
                      required
                      :data-testid="`ps-realizado-campo-${r.meta}`"
                    />
                  </span>
                  <span class="campo">
                    <label :for="`ps-obs-${r.meta}`">{{ k('observacao') }}</label>
                    <input :id="`ps-obs-${r.meta}`" v-model="ap.observacao" maxlength="500" />
                  </span>
                  <ErroFaturamento v-if="erro" :erro="erro" />
                  <SanteBotao
                    tipo="submit"
                    :rotulo="corrigindo ? k('confirmarCorrecao') : k('confirmar')"
                    :desabilitado="enviando || faltaRealizado(r)"
                    :data-testid="`ps-confirmar-${r.meta}`"
                  />
                  <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="fechar" />
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="dados.repasse" aria-labelledby="ps-repasse" data-testid="ps-repasse">
        <h4 id="ps-repasse">{{ k('repasse') }}</h4>
        <p class="secundario">{{ k('repasseMeses', { n: dados.repasse.meses }) }}</p>
        <div class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ k('colParte') }}</th>
                <th scope="col">{{ k('colValor') }}</th>
                <th scope="col">{{ k('colPontosParte') }}</th>
                <th scope="col">{{ k('colCumprimento') }}</th>
                <th scope="col">{{ k('colRepassePct') }}</th>
                <th scope="col">{{ k('colRepasse') }}</th>
                <th scope="col">{{ k('colConta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in dados.repasse.partes" :key="p.tipo" :data-testid="`ps-parte-${p.tipo}`">
                <td>{{ rotuloTipoMeta(p.tipo) }}</td>
                <td>{{ reaisDeCentavos(p.valorCentavos) }}</td>
                <td>{{ valor(p.pontosObtidos) }} / {{ p.pontosPossiveis }}</td>
                <td>{{ pct(p.cumprimentoPct) }}</td>
                <td>{{ pct(p.repassePct) }}</td>
                <td>{{ reaisDeCentavos(p.repasseCentavos) }}</td>
                <td>
                  <ul class="contas">
                    <li v-for="(c, i) in p.conta" :key="i">{{ c }}</li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl class="resumo-sus">
          <dt>{{ k('preFixado') }}</dt>
          <dd>{{ reaisDeCentavos(dados.repasse.preFixadoCentavos) }}</dd>
          <dt>{{ k('incentivos') }}</dt>
          <dd>{{ reaisDeCentavos(dados.repasse.incentivosCentavos) }}</dd>
          <dt>{{ k('posFixado') }}</dt>
          <dd>{{ reaisDeCentavos(dados.repasse.posFixadoEstimadoCentavos) }}</dd>
          <dt>{{ k('total') }}</dt>
          <dd data-testid="ps-total">
            {{
              dados.repasse.totalEstimadoCentavos === null
                ? k('totalPendente')
                : reaisDeCentavos(dados.repasse.totalEstimadoCentavos)
            }}
          </dd>
        </dl>
        <details open>
          <summary>{{ k('parcelas') }}</summary>
          <ul class="contas" data-testid="ps-contas">
            <li v-for="(c, i) in dados.repasse.conta" :key="i">{{ c }}</li>
          </ul>
        </details>
      </section>

      <details data-testid="ps-faixas">
        <summary>{{ k('faixas') }}</summary>
        <ul>
          <li v-for="x in dados.faixas" :key="x.escore">
            {{ k('faixa', { minimo: x.minimoPct, escore: rotuloEscore(x.escore), repasse: x.repassePct }) }}
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>
