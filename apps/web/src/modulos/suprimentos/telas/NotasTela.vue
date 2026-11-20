<script setup lang="ts">
// Entrada por nota fiscal (ficha do M28, seção 7; regras 8 e 12): `/suprimentos/notas-fiscais`. O fornecedor, o
// número, a série, a emissão, o local e o pedido ligado (opcional); os itens com quantidade, unitário, fator da
// unidade de compra, marca e os lotes (validade obrigatória e não passada); o XML da NF-e pré-preenche. A conferência
// contra o pedido aplica as tolerâncias dos parâmetros; fora delas, a nota só consolida com a aprovação do comprador
// (o texto vai junto). O saldo, o lote no local e o custo médio são do banco.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerXmlNota, novaChave, registrarNota } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import FiltroDocumentos from '../componentes/FiltroDocumentos.vue';
import { usarListaDocumentos } from '../componentes/usar-lista-documentos.js';
import { chaveDoc, data, numero, reais, usarSuprimentos } from '../usar-suprimentos.js';

interface LinhaNota {
  item: number;
  nome: string;
  rastreavel: boolean;
  quantidade: string;
  unitario: string;
  fator: string;
  marca: string;
  lotes: { lote: string; validade: string; quantidade: string }[];
}

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo, motivoFuncionalidade, locaisDoTipo, nomeLocal } = usarSuprimentos();
const fornecedor = ref('');
const numeroNota = ref('');
const serie = ref('1');
const emissao = ref(new Date().toISOString().slice(0, 10));
const local = ref('');
const pedidoAno = ref('');
const pedidoDoc = ref('');
const desconto = ref('');
const frete = ref('');
const aprovacao = ref('');
const linhas = ref<LinhaNota[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locaisDoTipo('E').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const total = computed(() =>
  linhas.value.reduce((s, l) => s + numero(l.quantidade || '0') * numero(l.unitario || '0'), 0),
);
function incluir(i: { codigo: number; nome: string; rastreavel: boolean }): void {
  if (linhas.value.some((l) => l.item === i.codigo)) return;
  linhas.value.push({
    item: i.codigo,
    nome: i.nome,
    rastreavel: i.rastreavel,
    quantidade: '',
    unitario: '',
    fator: '',
    marca: '',
    lotes: i.rastreavel ? [{ lote: '', validade: '', quantidade: '' }] : [],
  });
}
async function carregarXml(ev: Event): Promise<void> {
  const arquivo = (ev.target as HTMLInputElement).files?.[0];
  if (!arquivo) return;
  erro.value = null;
  try {
    const n = await lerXmlNota(await arquivo.text());
    numeroNota.value = String(n.numero);
    serie.value = n.serie;
    emissao.value = n.emissao.slice(0, 10);
    avisos.value = [t('suprimentos.notas.xmlLido', { nome: n.nomeEmitente, n: n.itens.length })];
  } catch (x) {
    erro.value = x;
  }
}
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await registrarNota(
      {
        fornecedor: Number(fornecedor.value),
        numero: Number(numeroNota.value),
        serie: serie.value.trim() || '1',
        emissao: emissao.value,
        local: Number(local.value),
        ...(numero(desconto.value || '0') > 0 ? { desconto: numero(desconto.value) } : {}),
        ...(numero(frete.value || '0') > 0 ? { frete: numero(frete.value) } : {}),
        ...(Number(pedidoDoc.value) > 0
          ? { pedido: { ano: Number(pedidoAno.value), doc: Number(pedidoDoc.value) } }
          : {}),
        ...(aprovacao.value.trim() ? { aprovacaoComprador: aprovacao.value.trim() } : {}),
        itens: linhas.value.map((l) => ({
          item: l.item,
          quantidade: numero(l.quantidade),
          valorUnitario: numero(l.unitario),
          ...(numero(l.fator || '0') > 0 ? { fator: numero(l.fator) } : {}),
          ...(l.marca.trim() ? { marca: l.marca.trim() } : {}),
          lotes: l.lotes
            .filter((x) => x.lote.trim())
            .map((x) => ({ lote: x.lote.trim(), validade: x.validade, quantidade: numero(x.quantidade) })),
        })),
      },
      novaChave('nota'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    linhas.value = [];
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
const { filtro, pagina, lista, haSeguinte } = usarListaDocumentos('nota');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nf-titulo" data-testid="tela-suprimentos-notas">
    <h1 id="nf-titulo">{{ t('suprimentos.notas.titulo') }}</h1>
    <p>{{ t('suprimentos.notas.texto') }}</p>
    <AvisoSuprimentos
      :motivo="pode('suprimentos.registrarEntradaNF') ? null : motivo('suprimentos.registrarEntradaNF')"
    />
    <form class="painel" data-testid="nf-form" @submit.prevent="gravar">
      <span class="campo">
        <label for="nf-xml">{{ t('suprimentos.notas.xml') }}</label>
        <input id="nf-xml" type="file" accept=".xml,text/xml" data-testid="nf-xml" @change="carregarXml" />
      </span>
      <p v-if="motivoFuncionalidade('suprimentos.notaFiscal')" class="secundario">
        {{ motivoFuncionalidade('suprimentos.notaFiscal') }}
      </p>
      <div class="filtros">
        <span class="campo">
          <label for="nf-forn">{{ t('suprimentos.notas.fornecedor') }}</label>
          <input id="nf-forn" v-model="fornecedor" inputmode="numeric" data-testid="nf-fornecedor" />
        </span>
        <span class="campo">
          <label for="nf-num">{{ t('suprimentos.notas.numero') }}</label>
          <input id="nf-num" v-model="numeroNota" inputmode="numeric" data-testid="nf-numero" />
        </span>
        <span class="campo">
          <label for="nf-serie">{{ t('suprimentos.notas.serie') }}</label>
          <input id="nf-serie" v-model="serie" size="3" data-testid="nf-serie" />
        </span>
        <span class="campo">
          <label for="nf-emissao">{{ t('suprimentos.notas.emissao') }}</label>
          <input id="nf-emissao" v-model="emissao" type="date" data-testid="nf-emissao" />
        </span>
      </div>
      <SanteSelecao
        v-model="local"
        :rotulo="t('suprimentos.notas.localRecebe')"
        :opcoes="opcoesLocais"
        data-testid="nf-local"
      />
      <div class="filtros">
        <span class="campo">
          <label for="nf-pano">{{ t('suprimentos.notas.pedidoAno') }}</label>
          <input id="nf-pano" v-model="pedidoAno" inputmode="numeric" size="5" data-testid="nf-pedido-ano" />
        </span>
        <span class="campo">
          <label for="nf-pdoc">{{ t('suprimentos.notas.pedido') }}</label>
          <input id="nf-pdoc" v-model="pedidoDoc" inputmode="numeric" data-testid="nf-pedido" />
        </span>
        <span class="campo">
          <label for="nf-desc">{{ t('suprimentos.notas.desconto') }}</label>
          <input id="nf-desc" v-model="desconto" inputmode="decimal" />
        </span>
        <span class="campo">
          <label for="nf-frete">{{ t('suprimentos.notas.frete') }}</label>
          <input id="nf-frete" v-model="frete" inputmode="decimal" />
        </span>
      </div>
      <BuscaItem testid="nf-busca" @escolher="incluir" />
      <table v-if="linhas.length" class="tabela" data-testid="nf-itens">
        <caption>
          {{
            t('suprimentos.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.cotacao.unitario') }}</th>
            <th scope="col">{{ t('suprimentos.notas.fator') }}</th>
            <th scope="col">{{ t('suprimentos.cotacao.marca') }}</th>
            <th scope="col">{{ t('suprimentos.lotes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, k) in linhas" :key="l.item" :data-testid="`nf-linha-${l.item}`">
            <td>
              {{ l.item }} · {{ l.nome }}
              <SanteBotao
                variante="texto"
                :rotulo="t('suprimentos.retirar')"
                @acionar="linhas.splice(k, 1)"
              />
            </td>
            <td>
              <label :for="`nf-q-${l.item}`" class="sgh-visualmente-oculto">{{
                t('suprimentos.quantidade')
              }}</label>
              <input
                :id="`nf-q-${l.item}`"
                v-model="l.quantidade"
                inputmode="decimal"
                size="6"
                :data-testid="`nf-qtde-${l.item}`"
              />
            </td>
            <td>
              <label :for="`nf-u-${l.item}`" class="sgh-visualmente-oculto">{{
                t('suprimentos.cotacao.unitario')
              }}</label>
              <input
                :id="`nf-u-${l.item}`"
                v-model="l.unitario"
                inputmode="decimal"
                size="8"
                :data-testid="`nf-unitario-${l.item}`"
              />
            </td>
            <td>
              <label :for="`nf-f-${l.item}`" class="sgh-visualmente-oculto">{{
                t('suprimentos.notas.fator')
              }}</label>
              <input
                :id="`nf-f-${l.item}`"
                v-model="l.fator"
                inputmode="decimal"
                size="4"
                :data-testid="`nf-fator-${l.item}`"
              />
            </td>
            <td>
              <label :for="`nf-m-${l.item}`" class="sgh-visualmente-oculto">{{
                t('suprimentos.cotacao.marca')
              }}</label>
              <input :id="`nf-m-${l.item}`" v-model="l.marca" size="10" />
            </td>
            <td>
              <div v-for="(x, j) in l.lotes" :key="j" class="filtros">
                <span class="campo">
                  <label :for="`nf-l-${l.item}-${j}`">{{ t('suprimentos.lote') }}</label>
                  <input
                    :id="`nf-l-${l.item}-${j}`"
                    v-model="x.lote"
                    size="10"
                    :data-testid="`nf-lote-${l.item}-${j}`"
                  />
                </span>
                <span class="campo">
                  <label :for="`nf-v-${l.item}-${j}`">{{ t('suprimentos.validade') }}</label>
                  <input
                    :id="`nf-v-${l.item}-${j}`"
                    v-model="x.validade"
                    type="date"
                    :data-testid="`nf-validade-${l.item}-${j}`"
                  />
                </span>
                <span class="campo">
                  <label :for="`nf-lq-${l.item}-${j}`">{{ t('suprimentos.quantidade') }}</label>
                  <input
                    :id="`nf-lq-${l.item}-${j}`"
                    v-model="x.quantidade"
                    inputmode="decimal"
                    size="6"
                    :data-testid="`nf-lote-qtde-${l.item}-${j}`"
                  />
                </span>
              </div>
              <SanteBotao
                v-if="l.rastreavel"
                variante="texto"
                :rotulo="t('suprimentos.notas.maisLote')"
                :data-testid="`nf-mais-lote-${l.item}`"
                @acionar="l.lotes.push({ lote: '', validade: '', quantidade: '' })"
              />
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="linhas.length">{{ t('suprimentos.notas.totalItens') }} {{ reais(total) }}</p>
      <span class="campo">
        <label for="nf-aprov">{{ t('suprimentos.notas.aprovacao') }}</label>
        <input id="nf-aprov" v-model="aprovacao" data-testid="nf-aprovacao" />
      </span>
      <SanteBotao
        v-if="pode('suprimentos.registrarEntradaNF')"
        tipo="submit"
        :rotulo="t('suprimentos.notas.gravar')"
        :desabilitado="!local || !fornecedor || !numeroNota || linhas.length === 0"
        data-testid="nf-gravar"
      />
    </form>
    <p v-if="mensagem" role="status" data-testid="nf-mensagem">{{ mensagem }}</p>
    <ul v-if="avisos.length" data-testid="nf-avisos">
      <li v-for="(a, k) in avisos" :key="k">{{ a }}</li>
    </ul>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <h2>{{ t('suprimentos.notas.lista') }}</h2>
    <FiltroDocumentos
      v-model:filtro="filtro"
      v-model:pagina="pagina"
      prefixo="notas"
      :ha-seguinte="haSeguinte"
    />
    <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <ul v-else data-testid="nf-lista">
      <li v-for="d in lista.data.value.itens" :key="d.id">
        <RouterLink :to="`/suprimentos/documentos/nota/${d.chave.ano}/${d.chave.mes}/${d.chave.doc}`">{{
          chaveDoc(d.chave)
        }}</RouterLink>
        · {{ data(d.data) }} · {{ nomeLocal(d.local) }}
        <template v-if="d.nota">
          · {{ d.nota.fornecedorNome }} · {{ t('suprimentos.notas.numero') }} {{ d.nota.numero }}/{{
            d.nota.serie
          }}</template
        >
        · {{ reais(d.valor) }}
      </li>
    </ul>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
