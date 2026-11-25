<script setup lang="ts">
// Cardápio e produção do serviço de nutrição e dietética (F8, 04-HOT linha 141). Três abas na mesma tela:
//   - preparações: a ficha técnica com o cálculo na hora (líquido pelo fator de correção, custo per capita e da porção,
//     pela mesma regra do domínio), sem sair da lista;
//   - planejamento: o cardápio por refeição e por dieta em rascunho (preparações por dia e opção), o fluxo de aprovação
//     pela nutricionista (RDC 216/2004; Resolução CFN 600/2018) e a previsão da produção do dia pelo mapa de dietas;
//   - escolha do paciente: o cardápio publicado do dia com as opções e as escolhas da internação (visão por paciente).
// Nada é apagado: a linha que sai da ficha ou do planejamento fica marcada; a escolha trocada fica cancelada.
import { calcularFichaTecnica } from '@sgh/dominio-pep';
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { novaChaveNutricao } from '../api-nutricao.js';
import {
  agirPlanejamento,
  aprovarPlanejamento,
  buscarGeneros,
  cancelarEscolha,
  lerCadastrosCardapio,
  lerCardapioDoDia,
  lerPlanejamento,
  lerPlanejamentos,
  lerPreparacao,
  lerPreparacoes,
  lerProducao,
  registrarEscolha,
  salvarPlanejamento,
  salvarPreparacao,
  type GeneroAlimenticio,
  type Planejamento,
  type ProducaoDoDia,
} from '../api-cardapio.js';
import ErroNutricao from '../componentes/ErroNutricao.vue';

const { t } = useI18n();
const rota = useRoute();
const { permissoes } = usarSessao();
const podePlanejar = computed(() => permissoes.value.has(P.mapaFechar));
const podeAprovar = computed(() => permissoes.value.has(P.nutricaoTriar));
const podeEscolher = computed(() => permissoes.value.has(P.mapaImprimir));

type Aba = 'preparacoes' | 'planejamento' | 'escolha';
const ABAS: Aba[] = ['preparacoes', 'planejamento', 'escolha'];
const aba = ref<Aba>(ABAS.includes(rota.query['aba'] as Aba) ? (rota.query['aba'] as Aba) : 'preparacoes');

