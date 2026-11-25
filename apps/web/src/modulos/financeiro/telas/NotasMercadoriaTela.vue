<script setup lang="ts">
// NF-e de saída de mercadoria (F7, 07-FIN linha 114, C2-059): `/financeiro/fiscal/notas-mercadoria`. Desenho próprio:
// a devolução ao fornecedor (e a do consignado) registrada no estoque aparece na fila "sem nota" e vira NF-e com um
// clique: itens, lote e a nota de entrada referenciada vêm da devolução, sem redigitar. A remessa para conserto e a
// saída avulsa (simples remessa, venda a terceiro) se montam na tela: o CFOP da natureza e os totais (produtos,
// desconto, frete, ICMS, IPI) aparecem na hora pela MESMA regra do domínio que o servidor aplica (calcularNfeSaida).
// Cancelar e a carta de correção são eventos conferidos enquanto se digita (conferirCancelamentoNfe,
// conferirCartaCorrecao); a nota cancelada fica no histórico, com os eventos. O DANFE abre em outra janela.
import {
  calcularNfeSaida,
  conferirCancelamentoNfe,
  conferirCartaCorrecao,
  NATUREZAS_NFE_PADRAO,
  type ParteNfe,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  cancelarNotaMercadoria,
  corrigirNotaMercadoria,
  emitirNotaMercadoria,
  lerApoioNotaMercadoria,
  lerDanfeNotaMercadoria,
  lerHistoricoNotaMercadoria,
  lerNotasMercadoria,
  type NotaMercadoriaTela,
} from '../api-nota-mercadoria.js';
import { data, quando, reais, usarFinanceiro } from '../usar-financeiro.js';

const PERM_EMITIR = 'financeiro.notaMercadoria.emitir';
const SITUACOES = ['autorizada', 'rejeitada', 'assinada', 'cancelada'] as const;
const CSTS = ['00', '40', '41', '50', '90'] as const;
const { t } = useI18n();
const qc = useQueryClient();
const { tem } = usarFinanceiro();
const podeGravar = computed(() => tem(PERM_EMITIR));

