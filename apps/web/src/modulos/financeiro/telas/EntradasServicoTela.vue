<script setup lang="ts">
// Entrada de serviço tomado (F7, 09-AREA linha 78, C2-094): `/financeiro/fiscal/entradas-servico`. Desenho próprio:
// escolhido o fornecedor, os pedidos de serviço dele aparecem; escolhido o pedido, os serviços com saldo e preço entram
// prontos na nota (só se ajusta o que veio diferente). A conferência contra o pedido (saldo, preço, datas, ISS na faixa
// da LC 116, câmbio) é a MESMA regra do domínio que o servidor aplica (conferirEntradaServico), mostrada enquanto se
// digita; as retenções (IR, INSS, PIS, COFINS, CSLL pela regra vigente e o ISS da nota) vêm da prévia do servidor, que
// usa o mesmo cálculo da gravação, e alimentam a EFD-REINF (R-2010 e R-4020). Concluir baixa o pedido e leva a nota à
// escrituração; cancelar exige justificativa (conferirCancelamentoEntrada) e devolve o saldo. Nada se apaga.
import {
  conferirCancelamentoEntrada,
  conferirEntradaServico,
  converterMoeda,
  valorDoItem,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  cancelarEntradaServico,
  concluirEntradaServico,
  type EntradaServicoTela,
  lerApoioEntradaServico,
  lerDetalheEntradaServico,
  lerEntradasServico,
  lerPreviaRetencoes,
  registrarEntradaServico,
} from '../api-entrada-servico.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const PERM_LANCAR = 'financeiro.entradaServico.lancar';
const SITUACOES = ['aberta', 'concluida', 'cancelada'] as const;
const { t } = useI18n();
const qc = useQueryClient();
const { tem } = usarFinanceiro();
const podeGravar = computed(() => tem(PERM_LANCAR));
const hoje = new Date().toISOString().slice(0, 10);

const apoio = useQuery({
  queryKey: ['financeiro', 'entrada-servico', 'apoio'],
  queryFn: lerApoioEntradaServico,
});
const filtroCompetencia = ref(hoje.slice(0, 7));
const filtroSituacao = ref('');
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('financeiro.entradaServico.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: t(`financeiro.entradaServico.situacoes.${s}`) })),
]);
const entradas = useQuery({
  queryKey: computed(() => [
    'financeiro',
    'entrada-servico',
    'lista',
    filtroCompetencia.value,
    filtroSituacao.value,
  ]),
  queryFn: () => lerEntradasServico(filtroCompetencia.value || null, filtroSituacao.value || null),
});

