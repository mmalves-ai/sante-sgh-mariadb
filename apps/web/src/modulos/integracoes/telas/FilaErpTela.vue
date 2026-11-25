<script setup lang="ts">
// Fila do ERP corporativo (F8, 08-INTG L136): `/admin/integracoes/erp`. Monitor e conciliação numa tela só: o lote novo
// sai com tipo, sistema e período (o período é conferido na hora, sem ida ao servidor); cada lote mostra a situação, a
// contagem, as rejeições e o protocolo; "Enviar ao ERP" manda o lote (simulador fora de produção) e já traz o retorno
// de cada item; a conciliação pede só o total informado pelo ERP (opcional); o cancelamento, antes do envio, pede o
// motivo. Nada é apagado.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  cancelarLoteErp,
  conciliarLoteErp,
  enviarLoteErp,
  gerarLoteErp,
  type LoteErp,
  lerLoteErp,
  lerLotesErp,
  lerSistemasErp,
  TIPOS_FILA_ERP,
  type TipoFilaErp,
} from '../api-fila-erp.js';
import { mensagensFilaErp } from '../i18n-fila-erp.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensFilaErp });
const fila = useQueryClient();
const podeOperar = computed(() => pode('integracao.filaErp.operar'));
const SITUACOES = ['gerado', 'enviado', 'processado', 'processado_com_erro', 'conciliado', 'cancelado'];

const sistemas = useQuery({ queryKey: ['fila-erp', 'sistemas'], queryFn: lerSistemasErp });
const opcoesSistema = computed(() =>
  (sistemas.data.value ?? []).filter((s) => s.ativo).map((s) => ({ valor: s.codigo, rotulo: s.nome })),
);
const opcoesTipo = computed(() => TIPOS_FILA_ERP.map((v) => ({ valor: v, rotulo: t(`tipos.${v}`) })));

const hoje = new Date();
const primeiro = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const ultimo = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const tipo = ref<string | null>('pagar');
const sistema = ref<string | null>(null);
const inicio = ref(iso(primeiro));
const fim = ref(iso(ultimo));
watch(opcoesSistema, (o) => {
  if (!sistema.value && o.length === 1) sistema.value = o[0]!.valor;
});
/** O período conferido na tela (o servidor confere de novo pela regra do domínio). */
const erroPeriodo = computed(() => {
  if (!inicio.value || !fim.value) return '';
  if (fim.value < inicio.value) return t('erroPeriodo');
  if ((Date.parse(fim.value) - Date.parse(inicio.value)) / 86_400_000 + 1 > 92) return t('erroPeriodoLongo');
  return '';
});
const podeGerar = computed(
  () =>
    podeOperar.value &&
    !!tipo.value &&
    !!sistema.value &&
    !!inicio.value &&
    !!fim.value &&
    !erroPeriodo.value,
);

const filtroTipo = ref<string | null>(null);
const filtroSituacao = ref<string | null>(null);
const opcoesFiltroTipo = computed(() => [{ valor: '', rotulo: t('todos') }, ...opcoesTipo.value]);
const opcoesFiltroSituacao = computed(() => [
  { valor: '', rotulo: t('todos') },
  ...SITUACOES.map((v) => ({ valor: v, rotulo: t(`situacoes.${v}`) })),
]);
const lotes = useQuery({
  queryKey: ['fila-erp', 'lotes', filtroTipo, filtroSituacao],
  queryFn: () => lerLotesErp(filtroTipo.value || null, filtroSituacao.value || null),
});

const aberto = ref<number | null>(null);
const idAberto = computed(() => aberto.value ?? 0);
const detalhe = useQuery({
  queryKey: ['fila-erp', 'lote', idAberto],
  queryFn: () => lerLoteErp(idAberto.value),
  enabled: computed(() => idAberto.value > 0),
});

const aviso = ref('');
const erro = ref<unknown>(null);
const recarregar = () => fila.invalidateQueries({ queryKey: ['fila-erp'] });
const moeda = (v: number | null) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');
const ok = async (texto: string) => {
  aviso.value = texto;
  erro.value = null;
  await recarregar();
};

