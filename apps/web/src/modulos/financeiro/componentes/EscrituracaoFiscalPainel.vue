<script setup lang="ts">
// F3.8, 07-FIN linha 108: os dados fiscais das entradas da competência e a EFD-Contribuições numa tela só. Cada entrada
// mostra os itens com o que falta classificar; a classificação padrão (CFOP, CST, alíquotas e natureza do crédito)
// preenche de uma vez os itens pendentes, com a base no valor do item; o crédito aparece na hora (base x alíquota,
// nunca digitado) e a regra do domínio trava o botão com o motivo. A conferência das somas fica sempre à vista e só
// ela libera o arquivo; a entrega é registrada com o recibo, e a correção depois dela pede a retificadora.
import {
  type ClassificacaoFiscalItem,
  conferirClassificacaoItem,
  creditoDoItem,
  CST_ENTRADA_COM_CREDITO,
  CST_ENTRADA_SEM_CREDITO,
  cstDaCredito,
  REGIMES_EFD,
  type RegimeEfd,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  classificarEntrada,
  type EntradaEscrituracao,
  gerarEfdContribuicoes,
  lerArquivoEfd,
  lerEscrituracao,
  registrarEntregaEfd,
} from '../api-escrituracao.js';
import { usarFinanceiro } from '../usar-financeiro.js';

const props = defineProps<{ competencia: string }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Dados fiscais das entradas e EFD-Contribuições',
      texto:
        'Classifique os itens (CFOP de entrada, CST do PIS e da COFINS, base, alíquota e natureza do crédito). O crédito é calculado: base x alíquota. O arquivo só é gerado com a conferência sem pendência.',
      padrao: 'Classificação padrão',
      cfop: 'CFOP',
      cst: 'CST do PIS e da COFINS',
      cstPis: 'CST do PIS',
      cstCofins: 'CST da COFINS',
      aliquotaPis: 'Alíquota do PIS (%)',
      aliquotaCofins: 'Alíquota da COFINS (%)',
      basePis: 'Base do PIS',
      baseCofins: 'Base da COFINS',
      natureza: 'Natureza do crédito',
      semNatureza: 'Sem crédito',
      comCredito: 'com crédito',
      semCredito: 'sem crédito',
      aplicar: 'Aplicar aos itens pendentes',
      salvar: 'Gravar classificação',
      nenhuma: 'Nenhuma entrada escriturada na competência.',
      documento: 'Documento {numero}',
      servico: 'serviço tomado',
      mercadoria: 'mercadoria',
      pendencias: '{n} pendência(s)',
      semPendencia: 'sem pendência',
      item: 'Item',
      valor: 'Valor',
      credito: 'Crédito PIS / COFINS',
      situacoes: {
        pendente: 'Pendente',
        escriturada: 'Escriturada',
        retificada: 'Corrigida depois da entrega',
        cancelada: 'Cancelada',
      },
      faltas: {
        'sem-cfop': 'CFOP de entrada',
        'sem-cst-pis': 'CST do PIS',
        'sem-cst-cofins': 'CST da COFINS',
        'sem-natureza-credito': 'natureza do crédito',
      },
      conferencia: 'Conferência das somas',
      documentos: 'Documentos',
      itens: 'Itens',
      divergencias: 'Divergências de soma',
      base: 'Base',
      creditoPis: 'Crédito do PIS',
      creditoCofins: 'Crédito da COFINS',
      liberado: 'Conferência fechada: o arquivo pode ser gerado.',
      bloqueado: 'O arquivo só é gerado sem pendência e sem divergência.',
      apuracao: 'Apuração do crédito por natureza, CST e alíquota',
      tributo: 'Tributo',
      cstCurto: 'CST',
      aliquota: 'Alíquota (%)',
      regime: 'Regime de apuração',
      regimes: { cumulativo: 'Cumulativo', nao_cumulativo: 'Não cumulativo', misto: 'Misto' },
      gerar: 'Gerar arquivo da competência',
      arquivos: 'Arquivos da competência',
      nenhumArquivo: 'Nenhum arquivo gerado.',
      envio: 'Envio',
      finalidades: { original: 'Original', retificadora: 'Retificadora' },
      situacaoArquivo: {
        gerado: 'Gerado',
        validado: 'Validado',
        com_erro: 'Com erro',
        transmitido: 'Entregue',
        cancelado: 'Cancelado (trocado)',
      },
      desatualizado: 'A escrituração mudou depois deste arquivo: gere de novo.',
      baixar: 'Baixar o arquivo',
      recibo: 'Recibo da entrega',
      entregar: 'Registrar entrega',
      semPermissao: 'Sua permissão é só de consulta.',
    },
  },
});

