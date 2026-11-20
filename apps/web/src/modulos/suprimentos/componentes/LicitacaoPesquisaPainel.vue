<script setup lang="ts">
// Os itens do processo e a pesquisa de preços (M55, etapa 4; Lei 14.133, art. 23): por item, a quantidade, os preços
// pesquisados com a fonte e a origem, o unitário e o total estimados com a conta impressa (as parcelas e o método), e o
// aviso do item abaixo do mínimo de preços. O registro de um preço (suprimentos.registrarPrecoLicitacao) só na pesquisa
// e por quem conduz; na cotação direta com fornecedor, o fornecedor achado na busca. O descarte de um preço
// (suprimentos.descartarPrecoLicitacao; IN SEGES 65/2021) com a justificativa: o preço fica na lista, marcado, e sai da
// conta e do mínimo. Orçamento sigiloso: a estimativa não aparece para quem não conduz até o julgamento (o servidor já
// não a manda).
import { esquemaDescartarPrecoLicitacao, esquemaRegistrarPrecoLicitacao, FONTES_PRECO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarFornecedoresLicitacao,
  descartarPrecoLicitacaoTela,
  type DetalheLicitacaoTela,
  novaChaveLicitacao,
  registrarPrecoLicitacaoTela,
} from '../api-licitacao.js';
import { data, reais } from '../usar-suprimentos.js';
import BuscaCodigoNome from './BuscaCodigoNome.vue';
import ErroSuprimentos from './ErroSuprimentos.vue';
import { lerNumero, opcoesDe, rotuloFonte } from './licitacao-tela.js';
import { usarEnvioLicitacao } from './usar-envio-licitacao.js';

