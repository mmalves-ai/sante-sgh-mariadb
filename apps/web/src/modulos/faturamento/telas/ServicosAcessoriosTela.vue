<script setup lang="ts">
// Serviços acessórios da conta (F8, 06-FAT linha 23): `/faturamento/servicos-acessorios` (`?conta=` abre a conta do
// paciente). Tudo o que se cobra além do atendimento em si, numa tela só:
// - Ambulância: regra por quilômetro ou por trajeto, por convênio ou para todos, com o item cobrado;
// - Ligação: regra por tipo de ligação (minuto iniciado, segundo ou valor do tarifador);
// - Tarifador: o layout do arquivo da central telefônica (posição de cada coluna e os formatos), conferido enquanto
//   se digita, e a importação com prévia antes de gravar (quantas linhas, por abrangência, e as linhas ruins com o
//   motivo); reimportar o mesmo arquivo não duplica;
// - Conta do paciente: as ligações da conta com a situação, a remoção lançada com o trajeto ou os quilômetros e as
//   ligações pendentes lançadas num clique; importar o arquivo daqui filtra pelo ramal do quarto.
import {
  FORMATOS_DATA_TARIFADOR,
  FORMATOS_DURACAO_TARIFADOR,
  type LayoutTarifador,
  lerArquivoTarifador,
  MAX_CONTEUDO_TARIFADOR,
  SEPARADORES_TARIFADOR,
  validarLayoutTarifador,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { novaChave } from '../api-faturamento.js';
import {
  lancarLigacoes,
  lancarRemocao,
  lerComercialConta,
  lerRegrasComerciais,
  salvarRegraAmbulancia,
  salvarRegraLigacao,
} from '../api-regras-comerciais.js';
import {
  importarLigacoes,
  type LayoutLido,
  lerServicosAcessorios,
  type ResultadoImportacao,
  salvarLayoutTarifador,
} from '../api-servicos-acessorios.js';
import BuscaItemCobravel from '../componentes/BuscaItemCobravel.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Serviços acessórios da conta',
      abaAmbulancia: 'Ambulância',
      abaLigacao: 'Ligação',
      abaTarifador: 'Tarifador',
      abaConta: 'Conta do paciente',
      categoria: 'Categoria da ambulância',
      fonte: 'Convênio',
      todas: 'Todos os convênios',
      forma: 'Cobrança',
      quilometro: 'Por quilômetro',
      trajeto: 'Por trajeto',
      rota: 'Trajeto',
      item: 'Item cobrado',
      buscarItem: 'Buscar item (código ou descrição)',
      ativo: 'Ativa',
      sim: 'sim',
      nao: 'não',
      salvar: 'Salvar',
      nova: 'Nova',
      editar: 'Editar',
      semRegras: 'Nenhuma regra cadastrada.',
      tipo: 'Tipo de ligação',
      cobranca: 'Como cobra',
      minuto: 'Por minuto iniciado',
      segundo: 'Por segundo',
      tarifador: 'Valor do tarifador',
      codigoTarifador: 'Código no tarifador',
      layouts: 'Layouts do arquivo',
      semLayouts: 'Nenhum layout cadastrado.',
      descricao: 'Descrição',
      separador: 'Separador',
      sep_ponto_virgula: 'Ponto e vírgula (;)',
      sep_virgula: 'Vírgula (,)',
      sep_tabulacao: 'Tabulação',
      sep_barra: 'Barra vertical (|)',
      cabecalho: 'A primeira linha é o cabeçalho',
      formatoData: 'Formato da data',
      fd_dia_mes_ano: 'Dia/mês/ano',
      fd_ano_mes_dia: 'Ano-mês-dia',
      formatoDuracao: 'Formato da duração',
      fu_segundos: 'Segundos',
      fu_minutos: 'Minutos',
      fu_horas_minutos_segundos: 'h:mm:ss',
      decimal: 'Separador decimal do valor',
      dddLocal: 'DDD do hospital',
      colunas: 'Posição das colunas (1 = primeira)',
      colunaRamal: 'Ramal',
      colunaDataHora: 'Data (e hora)',
      colunaHora: 'Hora, se separada',
      colunaDuracao: 'Duração',
      colunaNumero: 'Número discado',
      colunaValor: 'Valor',
      colunaAtendimento: 'Número do atendimento',
      importar: 'Importar o arquivo',
      layout: 'Layout',
      arquivo: 'Arquivo do tarifador',
      conta: 'Conta do paciente (número interno)',
      ramal: 'Só o ramal do quarto',
      grande: 'O arquivo passa do tamanho aceito por importação: divida-o por período.',
      semConta: 'Este layout não traz o atendimento: informe a conta do paciente.',
      previa: 'Prévia: {lidas} linha(s), {boas} legível(is), {ruins} com problema.',
      gravarImportacao: 'Registrar as ligações',
      resultado:
        '{registradas} registrada(s), {repetidas} já existia(m), {outro} de outro ramal, {recusadas} recusada(s).',
      linha: 'Linha',
      motivo: 'Motivo',
      abrangencia: 'Abrangência',
      quantidade: 'Quantidade',
      ab_local: 'Local',
      ab_interurbano: 'Interurbana',
      ab_internacional: 'Internacional',
      ab_celular_local: 'Celular local',
      ab_celular_interurbano: 'Celular interurbano',
      ab_gratuita: 'Gratuita',
      m_colunas_faltando: 'faltam colunas',
      m_data_invalida: 'data inválida',
      m_duracao_invalida: 'duração inválida',
      m_numero_invalido: 'número inválido',
      m_valor_invalido: 'valor inválido',
      m_limite_de_linhas: 'passou do limite de linhas',
      m_sem_atendimento: 'atendimento não encontrado',
      m_sem_tipo: 'sem tipo de ligação cadastrado',
      abrirConta: 'Abrir',
      numeroConta: 'Conta {n} · {s}',
      ligacoes: 'Ligações da conta',
      semLigacoes: 'Nenhuma ligação registrada no atendimento.',
      inicio: 'Início',
      duracao: 'Duração (s)',
      valor: 'Valor',
      situacao: 'Situação',
      lancarLigacoes: 'Lançar as ligações pendentes ({n})',
      importarConta: 'Importar do tarifador para esta conta',
      remocao: 'Remoção em ambulância',
      km: 'Quilômetros',
      comVolta: 'Com volta',
      data: 'Data',
      lancarRemocao: 'Lançar a remoção',
      faltaRemocao: 'Escolha o trajeto ou informe os quilômetros.',
      gravado: 'Gravado.',
      lancadas: '{n} ligação(ões) lançada(s) na conta.',
    },
  },
});

