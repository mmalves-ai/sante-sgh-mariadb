<script setup lang="ts">
// Ponto de pedido e sugestão de compra (ficha do M28, seção 7; regra 15): `/suprimentos/sugestao-compra`. Por local:
// saldo, em pedido, consumo médio mensal, estoque de segurança, ponto de pedido, sugestão e as curvas ABC e XYZ (o
// cálculo é do servidor, pelos parâmetros); o prazo e o estoque de segurança por item são gravados no novo; os itens
// marcados viram um pedido de compra (o mesmo caminho do pedido).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { definirPontoPedido, gerarPedidoDaSugestao, lerSugestao, novaChave } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { numero, qtd, quando, reais, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { locais, centros, pode, motivo } = usarSuprimentos();
const local = ref('');
const centroCusto = ref('');
const marcados = ref<Record<number, boolean>>({});
const prazos = ref<Record<number, string>>({});
const segurancas = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('suprimentos.todos') },
  ...locais.value.map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesCentros = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...centros.value.map((c) => ({ valor: String(c.codigo), rotulo: `${c.codigo} · ${c.nome}` })),
]);
const s = useQuery({
  queryKey: computed(() => ['suprimentos', 'sugestao', local.value]),
  queryFn: () => lerSugestao(local.value ? Number(local.value) : null),
});
async function gravarPonto(item: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const seg = (segurancas.value[item] ?? '').trim();
    const r = await definirPontoPedido(
      {
        item,
        local: Number(local.value),
        prazoDias: Math.trunc(numero(prazos.value[item] ?? '0')),
        ...(seg ? { estoqueSeguranca: numero(seg) } : {}),
      },
      novaChave('ponto'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'sugestao'] });
  } catch (x) {
    erro.value = x;
  }
}
async function gerar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const itens = (s.data.value?.itens ?? [])
      .filter((i) => marcados.value[i.item] && i.sugestao > 0)
      .map((i) => ({ item: i.item, quantidade: i.sugestao }));
    const r = await gerarPedidoDaSugestao(
      { centroCusto: Number(centroCusto.value), itens },
      novaChave('sugestao'),
    );
    mensagem.value = r.mensagem;
    marcados.value = {};
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sug-titulo" data-testid="tela-suprimentos-sugestao">
    <h1 id="sug-titulo">{{ t('suprimentos.sugestao.titulo') }}</h1>
    <p>{{ t('suprimentos.sugestao.texto') }}</p>
    <AvisoSuprimentos :motivo="pode('suprimentos.criarPedido') ? null : motivo('suprimentos.criarPedido')" />
    <SanteSelecao
      v-model="local"
      :rotulo="t('suprimentos.local')"
      :opcoes="opcoesLocais"
      data-testid="sug-local"
    />
    <ErroSuprimentos v-if="s.error.value" :erro="s.error.value" />
    <p v-else-if="!s.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <p class="secundario">
        {{ t('suprimentos.sugestao.base', { n: s.data.value.meses, em: quando(s.data.value.calculadoEm) }) }}
        · {{ t('suprimentos.valor') }} {{ reais(s.data.value.valor.total) }}
        <template v-if="s.data.value.valor.parcelas.length > 1"
          >({{ s.data.value.valor.parcelas.map(reais).join(' + ') }})</template
        >
      </p>
      <table class="tabela" data-testid="sug-tabela">
        <caption>
          {{
            t('suprimentos.sugestao.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.sugestao.marcar') }}</th>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.saldo') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.emPedido') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.media') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.seguranca') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.ponto') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.sugestao') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.curvas') }}</th>
            <th scope="col">{{ t('suprimentos.sugestao.prazo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in s.data.value.itens" :key="i.item" :data-testid="`sug-item-${i.item}`">
            <td>
              <input
                :id="`sug-m-${i.item}`"
                v-model="marcados[i.item]"
                type="checkbox"
                :disabled="i.sugestao <= 0"
              />
              <label :for="`sug-m-${i.item}`" class="sgh-visualmente-oculto"
                >{{ t('suprimentos.sugestao.marcar') }} {{ i.nome }}</label
              >
            </td>
            <td>{{ i.item }} · {{ i.nome }}</td>
            <td>{{ qtd(i.saldo) }}</td>
            <td>{{ qtd(i.emPedido) }}</td>
            <td>{{ qtd(i.mediaMensal) }}</td>
            <td>{{ qtd(i.estoqueSeguranca) }}</td>
            <td>{{ qtd(i.pontoPedido) }}</td>
            <td>
              <strong>{{ qtd(i.sugestao) }}</strong> · {{ reais(i.sugestao * i.custo) }}
            </td>
            <td>{{ i.curvaAbc }}{{ i.curvaXyz }}</td>
            <td>
              <template v-if="local">
                <label :for="`sug-p-${i.item}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.sugestao.prazo')
                }}</label>
                <input
                  :id="`sug-p-${i.item}`"
                  v-model="prazos[i.item]"
                  :placeholder="String(i.prazoDias)"
                  inputmode="numeric"
                  size="4"
                />
                <label :for="`sug-s-${i.item}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.sugestao.seguranca')
                }}</label>
                <input
                  :id="`sug-s-${i.item}`"
                  v-model="segurancas[i.item]"
                  :placeholder="String(i.estoqueSeguranca)"
                  inputmode="decimal"
                  size="6"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('suprimentos.gravar')"
                  @acionar="gravarPonto(i.item)"
                />
              </template>
              <template v-else>{{ i.prazoDias }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="s.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <div class="filtros">
        <SanteSelecao v-model="centroCusto" :rotulo="t('suprimentos.centroCusto')" :opcoes="opcoesCentros" />
        <SanteBotao
          v-if="pode('suprimentos.criarPedido')"
          :rotulo="t('suprimentos.sugestao.gerar')"
          :desabilitado="!centroCusto || !Object.values(marcados).some(Boolean)"
          data-testid="sug-gerar"
          @acionar="gerar"
        />
      </div>
    </template>
    <p v-if="mensagem" role="status" data-testid="sug-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