const geracao = useMutation({
  mutationFn: () =>
    gerarLoteErp({
      tipo: tipo.value as TipoFilaErp,
      sistema: sistema.value!,
      inicio: inicio.value,
      fim: fim.value,
    }),
  onSuccess: (r) => ok(t('gerado', { numero: String(r['numero']), quantidade: Number(r['quantidade']) })),
  onError: (e) => (erro.value = e),
});

const envio = useMutation({
  mutationFn: (l: LoteErp) => enviarLoteErp(l.id, l.versao),
  onSuccess: (r) => ok(t('enviado', { situacao: t(`situacoes.${String(r['situacao'])}`) })),
  onError: (e) => (erro.value = e),
});

const conciliando = ref<LoteErp | null>(null);
const valorInformado = ref('');
const observacao = ref('');
const valorValido = computed(
  () => valorInformado.value === '' || /^\d+([.,]\d{1,2})?$/.test(valorInformado.value),
);
const conciliacao = useMutation({
  mutationFn: (l: LoteErp) =>
    conciliarLoteErp(
      l.id,
      l.versao,
      valorInformado.value === '' ? null : Number(valorInformado.value.replace(',', '.')),
      observacao.value.trim() || null,
    ),
  onSuccess: async (r) => {
    conciliando.value = null;
    valorInformado.value = '';
    observacao.value = '';
    await ok(
      t('conciliado', { exportados: Number(r['exportados']), valor: moeda(Number(r['valorExportado'])) }),
    );
  },
  onError: (e) => (erro.value = e),
});

const cancelando = ref<LoteErp | null>(null);
const motivo = ref('');
const motivoValido = computed(() => motivo.value.trim().length >= 10);
const cancelamento = useMutation({
  mutationFn: (l: LoteErp) => cancelarLoteErp(l.id, l.versao, motivo.value.trim()),
  onSuccess: async () => {
    cancelando.value = null;
    motivo.value = '';
    await ok(t('cancelado'));
  },
  onError: (e) => (erro.value = e),
});