const rota = useRoute();
const qc = useQueryClient();
const regras = useQuery({ queryKey: ['faturamento', 'regras-comerciais'], queryFn: lerRegrasComerciais });
const servicos = useQuery({
  queryKey: ['faturamento', 'servicos-acessorios'],
  queryFn: lerServicosAcessorios,
});
const op = computed(() => regras.data.value?.opcoes);
const itensConhecidos = computed(() => servicos.data.value?.itens ?? []);
const nomeDe = (lista: readonly { id: number; descricao: string }[] | undefined, id: number | null) =>
  id === null ? '' : (lista?.find((o) => o.id === id)?.descricao ?? `#${id}`);
const nomeItem = (id: number | null) => {
  if (id === null) return '';
  const i = itensConhecidos.value.find((x) => x.id === id);
  return i ? `${i.codigo} - ${i.descricao}` : `#${id}`;
};
const reais = (v: number | null) =>
  v === null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const contaDoEndereco = Number(rota.query['conta']);
type Aba = 'ambulancia' | 'ligacao' | 'tarifador' | 'conta';
const aba = ref<Aba>(Number.isInteger(contaDoEndereco) && contaDoEndereco > 0 ? 'conta' : 'ambulancia');
const ABAS: Aba[] = ['ambulancia', 'ligacao', 'tarifador', 'conta'];
const rotuloAba = (a: Aba) =>
  t({ ambulancia: 'abaAmbulancia', ligacao: 'abaLigacao', tarifador: 'abaTarifador', conta: 'abaConta' }[a]);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('servicos-acessorios');
async function acao<T>(f: () => Promise<T>, texto?: (r: T) => string): Promise<T | null> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await f();
    mensagem.value = texto ? texto(r) : t('gravado');
    chave = novaChave('servicos-acessorios');
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
    return r;
  } catch (e) {
    erro.value = e;
    return null;
  } finally {
    gravando.value = false;
  }
}

