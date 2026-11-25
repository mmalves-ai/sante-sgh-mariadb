<script setup lang="ts">
// Necessidades e pedidos de compra (ficha do M28, seção 7; regra 11): `/suprimentos/pedidos`; e a entrada do mapa de
// cotação (`/suprimentos/cotacao`, modo "cotacao"). Lista os pedidos do ano por situação; cria o pedido (o centro de
// custo, os itens e os fornecedores convidados: a linha mestre de cada item e uma proposta por fornecedor); o número
// e os valores derivados são do banco. Itens sugeridos pelo ponto de pedido chegam pela tela de sugestão.
import { mensagensPedidoGestao as M } from '../i18n-pedido-gestao.js';
import { type ContratoDoVinculo, TIPOS_COMPRA } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { criarPedido, listarPedidos, novaChave } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import BuscaItem from '../componentes/BuscaItem.vue';
import EscolhaContrato from '../componentes/EscolhaContrato.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { data, numero, reais, usarSuprimentos } from '../usar-suprimentos.js';
import EnviarParaAprovacao from '../../financeiro/componentes/EnviarParaAprovacao.vue';

const props = withDefaults(defineProps<{ modo?: 'pedidos' | 'cotacao' }>(), { modo: 'pedidos' });
const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivo, centros } = usarSuprimentos();
const ano = ref(String(new Date().getFullYear()));
const situacao = ref('');
const lista = useQuery({
  queryKey: computed(() => ['suprimentos', 'pedidos', ano.value, situacao.value]),
  queryFn: () =>
    listarPedidos({ ano: Number(ano.value), situacao: situacao.value ? Number(situacao.value) : null }),
});
const situacoes = computed(() => [
  { valor: '', rotulo: t('suprimentos.todos') },
  ...(apoio.data.value?.situacoesPedido ?? []).map((s) => ({ valor: String(s.id), rotulo: s.rotulo })),
]);