const podeConciliar = (l: LoteErp) => ['processado', 'processado_com_erro'].includes(l.situacao);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fila-erp-titulo" data-testid="tela-fila-erp">
    <h1 id="fila-erp-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <p v-if="!podeOperar" role="note" data-testid="erp-so-consulta">{{ t('soConsulta') }}</p>
    <p v-if="aviso" role="status" data-testid="erp-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <form v-if="podeOperar" class="erp-novo" data-testid="erp-novo" @submit.prevent="geracao.mutate()">
      <h2>{{ t('novoLote') }}</h2>
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('tipo')"
        :opcoes="opcoesTipo"
        obrigatorio
        data-testid="erp-tipo"
      />
      <SanteSelecao
        v-model="sistema"
        :rotulo="t('sistema')"
        :opcoes="opcoesSistema"
        obrigatorio
        data-testid="erp-sistema"
      />
      <label>
        {{ t('inicio') }}
        <input v-model="inicio" type="date" required data-testid="erp-inicio" />
      </label>
      <label>
        {{ t('fim') }}
        <input v-model="fim" type="date" required data-testid="erp-fim" />
      </label>
      <p v-if="erroPeriodo" role="alert" data-testid="erp-erro-periodo">{{ erroPeriodo }}</p>
      <button type="submit" :disabled="!podeGerar || geracao.isPending.value" data-testid="erp-gerar">
        {{ t('gerar') }}
      </button>
    </form>
    <p v-if="sistemas.isSuccess.value && opcoesSistema.length === 0" role="note">{{ t('semSistema') }}</p>

    <div class="erp-filtros">
      <SanteSelecao
        v-model="filtroTipo"
        :rotulo="t('filtroTipo')"
        :opcoes="opcoesFiltroTipo"
        data-testid="erp-filtro-tipo"
      />
      <SanteSelecao
        v-model="filtroSituacao"
        :rotulo="t('filtroSituacao')"
        :opcoes="opcoesFiltroSituacao"
        data-testid="erp-filtro-situacao"
      />
    </div>

    <p v-if="lotes.isSuccess.value && (lotes.data.value ?? []).length === 0">{{ t('semLotes') }}</p>
    <ul class="erp-lotes" data-testid="erp-lotes">
      <li v-for="l in lotes.data.value ?? []" :key="l.id" class="erp-lote" :data-testid="`erp-lote-${l.id}`">
        <strong>{{ t('lote', { numero: l.numero }) }}</strong>
        <span>{{ l.tipo ? t(`tipos.${l.tipo}`) : '' }} · {{ l.sistemaNome }}</span>
        <span :data-testid="`erp-situacao-${l.id}`">{{ t(`situacoes.${l.situacao}`) }}</span>
        <span>{{ t('periodo', { inicio: dataBr(l.inicio), fim: dataBr(l.fim) }) }}</span>
        <span :data-testid="`erp-resumo-${l.id}`">
          {{ t('resumo', { quantidade: l.quantidade, erros: l.erros, valor: moeda(l.valorTotal) }) }}
        </span>
        <span v-if="l.protocolo">{{ t('protocolo', { protocolo: l.protocolo }) }}</span>
        <div class="erp-acoes">
          <button
            type="button"
            :data-testid="`erp-abrir-${l.id}`"
            @click="aberto = aberto === l.id ? null : l.id"
          >
            {{ aberto === l.id ? t('fecharItens') : t('abrir') }}
          </button>
          <template v-if="podeOperar">
            <button
              v-if="l.situacao === 'gerado'"
              type="button"
              :disabled="envio.isPending.value"
              :data-testid="`erp-enviar-${l.id}`"
              @click="envio.mutate(l)"
            >
              {{ t('enviar') }}
            </button>
            <button
              v-if="podeConciliar(l)"
              type="button"
              :data-testid="`erp-conciliar-${l.id}`"
              @click="conciliando = l"
            >
              {{ t('conciliar') }}
            </button>
            <button
              v-if="l.situacao === 'gerado'"
              type="button"
              :data-testid="`erp-cancelar-${l.id}`"
              @click="cancelando = l"
            >
              {{ t('cancelar') }}
            </button>
          </template>
        </div>

        <form
          v-if="conciliando?.id === l.id"
          class="erp-dialogo"
          data-testid="erp-conciliacao"
          @submit.prevent="conciliacao.mutate(l)"
        >
          <label>
            {{ t('valorInformado') }}
            <input v-model="valorInformado" inputmode="decimal" data-testid="erp-valor-informado" />
          </label>
          <label>
            {{ t('observacao') }}
            <input v-model="observacao" maxlength="1000" data-testid="erp-observacao" />
          </label>
          <button
            type="submit"
            :disabled="!valorValido || conciliacao.isPending.value"
            data-testid="erp-confirmar-conciliacao"
          >
            {{ t('confirmarConciliacao') }}
          </button>
          <button type="button" @click="conciliando = null">{{ t('fechar') }}</button>
        </form>

        <form
          v-if="cancelando?.id === l.id"
          class="erp-dialogo"
          data-testid="erp-cancelamento"
          @submit.prevent="cancelamento.mutate(l)"
        >
          <label>
            {{ t('motivo') }}
            <input v-model="motivo" maxlength="1000" data-testid="erp-motivo" />
          </label>
          <button
            type="submit"
            :disabled="!motivoValido || cancelamento.isPending.value"
            data-testid="erp-confirmar-cancelamento"
          >
            {{ t('confirmarCancelamento') }}
          </button>
          <button type="button" @click="cancelando = null">{{ t('fechar') }}</button>
        </form>

        <ol v-if="aberto === l.id" class="erp-itens" :data-testid="`erp-itens-${l.id}`">
          <li
            v-for="i in detalhe.data.value?.itens ?? []"
            :key="i.id"
            :data-testid="`erp-item-${l.id}-${i.sequencia}`"
          >
            <span>{{ t('item', { sequencia: i.sequencia }) }}</span>
            <span>{{ i.documento }} · {{ dataBr(i.data) }} · {{ moeda(i.valor) }}</span>
            <span>{{ t(`itens.${i.situacao}`) }}</span>
            <span v-if="i.chaveExterna">{{ t('chave', { chave: i.chaveExterna }) }}</span>
            <span v-if="i.mensagem" role="note">{{ i.mensagem }}</span>
          </li>
        </ol>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.erp-novo,
.erp-filtros,
.erp-acoes,
.erp-dialogo {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-3);
}
.erp-novo h2 {
  flex-basis: 100%;
}
.erp-lotes,
.erp-itens {
  list-style: none;
  padding: 0;
}
.erp-lote {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
.erp-itens li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  padding-block: var(--sgh-espaco-2);
}
</style>
