<script setup lang="ts">
// Entrada de produtos recebidos em doação (C1-126, 09-AREA linha 79): `/suprimentos/doacoes`, aberta pela entrada por
// nota fiscal. Numa tela só: o doador buscado no cadastro (pessoa ou empresa, documento mascarado), o termo, a data e o
// local; os itens com quantidade, critério do custo (valor justo do termo ou último preço de compra, este já trazido
// pela referência do item) e os lotes do item rastreável; o total com as parcelas impressas; e as doações recebidas.
// A validação é a mesma regra do domínio que a API aplica (conferirEntradaDoacao), na hora, antes de gravar; o aviso do
// valor justo distante do último preço (avisosValorJusto) não recusa. Sem pedido, sem título a pagar; nada é apagado.
import type { ItemBusca } from '@sgh/contratos';
import {
  avisosValorJusto,
  conferirEntradaDoacao,
  type CriterioCustoDoacao,
  custoDaDoacao,
  type ItemDoacaoParaConferir,
} from '@sgh/contratos/regras-suprimentos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import { novaChaveContrato } from '../api-contrato.js';
import {
  buscarDoadores,
  type DoadorOpcaoTela,
  doacoesRecebidas,
  referenciaItemDoacao,
  registrarDoacao,
  type ResultadoDoacaoTela,
} from '../api-entrada-doacao.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensEntradaDoacao as M } from '../i18n-entrada-doacao.js';
import { usarSuprimentos } from '../usar-suprimentos.js';

interface LoteLinha {
  lote: string;
  validade: string;
  quantidade: string;
}
interface LinhaDoacao {
  item: number;
  nome: string;
  controlaLote: boolean;
  ultimoPreco: number | null;
  quantidade: string;
  criterio: CriterioCustoDoacao;
  valorJusto: string;
  lotes: LoteLinha[];
}

const fmt = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_x, k: string) => String(v[k] ?? ''));
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const real = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const realUnit = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const numero = (s: string) => {
  const v = Number(String(s).replace(',', '.'));
  return String(s).trim() !== '' && Number.isFinite(v) ? v : NaN;
};
const diaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const podeGravar = computed(() => pode('suprimentos.nota.registrar'));
const { locaisDoTipo } = usarSuprimentos();
const cliente = useQueryClient();
const erro = ref<unknown>(null);
const aviso = ref('');
const hoje = diaLocal(new Date());

const recebidas = useQuery({ queryKey: ['suprimentos', 'doacoes'], queryFn: () => doacoesRecebidas() });

// ------------------------------------------------ doador
const termoDoador = ref('');
const achados = ref<DoadorOpcaoTela[] | null>(null);
const doador = ref<DoadorOpcaoTela | null>(null);
async function procurarDoador(): Promise<void> {
  erro.value = null;
  try {
    achados.value = await buscarDoadores(termoDoador.value.trim());
  } catch (x) {
    erro.value = x;
  }
}
function escolherDoador(d: DoadorOpcaoTela): void {
  doador.value = d;
  achados.value = null;
  termoDoador.value = '';
}

