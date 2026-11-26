<script setup lang="ts">
// Entrada por nota fiscal (ficha do M28, seção 7; regras 8 e 12): `/suprimentos/notas-fiscais`. O fornecedor, o
// número, a série, a emissão, o local e o pedido ligado (opcional); os itens com quantidade, unitário, fator da
// unidade de compra, marca e os lotes (validade obrigatória e não passada); o XML da NF-e pré-preenche. A conferência
// contra o pedido aplica as tolerâncias dos parâmetros; fora delas, a nota só consolida com a aprovação do comprador
// (o texto vai junto). O saldo, o lote no local e o custo médio são do banco.
// C2-038 (05-SUP linha 21): o XML traz os impostos por item e as despesas (frete, seguro, outras, desconto); cada item
// do estoque é ligado à linha do XML (quantidade, unitário, lotes e impostos vêm dela). O custo de entrada de cada item
// aparece na hora pela regra do domínio; a nota pode usar a conferência física validada da entrega.
import { custoEntradaNota } from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type ConferenciaResumoTela,
  type ImpostoXmlTela,
  lerXmlNotaCompleta,
  listarConferencias,
  type NotaXmlCompletaTela,
} from '../api-conferencia-recebimento.js';
import { novaChave, registrarNota } from '../api-suprimentos.js';
import { TRIBUTOS_ROTULO, textoConferencia as kc } from '../i18n-conferencia-recebimento.js';
import { mensagensEntradaDoacao as kd } from '../i18n-entrada-doacao.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import type { LeituraCodigo as Leitura } from '../api-etiqueta.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import LeituraCodigo from '../componentes/LeituraCodigo.vue';
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
  /** C2-038: a linha do XML ligada ('' = nenhuma) e os impostos dela. */
  xml: string;
  impostos: ImpostoXmlTela[];
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
const seguro = ref('');
const outros = ref('');
const notaXml = ref<NotaXmlCompletaTela | null>(null);
const conferencia = ref('');
const conferencias = ref<ConferenciaResumoTela[]>([]);
onMounted(async () => {
  try {
    conferencias.value = (await listarConferencias('validada')).filter((c) => c.nota === null);
  } catch {
    conferencias.value = [];
  }
});
const opcoesConferencias = computed(() => [
  { valor: '', rotulo: kc('semConferencia') },
  ...conferencias.value
    .filter((c) => !fornecedor.value || c.fornecedor === Number(fornecedor.value))
    .map((c) => ({ valor: String(c.id), rotulo: `${c.id} · ${c.fornecedorNome} · ${c.localNome}` })),
]);
const opcoesXml = computed(() => [
  { valor: '', rotulo: kc('semLigacao') },
  ...(notaXml.value?.itens ?? []).map((x, k) => ({
    valor: String(k),
    rotulo: `${k + 1} · ${x.codigoFornecedor} · ${x.descricao}`,
  })),
]);
/** Liga o item do estoque à linha do XML: quantidade, unitário, lotes e impostos vêm dela. */
function ligar(l: LinhaNota, v: string): void {
  l.xml = v;
  const x = v === '' ? null : notaXml.value?.itens[Number(v)];
  l.impostos = x ? [...x.impostos] : [];
  if (!x) return;
  l.quantidade = String(x.quantidade);
  l.unitario = String(x.valorUnitario);
  if (l.rastreavel && x.lotes.length)
    l.lotes = x.lotes.map((y) => ({ lote: y.lote, validade: y.validade, quantidade: String(y.quantidade) }));
}
/** Um imposto do item: tributo, base × alíquota = valor e o CST. */
const textoImposto = (i: ImpostoXmlTela): string =>
  kc('impostoLinha', {
    tributo: TRIBUTOS_ROTULO[i.tributo] ?? i.tributo,
    base: reais(i.base),
    aliquota: i.aliquota,
    valor: reais(i.valor),
    cst: i.cst ?? '—',
  });