// ── Ambulância ──
const amb = reactive({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  categoriaAmbulanciaId: 0,
  fontePagadoraId: 0,
  forma: 'quilometro' as 'quilometro' | 'trajeto',
  rotaId: 0,
  itemId: 0,
  ativo: true,
});
const errosAmb = computed(() => {
  const e: string[] = [];
  if (!amb.categoriaAmbulanciaId) e.push(t('categoria'));
  if (amb.forma === 'trajeto' && !amb.rotaId) e.push(t('rota'));
  if (!amb.itemId) e.push(t('item'));
  return e;
});
function editarAmb(r: NonNullable<typeof regras.data.value>['ambulancia'][number]) {
  Object.assign(amb, {
    id: r.id,
    versao: Number(r['versao']),
    categoriaAmbulanciaId: r.categoriaAmbulanciaId,
    fontePagadoraId: r.fontePagadoraId ?? 0,
    forma: r.forma === 'trajeto' ? 'trajeto' : 'quilometro',
    rotaId: r.rotaId ?? 0,
    itemId: r.itemId,
    ativo: r.ativo,
  });
}
function novaAmb() {
  Object.assign(amb, {
    id: undefined,
    versao: undefined,
    categoriaAmbulanciaId: 0,
    fontePagadoraId: 0,
    forma: 'quilometro',
    rotaId: 0,
    itemId: 0,
    ativo: true,
  });
}
async function salvarAmb() {
  const ok = await acao(() =>
    salvarRegraAmbulancia(
      {
        ...amb,
        fontePagadoraId: amb.fontePagadoraId || null,
        rotaId: amb.forma === 'trajeto' ? amb.rotaId : null,
      },
      chave,
    ),
  );
  if (ok) novaAmb();
}

// ── Ligação ──
const lig = reactive({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  tipoLigacaoId: 0,
  cobranca: 'minuto' as 'minuto' | 'segundo' | 'tarifador',
  itemId: 0,
  codigoTarifador: '',
  ativo: true,
});
const errosLig = computed(() => {
  const e: string[] = [];
  if (!lig.tipoLigacaoId) e.push(t('tipo'));
  if (!lig.itemId) e.push(t('item'));
  return e;
});
const comoCobra = (r: {
  itemMinutoId: number | null;
  itemSegundoId: number | null;
  assumeValorTarifador: boolean;
}) =>
  r.assumeValorTarifador
    ? t('tarifador')
    : r.itemSegundoId !== null && r.itemMinutoId === null
      ? t('segundo')
      : t('minuto');
function editarLig(r: NonNullable<typeof regras.data.value>['ligacao'][number]) {
  Object.assign(lig, {
    id: r.id,
    versao: Number(r['versao']),
    tipoLigacaoId: r.tipoLigacaoId,
    cobranca: r.assumeValorTarifador
      ? 'tarifador'
      : r.itemSegundoId !== null && r.itemMinutoId === null
        ? 'segundo'
        : 'minuto',
    itemId: r.itemMinutoId ?? r.itemSegundoId ?? 0,
    codigoTarifador: String(r['codigoTarifador'] ?? ''),
    ativo: r.ativo,
  });
}
function novaLig() {
  Object.assign(lig, {
    id: undefined,
    versao: undefined,
    tipoLigacaoId: 0,
    cobranca: 'minuto',
    itemId: 0,
    codigoTarifador: '',
    ativo: true,
  });
}
async function salvarLig() {
  const ok = await acao(() =>
    salvarRegraLigacao(
      {
        id: lig.id,
        versao: lig.versao,
        tipoLigacaoId: lig.tipoLigacaoId,
        codigoTarifador: lig.codigoTarifador.trim() || null,
        itemMinutoId: lig.cobranca === 'segundo' ? null : lig.itemId,
        itemSegundoId: lig.cobranca === 'segundo' ? lig.itemId : null,
        assumeValorTarifador: lig.cobranca === 'tarifador',
        ativo: lig.ativo,
      },
      chave,
    ),
  );
  if (ok) novaLig();
}

