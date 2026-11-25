<script setup lang="ts">
// Notas de crédito e de débito (F8, 07-FIN linha 70): `/financeiro/notas-credito-debito`. Desenho próprio: o usuário
// escolhe o lado (a pagar ao fornecedor ou a receber do cliente ou do convênio) e a parcela em aberto numa lista que já
// traz a contraparte, o título e o saldo; a contraparte, o título e o saldo vêm da parcela, sem digitar. Direção,
// natureza, valores e tributos mudam na hora a prévia calculada pela MESMA regra do domínio que o servidor aplica
// (`planejarNota`): se a nota abate ou acresce o título, o total, os tributos destacados e retidos, o ajuste e o saldo
// da parcela depois; a recusa (motivo que não serve à natureza, nota maior que o saldo, parcela com portador, retido
// maior que o total) aparece antes de gravar e desliga o botão. A nota nasce aplicada (um clique) ou só emitida, para
// aplicar depois na lista; cancelar pede o motivo do cadastro e a justificativa conferida enquanto se digita, e a
// aplicada tem o ajuste desfeito. Nada se apaga: a cancelada fica na lista.
import { planejarNota } from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  aplicarNota,
  cancelarNota,
  emitirNota,
  type LadoNotaTela,
  lerApoiosNota,
  lerNotas,
  lerParcelasNota,
  type NotaCreditoDebito,
} from '../api-nota-credito-debito.js';
import { novaChave } from '../api-financeiro.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const JUSTIFICATIVA_MINIMA = 5;
const PERM = {
  emitir: 'financeiro.notaCreditoDebito.emitir',
  cancelar: 'financeiro.notaCreditoDebito.cancelar',
} as const;
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarFinanceiro();

const apoios = useQuery({ queryKey: ['financeiro', 'nota-cd', 'apoios'], queryFn: lerApoiosNota });
const notas = useQuery({ queryKey: ['financeiro', 'nota-cd', 'lista'], queryFn: lerNotas });

// ── Parcela ──────────────────────────────────────────────────────────────────────────────────────────────────
const lado = ref<LadoNotaTela>('pagar');
const opcoesLado = computed(() =>
  (['pagar', 'receber'] as const).map((l) => ({ valor: l, rotulo: t(`financeiro.notaCd.lados.${l}`) })),
);
const busca = ref('');
const buscaAplicada = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => (buscaAplicada.value = b), 300);
});
const parcelas = useQuery({
  queryKey: computed(() => ['financeiro', 'nota-cd', 'parcelas', lado.value, buscaAplicada.value]),
  queryFn: () => lerParcelasNota(lado.value, buscaAplicada.value),
});
const parcelaId = ref('');
watch(lado, () => (parcelaId.value = ''));
const opcoesParcelas = computed(() => [
  { valor: '', rotulo: t('financeiro.notaCd.escolhaParcela') },
  ...(parcelas.data.value ?? []).map((p) => ({
    valor: String(p.parcela),
    rotulo:
      t('financeiro.notaCd.parcelaRotulo', {
        contraparte: p.contraparte ?? '—',
        numero: p.numero,
        documento: p.documento ? ` · ${p.documento}` : '',
        sequencia: p.sequencia,
        vencimento: data(p.vencimento),
        saldo: reais(p.saldo),
      }) + (p.portador ? t('financeiro.notaCd.parcelaCedida', { portador: p.portador }) : ''),
  })),
]);
const parcela = computed(
  () => (parcelas.data.value ?? []).find((p) => String(p.parcela) === parcelaId.value) ?? null,
);

// ── Nota ─────────────────────────────────────────────────────────────────────────────────────────────────────
const direcao = ref<'emitida' | 'recebida'>('recebida');
const natureza = ref<'credito' | 'debito'>('credito');
const opcoesDirecao = computed(() =>
  (['recebida', 'emitida'] as const).map((d) => ({ valor: d, rotulo: t(`financeiro.notaCd.direcoes.${d}`) })),
);
const opcoesNatureza = computed(() =>
  (['credito', 'debito'] as const).map((n) => ({ valor: n, rotulo: t(`financeiro.notaCd.naturezas.${n}`) })),
);
const motivoId = ref('');
// O motivo que não serve à natureza escolhida não aparece (menos erro); trocar a natureza limpa o que deixou de servir.
const motivosDaNatureza = computed(() =>
  (apoios.data.value?.motivos ?? []).filter(
    (m) => !m.natureza || m.natureza === 'ambos' || m.natureza === natureza.value,
  ),
);
const opcoesMotivo = computed(() => [
  { valor: '', rotulo: t('financeiro.notaCd.escolhaMotivo') },
  ...motivosDaNatureza.value.map((m) => ({ valor: String(m.id), rotulo: m.rotulo })),
]);
watch(natureza, () => {
  if (!motivosDaNatureza.value.some((m) => String(m.id) === motivoId.value)) motivoId.value = '';
});
const dataEmissao = ref('');
watch(
  () => apoio.data.value?.hoje,
  (hoje) => {
    if (hoje && !dataEmissao.value) dataEmissao.value = hoje;
  },
  { immediate: true },
);
const dataVencimento = ref('');
const serie = ref('');
const numeroDocumento = ref('');
const valorItens = ref<number | ''>('');
const valorDesconto = ref<number | ''>(0);
const valorOutros = ref<number | ''>(0);
const observacao = ref('');
const aplicarAgora = ref(true);
const num = (v: number | '' | string) => (v === '' ? 0 : Number(v) || 0);