// ── Gravação comum: mensagem do servidor, nova chave e releitura ───────────────────────────────────────────
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('entrada-servico');
async function acao(f: (c: string) => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('entrada-servico');
    await qc.invalidateQueries({ queryKey: ['financeiro', 'entrada-servico'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Registro: fornecedor → pedido → serviços prontos ───────────────────────────────────────────────────────
interface Linha {
  servico: string;
  pedidoItem: number | null;
  quantidade: number | '';
  valorUnitario: number | '';
  valorDesconto: number | '';
  centro: string;
  inssNaoRetido: number | '';
  processo: string;
}
const num = (v: number | '') => (v === '' ? 0 : Number(v) || 0);
const novaLinha = (): Linha => ({
  servico: '',
  pedidoItem: null,
  quantidade: 1,
  valorUnitario: '',
  valorDesconto: 0,
  centro: '',
  inssNaoRetido: 0,
  processo: '',
});
const fornecedor = ref('');
const pedidoId = ref('');
const numeroDocumento = ref('');
const serie = ref('');
const emissao = ref(hoje);
const dataEntrada = ref(hoje);
const competencia = ref(hoje.slice(0, 7));
const issRetido = ref(false);
const aliquotaIss = ref<number | ''>('');
const observacao = ref('');
const linhas = ref<Linha[]>([novaLinha()]);
const emMoeda = ref(false);
const moeda = ref('');
const dataCotacao = ref(hoje);
const taxa = ref<number | ''>('');
const valorMoeda = ref<number | ''>('');

const opcao = (o: { id: number; rotulo: string }) => ({ valor: String(o.id), rotulo: o.rotulo });
const opcoesFornecedor = computed(() => [
  { valor: '', rotulo: t('financeiro.entradaServico.escolhaFornecedor') },
  ...(apoio.data.value?.fornecedores ?? []).map(opcao),
]);
const pedidosDoFornecedor = computed(() =>
  (apoio.data.value?.pedidos ?? []).filter((p) => String(p.fornecedor) === fornecedor.value),
);
const opcoesPedido = computed(() => [
  { valor: '', rotulo: t('financeiro.entradaServico.semPedido') },
  ...pedidosDoFornecedor.value.map(opcao),
]);
const pedido = computed(() => apoio.data.value?.pedidos.find((p) => String(p.id) === pedidoId.value) ?? null);
const opcoesServico = computed(() => [
  { valor: '', rotulo: t('financeiro.entradaServico.escolhaServico') },
  ...(apoio.data.value?.servicos ?? []).map(opcao),
]);
const opcoesCentro = computed(() => [
  { valor: '', rotulo: t('financeiro.entradaServico.escolhaCentro') },
  ...(apoio.data.value?.centros ?? []).map(opcao),
]);
const opcoesMoeda = computed(() => [
  { valor: '', rotulo: t('financeiro.entradaServico.escolhaMoeda') },
  ...(apoio.data.value?.moedas ?? []).map(opcao),
]);
watch(fornecedor, () => {
  if (!pedidosDoFornecedor.value.some((p) => String(p.id) === pedidoId.value)) pedidoId.value = '';
});
// O pedido escolhido traz os serviços com saldo, no preço do pedido (o pedido é o teto).
watch(pedido, (p) => {
  const centro = linhas.value[0]?.centro ?? '';
  linhas.value = p
    ? p.itens
        .filter((i) => i.saldo > 0)
        .map((i) => ({
          ...novaLinha(),
          servico: String(i.servico),
          pedidoItem: i.id,
          quantidade: i.saldo,
          valorUnitario: i.valorUnitario,
          centro,
        }))
    : [novaLinha()];
  if (linhas.value.length === 0) linhas.value = [novaLinha()];
});
watch(emissao, (e, antes) => {
  if (e && competencia.value === (antes ?? '').slice(0, 7)) competencia.value = e.slice(0, 7);
});
// O primeiro centro de custo escolhido vale para os serviços ainda sem centro.
watch(
  () => linhas.value[0]?.centro,
  (c) => {
    if (c) for (const l of linhas.value) if (!l.centro) l.centro = c;
  },
);
const itemDoPedido = (l: Linha) => pedido.value?.itens.find((i) => i.id === l.pedidoItem) ?? null;
const itensDominio = computed(() =>
  linhas.value.map((l) => ({
    servico: Number(l.servico) || 0,
    pedidoItem: l.pedidoItem,
    quantidade: num(l.quantidade),
    valorUnitario: num(l.valorUnitario),
    valorDesconto: num(l.valorDesconto),
    inssNaoRetido: num(l.inssNaoRetido),
    processoJudicial: l.processo.trim() || null,
  })),
);
const bruto = computed(() => itensDominio.value.reduce((s, i) => s + valorDoItem(i), 0));
const convertido = computed(() =>
  emMoeda.value && num(taxa.value) > 0 ? converterMoeda(num(valorMoeda.value), num(taxa.value)) : null,
);
const recusa = computed(() =>
  conferirEntradaServico({
    fornecedor: Number(fornecedor.value) || 0,
    dataEmissao: emissao.value,
    dataEntrada: dataEntrada.value,
    competencia: competencia.value,
    itens: itensDominio.value,
    pedido: pedido.value
      ? {
          id: pedido.value.id,
          fornecedor: pedido.value.fornecedor,
          situacao: pedido.value.situacao,
          natureza: 'servico',
          itens: pedido.value.itens.map((i) => ({
            id: i.id,
            servico: i.servico,
            quantidade: i.saldo,
            recebida: 0,
            cancelada: 0,
            valorUnitario: i.valorUnitario,
          })),
        }
      : null,
    issRetido: issRetido.value,
    aliquotaIss: aliquotaIss.value === '' ? null : Number(aliquotaIss.value),
    cambio: emMoeda.value ? { taxa: num(taxa.value), valorMoeda: num(valorMoeda.value) } : null,
  }),
);
const completo = computed(
  () =>
    !!fornecedor.value &&
    numeroDocumento.value.trim().length > 0 &&
    linhas.value.every((l) => !!l.servico && !!l.centro) &&
    (!emMoeda.value || !!moeda.value) &&
    bruto.value > 0,
);
const podeRegistrar = computed(() => completo.value && !recusa.value && !gravando.value);

// A prévia das retenções: a mesma regra da gravação, pedida ao servidor quando a nota muda.
const inssTotal = computed(() => itensDominio.value.reduce((s, i) => s + i.inssNaoRetido, 0));
const previa = useQuery({
  queryKey: computed(() => [
    'financeiro',
    'entrada-servico',
    'previa',
    fornecedor.value,
    bruto.value,
    emissao.value,
    issRetido.value,
    aliquotaIss.value,
    inssTotal.value,
  ]),
  queryFn: () =>
    lerPreviaRetencoes({
      fornecedor: Number(fornecedor.value),
      valor: bruto.value,
      emissao: emissao.value,
      issRetido: issRetido.value,
      aliquotaIss: aliquotaIss.value === '' ? null : Number(aliquotaIss.value),
      inssNaoRetido: inssTotal.value,
    }),
  enabled: computed(() => !!fornecedor.value && bruto.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(emissao.value)),
});
const retidoPrevia = computed(() =>
  (previa.data.value?.retencoes ?? []).reduce((s, r) => s + r.valorRetido, 0),
);

async function registrar() {
  if (!podeRegistrar.value) return;
  const ok = await acao((c) =>
    registrarEntradaServico(
      {
        fornecedor: Number(fornecedor.value),
        pedido: pedido.value?.id ?? null,
        numeroDocumento: numeroDocumento.value.trim(),
        serie: serie.value.trim() || null,
        dataEmissao: emissao.value,
        dataEntrada: dataEntrada.value,
        competencia: competencia.value,
        issRetido: issRetido.value,
        aliquotaIss: aliquotaIss.value === '' ? null : Number(aliquotaIss.value),
        observacao: observacao.value.trim() || null,
        itens: linhas.value.map((l, n) => ({
          ...itensDominio.value[n]!,
          descricao: null,
          centroCusto: Number(l.centro),
        })),
        cambio: emMoeda.value
          ? {
              moeda: Number(moeda.value),
              dataCotacao: dataCotacao.value,
              taxa: num(taxa.value),
              valorMoeda: num(valorMoeda.value),
              sugerido: false,
            }
          : null,
      },
      c,
    ),
  );
  if (ok) {
    numeroDocumento.value = '';
    serie.value = '';
    observacao.value = '';
    pedidoId.value = '';
    linhas.value = [novaLinha()];
  }
}

// ── Detalhe, conclusão e cancelamento ──────────────────────────────────────────────────────────────────────
const aberta = ref<EntradaServicoTela | null>(null);
const modo = ref<'detalhe' | 'concluir' | 'cancelar' | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['financeiro', 'entrada-servico', 'detalhe', aberta.value?.id ?? 0]),
  queryFn: () => lerDetalheEntradaServico(aberta.value!.id),
  enabled: computed(() => modo.value === 'detalhe' && !!aberta.value),
});
const titulo = ref<number | ''>('');
const justificativa = ref('');
const recusaCancelamento = computed(() =>
  aberta.value
    ? conferirCancelamentoEntrada({
        situacao: aberta.value.situacao,
        justificativa: justificativa.value,
        declaradaReinf: false,
        tituloPago: false,
      })
    : null,
);
function abrir(e: EntradaServicoTela, m: 'detalhe' | 'concluir' | 'cancelar') {
  aberta.value = e;
  modo.value = m;
  titulo.value = e.titulo ?? '';
  justificativa.value = '';
}
function fechar() {
  aberta.value = null;
  modo.value = null;
}
async function concluir() {
  const e = aberta.value;
  if (!e) return;
  if (
    await acao((c) =>
      concluirEntradaServico(e.id, e.versao, titulo.value === '' ? null : Number(titulo.value), c),
    )
  )
    fechar();
}
async function cancelar() {
  const e = aberta.value;
  if (!e || recusaCancelamento.value) return;
  if (await acao((c) => cancelarEntradaServico(e.id, e.versao, justificativa.value.trim(), c))) fechar();
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="es-titulo" data-testid="tela-fin-entrada-servico">
    <h1 id="es-titulo">{{ t('financeiro.entradaServico.titulo') }}</h1>
    <p>{{ t('financeiro.entradaServico.texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="apoio.error.value" :erro="apoio.error.value" />

    <form
      v-if="podeGravar"
      class="formulario"
      :aria-label="t('financeiro.entradaServico.registrar')"
      data-testid="es-registrar"
      @submit.prevent="registrar"
    >
      <h2>{{ t('financeiro.entradaServico.registrar') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="fornecedor"
          :rotulo="t('financeiro.entradaServico.fornecedor')"
          :opcoes="opcoesFornecedor"
          data-testid="es-fornecedor"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="pedidoId"
          :rotulo="t('financeiro.entradaServico.pedido')"
          :opcoes="opcoesPedido"
          data-testid="es-pedido"
        />
      </span>
      <label class="campo">
        {{ t('financeiro.entradaServico.numeroDocumento') }}
        <input v-model="numeroDocumento" maxlength="20" data-testid="es-numero-documento" />
      </label>
      <label class="campo">
        {{ t('financeiro.entradaServico.serie') }}
        <input v-model="serie" maxlength="10" data-testid="es-serie" />
      </label>
      <label class="campo">
        {{ t('financeiro.entradaServico.emissao') }}
        <input v-model="emissao" type="date" data-testid="es-emissao" />
      </label>
      <label class="campo">
        {{ t('financeiro.entradaServico.dataEntrada') }}
        <input v-model="dataEntrada" type="date" data-testid="es-data-entrada" />
      </label>
      <label class="campo">
        {{ t('financeiro.entradaServico.competencia') }}
        <input v-model="competencia" type="month" data-testid="es-competencia" />
      </label>

      <fieldset data-testid="es-itens">
        <legend>{{ t('financeiro.entradaServico.itens') }}</legend>
        <div v-for="(l, n) in linhas" :key="n" class="formulario" :data-testid="`es-item-${n}`">
          <span class="campo">
            <SanteSelecao
              v-model="l.servico"
              :rotulo="t('financeiro.entradaServico.servico')"
              :opcoes="opcoesServico"
              :desabilitado="l.pedidoItem !== null"
              :data-testid="`es-item-servico-${n}`"
            />
          </span>
          <label class="campo">
            {{ t('financeiro.entradaServico.quantidade') }}
            <input
              v-model.number="l.quantidade"
              type="number"
              min="0"
              step="0.0001"
              :data-testid="`es-item-quantidade-${n}`"
            />
          </label>
          <label class="campo">
            {{ t('financeiro.entradaServico.valorUnitario') }}
            <input
              v-model.number="l.valorUnitario"
              type="number"
              min="0"
              step="0.01"
              :data-testid="`es-item-valor-${n}`"
            />
          </label>
          <label class="campo">
            {{ t('financeiro.entradaServico.desconto') }}
            <input
              v-model.number="l.valorDesconto"
              type="number"
              min="0"
              step="0.01"
              :data-testid="`es-item-desconto-${n}`"
            />
          </label>
          <span class="campo">
            <SanteSelecao
              v-model="l.centro"
              :rotulo="t('financeiro.entradaServico.centro')"
              :opcoes="opcoesCentro"
              :data-testid="`es-item-centro-${n}`"
            />
          </span>
          <label class="campo">
            {{ t('financeiro.entradaServico.inssNaoRetido') }}
            <input
              v-model.number="l.inssNaoRetido"
              type="number"
              min="0"
              step="0.01"
              :data-testid="`es-item-inss-${n}`"
            />
          </label>
          <label v-if="num(l.inssNaoRetido) > 0" class="campo">
            {{ t('financeiro.entradaServico.processo') }}
            <input v-model="l.processo" maxlength="21" :data-testid="`es-item-processo-${n}`" />
          </label>
          <small v-if="itemDoPedido(l)" :data-testid="`es-item-saldo-${n}`">
            {{
              t('financeiro.entradaServico.saldoPedido', {
                saldo: itemDoPedido(l)!.saldo,
                preco: reais(itemDoPedido(l)!.valorUnitario),
              })
            }}
          </small>
          <button
            v-if="linhas.length > 1"
            type="button"
            :data-testid="`es-item-remover-${n}`"
            @click="linhas.splice(n, 1)"
          >
            {{ t('financeiro.entradaServico.removerItem', { n: n + 1 }) }}
          </button>
        </div>
        <button type="button" data-testid="es-item-adicionar" @click="linhas.push(novaLinha())">
          {{ t('financeiro.entradaServico.adicionarItem') }}
        </button>
      </fieldset>

      <label class="campo">
        <input v-model="issRetido" type="checkbox" data-testid="es-iss-retido" />
        {{ t('financeiro.entradaServico.issRetido') }}
      </label>
      <label v-if="issRetido" class="campo">
        {{ t('financeiro.entradaServico.aliquotaIss') }}
        <input
          v-model.number="aliquotaIss"
          type="number"
          min="0"
          max="100"
          step="0.01"
          data-testid="es-aliquota-iss"
        />
      </label>
      <label class="campo">
        <input v-model="emMoeda" type="checkbox" data-testid="es-em-moeda" />
        {{ t('financeiro.entradaServico.moedaEstrangeira') }}
      </label>
      <template v-if="emMoeda">
        <span class="campo">
          <SanteSelecao
            v-model="moeda"
            :rotulo="t('financeiro.entradaServico.moeda')"
            :opcoes="opcoesMoeda"
            data-testid="es-moeda"
          />
        </span>
        <label class="campo">
          {{ t('financeiro.entradaServico.dataCotacao') }}
          <input v-model="dataCotacao" type="date" data-testid="es-data-cotacao" />
        </label>
        <label class="campo">
          {{ t('financeiro.entradaServico.taxa') }}
          <input v-model.number="taxa" type="number" min="0" step="0.000001" data-testid="es-taxa" />
        </label>
        <label class="campo">
          {{ t('financeiro.entradaServico.valorMoeda') }}
          <input v-model.number="valorMoeda" type="number" min="0" step="0.01" data-testid="es-valor-moeda" />
        </label>
        <p v-if="convertido !== null" data-testid="es-convertido">
          {{ t('financeiro.entradaServico.convertido', { valor: reais(convertido) }) }}
        </p>
      </template>
      <label class="campo">
        {{ t('financeiro.entradaServico.observacao') }}
        <textarea v-model="observacao" maxlength="2000" data-testid="es-observacao" />
      </label>

      <h3>{{ t('financeiro.entradaServico.previa') }}</h3>
      <table v-if="previa.data.value" class="tabela" data-testid="es-previa">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.entradaServico.tributo') }}</th>
            <th scope="col">{{ t('financeiro.entradaServico.base') }}</th>
            <th scope="col">{{ t('financeiro.entradaServico.aliquota') }}</th>
            <th scope="col">{{ t('financeiro.entradaServico.retido') }}</th>
            <th scope="col">{{ t('financeiro.entradaServico.naoRetido') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in previa.data.value.retencoes"
            :key="r.tributo"
            :data-testid="`es-previa-${r.tributo}`"
          >
            <td>
              {{ r.tributo }}
              <small v-if="r.dispensada">· {{ t('financeiro.entradaServico.dispensada') }}</small>
            </td>
            <td>{{ reais(r.base) }}</td>
            <td>{{ r.aliquota }}%</td>
            <td>{{ reais(r.valorRetido) }}</td>
            <td>{{ reais(r.valorNaoRetido) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="es-sem-previa">{{ t('financeiro.entradaServico.semPrevia') }}</p>
      <ErroFaturamento v-if="previa.error.value" :erro="previa.error.value" />
      <p data-testid="es-totais">
        {{
          t('financeiro.entradaServico.totalBruto', {
            bruto: reais(bruto),
            retido: reais(retidoPrevia),
            liquido: reais(previa.data.value?.liquido ?? bruto),
          })
        }}
      </p>
      <p v-if="recusa && completo" role="alert" data-testid="es-recusa">{{ recusa.mensagem }}</p>
      <button type="submit" :disabled="!podeRegistrar" data-testid="es-gravar">
        {{ t('financeiro.entradaServico.gravar') }}
      </button>
    </form>

    <h2>{{ t('financeiro.entradaServico.lista') }}</h2>
    <div class="formulario" :aria-label="t('financeiro.entradaServico.filtros')">
      <label class="campo">
        {{ t('financeiro.entradaServico.competencia') }}
        <input v-model="filtroCompetencia" type="month" data-testid="es-filtro-competencia" />
      </label>
      <span class="campo">
        <SanteSelecao
          v-model="filtroSituacao"
          :rotulo="t('financeiro.entradaServico.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="es-filtro-situacao"
        />
      </span>
    </div>
    <ErroFaturamento v-if="entradas.error.value" :erro="entradas.error.value" />
    <table v-if="entradas.data.value?.length" class="tabela" data-testid="es-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.entradaServico.numero') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.nota') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.fornecedor') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.pedido') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.bruto') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.retido') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.liquido') }}</th>
          <th scope="col">{{ t('financeiro.entradaServico.situacao') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in entradas.data.value" :key="e.id" :data-testid="`es-entrada-${e.id}`">
          <td>{{ e.numero }}</td>
          <td>{{ e.serie ? `${e.documento}/${e.serie}` : e.documento }}</td>
          <td>{{ e.fornecedor }}</td>
          <td>{{ e.pedido ?? '—' }}</td>
          <td>{{ reais(e.valorBruto) }}</td>
          <td>{{ reais(e.retido) }}</td>
          <td>{{ reais(e.liquido) }}</td>
          <td :data-testid="`es-situacao-${e.id}`">
            {{ t(`financeiro.entradaServico.situacoes.${e.situacao}`) }}
          </td>
          <td>
            <button type="button" :data-testid="`es-ver-${e.id}`" @click="abrir(e, 'detalhe')">
              {{ t('financeiro.entradaServico.ver') }}
            </button>
            <button
              v-if="podeGravar && e.situacao === 'aberta'"
              type="button"
              :disabled="gravando"
              :data-testid="`es-concluir-${e.id}`"
              @click="abrir(e, 'concluir')"
            >
              {{ t('financeiro.entradaServico.concluir') }}
            </button>
            <button
              v-if="podeGravar && e.situacao !== 'cancelada'"
              type="button"
              :disabled="gravando"
              :data-testid="`es-cancelar-${e.id}`"
              @click="abrir(e, 'cancelar')"
            >
              {{ t('financeiro.entradaServico.cancelar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="entradas.data.value" data-testid="es-sem-entradas">
      {{ t('financeiro.entradaServico.semEntradas') }}
    </p>

    <section v-if="aberta && modo === 'detalhe'" class="formulario" data-testid="es-detalhe">
      <h2>{{ t('financeiro.entradaServico.detalhe', { numero: aberta.numero }) }}</h2>
      <ErroFaturamento v-if="detalhe.error.value" :erro="detalhe.error.value" />
      <template v-if="detalhe.data.value">
        <p>
          {{ detalhe.data.value.fornecedor }} · {{ data(detalhe.data.value.emissao ?? '') }} ·
          {{ detalhe.data.value.competencia }}
        </p>
        <table class="tabela" data-testid="es-detalhe-itens">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.entradaServico.servico') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.quantidade') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.valorUnitario') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.bruto') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.centro') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in detalhe.data.value.itens" :key="i.sequencia">
              <td>
                {{ i.servico }}
                <small v-if="i.doPedido">· {{ t('financeiro.entradaServico.doPedido') }}</small>
              </td>
              <td>{{ i.quantidade }}</td>
              <td>{{ reais(i.valorUnitario) }}</td>
              <td>{{ reais(i.valorTotal) }}</td>
              <td>{{ i.centro }}</td>
            </tr>
          </tbody>
        </table>
        <table class="tabela" data-testid="es-detalhe-retencoes">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.entradaServico.tributo') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.base') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.devido') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.retido') }}</th>
              <th scope="col">{{ t('financeiro.entradaServico.naoRetido') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in detalhe.data.value.retencoes" :key="r.tributo">
              <td>
                {{ r.tributo }}
                <small v-if="r.dispensada">· {{ t('financeiro.entradaServico.dispensada') }}</small>
              </td>
              <td>{{ reais(r.base) }}</td>
              <td>{{ reais(r.devido) }}</td>
              <td>{{ reais(r.retido) }}</td>
              <td>{{ reais(r.naoRetido) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="detalhe.data.value.cambio" data-testid="es-detalhe-cambio">
          {{
            t('financeiro.entradaServico.cambio', {
              moeda: detalhe.data.value.cambio.moeda,
              valorMoeda: detalhe.data.value.cambio.valorMoeda,
              taxa: detalhe.data.value.cambio.taxa,
              convertido: reais(detalhe.data.value.cambio.valorConvertido),
            })
          }}
        </p>
      </template>
      <button type="button" data-testid="es-fechar" @click="fechar">
        {{ t('financeiro.entradaServico.fechar') }}
      </button>
    </section>

    <form
      v-if="aberta && modo === 'concluir'"
      class="formulario"
      :aria-label="t('financeiro.entradaServico.concluir')"
      data-testid="es-conclusao"
      @submit.prevent="concluir"
    >
      <h2>{{ t('financeiro.entradaServico.detalhe', { numero: aberta.numero }) }}</h2>
      <label class="campo">
        {{ t('financeiro.entradaServico.tituloPagar') }}
        <input v-model.number="titulo" type="number" min="1" step="1" data-testid="es-titulo" />
      </label>
      <button type="submit" :disabled="gravando" data-testid="es-confirmar-conclusao">
        {{ t('financeiro.entradaServico.confirmarConclusao') }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.entradaServico.fechar') }}</button>
    </form>

    <form
      v-if="aberta && modo === 'cancelar'"
      class="formulario"
      :aria-label="t('financeiro.entradaServico.cancelar')"
      data-testid="es-cancelamento"
      @submit.prevent="cancelar"
    >
      <h2>{{ t('financeiro.entradaServico.detalhe', { numero: aberta.numero }) }}</h2>
      <label class="campo">
        {{ t('financeiro.entradaServico.justificativa') }}
        <textarea v-model="justificativa" maxlength="2000" data-testid="es-justificativa" />
      </label>
      <p v-if="recusaCancelamento" role="alert" data-testid="es-recusa-cancelamento">
        {{ recusaCancelamento.mensagem }}
      </p>
      <button
        type="submit"
        :disabled="gravando || !!recusaCancelamento"
        data-testid="es-confirmar-cancelamento"
      >
        {{ t('financeiro.entradaServico.confirmarCancelamento') }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.entradaServico.fechar') }}</button>
    </form>
  </section>
</template>