// ------------------------------------------------ cabeçalho do termo
const termo = ref('');
const recebidaEm = ref(hoje);
const local = ref('');
const observacao = ref('');
const opcoesLocal = computed(() => [
  { valor: '', rotulo: M.escolha },
  ...locaisDoTipo('E').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesCriterio = [
  { valor: 'valor_justo', rotulo: M.itens.criterios.valor_justo },
  { valor: 'ultimo_preco', rotulo: M.itens.criterios.ultimo_preco },
];

// ------------------------------------------------ itens
const linhas = ref<LinhaDoacao[]>([]);
async function incluirItem(i: ItemBusca): Promise<void> {
  erro.value = null;
  if (linhas.value.some((l) => l.item === i.codigo)) return;
  try {
    const r = await referenciaItemDoacao(i.codigo);
    linhas.value.push({
      item: r.item,
      nome: r.nome,
      controlaLote: r.controlaLote,
      ultimoPreco: r.ultimoPreco,
      quantidade: '',
      criterio: r.ultimoPreco !== null ? 'ultimo_preco' : 'valor_justo',
      valorJusto: '',
      lotes: r.controlaLote ? [{ lote: '', validade: '', quantidade: '' }] : [],
    });
  } catch (x) {
    erro.value = x;
  }
}
const removerItem = (k: number) => linhas.value.splice(k, 1);
const incluirLote = (l: LinhaDoacao) => l.lotes.push({ lote: '', validade: '', quantidade: '' });
const removerLote = (l: LinhaDoacao, k: number) => l.lotes.splice(k, 1);
const criterioDe = (l: LinhaDoacao, v: string | null) => {
  l.criterio = v === 'ultimo_preco' ? 'ultimo_preco' : 'valor_justo';
};

const paraConferir = computed<ItemDoacaoParaConferir[]>(() =>
  linhas.value.map((l) => ({
    item: l.item,
    quantidade: numero(l.quantidade),
    criterio: l.criterio,
    valorJusto: l.criterio === 'valor_justo' ? numero(l.valorJusto) || null : null,
    ultimoPreco: l.ultimoPreco,
  })),
);
const recusas = computed(() =>
  conferirEntradaDoacao({
    doador: doador.value ? { tipo: doador.value.tipo, id: doador.value.id } : null,
    termo: termo.value,
    recebidaEm: recebidaEm.value,
    hoje,
    itens: paraConferir.value,
  }),
);
/** O item rastreável precisa dos lotes completos somando a quantidade doada (a API confere de novo ao gravar). */
const lotesIncompletos = computed(() =>
  linhas.value.filter((l) => {
    if (!l.controlaLote) return false;
    if (!l.lotes.length || l.lotes.some((x) => !x.lote.trim() || !x.validade || !(numero(x.quantidade) > 0)))
      return true;
    const soma = l.lotes.reduce((s, x) => s + numero(x.quantidade), 0);
    return Math.round(soma * 10_000) !== Math.round(numero(l.quantidade) * 10_000);
  }),
);
const avisos = computed(() => new Set(avisosValorJusto(paraConferir.value)));
const custo = computed(() => custoDaDoacao(paraConferir.value));
const parcelas = computed(() =>
  custo.value.itens.map((c, k) => ({
    item: c.item,
    texto: fmt(M.parcela, {
      item: linhas.value[k]?.nome ?? String(c.item),
      quantidade: qtd(paraConferir.value[k]?.quantidade || 0),
      unitario: realUnit(c.custoUnitario),
      total: real(c.valorTotal),
    }),
  })),
);
const totalDaLinha = (k: number) => custo.value.itens[k]?.valorTotal ?? 0;
const podeEnviar = computed(
  () =>
    podeGravar.value &&
    !!local.value &&
    recusas.value.length === 0 &&
    lotesIncompletos.value.length === 0 &&
    !gravacao.isPending.value,
);

// ------------------------------------------------ gravação
let chave = novaChaveContrato('doacao');
const avisoGravado = (g: ResultadoDoacaoTela) =>
  fmt(M.gravado, { numero: g.numero, itens: g.itens, total: real(g.valorTotal) }) +
  (g.avisos.length ? fmt(M.gravadoComAviso, { avisos: g.avisos.length }) : '');
const gravacao = useMutation({
  mutationFn: () =>
    registrarDoacao(
      {
        doador: { tipo: doador.value!.tipo, id: doador.value!.id },
        termo: termo.value.trim(),
        recebidaEm: recebidaEm.value,
        local: Number(local.value),
        observacao: observacao.value.trim() || null,
        itens: linhas.value.map((l, k) => ({
          item: l.item,
          quantidade: paraConferir.value[k]!.quantidade,
          criterio: l.criterio,
          valorJusto: paraConferir.value[k]!.valorJusto,
          lotes: l.controlaLote
            ? l.lotes.map((x) => ({
                lote: x.lote.trim(),
                validade: x.validade,
                quantidade: numero(x.quantidade),
              }))
            : [],
        })),
      },
      chave,
    ),
  onSuccess: async (g) => {
    erro.value = null;
    aviso.value = avisoGravado(g);
    chave = novaChaveContrato('doacao');
    doador.value = null;
    termo.value = observacao.value = '';
    recebidaEm.value = hoje;
    linhas.value = [];
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'doacoes'] });
  },
  onError: (x) => {
    erro.value = x;
  },
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="doa-titulo" data-testid="tela-suprimentos-doacoes">
    <h1 id="doa-titulo">{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <RouterLink to="/suprimentos/notas-fiscais" data-testid="doa-voltar">{{ M.voltarNotas }}</RouterLink>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="doa-aviso">{{ aviso }}</p>
    <p v-if="!podeGravar" class="secundario" data-testid="doa-sem-permissao">{{ M.semPermissao }}</p>

    <form v-else class="painel" data-testid="doa-form" @submit.prevent="gravacao.mutate()">
      <!-- ------------------------------------------------ doador -->
      <h2>{{ M.doador.titulo }}</h2>
      <p v-if="doador" data-testid="doa-doador-escolhido">
        {{ fmt(M.doador.escolhido, { nome: doador.nome, tipo: M.doador.tipos[doador.tipo] }) }}
        <button type="button" class="link" data-testid="doa-doador-trocar" @click="doador = null">
          {{ M.doador.trocar }}
        </button>
      </p>
      <div v-else class="filtros">
        <label class="campo">
          <span>{{ M.doador.busca }}</span>
          <input
            v-model="termoDoador"
            data-testid="doa-doador-termo"
            @keydown.enter.prevent="procurarDoador"
          />
        </label>
        <button type="button" class="botao" data-testid="doa-doador-buscar" @click="procurarDoador">
          {{ M.doador.buscar }}
        </button>
      </div>
      <p v-if="achados && achados.length === 0" data-testid="doa-doador-nenhum">{{ M.doador.nenhum }}</p>
      <ul v-else-if="achados" data-testid="doa-doadores">
        <li v-for="d in achados" :key="`${d.tipo}-${d.id}`">
          {{ d.nome }} · {{ M.doador.tipos[d.tipo]
          }}<template v-if="d.documento"> · {{ d.documento }}</template>
          <button
            type="button"
            class="link"
            :data-testid="`doa-doador-${d.tipo}-${d.id}`"
            @click="escolherDoador(d)"
          >
            {{ M.doador.escolher }}
          </button>
        </li>
      </ul>

      <!-- ------------------------------------------------ termo -->
      <div class="filtros">
        <label class="campo">
          <span>{{ M.termo }}</span>
          <input v-model="termo" maxlength="20" data-testid="doa-termo" />
        </label>
        <label class="campo">
          <span>{{ M.recebidaEm }}</span>
          <input v-model="recebidaEm" type="date" :max="hoje" data-testid="doa-data" />
        </label>
        <SanteSelecao
          v-model="local"
          :rotulo="M.local"
          :opcoes="opcoesLocal"
          class="campo"
          data-testid="doa-local"
        />
      </div>
      <label class="campo">
        <span>{{ M.observacao }}</span>
        <input v-model="observacao" maxlength="2000" data-testid="doa-observacao" />
      </label>

      <!-- ------------------------------------------------ itens -->
      <h2>{{ M.itens.titulo }}</h2>
      <BuscaItem :rotulo="M.itens.busca" testid="doa-item-busca" @escolher="incluirItem" />
      <p v-if="linhas.length === 0">{{ M.itens.vazio }}</p>
      <table v-else class="tabela" data-testid="doa-itens">
        <thead>
          <tr>
            <th>{{ M.itens.colunas.item }}</th>
            <th>{{ M.itens.colunas.quantidade }}</th>
            <th>{{ M.itens.colunas.criterio }}</th>
            <th>{{ M.itens.colunas.valorJusto }}</th>
            <th>{{ M.itens.colunas.ultimoPreco }}</th>
            <th>{{ M.itens.colunas.total }}</th>
            <th>{{ M.itens.colunas.acao }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(l, k) in linhas" :key="l.item">
            <tr :data-testid="`doa-item-${l.item}`">
              <td>{{ l.nome }}</td>
              <td>
                <input
                  v-model="l.quantidade"
                  inputmode="decimal"
                  size="8"
                  :aria-label="`${M.itens.colunas.quantidade} ${l.nome}`"
                  :data-testid="`doa-item-${l.item}-quantidade`"
                />
              </td>
              <td>
                <SanteSelecao
                  :model-value="l.criterio"
                  :rotulo="`${M.itens.colunas.criterio} ${l.nome}`"
                  :opcoes="opcoesCriterio"
                  :data-testid="`doa-item-${l.item}-criterio`"
                  @update:model-value="criterioDe(l, $event)"
                />
              </td>
              <td>
                <input
                  v-if="l.criterio === 'valor_justo'"
                  v-model="l.valorJusto"
                  inputmode="decimal"
                  size="10"
                  :aria-label="`${M.itens.colunas.valorJusto} ${l.nome}`"
                  :data-testid="`doa-item-${l.item}-valor-justo`"
                />
                <p v-if="avisos.has(l.item)" role="status" :data-testid="`doa-item-${l.item}-aviso`">
                  {{ M.itens.avisoValorJusto }}
                </p>
              </td>
              <td>{{ l.ultimoPreco !== null ? realUnit(l.ultimoPreco) : M.itens.semUltimoPreco }}</td>
              <td :data-testid="`doa-item-${l.item}-total`">{{ real(totalDaLinha(k)) }}</td>
              <td>
                <button
                  type="button"
                  class="link"
                  :data-testid="`doa-item-${l.item}-remover`"
                  @click="removerItem(k)"
                >
                  {{ M.itens.remover }}
                </button>
              </td>
            </tr>
            <tr v-if="l.controlaLote" :data-testid="`doa-item-${l.item}-lotes`">
              <td colspan="7">
                <fieldset>
                  <legend>{{ fmt(M.itens.lotes, { item: l.nome }) }}</legend>
                  <div v-for="(x, j) in l.lotes" :key="j" class="filtros">
                    <label class="campo">
                      <span>{{ M.itens.lote }}</span>
                      <input v-model="x.lote" maxlength="30" :data-testid="`doa-item-${l.item}-lote-${j}`" />
                    </label>
                    <label class="campo">
                      <span>{{ M.itens.validade }}</span>
                      <input
                        v-model="x.validade"
                        type="date"
                        :min="hoje"
                        :data-testid="`doa-item-${l.item}-validade-${j}`"
                      />
                    </label>
                    <label class="campo">
                      <span>{{ M.itens.quantidadeLote }}</span>
                      <input
                        v-model="x.quantidade"
                        inputmode="decimal"
                        size="8"
                        :data-testid="`doa-item-${l.item}-qtd-lote-${j}`"
                      />
                    </label>
                    <button v-if="l.lotes.length > 1" type="button" class="link" @click="removerLote(l, j)">
                      {{ M.itens.removerLote }}
                    </button>
                  </div>
                  <button
                    type="button"
                    class="link"
                    :data-testid="`doa-item-${l.item}-incluir-lote`"
                    @click="incluirLote(l)"
                  >
                    {{ M.itens.incluirLote }}
                  </button>
                </fieldset>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <dl v-if="linhas.length" data-testid="doa-total">
        <dt>{{ M.total }}</dt>
        <dd data-testid="doa-total-valor">{{ real(custo.total) }}</dd>
        <dd v-for="p in parcelas" :key="p.item" :data-testid="`doa-parcela-${p.item}`">{{ p.texto }}</dd>
      </dl>

      <ul v-if="recusas.length || lotesIncompletos.length" role="alert" data-testid="doa-recusas">
        <li v-for="r in recusas" :key="r.codigo" :data-testid="`doa-recusa-${r.codigo}`">{{ r.mensagem }}</li>
        <li v-if="lotesIncompletos.length" data-testid="doa-recusa-lotes">{{ M.itens.loteObrigatorio }}</li>
      </ul>
      <button type="submit" class="botao" :disabled="!podeEnviar" data-testid="doa-registrar">
        {{ M.registrar }}
      </button>
    </form>

    <!-- ------------------------------------------------ doações recebidas -->
    <section class="painel" aria-labelledby="doa-recebidas-titulo" data-testid="doa-recebidas">
      <h2 id="doa-recebidas-titulo">{{ M.recebidas.titulo }}</h2>
      <ErroSuprimentos v-if="recebidas.error.value" :erro="recebidas.error.value" />
      <p v-else-if="!recebidas.data.value">{{ M.carregando }}</p>
      <p v-else-if="recebidas.data.value.length === 0">{{ M.recebidas.vazia }}</p>
      <table v-else class="tabela">
        <thead>
          <tr>
            <th>{{ M.recebidas.colunas.numero }}</th>
            <th>{{ M.recebidas.colunas.termo }}</th>
            <th>{{ M.recebidas.colunas.data }}</th>
            <th>{{ M.recebidas.colunas.doador }}</th>
            <th>{{ M.recebidas.colunas.local }}</th>
            <th>{{ M.recebidas.colunas.itens }}</th>
            <th>{{ M.recebidas.colunas.total }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in recebidas.data.value" :key="d.id" :data-testid="`doa-recebida-${d.id}`">
            <td>{{ d.numero }}</td>
            <td>{{ d.termo }}</td>
            <td>{{ dataBr(d.recebidaEm) }}</td>
            <td>{{ d.doador }} · {{ M.doador.tipos[d.tipoDoador] }}</td>
            <td>{{ d.local }}</td>
            <td>{{ d.itens }}</td>
            <td>{{ real(d.valorTotal) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
