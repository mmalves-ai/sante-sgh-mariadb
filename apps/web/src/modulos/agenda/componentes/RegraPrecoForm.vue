<script setup lang="ts">
// ADR 0009: inclusão e edição da regra de preço PARTICULAR (decisão 24: nunca de convênio). Na inclusão, o dono é a
// agenda ou o profissional dela, o alvo é qualquer consulta, um procedimento ou um grupo. Na edição, valor, prioridade
// e vigência; a regra estimada (extraída do texto) pode ser confirmada ou recusada. A gravação vai com a versão lida.
import type { RegraPrecoParticular, SituacaoRevisaoRegra } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-agenda.js';
import { incluirRegraPreco, revisarRegraPreco } from '../api-estruturada.js';
import { lerValorDigitado } from '../estruturada-tela.js';
import ErroAgenda from './ErroAgenda.vue';

const props = defineProps<{
  agendaId: number;
  profissionalId: number | null;
  /** Fonte pagadora particular da agenda (obrigatória na inclusão). */
  particularId: number | null;
  regra?: RegraPrecoParticular | null;
  hoje: string;
}>();
const emit = defineEmits<{ gravado: [mensagem: string]; cancelar: [] }>();
const { t } = useI18n();

const r = props.regra ?? null;
const valor = ref(r ? r.valor.toFixed(2).replace('.', ',') : '');
const prioridade = ref(r ? r.prioridade : 100);
const inicio = ref(r ? r.vigenciaInicio : props.hoje);
const fim = ref(r?.vigenciaFim ?? '');
const dono = ref<'agenda' | 'profissional'>('agenda');
const alvo = ref<'consulta' | 'item' | 'grupo'>('consulta');
const alvoId = ref<number | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const chave = ref(novaChave('preco-particular'));

const opcoesDono = computed(() => [
  { valor: 'agenda', rotulo: t('estruturada.preco.donoAgenda') },
  ...(props.profissionalId
    ? [{ valor: 'profissional', rotulo: t('estruturada.preco.donoProfissional') }]
    : []),
]);
const opcoesAlvo = computed(() => [
  { valor: 'consulta', rotulo: t('estruturada.preco.alvoConsulta') },
  { valor: 'item', rotulo: t('estruturada.preco.alvoItem', { id: '' }).trim() },
  { valor: 'grupo', rotulo: t('estruturada.preco.alvoGrupo', { id: '' }).trim() },
]);
const valorLido = computed(() => lerValorDigitado(valor.value));
const vigenciaOk = computed(() => !fim.value || fim.value >= inicio.value);
const problema = computed(() =>
  valorLido.value === null
    ? t('estruturada.preco.valorInvalido')
    : !vigenciaOk.value
      ? t('estruturada.preco.vigenciaInvalida')
      : !r && props.particularId === null
        ? t('estruturada.preco.semParticular')
        : null,
);
const podeGravar = computed(
  () => !ocupado.value && problema.value === null && (alvo.value === 'consulta' || !!alvoId.value),
);

async function rodar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    const x = await fn();
    emit('gravado', x.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    chave.value = novaChave('preco-particular');
    ocupado.value = false;
  }
}

function gravar(situacao?: SituacaoRevisaoRegra): Promise<void> {
  const v = valorLido.value;
  if (v === null) return Promise.resolve();
  if (r) {
    return rodar(() =>
      revisarRegraPreco(
        r.id,
        {
          versao: r.versao,
          valores: {
            valor: v,
            prioridade: prioridade.value,
            vigenciaInicio: inicio.value,
            vigenciaFim: fim.value || null,
            ...(situacao ? { situacaoRevisao: situacao } : {}),
          },
        },
        chave.value,
      ),
    );
  }
  const particular = props.particularId;
  if (particular === null) return Promise.resolve();
  return rodar(() =>
    incluirRegraPreco(
      {
        estabelecimentoId: null,
        fontePagadoraId: particular,
        dono:
          dono.value === 'profissional' && props.profissionalId
            ? { tipo: 'profissional', profissionalId: props.profissionalId }
            : { tipo: 'agenda', agendaId: props.agendaId },
        alvo:
          alvo.value === 'item'
            ? { tipo: 'item', itemFaturavelId: Number(alvoId.value) }
            : alvo.value === 'grupo'
              ? { tipo: 'grupo', grupoFaturamentoId: Number(alvoId.value) }
              : { tipo: 'consulta' },
        valor: v,
        prioridade: prioridade.value,
        vigenciaInicio: inicio.value,
        vigenciaFim: fim.value || null,
        situacaoRevisao: 'confirmada',
        textoOrigemId: null,
        observacao: null,
      },
      chave.value,
    ),
  );
}
</script>

<template>
  <form class="filtros" data-testid="form-regra-preco" @submit.prevent="gravar()">
    <template v-if="!r">
      <div class="campo">
        <SanteSelecao
          id="regra-dono"
          v-model="dono"
          :rotulo="t('estruturada.preco.dono')"
          :opcoes="opcoesDono"
          data-testid="regra-dono"
        />
      </div>
      <div class="campo">
        <SanteSelecao
          id="regra-alvo"
          v-model="alvo"
          :rotulo="t('estruturada.preco.alvo')"
          :opcoes="opcoesAlvo"
          data-testid="regra-alvo"
        />
      </div>
      <div v-if="alvo !== 'consulta'" class="campo">
        <label for="regra-alvo-id">{{ t('estruturada.preco.alvo') }}</label>
        <input id="regra-alvo-id" v-model.number="alvoId" type="number" min="1" data-testid="regra-alvo-id" />
      </div>
    </template>
    <div class="campo">
      <label for="regra-valor">{{ t('estruturada.preco.valor') }}</label>
      <input
        id="regra-valor"
        v-model="valor"
        inputmode="decimal"
        autocomplete="off"
        data-testid="regra-valor"
      />
    </div>
    <div class="campo">
      <label for="regra-prioridade">{{ t('estruturada.preco.prioridade') }}</label>
      <input
        id="regra-prioridade"
        v-model.number="prioridade"
        type="number"
        min="0"
        max="65535"
        data-testid="regra-prioridade"
      />
    </div>
    <div class="campo">
      <label for="regra-inicio">{{ t('estruturada.preco.inicio') }}</label>
      <input id="regra-inicio" v-model="inicio" type="date" data-testid="regra-inicio" />
    </div>
    <div class="campo">
      <label for="regra-fim">{{ t('estruturada.preco.fim') }}</label>
      <input id="regra-fim" v-model="fim" type="date" data-testid="regra-fim" />
    </div>
    <p v-if="problema && valor" role="alert" data-testid="regra-problema">{{ problema }}</p>
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="r ? t('estruturada.preco.gravar') : t('estruturada.preco.incluir')"
        :desabilitado="!podeGravar"
        data-testid="regra-gravar"
      />
      <template v-if="r && r.situacaoRevisao === 'estimada'">
        <SanteBotao
          variante="secundario"
          :rotulo="t('estruturada.preco.confirmar')"
          :desabilitado="!podeGravar"
          data-testid="regra-confirmar"
          @acionar="gravar('confirmada')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('estruturada.preco.recusar')"
          :desabilitado="!podeGravar"
          data-testid="regra-recusar"
          @acionar="gravar('recusada')"
        />
      </template>
      <SanteBotao variante="texto" :rotulo="t('agenda.cancelar')" @acionar="emit('cancelar')" />
    </div>
    <ErroAgenda v-if="erro" :erro="erro" />
  </form>
</template>