/** O custo de entrada na hora, pela regra do domínio (prévia pelo padrão do hospital). */
const custo = computed(() =>
  custoEntradaNota(
    linhas.value.map((l) => {
      const q = numero(l.quantidade || '0') || 0;
      const f = numero(l.fator || '0') || 0;
      return {
        quantidade: q,
        valorUnitario: numero(l.unitario || '0') || 0,
        quantidadeEstoque: f > 0 ? q * f : q,
        impostos: l.impostos,
      };
    }),
    {
      desconto: numero(desconto.value || '0') || 0,
      frete: numero(frete.value || '0') || 0,
      seguro: numero(seguro.value || '0') || 0,
      outros: numero(outros.value || '0') || 0,
    },
  ),
);
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
    xml: '',
    impostos: [],
  });
}
/** A leitura do código da embalagem: inclui o item e preenche o lote e a validade lidos (soma a quantidade). */
function lido(r: Leitura): void {
  incluir(r.item);
  const l = linhas.value.find((x) => x.item === r.item.codigo);
  if (!l) return;
  l.quantidade = String((numero(l.quantidade || '0') || 0) + r.quantidade);
  if (!r.lote || !l.rastreavel) return;
  const mesmo = l.lotes.find((x) => x.lote === r.lote);
  const vazio = l.lotes.find((x) => !x.lote);
  const alvo = mesmo ?? vazio;
  if (alvo) {
    alvo.lote = r.lote;
    alvo.validade = r.validade ?? alvo.validade;
    alvo.quantidade = String((numero(alvo.quantidade || '0') || 0) + r.quantidade);
  } else l.lotes.push({ lote: r.lote, validade: r.validade ?? '', quantidade: String(r.quantidade) });
}
async function carregarXml(ev: Event): Promise<void> {
  const arquivo = (ev.target as HTMLInputElement).files?.[0];
  if (!arquivo) return;
  erro.value = null;
  try {
    const n = await lerXmlNotaCompleta(await arquivo.text());
    notaXml.value = n;
    numeroNota.value = String(n.numero);
    serie.value = n.serie;
    emissao.value = n.emissao.slice(0, 10);
    const texto = (v: number) => (v > 0 ? String(v) : '');
    frete.value = texto(n.frete);
    seguro.value = texto(n.seguro);
    outros.value = texto(n.outros);
    desconto.value = texto(n.desconto);
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
        ...(numero(seguro.value || '0') > 0 ? { seguro: numero(seguro.value) } : {}),
        ...(numero(outros.value || '0') > 0 ? { outros: numero(outros.value) } : {}),
        ...(Number(conferencia.value) > 0 ? { conferencia: Number(conferencia.value) } : {}),
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
          impostos: l.impostos.map((i) => ({
            tributo: i.tributo,
            base: i.base,
            aliquota: i.aliquota,
            valor: i.valor,
            cst: i.cst,
          })),
        })),
      },
      novaChave('nota'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    linhas.value = [];
    notaXml.value = null;
    conferencia.value = '';
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
    <RouterLink to="/suprimentos/notas-fiscais/conferencias" data-testid="nf-conferencias">{{
      kc('atalho')
    }}</RouterLink>
    · <RouterLink to="/suprimentos/doacoes" data-testid="nf-doacoes">{{ kd.atalho }}</RouterLink>
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
          <input id="nf-frete" v-model="frete" inputmode="decimal" data-testid="nf-frete" />
        </span>
        <span class="campo">
          <label for="nf-seguro">{{ kc('seguro') }}</label>
          <input id="nf-seguro" v-model="seguro" inputmode="decimal" data-testid="nf-seguro" />
        </span>
        <span class="campo">
          <label for="nf-outros">{{ kc('outros') }}</label>
          <input id="nf-outros" v-model="outros" inputmode="decimal" data-testid="nf-outros" />
        </span>
      </div>
      <SanteSelecao
        v-model="conferencia"
        :rotulo="kc('conferenciaDaNota')"
        :opcoes="opcoesConferencias"
        data-testid="nf-conferencia"
      />
      <LeituraCodigo testid="nf-leitura" @lido="lido" />
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
            <th scope="col">{{ kc('impostos') }}</th>
            <th scope="col">{{ kc('custoUnitario') }}</th>
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
            <td>
              <SanteSelecao
                v-if="notaXml"
                :model-value="l.xml"
                :rotulo="kc('ligarXml')"
                :opcoes="opcoesXml"
                :data-testid="`nf-xml-linha-${l.item}`"
                @update:model-value="(v: string) => ligar(l, v)"
              />
              <ul v-if="l.impostos.length" :data-testid="`nf-impostos-${l.item}`">
                <li v-for="i in l.impostos" :key="i.tributo">
                  {{ textoImposto(i) }}
                </li>
              </ul>
              <span v-else class="secundario">{{ kc('semImposto') }}</span>
            </td>
            <td :data-testid="`nf-custo-${l.item}`">
              {{ reais(custo.itens[k]?.custoUnitario ?? 0) }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="linhas.length">{{ t('suprimentos.notas.totalItens') }} {{ reais(total) }}</p>
      <template v-if="linhas.length">
        <p data-testid="nf-total-nota">{{ kc('totalNota', { valor: reais(custo.valorTotal) }) }}</p>
        <p data-testid="nf-custo-entrada">{{ kc('custoEntrada') }}: {{ reais(custo.custoTotal) }}</p>
        <p class="secundario">{{ kc('custoPrevia') }}</p>
      </template>
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
