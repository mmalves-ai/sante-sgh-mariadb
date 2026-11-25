<script setup lang="ts">
// Integração contábil da receita (06-FAT L37, C2-103): `/faturamento/receita-contabil`. Numa tela só: o que está
// aberto primeiro (pendências, com o motivo, e divergências entre o contabilizado e o apurado agora), depois os
// eventos com débito, crédito, valor, data de referência e situação. Clicar no número da conta filtra a tela por ela
// (visão por conta), e "Apurar a conta" refaz a apuração pelos fatos num clique, com o resultado em contagens. A
// apuração é idempotente pela chave do fato: o contabilizado nunca é apagado nem estornado pela diferença, só pelo
// fato de reabertura; a ocorrência resolvida fica no histórico.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-faturamento.js';
import {
  apurarReceitaContabil,
  lerPainelReceitaContabil,
  type SituacaoEventoContabil,
} from '../api-receita-contabil.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Receita contábil',
      explicacao:
        'Eventos contábeis da receita faturada, glosada e recebida, apurados das contas pela regra contábil mais específica. O contabilizado não se apaga: a correção vem pela reabertura da conta.',
      conta: 'Conta (código interno)',
      contaInvalida: 'Informe o código da conta, um número inteiro positivo.',
      situacao: 'Situação dos eventos',
      todas: 'Todas',
      pendente: 'Pendente',
      contabilizado: 'Contabilizado',
      cancelado: 'Cancelado',
      filtrar: 'Filtrar',
      limpar: 'Ver todas as contas',
      apurar: 'Apurar a conta',
      apurando: 'Apurando…',
      apurado:
        'Conta {conta} apurada: {incluidos} evento(s) incluído(s), {cancelados} cancelado(s), {pendencias} pendência(s) e {divergencias} divergência(s).',
      regras: 'Regras contábeis ativas: {n}',
      semRegras: 'Nenhuma regra contábil ativa: os fatos ficam pendentes até haver regra.',
      resumo:
        '{eventos} evento(s), {pendencias} pendência(s) aberta(s) e {divergencias} divergência(s) aberta(s)',
      abertas: 'Pendências e divergências abertas',
      semAbertas: 'Nada aberto.',
      resolvidas: 'Resolvidas (histórico)',
      eventos: 'Eventos contábeis',
      semEventos: 'Nenhum evento para o filtro.',
      tipo: 'Tipo',
      pendencia: 'Pendência',
      divergencia: 'Divergência',
      fato: 'Fato',
      motivo: 'Motivo',
      valor: 'Valor',
      referencia: 'Referência',
      lancamento: 'Lançamento',
      resolvidaEm: 'Resolvida em',
      debito: 'Débito',
      credito: 'Crédito',
      acao: 'Ação',
      chave: 'Chave do fato',
      contaCol: 'Conta',
      verConta: 'Ver só a conta {numero}',
      fechamento: 'Fechamento',
      reabertura: 'Reabertura',
      glosa: 'Glosa',
      glosa_aceita: 'Glosa aceita',
      recurso_acatado: 'Recurso acatado',
      desconto: 'Desconto',
      previsao: 'Previsão',
      recebimento: 'Recebimento',
      recebimento_estornado: 'Estorno do recebimento',
      receita: 'Receita',
      estorno: 'Estorno',
      recurso: 'Recurso',
      acrescimo: 'Acréscimo',
      transferencia: 'Transferência',
    },
  },
});

