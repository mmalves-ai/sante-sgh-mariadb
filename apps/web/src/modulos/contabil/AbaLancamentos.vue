<script setup lang="ts">
// Aba Lançamentos (M54.2): a lista paginada no servidor com filtros (competência, tipo, conta; combos com busca, ADR
// 0027), o detalhe com as partidas, o fato de origem e a regra, o estorno (justificativa e data opcional;
// `contabil.lancamento.estornar`) e o lançamento manual (`contabil.lancamento.criar`). Lançamento gravado não muda.
import {
  type ApoioLancamentos,
  CODIGOS_TIPO_LANCAMENTO,
  type LancamentoListado,
  type ResultadoLancamento,
  rotuloDaFonte,
  type TipoLancamento,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import ErroContabil from './ErroContabil.vue';
import { estornarLancamento, lerDetalheLancamento, lerLancamentos } from './api-lancamentos.js';
import { competenciasAte, dataBr, instante, reais, rotuloCompetencia } from './comum-contabil.js';
import FormLancamentoManual from './FormLancamentoManual.vue';

const props = defineProps<{
  apoio: ApoioLancamentos;
  empresa: number;
  hoje: string;
  contaInicial?: string | null;
  competenciaInicial?: string | null;
}>();
const { t } = useI18n();
const cliente = useQueryClient();

const competencia = ref<string | null>(props.competenciaInicial ?? null);
const tipo = ref<TipoLancamento | null>(null);
const conta = ref<string | null>(props.contaInicial ?? null);
const pagina = ref(1);
const TAMANHO = 50;
const opcoesCompetencia = [
  { valor: null as string | null, rotulo: t('contabil.todas') },
  ...competenciasAte(props.hoje, 36).map((c) => ({
    valor: c as string | null,
    rotulo: rotuloCompetencia(c),
  })),
];
const opcoesTipo = [
  { valor: null as TipoLancamento | null, rotulo: t('contabil.todos') },
  ...CODIGOS_TIPO_LANCAMENTO.map((x) => ({
    valor: x as TipoLancamento | null,
    rotulo: t(`contabil.lancamentos.tipos.${x}`),
  })),
];
const opcoesConta = computed(() => [
  { valor: null as string | null, rotulo: t('contabil.todas') },
  ...props.apoio.contas.map((c) => ({ valor: c.codigo as string | null, rotulo: `${c.codigo} ${c.nome}` })),
]);
watch([competencia, tipo, conta, () => props.empresa], () => {
  pagina.value = 1;
});

const lista = useQuery({
  queryKey: computed(() => [
    'contabil',
    'lancamentos',
    props.empresa,
    competencia.value,
    tipo.value,
    conta.value,
    pagina.value,
  ]),
  queryFn: () =>
    lerLancamentos({
      empresa: props.empresa,
      competencia: competencia.value,
      tipo: tipo.value,
      conta: conta.value,
      pagina: pagina.value,
      tamanho: TAMANHO,
    }),
});
const l = computed(() => lista.data.value ?? null);
const paginas = computed(() => Math.max(1, Math.ceil((l.value?.total ?? 0) / TAMANHO)));

// ── Detalhe e estorno ───────────────────────────────────────────────────────────────────────────────
const abertoId = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['contabil', 'lancamento', props.empresa, abertoId.value]),
  queryFn: () => lerDetalheLancamento(props.empresa, abertoId.value!),
  enabled: computed(() => abertoId.value !== null),
});
const d = computed(() => (abertoId.value === null ? null : (detalhe.data.value ?? null)));
const estornando = ref(false);
const justificativa = ref('');
const dataEstorno = ref<string | null>(null);
const erroEstorno = ref<unknown>(null);
const ocupado = ref(false);
const resultado = ref<ResultadoLancamento | null>(null);
function abrir(x: LancamentoListado) {
  abertoId.value = x.id;
  estornando.value = false;
  justificativa.value = '';
  dataEstorno.value = null;
  erroEstorno.value = null;
}
async function estornar() {
  if (!d.value) return;
  ocupado.value = true;
  erroEstorno.value = null;
  try {
    resultado.value = await estornarLancamento({
      empresa: props.empresa,
      id: d.value.id,
      ...(dataEstorno.value ? { data: dataEstorno.value } : {}),
      justificativa: justificativa.value.trim(),
    });
    estornando.value = false;
    await cliente.invalidateQueries({ queryKey: ['contabil'] });
  } catch (e) {
    erroEstorno.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Manual ───────────────────────────────────────────────────────────────────────────────────────────
const novo = ref(false);
async function gravado(r: ResultadoLancamento) {
  resultado.value = r;
  novo.value = false;
  abertoId.value = r.id;
  await cliente.invalidateQueries({ queryKey: ['contabil'] });
}
</script>

<template>
  <section class="bloco" aria-labelledby="aba-lancamentos-titulo" data-testid="aba-lancamentos">
    <h2 id="aba-lancamentos-titulo">{{ t('contabil.lancamentos.lista') }}</h2>
    <p v-if="resultado" role="status" data-testid="lancamento-resultado">{{ resultado.mensagem }}</p>
    <div v-if="apoio.podeLancar && !novo" class="acoes">
      <SanteBotao
        :rotulo="t('contabil.lancamentos.novoManual')"
        data-testid="lancamento-novo"
        @acionar="novo = true"
      />
    </div>
    <FormLancamentoManual
      v-if="novo"
      :apoio="apoio"
      :empresa="empresa"
      :hoje="hoje"
      @gravado="gravado"
      @cancelar="novo = false"
    />

    <div class="campos" data-testid="lancamentos-filtros">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('contabil.competencia')"
        :opcoes="opcoesCompetencia"
        busca
        data-testid="lancamentos-competencia"
      />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('contabil.lancamentos.tipo')"
        :opcoes="opcoesTipo"
        busca
        data-testid="lancamentos-tipo"
      />
      <SanteSelecao
        v-model="conta"
        :rotulo="t('contabil.lancamentos.conta')"
        :opcoes="opcoesConta"
        busca
        data-testid="lancamentos-conta"
      />
    </div>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!l" role="status">{{ t('contabil.carregando') }}</p>
    <p v-else-if="l.itens.length === 0" data-testid="lancamentos-vazio">{{ t('contabil.nenhum') }}</p>
    <template v-else>
      <div class="rolagem">
        <table class="tabela" data-testid="tabela-lancamentos">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.lancamentos.numero') }}</th>
              <th scope="col">{{ t('contabil.data') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.tipo') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.historico') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.debitos') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.creditos') }}</th>
              <th scope="col">{{ t('contabil.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in l.itens" :key="x.id" :data-testid="`lancamento-${x.id}`">
              <td>{{ x.id }}</td>
              <td>{{ dataBr(x.data) }}</td>
              <td>
                {{ t(`contabil.lancamentos.tipos.${x.tipo}`) }}
                <span v-if="x.tipoFatoRotulo" class="secundario">({{ x.tipoFatoRotulo }})</span>
                <span v-if="x.estornadoPor" class="secundario" :data-testid="`lancamento-estornado-${x.id}`">
                  {{ t('contabil.lancamentos.estornadoPor', { id: x.estornadoPor }) }}
                </span>
              </td>
              <td>{{ x.historico }}</td>
              <td>{{ reais(x.debitosCentavos) }}</td>
              <td>{{ reais(x.creditosCentavos) }}</td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('contabil.lancamentos.detalhe')"
                  :data-testid="`lancamento-detalhe-${x.id}`"
                  @acionar="abrir(x)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="acoes" data-testid="lancamentos-paginacao">
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.anterior')"
          :desabilitado="pagina <= 1"
          data-testid="lancamentos-anterior"
          @acionar="pagina--"
        />
        <span>{{ t('contabil.lancamentos.pagina', { pagina, paginas, total: l.total }) }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.proxima')"
          :desabilitado="pagina >= paginas"
          data-testid="lancamentos-proxima"
          @acionar="pagina++"
        />
      </div>
    </template>

    <MensagemErro v-if="abertoId !== null && detalhe.isError.value" :erro="detalhe.error.value" />
    <section
      v-if="d"
      class="bloco"
      aria-labelledby="lancamento-detalhe-titulo"
      data-testid="lancamento-detalhe"
    >
      <h3 id="lancamento-detalhe-titulo">{{ t('contabil.lancamentos.detalheTitulo', { id: d.id }) }}</h3>
      <dl class="dados">
        <dt>{{ t('contabil.data') }}</dt>
        <dd>{{ dataBr(d.data) }} ({{ rotuloCompetencia(d.competencia) }})</dd>
        <dt>{{ t('contabil.lancamentos.tipo') }}</dt>
        <dd>{{ t(`contabil.lancamentos.tipos.${d.tipo}`) }}</dd>
        <dt>{{ t('contabil.lancamentos.historico') }}</dt>
        <dd>{{ d.historico }}</dd>
        <template v-if="d.fato">
          <dt>{{ t('contabil.lancamentos.origemFato') }}</dt>
          <dd data-testid="lancamento-fato">
            {{ rotuloDaFonte(d.fato.fonte) }}: {{ d.fato.documento }} ({{ dataBr(d.fato.data) }})
          </dd>
        </template>
        <template v-if="d.regra">
          <dt>{{ t('contabil.lancamentos.regra') }}</dt>
          <dd>{{ t('contabil.lancamentos.regraVersao', { nome: d.regra.nome, versao: d.regra.versao }) }}</dd>
        </template>
        <template v-if="d.estornaId">
          <dt>{{ t('contabil.lancamentos.tipos.estorno') }}</dt>
          <dd>{{ t('contabil.lancamentos.estornaO', { id: d.estornaId }) }}</dd>
        </template>
        <template v-if="d.estornadoPor">
          <dt>{{ t('contabil.lancamentos.tipos.estorno') }}</dt>
          <dd>{{ t('contabil.lancamentos.estornadoPor', { id: d.estornadoPor }) }}</dd>
        </template>
        <template v-if="d.justificativa">
          <dt>{{ t('contabil.justificativa') }}</dt>
          <dd>{{ d.justificativa }}</dd>
        </template>
        <dt>{{ t('contabil.lancamentos.criadoPor') }}</dt>
        <dd>{{ d.criadoPor }} ({{ instante(d.criadoEm) }})</dd>
      </dl>
      <h4>{{ t('contabil.lancamentos.partidas') }}</h4>
      <div class="rolagem">
        <table class="tabela" data-testid="tabela-partidas">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.lancamentos.lado') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.conta') }}</th>
              <th scope="col">{{ t('contabil.valor') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.centroCusto') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.historico') }}</th>
              <th scope="col">{{ t('contabil.conciliacao.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in d.partidas" :key="p.id" :data-testid="`partida-${p.id}`">
              <td>{{ t(`contabil.lancamentos.lados.${p.lado}`) }}</td>
              <td>{{ p.conta }} {{ p.contaNome ?? '' }}</td>
              <td>{{ reais(p.valorCentavos) }}</td>
              <td>{{ p.centroCusto ?? '—' }}</td>
              <td>{{ p.historico }}</td>
              <td>
                {{
                  p.conciliacao
                    ? t('contabil.lancamentos.conciliada')
                    : t('contabil.lancamentos.pendenteConciliacao')
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p data-testid="lancamento-totais">
        {{
          t('contabil.lancamentos.totais', {
            debitos: reais(d.debitosCentavos),
            creditos: reais(d.creditosCentavos),
          })
        }}
      </p>
      <p
        v-if="!d.estornavel && d.motivoNaoEstornavel"
        class="secundario"
        data-testid="lancamento-nao-estornavel"
      >
        {{ t('contabil.lancamentos.naoEstornavel', { motivo: d.motivoNaoEstornavel }) }}
      </p>
      <div class="acoes">
        <SanteBotao
          v-if="apoio.podeEstornar && d.estornavel && !estornando"
          variante="secundario"
          :rotulo="t('contabil.lancamentos.estornar')"
          data-testid="lancamento-estornar"
          @acionar="estornando = true"
        />
        <SanteBotao variante="secundario" :rotulo="t('contabil.fechar')" @acionar="abertoId = null" />
      </div>
      <section
        v-if="estornando"
        class="bloco"
        aria-labelledby="estorno-titulo"
        data-testid="lancamento-estorno"
      >
        <h4 id="estorno-titulo">{{ t('contabil.lancamentos.estornoTitulo', { id: d.id }) }}</h4>
        <p class="secundario">{{ t('contabil.lancamentos.estornoAjuda') }}</p>
        <SanteData
          v-model="dataEstorno"
          :rotulo="t('contabil.lancamentos.dataEstorno')"
          editavel
          :maximo="hoje"
          data-testid="estorno-data"
        />
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t('contabil.justificativa')"
          :max-bytes="300"
          multilinha
          obrigatorio
          data-testid="estorno-justificativa"
        />
        <p class="secundario">{{ t('contabil.justificativaAjuda') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.lancamentos.gravarEstorno')"
            :desabilitado="ocupado || justificativa.trim().length < 10"
            data-testid="estorno-gravar"
            @acionar="estornar"
          />
          <SanteBotao variante="secundario" :rotulo="t('contabil.cancelar')" @acionar="estornando = false" />
        </div>
        <ErroContabil v-if="erroEstorno" :erro="erroEstorno" />
      </section>
    </section>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
