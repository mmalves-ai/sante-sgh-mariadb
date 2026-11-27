<!-- Consolidação gerencial (C2-101, 07-FIN linha 127, F8): um grupo de estabelecimentos com a consolidadora, o plano
gerencial comum e o de-para das contas de cada estabelecimento (só as gerenciais analíticas da mesma natureza), a prévia
ao vivo da competência (totais, eliminações entre empresas pelo CPC 36 e pendências), a apuração e a liberação, e a DRE
e o balanço consolidados. Tudo numa tela: escolher o grupo e a competência basta para ver o mês. O servidor confere de
novo cada gravação (domínio dominio-contabil/consolidacao.ts). -->
<script setup lang="ts">
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { pode } from '../../casca/sessao/pode.js';
import {
  apurarConsolidacao,
  incluirContaGerencial,
  lerApoioConsolidacao,
  lerDemonstracoesConsolidadas,
  lerGrupoConsolidacao,
  lerPreviaConsolidacao,
  liberarConsolidacao,
  type MetodoConsolidacaoTela,
  salvarDeParaConsolidacao,
  salvarGrupoConsolidacao,
  type TipoContaGerencial,
} from './api-consolidacao.js';

const { t } = useI18n();
const k = (c: string, p?: Record<string, unknown>) => t(`consolidacao.${c}`, p ?? {});
const cliente = useQueryClient();
const podeEditar = computed(() => pode('contabil.consolidacao.editar'));
const podeApurar = computed(() => pode('contabil.consolidacao.apurar'));

const mesPassado = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reaisDecimal = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const apoio = useQuery({ queryKey: ['consolidacao', 'apoio'], queryFn: lerApoioConsolidacao });
const grupo = ref<number | null>(null);
const competencia = ref(mesPassado());
const exercicio = computed(() => Number(competencia.value.slice(0, 4)));
const competenciaValida = computed(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia.value));

watch(
  () => apoio.data.value?.grupos,
  (gs) => {
    if (grupo.value === null && gs?.length) grupo.value = gs[0]!.id;
  },
  { immediate: true },
);

const opGrupos = computed(() => [
  { valor: null as number | null, rotulo: k('novoGrupo') },
  ...(apoio.data.value?.grupos ?? []).map((g) => ({
    valor: g.id as number | null,
    rotulo: `${g.codigo} · ${g.nome}`,
  })),
]);
const opEstabelecimentos = computed(() =>
  (apoio.data.value?.estabelecimentos ?? []).map((e) => ({ valor: e.id as number | null, rotulo: e.nome })),
);
const opMetodos = computed(() =>
  (['integral', 'proporcional', 'equivalencia_patrimonial'] as const).map((m) => ({
    valor: m as MetodoConsolidacaoTela,
    rotulo: k(`metodos.${m}`),
  })),
);
const opNaturezas = computed(() =>
  (apoio.data.value?.naturezas ?? []).map((n) => ({ valor: n, rotulo: k(`naturezas.${n}`) })),
);
const opTipos = computed(() =>
  (['analitica', 'sintetica'] as const).map((x) => ({
    valor: x as TipoContaGerencial,
    rotulo: k(`tipos.${x}`),
  })),
);

const detalhe = useQuery({
  queryKey: computed(() => ['consolidacao', 'grupo', grupo.value, exercicio.value]),
  queryFn: () => lerGrupoConsolidacao(grupo.value!, exercicio.value),
  enabled: computed(() => grupo.value !== null && competenciaValida.value),
});
const previa = useQuery({
  queryKey: computed(() => ['consolidacao', 'previa', grupo.value, competencia.value]),
  queryFn: () => lerPreviaConsolidacao(grupo.value!, competencia.value),
  enabled: computed(() => grupo.value !== null && competenciaValida.value),
});
const demonstracoes = useQuery({
  queryKey: computed(() => ['consolidacao', 'demonstracoes', grupo.value, competencia.value]),
  queryFn: () => lerDemonstracoesConsolidadas(grupo.value!, competencia.value),
  enabled: computed(() => grupo.value !== null && competenciaValida.value),
});