const qc = useQueryClient();
const contaTexto = ref('');
const contaFiltro = ref<number | null>(null);
const situacao = ref<SituacaoEventoContabil>('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const apurando = ref(false);
let chave = novaChave('receita-contabil');

const contaDigitada = computed<number | null>(() => {
  const v = contaTexto.value.trim();
  if (!v) return null;
  return /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : NaN;
});
const contaInvalida = computed(() => Number.isNaN(contaDigitada.value));

const painel = useQuery({
  queryKey: computed(() => ['faturamento', 'receita-contabil', contaFiltro.value, situacao.value]),
  queryFn: () => lerPainelReceitaContabil(contaFiltro.value, situacao.value),
});

const OPCOES_SITUACAO = computed(() => [
  { valor: '' as const, rotulo: t('todas') },
  { valor: 'pendente' as const, rotulo: t('pendente') },
  { valor: 'contabilizado' as const, rotulo: t('contabilizado') },
  { valor: 'cancelado' as const, rotulo: t('cancelado') },
]);

const ocorrencias = computed(() => painel.data.value?.ocorrencias ?? []);
const abertas = computed(() => ocorrencias.value.filter((o) => o.situacao === 'aberta'));
const resolvidas = computed(() => ocorrencias.value.filter((o) => o.situacao !== 'aberta'));
const eventos = computed(() => painel.data.value?.eventos ?? []);
const nPendencias = computed(() => abertas.value.filter((o) => o.tipo === 'pendencia').length);
const nDivergencias = computed(() => abertas.value.filter((o) => o.tipo === 'divergencia').length);

const reais = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const rotulo = (k: string) => {
  const r = t(k);
  return r === k ? k : r;
};

function filtrar() {
  if (contaInvalida.value) return;
  contaFiltro.value = contaDigitada.value;
  mensagem.value = null;
}
function verConta(id: number | null) {
  if (!id) return;
  contaTexto.value = String(id);
  contaFiltro.value = id;
}
function limpar() {
  contaTexto.value = '';
  contaFiltro.value = null;
  mensagem.value = null;
}
async function apurar() {
  const conta = contaDigitada.value;
  if (!conta || contaInvalida.value) return;
  erro.value = null;
  mensagem.value = null;
  apurando.value = true;
  try {
    const r = await apurarReceitaContabil(conta, chave);
    chave = novaChave('receita-contabil');
    contaFiltro.value = conta;
    mensagem.value = t('apurado', { ...r, conta: r.conta });
    await qc.invalidateQueries({ queryKey: ['faturamento', 'receita-contabil'] });
  } catch (e) {
    erro.value = e;
  } finally {
    apurando.value = false;
  }
}
</script>

<template>
  <section class="tela" data-testid="tela-receita-contabil">
    <h1>{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento v-if="mensagem" :texto="mensagem" />

    <form data-testid="rc-filtro" @submit.prevent="filtrar">
      <label>
        {{ t('conta') }}
        <input
          v-model="contaTexto"
          type="text"
          inputmode="numeric"
          maxlength="10"
          :aria-invalid="contaInvalida"
          data-testid="rc-conta"
        />
      </label>
      <small v-if="contaInvalida" class="erro" data-testid="rc-erro-conta">{{ t('contaInvalida') }}</small>
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('situacao')"
        :opcoes="OPCOES_SITUACAO"
        data-testid="rc-situacao"
      />
      <button type="submit" :disabled="contaInvalida" data-testid="rc-filtrar">{{ t('filtrar') }}</button>
      <button v-if="contaFiltro" type="button" data-testid="rc-limpar" @click="limpar">
        {{ t('limpar') }}
      </button>
      <button
        type="button"
        :disabled="!contaDigitada || contaInvalida || apurando"
        data-testid="rc-apurar"
        @click="apurar"
      >
        {{ apurando ? t('apurando') : t('apurar') }}
      </button>
    </form>

    <template v-if="painel.data.value">
      <p data-testid="rc-regras">
        {{
          painel.data.value.regrasAtivas ? t('regras', { n: painel.data.value.regrasAtivas }) : t('semRegras')
        }}
      </p>
      <p data-testid="rc-resumo">
        {{ t('resumo', { eventos: eventos.length, pendencias: nPendencias, divergencias: nDivergencias }) }}
      </p>

      <h2>{{ t('abertas') }}</h2>
      <table v-if="abertas.length" class="tabela" data-testid="rc-abertas">
        <thead>
          <tr>
            <th scope="col">{{ t('tipo') }}</th>
            <th scope="col">{{ t('contaCol') }}</th>
            <th scope="col">{{ t('fato') }}</th>
            <th scope="col">{{ t('motivo') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('referencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in abertas" :key="o.id" :data-testid="`rc-ocorrencia-${o.id}`">
            <td>{{ rotulo(o.tipo) }}</td>
            <td>
              <button
                v-if="o.contaId"
                type="button"
                :aria-label="t('verConta', { numero: o.contaNumero ?? o.contaId })"
                @click="verConta(o.contaId)"
              >
                {{ o.contaNumero ?? o.contaId }}
              </button>
              <span v-else>—</span>
            </td>
            <td>{{ rotulo(o.fato) }}</td>
            <td>{{ o.motivo }}</td>
            <td>{{ reais(o.valor) }}</td>
            <td>{{ data(o.dataReferencia) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="rc-sem-abertas">{{ t('semAbertas') }}</p>

      <h2>{{ t('eventos') }}</h2>
      <table v-if="eventos.length" class="tabela" data-testid="rc-eventos">
        <thead>
          <tr>
            <th scope="col">{{ t('contaCol') }}</th>
            <th scope="col">{{ t('acao') }}</th>
            <th scope="col">{{ t('debito') }}</th>
            <th scope="col">{{ t('credito') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('referencia') }}</th>
            <th scope="col">{{ t('lancamento') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('chave') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in eventos" :key="e.id" :data-testid="`rc-evento-${e.id}`">
            <td>
              <button
                v-if="e.contaId"
                type="button"
                :aria-label="t('verConta', { numero: e.contaNumero ?? e.contaId })"
                @click="verConta(e.contaId)"
              >
                {{ e.contaNumero ?? e.contaId }}
              </button>
              <span v-else>—</span>
            </td>
            <td>{{ rotulo(e.tipoAcao) }}</td>
            <td>{{ e.debito }}</td>
            <td>{{ e.credito }}</td>
            <td>{{ reais(e.valor) }}</td>
            <td>{{ data(e.dataReferencia) }}</td>
            <td>{{ data(e.dataLancamento) }}</td>
            <td>{{ rotulo(e.situacao) }}</td>
            <td>
              <small>{{ e.chave }}</small>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="rc-sem-eventos">{{ t('semEventos') }}</p>

      <details v-if="resolvidas.length" data-testid="rc-resolvidas">
        <summary>{{ t('resolvidas') }} ({{ resolvidas.length }})</summary>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('tipo') }}</th>
              <th scope="col">{{ t('contaCol') }}</th>
              <th scope="col">{{ t('fato') }}</th>
              <th scope="col">{{ t('motivo') }}</th>
              <th scope="col">{{ t('resolvidaEm') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in resolvidas" :key="o.id">
              <td>{{ rotulo(o.tipo) }}</td>
              <td>{{ o.contaNumero ?? o.contaId ?? '—' }}</td>
              <td>{{ rotulo(o.fato) }}</td>
              <td>{{ o.motivo }}</td>
              <td>{{ data(o.resolvidaEm) }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
  </section>
</template>
