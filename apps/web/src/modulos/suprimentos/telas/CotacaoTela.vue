<script setup lang="ts">
// Mapa de cotação (ficha do M28, seção 7; regra 11): `/suprimentos/pedidos/:ano/:doc/cotacao`. Por item do pedido,
// as propostas dos fornecedores (preço e marca registráveis), o vencedor nominal (rateio com mais de um é legítimo;
// vazio não é "não"), quem escolheu, quando e por quê (justificativa exigida quando o vencedor não é o menor preço ou
// há rateio) e o histórico do portal em leitura. A linha mestre do item nunca é proposta.
import type { PropostaLida } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { definirVencedor, lerPedido, novaChave, registrarProposta } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { numero, qtd, quando, reais, usarSuprimentos } from '../usar-suprimentos.js';

const props = defineProps<{ ano: string; doc: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo } = usarSuprimentos();
const chave = computed(() => ({ ano: Number(props.ano), doc: Number(props.doc) }));
const pedido = useQuery({
  queryKey: computed(() => ['suprimentos', 'pedido', chave.value.ano, chave.value.doc]),
  queryFn: () => lerPedido(chave.value.ano, chave.value.doc),
});
const precos = ref<Record<number, string>>({});
const marcas = ref<Record<number, string>>({});
const escolhidas = ref<Record<number, boolean>>({});
const justificativas = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const propostasDe = (item: number, seq: number) =>
  (pedido.data.value?.propostas ?? []).filter((p) => p.item === item && p.seq === seq);
const escolhaDe = (item: number, seq: number) =>
  pedido.data.value?.escolhas.filter((e) => e.item === item && e.seq === seq) ?? [];
