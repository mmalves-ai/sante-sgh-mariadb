<script setup lang="ts">
// Lista de separação da requisição (F3.6, 05-SUP linha 6): `/suprimentos/requisicoes/:id/separacao`. Na tela e na
// impressão: na ordem do endereço no armazém, só o que falta atender, os lotes de validade mais próxima e a falta
// quando o saldo não cobre. O separador marca o que já pôs na caixa (só na tela, para não perder o fio).
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { listaSeparacao } from '../api-cadastro-estoque.js';
import { liberarReservaSeparacao, reservarSeparacao, reservasDaRequisicao } from '../api-enderecamento.js';
import { mensagensEnderecamento as R } from '../i18n-enderecamento.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { qtd } from '../usar-suprimentos.js';

const { t } = useI18n();
const rota = useRoute();
const id = computed(() => Number(rota.params['id']));
const lista = useQuery({
  queryKey: computed(() => ['suprimentos', 'separacao', id.value]),
  queryFn: () => listaSeparacao(id.value),
  enabled: computed(() => id.value > 0),
});
const separado = reactive<Record<number, boolean>>({});
const imprimir = () => globalThis.print?.();
// F8 (05-SUP linha 4): a reserva do saldo livre para esta requisição (lotes de validade mais próxima) e a liberação.
const fmt = (x: string, v: Record<string, string | number>) =>
  x.replace(/\{(\w+)\}/g, (_y, k: string) => String(v[k] ?? ''));
const podeReservar = computed(() => pode('suprimentos.requisicao.atender'));
const cliente = useQueryClient();
const reservas = useQuery({
  queryKey: computed(() => ['suprimentos', 'separacao', 'reservas', id.value]),
  queryFn: () => reservasDaRequisicao(id.value),
  enabled: computed(() => id.value > 0),
});
const avisoReserva = ref<string[]>([]);
const recarregarReservas = () =>
  cliente.invalidateQueries({ queryKey: ['suprimentos', 'separacao', 'reservas', id.value] });
const reservar = useMutation({
  mutationFn: () => reservarSeparacao(id.value),
  onSuccess: async (r) => {
    const nomes = new Map((lista.data.value?.linhas ?? []).map((l) => [l.item, l.nome]));
    avisoReserva.value = [
      r.reservas ? fmt(R.reserva.feita, { n: r.reservas }) : R.reserva.nada,
      ...r.faltas.map((f) =>
        fmt(R.reserva.falta, { q: qtd(f.falta), item: nomes.get(f.insumo) ?? f.insumo }),
      ),
    ];
    await recarregarReservas();
  },
});
const liberar = useMutation({
  mutationFn: () => liberarReservaSeparacao(id.value),
  onSuccess: async (r) => {
    avisoReserva.value = [fmt(R.reserva.liberada, { n: r.liberadas })];
    await recarregarReservas();
  },
});
const temAtiva = computed(() => (reservas.data.value ?? []).some((x) => x.situacao === 'ativa'));
const dataHora = (s: string) => s.replace('T', ' ').slice(0, 16);
</script>

