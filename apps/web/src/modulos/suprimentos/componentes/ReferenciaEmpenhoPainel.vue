<script setup lang="ts">
// Referência do empenho no pedido de compra e no título a pagar (C3-025, 07-FIN linha 132). A execução orçamentária fica
// no sistema contábil do ente (decisão 26/11); aqui a autoridade refere o empenho em vigor no pedido e no título do mesmo
// credor (a busca é remota, pelo número do pedido, do título ou do documento) e baixa o CSV para o ente. A regra (empenho
// em vigor, mesmo credor, soma dos títulos até o valor empenhado) é do domínio e conferida pela API.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type CandidatoReferenciaTela,
  type EmpenhoTela,
  listarCandidatosReferencia,
  listarReferenciasEmpenho,
  novaChaveAtaEmpenho,
  type ReferenciasEmpenhoTela,
  referirEmpenho,
  urlExportacaoEmpenhos,
} from '../api-ata-empenho.js';
import { reais } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ empenhos: readonly EmpenhoTela[] }>();
const { t } = useI18n();

const escolhido = ref('');
const refs = ref<ReferenciasEmpenhoTela | null>(null);
const pedidos = ref<CandidatoReferenciaTela[]>([]);
const titulos = ref<CandidatoReferenciaTela[]>([]);
const pedido = ref('');
const titulo = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
const hoje = new Date().toISOString().slice(0, 10);
const inicio = ref(`${hoje.slice(0, 7)}-01`);
const fim = ref(hoje);

const emVigor = computed(() =>
  props.empenhos.filter((e) => e.situacao === 'emitido' || e.situacao === 'parcial'),
);
const opcoesEmpenho = computed(() => [
  { valor: '', rotulo: t('ataEmpenho.escolha') },
  ...emVigor.value.map((e) => ({ valor: String(e.id), rotulo: `${e.numero} · ${e.fornecedor}` })),
]);
const opcoes = (l: readonly CandidatoReferenciaTela[]) => [
  { valor: '', rotulo: t('ataEmpenho.escolha') },
  ...l.map((c) => ({
    valor: String(c.id),
    rotulo: c.valor === null ? c.rotulo : `${c.rotulo} · ${reais(c.valor)}`,
  })),
];
const empenhoId = computed(() => Number(escolhido.value) || 0);

async function buscar(termo: string): Promise<void> {
  if (!empenhoId.value) return;
  try {
    const r = await listarCandidatosReferencia(empenhoId.value, termo);
    pedidos.value = r.pedidos;
    titulos.value = r.titulos;
  } catch (x) {
    erro.value = x;
  }
}
async function carregar(): Promise<void> {
  erro.value = null;
  refs.value = null;
  pedido.value = '';
  titulo.value = '';
  if (!empenhoId.value) return;
  try {
    refs.value = await listarReferenciasEmpenho(empenhoId.value);
    await buscar('');
  } catch (x) {
    erro.value = x;
  }
}
watch(escolhido, carregar);

async function referir(alvo: 'pedidos' | 'titulos'): Promise<void> {
  const lista = alvo === 'pedidos' ? pedidos.value : titulos.value;
  const c = lista.find((x) => String(x.id) === (alvo === 'pedidos' ? pedido.value : titulo.value));
  if (!c || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await referirEmpenho(
      empenhoId.value,
      alvo,
      { id: c.id, versao: c.versao },
      novaChaveAtaEmpenho(alvo),
    );
    mensagem.value = t('ataEmpenho.referencia.referido', { numero: r.numero });
    await carregar();
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}
const urlCsv = computed(() => urlExportacaoEmpenhos(inicio.value, fim.value));
</script>

<template>
  <section class="painel" aria-labelledby="ref-emp-titulo" data-testid="ref-empenho">
    <h2 id="ref-emp-titulo">{{ t('ataEmpenho.referencia.titulo') }}</h2>
    <p class="secundario">{{ t('ataEmpenho.referencia.texto') }}</p>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="ref-mensagem">{{ mensagem }}</p>
    <SanteSelecao
      v-model="escolhido"
      :rotulo="t('ataEmpenho.referencia.empenho')"
      :opcoes="opcoesEmpenho"
      data-testid="ref-empenho-escolha"
    />
    <template v-if="refs">
      <p data-testid="ref-resumo">
        {{
          t('ataEmpenho.referencia.resumo', {
            total: reais(refs.valorTotal),
            referido: reais(refs.referido),
            saldo: reais(refs.saldo),
          })
        }}
      </p>
      <h3>{{ t('ataEmpenho.referencia.pedidos') }}</h3>
      <ul data-testid="ref-pedidos">
        <li v-for="p in refs.pedidos" :key="p.id">
          {{ p.numero }} · {{ t(`ataEmpenho.situacoes.${p.situacao}`, p.situacao) }}
        </li>
        <li v-if="refs.pedidos.length === 0">{{ t('ataEmpenho.referencia.nenhum') }}</li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          v-model="pedido"
          :rotulo="t('ataEmpenho.referencia.pedido')"
          :opcoes="opcoes(pedidos)"
          :buscar="buscar"
          data-testid="ref-pedido"
        />
        <SanteBotao
          :rotulo="t('ataEmpenho.referencia.referirPedido')"
          :desabilitado="!pedido || gravando"
          data-testid="ref-referir-pedido"
          @acionar="referir('pedidos')"
        />
      </div>
      <h3>{{ t('ataEmpenho.referencia.titulos') }}</h3>
      <ul data-testid="ref-titulos">
        <li v-for="x in refs.titulos" :key="x.id">
          {{ x.numero }} · {{ x.documento }} · {{ reais(x.valorLiquido) }}
        </li>
        <li v-if="refs.titulos.length === 0">{{ t('ataEmpenho.referencia.nenhum') }}</li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          v-model="titulo"
          :rotulo="t('ataEmpenho.referencia.tituloPagar')"
          :opcoes="opcoes(titulos)"
          :buscar="buscar"
          data-testid="ref-titulo"
        />
        <SanteBotao
          :rotulo="t('ataEmpenho.referencia.referirTitulo')"
          :desabilitado="!titulo || gravando"
          data-testid="ref-referir-titulo"
          @acionar="referir('titulos')"
        />
      </div>
    </template>
    <h3>{{ t('ataEmpenho.referencia.exportacao') }}</h3>
    <div class="filtros">
      <span class="campo">
        <label for="ref-inicio">{{ t('ataEmpenho.referencia.inicio') }}</label>
        <input id="ref-inicio" v-model="inicio" type="date" data-testid="ref-inicio" />
      </span>
      <span class="campo">
        <label for="ref-fim">{{ t('ataEmpenho.referencia.fim') }}</label>
        <input id="ref-fim" v-model="fim" type="date" data-testid="ref-fim" />
      </span>
      <a :href="urlCsv" download="empenhos.csv" data-testid="ref-baixar">{{
        t('ataEmpenho.referencia.baixar')
      }}</a>
    </div>
  </section>
</template>