const props = defineProps<{ d: DetalheLicitacaoTela; pode: boolean }>();
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.pesquisa.${s}`, p ?? {});
const { erro, enviando, executar } = usarEnvioLicitacao((m) => emit('gravado', m));
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const unit = (n: number | null) =>
  n === null
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });

const estimativaDo = (item: number) => props.d.estimativa.itens.find((x) => x.item === item) ?? null;
const precosDo = (item: number) => props.d.precos.filter((x) => x.item === item);
const naPesquisa = computed(() => props.d.etapa === 'pesquisa');
const sigiloso = computed(() => props.d.processo.sigiloso && props.d.estimativa.itens.length === 0);

const itens = computed(() =>
  props.d.itensDetalhe.map((i) => ({ valor: i.id as number | null, rotulo: `${i.numero} · ${i.descricao}` })),
);
const fontes = opcoesDe(FONTES_PRECO);
const f = reactive({
  item: (props.d.itensDetalhe[0]?.id ?? null) as number | null,
  fonte: 'painel' as string,
  referencia: '',
  valor: '',
  data: props.d.hoje,
  fornecedor: null as number | null,
});
const buscarFornecedor = (termo: string) => buscarFornecedoresLicitacao(termo);
const corpo = computed(() => ({
  versao: props.d.versao,
  item: f.item,
  fonte: f.fonte,
  referencia: f.referencia,
  valor: lerNumero(f.valor),
  data: f.data,
  fornecedor: f.fonte === 'fornecedor' ? f.fornecedor : null,
}));
const problemas = computed(() => {
  const r = esquemaRegistrarPrecoLicitacao.safeParse({ chave: 'previa.da.tela', ...corpo.value });
  return r.success ? [] : [...new Set(r.error.issues.map((x) => x.message))];
});
const tentou = ref(false);
let chave = novaChaveLicitacao('preco');

// O descarte: um preço por vez, com a justificativa (20 letras ou mais) conferida pelo mesmo esquema do servidor.
const descartando = ref<number | null>(null);
const justificativa = ref('');
const problemasDescarte = computed(() => {
  const r = esquemaDescartarPrecoLicitacao.safeParse({
    chave: 'previa.da.tela',
    versao: props.d.versao,
    justificativa: justificativa.value,
  });
  return r.success ? [] : [...new Set(r.error.issues.map((x) => x.message))];
});
let chaveDescarte = novaChaveLicitacao('descarte');
function abrirDescarte(preco: number): void {
  descartando.value = preco;
  justificativa.value = '';
  chaveDescarte = novaChaveLicitacao('descarte');
}
async function descartar(): Promise<void> {
  const preco = descartando.value;
  if (preco === null || problemasDescarte.value.length || !props.pode) return;
  const ok = await executar(() =>
    descartarPrecoLicitacaoTela(
      props.d.id,
      preco,
      { versao: props.d.versao, justificativa: justificativa.value },
      chaveDescarte,
    ),
  );
  if (ok) descartando.value = null;
}

async function registrar(): Promise<void> {
  tentou.value = true;
  if (problemas.value.length || !props.pode) return;
  const ok = await executar(() => registrarPrecoLicitacaoTela(props.d.id, corpo.value, chave));
  if (ok) {
    chave = novaChaveLicitacao('preco');
    tentou.value = false;
    Object.assign(f, { referencia: '', valor: '', fornecedor: null });
  }
}
</script>

<template>
  <section class="pesquisa-licitacao" data-testid="lic-pesquisa">
    <h3>{{ k('estimativa') }}</h3>
    <p class="secundario">{{ k('minimo', { n: d.estimativa.minimoPrecos }) }}</p>
    <SanteAlerta v-if="sigiloso" variante="info" :texto="k('sigiloso')" data-testid="lic-sigiloso-aviso" />
    <div class="rolagem">
      <table class="grade" data-testid="lic-estimativa">
        <thead>
          <tr>
            <th scope="col">{{ k('colItem') }}</th>
            <th scope="col">{{ k('colDescricao') }}</th>
            <th scope="col">{{ k('colQuantidade') }}</th>
            <th scope="col">{{ k('colPrecos') }}</th>
            <th scope="col">{{ k('colUnitario') }}</th>
            <th scope="col">{{ k('colTotal') }}</th>
            <th scope="col">{{ k('colConta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in d.itensDetalhe" :key="i.id" :data-testid="`lic-est-item-${i.numero}`">
            <td>{{ i.numero }}</td>
            <td>{{ i.descricao }}</td>
            <td>{{ qtd(i.quantidade) }} {{ i.unidade }}</td>
            <td>
              {{ estimativaDo(i.id)?.quantidadePrecos ?? precosDo(i.id).length }}
              <span v-if="estimativaDo(i.id)?.abaixoDoMinimo" class="alerta">
                · {{ k('abaixoMinimo', { n: d.estimativa.minimoPrecos }) }}
              </span>
            </td>
            <td>{{ unit(estimativaDo(i.id)?.valorUnitario ?? i.valorEstimado) }}</td>
            <td>
              {{
                estimativaDo(i.id)?.valorTotal === null || estimativaDo(i.id)?.valorTotal === undefined
                  ? '—'
                  : reais(estimativaDo(i.id)!.valorTotal!)
              }}
            </td>
            <td class="secundario">{{ estimativaDo(i.id)?.conta ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p data-testid="lic-conta-total">
      <strong>{{ k('contaTotal') }}:</strong> {{ d.estimativa.conta }}
    </p>

    <template v-for="i in d.itensDetalhe" :key="`p-${i.id}`">
      <h4>{{ k('precosDoItem', { n: i.numero }) }}</h4>
      <p v-if="precosDo(i.id).length === 0" class="secundario">{{ k('nenhumPreco') }}</p>
      <div v-else class="rolagem">
        <table class="grade" :data-testid="`lic-precos-${i.numero}`">
          <thead>
            <tr>
              <th scope="col">{{ k('colFonte') }}</th>
              <th scope="col">{{ k('colReferencia') }}</th>
              <th scope="col">{{ k('colValor') }}</th>
              <th scope="col">{{ k('colData') }}</th>
              <th scope="col">{{ k('colFornecedor') }}</th>
              <th scope="col">{{ k('colSituacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in precosDo(i.id)"
              :key="x.id"
              :class="{ descartado: x.descarte }"
              :data-testid="`lic-preco-linha-${x.id}`"
            >
              <td>{{ rotuloFonte(x.fonte) }}</td>
              <td>{{ x.referencia }}</td>
              <td>{{ unit(x.valor) }}</td>
              <td>{{ data(x.data) }}</td>
              <td>{{ x.fornecedor ?? '—' }}</td>
              <td>
                <span v-if="x.descarte" :data-testid="`lic-preco-descartado-${x.id}`">
                  {{
                    k('descartado', { usuario: x.descarte.usuario, justificativa: x.descarte.justificativa })
                  }}
                </span>
                <template v-else>
                  {{ k('naConta') }}
                  <SanteBotao
                    v-if="naPesquisa && pode"
                    variante="secundario"
                    :rotulo="k('descartar')"
                    :aria-label="k('descartarPreco', { valor: unit(x.valor) })"
                    :desabilitado="enviando"
                    :data-testid="`lic-preco-descartar-${x.id}`"
                    @acionar="abrirDescarte(x.id)"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form
        v-if="descartando !== null && precosDo(i.id).some((x) => x.id === descartando)"
        class="formulario-licitacao"
        :aria-label="k('confirmarDescarte')"
        data-testid="lic-descarte-form"
        @submit.prevent="descartar"
      >
        <span class="campo campo-largo">
          <label for="lic-descarte-just">{{ k('justificativaDescarte') }}</label>
          <textarea
            id="lic-descarte-just"
            v-model="justificativa"
            maxlength="1000"
            rows="2"
            data-testid="lic-descarte-justificativa"
          />
        </span>
        <SanteAlerta
          v-if="justificativa && problemasDescarte.length"
          variante="aviso"
          :texto="problemasDescarte.join('; ')"
          data-testid="lic-descarte-faltam"
        />
        <div class="barra">
          <SanteBotao
            tipo="submit"
            :rotulo="k('confirmarDescarte')"
            :desabilitado="!pode || enviando || problemasDescarte.length > 0"
            data-testid="lic-descarte-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('cancelarDescarte')"
            data-testid="lic-descarte-cancelar"
            @acionar="descartando = null"
          />
        </div>
      </form>
    </template>

    <form
      v-if="naPesquisa"
      class="formulario-licitacao"
      :aria-label="k('registrar')"
      data-testid="lic-preco-form"
      @submit.prevent="registrar"
    >
      <h3>{{ k('registrar') }}</h3>
      <div class="barra">
        <SanteSelecao v-model="f.item" :rotulo="k('item')" :opcoes="itens" data-testid="lic-preco-item" />
        <SanteSelecao v-model="f.fonte" :rotulo="k('fonte')" :opcoes="fontes" data-testid="lic-preco-fonte" />
        <span class="campo">
          <label for="lic-preco-valor">{{ k('valor') }}</label>
          <input
            id="lic-preco-valor"
            v-model="f.valor"
            inputmode="decimal"
            size="12"
            data-testid="lic-preco-valor"
          />
        </span>
        <span class="campo">
          <label for="lic-preco-data">{{ k('data') }}</label>
          <input
            id="lic-preco-data"
            v-model="f.data"
            type="date"
            :max="d.hoje"
            data-testid="lic-preco-data"
          />
        </span>
      </div>
      <span class="campo campo-largo">
        <label for="lic-preco-ref">{{ k('referencia') }}</label>
        <input id="lic-preco-ref" v-model="f.referencia" maxlength="200" data-testid="lic-preco-ref" />
      </span>
      <BuscaCodigoNome
        v-if="f.fonte === 'fornecedor'"
        v-model="f.fornecedor"
        :rotulo="k('fornecedor')"
        :rotulo-buscar="k('buscarFornecedor')"
        :rotulo-escolhido="k('fornecedorEscolhido')"
        :rotulo-nenhum="k('fornecedorNenhum')"
        :buscar="buscarFornecedor"
        testid="lic-preco-fornecedor"
      />
      <SanteAlerta
        v-if="tentou && problemas.length"
        variante="aviso"
        :texto="problemas.join('; ')"
        data-testid="lic-preco-faltam"
      />
      <ErroSuprimentos v-if="erro" :erro="erro" />
      <SanteBotao
        tipo="submit"
        :rotulo="k('registrar')"
        :desabilitado="!pode || enviando"
        data-testid="lic-preco-registrar"
      />
    </form>
    <p v-else class="secundario">{{ k('soNaPesquisa') }}</p>
  </section>
</template>