// Novo pedido
const centroCusto = ref('');
const tipoCompra = ref('P');
const fornecedores = ref('');
const itens = ref<{ item: number; nome: string; quantidade: string }[]>([]);
// M55 (etapa 3): o pedido de um só fornecedor pode consumir um contrato dele (o vínculo na mesma transação).
const convidados = computed(() => [
  ...new Set(
    fornecedores.value
      .split(/[,; ]+/)
      .map((x) => Number(x))
      .filter((x) => x > 0),
  ),
]);
const fornecedorUnico = computed(() => (convidados.value.length === 1 ? convidados.value[0]! : null));
const contrato = ref<ContratoDoVinculo | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoesCentros = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...centros.value.map((c) => ({ valor: String(c.codigo), rotulo: `${c.codigo} · ${c.nome}` })),
]);
const tipos = TIPOS_COMPRA.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
async function criar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await criarPedido(
      {
        centroCusto: Number(centroCusto.value),
        tipoCompra: tipoCompra.value,
        fornecedores: convidados.value,
        itens: itens.value.map((i) => ({ item: i.item, quantidade: numero(i.quantidade) })),
        ...(contrato.value && fornecedorUnico.value !== null ? { contrato: contrato.value } : {}),
      },
      novaChave('pedido'),
    );
    mensagem.value = r.mensagem;
    itens.value = [];
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'pedidos'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ped-titulo" data-testid="tela-suprimentos-pedidos">
    <h1 id="ped-titulo">
      {{ props.modo === 'cotacao' ? t('suprimentos.cotacao.titulo') : t('suprimentos.pedidos.titulo') }}
    </h1>
    <p>{{ props.modo === 'cotacao' ? t('suprimentos.cotacao.texto') : t('suprimentos.pedidos.texto') }}</p>
    <div class="filtros">
      <span class="campo">
        <label for="ped-ano">{{ t('suprimentos.ano') }}</label>
        <input id="ped-ano" v-model="ano" inputmode="numeric" data-testid="ped-ano" />
      </span>
      <SanteSelecao v-model="situacao" :rotulo="t('suprimentos.pedidos.situacao')" :opcoes="situacoes" />
    </div>
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <table v-else class="tabela" data-testid="ped-lista">
      <caption>
        {{
          t('suprimentos.pedidos.lista')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('suprimentos.pedidos.numero') }}</th>
          <th scope="col">{{ t('suprimentos.data') }}</th>
          <th scope="col">{{ t('suprimentos.pedidos.situacao') }}</th>
          <th scope="col">{{ t('suprimentos.centroCusto') }}</th>
          <th scope="col">{{ t('suprimentos.itens') }}</th>
          <th scope="col">{{ t('suprimentos.valor') }}</th>
          <th scope="col">{{ t('suprimentos.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`ped-${p.ano}-${p.doc}`">
          <td>{{ p.doc }}/{{ p.ano }}</td>
          <td>{{ data(p.data) }}</td>
          <td>
            {{ p.situacaoRotulo }}
            <span v-if="p.aprovacao" class="secundario">
              ·
              {{
                p.aprovacao.decisao === 'aprovado'
                  ? t('suprimentos.aprovacoes.aprovado')
                  : t('suprimentos.aprovacoes.reprovado')
              }}</span
            >
          </td>
          <td>{{ p.centroCustoNome }}</td>
          <td>{{ p.itens }} · {{ t('suprimentos.pedidos.nFornecedores', { n: p.fornecedores }) }}</td>
          <td>
            {{ reais(p.valor.total) }}
            <span v-if="p.valor.parcelas.length > 1" class="secundario">
              ({{ p.valor.parcelas.map(reais).join(' + ') }})</span
            >
          </td>
          <td>
            <RouterLink
              :to="`/suprimentos/pedidos/${p.ano}/${p.doc}/cotacao`"
              :data-testid="`ped-cotacao-${p.ano}-${p.doc}`"
              >{{ t('suprimentos.cotacao.abrir') }}</RouterLink
            >
            ·
            <RouterLink
              :to="`/suprimentos/pedidos/${p.ano}/${p.doc}/acompanhar`"
              :data-testid="`ped-acompanhar-${p.ano}-${p.doc}`"
              >{{ M.acompanhar }}</RouterLink
            >
            <!-- F8, 07-FIN linha 65: envia o pedido ao fluxo de aprovação configurável. -->
            <EnviarParaAprovacao tipo="pedido_compra" :documento="p.id" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="lista.data.value?.cortada" role="status">{{ t('suprimentos.cortada') }}</p>

    <form v-if="props.modo === 'pedidos'" class="painel" data-testid="ped-novo" @submit.prevent="criar">
      <h2>{{ t('suprimentos.pedidos.novo') }}</h2>
      <AvisoSuprimentos
        :motivo="pode('suprimentos.criarPedido') ? null : motivo('suprimentos.criarPedido')"
      />
      <SanteSelecao
        v-model="centroCusto"
        :rotulo="t('suprimentos.centroCusto')"
        :opcoes="opcoesCentros"
        data-testid="ped-centro"
      />
      <SanteSelecao v-model="tipoCompra" :rotulo="t('suprimentos.pedidos.tipoCompra')" :opcoes="tipos" />
      <span class="campo">
        <label for="ped-forn">{{ t('suprimentos.pedidos.fornecedores') }}</label>
        <input id="ped-forn" v-model="fornecedores" data-testid="ped-fornecedores" />
      </span>
      <EscolhaContrato v-model="contrato" :fornecedor="fornecedorUnico" testid="ped-contrato" />
      <BuscaItem
        testid="ped-busca"
        @escolher="
          (i) =>
            !itens.some((x) => x.item === i.codigo) &&
            itens.push({ item: i.codigo, nome: i.nome, quantidade: '' })
        "
      />
      <table v-if="itens.length" class="tabela" data-testid="ped-itens">
        <caption>
          {{
            t('suprimentos.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(i, k) in itens" :key="i.item">
            <td>{{ i.item }} · {{ i.nome }}</td>
            <td>
              <label :for="`ped-qtde-${i.item}`" class="sgh-visualmente-oculto">{{
                t('suprimentos.quantidade')
              }}</label>
              <input
                :id="`ped-qtde-${i.item}`"
                v-model="i.quantidade"
                inputmode="decimal"
                :data-testid="`ped-qtde-${i.item}`"
              />
            </td>
            <td>
              <SanteBotao variante="texto" :rotulo="t('suprimentos.retirar')" @acionar="itens.splice(k, 1)" />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="pode('suprimentos.criarPedido')"
        tipo="submit"
        :rotulo="t('suprimentos.pedidos.criar')"
        :desabilitado="!centroCusto || itens.length === 0"
        data-testid="ped-criar"
      />
      <p v-if="mensagem" role="status" data-testid="ped-mensagem">{{ mensagem }}</p>
      <ErroSuprimentos v-if="erro" :erro="erro" />
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