// ── Tarifador: layout ──
type FormLayout = Omit<LayoutTarifador, 'dddLocal'> & {
  id: number | undefined;
  versao: number | undefined;
  descricao: string;
  dddLocal: string;
  ativo: boolean;
};
const LAYOUT_VAZIO: FormLayout = {
  id: undefined,
  versao: undefined,
  descricao: '',
  separador: 'ponto_virgula',
  cabecalho: true,
  formatoData: 'dia_mes_ano',
  formatoDuracao: 'horas_minutos_segundos',
  decimal: ',',
  dddLocal: '',
  colunaRamal: null,
  colunaDataHora: 1,
  colunaHora: null,
  colunaDuracao: 2,
  colunaNumero: 3,
  colunaValor: null,
  colunaAtendimento: null,
  ativo: true,
};
const lay = reactive<FormLayout>({ ...LAYOUT_VAZIO });
const COLUNAS = [
  'colunaRamal',
  'colunaDataHora',
  'colunaHora',
  'colunaDuracao',
  'colunaNumero',
  'colunaValor',
  'colunaAtendimento',
] as const;
const OBRIGATORIAS = new Set(['colunaDataHora', 'colunaDuracao', 'colunaNumero']);
const layoutDoForm = (): LayoutTarifador => ({ ...lay, dddLocal: lay.dddLocal.trim() || null });
const errosLayout = computed(() => {
  const e = validarLayoutTarifador(layoutDoForm());
  if (lay.descricao.trim().length < 2) e['descricao'] = t('descricao');
  return e;
});
function coluna(c: (typeof COLUNAS)[number], v: string) {
  const n = v.trim() === '' ? null : Number(v);
  (lay as Record<string, unknown>)[c] = n === null || Number.isNaN(n) ? null : n;
}
function editarLayout(l: LayoutLido) {
  Object.assign(lay, { ...l, dddLocal: l.dddLocal ?? '' });
}
async function salvarLayout() {
  const r = await acao(() =>
    salvarLayoutTarifador(
      { ...layoutDoForm(), id: lay.id, versao: lay.versao, descricao: lay.descricao, ativo: lay.ativo },
      chave,
    ),
  );
  if (r) Object.assign(lay, { ...LAYOUT_VAZIO });
}

// ── Tarifador: importação ──
const imp = reactive({
  layoutId: 0,
  contaId: Number.isInteger(contaDoEndereco) ? contaDoEndereco || 0 : 0,
  ramal: '',
});
const conteudo = ref('');
const nomeArquivo = ref('');
const resultado = ref<ResultadoImportacao | null>(null);
const layoutEscolhido = computed(
  () => servicos.data.value?.layouts.find((l) => l.id === imp.layoutId && l.ativo) ?? null,
);
const previa = computed(() =>
  layoutEscolhido.value && conteudo.value ? lerArquivoTarifador(conteudo.value, layoutEscolhido.value) : null,
);
const porAbrangencia = (ls: readonly { abrangencia: string }[]) => {
  const m: Record<string, number> = {};
  for (const l of ls) m[l.abrangencia] = (m[l.abrangencia] ?? 0) + 1;
  return m;
};
const errosImportacao = computed(() => {
  const e: string[] = [];
  if (conteudo.value.length > MAX_CONTEUDO_TARIFADOR) e.push(t('grande'));
  if (layoutEscolhido.value && layoutEscolhido.value.colunaAtendimento === null && !imp.contaId)
    e.push(t('semConta'));
  return e;
});
async function lerArquivo(ev: Event) {
  resultado.value = null;
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  nomeArquivo.value = f.name;
  conteudo.value = await f.text();
}
async function gravarImportacao() {
  const r = await acao(
    () =>
      importarLigacoes(
        {
          layoutId: imp.layoutId,
          conteudo: conteudo.value,
          contaId: imp.contaId || null,
          ramal: imp.ramal.trim() || null,
        },
        chave,
      ),
    (x) =>
      t('resultado', {
        registradas: x.registradas,
        repetidas: x.repetidas,
        outro: x.outroRamal,
        recusadas: x.recusadas,
      }),
  );
  if (r) resultado.value = r;
}

