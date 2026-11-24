<script setup lang="ts">
// Itens de estoque (ficha do M28, seção 7): `/suprimentos/itens`. Busca o item (nome ou código) e mostra a ficha do
// estoque: unidade, lote (rastreável), Portaria 344 (controlado), antimicrobiano, consignado, o saldo e o custo médio
// por local (do banco) e a posição dos últimos meses. A edição abre o cadastro do item (F3.6-1, 05-SUP linha 1).
import type { ItemBusca } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerFichaItem, lerPosicao, listarSaldos } from '../api-suprimentos.js';
import { pode } from '../../../casca/sessao/pode.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { qtd, reais } from '../usar-suprimentos.js';

const { t } = useI18n();
// Quem tem o cadastro do item no cargo vê os atalhos; a guarda do servidor decide.
const podeEditar = computed(() => pode('suprimentos.item.editar'));
const item = ref<ItemBusca | null>(null);
const codigo = computed(() => item.value?.codigo ?? 0);
const saldos = useQuery({
  queryKey: computed(() => ['suprimentos', 'itens', 'saldos', codigo.value]),
  queryFn: () => listarSaldos({ item: codigo.value, todos: true }),
  enabled: computed(() => codigo.value > 0),
});
const posicao = useQuery({
  queryKey: computed(() => ['suprimentos', 'itens', 'posicao', codigo.value]),
  queryFn: () => lerPosicao(codigo.value),
  enabled: computed(() => codigo.value > 0),
});
const ficha = useQuery({
  queryKey: computed(() => ['suprimentos', 'itens', 'ficha', codigo.value]),
  queryFn: () => lerFichaItem(codigo.value),
  enabled: computed(() => codigo.value > 0),
});
const fator = (v: number | null | undefined) => (v === null || v === undefined ? '—' : qtd(v));
const sim = (b: boolean) => (b ? t('suprimentos.sim') : t('suprimentos.nao'));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="itens-titulo" data-testid="tela-suprimentos-itens">
    <h1 id="itens-titulo">{{ t('suprimentos.itensTela.titulo') }}</h1>
    <p>{{ t('suprimentos.itensTela.texto') }}</p>
    <p v-if="podeEditar" class="atalhos">
      <RouterLink to="/suprimentos/itens/cadastro" data-testid="itens-novo">{{
        t('cadastroEstoque.atalhos.novoItem')
      }}</RouterLink>
    </p>
    <BuscaItem testid="itens-busca" @escolher="(i) => (item = i)" />
    <div v-if="item" class="painel" data-testid="itens-ficha">
      <h2>{{ item.codigo }} · {{ item.nome }}</h2>
      <p v-if="podeEditar">
        <RouterLink :to="`/suprimentos/itens/cadastro/${item.codigo}`" data-testid="itens-editar">{{
          t('cadastroEstoque.atalhos.editarItem')
        }}</RouterLink>
      </p>
      <dl class="ficha">
        <dt>{{ t('suprimentos.unidade') }}</dt>
        <dd>{{ item.unidade }}</dd>
        <dt>{{ t('suprimentos.rastreavel') }}</dt>
        <dd>{{ sim(item.rastreavel) }}</dd>
        <dt>{{ t('suprimentos.controlado') }}</dt>
        <dd>{{ sim(item.controlado) }}</dd>
        <dt>{{ t('suprimentos.itensTela.antimicrobiano') }}</dt>
        <dd>{{ sim(item.antimicrobiano) }}</dd>
        <dt>{{ t('suprimentos.itensTela.consignado') }}</dt>
        <dd>{{ sim(item.consignado) }}</dd>
        <dt>{{ t('suprimentos.itensTela.ativo') }}</dt>
        <dd>{{ sim(item.ativo) }}</dd>
        <template v-if="ficha.data.value">
          <dt>{{ t('suprimentos.itensTela.classe') }}</dt>
          <dd data-testid="itens-classe">
            {{
              ficha.data.value.classe
                ? `${ficha.data.value.classe.codigo} · ${ficha.data.value.classe.nome}`
                : '—'
            }}
          </dd>
          <dt>{{ t('suprimentos.itensTela.grupo') }}</dt>
          <dd>
            {{
              ficha.data.value.grupo
                ? `${ficha.data.value.grupo.codigo} · ${ficha.data.value.grupo.nome}`
                : '—'
            }}
          </dd>
          <dt>{{ t('suprimentos.itensTela.unidades') }}</dt>
          <dd data-testid="itens-unidades">
            {{
              t('suprimentos.itensTela.unidadesTexto', {
                compra: ficha.data.value.unidades.compra || '—',
                armazenamento: ficha.data.value.unidades.armazenamento || '—',
                consumo: ficha.data.value.unidades.consumo || '—',
                prescricao: ficha.data.value.unidades.prescricao || '—',
              })
            }}
          </dd>
          <dt>{{ t('suprimentos.itensTela.fatores') }}</dt>
          <dd data-testid="itens-fatores">
            {{
              t('suprimentos.itensTela.fatoresTexto', {
                compra: fator(ficha.data.value.fatores.compraConsumo),
                prescricao: fator(ficha.data.value.fatores.consumoPrescricao),
              })
            }}
          </dd>
        </template>
      </dl>
      <ErroSuprimentos v-if="ficha.error.value" :erro="ficha.error.value" />
      <ErroSuprimentos v-if="saldos.error.value" :erro="saldos.error.value" />
      <table v-if="saldos.data.value" class="tabela" data-testid="itens-saldos">
        <caption>
          {{
            t('suprimentos.itensTela.porLocal')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.local') }}</th>
            <th scope="col">{{ t('suprimentos.saldo') }}</th>
            <th scope="col">{{ t('suprimentos.valor') }}</th>
            <th scope="col">{{ t('suprimentos.custoMedio') }}</th>
            <th scope="col">{{ t('suprimentos.minimo') }}</th>
            <th scope="col">{{ t('suprimentos.maximo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in saldos.data.value.itens" :key="s.local">
            <td>{{ s.localNome }}</td>
            <td>{{ qtd(s.quantidade) }} {{ s.unidade }}</td>
            <td>{{ reais(s.valor) }}</td>
            <td>{{ reais(s.custoMedio) }}</td>
            <td>{{ s.minimo === null ? '—' : qtd(s.minimo) }}</td>
            <td>{{ s.maximo === null ? '—' : qtd(s.maximo) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="saldos.data.value?.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <table v-if="posicao.data.value" class="tabela" data-testid="itens-posicao">
        <caption>
          {{
            t('suprimentos.itensTela.posicao')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.competencia') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in posicao.data.value.meses" :key="`${m.ano}-${m.mes}`">
            <td>{{ String(m.mes).padStart(2, '0') }}/{{ m.ano }}</td>
            <td>{{ qtd(m.quantidade) }}</td>
            <td>{{ reais(m.valor) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.ficha {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.ficha dd {
  margin: 0;
}
</style>
