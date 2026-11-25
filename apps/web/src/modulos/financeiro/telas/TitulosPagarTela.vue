<script setup lang="ts">
// Títulos a pagar (ficha do M32, seção 7): `/financeiro/pagar/titulos`. A lista paginada no servidor com a situação
// derivada (data de pagamento e borderô, não o código gravado), o credor que não está no cadastro marcado, e o
// lançamento do título: credor, documento, parcelas (a soma fecha o valor do documento), a classificação gerencial (vale
// para o documento inteiro), uma retenção e o centro de custo da alçada.
import type { ContratoDoVinculo } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import EscolhaContrato from '../../suprimentos/componentes/EscolhaContrato.vue';
import BuscaCredor from '../componentes/BuscaCredor.vue';
import SugestaoRetencaoTitulo from '../componentes/SugestaoRetencaoTitulo.vue';
import { criarTituloPagar, listarTitulosPagar, novaChave } from '../api-financeiro.js';
import {
  data,
  dividirParcelas,
  lerClassificacao,
  opcoesClassificacao,
  reais,
  usarFinanceiro,
} from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const filtro = reactive({ situacao: '', de: '', ate: '', credor: '', tipo: '' });
/** Página do servidor (0 = a primeira). */
const pagina = ref(0);
const pedido = ref({ ...filtro });
const lista = useQuery({
  queryKey: computed(() => ['financeiro', 'pagar', pedido.value, pagina.value]),
  queryFn: () => listarTitulosPagar({ ...pedido.value, pagina: pagina.value }),
});
function consultar() {
  pagina.value = 0;
  pedido.value = { ...filtro };
}

const situacoes = computed(() => [
  { valor: '', rotulo: t('financeiro.todas') },
  ...(['aberto', 'vencido', 'em-bordero', 'pago', 'pago-parcial'] as const).map((s) => ({
    valor: s,
    rotulo: t(`financeiro.situacoesPagar.${s}`),
  })),
]);
const tipos = computed(() =>
  (apoio.data.value?.tiposCredor ?? []).map((x) => ({
    valor: x.codigo,
    rotulo: `${x.codigo} — ${x.rotulo}`,
  })),
);
const tiposFiltro = computed(() => [{ valor: '', rotulo: t('financeiro.todos') }, ...tipos.value]);
const classificacoes = computed(() =>
  opcoesClassificacao(apoio.data.value?.classificacoes, t('financeiro.escolha')),
);
const retencoes = computed(() => [
  { valor: '', rotulo: t('financeiro.nenhum') },
  ...(apoio.data.value?.retencoes ?? []).map((r) => ({ valor: String(r.codigo), rotulo: r.descricao })),
]);