const { tem } = usarFinanceiro();
const podeClassificar = computed(() => tem('financeiro.escrituracao.classificar'));
const podeGerar = computed(() => tem('financeiro.efdContribuicoes.gerar'));
const fila = useQueryClient();
const painel = useQuery({
  queryKey: computed(() => ['financeiro', 'escrituracao', props.competencia]),
  queryFn: () => lerEscrituracao(props.competencia),
  enabled: computed(() => !!props.competencia),
});

type Linha = { -readonly [K in keyof ClassificacaoFiscalItem]: ClassificacaoFiscalItem[K] };
const rascunho = reactive<Record<number, Linha[]>>({});
watch(
  () => painel.data.value,
  (d) => {
    for (const k of Object.keys(rascunho)) delete rascunho[Number(k)];
    for (const e of d?.entradas ?? [])
      rascunho[e.id] = e.itens.map((i) => ({
        sequencia: i.sequencia,
        cfop: i.cfop,
        cstPis: i.cstPis,
        basePis: i.basePis,
        aliquotaPis: i.aliquotaPis,
        cstCofins: i.cstCofins,
        baseCofins: i.baseCofins,
        aliquotaCofins: i.aliquotaCofins,
        naturezaCredito: i.naturezaCredito,
      }));
  },
  { immediate: true },
);

const padrao = reactive<{
  cfop: string | null;
  cst: string | null;
  aliquotaPis: number;
  aliquotaCofins: number;
  natureza: string | null;
}>({ cfop: null, cst: '50', aliquotaPis: 1.65, aliquotaCofins: 7.6, natureza: null });
const regime = ref<RegimeEfd>('nao_cumulativo');
const recibos = reactive<Record<number, string>>({});
const gravando = ref(false);
const erro = ref<unknown>(null);
const ok = ref('');