const vencedor = (p: PropostaLida) =>
  p.vencedor === 'T' ? t('suprimentos.sim') : p.vencedor === 'F' ? t('suprimentos.nao') : '—';

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['suprimentos', 'pedido'] });
  await cliente.invalidateQueries({ queryKey: ['suprimentos', 'pedidos'] });
}
async function gravarProposta(p: PropostaLida): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const marca = (marcas.value[p.id] ?? '').trim();
    const r = await registrarProposta(
      chave.value,
      p.id,
      { valorUnitario: numero(precos.value[p.id] ?? String(p.valorUnitario)), ...(marca ? { marca } : {}) },
      novaChave('proposta'),
    );
    mensagem.value = r.mensagem;
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}
async function escolher(item: number, seq: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const vencedoras = propostasDe(item, seq)
      .filter((p) => escolhidas.value[p.id])
      .map((p) => p.id);
    const j = (justificativas.value[`${item}-${seq}`] ?? '').trim();
    const r = await definirVencedor(
      chave.value,
      { item, seq, vencedoras, ...(j ? { justificativa: j } : {}) },
      novaChave('vencedor'),
    );
    mensagem.value = r.mensagem;
    escolhidas.value = {};
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cot-titulo" data-testid="tela-suprimentos-cotacao">
    <h1 id="cot-titulo">{{ t('suprimentos.cotacao.mapa', { n: `${doc}/${ano}` }) }}</h1>
    <RouterLink to="/suprimentos/pedidos">{{ t('suprimentos.cotacao.voltar') }}</RouterLink>
    <AvisoSuprimentos
      :motivo="
        pode('suprimentos.definirVencedorCotacao') ? null : motivo('suprimentos.definirVencedorCotacao')
      "
    />
    <ErroSuprimentos v-if="pedido.error.value" :erro="pedido.error.value" />
    <p v-else-if="!pedido.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <p>
        {{ pedido.data.value.situacaoRotulo }} · {{ pedido.data.value.centroCustoNome }} ·
        {{ t('suprimentos.valor') }} {{ reais(pedido.data.value.valor.total) }}
        <template v-if="pedido.data.value.valor.parcelas.length > 1"
          >({{ pedido.data.value.valor.parcelas.map(reais).join(' + ') }})</template
        >
      </p>
      <div
        v-for="i in pedido.data.value.itensDetalhe"
        :key="i.id"
        class="painel"
        :data-testid="`cot-item-${i.item}`"
      >
        <h2>{{ i.item }} · {{ i.nome }} · {{ qtd(i.quantidade) }}</h2>
        <p class="secundario">
          {{ t('suprimentos.cotacao.comprada') }} {{ qtd(i.comprada) }} · {{ i.estadoRotulo }}
        </p>
        <table class="tabela">
          <caption>
            {{
              t('suprimentos.cotacao.propostas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('suprimentos.cotacao.vence') }}</th>
              <th scope="col">{{ t('suprimentos.fornecedor') }}</th>
              <th scope="col">{{ t('suprimentos.cotacao.unitario') }}</th>
              <th scope="col">{{ t('suprimentos.cotacao.marca') }}</th>
              <th scope="col">{{ t('suprimentos.cotacao.vencedorAtual') }}</th>
              <th scope="col">{{ t('suprimentos.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in propostasDe(i.item, i.seq)"
              :key="p.id"
              :data-testid="`cot-proposta-${p.fornecedor}`"
            >
              <td>
                <input
                  :id="`cot-esc-${p.id}`"
                  v-model="escolhidas[p.id]"
                  type="checkbox"
                  :data-testid="`cot-escolher-${i.item}-${p.fornecedor}`"
                />
                <label :for="`cot-esc-${p.id}`" class="sgh-visualmente-oculto"
                  >{{ t('suprimentos.cotacao.vence') }} {{ p.fornecedorNome }}</label
                >
              </td>
              <td>{{ p.fornecedorNome }}</td>
              <td>
                <label :for="`cot-preco-${p.id}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.cotacao.unitario')
                }}</label>
                <input
                  :id="`cot-preco-${p.id}`"
                  v-model="precos[p.id]"
                  :placeholder="String(p.valorUnitario)"
                  inputmode="decimal"
                  :data-testid="`cot-preco-${i.item}-${p.fornecedor}`"
                />
              </td>
              <td>
                <label :for="`cot-marca-${p.id}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.cotacao.marca')
                }}</label>
                <input :id="`cot-marca-${p.id}`" v-model="marcas[p.id]" :placeholder="p.marca" />
              </td>
              <td>{{ vencedor(p) }}</td>
              <td>
                <SanteBotao
                  v-if="pode('suprimentos.registrarProposta')"
                  variante="secundario"
                  :rotulo="t('suprimentos.cotacao.gravarProposta')"
                  :data-testid="`cot-gravar-${i.item}-${p.fornecedor}`"
                  @acionar="gravarProposta(p)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <span class="campo">
          <label :for="`cot-just-${i.item}`">{{ t('suprimentos.cotacao.justificativa') }}</label>
          <input
            :id="`cot-just-${i.item}`"
            v-model="justificativas[`${i.item}-${i.seq}`]"
            :data-testid="`cot-justificativa-${i.item}`"
          />
        </span>
        <SanteBotao
          v-if="pode('suprimentos.definirVencedorCotacao')"
          :rotulo="t('suprimentos.cotacao.definir')"
          :data-testid="`cot-definir-${i.item}`"
          @acionar="escolher(i.item, i.seq)"
        />
        <ul v-if="escolhaDe(i.item, i.seq).length" class="secundario">
          <li v-for="(e, k) in escolhaDe(i.item, i.seq)" :key="k">
            {{ t('suprimentos.cotacao.escolhidoPor', { autor: e.autor, em: quando(e.em) }) }}
            <template v-if="e.rateio"> · {{ t('suprimentos.cotacao.rateio') }}</template>
            <template v-if="e.justificativa"> · {{ e.justificativa }}</template>
          </li>
        </ul>
      </div>
      <h2>{{ t('suprimentos.cotacao.portal') }}</h2>
      <ul v-if="pedido.data.value.portal.length">
        <li v-for="(x, k) in pedido.data.value.portal" :key="k">
          {{ x.portal }} · {{ quando(x.enviadoEm) }}
        </li>
      </ul>
      <p v-else>{{ t('suprimentos.cotacao.semPortal') }}</p>
    </template>
    <p v-if="mensagem" role="status" data-testid="cot-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