interface LinhaTributo {
  chave: number;
  tributo: string;
  base: number | '';
  aliquota: number | '';
  retido: boolean;
}
let proximaLinha = 1;
const tributos = ref<LinhaTributo[]>([]);
const opcoesTributo = computed(() => [
  { valor: '', rotulo: t('financeiro.notaCd.escolhaTributo') },
  ...(apoios.data.value?.tributos ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
]);
function incluirTributo() {
  // A base começa no valor líquido dos itens (o mais comum); o usuário muda se for outra.
  tributos.value.push({
    chave: proximaLinha++,
    tributo: '',
    base: Math.max(0, num(valorItens.value) - num(valorDesconto.value)),
    aliquota: '',
    retido: false,
  });
}
function removerTributo(chave: number) {
  tributos.value = tributos.value.filter((x) => x.chave !== chave);
}
const tributosEntrada = computed(() =>
  tributos.value
    .filter((x) => x.tributo !== '')
    .map((x) => ({
      tributo: Number(x.tributo),
      base: num(x.base),
      aliquota: num(x.aliquota),
      retido: x.retido,
    })),
);

// A prévia: a mesma regra do domínio que o servidor aplica na gravação.
const plano = computed(() => {
  const p = parcela.value;
  const m = motivosDaNatureza.value.find((x) => String(x.id) === motivoId.value);
  if (!p || !m || num(valorItens.value) <= 0 || !dataEmissao.value) return null;
  return planejarNota({
    direcao: direcao.value,
    natureza: natureza.value,
    lado: lado.value,
    naturezaMotivo: m.natureza ?? 'ambos',
    motivoAtivo: true,
    valorItens: num(valorItens.value),
    valorDesconto: num(valorDesconto.value),
    valorOutros: num(valorOutros.value),
    tributos: tributosEntrada.value,
    dataEmissao: dataEmissao.value,
    dataVencimento: dataVencimento.value || null,
    situacaoTitulo: 'aberto',
    saldoTitulo: p.saldo,
    parcelaCedida: p.portador !== null,
  });
});
const recusaPrevia = computed(() => (plano.value && 'codigo' in plano.value ? plano.value : null));
const previa = computed(() => (plano.value && 'efeito' in plano.value ? plano.value : null));
const valorTributo = (x: LinhaTributo) => Math.round(num(x.base) * num(x.aliquota)) / 100;
const tributoIncompleto = computed(() => tributos.value.some((x) => x.tributo === '' || x.aliquota === ''));
const saldoDepois = computed(() => {
  const p = parcela.value;
  const v = previa.value;
  if (!p || !v) return 0;
  return Math.round((p.saldo + (v.efeito === 'abate' ? -v.valorAjuste : v.valorAjuste)) * 100) / 100;
});
const podeEmitir = computed(
  () => !gravando.value && !!previa.value && !tributoIncompleto.value && tem(PERM.emitir),
);

// ── Gravação comum: mensagem do servidor, nova chave e releitura ───────────────────────────────────────────
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('nota-cd');
async function acao(f: (c: string) => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('nota-cd');
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}
async function emitir() {
  const p = parcela.value;
  if (!podeEmitir.value || !p) return;
  const s = serie.value.trim();
  const doc = numeroDocumento.value.trim();
  const obs = observacao.value.trim();
  const ok = await acao((c) =>
    emitirNota(
      lado.value,
      {
        parcela: p.parcela,
        direcao: direcao.value,
        natureza: natureza.value,
        motivo: Number(motivoId.value),
        dataEmissao: dataEmissao.value,
        ...(dataVencimento.value ? { dataVencimento: dataVencimento.value } : {}),
        ...(s ? { serie: s } : {}),
        ...(doc ? { numeroDocumento: doc } : {}),
        valorItens: num(valorItens.value),
        valorDesconto: num(valorDesconto.value),
        valorOutros: num(valorOutros.value),
        tributos: tributosEntrada.value,
        ...(obs ? { observacao: obs } : {}),
        aplicar: aplicarAgora.value,
      },
      c,
    ),
  );
  if (ok) {
    parcelaId.value = '';
    valorItens.value = '';
    valorDesconto.value = 0;
    valorOutros.value = 0;
    tributos.value = [];
    serie.value = '';
    numeroDocumento.value = '';
    observacao.value = '';
    dataVencimento.value = '';
  }
}

// ── Cancelar: motivo do cadastro e justificativa conferida enquanto se digita ────────────────────────────────
const aberta = ref<NotaCreditoDebito | null>(null);
const motivoCancelamento = ref('');
const justificativa = ref('');
const opcoesCancelamento = computed(() => [
  { valor: '', rotulo: t('financeiro.notaCd.escolhaMotivoCancelamento') },
  ...(apoios.data.value?.motivosCancelamento ?? []).map((m) => ({ valor: String(m.id), rotulo: m.rotulo })),
]);
function abrir(n: NotaCreditoDebito) {
  aberta.value = n;
  motivoCancelamento.value = '';
  justificativa.value = '';
}
function fechar() {
  aberta.value = null;
}
const faltamJustificativa = computed(() =>
  Math.max(0, JUSTIFICATIVA_MINIMA - justificativa.value.trim().length),
);
async function confirmarCancelamento() {
  const n = aberta.value;
  if (!n || !motivoCancelamento.value || faltamJustificativa.value > 0) return;
  if (
    await acao((c) => cancelarNota(n.nota, Number(motivoCancelamento.value), justificativa.value.trim(), c))
  )
    fechar();
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ncd-titulo" data-testid="tela-fin-nota-cd">
    <h1 id="ncd-titulo">{{ t('financeiro.notaCd.titulo') }}</h1>
    <p>{{ t('financeiro.notaCd.texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="apoios.error.value" :erro="apoios.error.value" />

    <form
      v-if="tem(PERM.emitir)"
      class="formulario"
      :aria-label="t('financeiro.notaCd.nova')"
      data-testid="ncd-nova"
      @submit.prevent="emitir"
    >
      <h2>{{ t('financeiro.notaCd.nova') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="lado"
          :rotulo="t('financeiro.notaCd.lado')"
          :opcoes="opcoesLado"
          data-testid="ncd-lado"
        />
      </span>
      <span class="campo">
        <label for="ncd-busca">{{ t('financeiro.notaCd.busca') }}</label>
        <input id="ncd-busca" v-model="busca" maxlength="60" data-testid="ncd-busca" />
      </span>
      <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
      <p v-else-if="parcelas.data.value && !parcelas.data.value.length" data-testid="ncd-sem-parcela">
        {{ t('financeiro.notaCd.semParcela') }}
      </p>
      <span v-else class="campo">
        <SanteSelecao
          v-model="parcelaId"
          :rotulo="t('financeiro.notaCd.parcela')"
          :opcoes="opcoesParcelas"
          data-testid="ncd-parcela"
        />
      </span>

      <template v-if="parcela">
        <span class="campo">
          <SanteSelecao
            v-model="direcao"
            :rotulo="t('financeiro.notaCd.direcao')"
            :opcoes="opcoesDirecao"
            data-testid="ncd-direcao"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="natureza"
            :rotulo="t('financeiro.notaCd.natureza')"
            :opcoes="opcoesNatureza"
            data-testid="ncd-natureza"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="motivoId"
            :rotulo="t('financeiro.notaCd.motivo')"
            :opcoes="opcoesMotivo"
            data-testid="ncd-motivo"
          />
        </span>
        <span class="campo">
          <label for="ncd-emissao">{{ t('financeiro.notaCd.dataEmissao') }}</label>
          <input id="ncd-emissao" v-model="dataEmissao" type="date" data-testid="ncd-emissao" />
        </span>
        <span class="campo">
          <label for="ncd-vencimento">{{ t('financeiro.notaCd.dataVencimento') }}</label>
          <input id="ncd-vencimento" v-model="dataVencimento" type="date" data-testid="ncd-vencimento" />
        </span>
        <span class="campo">
          <label for="ncd-serie">{{ t('financeiro.notaCd.serie') }}</label>
          <input id="ncd-serie" v-model="serie" maxlength="10" data-testid="ncd-serie" />
        </span>
        <span class="campo">
          <label for="ncd-documento">{{ t('financeiro.notaCd.numeroDocumento') }}</label>
          <input id="ncd-documento" v-model="numeroDocumento" maxlength="20" data-testid="ncd-documento" />
        </span>
        <span class="campo">
          <label for="ncd-itens">{{ t('financeiro.notaCd.valorItens') }}</label>
          <input
            id="ncd-itens"
            v-model.number="valorItens"
            type="number"
            min="0"
            step="0.01"
            data-testid="ncd-itens"
          />
        </span>
        <span class="campo">
          <label for="ncd-desconto">{{ t('financeiro.notaCd.valorDesconto') }}</label>
          <input
            id="ncd-desconto"
            v-model.number="valorDesconto"
            type="number"
            min="0"
            step="0.01"
            data-testid="ncd-desconto"
          />
        </span>
        <span class="campo">
          <label for="ncd-outros">{{ t('financeiro.notaCd.valorOutros') }}</label>
          <input
            id="ncd-outros"
            v-model.number="valorOutros"
            type="number"
            min="0"
            step="0.01"
            data-testid="ncd-outros"
          />
        </span>

        <h3>{{ t('financeiro.notaCd.tributos') }}</h3>
        <table v-if="tributos.length" class="tabela" data-testid="ncd-tributos">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.notaCd.tributo') }}</th>
              <th scope="col">{{ t('financeiro.notaCd.base') }}</th>
              <th scope="col">{{ t('financeiro.notaCd.aliquota') }}</th>
              <th scope="col">{{ t('financeiro.notaCd.retido') }}</th>
              <th scope="col">{{ t('financeiro.notaCd.valorTributo') }}</th>
              <th scope="col">{{ t('financeiro.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in tributos" :key="x.chave" :data-testid="`ncd-tributo-${i + 1}`">
              <td>
                <SanteSelecao
                  v-model="x.tributo"
                  :rotulo="`${t('financeiro.notaCd.tributo')} ${i + 1}`"
                  :opcoes="opcoesTributo"
                  :data-testid="`ncd-tributo-codigo-${i + 1}`"
                />
              </td>
              <td>
                <input
                  v-model.number="x.base"
                  type="number"
                  min="0"
                  step="0.01"
                  :aria-label="`${t('financeiro.notaCd.base')} ${i + 1}`"
                  :data-testid="`ncd-tributo-base-${i + 1}`"
                />
              </td>
              <td>
                <input
                  v-model.number="x.aliquota"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  :aria-label="`${t('financeiro.notaCd.aliquota')} ${i + 1}`"
                  :data-testid="`ncd-tributo-aliquota-${i + 1}`"
                />
              </td>
              <td>
                <input
                  v-model="x.retido"
                  type="checkbox"
                  :aria-label="`${t('financeiro.notaCd.retido')} ${i + 1}`"
                  :data-testid="`ncd-tributo-retido-${i + 1}`"
                />
              </td>
              <td>{{ reais(valorTributo(x)) }}</td>
              <td>
                <button
                  type="button"
                  :aria-label="t('financeiro.notaCd.removerTributo', { n: i + 1 })"
                  :data-testid="`ncd-tributo-remover-${i + 1}`"
                  @click="removerTributo(x.chave)"
                >
                  {{ t('financeiro.notaCd.remover') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" data-testid="ncd-incluir-tributo" @click="incluirTributo">
          {{ t('financeiro.notaCd.incluirTributo') }}
        </button>

        <span class="campo">
          <label for="ncd-observacao">{{ t('financeiro.notaCd.observacao') }}</label>
          <input id="ncd-observacao" v-model="observacao" maxlength="2000" data-testid="ncd-observacao" />
        </span>
        <span class="campo">
          <label>
            <input v-model="aplicarAgora" type="checkbox" data-testid="ncd-aplicar-agora" />
            {{ t('financeiro.notaCd.aplicar') }}
          </label>
        </span>

        <p class="resumo" aria-live="polite" data-testid="ncd-previa">
          <span v-if="recusaPrevia" role="alert" data-testid="ncd-recusa-previa">{{
            recusaPrevia.mensagem
          }}</span>
          <span v-else-if="previa" data-testid="ncd-previa-texto">
            {{
              t('financeiro.notaCd.previa', {
                efeito: t(`financeiro.notaCd.efeitos.${previa.efeito}`),
                ajuste: reais(previa.valorAjuste),
                total: reais(previa.valorTotal),
                impostos: reais(previa.valorImpostos),
                retidos: reais(previa.valorRetido),
                saldoDepois: reais(saldoDepois),
              })
            }}
          </span>
        </p>
        <button type="submit" :disabled="!podeEmitir" data-testid="ncd-emitir">
          {{ t('financeiro.notaCd.emitir') }}
        </button>
      </template>
    </form>

    <h2>{{ t('financeiro.notaCd.notas') }}</h2>
    <ErroFaturamento v-if="notas.error.value" :erro="notas.error.value" />
    <table v-else-if="notas.data.value?.length" class="tabela" data-testid="ncd-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.notaCd.numero') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.dataEmissao') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.contraparte') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.lado') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.natureza') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.motivo') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.valorTotal') }}</th>
          <th scope="col">{{ t('financeiro.notaCd.ajuste') }}</th>
          <th scope="col">{{ t('financeiro.situacao') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in notas.data.value" :key="n.nota" :data-testid="`ncd-linha-${n.nota}`">
          <td>{{ n.numero }}</td>
          <td>{{ data(n.dataEmissao) }}</td>
          <td>{{ n.contraparte ?? '—' }}</td>
          <td>{{ t(`financeiro.notaCd.lados.${n.lado}`) }}</td>
          <td>
            {{ t(`financeiro.notaCd.naturezas.${n.natureza}`) }} ·
            {{ t(`financeiro.notaCd.direcoes.${n.direcao}`) }}
          </td>
          <td>{{ n.motivo }}</td>
          <td>{{ reais(n.valorTotal) }}</td>
          <td>
            <template v-if="n.valorAjuste !== null && n.efeito">
              {{ t(`financeiro.notaCd.efeitos.${n.efeito}`) }} {{ reais(n.valorAjuste) }}
            </template>
          </td>
          <td :data-testid="`ncd-situacao-${n.nota}`">
            {{ t(`financeiro.notaCd.situacoes.${n.situacao}`) }}
          </td>
          <td>
            <button
              v-if="n.situacao === 'emitida'"
              type="button"
              :disabled="gravando || !tem(PERM.emitir)"
              :data-testid="`ncd-aplicar-${n.nota}`"
              @click="acao((k) => aplicarNota(n.nota, k))"
            >
              {{ t('financeiro.notaCd.aplicarNota') }}
            </button>
            <button
              v-if="n.situacao !== 'cancelada'"
              type="button"
              :disabled="gravando || !tem(PERM.cancelar)"
              :data-testid="`ncd-cancelar-${n.nota}`"
              @click="abrir(n)"
            >
              {{ t('financeiro.notaCd.cancelarNota') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="notas.data.value">{{ t('financeiro.nenhum') }}</p>

    <form
      v-if="aberta"
      class="formulario"
      data-testid="ncd-cancelamento"
      @submit.prevent="confirmarCancelamento"
    >
      <h2>
        {{
          t('financeiro.notaCd.cancelarCom', {
            numero: aberta.numero,
            contraparte: aberta.contraparte ?? '—',
          })
        }}
      </h2>
      <p v-if="aberta.situacao === 'aplicada' && aberta.valorAjuste !== null" data-testid="ncd-desfaz">
        {{ t('financeiro.notaCd.desfazAjuste', { valor: reais(aberta.valorAjuste) }) }}
      </p>
      <span class="campo">
        <SanteSelecao
          v-model="motivoCancelamento"
          :rotulo="t('financeiro.notaCd.motivoCancelamento')"
          :opcoes="opcoesCancelamento"
          data-testid="ncd-motivo-cancelamento"
        />
      </span>
      <span class="campo">
        <label for="ncd-justificativa">{{ t('financeiro.notaCd.justificativa') }}</label>
        <textarea
          id="ncd-justificativa"
          v-model="justificativa"
          maxlength="500"
          :aria-invalid="faltamJustificativa > 0"
          aria-describedby="ncd-justificativa-falta"
          data-testid="ncd-justificativa"
        ></textarea>
        <small v-if="faltamJustificativa > 0" id="ncd-justificativa-falta">
          {{ t('financeiro.notaCd.justificativaFalta', { n: faltamJustificativa }) }}
        </small>
      </span>
      <button
        type="submit"
        :disabled="gravando || !motivoCancelamento || faltamJustificativa > 0"
        data-testid="ncd-confirmar-cancelamento"
      >
        {{ t('financeiro.notaCd.confirmarCancelar') }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.cancelar') }}</button>
    </form>
  </section>
</template>
