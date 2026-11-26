<script setup lang="ts">
// Devolução de compra ao fornecedor (C2-015, 05-SUP linha 22): `/suprimentos/devolucoes-fornecedor`. Numa tela só:
// busca da nota de compra, itens com o disponível (recebido menos o já devolvido) e a validação na hora, "devolver
// tudo" num clique, motivo, NF-e de devolução opcional com a chave conferida enquanto digita, a opção de abater no
// contas a pagar com o saldo a pagar à vista e a prévia do que abate e do que fica pendente (a mesma regra da API),
// e a lista das devoluções com o abatido e o pendente.
import { chaveNfeValida, distribuirAbatimento, valoresDevolucao } from '@sgh/dominio-suprimentos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarNotasDevolucao,
  type DevolucaoFornecedorEntradaTela,
  type ItemNotaDevolucaoTela,
  lerNotaDevolucao,
  listarDevolucoesFornecedor,
  motivosDevolucaoFornecedor,
  type NotaDevolvivelTela,
  registrarDevolucaoFornecedor,
} from '../api-devolucao-fornecedor.js';
import { novaChaveContrato } from '../api-contrato.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensDevolucaoFornecedor as M } from '../i18n-devolucao-fornecedor.js';

const fmt = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_x, k: string) => String(v[k] ?? ''));
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const real = (v: number) => moeda.format(v);
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const dataBr = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const q2 = (x: number) => Math.round(x * 100) / 100;

const podeRegistrar = computed(() => pode('suprimentos.devolucao.registrar'));
const cliente = useQueryClient();
const erro = ref<unknown>(null);
const aviso = ref('');

// ------------------------------------------------ busca da nota
const busca = ref('');
const notasAchadas = ref<NotaDevolvivelTela[] | null>(null);
async function buscar(): Promise<void> {
  erro.value = null;
  try {
    notasAchadas.value = await buscarNotasDevolucao(busca.value.trim());
  } catch (x) {
    erro.value = x;
  }
}

const notaId = ref<number | null>(null);
const nota = useQuery({
  queryKey: computed(() => ['suprimentos', 'devolucao-fornecedor', 'nota', notaId.value]),
  queryFn: () => lerNotaDevolucao(notaId.value as number),
  enabled: computed(() => (notaId.value ?? 0) > 0),
});
const motivos = useQuery({
  queryKey: ['suprimentos', 'devolucao-fornecedor', 'motivos'],
  queryFn: motivosDevolucaoFornecedor,
});
const devolucoes = useQuery({
  queryKey: ['suprimentos', 'devolucao-fornecedor', 'lista'],
  queryFn: listarDevolucoesFornecedor,
});

// ------------------------------------------------ formulário
const quantidades = ref<Record<number, string>>({});
const motivo = ref<number | null>(null);
const abater = ref(true);
const numeroNf = ref('');
const serieNf = ref('');
const chave = ref('');
const emissao = ref('');
const observacao = ref('');

function escolherNota(id: number): void {
  notaId.value = id;
  quantidades.value = {};
  aviso.value = '';
}
function trocar(): void {
  notaId.value = null;
  quantidades.value = {};
}
const numeroDe = (s: string | undefined) => {
  const v = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
};
const acima = (i: ItemNotaDevolucaoTela) => numeroDe(quantidades.value[i.notaItem]) > i.disponivel;
function devolverTudo(): void {
  for (const i of nota.data.value?.itens ?? [])
    if (i.disponivel > 0) quantidades.value[i.notaItem] = String(i.disponivel);
}

const itensEscolhidos = computed(() =>
  (nota.data.value?.itens ?? [])
    .map((i) => ({ i, q: numeroDe(quantidades.value[i.notaItem]) }))
    .filter((x) => x.q > 0),
);
const chaveDigitos = computed(() => chave.value.replace(/\D/g, ''));
const chaveOk = computed(() => chaveDigitos.value === '' || chaveNfeValida(chaveDigitos.value));
const valores = computed(() =>
  valoresDevolucao(itensEscolhidos.value.map((x) => ({ quantidade: x.q, valorUnitario: x.i.custoUnitario }))),
);
const total = computed(() => q2(valores.value.total));
const previa = computed(() => {
  const saldo = nota.data.value?.saldoAPagar ?? 0;
  if (!abater.value || total.value <= 0) return { abate: 0, pendente: total.value };
  const d = distribuirAbatimento(total.value, [{ parcela: 1, saldo, vencimento: '2000-01-01' }]);
  return { abate: q2(total.value - d.pendente), pendente: q2(d.pendente) };
});
const valido = computed(
  () =>
    !!nota.data.value &&
    motivo.value !== null &&
    itensEscolhidos.value.length > 0 &&
    !itensEscolhidos.value.some((x) => x.q > x.i.disponivel) &&
    chaveOk.value,
);
const opcoesMotivo = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...(motivos.data.value ?? []).map((m) => ({ valor: m.id as number | null, rotulo: m.descricao })),
]);