// ── Lançamento ──────────────────────────────────────────────────────────────────────────────────────────────────
const abrindo = ref(false);
const novo = reactive({
  tipo: 'F',
  credor: '',
  profissional: '',
  documento: '',
  serie: '',
  emissao: '',
  valorDocumento: '',
  referente: '',
  observacao: '',
  quantas: '1',
  primeiroVencimento: '',
  classificacao: '',
  retencao: '',
  valorRetencao: '',
  centroCusto: '',
});
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !novo.emissao) {
      novo.emissao = h;
      novo.primeiroVencimento = h;
    }
  },
  { immediate: true },
);
// F3.8, 07-FIN linha 67: o credor achado pelo nome, documento ou código (fornecedor ou médico) preenche o código do
// campo; quem sabe o código segue digitando direto. O nome escolhido e o código são UM estado só: o nome só fica na
// tela enquanto o código do campo é o dele. Desfazer a escolha (outro texto, outro tipo) limpa o código; digitar outro
// código desfaz a escolha. No título de médico o credor é o próprio profissional: a busca preenche os dois campos.
const credorBuscado = ref<number | null>(null);
function credorAchado(v: number | null) {
  const anterior = credorBuscado.value;
  credorBuscado.value = v;
  if (v !== null) {
    novo.credor = String(v);
    if (novo.tipo === 'M') novo.profissional = String(v);
  } else if (anterior !== null && novo.credor === String(anterior)) {
    // A escolha foi desfeita: o código que ela pôs sai junto.
    novo.credor = '';
    if (novo.profissional === String(anterior)) novo.profissional = '';
  }
}
// O código digitado à mão diferente do escolhido desfaz a escolha (o nome exibido nunca é de outro código).
watch(
  () => novo.credor,
  (c) => {
    if (credorBuscado.value !== null && c !== String(credorBuscado.value)) credorBuscado.value = null;
  },
);
// O credor é o par tipo e código: trocar o tipo limpa o código e o profissional (o código do fornecedor não vira o
// credor do título de médico, nem o contrário).
watch(
  () => novo.tipo,
  () => {
    credorBuscado.value = null;
    novo.credor = '';
    novo.profissional = '';
  },
);
// M55 (etapa 3): o título de fornecedor pode consumir um contrato dele (o vínculo na mesma transação).
const contrato = ref<ContratoDoVinculo | null>(null);
const credorFornecedor = computed(() => {
  const n = Number(novo.credor);
  return novo.tipo === 'F' && Number.isSafeInteger(n) && n > 0 ? n : null;
});
const valorNum = computed(() => Number(String(novo.valorDocumento).replace(',', '.')) || 0);
const previa = computed(() =>
  valorNum.value > 0 && novo.primeiroVencimento
    ? dividirParcelas(valorNum.value, Number(novo.quantas) || 1, novo.primeiroVencimento)
    : [],
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);
let chave = novaChave('titulo-pagar');
async function lancar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await criarTituloPagar(
      {
        tipo: novo.tipo,
        credor: Number(novo.credor),
        profissional: novo.tipo === 'M' && novo.profissional ? Number(novo.profissional) : null,
        documento: Number(novo.documento),
        serie: novo.serie,
        emissao: novo.emissao,
        valorDocumento: valorNum.value,
        referente: novo.referente,
        observacao: novo.observacao,
        parcelas: previa.value,
        classificacao: lerClassificacao(novo.classificacao),
        retencoes: novo.retencao
          ? [{ codigo: Number(novo.retencao), valor: Number(String(novo.valorRetencao).replace(',', '.')) }]
          : [],
        centroCusto: novo.centroCusto ? Number(novo.centroCusto) : null,
        ...(contrato.value && credorFornecedor.value !== null ? { contrato: contrato.value } : {}),
      },
      chave,
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    chave = novaChave('titulo-pagar');
    // O próximo lançamento começa sem nome escolhido (o código fica para quem lança vários do mesmo credor).
    credorBuscado.value = null;
    abrindo.value = false;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tp-titulo" data-testid="tela-fin-titulos-pagar">
    <h1 id="tp-titulo">{{ t('financeiro.pagar.titulo') }}</h1>
    <p>{{ t('financeiro.pagar.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasPagar')" />
    <form class="filtros" @submit.prevent="consultar">
      <span class="campo">
        <SanteSelecao
          v-model="filtro.situacao"
          :rotulo="t('financeiro.situacao')"
          :opcoes="situacoes"
          data-testid="tp-situacao"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="filtro.tipo"
          :rotulo="t('financeiro.tipo')"
          :opcoes="tiposFiltro"
          data-testid="tp-tipo"
        />
      </span>
      <span class="campo">
        <label for="tp-credor">{{ t('financeiro.credor') }}</label>
        <input id="tp-credor" v-model="filtro.credor" inputmode="numeric" data-testid="tp-credor" />
      </span>
      <span class="campo">
        <label for="tp-de">{{ t('financeiro.vencimento') }} — {{ t('financeiro.de') }}</label>
        <input id="tp-de" v-model="filtro.de" type="date" data-testid="tp-de" />
      </span>
      <span class="campo">
        <label for="tp-ate">{{ t('financeiro.ate') }}</label>
        <input id="tp-ate" v-model="filtro.ate" type="date" data-testid="tp-ate" />
      </span>
      <button type="submit" data-testid="tp-consultar">{{ t('financeiro.consultar') }}</button>
      <button
        type="button"
        :disabled="!pode('financeiro.criarTituloPagar', 'financeiro.tituloPagar.criar')"
        data-testid="tp-novo"
        @click="abrindo = !abrindo"
      >
        {{ t('financeiro.pagar.novo') }}
      </button>
    </form>
    <p v-if="!pode('financeiro.criarTituloPagar')" class="secundario">
      {{ motivo('financeiro.criarTituloPagar') }}
    </p>

    <form v-if="abrindo" class="formulario" data-testid="tp-formulario" @submit.prevent="lancar">
      <h2>{{ t('financeiro.pagar.novo') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="novo.tipo"
          :rotulo="t('financeiro.tipo')"
          :opcoes="tipos"
          data-testid="tp-novo-tipo"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-credor">{{ t('financeiro.credor') }}</label>
        <input
          id="tp-novo-credor"
          v-model="novo.credor"
          required
          inputmode="numeric"
          data-testid="tp-novo-credor"
        />
      </span>
      <BuscaCredor
        v-if="novo.tipo === 'F' || novo.tipo === 'M'"
        :model-value="credorBuscado"
        :tipo="novo.tipo === 'M' ? 'profissional' : 'fornecedor'"
        :rotulo="t('financeiro.pagar.credorPeloNome')"
        prefixo="tp-novo-credor-nome"
        @update:model-value="credorAchado"
      />
      <EscolhaContrato
        v-model="contrato"
        :fornecedor="credorFornecedor"
        tipo="titulo"
        testid="tp-novo-contrato"
      />
      <span v-if="novo.tipo === 'M'" class="campo">
        <label for="tp-novo-prof">{{ t('financeiro.pagar.profissional') }}</label>
        <input
          id="tp-novo-prof"
          v-model="novo.profissional"
          inputmode="numeric"
          data-testid="tp-novo-profissional"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-doc">{{ t('financeiro.documento') }}</label>
        <input
          id="tp-novo-doc"
          v-model="novo.documento"
          required
          inputmode="numeric"
          data-testid="tp-novo-documento"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-serie">{{ t('financeiro.serie') }}</label>
        <input id="tp-novo-serie" v-model="novo.serie" maxlength="3" data-testid="tp-novo-serie" />
      </span>
      <span class="campo">
        <label for="tp-novo-emissao">{{ t('financeiro.emissao') }}</label>
        <input
          id="tp-novo-emissao"
          v-model="novo.emissao"
          type="date"
          required
          data-testid="tp-novo-emissao"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-valor">{{ t('financeiro.pagar.valorDocumento') }}</label>
        <input
          id="tp-novo-valor"
          v-model="novo.valorDocumento"
          required
          inputmode="decimal"
          data-testid="tp-novo-valor"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-quantas">{{ t('financeiro.pagar.quantasParcelas') }}</label>
        <input
          id="tp-novo-quantas"
          v-model="novo.quantas"
          type="number"
          min="1"
          max="120"
          data-testid="tp-novo-quantas"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-venc">{{ t('financeiro.pagar.primeiroVencimento') }}</label>
        <input
          id="tp-novo-venc"
          v-model="novo.primeiroVencimento"
          type="date"
          required
          data-testid="tp-novo-vencimento"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="novo.classificacao"
          :rotulo="t('financeiro.classificacao')"
          :opcoes="classificacoes"
          obrigatorio
          data-testid="tp-novo-classificacao"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="novo.retencao"
          :rotulo="t('financeiro.pagar.retencao')"
          :opcoes="retencoes"
          data-testid="tp-novo-retencao"
        />
      </span>
      <SugestaoRetencaoTitulo
        :valor="valorNum"
        :data="novo.emissao"
        :participante="novo.tipo === 'M' ? 'pessoa_fisica' : 'pessoa_juridica'"
        @aplicar="(s) => ((novo.retencao = String(s.tributo)), (novo.valorRetencao = s.valor.toFixed(2)))"
      />
      <span v-if="novo.retencao" class="campo">
        <label for="tp-novo-vret">{{ t('financeiro.pagar.valorRetencao') }}</label>
        <input
          id="tp-novo-vret"
          v-model="novo.valorRetencao"
          inputmode="decimal"
          data-testid="tp-novo-valor-retencao"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-cdc">{{ t('financeiro.pagar.centroCusto') }}</label>
        <input
          id="tp-novo-cdc"
          v-model="novo.centroCusto"
          inputmode="numeric"
          data-testid="tp-novo-centro-custo"
        />
      </span>
      <span class="campo">
        <label for="tp-novo-ref">{{ t('financeiro.pagar.referente') }}</label>
        <input id="tp-novo-ref" v-model="novo.referente" maxlength="60" data-testid="tp-novo-referente" />
      </span>
      <table v-if="previa.length" class="tabela" data-testid="tp-previa">
        <caption>
          {{
            t('financeiro.pagar.previaParcelas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.parcela') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in previa" :key="p.parcela">
            <td>{{ p.parcela }}</td>
            <td>{{ data(p.vencimento) }}</td>
            <td>{{ reais(p.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <button type="submit" :disabled="gravando || !previa.length" data-testid="tp-lancar">
        {{ t('financeiro.pagar.lancar') }}
      </button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="tp-mensagem" />

    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="lista.data.value?.itens.length">
      <table class="tabela" data-testid="tp-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.credor') }}</th>
            <th scope="col">{{ t('financeiro.tipo') }}</th>
            <th scope="col">{{ t('financeiro.documento') }}</th>
            <th scope="col">{{ t('financeiro.parcela') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
            <th scope="col">{{ t('financeiro.pagar.lancadoPor') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`tp-linha-${x.id}`">
            <td>
              {{ x.credor }} — {{ x.credorNome }}
              <span v-if="!x.credorEncontrado" class="secundario"
                >({{ t('financeiro.pagar.credorNaoEncontrado') }})</span
              >
            </td>
            <td>{{ x.tipo }}</td>
            <td>{{ x.documento }}{{ x.serie ? `/${x.serie}` : '' }}</td>
            <td>{{ x.parcela }}</td>
            <td>{{ data(x.vencimento) }}</td>
            <td>{{ reais(x.valor) }}</td>
            <td>{{ t(`financeiro.situacoesPagar.${x.situacao}`) }}</td>
            <td>{{ x.lancadoPor }}</td>
            <td>
              <RouterLink :to="`/financeiro/pagar/titulos/${x.id}`" :data-testid="`tp-abrir-${x.id}`">
                {{ t('financeiro.abrir') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <nav class="paginacao">
        <button type="button" :disabled="pagina <= 0" @click="pagina--">
          {{ t('financeiro.anterior') }}
        </button>
        <span>{{ pagina + 1 }}</span>
        <button type="button" :disabled="!lista.data.value.mais" @click="pagina++">
          {{ t('financeiro.proxima') }}
        </button>
      </nav>
    </template>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