const hoje = new Intl.DateTimeFormat('en-CA').format(new Date());
const somaDias = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const reais = (v: number | null) =>
  v === null
    ? t('nutricao.cardapio.semCusto')
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (s: string): number | null => {
  const x = s.trim().replace(',', '.');
  if (x === '') return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : Number.NaN;
};

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function executar(fn: () => Promise<void>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const cadastros = useQuery({
  queryKey: ['nutricao', 'cardapio', 'cadastros'],
  queryFn: lerCadastrosCardapio,
  staleTime: 300_000,
});
const opcoesRefeicao = computed(() =>
  (cadastros.data.value?.refeicoes ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
);
const opcoesAlternativa = computed(() => [
  { valor: 0, rotulo: t('nutricao.cardapio.opcaoPadrao') },
  ...(cadastros.data.value?.alternativas ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcoesDieta = computed(() => [
  { valor: 0, rotulo: t('nutricao.cardapio.dietaGeral') },
  ...(cadastros.data.value?.modalidades ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcoesTipo = computed(() =>
  (cadastros.data.value?.tipos ?? []).map((x) => ({ valor: x, rotulo: t(`nutricao.cardapio.tipos.${x}`) })),
);
const opcoesPublico = ['paciente', 'acompanhante', 'colaborador', 'todos'].map((x) => ({
  valor: x,
  rotulo: t(`nutricao.cardapio.publicos.${x}`),
}));

// ───────────────────────────── Preparações e ficha técnica
const termo = ref('');
const preparacoes = useQuery({
  queryKey: computed(() => ['nutricao', 'cardapio', 'preparacoes', termo.value]),
  queryFn: () => lerPreparacoes(termo.value.trim()),
});
interface LinhaFicha {
  insumo: number;
  nome: string;
  unidade: number;
  sigla: string;
  bruto: string;
  fc: string;
  coccao: string;
  custo: string;
}
const prep = reactive({
  aberta: false,
  id: null as number | null,
  versao: null as number | null,
  codigo: '',
  nome: '',
  tipo: 'prato_principal' as string,
  rendimento: '',
  peso: '',
  modo: '',
  ficha: [] as LinhaFicha[],
});
function novaPreparacao(): void {
  Object.assign(prep, {
    aberta: true,
    id: null,
    versao: null,
    codigo: '',
    nome: '',
    tipo: 'prato_principal',
    rendimento: '',
    peso: '',
    modo: '',
    ficha: [],
  });
}
const editarPreparacao = (id: number) =>
  executar(async () => {
    const p = await lerPreparacao(id);
    Object.assign(prep, {
      aberta: true,
      id: p.id,
      versao: p.versao,
      codigo: p.codigo,
      nome: p.nome,
      tipo: p.tipo,
      rendimento: p.rendimentoPorcoes === null ? '' : String(p.rendimentoPorcoes),
      peso: p.pesoPorcaoGramas === null ? '' : String(p.pesoPorcaoGramas),
      modo: p.modoPreparo ?? '',
      ficha: p.ficha.map((f) => ({
        insumo: f.insumo,
        nome: f.nome,
        unidade: f.unidade,
        sigla: f.sigla,
        bruto: String(f.perCapitaBruto),
        fc: String(f.fatorCorrecao),
        coccao: f.fatorCoccao === null ? '' : String(f.fatorCoccao),
        custo: f.custoUnidade === null ? '' : String(f.custoUnidade),
      })),
    });
  });

const buscaGenero = ref('');
const achados = ref<GeneroAlimenticio[]>([]);
const generoEscolhido = ref<number | null>(null);
const procurarGenero = () =>
  executar(async () => {
    achados.value = buscaGenero.value.trim().length >= 2 ? await buscarGeneros(buscaGenero.value.trim()) : [];
    generoEscolhido.value = achados.value[0]?.id ?? null;
  });
const opcoesGenero = computed(() =>
  achados.value.map((g) => ({ valor: g.id, rotulo: `${g.nome} (${g.sigla})` })),
);
function incluirGenero(): void {
  const g = achados.value.find((x) => x.id === generoEscolhido.value);
  if (!g || prep.ficha.some((f) => f.insumo === g.id)) return;
  prep.ficha.push({
    insumo: g.id,
    nome: g.nome,
    unidade: g.unidade,
    sigla: g.sigla,
    bruto: '',
    fc: '1',
    coccao: '',
    custo: '',
  });
}

/** O cálculo da ficha na hora, pela mesma regra do domínio que o servidor aplica. */
const calculo = computed(() => {
  const entradas = prep.ficha.map((f) => ({
    insumo: f.insumo,
    perCapitaBruto: numero(f.bruto) ?? 0,
    fatorCorrecao: numero(f.fc),
    fatorCoccao: numero(f.coccao),
    custoUnidade: numero(f.custo),
  }));
  if (entradas.some((e) => [e.fatorCorrecao, e.fatorCoccao, e.custoUnidade].some((v) => Number.isNaN(v))))
    return {
      ok: false as const,
      problemas: [{ campo: 'ficha', mensagem: t('nutricao.cardapio.numeroInvalido') }],
    };
  return calcularFichaTecnica(entradas);
});
const problemaDaLinha = (k: number) =>
  calculo.value.ok
    ? null
    : (calculo.value.problemas.find((p) => p.campo.startsWith(`ficha.${k}`))?.mensagem ?? null);
const linhaCalculada = (k: number) => (calculo.value.ok ? calculo.value.valor.itens[k] : undefined);
const podeSalvarPrep = computed(
  () =>
    podePlanejar.value &&
    calculo.value.ok &&
    prep.codigo.trim() !== '' &&
    prep.nome.trim().length >= 2 &&
    !ocupado.value,
);
const salvarPrep = () =>
  executar(async () => {
    const r = await salvarPreparacao(
      {
        ...(prep.id ? { id: prep.id, versao: prep.versao ?? 1 } : {}),
        codigo: prep.codigo.trim(),
        nome: prep.nome.trim(),
        tipo: prep.tipo,
        modoPreparo: prep.modo.trim() || null,
        rendimentoPorcoes: numero(prep.rendimento),
        pesoPorcaoGramas: numero(prep.peso),
        ficha: prep.ficha.map((f) => ({
          insumo: f.insumo,
          unidade: f.unidade,
          perCapitaBruto: numero(f.bruto) ?? 0,
          fatorCorrecao: numero(f.fc),
          fatorCoccao: numero(f.coccao),
          custoUnidade: numero(f.custo),
        })),
      },
      novaChaveNutricao('cardapio-preparacao'),
    );
    mensagem.value = r.mensagem;
    prep.aberta = false;
    await preparacoes.refetch();
  });

// ───────────────────────────── Planejamento e produção
const de = ref<string | null>(hoje);
const ate = ref<string | null>(somaDias(hoje, 30));
const planejamentos = useQuery({
  queryKey: computed(() => ['nutricao', 'cardapio', 'planejamentos', de.value, ate.value]),
  queryFn: () => lerPlanejamentos(de.value ?? hoje, ate.value ?? hoje),
  enabled: computed(() => aba.value === 'planejamento' && !!de.value && !!ate.value),
});
const todasPreparacoes = useQuery({
  queryKey: ['nutricao', 'cardapio', 'preparacoes', 'todas'],
  queryFn: () => lerPreparacoes(''),
  enabled: computed(() => aba.value === 'planejamento'),
});
const opcoesPreparacao = computed(() =>
  (todasPreparacoes.data.value ?? []).filter((p) => p.ativo).map((p) => ({ valor: p.id, rotulo: p.nome })),
);
const nomePrep = (id: number) =>
  (todasPreparacoes.data.value ?? []).find((p) => p.id === id)?.nome ?? String(id);
const nomeAlt = (id: number) => opcoesAlternativa.value.find((o) => o.valor === id)?.rotulo ?? '';

interface LinhaPlano {
  data: string;
  alternativa: number;
  preparacao: number;
  porcoes: string;
}
const plano = reactive({
  aberto: false,
  id: null as number | null,
  versao: null as number | null,
  situacao: 'rascunho',
  aprovador: null as string | null,
  descricao: '',
  inicio: hoje as string | null,
  fim: somaDias(hoje, 6) as string | null,
  refeicao: null as number | null,
  dieta: 0,
  publico: 'paciente',
  observacao: '',
  itens: [] as LinhaPlano[],
});
const editavel = computed(() => podePlanejar.value && plano.situacao === 'rascunho');
const diasDoPeriodo = computed(() => {
  if (!plano.inicio || !plano.fim || plano.fim < plano.inicio) return [];
  const r: string[] = [];
  for (let d = plano.inicio; d <= plano.fim && r.length < 31; d = somaDias(d, 1)) r.push(d);
  return r;
});
const opcoesDia = computed(() => diasDoPeriodo.value.map((d) => ({ valor: d, rotulo: dataCurta(d) })));
const periodoInvalido = computed(
  () => !plano.inicio || !plano.fim || plano.fim < plano.inicio || somaDias(plano.inicio, 30) < plano.fim,
);
const novaLinha = reactive({ data: hoje, alternativa: 0, preparacao: null as number | null, porcoes: '' });
const linhaRepetida = computed(() =>
  plano.itens.some(
    (i) =>
      i.data === novaLinha.data &&
      i.alternativa === novaLinha.alternativa &&
      i.preparacao === novaLinha.preparacao,
  ),
);
const podeIncluirLinha = computed(
  () =>
    novaLinha.preparacao !== null &&
    (numero(novaLinha.porcoes) ?? 0) > 0 &&
    !linhaRepetida.value &&
    diasDoPeriodo.value.includes(novaLinha.data),
);
function incluirLinha(): void {
  if (!podeIncluirLinha.value) return;
  plano.itens.push({
    data: novaLinha.data,
    alternativa: novaLinha.alternativa,
    preparacao: novaLinha.preparacao as number,
    porcoes: novaLinha.porcoes,
  });
  plano.itens.sort((a, b) => a.data.localeCompare(b.data) || a.alternativa - b.alternativa);
  novaLinha.preparacao = null;
}
function novoPlano(): void {
  Object.assign(plano, {
    aberto: true,
    id: null,
    versao: null,
    situacao: 'rascunho',
    aprovador: null,
    descricao: '',
    inicio: hoje,
    fim: somaDias(hoje, 6),
    refeicao: opcoesRefeicao.value[0]?.valor ?? null,
    dieta: 0,
    publico: 'paciente',
    observacao: '',
    itens: [],
  });
  novaLinha.data = hoje;
  producao.value = null;
}
function carregarPlano(p: Planejamento): void {
  Object.assign(plano, {
    aberto: true,
    id: p.id,
    versao: p.versao,
    situacao: p.situacao,
    aprovador: p.aprovador,
    descricao: p.descricao,
    inicio: p.periodoInicio,
    fim: p.periodoFim,
    refeicao: p.refeicao,
    dieta: p.modalidade ?? 0,
    publico: p.publico,
    observacao: p.observacao ?? '',
    itens: p.itens.map((i) => ({
      data: i.data,
      alternativa: i.alternativa ?? 0,
      preparacao: i.preparacao,
      porcoes: String(i.porcoes),
    })),
  });
  novaLinha.data = p.periodoInicio;
  diaProducao.value = p.periodoInicio <= hoje && hoje <= p.periodoFim ? hoje : p.periodoInicio;
}
const abrirPlano = (id: number) =>
  executar(async () => {
    producao.value = null;
    carregarPlano(await lerPlanejamento(id));
  });
const podeSalvarPlano = computed(
  () =>
    editavel.value &&
    plano.descricao.trim().length >= 3 &&
    plano.refeicao !== null &&
    !periodoInvalido.value &&
    !ocupado.value,
);
const salvarPlano = () =>
  executar(async () => {
    const r = await salvarPlanejamento(
      {
        ...(plano.id ? { id: plano.id, versao: plano.versao ?? 1 } : {}),
        descricao: plano.descricao.trim(),
        periodoInicio: plano.inicio as string,
        periodoFim: plano.fim as string,
        refeicao: plano.refeicao as number,
        modalidade: plano.dieta || null,
        publico: plano.publico,
        observacao: plano.observacao.trim() || null,
        itens: plano.itens.map((i) => ({
          data: i.data,
          alternativa: i.alternativa || null,
          preparacao: i.preparacao,
          porcoes: numero(i.porcoes) ?? 0,
        })),
      },
      novaChaveNutricao('cardapio-planejamento'),
    );
    carregarPlano(await lerPlanejamento(r.id));
    mensagem.value = t('nutricao.cardapio.planejamentoSalvo');
    await planejamentos.refetch();
  });
const motivo = ref('');
const motivoCurto = computed(() => motivo.value.trim().length < 5);
const agir = (acao: 'enviar' | 'devolver' | 'publicar' | 'cancelar' | 'aprovar') =>
  executar(async () => {
    const id = plano.id as number;
    const versao = plano.versao ?? 1;
    if (acao === 'aprovar') await aprovarPlanejamento(id, versao, novaChaveNutricao('cardapio-aprovar'));
    else
      await agirPlanejamento(
        id,
        { acao, versao, motivo: motivo.value.trim() || null },
        novaChaveNutricao(`cardapio-${acao}`),
      );
    const p = await lerPlanejamento(id);
    carregarPlano(p);
    motivo.value = '';
    mensagem.value = t('nutricao.cardapio.acaoFeita', {
      situacao: t(`nutricao.cardapio.situacoes.${p.situacao}`),
    });
    await planejamentos.refetch();
  });

const diaProducao = ref(hoje);
const margem = ref('5');
const producao = ref<ProducaoDoDia | null>(null);
const calcularProducao = () =>
  executar(async () => {
    producao.value = await lerProducao(plano.id as number, diaProducao.value, numero(margem.value) ?? 0);
  });

// ───────────────────────────── Escolha do paciente
const escolha = reactive({
  data: hoje as string | null,
  refeicao: null as number | null,
  internacao: typeof rota.query['internacao'] === 'string' ? rota.query['internacao'] : '',
});
const internacaoNum = computed(() => {
  const n = Number(escolha.internacao.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
});
const consultaDia = ref<{ data: string; refeicao: number; internacao: number | null } | null>(null);
const dia = useQuery({
  queryKey: computed(() => ['nutricao', 'cardapio', 'dia', consultaDia.value]),
  queryFn: () =>
    lerCardapioDoDia(consultaDia.value!.data, consultaDia.value!.refeicao, consultaDia.value!.internacao),
  enabled: computed(() => consultaDia.value !== null),
});
function verDia(): void {
  if (!escolha.data || escolha.refeicao === null) return;
  consultaDia.value = { data: escolha.data, refeicao: escolha.refeicao, internacao: internacaoNum.value };
}
const quantidade = ref(1);
const escolher = (alternativa: number) =>
  executar(async () => {
    const c = consultaDia.value!;
    const r = await registrarEscolha(
      {
        internacao: c.internacao as number,
        data: c.data,
        refeicao: c.refeicao,
        alternativa,
        quantidade: quantidade.value,
      },
      novaChaveNutricao('cardapio-escolha'),
    );
    mensagem.value = r.substituida ? t('nutricao.cardapio.substituida') : t('nutricao.cardapio.escolhida');
    await dia.refetch();
  });
const desfazer = (id: number, versao: number) =>
  executar(async () => {
    await cancelarEscolha(id, versao, novaChaveNutricao('cardapio-escolha-cancelar'));
    mensagem.value = t('nutricao.cardapio.escolhaCancelada');
    await dia.refetch();
  });
</script>

<template>
  <main class="cardapio" data-testid="tela-cardapio">
    <h1>{{ t('nutricao.cardapio.titulo') }}</h1>
    <p class="secundario">{{ t('nutricao.cardapio.texto') }}</p>

    <div class="abas" role="tablist">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :class="{ ativa: aba === a }"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      >
        {{ t(`nutricao.cardapio.abas.${a}`) }}
      </button>
    </div>

    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="cardapio-mensagem" />
    <ErroNutricao v-if="erro" :erro="erro" />

    <!-- Preparações e ficha técnica -->
    <section v-if="aba === 'preparacoes'" role="tabpanel" data-testid="painel-preparacoes">
      <div class="linha">
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('nutricao.cardapio.buscarPreparacao')"
          :max-bytes="60"
          data-testid="busca-preparacao"
        />
        <SanteBotao
          v-if="podePlanejar"
          variante="secundario"
          :rotulo="t('nutricao.cardapio.novaPreparacao')"
          data-testid="nova-preparacao"
          @acionar="novaPreparacao()"
        />
      </div>
      <table class="tabela" data-testid="tabela-preparacoes">
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.cardapio.codigo') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.nome') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.tipo') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.ingredientes') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.custoPorcao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in preparacoes.data.value ?? []" :key="p.id" :data-testid="`preparacao-${p.id}`">
            <td>{{ p.codigo }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="p.nome"
                :data-testid="`abrir-preparacao-${p.id}`"
                @acionar="editarPreparacao(p.id)"
              />
            </td>
            <td>{{ t(`nutricao.cardapio.tipos.${p.tipo}`) }}</td>
            <td>{{ p.ingredientes }}</td>
            <td>{{ reais(p.custoPorcao) }}</td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="prep.aberta"
        class="formulario"
        data-testid="form-preparacao"
        @submit.prevent="podeSalvarPrep && salvarPrep()"
      >
        <div class="grade">
          <SanteCampoTexto
            v-model="prep.codigo"
            :rotulo="t('nutricao.cardapio.codigo')"
            :max-bytes="30"
            obrigatorio
            data-testid="prep-codigo"
          />
          <SanteCampoTexto
            v-model="prep.nome"
            :rotulo="t('nutricao.cardapio.nome')"
            :max-bytes="150"
            obrigatorio
            data-testid="prep-nome"
          />
          <SanteSelecao
            v-model="prep.tipo"
            :rotulo="t('nutricao.cardapio.tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="prep-tipo"
          />
          <SanteCampoTexto
            v-model="prep.rendimento"
            :rotulo="t('nutricao.cardapio.rendimento')"
            :max-bytes="12"
            data-testid="prep-rendimento"
          />
          <SanteCampoTexto
            v-model="prep.peso"
            :rotulo="t('nutricao.cardapio.pesoPorcao')"
            :max-bytes="12"
            data-testid="prep-peso"
          />
        </div>
        <SanteCampoTexto
          v-model="prep.modo"
          :rotulo="t('nutricao.cardapio.modoPreparo')"
          :max-bytes="8000"
          multilinha
          data-testid="prep-modo"
        />

        <h2>{{ t('nutricao.cardapio.ficha') }}</h2>
        <div class="linha">
          <SanteCampoTexto
            v-model="buscaGenero"
            :rotulo="t('nutricao.cardapio.buscarGenero')"
            :max-bytes="60"
            data-testid="busca-genero"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('nutricao.cardapio.buscar')"
            :desabilitado="buscaGenero.trim().length < 2"
            data-testid="buscar-genero"
            @acionar="procurarGenero()"
          />
          <SanteSelecao
            v-if="achados.length"
            v-model="generoEscolhido"
            :rotulo="t('nutricao.cardapio.genero')"
            :opcoes="opcoesGenero"
            data-testid="genero-achado"
          />
          <SanteBotao
            v-if="achados.length"
            variante="secundario"
            :rotulo="t('nutricao.cardapio.incluirGenero')"
            data-testid="incluir-genero"
            @acionar="incluirGenero()"
          />
        </div>
        <p v-if="prep.ficha.length === 0" class="falta" role="status">
          {{ t('nutricao.cardapio.fichaVazia') }}
        </p>
        <table v-else class="tabela" data-testid="tabela-ficha">
          <thead>
            <tr>
              <th scope="col">{{ t('nutricao.cardapio.genero') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.perCapitaBruto') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.fatorCorrecao') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.perCapitaLiquido') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.fatorCoccao') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.custoUnidade') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.custoPerCapita') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('nutricao.cardapio.remover') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, k) in prep.ficha" :key="f.insumo" :data-testid="`ficha-${f.insumo}`">
              <td>{{ f.nome }} ({{ f.sigla }})</td>
              <td>
                <SanteCampoTexto
                  v-model="f.bruto"
                  :rotulo="t('nutricao.cardapio.perCapitaBruto')"
                  :max-bytes="12"
                  :data-testid="`ficha-bruto-${f.insumo}`"
                />
              </td>
              <td>
                <SanteCampoTexto
                  v-model="f.fc"
                  :rotulo="t('nutricao.cardapio.fatorCorrecao')"
                  :max-bytes="12"
                  :data-testid="`ficha-fc-${f.insumo}`"
                />
              </td>
              <td :data-testid="`ficha-liquido-${f.insumo}`">
                {{ linhaCalculada(k)?.perCapitaLiquido ?? '' }}
              </td>
              <td>
                <SanteCampoTexto
                  v-model="f.coccao"
                  :rotulo="t('nutricao.cardapio.fatorCoccao')"
                  :max-bytes="12"
                  :data-testid="`ficha-coccao-${f.insumo}`"
                />
              </td>
              <td>
                <SanteCampoTexto
                  v-model="f.custo"
                  :rotulo="t('nutricao.cardapio.custoUnidade')"
                  :max-bytes="12"
                  :data-testid="`ficha-custo-${f.insumo}`"
                />
              </td>
              <td :data-testid="`ficha-custo-capita-${f.insumo}`">
                {{ linhaCalculada(k) ? reais(linhaCalculada(k)!.custoPerCapita) : '' }}
              </td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('nutricao.cardapio.remover')"
                  :data-testid="`ficha-remover-${f.insumo}`"
                  @acionar="prep.ficha.splice(k, 1)"
                />
                <p v-if="problemaDaLinha(k)" class="falta" role="status">{{ problemaDaLinha(k) }}</p>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="calculo.ok" data-testid="custo-porcao">
          <strong>{{ t('nutricao.cardapio.custoPorcao') }}: {{ reais(calculo.valor.custoPorcao) }}</strong>
          <span v-if="calculo.valor.semCusto" class="falta">
            · {{ t('nutricao.cardapio.custoParcial', { n: calculo.valor.semCusto }) }}</span
          >
        </p>
        <p class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('nutricao.cardapio.salvar')"
            :desabilitado="!podeSalvarPrep"
            data-testid="salvar-preparacao"
          />
        </p>
      </form>
    </section>

    <!-- Planejamento e produção -->
    <section v-else-if="aba === 'planejamento'" role="tabpanel" data-testid="painel-planejamento">
      <div class="linha">
        <SanteData v-model="de" :rotulo="t('nutricao.cardapio.periodoDe')" editavel data-testid="planos-de" />
        <SanteData
          v-model="ate"
          :rotulo="t('nutricao.cardapio.periodoAte')"
          editavel
          data-testid="planos-ate"
        />
        <SanteBotao
          v-if="podePlanejar"
          variante="secundario"
          :rotulo="t('nutricao.cardapio.novoPlanejamento')"
          data-testid="novo-planejamento"
          @acionar="novoPlano()"
        />
      </div>
      <p v-if="(planejamentos.data.value ?? []).length === 0 && !planejamentos.isLoading.value">
        {{ t('nutricao.cardapio.nenhuma') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-planejamentos">
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.cardapio.descricao') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.periodoDe') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.refeicao') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.dieta') }}</th>
            <th scope="col">{{ t('nutricao.cardapio.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in planejamentos.data.value ?? []" :key="p.id" :data-testid="`planejamento-${p.id}`">
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="p.descricao"
                :data-testid="`abrir-planejamento-${p.id}`"
                @acionar="abrirPlano(p.id)"
              />
            </td>
            <td>
              {{
                t('nutricao.cardapio.periodo', {
                  de: dataCurta(p.periodoInicio),
                  ate: dataCurta(p.periodoFim),
                })
              }}
            </td>
            <td>{{ p.refeicaoDescricao }}</td>
            <td>{{ p.modalidade ?? t('nutricao.cardapio.dietaGeral') }}</td>
            <td>{{ t(`nutricao.cardapio.situacoes.${p.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="plano.aberto"
        class="formulario"
        data-testid="form-planejamento"
        @submit.prevent="podeSalvarPlano && salvarPlano()"
      >
        <p data-testid="plano-situacao">
          <strong>{{ t(`nutricao.cardapio.situacoes.${plano.situacao}`) }}</strong>
          <span v-if="plano.aprovador">
            · {{ t('nutricao.cardapio.aprovador', { nome: plano.aprovador }) }}</span
          >
          <span v-if="!editavel" class="secundario"> · {{ t('nutricao.cardapio.soRascunho') }}</span>
        </p>
        <fieldset :disabled="!editavel" class="grade">
          <SanteCampoTexto
            v-model="plano.descricao"
            :rotulo="t('nutricao.cardapio.descricao')"
            :max-bytes="150"
            obrigatorio
            data-testid="plano-descricao"
          />
          <SanteData
            v-model="plano.inicio"
            :rotulo="t('nutricao.cardapio.periodoDe')"
            editavel
            data-testid="plano-inicio"
          />
          <SanteData
            v-model="plano.fim"
            :rotulo="t('nutricao.cardapio.periodoAte')"
            editavel
            data-testid="plano-fim"
          />
          <SanteSelecao
            v-model="plano.refeicao"
            :rotulo="t('nutricao.cardapio.refeicao')"
            :opcoes="opcoesRefeicao"
            obrigatorio
            data-testid="plano-refeicao"
          />
          <SanteSelecao
            v-model="plano.dieta"
            :rotulo="t('nutricao.cardapio.dieta')"
            :opcoes="opcoesDieta"
            data-testid="plano-dieta"
          />
          <SanteSelecao
            v-model="plano.publico"
            :rotulo="t('nutricao.cardapio.publico')"
            :opcoes="opcoesPublico"
            data-testid="plano-publico"
          />
        </fieldset>
        <p v-if="periodoInvalido" class="falta" role="status">{{ t('nutricao.cardapio.periodoInvalido') }}</p>

        <h2>{{ t('nutricao.cardapio.preparacoesDoDia') }}</h2>
        <table class="tabela" data-testid="tabela-itens-plano">
          <thead>
            <tr>
              <th scope="col">{{ t('nutricao.cardapio.dia') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.opcao') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.preparacao') }}</th>
              <th scope="col">{{ t('nutricao.cardapio.porcoes') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('nutricao.cardapio.remover') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(i, k) in plano.itens"
              :key="`${i.data}|${i.alternativa}|${i.preparacao}`"
              :data-testid="`item-plano-${k}`"
            >
              <td>{{ dataCurta(i.data) }}</td>
              <td>{{ nomeAlt(i.alternativa) }}</td>
              <td>{{ nomePrep(i.preparacao) }}</td>
              <td>{{ i.porcoes }}</td>
              <td>
                <SanteBotao
                  v-if="editavel"
                  variante="texto"
                  :rotulo="t('nutricao.cardapio.remover')"
                  @acionar="plano.itens.splice(k, 1)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="editavel" class="linha" data-testid="nova-linha-plano">
          <SanteSelecao
            v-model="novaLinha.data"
            :rotulo="t('nutricao.cardapio.dia')"
            :opcoes="opcoesDia"
            data-testid="linha-dia"
          />
          <SanteSelecao
            v-model="novaLinha.alternativa"
            :rotulo="t('nutricao.cardapio.opcao')"
            :opcoes="opcoesAlternativa"
            data-testid="linha-opcao"
          />
          <SanteSelecao
            v-model="novaLinha.preparacao"
            :rotulo="t('nutricao.cardapio.preparacao')"
            :opcoes="opcoesPreparacao"
            busca
            data-testid="linha-preparacao"
          />
          <SanteCampoTexto
            v-model="novaLinha.porcoes"
            :rotulo="t('nutricao.cardapio.porcoes')"
            :max-bytes="8"
            data-testid="linha-porcoes"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('nutricao.cardapio.incluirLinha')"
            :desabilitado="!podeIncluirLinha"
            data-testid="incluir-linha"
            @acionar="incluirLinha()"
          />
        </div>
        <p v-if="linhaRepetida" class="falta" role="status">{{ t('nutricao.cardapio.repetida') }}</p>
        <p class="acoes">
          <SanteBotao
            v-if="editavel"
            tipo="submit"
            :rotulo="t('nutricao.cardapio.salvarPlanejamento')"
            :desabilitado="!podeSalvarPlano"
            data-testid="salvar-planejamento"
          />
        </p>

        <div v-if="plano.id" class="acoes-plano" data-testid="acoes-planejamento">
          <SanteCampoTexto
            v-if="podePlanejar && plano.situacao !== 'cancelado'"
            v-model="motivo"
            :rotulo="t('nutricao.cardapio.motivo')"
            :max-bytes="1000"
            data-testid="plano-motivo"
          />
          <SanteBotao
            v-if="podePlanejar && plano.situacao === 'rascunho'"
            :rotulo="t('nutricao.cardapio.enviar')"
            :desabilitado="ocupado || plano.itens.length === 0"
            data-testid="plano-enviar"
            @acionar="agir('enviar')"
          />
          <SanteBotao
            v-if="podeAprovar && plano.situacao === 'em_aprovacao'"
            :rotulo="t('nutricao.cardapio.aprovar')"
            :desabilitado="ocupado"
            data-testid="plano-aprovar"
            @acionar="agir('aprovar')"
          />
          <SanteBotao
            v-if="podePlanejar && plano.situacao === 'em_aprovacao'"
            variante="secundario"
            :rotulo="t('nutricao.cardapio.devolver')"
            :desabilitado="ocupado || motivoCurto"
            data-testid="plano-devolver"
            @acionar="agir('devolver')"
          />
          <SanteBotao
            v-if="podePlanejar && plano.situacao === 'aprovado'"
            :rotulo="t('nutricao.cardapio.publicar')"
            :desabilitado="ocupado"
            data-testid="plano-publicar"
            @acionar="agir('publicar')"
          />
          <SanteBotao
            v-if="podePlanejar && plano.situacao !== 'cancelado'"
            variante="destrutivo"
            :rotulo="t('nutricao.cardapio.cancelarPlano')"
            :desabilitado="ocupado || motivoCurto"
            data-testid="plano-cancelar"
            @acionar="agir('cancelar')"
          />
        </div>

        <section v-if="plano.id" class="producao" data-testid="producao">
          <h2>{{ t('nutricao.cardapio.producao') }}</h2>
          <div class="linha">
            <SanteSelecao
              v-model="diaProducao"
              :rotulo="t('nutricao.cardapio.dia')"
              :opcoes="opcoesDia"
              data-testid="producao-dia"
            />
            <SanteCampoTexto
              v-model="margem"
              :rotulo="t('nutricao.cardapio.margem')"
              :max-bytes="4"
              data-testid="producao-margem"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('nutricao.cardapio.calcular')"
              :desabilitado="ocupado"
              data-testid="producao-calcular"
              @acionar="calcularProducao()"
            />
          </div>
          <template v-if="producao">
            <p data-testid="producao-comensais">
              {{ t('nutricao.cardapio.comensais', { n: producao.comensaisMapa }) }}
            </p>
            <table class="tabela" data-testid="producao-preparacoes">
              <tbody>
                <tr v-for="x in producao.preparacoes" :key="`${x.preparacao}|${x.alternativa}`">
                  <td>{{ x.nome }}</td>
                  <td>{{ x.alternativa ? nomeAlt(x.alternativa) : t('nutricao.cardapio.opcaoPadrao') }}</td>
                  <td>
                    {{ x.porcoes }} {{ t('nutricao.cardapio.porcoes').toLowerCase() }} ·
                    {{ t(`nutricao.cardapio.base.${x.base}`) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <h3>{{ t('nutricao.cardapio.generos') }}</h3>
            <table class="tabela" data-testid="producao-generos">
              <thead>
                <tr>
                  <th scope="col">{{ t('nutricao.cardapio.genero') }}</th>
                  <th scope="col">{{ t('nutricao.cardapio.quantidade') }}</th>
                  <th scope="col">{{ t('nutricao.cardapio.custo') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in producao.generos" :key="g.insumo">
                  <td>{{ g.nome }}</td>
                  <td>{{ g.quantidade.toLocaleString('pt-BR') }} {{ g.sigla }}</td>
                  <td>{{ reais(g.custo) }}</td>
                </tr>
              </tbody>
            </table>
            <p data-testid="producao-custo">
              <strong>{{ t('nutricao.cardapio.custoTotal', { valor: reais(producao.custoTotal) }) }}</strong>
            </p>
          </template>
        </section>
      </form>
    </section>

    <!-- Escolha do paciente -->
    <section v-else role="tabpanel" data-testid="painel-escolha">
      <form class="linha" @submit.prevent="verDia()">
        <SanteData
          v-model="escolha.data"
          :rotulo="t('nutricao.cardapio.dia')"
          editavel
          data-testid="escolha-data"
        />
        <SanteSelecao
          v-model="escolha.refeicao"
          :rotulo="t('nutricao.cardapio.refeicao')"
          :opcoes="opcoesRefeicao"
          obrigatorio
          data-testid="escolha-refeicao"
        />
        <SanteCampoTexto
          v-model="escolha.internacao"
          :rotulo="t('nutricao.cardapio.internacao')"
          :max-bytes="12"
          data-testid="escolha-internacao"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('nutricao.cardapio.verCardapio')"
          :desabilitado="!escolha.data || escolha.refeicao === null"
          data-testid="escolha-ver"
        />
      </form>
      <template v-if="dia.data.value">
        <p v-if="dia.data.value.opcoes.length === 0" role="status">
          {{ t('nutricao.cardapio.semCardapio') }}
        </p>
        <ul v-else class="opcoes" data-testid="opcoes-do-dia">
          <li v-for="o in dia.data.value.opcoes" :key="o.alternativa" :data-testid="`opcao-${o.alternativa}`">
            <strong>{{ o.descricao }}</strong>
            <span class="secundario">{{ o.preparacoes.join(' · ') }}</span>
            <SanteBotao
              v-if="podeEscolher && consultaDia?.internacao"
              variante="secundario"
              :rotulo="t('nutricao.cardapio.escolher')"
              :desabilitado="ocupado"
              :data-testid="`escolher-${o.alternativa}`"
              @acionar="escolher(o.alternativa)"
            />
          </li>
        </ul>
        <template v-if="consultaDia?.internacao">
          <h2>{{ t('nutricao.cardapio.escolhas') }}</h2>
          <p v-if="dia.data.value.escolhas.length === 0">{{ t('nutricao.cardapio.nenhuma') }}</p>
          <table v-else class="tabela" data-testid="tabela-escolhas">
            <tbody>
              <tr
                v-for="x in dia.data.value.escolhas"
                :key="x.id"
                :data-testid="`escolha-${x.id}`"
                :class="{ cancelada: x.situacao === 'cancelada' }"
              >
                <td>{{ x.descricao }}</td>
                <td>{{ x.quantidade }}</td>
                <td>{{ x.situacao }}</td>
                <td>
                  <SanteBotao
                    v-if="podeEscolher && (x.situacao === 'escolhida' || x.situacao === 'confirmada')"
                    variante="texto"
                    :rotulo="t('nutricao.cardapio.cancelarEscolha')"
                    :data-testid="`cancelar-escolha-${x.id}`"
                    @acionar="desfazer(x.id, x.versao)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </section>
  </main>
</template>

<style scoped>
.cardapio {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.abas {
  display: flex;
  gap: var(--sgh-espaco-2);
  border-block-end: 1px solid var(--sgh-borda);
}
.abas button {
  background: none;
  border: 0;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  cursor: pointer;
  color: inherit;
}
.abas button.ativa {
  border-block-end: 3px solid var(--sgh-primaria);
  font-weight: 600;
}
.linha,
.acoes-plano {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-3);
  border: 0;
  padding: 0;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-3);
  margin-top: var(--sgh-espaco-4);
}
.falta {
  color: var(--sgh-alerta);
}
.opcoes {
  display: grid;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
.opcoes li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
tr.cancelada td {
  text-decoration: line-through;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