let chaveIdem = novaChaveContrato('devolucao-forn');
const registro = useMutation({
  mutationFn: () => {
    const e: DevolucaoFornecedorEntradaTela = {
      nota: notaId.value as number,
      motivo: motivo.value as number,
      abaterContasPagar: abater.value,
      numeroNotaFiscal: numeroNf.value.trim() || null,
      serieNotaFiscal: serieNf.value.trim() || null,
      chaveAcesso: chaveDigitos.value || null,
      dataEmissao: emissao.value || null,
      observacao: observacao.value.trim() || null,
      itens: itensEscolhidos.value.map((x) => ({ notaItem: x.i.notaItem, quantidade: x.q })),
    };
    return registrarDevolucaoFornecedor(e, chaveIdem);
  },
  onSuccess: async (r) => {
    erro.value = null;
    aviso.value = fmt(M.registrada, {
      numero: r.numero,
      tipo: M.tipos[r.tipo] ?? r.tipo,
      total: real(r.valorTotal),
      abatido: real(r.valorAbatido),
      pendente: real(r.creditoPendente),
    });
    chaveIdem = novaChaveContrato('devolucao-forn');
    trocar();
    numeroNf.value = serieNf.value = chave.value = emissao.value = observacao.value = '';
    notasAchadas.value = null;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'devolucao-fornecedor'] });
  },
  onError: (x) => {
    erro.value = x;
  },
});
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="devf-titulo"
    data-testid="tela-suprimentos-devolucao-fornecedor"
  >
    <h1 id="devf-titulo">{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="devf-aviso">{{ aviso }}</p>

    <form v-if="!notaId" class="painel filtros" data-testid="devf-busca" @submit.prevent="buscar">
      <label class="campo">
        <span>{{ M.buscar }}</span>
        <input v-model="busca" data-testid="devf-busca-termo" />
      </label>
      <button type="submit" class="botao">{{ M.buscarBotao }}</button>
    </form>
    <template v-if="!notaId && notasAchadas">
      <p v-if="notasAchadas.length === 0">{{ M.nenhumaNota }}</p>
      <table v-else class="tabela" data-testid="devf-notas">
        <thead>
          <tr>
            <th>{{ M.colunas.entrada }}</th>
            <th>{{ M.colunas.fornecedor }}</th>
            <th>{{ M.colunas.data }}</th>
            <th>{{ M.colunas.total }}</th>
            <th>{{ M.colunas.disponivel }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in notasAchadas" :key="n.id">
            <td>{{ n.documento }}</td>
            <td>{{ n.fornecedor }}</td>
            <td>{{ dataBr(n.entradaEm) }}</td>
            <td>{{ real(n.valorTotal) }}</td>
            <td>{{ n.itensDisponiveis }}</td>
            <td>
              <button
                type="button"
                class="link"
                :data-testid="`devf-escolher-${n.id}`"
                @click="escolherNota(n.id)"
              >
                {{ M.escolher }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="notaId">
      <p v-if="!nota.data.value">{{ M.carregando }}</p>
      <form
        v-else
        class="painel"
        data-testid="devf-form"
        :aria-label="M.titulo"
        @submit.prevent="valido && registro.mutate()"
      >
        <p data-testid="devf-nota">
          {{
            fmt(M.nota, {
              documento: nota.data.value.documento,
              fornecedor: nota.data.value.fornecedor,
              data: dataBr(nota.data.value.entradaEm),
              local: nota.data.value.localNome,
            })
          }}
          <button type="button" class="link" data-testid="devf-trocar" @click="trocar">{{ M.trocar }}</button>
        </p>
        <button
          v-if="podeRegistrar"
          type="button"
          class="botao"
          data-testid="devf-tudo"
          @click="devolverTudo"
        >
          {{ M.tudo }}
        </button>
        <table class="tabela" data-testid="devf-itens">
          <thead>
            <tr>
              <th>{{ M.colunas.item }}</th>
              <th>{{ M.colunas.lotes }}</th>
              <th>{{ M.colunas.recebida }}</th>
              <th>{{ M.colunas.jaDevolvida }}</th>
              <th>{{ M.colunas.disponivel }}</th>
              <th>{{ M.colunas.custo }}</th>
              <th>{{ M.colunas.devolver }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in nota.data.value.itens" :key="i.notaItem">
              <td>{{ i.nome }}</td>
              <td>{{ i.lotes }}</td>
              <td>{{ qtd(i.recebida) }}</td>
              <td>{{ qtd(i.jaDevolvida) }}</td>
              <td>{{ qtd(i.disponivel) }}</td>
              <td>{{ real(i.custoUnitario) }}</td>
              <td>
                <label class="sgh-visualmente-oculto" :for="`devf-q-${i.notaItem}`">{{
                  M.colunas.devolver
                }}</label>
                <input
                  :id="`devf-q-${i.notaItem}`"
                  v-model="quantidades[i.notaItem]"
                  inputmode="decimal"
                  size="8"
                  :disabled="i.disponivel <= 0 || !podeRegistrar"
                  :aria-invalid="acima(i)"
                  :data-testid="`devf-q-${i.notaItem}`"
                />
                <span v-if="acima(i)" role="alert">
                  {{ fmt(M.acimaDoDisponivel, { disponivel: qtd(i.disponivel) }) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <SanteSelecao
          v-model="motivo"
          :rotulo="M.motivo"
          :opcoes="opcoesMotivo"
          class="campo"
          data-testid="devf-motivo"
        />

        <fieldset class="filtros">
          <legend>{{ M.nfeTitulo }}</legend>
          <label class="campo">
            <span>{{ M.numeroNf }}</span>
            <input v-model="numeroNf" maxlength="15" size="10" data-testid="devf-nf-numero" />
          </label>
          <label class="campo">
            <span>{{ M.serieNf }}</span>
            <input v-model="serieNf" maxlength="10" size="4" data-testid="devf-nf-serie" />
          </label>
          <label class="campo">
            <span>{{ M.chave }}</span>
            <input
              v-model="chave"
              inputmode="numeric"
              maxlength="60"
              size="48"
              :aria-invalid="!chaveOk"
              data-testid="devf-nf-chave"
            />
          </label>
          <span v-if="!chaveOk" role="alert" data-testid="devf-chave-invalida">{{ M.chaveInvalida }}</span>
          <label class="campo">
            <span>{{ M.emissao }}</span>
            <input v-model="emissao" type="date" data-testid="devf-nf-emissao" />
          </label>
        </fieldset>
        <label class="campo">
          <span>{{ M.observacao }}</span>
          <textarea v-model="observacao" maxlength="2000" rows="2" data-testid="devf-observacao"></textarea>
        </label>

        <label class="campo">
          <input v-model="abater" type="checkbox" data-testid="devf-abater" />
          {{ M.abater }}
        </label>
        <p data-testid="devf-saldo">{{ fmt(M.saldoAPagar, { valor: real(nota.data.value.saldoAPagar) }) }}</p>
        <p role="status" data-testid="devf-resumo">
          {{
            fmt(M.resumo, { total: real(total), abate: real(previa.abate), pendente: real(previa.pendente) })
          }}
        </p>
        <button
          v-if="podeRegistrar"
          type="submit"
          class="botao"
          :disabled="!valido || registro.isPending.value"
          data-testid="devf-registrar"
        >
          {{ M.registrar }}
        </button>
      </form>
    </template>

    <h2>{{ M.lista }}</h2>
    <ErroSuprimentos v-if="devolucoes.error.value" :erro="devolucoes.error.value" />
    <p v-else-if="!devolucoes.data.value">{{ M.carregando }}</p>
    <p v-else-if="devolucoes.data.value.length === 0">{{ M.vazia }}</p>
    <table v-else class="tabela" data-testid="devf-lista">
      <thead>
        <tr>
          <th>{{ M.colunas.numero }}</th>
          <th>{{ M.colunas.data }}</th>
          <th>{{ M.colunas.fornecedor }}</th>
          <th>{{ M.colunas.entrada }}</th>
          <th>{{ M.colunas.motivo }}</th>
          <th>{{ M.colunas.nfe }}</th>
          <th>{{ M.colunas.total }}</th>
          <th>{{ M.colunas.abatido }}</th>
          <th>{{ M.colunas.pendente }}</th>
          <th>{{ M.colunas.situacao }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in devolucoes.data.value" :key="d.id">
          <td>{{ d.numero }}</td>
          <td>{{ dataBr(d.devolvidaEm) }}</td>
          <td>{{ d.fornecedor }}</td>
          <td>{{ d.documentoEntrada }}</td>
          <td>{{ d.motivo }}</td>
          <td>{{ d.numeroNotaFiscal ?? '' }}</td>
          <td>{{ real(d.valorTotal) }}</td>
          <td>{{ real(d.valorAbatido) }}</td>
          <td>{{ real(d.creditoPendente) }}</td>
          <td>{{ d.situacao }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