const apoio = useQuery({
  queryKey: ['financeiro', 'nota-mercadoria', 'apoio'],
  queryFn: lerApoioNotaMercadoria,
});
const filtro = ref('');
const opcoesFiltro = computed(() => [
  { valor: '', rotulo: t('financeiro.notaMercadoria.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: t(`financeiro.notaMercadoria.situacoes.${s}`) })),
]);
const notas = useQuery({
  queryKey: computed(() => ['financeiro', 'nota-mercadoria', 'lista', filtro.value]),
  queryFn: () => lerNotasMercadoria(filtro.value || null),
});

// ── Gravação comum: mensagem do servidor, nova chave e releitura ───────────────────────────────────────────
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('nota-mercadoria');
async function acao(f: (c: string) => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('nota-mercadoria');
    await qc.invalidateQueries({ queryKey: ['financeiro', 'nota-mercadoria'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Devolução sem nota: um clique ──────────────────────────────────────────────────────────────────────────
const emitirDaDevolucao = (devolucao: number) =>
  acao((c) => emitirNotaMercadoria({ origem: 'devolucao_fornecedor', devolucao }, c));

// ── Conserto ou saída avulsa ───────────────────────────────────────────────────────────────────────────────
const origem = ref<'conserto' | 'avulsa'>('conserto');
const opcoesOrigem = computed(() =>
  (['conserto', 'avulsa'] as const).map((o) => ({
    valor: o,
    rotulo: t(`financeiro.notaMercadoria.origens.${o}`),
  })),
);
// Avulsa: só as naturezas que não pedem nota de origem (a devolução nasce da devolução registrada).
const naturezasAvulsa = computed(() =>
  (apoio.data.value?.naturezas ?? []).filter(
    (n) => n.ativa && !n.exigeReferencia && n.finalidade !== 'conserto',
  ),
);
const naturezaCodigo = ref('');
const opcoesNatureza = computed(() => [
  { valor: '', rotulo: t('financeiro.notaMercadoria.escolhaNatureza') },
  ...naturezasAvulsa.value.map((n) => ({ valor: n.codigo, rotulo: n.descricao })),
]);
const natureza = computed(() => {
  const codigo = origem.value === 'conserto' ? 'remessa_conserto' : naturezaCodigo.value;
  return (apoio.data.value?.naturezas ?? []).find((n) => n.codigo === codigo) ?? null;
});
const tipoDestinatario = ref<'fornecedor' | 'cliente'>('fornecedor');
watch(origem, (o) => {
  if (o === 'conserto') tipoDestinatario.value = 'fornecedor';
});
const opcoesTipoDestinatario = computed(() =>
  (['fornecedor', 'cliente'] as const).map((d) => ({
    valor: d,
    rotulo: t(`financeiro.notaMercadoria.tiposDestinatario.${d}`),
  })),
);
const destinatarioId = ref('');
watch(tipoDestinatario, () => (destinatarioId.value = ''));
const opcoesDestinatario = computed(() => [
  { valor: '', rotulo: t('financeiro.notaMercadoria.escolhaDestinatario') },
  ...(
    (tipoDestinatario.value === 'fornecedor' ? apoio.data.value?.fornecedores : apoio.data.value?.clientes) ??
    []
  ).map((d) => ({ valor: String(d.id), rotulo: d.rotulo })),
]);

interface LinhaItem {
  chave: number;
  insumo: string;
  quantidade: number | '';
  valorUnitario: number | '';
  desconto: number | '';
  lote: string;
}
let proxima = 1;
const novaLinha = (): LinhaItem => ({
  chave: proxima++,
  insumo: '',
  quantidade: '',
  valorUnitario: '',
  desconto: 0,
  lote: '',
});
const itens = ref<LinhaItem[]>([novaLinha()]);
const opcoesInsumo = computed(() => [
  { valor: '', rotulo: t('financeiro.notaMercadoria.escolhaInsumo') },
  ...(apoio.data.value?.insumos ?? []).map((i) => ({ valor: String(i.id), rotulo: i.rotulo })),
]);
const ncmDe = (insumo: string) => apoio.data.value?.insumos.find((i) => String(i.id) === insumo)?.ncm ?? '';
const cstIcms = ref<(typeof CSTS)[number]>('90');
const opcoesCst = computed(() =>
  CSTS.map((c) => ({ valor: c, rotulo: t(`financeiro.notaMercadoria.csts.${c}`) })),
);
const aliquotaIcms = ref<number | ''>(0);
const aliquotaIpi = ref<number | ''>(0);
const frete = ref<number | ''>(0);
const complemento = ref('');
const num = (v: number | '') => (v === '' ? 0 : Number(v) || 0);

const itensValidos = computed(() =>
  itens.value.filter((i) => i.insumo !== '' && num(i.quantidade) > 0 && i.valorUnitario !== ''),
);
// Os totais pela regra do domínio. A UF das partes só decide o CFOP, que a tela mostra pelas duas colunas da natureza.
const PARTE: ParteNfe = {
  documento: '',
  nome: '',
  uf: 'SP',
  municipioIbge: null,
  municipio: null,
  inscricaoEstadual: null,
  contribuinteIcms: true,
};
const totais = computed(() => {
  const n = natureza.value;
  const padrao = NATUREZAS_NFE_PADRAO.find((p) => p.codigo === n?.codigo);
  if (!n || !padrao || !itensValidos.value.length) return null;
  return calcularNfeSaida({
    natureza: { ...padrao, cfopDentro: n.cfopDentro, cfopFora: n.cfopFora },
    emitente: PARTE,
    destinatario: PARTE,
    referencias: [],
    itens: itensValidos.value.map((i) => ({
      codigo: i.insumo,
      descricao: '',
      ncm: ncmDe(i.insumo),
      unidade: 'UN',
      quantidade: num(i.quantidade),
      valorUnitario: num(i.valorUnitario),
      desconto: num(i.desconto),
      lote: i.lote.trim() || null,
      fabricacao: null,
      validade: null,
      registroAnvisa: null,
      cstIcms: cstIcms.value,
      aliquotaIcms: num(aliquotaIcms.value),
      aliquotaIpi: num(aliquotaIpi.value),
    })),
    valorFrete: num(frete.value),
    informacaoComplementar: null,
  });
});
const podeMontar = computed(
  () =>
    podeGravar.value &&
    !gravando.value &&
    !!natureza.value &&
    destinatarioId.value !== '' &&
    itensValidos.value.length === itens.value.length &&
    !!totais.value,
);
async function emitirMontada() {
  if (!podeMontar.value || !natureza.value) return;
  const dest = Number(destinatarioId.value);
  const ok = await acao((c) =>
    emitirNotaMercadoria(
      {
        origem: origem.value,
        natureza: origem.value === 'avulsa' ? (natureza.value?.codigo ?? null) : null,
        fornecedor: tipoDestinatario.value === 'fornecedor' ? dest : null,
        cliente: tipoDestinatario.value === 'cliente' ? dest : null,
        itens: itensValidos.value.map((i) => ({
          insumo: Number(i.insumo),
          quantidade: num(i.quantidade),
          valorUnitario: num(i.valorUnitario),
          desconto: num(i.desconto),
          lote: i.lote.trim() || null,
        })),
        tributos: {
          cstIcms: cstIcms.value,
          aliquotaIcms: num(aliquotaIcms.value),
          aliquotaIpi: num(aliquotaIpi.value),
        },
        valorFrete: num(frete.value),
        informacaoComplementar: complemento.value.trim() || null,
      },
      c,
    ),
  );
  if (ok) {
    itens.value = [novaLinha()];
    destinatarioId.value = '';
    frete.value = 0;
    complemento.value = '';
  }
}

// ── Histórico, DANFE, cancelamento e carta de correção ────────────────────────────────────────────────────
const aberta = ref<NotaMercadoriaTela | null>(null);
const modo = ref<'historico' | 'cancelar' | 'corrigir' | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['financeiro', 'nota-mercadoria', 'historico', aberta.value?.nota ?? 0]),
  queryFn: () => lerHistoricoNotaMercadoria(aberta.value?.nota ?? 0),
  enabled: computed(() => modo.value === 'historico' && !!aberta.value),
});
const motivo = ref('');
const justificativa = ref('');
const textoCorrecao = ref('');
const opcoesMotivo = computed(() => [
  { valor: '', rotulo: t('financeiro.notaMercadoria.escolhaMotivo') },
  ...(apoio.data.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.rotulo })),
]);
function abrir(n: NotaMercadoriaTela, m: 'historico' | 'cancelar' | 'corrigir') {
  aberta.value = n;
  modo.value = m;
  motivo.value = '';
  justificativa.value = '';
  textoCorrecao.value = '';
}
function fechar() {
  aberta.value = null;
  modo.value = null;
}
const recusaCancelamento = computed(() => {
  const n = aberta.value;
  if (!n) return null;
  return conferirCancelamentoNfe({
    situacao: n.situacao,
    autorizadaEm: n.autorizadaEm ? new Date(n.autorizadaEm) : null,
    agora: new Date(),
    justificativa: justificativa.value,
  });
});
const conferenciaCorrecao = computed(() =>
  aberta.value
    ? conferirCartaCorrecao({
        situacao: aberta.value.situacao,
        texto: textoCorrecao.value,
        cartasAnteriores: aberta.value.cartasCorrecao,
      })
    : null,
);
async function confirmarCancelamento() {
  const n = aberta.value;
  if (!n || !motivo.value || recusaCancelamento.value) return;
  if (await acao((c) => cancelarNotaMercadoria(n.nota, Number(motivo.value), justificativa.value.trim(), c)))
    fechar();
}
async function confirmarCorrecao() {
  const n = aberta.value;
  if (!n || !conferenciaCorrecao.value?.ok) return;
  if (await acao((c) => corrigirNotaMercadoria(n.nota, textoCorrecao.value.trim(), c))) fechar();
}
async function abrirDanfe(n: NotaMercadoriaTela) {
  erro.value = null;
  mensagem.value = null;
  try {
    const { html } = await lerDanfeNotaMercadoria(n.nota);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const janela = window.open(url, '_blank', 'noopener');
    if (!janela) mensagem.value = t('financeiro.notaMercadoria.danfeBloqueado');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nfe-titulo" data-testid="tela-fin-nota-mercadoria">
    <h1 id="nfe-titulo">{{ t('financeiro.notaMercadoria.titulo') }}</h1>
    <p>{{ t('financeiro.notaMercadoria.texto') }}</p>
    <p v-if="apoio.data.value?.destino === 'simulador'" data-testid="nfe-simulador">
      {{ t('financeiro.notaMercadoria.simulador') }}
    </p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="apoio.error.value" :erro="apoio.error.value" />

    <h2>{{ t('financeiro.notaMercadoria.devolucoes') }}</h2>
    <table v-if="apoio.data.value?.devolucoes.length" class="tabela" data-testid="nfe-devolucoes">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.notaMercadoria.devolucaoRotulo', { numero: '' }) }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.fornecedor') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.itens') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.valor') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.devolvidaEm') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="d in apoio.data.value.devolucoes"
          :key="d.devolucao"
          :data-testid="`nfe-devolucao-${d.devolucao}`"
        >
          <td>
            {{ d.numero }}
            <small v-if="d.consignado">· {{ t('financeiro.notaMercadoria.consignado') }}</small>
          </td>
          <td>{{ d.fornecedor }}</td>
          <td>{{ d.itens }}</td>
          <td>{{ reais(d.valor) }}</td>
          <td>{{ d.devolvidaEm ? data(d.devolvidaEm) : '—' }}</td>
          <td>
            <button
              type="button"
              :disabled="gravando || !podeGravar"
              :data-testid="`nfe-emitir-devolucao-${d.devolucao}`"
              @click="emitirDaDevolucao(d.devolucao)"
            >
              {{ t('financeiro.notaMercadoria.emitirDevolucao') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="apoio.data.value" data-testid="nfe-sem-devolucao">
      {{ t('financeiro.notaMercadoria.semDevolucao') }}
    </p>

    <form
      v-if="podeGravar"
      class="formulario"
      :aria-label="t('financeiro.notaMercadoria.montar')"
      data-testid="nfe-montar"
      @submit.prevent="emitirMontada"
    >
      <h2>{{ t('financeiro.notaMercadoria.montar') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="origem"
          :rotulo="t('financeiro.notaMercadoria.origem')"
          :opcoes="opcoesOrigem"
          data-testid="nfe-origem"
        />
      </span>
      <span v-if="origem === 'avulsa'" class="campo">
        <SanteSelecao
          v-model="naturezaCodigo"
          :rotulo="t('financeiro.notaMercadoria.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="nfe-natureza"
        />
      </span>
      <p v-if="natureza" data-testid="nfe-cfop">
        {{ natureza.descricao }} ·
        {{
          t('financeiro.notaMercadoria.cfopDaNatureza', {
            dentro: natureza.cfopDentro,
            fora: natureza.cfopFora,
          })
        }}
      </p>
      <span v-if="origem === 'avulsa'" class="campo">
        <SanteSelecao
          v-model="tipoDestinatario"
          :rotulo="t('financeiro.notaMercadoria.tipoDestinatario')"
          :opcoes="opcoesTipoDestinatario"
          data-testid="nfe-tipo-destinatario"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="destinatarioId"
          :rotulo="t('financeiro.notaMercadoria.destinatario')"
          :opcoes="opcoesDestinatario"
          data-testid="nfe-destinatario"
        />
      </span>

      <fieldset v-for="(i, k) in itens" :key="i.chave" :data-testid="`nfe-item-${k}`">
        <legend>{{ t('financeiro.notaMercadoria.item') }} {{ k + 1 }}</legend>
        <span class="campo">
          <SanteSelecao
            v-model="i.insumo"
            :rotulo="t('financeiro.notaMercadoria.item')"
            :opcoes="opcoesInsumo"
            :data-testid="`nfe-item-insumo-${k}`"
          />
        </span>
        <small v-if="i.insumo">
          {{ t('financeiro.notaMercadoria.ncm') }}:
          {{ ncmDe(i.insumo) || t('financeiro.notaMercadoria.semNcm') }}
        </small>
        <span class="campo">
          <label :for="`nfe-item-qtd-${k}`">{{ t('financeiro.notaMercadoria.quantidade') }}</label>
          <input
            :id="`nfe-item-qtd-${k}`"
            v-model.number="i.quantidade"
            type="number"
            min="0"
            step="0.0001"
            :data-testid="`nfe-item-quantidade-${k}`"
          />
        </span>
        <span class="campo">
          <label :for="`nfe-item-valor-${k}`">{{ t('financeiro.notaMercadoria.valorUnitario') }}</label>
          <input
            :id="`nfe-item-valor-${k}`"
            v-model.number="i.valorUnitario"
            type="number"
            min="0"
            step="0.01"
            :data-testid="`nfe-item-valor-${k}`"
          />
        </span>
        <span class="campo">
          <label :for="`nfe-item-desconto-${k}`">{{ t('financeiro.notaMercadoria.desconto') }}</label>
          <input
            :id="`nfe-item-desconto-${k}`"
            v-model.number="i.desconto"
            type="number"
            min="0"
            step="0.01"
          />
        </span>
        <span class="campo">
          <label :for="`nfe-item-lote-${k}`">{{ t('financeiro.notaMercadoria.lote') }}</label>
          <input :id="`nfe-item-lote-${k}`" v-model="i.lote" maxlength="20" />
        </span>
        <button v-if="itens.length > 1" type="button" @click="itens.splice(k, 1)">
          {{ t('financeiro.notaMercadoria.removerItem') }}
        </button>
      </fieldset>
      <button type="button" data-testid="nfe-incluir-item" @click="itens.push(novaLinha())">
        {{ t('financeiro.notaMercadoria.incluirItem') }}
      </button>

      <span class="campo">
        <SanteSelecao
          v-model="cstIcms"
          :rotulo="t('financeiro.notaMercadoria.cstIcms')"
          :opcoes="opcoesCst"
          data-testid="nfe-cst"
        />
      </span>
      <span class="campo">
        <label for="nfe-icms">{{ t('financeiro.notaMercadoria.aliquotaIcms') }}</label>
        <input id="nfe-icms" v-model.number="aliquotaIcms" type="number" min="0" max="100" step="0.01" />
      </span>
      <span class="campo">
        <label for="nfe-ipi">{{ t('financeiro.notaMercadoria.aliquotaIpi') }}</label>
        <input id="nfe-ipi" v-model.number="aliquotaIpi" type="number" min="0" max="100" step="0.01" />
      </span>
      <span class="campo">
        <label for="nfe-frete">{{ t('financeiro.notaMercadoria.frete') }}</label>
        <input id="nfe-frete" v-model.number="frete" type="number" min="0" step="0.01" />
      </span>
      <span class="campo">
        <label for="nfe-complemento">{{ t('financeiro.notaMercadoria.informacaoComplementar') }}</label>
        <textarea id="nfe-complemento" v-model="complemento" maxlength="2000"></textarea>
      </span>

      <p class="resumo" aria-live="polite" data-testid="nfe-totais">
        <span v-if="totais">
          {{
            t('financeiro.notaMercadoria.totais', {
              produtos: reais(totais.valorProdutos),
              desconto: reais(totais.valorDesconto),
              frete: reais(totais.valorFrete),
              icms: reais(totais.valorIcms),
              ipi: reais(totais.valorIpi),
              total: reais(totais.valorTotal),
            })
          }}
        </span>
        <span v-else role="status">{{ t('financeiro.notaMercadoria.faltaItem') }}</span>
      </p>
      <button type="submit" :disabled="!podeMontar" data-testid="nfe-emitir">
        {{ t('financeiro.notaMercadoria.emitir') }}
      </button>
    </form>

    <h2>{{ t('financeiro.notaMercadoria.notas') }}</h2>
    <span class="campo">
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('financeiro.notaMercadoria.filtroSituacao')"
        :opcoes="opcoesFiltro"
        data-testid="nfe-filtro"
      />
    </span>
    <ErroFaturamento v-if="notas.error.value" :erro="notas.error.value" />
    <table v-else-if="notas.data.value?.length" class="tabela" data-testid="nfe-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.notaMercadoria.numero') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.emissao') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.destinatario') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.natureza') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.cfop') }}</th>
          <th scope="col">{{ t('financeiro.notaMercadoria.valorTotal') }}</th>
          <th scope="col">{{ t('financeiro.situacao') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in notas.data.value" :key="n.nota" :data-testid="`nfe-linha-${n.nota}`">
          <td>
            {{ n.numero }} / {{ n.serie }}
            <small v-if="n.homologacao">· {{ t('financeiro.notaMercadoria.homologacao') }}</small>
          </td>
          <td>{{ n.emissao ? quando(n.emissao) : '—' }}</td>
          <td>{{ n.destinatario }}</td>
          <td>{{ n.naturezaDescricao }}</td>
          <td>{{ n.cfop }}</td>
          <td>{{ reais(n.valorTotal) }}</td>
          <td :data-testid="`nfe-situacao-${n.nota}`">
            {{ t(`financeiro.notaMercadoria.situacoes.${n.situacao}`) }}
            <small v-if="n.cartasCorrecao"
              >· {{ t('financeiro.notaMercadoria.cartas', { n: n.cartasCorrecao }) }}</small
            >
            <small v-if="n.retorno && n.situacao === 'rejeitada'">· {{ n.retorno }}</small>
          </td>
          <td>
            <button type="button" :data-testid="`nfe-historico-${n.nota}`" @click="abrir(n, 'historico')">
              {{ t('financeiro.notaMercadoria.historico') }}
            </button>
            <button type="button" :data-testid="`nfe-danfe-${n.nota}`" @click="abrirDanfe(n)">
              {{ t('financeiro.notaMercadoria.danfe') }}
            </button>
            <template v-if="n.situacao === 'autorizada' && podeGravar">
              <button
                type="button"
                :disabled="gravando"
                :data-testid="`nfe-corrigir-${n.nota}`"
                @click="abrir(n, 'corrigir')"
              >
                {{ t('financeiro.notaMercadoria.corrigirNota') }}
              </button>
              <button
                type="button"
                :disabled="gravando"
                :data-testid="`nfe-cancelar-${n.nota}`"
                @click="abrir(n, 'cancelar')"
              >
                {{ t('financeiro.notaMercadoria.cancelarNota') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="notas.data.value">{{ t('financeiro.nenhum') }}</p>

    <section v-if="aberta && modo === 'historico'" class="formulario" data-testid="nfe-historico">
      <h2>
        {{
          t('financeiro.notaMercadoria.historicoDe', {
            numero: aberta.numero,
            serie: aberta.serie,
            destinatario: aberta.destinatario,
          })
        }}
      </h2>
      <p v-if="aberta.chave">{{ t('financeiro.notaMercadoria.chave') }}: {{ aberta.chave }}</p>
      <ErroFaturamento v-if="historico.error.value" :erro="historico.error.value" />
      <template v-else-if="historico.data.value">
        <table class="tabela" data-testid="nfe-historico-itens">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{{ t('financeiro.notaMercadoria.item') }}</th>
              <th scope="col">{{ t('financeiro.notaMercadoria.ncm') }}</th>
              <th scope="col">{{ t('financeiro.notaMercadoria.cfop') }}</th>
              <th scope="col">{{ t('financeiro.notaMercadoria.lote') }}</th>
              <th scope="col">{{ t('financeiro.notaMercadoria.quantidade') }}</th>
              <th scope="col">{{ t('financeiro.notaMercadoria.valorTotal') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in historico.data.value.itens" :key="i.sequencia">
              <td>{{ i.sequencia }}</td>
              <td>{{ i.codigo }} · {{ i.descricao }}</td>
              <td>{{ i.ncm }}</td>
              <td>{{ i.cfop }}</td>
              <td>{{ i.lote ?? '—' }}</td>
              <td>{{ i.quantidade }}</td>
              <td>{{ reais(i.valorTotal) }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="historico.data.value.referencias.length">
          <h3>{{ t('financeiro.notaMercadoria.referencias') }}</h3>
          <ul>
            <li v-for="r in historico.data.value.referencias" :key="r.chave">{{ r.chave }}</li>
          </ul>
        </template>
        <h3>{{ t('financeiro.notaMercadoria.eventos') }}</h3>
        <ol data-testid="nfe-historico-eventos">
          <li v-for="(e, k) in historico.data.value.eventos" :key="k">
            {{ t(`financeiro.notaMercadoria.tiposEvento.${e.tipo}`) }} {{ e.sequencia }} ·
            {{ e.em ? quando(e.em) : '—' }}
            <template v-if="e.protocolo">· {{ e.protocolo }}</template>
            <template v-if="e.texto">· {{ e.texto }}</template>
          </li>
        </ol>
      </template>
      <button type="button" @click="fechar">{{ t('financeiro.notaMercadoria.fecharHistorico') }}</button>
    </section>

    <form
      v-if="aberta && modo === 'cancelar'"
      class="formulario"
      data-testid="nfe-cancelamento"
      @submit.prevent="confirmarCancelamento"
    >
      <h2>{{ t('financeiro.notaMercadoria.cancelarCom', { numero: aberta.numero }) }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="motivo"
          :rotulo="t('financeiro.notaMercadoria.motivo')"
          :opcoes="opcoesMotivo"
          data-testid="nfe-motivo"
        />
      </span>
      <span class="campo">
        <label for="nfe-justificativa">{{ t('financeiro.notaMercadoria.justificativa') }}</label>
        <textarea
          id="nfe-justificativa"
          v-model="justificativa"
          maxlength="255"
          :aria-invalid="!!recusaCancelamento"
          aria-describedby="nfe-justificativa-recusa"
          data-testid="nfe-justificativa"
        ></textarea>
        <small v-if="recusaCancelamento" id="nfe-justificativa-recusa" data-testid="nfe-recusa-cancelamento">
          {{ recusaCancelamento.mensagem }}
        </small>
      </span>
      <button
        type="submit"
        :disabled="gravando || !motivo || !!recusaCancelamento"
        data-testid="nfe-confirmar-cancelamento"
      >
        {{ t('financeiro.notaMercadoria.confirmarCancelar') }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.notaMercadoria.voltar') }}</button>
    </form>

    <form
      v-if="aberta && modo === 'corrigir'"
      class="formulario"
      data-testid="nfe-correcao"
      @submit.prevent="confirmarCorrecao"
    >
      <h2>{{ t('financeiro.notaMercadoria.corrigirCom', { numero: aberta.numero }) }}</h2>
      <p>{{ t('financeiro.notaMercadoria.condicaoUso') }}</p>
      <span class="campo">
        <label for="nfe-texto-correcao">{{ t('financeiro.notaMercadoria.textoCorrecao') }}</label>
        <textarea
          id="nfe-texto-correcao"
          v-model="textoCorrecao"
          maxlength="1000"
          :aria-invalid="conferenciaCorrecao !== null && !conferenciaCorrecao.ok"
          aria-describedby="nfe-correcao-recusa"
          data-testid="nfe-texto-correcao"
        ></textarea>
        <small
          v-if="conferenciaCorrecao && !conferenciaCorrecao.ok"
          id="nfe-correcao-recusa"
          data-testid="nfe-recusa-correcao"
        >
          {{ conferenciaCorrecao.recusa.mensagem }}
        </small>
      </span>
      <button
        type="submit"
        :disabled="gravando || !conferenciaCorrecao?.ok"
        data-testid="nfe-confirmar-correcao"
      >
        {{ t('financeiro.notaMercadoria.confirmarCorrigir') }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.notaMercadoria.voltar') }}</button>
    </form>
  </section>
</template>
