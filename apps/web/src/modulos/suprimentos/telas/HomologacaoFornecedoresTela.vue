<script setup lang="ts">
// Homologação de fornecedores por questionário pontuado (09-AREA linha 66): `/suprimentos/homologacao-fornecedores`.
// Avaliar: o questionário vigente e o fornecedor; as perguntas aparecem com o peso, as opções pontuadas e a marca de
// obrigatória e eliminatória; a nota, a faixa e o resultado previsto se calculam na hora pelo domínio (com as parcelas)
// e o botão só libera sem pendência. Ranking por questionário (homologados primeiro, vencidos marcados para
// requalificar). Avaliações: as respostas, a exceção justificada (só por quem não avaliou) e o cancelamento com motivo
// (fica no histórico). Questionários: o modelo novo com perguntas, pesos e opções, conferido na hora; o encerramento só
// fecha a vigência. O servidor confere tudo de novo.
import {
  calcularNotaHomologacao,
  classificarHomologacao,
  conferirQuestionarioHomologacao,
  JUSTIFICATIVA_MINIMA_EXCECAO,
  MOTIVO_MINIMO_CANCELAMENTO,
  opcoesDaPergunta,
  type PerguntaHomologacaoEntrada,
  perguntaPontuavel,
  type RespostaHomologacaoEntrada,
  TIPOS_RESPOSTA_HOMOLOGACAO,
  type TipoRespostaHomologacao,
} from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  aprovarExcecaoTela,
  avaliarFornecedorTela,
  buscarFornecedoresHomologacao,
  cancelarHomologacaoTela,
  encerrarQuestionarioTela,
  gravarQuestionarioTela,
  type HomologacaoDetalheTela,
  type HomologacaoTela,
  lerHomologacao,
  lerPainelHomologacao,
} from '../api-homologacao-fornecedor.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { data } from '../usar-suprimentos.js';
import './estilo-opme.css';