// ── Conta do paciente ──
const contaDigitada = ref(imp.contaId ? String(imp.contaId) : '');
const contaId = ref<number>(imp.contaId);
const comercial = useQuery({
  queryKey: ['faturamento', 'comercial', contaId],
  queryFn: () => lerComercialConta(contaId.value),
  enabled: computed(() => contaId.value > 0),
});
function abrirConta() {
  const n = Number(contaDigitada.value);
  contaId.value = Number.isInteger(n) && n > 0 ? n : 0;
}
watch(contaId, (c) => (imp.contaId = c));
const pendentes = computed(
  () => comercial.data.value?.ligacoes.filter((l) => l.situacao === 'pendente').length ?? 0,
);
const rem = reactive({
  categoriaAmbulanciaId: 0,
  rotaId: 0,
  km: null as number | null,
  comVolta: false,
  data: '',
});
const errosRemocao = computed(() => {
  const e: string[] = [];
  if (!rem.categoriaAmbulanciaId) e.push(t('categoria'));
  if (!rem.rotaId && !(rem.km !== null && rem.km > 0)) e.push(t('faltaRemocao'));
  return e;
});
async function lancarRem() {
  const r = await acao(() =>
    lancarRemocao(
      contaId.value,
      {
        categoriaAmbulanciaId: rem.categoriaAmbulanciaId,
        rotaId: rem.rotaId || null,
        km: rem.rotaId ? null : rem.km,
        comVolta: rem.comVolta,
        ...(rem.data ? { data: rem.data } : {}),
      },
      chave,
    ),
  );
  if (r) Object.assign(rem, { rotaId: 0, km: null, comVolta: false });
}
async function lancarLig() {
  await acao(
    () => lancarLigacoes(contaId.value, chave),
    (r) => t('lancadas', { n: Number(r['lancadas'] ?? 0) }),
  );
}
function importarDaConta() {
  imp.contaId = contaId.value;
  aba.value = 'tarifador';
}
const opcoesFonte = computed(() => [
  { valor: 0, rotulo: t('todas') },
  ...(op.value?.fontes ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
]);
const opcoesDe = (lista: readonly { id: number; descricao: string }[] | undefined) => [
  { valor: 0, rotulo: '' },
  ...(lista ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
];
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sa-titulo" data-testid="tela-servicos-acessorios">
    <h1 id="sa-titulo">{{ t('titulo') }}</h1>
    <div role="tablist" class="abas">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`sa-aba-${a}`"
        @click="aba = a"
      >
        {{ rotuloAba(a) }}
      </button>
    </div>
    <MensagemFaturamento :texto="mensagem" testid="sa-mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="regras.error.value" :erro="regras.error.value" />

    <!-- Ambulância -->
    <div v-if="aba === 'ambulancia' && regras.data.value" role="tabpanel" data-testid="sa-ambulancia">
      <table v-if="regras.data.value.ambulancia.length" class="tabela" data-testid="sa-amb-regras">
        <thead>
          <tr>
            <th scope="col">{{ t('categoria') }}</th>
            <th scope="col">{{ t('fonte') }}</th>
            <th scope="col">{{ t('forma') }}</th>
            <th scope="col">{{ t('item') }}</th>
            <th scope="col">{{ t('ativo') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('editar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras.data.value.ambulancia" :key="r.id">
            <td>{{ nomeDe(op?.categoriasAmbulancia, r.categoriaAmbulanciaId) }}</td>
            <td>{{ r.fontePagadoraId === null ? t('todas') : nomeDe(op?.fontes, r.fontePagadoraId) }}</td>
            <td>
              {{
                r.forma === 'trajeto' ? `${t('trajeto')}: ${nomeDe(op?.rotas, r.rotaId)}` : t('quilometro')
              }}
            </td>
            <td>{{ nomeItem(r.itemId) }}</td>
            <td>{{ r.ativo ? t('sim') : t('nao') }}</td>
            <td>
              <button type="button" @click="editarAmb(r)">{{ t('editar') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semRegras') }}</p>
      <form class="formulario" data-testid="sa-amb-form" @submit.prevent="salvarAmb">
        <SanteSelecao
          v-model="amb.categoriaAmbulanciaId"
          :rotulo="t('categoria')"
          :opcoes="opcoesDe(op?.categoriasAmbulancia)"
          data-testid="sa-amb-categoria"
        />
        <SanteSelecao
          v-model="amb.fontePagadoraId"
          :rotulo="t('fonte')"
          :opcoes="opcoesFonte"
          data-testid="sa-amb-fonte"
        />
        <SanteSelecao
          v-model="amb.forma"
          :rotulo="t('forma')"
          :opcoes="[
            { valor: 'quilometro' as const, rotulo: t('quilometro') },
            { valor: 'trajeto' as const, rotulo: t('trajeto') },
          ]"
          data-testid="sa-amb-forma"
        />
        <SanteSelecao
          v-if="amb.forma === 'trajeto'"
          v-model="amb.rotaId"
          :rotulo="t('rota')"
          :opcoes="opcoesDe(op?.rotas)"
          data-testid="sa-amb-rota"
        />
        <BuscaItemCobravel
          v-model="amb.itemId"
          :rotulo="t('item')"
          :rotulo-busca="t('buscarItem')"
          :conhecidos="itensConhecidos"
          testid="sa-amb-item"
        />
        <label><input v-model="amb.ativo" type="checkbox" /> {{ t('ativo') }}</label>
        <p v-if="errosAmb.length" role="status" data-testid="sa-amb-erros">{{ errosAmb.join(' · ') }}</p>
        <button type="submit" :disabled="gravando || errosAmb.length > 0" data-testid="sa-amb-salvar">
          {{ t('salvar') }}
        </button>
        <button v-if="amb.id" type="button" @click="novaAmb">{{ t('nova') }}</button>
      </form>
    </div>

    <!-- Ligação -->
    <div v-if="aba === 'ligacao' && regras.data.value" role="tabpanel" data-testid="sa-ligacao">
      <table v-if="regras.data.value.ligacao.length" class="tabela" data-testid="sa-lig-regras">
        <thead>
          <tr>
            <th scope="col">{{ t('tipo') }}</th>
            <th scope="col">{{ t('cobranca') }}</th>
            <th scope="col">{{ t('item') }}</th>
            <th scope="col">{{ t('ativo') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('editar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras.data.value.ligacao" :key="r.id">
            <td>{{ nomeDe(op?.tiposLigacao, r.tipoLigacaoId) }}</td>
            <td>{{ comoCobra(r) }}</td>
            <td>{{ nomeItem(r.itemMinutoId ?? r.itemSegundoId) }}</td>
            <td>{{ r.ativo ? t('sim') : t('nao') }}</td>
            <td>
              <button type="button" @click="editarLig(r)">{{ t('editar') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semRegras') }}</p>
      <form class="formulario" data-testid="sa-lig-form" @submit.prevent="salvarLig">
        <SanteSelecao
          v-model="lig.tipoLigacaoId"
          :rotulo="t('tipo')"
          :opcoes="opcoesDe(op?.tiposLigacao)"
          data-testid="sa-lig-tipo"
        />
        <SanteSelecao
          v-model="lig.cobranca"
          :rotulo="t('cobranca')"
          :opcoes="[
            { valor: 'minuto' as const, rotulo: t('minuto') },
            { valor: 'segundo' as const, rotulo: t('segundo') },
            { valor: 'tarifador' as const, rotulo: t('tarifador') },
          ]"
          data-testid="sa-lig-cobranca"
        />
        <BuscaItemCobravel
          v-model="lig.itemId"
          :rotulo="t('item')"
          :rotulo-busca="t('buscarItem')"
          :conhecidos="itensConhecidos"
          testid="sa-lig-item"
        />
        <label>
          {{ t('codigoTarifador') }}
          <input v-model="lig.codigoTarifador" maxlength="60" data-testid="sa-lig-codigo" />
        </label>
        <label><input v-model="lig.ativo" type="checkbox" /> {{ t('ativo') }}</label>
        <p v-if="errosLig.length" role="status" data-testid="sa-lig-erros">{{ errosLig.join(' · ') }}</p>
        <button type="submit" :disabled="gravando || errosLig.length > 0" data-testid="sa-lig-salvar">
          {{ t('salvar') }}
        </button>
        <button v-if="lig.id" type="button" @click="novaLig">{{ t('nova') }}</button>
      </form>
    </div>

    <!-- Tarifador -->
    <div v-if="aba === 'tarifador'" role="tabpanel" data-testid="sa-tarifador">
      <h2>{{ t('layouts') }}</h2>
      <ul v-if="servicos.data.value?.layouts.length" data-testid="sa-layouts">
        <li v-for="l in servicos.data.value.layouts" :key="l.id">
          {{ l.descricao }} ({{ t(`sep_${l.separador}`) }}){{ l.ativo ? '' : ` · ${t('nao')} ${t('ativo')}` }}
          <button type="button" @click="editarLayout(l)">{{ t('editar') }}</button>
        </li>
      </ul>
      <p v-else>{{ t('semLayouts') }}</p>
      <form class="formulario" data-testid="sa-layout-form" @submit.prevent="salvarLayout">
        <label>
          {{ t('descricao') }}
          <input v-model="lay.descricao" maxlength="100" data-testid="sa-layout-descricao" />
        </label>
        <SanteSelecao
          v-model="lay.separador"
          :rotulo="t('separador')"
          :opcoes="SEPARADORES_TARIFADOR.map((s) => ({ valor: s, rotulo: t(`sep_${s}`) }))"
          data-testid="sa-layout-separador"
        />
        <label><input v-model="lay.cabecalho" type="checkbox" /> {{ t('cabecalho') }}</label>
        <SanteSelecao
          v-model="lay.formatoData"
          :rotulo="t('formatoData')"
          :opcoes="FORMATOS_DATA_TARIFADOR.map((s) => ({ valor: s, rotulo: t(`fd_${s}`) }))"
          data-testid="sa-layout-data"
        />
        <SanteSelecao
          v-model="lay.formatoDuracao"
          :rotulo="t('formatoDuracao')"
          :opcoes="FORMATOS_DURACAO_TARIFADOR.map((s) => ({ valor: s, rotulo: t(`fu_${s}`) }))"
          data-testid="sa-layout-duracao"
        />
        <SanteSelecao
          v-model="lay.decimal"
          :rotulo="t('decimal')"
          :opcoes="[
            { valor: ',' as const, rotulo: '1.234,56' },
            { valor: '.' as const, rotulo: '1,234.56' },
          ]"
          data-testid="sa-layout-decimal"
        />
        <label>
          {{ t('dddLocal') }}
          <input v-model="lay.dddLocal" inputmode="numeric" maxlength="2" data-testid="sa-layout-ddd" />
        </label>
        <fieldset>
          <legend>{{ t('colunas') }}</legend>
          <label v-for="c in COLUNAS" :key="c">
            {{ t(c) }}{{ OBRIGATORIAS.has(c) ? ' *' : '' }}
            <input
              type="number"
              min="1"
              max="60"
              :value="lay[c] ?? ''"
              :aria-invalid="errosLayout[c] ? 'true' : 'false'"
              :data-testid="`sa-layout-${c}`"
              @input="coluna(c, ($event.target as HTMLInputElement).value)"
            />
            <small v-if="errosLayout[c]" class="erro">{{ errosLayout[c] }}</small>
          </label>
        </fieldset>
        <label v-if="lay.id"><input v-model="lay.ativo" type="checkbox" /> {{ t('ativo') }}</label>
        <button
          type="submit"
          :disabled="gravando || Object.keys(errosLayout).length > 0"
          data-testid="sa-layout-salvar"
        >
          {{ t('salvar') }}
        </button>
        <button v-if="lay.id" type="button" @click="Object.assign(lay, { ...LAYOUT_VAZIO })">
          {{ t('nova') }}
        </button>
      </form>

      <h2>{{ t('importar') }}</h2>
      <form class="formulario" data-testid="sa-importar-form" @submit.prevent="gravarImportacao">
        <SanteSelecao
          v-model="imp.layoutId"
          :rotulo="t('layout')"
          :opcoes="opcoesDe((servicos.data.value?.layouts ?? []).filter((l) => l.ativo))"
          data-testid="sa-imp-layout"
        />
        <label>
          {{ t('conta') }}
          <input v-model.number="imp.contaId" type="number" min="0" data-testid="sa-imp-conta" />
        </label>
        <label>
          {{ t('ramal') }}
          <input v-model="imp.ramal" maxlength="10" data-testid="sa-imp-ramal" />
        </label>
        <label>
          {{ t('arquivo') }}
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            data-testid="sa-imp-arquivo"
            @change="lerArquivo"
          />
        </label>
        <div v-if="previa" data-testid="sa-previa">
          <p>
            {{
              t('previa', {
                lidas: previa.lidas,
                boas: previa.ligacoes.length,
                ruins: previa.recusadas.length,
              })
            }}
          </p>
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('abrangencia') }}</th>
                <th scope="col">{{ t('quantidade') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(q, a) in porAbrangencia(previa.ligacoes)" :key="a">
                <td>{{ t(`ab_${a}`) }}</td>
                <td>{{ q }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="errosImportacao.length" role="status" data-testid="sa-imp-erros">
          {{ errosImportacao.join(' ') }}
        </p>
        <button
          type="submit"
          :disabled="gravando || !previa || previa.ligacoes.length === 0 || errosImportacao.length > 0"
          data-testid="sa-imp-gravar"
        >
          {{ t('gravarImportacao') }}
        </button>
      </form>
      <table
        v-if="resultado && resultado.linhasRecusadas.length"
        class="tabela"
        data-testid="sa-imp-recusadas"
      >
        <thead>
          <tr>
            <th scope="col">{{ t('linha') }}</th>
            <th scope="col">{{ t('motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in resultado.linhasRecusadas" :key="r.linha">
            <td>{{ r.linha }}</td>
            <td>{{ t(`m_${r.motivo}`) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Conta do paciente -->
    <div v-if="aba === 'conta'" role="tabpanel" data-testid="sa-conta">
      <form class="formulario" @submit.prevent="abrirConta">
        <label>
          {{ t('conta') }}
          <input v-model="contaDigitada" inputmode="numeric" data-testid="sa-conta-numero" />
        </label>
        <button type="submit" data-testid="sa-conta-abrir">{{ t('abrirConta') }}</button>
      </form>
      <ErroFaturamento v-if="comercial.error.value" :erro="comercial.error.value" />
      <template v-if="contaId > 0 && comercial.data.value">
        <p data-testid="sa-conta-cabecalho">
          {{
            t('numeroConta', { n: comercial.data.value.conta.numero, s: comercial.data.value.conta.situacao })
          }}
        </p>
        <h2>{{ t('ligacoes') }}</h2>
        <table v-if="comercial.data.value.ligacoes.length" class="tabela" data-testid="sa-conta-ligacoes">
          <thead>
            <tr>
              <th scope="col">{{ t('inicio') }}</th>
              <th scope="col">{{ t('tipo') }}</th>
              <th scope="col">{{ t('duracao') }}</th>
              <th scope="col">{{ t('valor') }}</th>
              <th scope="col">{{ t('situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in comercial.data.value.ligacoes" :key="l.id">
              <td>{{ l.iniciadaEm }}</td>
              <td>{{ l.tipo }}</td>
              <td>{{ l.duracaoSegundos }}</td>
              <td>{{ reais(l.valor) }}</td>
              <td>{{ l.situacao }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('semLigacoes') }}</p>
        <button
          v-if="pendentes > 0"
          type="button"
          :disabled="gravando"
          data-testid="sa-conta-lancar-ligacoes"
          @click="lancarLig"
        >
          {{ t('lancarLigacoes', { n: pendentes }) }}
        </button>
        <button type="button" data-testid="sa-conta-importar" @click="importarDaConta">
          {{ t('importarConta') }}
        </button>

        <h2>{{ t('remocao') }}</h2>
        <form class="formulario" data-testid="sa-remocao-form" @submit.prevent="lancarRem">
          <SanteSelecao
            v-model="rem.categoriaAmbulanciaId"
            :rotulo="t('categoria')"
            :opcoes="opcoesDe(op?.categoriasAmbulancia)"
            data-testid="sa-rem-categoria"
          />
          <SanteSelecao
            v-model="rem.rotaId"
            :rotulo="t('rota')"
            :opcoes="opcoesDe(op?.rotas)"
            data-testid="sa-rem-rota"
          />
          <label v-if="!rem.rotaId">
            {{ t('km') }}
            <input v-model.number="rem.km" type="number" min="0" step="0.1" data-testid="sa-rem-km" />
          </label>
          <label
            ><input v-model="rem.comVolta" type="checkbox" data-testid="sa-rem-volta" />
            {{ t('comVolta') }}</label
          >
          <label>
            {{ t('data') }}
            <input v-model="rem.data" type="date" data-testid="sa-rem-data" />
          </label>
          <p v-if="errosRemocao.length" role="status" data-testid="sa-rem-erros">
            {{ errosRemocao.join(' · ') }}
          </p>
          <button type="submit" :disabled="gravando || errosRemocao.length > 0" data-testid="sa-rem-lancar">
            {{ t('lancarRemocao') }}
          </button>
        </form>
      </template>
    </div>
  </section>
</template>