type Aba = 'grupo' | 'depara' | 'apuracao' | 'demonstracoes';
const ABAS: Aba[] = ['grupo', 'depara', 'apuracao', 'demonstracoes'];
const aba = ref<Aba>('apuracao');
watch(
  () => apoio.data.value?.grupos.length,
  (n) => {
    if (n === 0) aba.value = 'grupo';
  },
);

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<{ mensagem: string; resultado: Record<string, unknown> }>) => fn(),
  onSuccess: (r) => {
    erro.value = null;
    aviso.value = r.mensagem || k('salvo');
    const novo = r.resultado['grupo'];
    if (grupo.value === null && typeof novo === 'number') grupo.value = novo;
    void cliente.invalidateQueries({ queryKey: ['consolidacao'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

// ── Grupo e estabelecimentos ─────────────────────────────────────────────────────────────────────
interface MembroForm {
  estabelecimento: number | null;
  percentual: number;
  metodo: MetodoConsolidacaoTela;
  consolidadora: boolean;
}
const g = reactive({
  codigo: '',
  nome: '',
  vigenciaInicio: `${new Date().getFullYear()}-01-01`,
  vigenciaFim: '',
  elimina: true,
  observacao: '',
  membros: [] as MembroForm[],
});
const novoMembro = (consolidadora: boolean): MembroForm => ({
  estabelecimento: null,
  percentual: 100,
  metodo: 'integral',
  consolidadora,
});
watch(
  () => [grupo.value, detalhe.data.value] as const,
  ([id, d]) => {
    if (id === null) {
      Object.assign(g, { codigo: '', nome: '', vigenciaFim: '', elimina: true, observacao: '' });
      g.membros = [novoMembro(true)];
    } else if (d) {
      Object.assign(g, {
        codigo: d.grupo.codigo,
        nome: d.grupo.nome,
        vigenciaInicio: d.grupo.vigenciaInicio,
        vigenciaFim: d.grupo.vigenciaFim ?? '',
        elimina: d.grupo.eliminaEntreEmpresas,
        observacao: d.grupo.observacao ?? '',
      });
      g.membros = d.membros.map((m) => ({
        estabelecimento: m.estabelecimento,
        percentual: m.percentual,
        metodo: m.metodo as MetodoConsolidacaoTela,
        consolidadora: m.consolidadora,
      }));
    }
  },
  { immediate: true },
);
const marcarConsolidadora = (i: number) => g.membros.forEach((m, j) => (m.consolidadora = i === j));
const problemasGrupo = computed(() => {
  const p: string[] = [];
  if (!g.codigo.trim()) p.push(k('problemas.codigo'));
  if (!g.nome.trim()) p.push(k('problemas.nome'));
  if (!g.vigenciaInicio) p.push(k('problemas.vigencia'));
  if (g.vigenciaFim && g.vigenciaFim < g.vigenciaInicio) p.push(k('problemas.fimAntes'));
  const ests = g.membros.map((m) => m.estabelecimento).filter((e) => e !== null);
  if (!ests.length) p.push(k('problemas.semMembro'));
  if (new Set(ests).size !== ests.length) p.push(k('problemas.repetido'));
  if (g.membros.some((m) => !(Number(m.percentual) > 0 && Number(m.percentual) <= 100)))
    p.push(k('problemas.percentual'));
  if (g.membros.filter((m) => m.consolidadora).length !== 1) p.push(k('problemas.consolidadora'));
  return p;
});
const salvarGrupo = () =>
  acao.mutate(() =>
    salvarGrupoConsolidacao({
      grupo: grupo.value,
      versao: grupo.value === null ? null : (detalhe.data.value?.grupo.versao ?? null),
      codigo: g.codigo.trim(),
      nome: g.nome.trim(),
      vigenciaInicio: g.vigenciaInicio,
      vigenciaFim: g.vigenciaFim || null,
      eliminaEntreEmpresas: g.elimina,
      observacao: g.observacao.trim() || null,
      membros: g.membros
        .filter((m) => m.estabelecimento !== null)
        .map((m) => ({
          estabelecimento: m.estabelecimento!,
          percentual: Number(m.percentual),
          metodo: m.metodo,
          consolidadora: m.consolidadora,
        })),
    }),
  );

// ── Plano gerencial comum e de-para ──────────────────────────────────────────────────────────────
const c = reactive({
  classificacao: '',
  descricao: '',
  natureza: 'receita',
  tipo: 'analitica' as TipoContaGerencial,
});
const problemasConta = computed(() => {
  const p: string[] = [];
  if (!/^\d+(\.\d+)*$/.test(c.classificacao.trim())) p.push(k('problemas.classificacao'));
  if (!c.descricao.trim()) p.push(k('problemas.descricao'));
  return p;
});
const incluirConta = () =>
  acao.mutate(() =>
    incluirContaGerencial({
      exercicio: exercicio.value,
      classificacao: c.classificacao.trim(),
      descricao: c.descricao.trim(),
      natureza: c.natureza,
      tipo: c.tipo,
    }),
  );

const escolhas = reactive<Record<number, number | null>>({});
watch(
  () => detalhe.data.value?.depara,
  (lista) => {
    for (const x of Object.keys(escolhas)) delete escolhas[Number(x)];
    for (const x of lista ?? []) escolhas[x.conta] = x.gerencial;
  },
  { immediate: true },
);
const soPendentes = ref(false);
const nomeEst = computed(
  () => new Map((apoio.data.value?.estabelecimentos ?? []).map((e) => [e.id, e.nome] as const)),
);
// O filtro olha o de-para gravado: a conta escolhida agora continua na lista até salvar (não some debaixo do combo).
const contasDePara = computed(() =>
  (detalhe.data.value?.depara ?? []).filter((x) => !soPendentes.value || x.gerencial === null),
);
const semDePara = computed(
  () => (detalhe.data.value?.depara ?? []).filter((x) => x.gerencial === null).length,
);
const opGerenciais = (natureza: string) => [
  { valor: null as number | null, rotulo: k('semGerencial') },
  ...(detalhe.data.value?.gerenciais ?? [])
    .filter((x) => x.tipo === 'analitica' && x.natureza === natureza)
    .map((x) => ({ valor: x.id as number | null, rotulo: `${x.classificacao} ${x.descricao}` })),
];
const alteracoes = computed(() =>
  (detalhe.data.value?.depara ?? [])
    .filter((x) => (escolhas[x.conta] ?? null) !== x.gerencial)
    .map((x) => ({ conta: x.conta, gerencial: escolhas[x.conta] ?? null })),
);
const salvarDePara = () => acao.mutate(() => salvarDeParaConsolidacao(grupo.value!, alteracoes.value));

// ── Prévia, apuração e liberação ─────────────────────────────────────────────────────────────────
const vigente = computed(() => previa.data.value?.rodadaVigente ?? null);
const apurar = () => acao.mutate(() => apurarConsolidacao(grupo.value!, competencia.value));
const liberar = (id: number, versao: number) => acao.mutate(() => liberarConsolidacao(id, versao));
const situacaoApuracao = (s: string) => k(`apuracoes.situacoes.${s}`);
</script>

<template>
  <section class="tela" aria-labelledby="consolidacao-titulo" data-testid="tela-consolidacao">
    <h1 id="consolidacao-titulo">{{ k('titulo') }}</h1>
    <p class="ajuda">{{ k('explicacao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="apoio.isPending.value">{{ k('carregando') }}</p>

    <div class="formulario">
      <SanteSelecao
        v-model="grupo"
        :rotulo="k('grupo')"
        :opcoes="opGrupos"
        data-testid="consolidacao-grupo"
      />
      <label
        >{{ k('competencia') }}
        <input v-model="competencia" type="month" required data-testid="consolidacao-competencia"
      /></label>
    </div>
    <p
      v-if="apoio.data.value && !apoio.data.value.grupos.length"
      class="ajuda"
      data-testid="consolidacao-sem-grupo"
    >
      {{ k('semGrupo') }}
    </p>

    <div class="acoes" role="tablist">
      <SanteBotao
        v-for="x in ABAS"
        :key="x"
        role="tab"
        :aria-selected="aba === x"
        :variante="aba === x ? 'primario' : 'secundario'"
        :rotulo="k(`abas.${x}`)"
        :data-testid="`consolidacao-aba-${x}`"
        @acionar="aba = x"
      />
    </div>

    <SanteAlerta
      v-if="aviso"
      variante="info"
      icone="info"
      :texto="aviso"
      anunciar
      data-testid="consolidacao-aviso"
    />
    <MensagemErro v-if="erro" :erro="erro" />

    <!-- Grupo e estabelecimentos -->
    <form
      v-if="aba === 'grupo'"
      class="bloco"
      data-testid="consolidacao-form-grupo"
      @submit.prevent="salvarGrupo"
    >
      <div class="formulario">
        <label
          >{{ k('campos.codigo') }}
          <input
            v-model="g.codigo"
            maxlength="30"
            required
            :disabled="!podeEditar"
            data-testid="consolidacao-codigo"
        /></label>
        <label class="largo"
          >{{ k('campos.nome') }}
          <input
            v-model="g.nome"
            maxlength="150"
            required
            :disabled="!podeEditar"
            data-testid="consolidacao-nome"
        /></label>
        <label
          >{{ k('campos.vigenciaInicio') }}
          <input
            v-model="g.vigenciaInicio"
            type="date"
            required
            :disabled="!podeEditar"
            data-testid="consolidacao-vigencia-inicio"
        /></label>
        <label
          >{{ k('campos.vigenciaFim') }}
          <input
            v-model="g.vigenciaFim"
            type="date"
            :disabled="!podeEditar"
            data-testid="consolidacao-vigencia-fim"
        /></label>
        <label class="marcar"
          ><input
            v-model="g.elimina"
            type="checkbox"
            :disabled="!podeEditar"
            data-testid="consolidacao-elimina"
          />
          {{ k('campos.elimina') }}</label
        >
        <label class="largo"
          >{{ k('campos.observacao') }}
          <input
            v-model="g.observacao"
            maxlength="500"
            :disabled="!podeEditar"
            data-testid="consolidacao-observacao"
        /></label>
      </div>
      <table data-testid="consolidacao-membros">
        <thead>
          <tr>
            <th>{{ k('campos.estabelecimento') }}</th>
            <th>{{ k('campos.percentual') }}</th>
            <th>{{ k('campos.metodo') }}</th>
            <th>{{ k('campos.consolidadora') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in g.membros" :key="i" :data-testid="`consolidacao-membro-${i}`">
            <td>
              <SanteSelecao
                v-model="m.estabelecimento"
                :rotulo="k('campos.estabelecimento')"
                ocultar-rotulo
                :opcoes="opEstabelecimentos"
                :desabilitado="!podeEditar"
                :data-testid="`consolidacao-membro-${i}-estabelecimento`"
              />
            </td>
            <td>
              <input
                v-model.number="m.percentual"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                :aria-label="k('campos.percentual')"
                :disabled="!podeEditar"
                :data-testid="`consolidacao-membro-${i}-percentual`"
              />
            </td>
            <td>
              <SanteSelecao
                v-model="m.metodo"
                :rotulo="k('campos.metodo')"
                ocultar-rotulo
                :opcoes="opMetodos"
                :desabilitado="!podeEditar"
                :data-testid="`consolidacao-membro-${i}-metodo`"
              />
            </td>
            <td>
              <input
                type="radio"
                name="consolidadora"
                :checked="m.consolidadora"
                :aria-label="k('campos.consolidadora')"
                :disabled="!podeEditar"
                :data-testid="`consolidacao-membro-${i}-consolidadora`"
                @change="marcarConsolidadora(i)"
              />
            </td>
            <td>
              <SanteBotao
                v-if="podeEditar && g.membros.length > 1"
                variante="texto"
                :rotulo="k('botoes.remover')"
                :data-testid="`consolidacao-membro-${i}-remover`"
                @acionar="g.membros.splice(i, 1)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <ul v-if="problemasGrupo.length" class="problemas" data-testid="consolidacao-problemas-grupo">
        <li v-for="p in problemasGrupo" :key="p">{{ p }}</li>
      </ul>
      <div v-if="podeEditar" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="k('botoes.incluirMembro')"
          data-testid="consolidacao-incluir-membro"
          @acionar="g.membros.push(novoMembro(false))"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="k('botoes.salvarGrupo')"
          :desabilitado="problemasGrupo.length > 0 || acao.isPending.value"
          data-testid="consolidacao-salvar-grupo"
        />
      </div>
    </form>

    <!-- Plano gerencial comum e de-para -->
    <div v-if="aba === 'depara'" class="bloco" data-testid="consolidacao-depara">
      <p v-if="grupo === null" class="ajuda">{{ k('problemas.escolhaGrupo') }}</p>
      <template v-else>
        <MensagemErro v-if="detalhe.isError.value" :erro="detalhe.error.value" />
        <p class="ajuda" data-testid="consolidacao-contador-gerenciais">
          {{ k('contadores.gerenciais', { n: detalhe.data.value?.gerenciais.length ?? 0, ano: exercicio }) }}
        </p>
        <form
          v-if="podeEditar"
          class="formulario"
          data-testid="consolidacao-form-conta"
          @submit.prevent="incluirConta"
        >
          <label
            >{{ k('campos.classificacao') }}
            <input
              v-model="c.classificacao"
              maxlength="40"
              required
              data-testid="consolidacao-conta-classificacao"
          /></label>
          <label class="largo"
            >{{ k('campos.descricao') }}
            <input v-model="c.descricao" maxlength="150" required data-testid="consolidacao-conta-descricao"
          /></label>
          <SanteSelecao
            v-model="c.natureza"
            :rotulo="k('campos.natureza')"
            :opcoes="opNaturezas"
            data-testid="consolidacao-conta-natureza"
          />
          <SanteSelecao
            v-model="c.tipo"
            :rotulo="k('campos.tipo')"
            :opcoes="opTipos"
            data-testid="consolidacao-conta-tipo"
          />
          <ul
            v-if="problemasConta.length && c.classificacao"
            class="problemas"
            data-testid="consolidacao-problemas-conta"
          >
            <li v-for="p in problemasConta" :key="p">{{ p }}</li>
          </ul>
          <SanteBotao
            tipo="submit"
            :rotulo="k('botoes.incluirConta')"
            :desabilitado="problemasConta.length > 0 || acao.isPending.value"
            data-testid="consolidacao-incluir-conta"
          />
        </form>

        <p class="ajuda" data-testid="consolidacao-contador-contas">
          {{ k('contadores.contas', { n: detalhe.data.value?.depara.length ?? 0, sem: semDePara }) }}
        </p>
        <label class="marcar"
          ><input v-model="soPendentes" type="checkbox" data-testid="consolidacao-so-pendentes" />
          {{ k('campos.filtroPendentes') }}</label
        >
        <table data-testid="consolidacao-tabela-depara">
          <thead>
            <tr>
              <th>{{ k('campos.estabelecimento') }}</th>
              <th>{{ k('campos.conta') }}</th>
              <th>{{ k('campos.natureza') }}</th>
              <th>{{ k('campos.gerencial') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in contasDePara" :key="x.conta" :data-testid="`consolidacao-depara-${x.conta}`">
              <td>{{ nomeEst.get(x.estabelecimento) ?? x.estabelecimento }}</td>
              <td>{{ x.classificacao }} {{ x.descricao }}</td>
              <td>{{ k(`naturezas.${x.natureza}`) }}</td>
              <td>
                <SanteSelecao
                  :model-value="escolhas[x.conta] ?? null"
                  @update:model-value="(v: number | null) => (escolhas[x.conta] = v)"
                  :rotulo="k('campos.gerencial')"
                  ocultar-rotulo
                  :opcoes="opGerenciais(x.natureza)"
                  :desabilitado="!podeEditar"
                  :data-testid="`consolidacao-depara-${x.conta}-gerencial`"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <SanteBotao
          v-if="podeEditar"
          :rotulo="k('botoes.salvarDePara', { n: alteracoes.length })"
          :desabilitado="!alteracoes.length || acao.isPending.value"
          data-testid="consolidacao-salvar-depara"
          @acionar="salvarDePara"
        />
      </template>
    </div>

    <!-- Prévia e apuração -->
    <div v-if="aba === 'apuracao'" class="bloco" data-testid="consolidacao-apuracao">
      <p v-if="grupo === null" class="ajuda">{{ k('problemas.escolhaGrupo') }}</p>
      <template v-else>
        <h2>{{ k('previa.titulo') }}</h2>
        <MensagemErro v-if="previa.isError.value" :erro="previa.error.value" />
        <p v-else-if="previa.isPending.value">{{ k('carregando') }}</p>
        <template v-if="previa.data.value">
          <p data-testid="consolidacao-rodada">
            {{
              vigente
                ? k('previa.vigente', {
                    situacao: situacaoApuracao(vigente.situacao),
                    versao: vigente.versao,
                  })
                : k('previa.semRodada')
            }}
          </p>
          <p data-testid="consolidacao-total-eliminado">
            {{ k('previa.totalEliminado', { valor: reais(previa.data.value.totalEliminado) }) }}
          </p>
          <p class="ajuda" data-testid="consolidacao-conferencia">{{ previa.data.value.conferencia }}</p>

          <h3>{{ k('previa.pendencias') }}</h3>
          <p v-if="!previa.data.value.pendencias.length" data-testid="consolidacao-sem-pendencias">
            {{ k('previa.semPendencias') }}
          </p>
          <table v-else data-testid="consolidacao-pendencias">
            <thead>
              <tr>
                <th>{{ k('previa.colunas.tipo') }}</th>
                <th>{{ k('previa.colunas.estabelecimento') }}</th>
                <th>{{ k('previa.colunas.conta') }}</th>
                <th>{{ k('previa.colunas.valor') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in previa.data.value.pendencias" :key="i">
                <td>{{ k(`previa.tiposPendencia.${p.tipo}`) }}</td>
                <td>{{ p.estabelecimentoNome }}</td>
                <td>{{ p.contaNome }}</td>
                <td class="num">{{ reais(p.valor) }}</td>
              </tr>
            </tbody>
          </table>

          <h3>{{ k('previa.eliminacoes') }}</h3>
          <table data-testid="consolidacao-eliminacoes">
            <thead>
              <tr>
                <th>{{ k('previa.colunas.origem') }}</th>
                <th>{{ k('previa.colunas.contraparte') }}</th>
                <th>{{ k('previa.colunas.debito') }}</th>
                <th>{{ k('previa.colunas.credito') }}</th>
                <th>{{ k('previa.colunas.valor') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in previa.data.value.eliminacoes" :key="e.sequencia">
                <td>{{ e.origemNome }}</td>
                <td>{{ e.contraparteNome }}</td>
                <td>{{ e.debitoNome }}</td>
                <td>{{ e.creditoNome }}</td>
                <td class="num">{{ reais(e.valor) }}</td>
              </tr>
            </tbody>
          </table>

          <h3>{{ k('previa.totais') }}</h3>
          <table data-testid="consolidacao-totais">
            <thead>
              <tr>
                <th>{{ k('previa.colunas.conta') }}</th>
                <th>{{ k('previa.colunas.anterior') }}</th>
                <th>{{ k('previa.colunas.debitos') }}</th>
                <th>{{ k('previa.colunas.creditos') }}</th>
                <th>{{ k('previa.colunas.eliminado') }}</th>
                <th>{{ k('previa.colunas.final') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in previa.data.value.totais" :key="x.gerencial">
                <td>{{ x.classificacao }} {{ x.descricao }}</td>
                <td class="num">{{ reais(x.anterior) }}</td>
                <td class="num">{{ reais(x.debitos) }}</td>
                <td class="num">{{ reais(x.creditos) }}</td>
                <td class="num">{{ reais(x.eliminado) }}</td>
                <td class="num">{{ reais(x.final) }}</td>
              </tr>
            </tbody>
          </table>
          <SanteBotao
            v-if="podeApurar && vigente?.situacao !== 'liberada'"
            :rotulo="k('botoes.apurar')"
            :desabilitado="acao.isPending.value"
            data-testid="consolidacao-apurar"
            @acionar="apurar"
          />
        </template>

        <h2>{{ k('apuracoes.titulo') }}</h2>
        <p v-if="!detalhe.data.value?.apuracoes.length">{{ k('apuracoes.nenhuma') }}</p>
        <table v-else data-testid="consolidacao-apuracoes">
          <tbody>
            <tr
              v-for="a in detalhe.data.value.apuracoes"
              :key="a.id"
              :data-testid="`consolidacao-apuracao-${a.id}`"
            >
              <td>{{ a.competencia }}</td>
              <td>{{ situacaoApuracao(a.situacao) }}</td>
              <td class="num">{{ reaisDecimal(a.eliminado) }}</td>
              <td>
                <span v-if="a.liberadoEm">{{
                  k('apuracoes.liberadaEm', { data: a.liberadoEm.slice(0, 10) })
                }}</span>
                <SanteBotao
                  v-else-if="podeApurar && a.situacao === 'apurada'"
                  variante="secundario"
                  :rotulo="k('botoes.liberar')"
                  :data-testid="`consolidacao-liberar-${a.id}`"
                  @acionar="liberar(a.id, a.versao)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <!-- DRE e balanço consolidados -->
    <div v-if="aba === 'demonstracoes'" class="bloco" data-testid="consolidacao-demonstracoes">
      <p v-if="grupo === null" class="ajuda">{{ k('problemas.escolhaGrupo') }}</p>
      <template v-else>
        <MensagemErro v-if="demonstracoes.isError.value" :erro="demonstracoes.error.value" />
        <template v-if="demonstracoes.data.value">
          <p v-if="!demonstracoes.data.value.rodada" class="ajuda" data-testid="consolidacao-dem-sem-rodada">
            {{ k('demonstracoes.semRodada') }}
          </p>
          <h2>{{ k('demonstracoes.dre') }}</h2>
          <table data-testid="consolidacao-dre">
            <tbody>
              <tr v-for="l in demonstracoes.data.value.dre.linhas" :key="l.chave" :class="{ total: l.total }">
                <td>{{ l.rotulo }}</td>
                <td class="num">{{ reais(l.valorCentavos) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="ajuda">{{ demonstracoes.data.value.dre.conferencia }}</p>
          <h2>{{ k('demonstracoes.balanco') }}</h2>
          <table data-testid="consolidacao-balanco">
            <tbody>
              <tr
                v-for="s in [
                  demonstracoes.data.value.balanco.ativo,
                  demonstracoes.data.value.balanco.passivo,
                  demonstracoes.data.value.balanco.patrimonioLiquido,
                ]"
                :key="s.rotulo"
              >
                <td>{{ s.rotulo }}</td>
                <td class="num">{{ reais(s.totalCentavos) }}</td>
              </tr>
              <tr>
                <td>{{ k('demonstracoes.resultadoExercicio') }}</td>
                <td class="num">{{ reais(demonstracoes.data.value.balanco.resultadoExercicioCentavos) }}</td>
              </tr>
              <tr class="total">
                <td>{{ k('demonstracoes.totalAtivo') }}</td>
                <td class="num">{{ reais(demonstracoes.data.value.balanco.totalAtivoCentavos) }}</td>
              </tr>
              <tr class="total">
                <td>{{ k('demonstracoes.totalPassivoPl') }}</td>
                <td class="num">{{ reais(demonstracoes.data.value.balanco.totalPassivoPlCentavos) }}</td>
              </tr>
            </tbody>
          </table>
          <p data-testid="consolidacao-equilibrio">
            {{
              demonstracoes.data.value.balanco.equilibrado
                ? k('demonstracoes.equilibrado')
                : k('demonstracoes.desequilibrado')
            }}
          </p>
          <p class="ajuda">{{ demonstracoes.data.value.balanco.conferencia }}</p>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
.formulario,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.largo {
  flex-basis: 100%;
}
.marcar {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.total td {
  font-weight: 600;
}
.problemas {
  flex-basis: 100%;
  color: var(--sgh-perigo);
}
</style>