const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratoFornecedor.homologacao.${s}`, p ?? {});
const tid = (s: string) => `homol-${s}`;
const consulta = useQuery({
  queryKey: ['suprimentos', 'homologacao-fornecedor'],
  queryFn: lerPainelHomologacao,
});
const p = computed(() => consulta.data.value ?? null);
const abas = ['avaliar', 'ranking', 'avaliacoes', 'questionarios'] as const;
const aba = ref<(typeof abas)[number]>('avaliar');
const mensagem = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
const num = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

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

// ── Avaliar ──
const vigentes = computed(() => (p.value?.questionarios ?? []).filter((q) => q.vigente));
const opcoesQuestionario = computed(() => [
  { valor: null, rotulo: k('avaliar.escolha') },
  ...vigentes.value.map((q) => ({ valor: q.id, rotulo: `${q.codigo} · ${q.descricao}` })),
]);
const questionarioId = ref<number | null>(null);
const questionario = computed(() => vigentes.value.find((q) => q.id === questionarioId.value) ?? null);
const termo = ref('');
const encontrados = ref<{ id: number; nome: string; documento: string | null }[]>([]);
const fornecedorId = ref<number | null>(null);
const opcoesFornecedor = computed(() => [
  { valor: null, rotulo: k('avaliar.escolha') },
  ...encontrados.value.map((f) => ({
    valor: f.id,
    rotulo: f.documento ? `${f.nome} · ${f.documento}` : f.nome,
  })),
]);
async function buscar(): Promise<void> {
  erro.value = null;
  try {
    encontrados.value = (
      await buscarFornecedoresHomologacao(termo.value.trim(), questionario.value?.id ?? null)
    ).itens;
    fornecedorId.value = encontrados.value.length === 1 ? encontrados.value[0]!.id : null;
  } catch (e) {
    erro.value = e;
  }
}
const respostas = reactive<Record<number, { opcao: number | null; texto: string }>>({});
watch(questionario, (q) => {
  // A busca filtra pela categoria do questionário: o encontrado de outro questionário não vale mais.
  encontrados.value = [];
  fornecedorId.value = null;
  for (const chave of Object.keys(respostas)) delete respostas[Number(chave)];
  for (const pg of q?.perguntas ?? []) respostas[pg.id] = { opcao: null, texto: '' };
});
const respostasEntrada = computed<RespostaHomologacaoEntrada[]>(() =>
  (questionario.value?.perguntas ?? []).map((pg) => ({
    pergunta: pg.id,
    opcao: respostas[pg.id]?.opcao ?? null,
    texto: respostas[pg.id]?.texto.trim() ? respostas[pg.id]!.texto.trim() : null,
  })),
);
const calculo = computed(() =>
  questionario.value ? calcularNotaHomologacao(questionario.value.perguntas, respostasEntrada.value) : null,
);
const classificacao = computed(() =>
  calculo.value?.nota && questionario.value
    ? classificarHomologacao(calculo.value.nota, questionario.value.notaMinima, p.value?.faixas ?? [])
    : null,
);
const podeRegistrar = computed(
  () =>
    !enviando.value && fornecedorId.value !== null && calculo.value?.nota !== null && calculo.value !== null,
);
function registrar(): void {
  if (!questionario.value || fornecedorId.value === null) return;
  const e = {
    fornecedor: fornecedorId.value,
    questionario: questionario.value.id,
    insumo: null,
    respostas: respostasEntrada.value.filter((r) => r.opcao !== null || r.texto !== null),
  };
  void executar(
    () => avaliarFornecedorTela(e),
    () => {
      for (const pg of questionario.value?.perguntas ?? []) respostas[pg.id] = { opcao: null, texto: '' };
      fornecedorId.value = null;
    },
  );
}

// ── Ranking ──
const rankingQuestionario = ref<number | null>(null);
watch(
  () => p.value?.questionarios,
  (qs) => {
    if (qs && rankingQuestionario.value === null) rankingQuestionario.value = qs[0]?.id ?? null;
  },
  { immediate: true },
);
const opcoesRanking = computed(() =>
  (p.value?.questionarios ?? []).map((q) => ({
    valor: q.id as number | null,
    rotulo: `${q.codigo} · ${q.descricao}`,
  })),
);
const ranking = computed(() =>
  (p.value?.ranking ?? []).filter((r) => r.questionario === rankingQuestionario.value),
);

// ── Avaliações ──
const aberta = ref<HomologacaoDetalheTela | null>(null);
const acao = ref<{ tipo: 'excecao' | 'cancelar'; h: HomologacaoTela } | null>(null);
const textoAcao = ref('');
async function abrir(id: number): Promise<void> {
  erro.value = null;
  try {
    aberta.value = await lerHomologacao(id);
  } catch (e) {
    erro.value = e;
  }
}
const podeExcecao = (h: HomologacaoTela) =>
  !!p.value?.pode.excecao && h.situacao === 'reprovado' && !h.excecao;
const proprio = (h: HomologacaoTela) => p.value?.usuario === h.avaliador;
const minimoAcao = computed(() =>
  acao.value?.tipo === 'excecao' ? JUSTIFICATIVA_MINIMA_EXCECAO : MOTIVO_MINIMO_CANCELAMENTO,
);
function confirmarAcao(): void {
  const a = acao.value;
  if (!a) return;
  const texto = textoAcao.value.trim();
  void executar(
    () =>
      a.tipo === 'excecao'
        ? aprovarExcecaoTela(a.h.id, texto, a.h.versao)
        : cancelarHomologacaoTela(a.h.id, texto, a.h.versao),
    () => {
      acao.value = null;
      textoAcao.value = '';
    },
  );
}

// ── Questionários ──
interface PerguntaForm {
  identificador: string;
  texto: string;
  peso: number;
  tipoResposta: TipoRespostaHomologacao;
  opcoes: { ordem: number; texto: string; pontos: number }[];
  obrigatoria: boolean;
  eliminatoria: boolean;
}
const escalaPadrao = () => [
  { ordem: 1, texto: k('escalaPadrao.nao'), pontos: 0 },
  { ordem: 2, texto: k('escalaPadrao.parcial'), pontos: 5 },
  { ordem: 3, texto: k('escalaPadrao.pleno'), pontos: 10 },
];
const perguntaNova = (): PerguntaForm => ({
  identificador: '',
  texto: '',
  peso: 1,
  tipoResposta: 'escala',
  opcoes: escalaPadrao(),
  obrigatoria: true,
  eliminatoria: false,
});
const formQ = reactive({
  codigo: '',
  descricao: '',
  categoria: null as number | null,
  notaMinima: 70,
  validadeMeses: 12,
  instrucoes: '',
  vigenciaInicio: '',
  perguntas: [perguntaNova()],
});
watch(
  () => p.value?.hoje,
  (h) => {
    if (h && !formQ.vigenciaInicio) formQ.vigenciaInicio = h;
  },
  { immediate: true },
);
const opcoesTipo = TIPOS_RESPOSTA_HOMOLOGACAO.map((x) => ({ valor: x, rotulo: k(`tipos.${x}`) }));
const opcoesCategoria = computed(() => [
  { valor: null, rotulo: k('questionario.todas') },
  ...(p.value?.categorias ?? []).map((c) => ({ valor: c.id as number | null, rotulo: c.descricao })),
]);
const questionarioEntrada = computed(() => ({
  codigo: formQ.codigo.trim(),
  descricao: formQ.descricao.trim(),
  categoria: formQ.categoria,
  notaMinima: Number(formQ.notaMinima),
  validadeMeses: Number(formQ.validadeMeses),
  instrucoes: formQ.instrucoes.trim() || null,
  vigenciaInicio: formQ.vigenciaInicio,
  vigenciaFim: null,
  perguntas: formQ.perguntas.map((pg): PerguntaHomologacaoEntrada => ({
    identificador: pg.identificador.trim() || null,
    texto: pg.texto.trim(),
    peso: Number(pg.peso),
    tipoResposta: pg.tipoResposta,
    opcoes:
      pg.tipoResposta === 'escala' || pg.tipoResposta === 'multipla_escolha'
        ? pg.opcoes.map((o) => ({ ordem: o.ordem, texto: o.texto.trim(), pontos: Number(o.pontos) }))
        : [],
    obrigatoria: pg.obrigatoria,
    eliminatoria: pg.tipoResposta === 'texto' ? false : pg.eliminatoria,
  })),
}));
const recusasQ = computed(() =>
  conferirQuestionarioHomologacao(questionarioEntrada.value).map((r) => r.mensagem),
);
const pesoTotal = computed(() =>
  questionarioEntrada.value.perguntas.filter(perguntaPontuavel).reduce((s, pg) => s + (pg.peso || 0), 0),
);
function maisOpcao(pg: PerguntaForm): void {
  pg.opcoes.push({ ordem: Math.max(0, ...pg.opcoes.map((o) => o.ordem)) + 1, texto: '', pontos: 0 });
}
function gravarQuestionario(): void {
  void executar(
    () => gravarQuestionarioTela(questionarioEntrada.value),
    () => {
      formQ.codigo = '';
      formQ.descricao = '';
      formQ.perguntas = [perguntaNova()];
    },
  );
}
</script>

<template>
  <section class="tela-opme" aria-labelledby="homol-titulo" data-testid="tela-homologacao-fornecedores">
    <h1 id="homol-titulo">{{ k('titulo') }}</h1>
    <p class="secundario">{{ k('explica') }}</p>
    <div class="abas" role="tablist">
      <SanteBotao
        v-for="a in abas"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="k(`abas.${a}`)"
        :data-testid="tid(`aba-${a}`)"
        @acionar="aba = a"
      />
    </div>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <ErroSuprimentos v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-if="mensagem" role="status" :data-testid="tid('mensagem')">{{ mensagem }}</p>
    <p v-if="!p && !consulta.error.value" role="status">{{ k('carregando') }}</p>

    <template v-if="p">
      <!-- Avaliar -->
      <div v-if="aba === 'avaliar'" :data-testid="tid('avaliar')">
        <p v-if="vigentes.length === 0" class="secundario">{{ k('avaliar.nenhumQuestionario') }}</p>
        <form v-else class="cartao" @submit.prevent="registrar">
          <div class="barra">
            <SanteSelecao
              v-model="questionarioId"
              :rotulo="k('avaliar.questionario')"
              :opcoes="opcoesQuestionario"
              :data-testid="tid('questionario')"
            />
            <span class="campo">
              <label for="homol-termo">{{ k('avaliar.buscaFornecedor') }}</label>
              <input
                id="homol-termo"
                v-model="termo"
                :data-testid="tid('termo')"
                @keydown.enter.prevent="buscar"
              />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="k('avaliar.buscar')"
              :data-testid="tid('buscar')"
              @acionar="buscar"
            />
            <SanteSelecao
              v-model="fornecedorId"
              :rotulo="k('avaliar.fornecedor')"
              :opcoes="opcoesFornecedor"
              :data-testid="tid('fornecedor')"
            />
          </div>
          <template v-if="questionario">
            <p v-if="questionario.categoriaDescricao" class="secundario" :data-testid="tid('da-categoria')">
              {{ k('avaliar.daCategoria', { categoria: questionario.categoriaDescricao }) }}
            </p>
            <p v-if="questionario.instrucoes" class="secundario">{{ questionario.instrucoes }}</p>
            <fieldset
              v-for="pg in questionario.perguntas"
              :key="pg.id"
              :data-testid="tid(`pergunta-${pg.sequencia}`)"
            >
              <legend>
                {{ pg.sequencia }}. {{ pg.texto }}
                <span class="secundario">
                  · {{ k('avaliar.peso', { peso: num(pg.peso) }) }}
                  <template v-if="pg.obrigatoria"> · {{ k('avaliar.obrigatoria') }}</template>
                  <template v-if="pg.eliminatoria"> · {{ k('avaliar.eliminatoria') }}</template>
                </span>
              </legend>
              <template v-if="perguntaPontuavel(pg)">
                <label v-for="o in opcoesDaPergunta(pg)" :key="o.ordem" class="linha">
                  <input
                    v-model="respostas[pg.id]!.opcao"
                    type="radio"
                    :name="`homol-p-${pg.id}`"
                    :value="o.ordem"
                    :data-testid="tid(`resposta-${pg.sequencia}-${o.ordem}`)"
                  />
                  {{ o.texto }} ({{ num(o.pontos) }})
                </label>
                <span class="campo">
                  <label :for="`homol-c-${pg.id}`">{{ k('avaliar.complemento') }}</label>
                  <input :id="`homol-c-${pg.id}`" v-model="respostas[pg.id]!.texto" maxlength="500" />
                </span>
              </template>
              <span v-else class="campo">
                <label :for="`homol-t-${pg.id}`">{{ k('avaliar.respostaTexto') }}</label>
                <textarea
                  :id="`homol-t-${pg.id}`"
                  v-model="respostas[pg.id]!.texto"
                  maxlength="2000"
                  :data-testid="tid(`texto-${pg.sequencia}`)"
                />
              </span>
            </fieldset>
            <div class="resumo" :data-testid="tid('previa')">
              <h2>{{ k('avaliar.previa') }}</h2>
              <template v-if="calculo?.nota">
                <p>
                  <strong :data-testid="tid('nota')">{{ num(calculo.nota.nota) }}</strong>
                  · {{ k('avaliar.notaMinima', { nota: num(questionario.notaMinima) }) }}
                </p>
                <p v-if="classificacao" :data-testid="tid('previsto')">
                  {{ k('avaliar.previsto', { situacao: k(`situacoes.${classificacao.situacao}`) }) }}
                  <template v-if="classificacao.comRestricao"> ({{ k('avaliar.comRestricao') }})</template>
                  ·
                  {{
                    classificacao.faixa
                      ? k('avaliar.faixa', { faixa: classificacao.faixa.descricao })
                      : k('avaliar.semFaixa')
                  }}
                </p>
                <SanteAlerta
                  v-for="(m, i) in classificacao?.motivos ?? []"
                  :key="i"
                  variante="aviso"
                  :texto="m"
                  :data-testid="tid(`motivo-${i}`)"
                />
                <ul class="secundario" :data-testid="tid('parcelas')">
                  <li v-for="(x, i) in calculo.nota.parcelas" :key="i">{{ x }}</li>
                </ul>
              </template>
              <template v-else-if="calculo">
                <p>{{ k('avaliar.pendencias') }}</p>
                <ul class="secundario" :data-testid="tid('pendencias')">
                  <li v-for="(r, i) in calculo.recusas" :key="i">{{ r.mensagem }}</li>
                </ul>
              </template>
            </div>
            <SanteBotao
              v-if="p.pode.avaliar"
              tipo="submit"
              :rotulo="k('avaliar.registrar')"
              :desabilitado="!podeRegistrar"
              :data-testid="tid('registrar')"
            />
          </template>
        </form>
      </div>

      <!-- Ranking -->
      <div v-else-if="aba === 'ranking'" :data-testid="tid('ranking')">
        <SanteSelecao
          v-model="rankingQuestionario"
          :rotulo="k('ranking.questionario')"
          :opcoes="opcoesRanking"
          :data-testid="tid('ranking-questionario')"
        />
        <p v-if="ranking.length === 0" class="secundario">{{ k('ranking.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" :data-testid="tid('ranking-tabela')">
            <thead>
              <tr>
                <th scope="col">{{ k('ranking.colPosicao') }}</th>
                <th scope="col">{{ k('ranking.colFornecedor') }}</th>
                <th scope="col">{{ k('ranking.colNota') }}</th>
                <th scope="col">{{ k('ranking.colSituacao') }}</th>
                <th scope="col">{{ k('ranking.colValidade') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in ranking" :key="r.id" :data-testid="tid(`ranking-${r.posicao}`)">
                <td>{{ k('ranking.posicao', { n: r.posicao }) }}</td>
                <td>{{ r.fornecedorNome }}</td>
                <td>{{ num(r.nota) }}</td>
                <td>
                  {{ k(`situacoes.${r.situacaoNaData}`) }}
                  <template v-if="r.excecao"> ({{ k('ranking.porExcecao') }})</template>
                  <strong v-if="r.requalificar"> · {{ k('ranking.requalificar') }}</strong>
                </td>
                <td>{{ r.validoAte ? data(r.validoAte) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Avaliações -->
      <div v-else-if="aba === 'avaliacoes'" :data-testid="tid('avaliacoes')">
        <p v-if="p.homologacoes.length === 0" class="secundario">{{ k('lista.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade" :data-testid="tid('lista')">
            <thead>
              <tr>
                <th scope="col">{{ k('lista.colFornecedor') }}</th>
                <th scope="col">{{ k('lista.colQuestionario') }}</th>
                <th scope="col">{{ k('lista.colNota') }}</th>
                <th scope="col">{{ k('lista.colFaixa') }}</th>
                <th scope="col">{{ k('lista.colSituacao') }}</th>
                <th scope="col">{{ k('lista.colAvaliado') }}</th>
                <th scope="col">{{ k('lista.colAcoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in p.homologacoes" :key="h.id" :data-testid="tid(`linha-${h.id}`)">
                <td>{{ h.fornecedorNome }}</td>
                <td>{{ h.questionarioDescricao }}</td>
                <td>{{ num(h.nota) }}</td>
                <td>{{ h.faixa ?? '—' }}</td>
                <td>
                  {{ k(`situacoes.${h.situacaoNaData}`) }}
                  <span v-if="h.excecao" class="secundario">
                    · {{ k('lista.justificada', { texto: h.justificativa ?? '' }) }}
                  </span>
                  <span v-if="h.motivoCancelamento" class="secundario" :data-testid="tid(`motivo-${h.id}`)">
                    · {{ k('lista.motivoCancelamento', { texto: h.motivoCancelamento }) }}
                  </span>
                </td>
                <td>{{ data(h.avaliadoEm) }} · {{ h.avaliadorLogin ?? '' }}</td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="k('lista.abrir')"
                    :data-testid="tid(`abrir-${h.id}`)"
                    @acionar="abrir(h.id)"
                  />
                  <SanteBotao
                    v-if="podeExcecao(h)"
                    variante="secundario"
                    :rotulo="k('lista.excecao')"
                    :data-testid="tid(`excecao-${h.id}`)"
                    @acionar="
                      acao = { tipo: 'excecao', h };
                      textoAcao = '';
                    "
                  />
                  <SanteBotao
                    v-if="p.pode.avaliar && h.situacao !== 'cancelado'"
                    variante="secundario"
                    :rotulo="k('lista.cancelar')"
                    :data-testid="tid(`cancelar-${h.id}`)"
                    @acionar="
                      acao = { tipo: 'cancelar', h };
                      textoAcao = '';
                    "
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form v-if="acao" class="cartao" :data-testid="tid('acao')" @submit.prevent="confirmarAcao">
          <SanteAlerta
            v-if="acao.tipo === 'excecao' && proprio(acao.h)"
            variante="aviso"
            :texto="k('lista.proprioAvaliador')"
            :data-testid="tid('proprio')"
          />
          <span class="campo">
            <label for="homol-acao-texto">
              {{
                acao.tipo === 'excecao'
                  ? k('lista.justificativa', { min: minimoAcao })
                  : k('lista.motivo', { min: minimoAcao })
              }}
            </label>
            <textarea
              id="homol-acao-texto"
              v-model="textoAcao"
              maxlength="2000"
              :data-testid="tid('acao-texto')"
            />
          </span>
          <p class="secundario">
            {{ k('lista.justificativaConta', { n: textoAcao.trim().length, min: minimoAcao }) }}
          </p>
          <div class="barra">
            <SanteBotao
              tipo="submit"
              :rotulo="
                acao.tipo === 'excecao' ? k('lista.confirmarExcecao') : k('lista.confirmarCancelamento')
              "
              :desabilitado="
                enviando ||
                textoAcao.trim().length < minimoAcao ||
                (acao.tipo === 'excecao' && proprio(acao.h))
              "
              :data-testid="tid('acao-confirmar')"
            />
            <SanteBotao variante="secundario" :rotulo="k('lista.fechar')" @acionar="acao = null" />
          </div>
        </form>
        <div v-if="aberta" class="cartao" :data-testid="tid('detalhe')">
          <h2>{{ k('lista.respostas', { fornecedor: aberta.fornecedorNome }) }}</h2>
          <p v-if="aberta.motivoCancelamento" :data-testid="tid('detalhe-motivo')">
            {{ k('lista.motivoCancelamento', { texto: aberta.motivoCancelamento }) }}
          </p>
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ k('lista.colPergunta') }}</th>
                <th scope="col">{{ k('lista.colResposta') }}</th>
                <th scope="col">{{ k('lista.colPontos') }}</th>
                <th scope="col">{{ k('lista.colPeso') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in aberta.respostas" :key="r.sequencia">
                <td>{{ r.sequencia }}. {{ r.pergunta }}</td>
                <td>{{ r.resposta ?? '—' }}</td>
                <td>{{ num(r.pontuacao) }}</td>
                <td>{{ num(r.peso) }}</td>
              </tr>
            </tbody>
          </table>
          <SanteBotao variante="secundario" :rotulo="k('lista.fechar')" @acionar="aberta = null" />
        </div>
      </div>

      <!-- Questionários -->
      <div v-else :data-testid="tid('questionarios')">
        <p v-if="p.questionarios.length === 0" class="secundario">{{ k('questionario.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" :data-testid="tid('questionarios-tabela')">
            <thead>
              <tr>
                <th scope="col">{{ k('questionario.colCodigo') }}</th>
                <th scope="col">{{ k('questionario.colDescricao') }}</th>
                <th scope="col">{{ k('questionario.colCategoria') }}</th>
                <th scope="col">{{ k('questionario.colMinima') }}</th>
                <th scope="col">{{ k('questionario.colValidade') }}</th>
                <th scope="col">{{ k('questionario.colVigencia') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="q in p.questionarios" :key="q.id">
                <td>{{ q.codigo }}</td>
                <td>
                  {{ q.descricao }}
                  <span class="secundario">
                    · {{ k('questionario.perguntas', { n: q.perguntas.length }) }}</span
                  >
                </td>
                <td>{{ q.categoriaDescricao ?? k('questionario.todas') }}</td>
                <td>{{ num(q.notaMinima) }}</td>
                <td>{{ k('questionario.meses', { n: q.validadeMeses }) }}</td>
                <td>
                  {{
                    k('questionario.vigencia', {
                      inicio: data(q.vigenciaInicio),
                      fim: q.vigenciaFim ? data(q.vigenciaFim) : '…',
                    })
                  }}
                  <SanteBotao
                    v-if="p.pode.editar && q.vigente"
                    variante="secundario"
                    :rotulo="k('questionario.encerrar')"
                    :data-testid="tid(`encerrar-${q.id}`)"
                    @acionar="executar(() => encerrarQuestionarioTela(q.id, p!.hoje, q.versao))"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form
          v-if="p.pode.editar"
          class="cartao"
          :data-testid="tid('novo')"
          @submit.prevent="gravarQuestionario"
        >
          <h2>{{ k('questionario.novo') }}</h2>
          <div class="barra">
            <span class="campo">
              <label for="homol-q-codigo">{{ k('questionario.codigo') }}</label>
              <input
                id="homol-q-codigo"
                v-model="formQ.codigo"
                maxlength="30"
                :data-testid="tid('q-codigo')"
              />
            </span>
            <span class="campo">
              <label for="homol-q-descricao">{{ k('questionario.descricao') }}</label>
              <input
                id="homol-q-descricao"
                v-model="formQ.descricao"
                maxlength="150"
                :data-testid="tid('q-descricao')"
              />
            </span>
            <SanteSelecao
              v-model="formQ.categoria"
              :rotulo="k('questionario.categoria')"
              :opcoes="opcoesCategoria"
              :data-testid="tid('q-categoria')"
            />
          </div>
          <div class="barra">
            <span class="campo">
              <label for="homol-q-minima">{{ k('questionario.notaMinima') }}</label>
              <input
                id="homol-q-minima"
                v-model.number="formQ.notaMinima"
                type="number"
                min="0"
                max="100"
                step="0.01"
                :data-testid="tid('q-minima')"
              />
            </span>
            <span class="campo">
              <label for="homol-q-validade">{{ k('questionario.validadeMeses') }}</label>
              <input
                id="homol-q-validade"
                v-model.number="formQ.validadeMeses"
                type="number"
                min="1"
                max="60"
                :data-testid="tid('q-validade')"
              />
            </span>
            <span class="campo">
              <label for="homol-q-inicio">{{ k('questionario.vigenciaInicio') }}</label>
              <input
                id="homol-q-inicio"
                v-model="formQ.vigenciaInicio"
                type="date"
                :data-testid="tid('q-inicio')"
              />
            </span>
          </div>
          <span class="campo">
            <label for="homol-q-instrucoes">{{ k('questionario.instrucoes') }}</label>
            <textarea id="homol-q-instrucoes" v-model="formQ.instrucoes" maxlength="2000" />
          </span>
          <fieldset v-for="(pg, i) in formQ.perguntas" :key="i" :data-testid="tid(`q-pergunta-${i + 1}`)">
            <legend>{{ k('questionario.pergunta', { n: i + 1 }) }}</legend>
            <div class="barra">
              <span class="campo">
                <label :for="`homol-qp-texto-${i}`">{{ k('questionario.texto') }}</label>
                <input
                  :id="`homol-qp-texto-${i}`"
                  v-model="pg.texto"
                  maxlength="500"
                  :data-testid="tid(`qp-texto-${i + 1}`)"
                />
              </span>
              <span class="campo">
                <label :for="`homol-qp-id-${i}`">{{ k('questionario.identificador') }}</label>
                <input :id="`homol-qp-id-${i}`" v-model="pg.identificador" maxlength="30" />
              </span>
              <SanteSelecao
                v-model="pg.tipoResposta"
                :rotulo="k('questionario.tipo')"
                :opcoes="opcoesTipo"
                :data-testid="tid(`qp-tipo-${i + 1}`)"
              />
              <span class="campo">
                <label :for="`homol-qp-peso-${i}`">{{ k('questionario.peso') }}</label>
                <input
                  :id="`homol-qp-peso-${i}`"
                  v-model.number="pg.peso"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  :data-testid="tid(`qp-peso-${i + 1}`)"
                />
              </span>
              <label class="linha">
                <input v-model="pg.obrigatoria" type="checkbox" />
                {{ k('questionario.obrigatoria') }}
              </label>
              <label v-if="pg.tipoResposta !== 'texto'" class="linha">
                <input
                  v-model="pg.eliminatoria"
                  type="checkbox"
                  :data-testid="tid(`qp-eliminatoria-${i + 1}`)"
                />
                {{ k('questionario.eliminatoria') }}
              </label>
            </div>
            <p v-if="pg.tipoResposta === 'sim_nao'" class="secundario">{{ k('questionario.simNaoFixo') }}</p>
            <template v-if="pg.tipoResposta === 'escala' || pg.tipoResposta === 'multipla_escolha'">
              <div v-for="(o, j) in pg.opcoes" :key="j" class="barra">
                <span class="campo">
                  <label :for="`homol-qo-${i}-${j}`">{{ k('questionario.opcao') }} {{ j + 1 }}</label>
                  <input :id="`homol-qo-${i}-${j}`" v-model="o.texto" maxlength="150" />
                </span>
                <span class="campo">
                  <label :for="`homol-qo-pts-${i}-${j}`">{{ k('questionario.pontos') }}</label>
                  <input
                    :id="`homol-qo-pts-${i}-${j}`"
                    v-model.number="o.pontos"
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                  />
                </span>
                <SanteBotao
                  v-if="pg.opcoes.length > 2"
                  variante="secundario"
                  :rotulo="k('questionario.tirarOpcao')"
                  @acionar="pg.opcoes.splice(j, 1)"
                />
              </div>
              <SanteBotao
                v-if="pg.opcoes.length < 10"
                variante="secundario"
                :rotulo="k('questionario.maisOpcao')"
                @acionar="maisOpcao(pg)"
              />
            </template>
            <SanteBotao
              v-if="formQ.perguntas.length > 1"
              variante="secundario"
              :rotulo="k('questionario.tirarPergunta')"
              @acionar="formQ.perguntas.splice(i, 1)"
            />
          </fieldset>
          <div class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="k('questionario.maisPergunta')"
              :data-testid="tid('q-mais-pergunta')"
              @acionar="formQ.perguntas.push(perguntaNova())"
            />
            <span class="secundario">{{ k('questionario.pesoTotal', { peso: num(pesoTotal) }) }}</span>
          </div>
          <SanteAlerta
            v-for="(r, i) in recusasQ"
            :key="i"
            variante="aviso"
            :texto="r"
            :data-testid="tid(`q-recusa-${i}`)"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="k('questionario.gravar')"
            :desabilitado="enviando || recusasQ.length > 0"
            :data-testid="tid('q-gravar')"
          />
        </form>
      </div>
    </template>
  </section>
</template>