const opcoesCfop = computed(() =>
  (painel.data.value?.cfops ?? []).map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} · ${c.descricao}` })),
);
const opcoesCst = [
  ...CST_ENTRADA_COM_CREDITO.map((c) => ({ valor: c as string, rotulo: `${c} · ${t('comCredito')}` })),
  ...CST_ENTRADA_SEM_CREDITO.map((c) => ({ valor: c as string, rotulo: `${c} · ${t('semCredito')}` })),
];
const opcoesNatureza = computed(() => [
  { valor: null as string | null, rotulo: t('semNatureza') },
  ...(painel.data.value?.naturezas ?? []).map((n) => ({ valor: n as string | null, rotulo: n })),
]);
const opcoesRegime = REGIMES_EFD.map((r) => ({ valor: r, rotulo: t(`regimes.${r}`) }));
const dinheiro = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O crédito do item no rascunho: sempre base x alíquota. */
const creditos = (l: Linha) => ({
  pis: cstDaCredito(l.cstPis) ? creditoDoItem(l.basePis, l.aliquotaPis) : 0,
  cofins: cstDaCredito(l.cstCofins) ? creditoDoItem(l.baseCofins, l.aliquotaCofins) : 0,
});
/** A primeira recusa do domínio nos itens da entrada (a mesma regra do servidor). */
function recusaDe(e: EntradaEscrituracao) {
  for (const l of rascunho[e.id] ?? []) {
    const item = e.itens.find((i) => i.sequencia === l.sequencia);
    if (!item) continue;
    const r = conferirClassificacaoItem(l, item.valorItem, item.valorDesconto);
    if (r) return r;
  }
  return null;
}
/** O CST sem crédito zera base, alíquota e natureza na hora. */
function ajustar(l: Linha) {
  if (!cstDaCredito(l.cstPis)) {
    l.basePis = 0;
    l.aliquotaPis = null;
  }
  if (!cstDaCredito(l.cstCofins)) {
    l.baseCofins = 0;
    l.aliquotaCofins = null;
  }
  if (!cstDaCredito(l.cstPis) && !cstDaCredito(l.cstCofins)) l.naturezaCredito = null;
}
function aplicarPadrao(e: EntradaEscrituracao) {
  for (const l of rascunho[e.id] ?? []) {
    const item = e.itens.find((i) => i.sequencia === l.sequencia);
    if (!item || item.pendencias.length === 0) continue;
    const da = cstDaCredito(padrao.cst);
    const base = Math.round((item.valorItem - item.valorDesconto) * 100) / 100;
    l.cfop = padrao.cfop ?? l.cfop;
    l.cstPis = padrao.cst;
    l.cstCofins = padrao.cst;
    l.basePis = da ? base : 0;
    l.baseCofins = da ? base : 0;
    l.aliquotaPis = da ? padrao.aliquotaPis : null;
    l.aliquotaCofins = da ? padrao.aliquotaCofins : null;
    l.naturezaCredito = da ? padrao.natureza : null;
  }
}
async function agir(fn: () => Promise<{ mensagem: string }>) {
  gravando.value = true;
  erro.value = null;
  ok.value = '';
  try {
    ok.value = (await fn()).mensagem;
    await fila.invalidateQueries({ queryKey: ['financeiro', 'escrituracao'] });
    await fila.invalidateQueries({ queryKey: ['financeiro', 'entradas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const salvar = (e: EntradaEscrituracao) =>
  agir(() =>
    classificarEntrada(
      e.id,
      { versao: e.versao, itens: rascunho[e.id] ?? [] },
      novaChave('escrituracao-classificar'),
    ),
  );
const gerar = () =>
  agir(() =>
    gerarEfdContribuicoes({ periodo: props.competencia, regime: regime.value }, novaChave('efd-gerar')),
  );
const entregar = (id: number) =>
  agir(() => registrarEntregaEfd(id, (recibos[id] ?? '').trim(), novaChave('efd-entrega')));
async function baixar(id: number) {
  erro.value = null;
  try {
    const a = await lerArquivoEfd(id);
    const url = URL.createObjectURL(new Blob([a.conteudo], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nome;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    erro.value = e;
  }
}
const apuracao = computed(() => {
  const c = painel.data.value?.conferencia;
  return c
    ? [...c.pis.map((x) => ({ ...x, tributo: 'PIS' })), ...c.cofins.map((x) => ({ ...x, tributo: 'COFINS' }))]
    : [];
});
</script>

<template>
  <section aria-labelledby="ef-titulo" data-testid="ef-painel">
    <h2 id="ef-titulo">{{ t('titulo') }}</h2>
    <p class="secundario">{{ t('texto') }}</p>
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="ok" role="status" data-testid="ef-mensagem">{{ ok }}</p>
    <p v-if="!podeClassificar && !podeGerar" class="secundario">{{ t('semPermissao') }}</p>

    <template v-if="painel.data.value">
      <form v-if="podeClassificar" class="filtros" :aria-label="t('padrao')" @submit.prevent>
        <span class="campo">
          <SanteSelecao
            v-model="padrao.cfop"
            :rotulo="t('cfop')"
            :opcoes="opcoesCfop"
            data-testid="ef-padrao-cfop"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="padrao.cst"
            :rotulo="t('cst')"
            :opcoes="opcoesCst"
            data-testid="ef-padrao-cst"
          />
        </span>
        <span class="campo">
          <label for="ef-padrao-apis">{{ t('aliquotaPis') }}</label>
          <input
            id="ef-padrao-apis"
            v-model.number="padrao.aliquotaPis"
            type="number"
            min="0"
            max="100"
            step="0.0001"
            data-testid="ef-padrao-aliquota-pis"
          />
        </span>
        <span class="campo">
          <label for="ef-padrao-acofins">{{ t('aliquotaCofins') }}</label>
          <input
            id="ef-padrao-acofins"
            v-model.number="padrao.aliquotaCofins"
            type="number"
            min="0"
            max="100"
            step="0.0001"
            data-testid="ef-padrao-aliquota-cofins"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="padrao.natureza"
            :rotulo="t('natureza')"
            :opcoes="opcoesNatureza"
            data-testid="ef-padrao-natureza"
          />
        </span>
      </form>

      <p v-if="painel.data.value.entradas.length === 0" data-testid="ef-vazio">{{ t('nenhuma') }}</p>
      <article
        v-for="e in painel.data.value.entradas"
        :key="e.id"
        :aria-label="t('documento', { numero: e.numero })"
        :data-testid="`ef-entrada-${e.numero}`"
      >
        <h3>
          {{ t('documento', { numero: e.numero }) }} · {{ e.participanteNome }} ·
          {{ e.servico ? t('servico') : t('mercadoria') }} · {{ dinheiro(e.valorDocumento) }}
        </h3>
        <p :data-testid="`ef-situacao-${e.numero}`">
          {{ t(`situacoes.${e.situacao}`) }} ·
          {{ e.pendencias ? t('pendencias', { n: e.pendencias }) : t('semPendencia') }}
        </p>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('item') }}</th>
              <th scope="col">{{ t('valor') }}</th>
              <th scope="col">{{ t('cfop') }}</th>
              <th scope="col">{{ t('cstPis') }}</th>
              <th scope="col">{{ t('basePis') }}</th>
              <th scope="col">{{ t('aliquotaPis') }}</th>
              <th scope="col">{{ t('cstCofins') }}</th>
              <th scope="col">{{ t('baseCofins') }}</th>
              <th scope="col">{{ t('aliquotaCofins') }}</th>
              <th scope="col">{{ t('natureza') }}</th>
              <th scope="col">{{ t('credito') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, n) in rascunho[e.id] ?? []" :key="l.sequencia">
              <td>
                {{ l.sequencia }} · {{ e.itens[n]?.descricao ?? e.itens[n]?.codigoItem }}
                <small v-if="e.itens[n]?.pendencias.length" class="secundario">
                  ({{ e.itens[n]!.pendencias.map((p) => t(`faltas.${p}`)).join(', ') }})
                </small>
              </td>
              <td>{{ dinheiro((e.itens[n]?.valorItem ?? 0) - (e.itens[n]?.valorDesconto ?? 0)) }}</td>
              <td>
                <SanteSelecao
                  v-model="l.cfop"
                  :rotulo="`${t('cfop')} ${l.sequencia}`"
                  ocultar-rotulo
                  :opcoes="opcoesCfop"
                  :desabilitado="!podeClassificar"
                  :data-testid="`ef-cfop-${e.numero}-${l.sequencia}`"
                />
              </td>
              <td>
                <SanteSelecao
                  v-model="l.cstPis"
                  :rotulo="`${t('cstPis')} ${l.sequencia}`"
                  ocultar-rotulo
                  :opcoes="opcoesCst"
                  :desabilitado="!podeClassificar"
                  :data-testid="`ef-cst-pis-${e.numero}-${l.sequencia}`"
                  @update:model-value="ajustar(l)"
                />
              </td>
              <td>
                <input
                  v-model.number="l.basePis"
                  type="number"
                  min="0"
                  step="0.01"
                  :aria-label="`${t('basePis')} ${l.sequencia}`"
                  :disabled="!podeClassificar || !cstDaCredito(l.cstPis)"
                  :data-testid="`ef-base-pis-${e.numero}-${l.sequencia}`"
                />
              </td>
              <td>
                <input
                  v-model.number="l.aliquotaPis"
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
                  :aria-label="`${t('aliquotaPis')} ${l.sequencia}`"
                  :disabled="!podeClassificar || !cstDaCredito(l.cstPis)"
                  :data-testid="`ef-aliquota-pis-${e.numero}-${l.sequencia}`"
                />
              </td>
              <td>
                <SanteSelecao
                  v-model="l.cstCofins"
                  :rotulo="`${t('cstCofins')} ${l.sequencia}`"
                  ocultar-rotulo
                  :opcoes="opcoesCst"
                  :desabilitado="!podeClassificar"
                  :data-testid="`ef-cst-cofins-${e.numero}-${l.sequencia}`"
                  @update:model-value="ajustar(l)"
                />
              </td>
              <td>
                <input
                  v-model.number="l.baseCofins"
                  type="number"
                  min="0"
                  step="0.01"
                  :aria-label="`${t('baseCofins')} ${l.sequencia}`"
                  :disabled="!podeClassificar || !cstDaCredito(l.cstCofins)"
                  :data-testid="`ef-base-cofins-${e.numero}-${l.sequencia}`"
                />
              </td>
              <td>
                <input
                  v-model.number="l.aliquotaCofins"
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
                  :aria-label="`${t('aliquotaCofins')} ${l.sequencia}`"
                  :disabled="!podeClassificar || !cstDaCredito(l.cstCofins)"
                  :data-testid="`ef-aliquota-cofins-${e.numero}-${l.sequencia}`"
                />
              </td>
              <td>
                <SanteSelecao
                  v-model="l.naturezaCredito"
                  :rotulo="`${t('natureza')} ${l.sequencia}`"
                  ocultar-rotulo
                  :opcoes="opcoesNatureza"
                  :desabilitado="!podeClassificar"
                  :data-testid="`ef-natureza-${e.numero}-${l.sequencia}`"
                />
              </td>
              <td :data-testid="`ef-credito-${e.numero}-${l.sequencia}`">
                {{ dinheiro(creditos(l).pis) }} / {{ dinheiro(creditos(l).cofins) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="podeClassificar && recusaDe(e)" role="alert" :data-testid="`ef-aviso-${e.numero}`">
          {{ recusaDe(e)?.mensagem }}
        </p>
        <p v-if="podeClassificar">
          <button
            type="button"
            :disabled="gravando || e.pendencias === 0"
            :data-testid="`ef-aplicar-${e.numero}`"
            @click="aplicarPadrao(e)"
          >
            {{ t('aplicar') }}
          </button>
          <button
            type="button"
            :disabled="gravando || recusaDe(e) !== null"
            :data-testid="`ef-salvar-${e.numero}`"
            @click="salvar(e)"
          >
            {{ t('salvar') }}
          </button>
        </p>
      </article>

      <section aria-labelledby="ef-conf-titulo" data-testid="ef-conferencia">
        <h3 id="ef-conf-titulo">{{ t('conferencia') }}</h3>
        <dl class="resumo">
          <div>
            <dt>{{ t('documentos') }}</dt>
            <dd>{{ painel.data.value.conferencia.documentos }}</dd>
          </div>
          <div>
            <dt>{{ t('itens') }}</dt>
            <dd>{{ painel.data.value.conferencia.itens }}</dd>
          </div>
          <div>
            <dt>{{ t('pendencias', { n: '' }).trim() }}</dt>
            <dd data-testid="ef-conf-pendencias">{{ painel.data.value.conferencia.pendencias.length }}</dd>
          </div>
          <div>
            <dt>{{ t('divergencias') }}</dt>
            <dd data-testid="ef-conf-divergencias">
              {{ painel.data.value.conferencia.divergencias.length }}
            </dd>
          </div>
          <div>
            <dt>{{ t('creditoPis') }}</dt>
            <dd data-testid="ef-conf-pis">{{ dinheiro(painel.data.value.conferencia.totalCreditoPis) }}</dd>
          </div>
          <div>
            <dt>{{ t('creditoCofins') }}</dt>
            <dd data-testid="ef-conf-cofins">
              {{ dinheiro(painel.data.value.conferencia.totalCreditoCofins) }}
            </dd>
          </div>
        </dl>
        <p data-testid="ef-conf-estado">
          {{ painel.data.value.conferencia.liberado ? t('liberado') : t('bloqueado') }}
        </p>
        <table v-if="apuracao.length" class="tabela" data-testid="ef-apuracao">
          <caption>
            {{
              t('apuracao')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('tributo') }}</th>
              <th scope="col">{{ t('natureza') }}</th>
              <th scope="col">{{ t('cstCurto') }}</th>
              <th scope="col">{{ t('aliquota') }}</th>
              <th scope="col">{{ t('base') }}</th>
              <th scope="col">{{ t('credito') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in apuracao" :key="`${x.tributo}-${x.natureza}-${x.cst}-${x.aliquota}`">
              <td>{{ x.tributo }}</td>
              <td>{{ x.natureza }}</td>
              <td>{{ x.cst }}</td>
              <td>{{ x.aliquota }}</td>
              <td>{{ dinheiro(x.base) }}</td>
              <td>{{ dinheiro(x.credito) }}</td>
            </tr>
          </tbody>
        </table>
        <form v-if="podeGerar" class="filtros" @submit.prevent="gerar">
          <span class="campo">
            <SanteSelecao
              v-model="regime"
              :rotulo="t('regime')"
              :opcoes="opcoesRegime"
              data-testid="ef-regime"
            />
          </span>
          <button
            type="submit"
            :disabled="gravando || !painel.data.value.conferencia.liberado"
            data-testid="ef-gerar"
          >
            {{ t('gerar') }}
          </button>
        </form>
      </section>

      <section aria-labelledby="ef-arq-titulo">
        <h3 id="ef-arq-titulo">{{ t('arquivos') }}</h3>
        <p v-if="painel.data.value.arquivos.length === 0">{{ t('nenhumArquivo') }}</p>
        <table v-else class="tabela" data-testid="ef-arquivos">
          <thead>
            <tr>
              <th scope="col">{{ t('envio') }}</th>
              <th scope="col">{{ t('regime') }}</th>
              <th scope="col">{{ t('conferencia') }}</th>
              <th scope="col">{{ t('recibo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in painel.data.value.arquivos"
              :key="a.id"
              :data-testid="`ef-arquivo-${a.sequencia}`"
            >
              <td>
                {{ a.sequencia }} · {{ t(`finalidades.${a.finalidade}`) }} ·
                {{ t(`situacaoArquivo.${a.situacao}`) }}
              </td>
              <td>{{ t(`regimes.${a.regime}`) }}</td>
              <td>
                <button
                  v-if="a.confere"
                  type="button"
                  :data-testid="`ef-baixar-${a.sequencia}`"
                  @click="baixar(a.id)"
                >
                  {{ t('baixar') }}
                </button>
                <span v-else-if="a.situacao !== 'cancelado'" class="secundario">{{
                  t('desatualizado')
                }}</span>
              </td>
              <td>
                <template v-if="a.recibo">{{ a.recibo }}</template>
                <form
                  v-else-if="podeGerar && a.confere && a.situacao === 'gerado'"
                  class="filtros"
                  @submit.prevent="entregar(a.id)"
                >
                  <input
                    v-model="recibos[a.id]"
                    maxlength="60"
                    :aria-label="t('recibo')"
                    :data-testid="`ef-recibo-${a.sequencia}`"
                  />
                  <button
                    type="submit"
                    :disabled="gravando || (recibos[a.id] ?? '').trim().length < 6"
                    :data-testid="`ef-entregar-${a.sequencia}`"
                  >
                    {{ t('entregar') }}
                  </button>
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-financeiro.css"></style>