<template>
  <section
    class="tela-agenda separacao"
    aria-labelledby="sep-titulo"
    data-testid="tela-suprimentos-separacao"
  >
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value">{{ t('cadastroEstoque.carregando') }}</p>
    <template v-else>
      <h1 id="sep-titulo">{{ t('cadastroEstoque.separacao.titulo', { n: lista.data.value.numero }) }}</h1>
      <p class="nao-imprime">{{ t('cadastroEstoque.separacao.texto') }}</p>
      <p data-testid="separacao-cabecalho">
        {{ lista.data.value.local.codigo }} · {{ lista.data.value.local.nome }} ·
        {{ t('cadastroEstoque.separacao.destino') }}: {{ lista.data.value.destino }} ·
        {{ dataHora(lista.data.value.solicitadoEm) }}
        <strong v-if="lista.data.value.urgente"> · {{ t('cadastroEstoque.separacao.urgente') }}</strong>
        · {{ t('cadastroEstoque.separacao.geradaEm') }} {{ dataHora(lista.data.value.geradaEm) }}
      </p>
      <p v-if="lista.data.value.totalFalta" role="alert" data-testid="separacao-faltas">
        {{ t('cadastroEstoque.separacao.faltas', { n: lista.data.value.totalFalta }) }}
      </p>
      <p class="nao-imprime">
        <button type="button" class="botao" data-testid="separacao-imprimir" @click="imprimir">
          {{ t('cadastroEstoque.separacao.imprimir') }}
        </button>
      </p>
      <section class="nao-imprime" data-testid="separacao-reserva" :aria-label="R.reserva.titulo">
        <h2>{{ R.reserva.titulo }}</h2>
        <p>{{ R.reserva.texto }}</p>
        <ErroSuprimentos
          v-if="reservar.error.value ?? liberar.error.value"
          :erro="reservar.error.value ?? liberar.error.value"
        />
        <p v-if="podeReservar">
          <button
            type="button"
            class="botao"
            :disabled="reservar.isPending.value || lista.data.value.linhas.length === 0"
            data-testid="separacao-reservar"
            @click="reservar.mutate()"
          >
            {{ R.reserva.reservar }}
          </button>
          <button
            v-if="temAtiva"
            type="button"
            class="botao"
            :disabled="liberar.isPending.value"
            data-testid="separacao-liberar"
            @click="liberar.mutate()"
          >
            {{ R.reserva.liberar }}
          </button>
        </p>
        <p v-for="a in avisoReserva" :key="a" role="status" data-testid="separacao-reserva-aviso">{{ a }}</p>
        <p v-if="(reservas.data.value ?? []).length === 0">{{ R.reserva.vazia }}</p>
        <table v-else class="tabela" data-testid="separacao-reservas">
          <caption>
            {{
              R.reserva.titulo
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ R.endereco }}</th>
              <th scope="col">{{ t('suprimentos.item') }}</th>
              <th scope="col">{{ R.reserva.lote }}</th>
              <th scope="col">{{ R.reserva.reservada }}</th>
              <th scope="col">{{ R.reserva.atendida }}</th>
              <th scope="col">{{ R.reserva.liberadaCol }}</th>
              <th scope="col">{{ R.situacao }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in reservas.data.value" :key="x.id" :data-testid="`separacao-reserva-${x.insumo}`">
              <td>{{ x.endereco ?? t('cadastroEstoque.separacao.semEndereco') }}</td>
              <td>{{ x.insumo }} · {{ x.nome }}</td>
              <td>{{ x.lote ? `${x.lote} (${x.validade})` : '' }}</td>
              <td>{{ qtd(x.reservada) }}</td>
              <td>{{ qtd(x.atendida) }}</td>
              <td>{{ qtd(x.liberada) }}</td>
              <td>{{ R.reserva.situacoes[x.situacao] }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p v-if="lista.data.value.linhas.length === 0">{{ t('cadastroEstoque.separacao.vazia') }}</p>
      <table v-else class="tabela" data-testid="separacao-linhas">
        <caption>
          {{
            t('cadastroEstoque.separacao.abrir')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastroEstoque.separacao.separado') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.endereco') }}</th>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.aSeparar') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.lotes') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.saldo') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.falta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in lista.data.value.linhas"
            :key="l.sequencia"
            :class="{ feito: separado[l.sequencia] }"
            :data-testid="`separacao-item-${l.item}`"
          >
            <td>
              <input
                :id="`sep-${l.sequencia}`"
                v-model="separado[l.sequencia]"
                type="checkbox"
                :aria-label="`${t('cadastroEstoque.separacao.separado')} ${l.nome}`"
              />
            </td>
            <td>
              <strong>{{ l.endereco ?? t('cadastroEstoque.separacao.semEndereco') }}</strong>
              <small v-if="l.outrosEnderecos.length">{{ ` (${l.outrosEnderecos.join(', ')})` }}</small>
            </td>
            <td>{{ l.item }} · {{ l.nome }}</td>
            <td>{{ qtd(l.aSeparar) }} {{ l.unidade }}</td>
            <td>
              <span v-for="x in l.lotes" :key="x.lote">{{
                `${x.lote} (${x.validade}): ${qtd(x.quantidade)}; `
              }}</span>
            </td>
            <td>{{ qtd(l.saldo) }}</td>
            <td :data-testid="`separacao-falta-${l.item}`">
              <strong v-if="l.falta > 0">{{ qtd(l.falta) }}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.feito td {
  text-decoration: line-through;
  opacity: 0.6;
}
@media print {
  .nao-imprime {
    display: none;
  }
}
</style>
