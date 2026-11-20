<script setup lang="ts">
// Pagamento aos prestadores (M56, etapa 6, F5; `operadora.conta.pagar`, a área financeira da operadora): os lotes
// liberados pela auditoria com o valor a pagar e o prazo, os pagos e todos; o registro do pagamento (o valor até o saldo,
// a data e o documento). Só os valores: as guias e os procedimentos ficam com a auditoria.
import type { ApoioContas, PagamentoPrestador, ResultadoConta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { lerPagamentos, pagarConta } from '../../api-contas.js';
import { dataBr, numeroDe } from '../f1/comum.js';

const props = defineProps<{ apoio: ApoioContas }>();
const emit = defineEmits<{ gravado: [r: ResultadoConta] }>();
const { t } = useI18n();
const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const estado = ref<'a-pagar' | 'pagas' | 'todas'>('a-pagar');
const prestador = ref<number | null>(null);
const opcoesEstado = computed(() =>
  (['a-pagar', 'pagas', 'todas'] as const).map((e) => ({
    valor: e,
    rotulo: t(`operadoraContas.pagamentos.estados.${e}`),
  })),
);
const opcoesPrestador = computed(() => [
  { valor: null as number | null, rotulo: t('operadoraContas.filtro.todos') },
  ...props.apoio.prestadores.map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
]);
const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => [
    'operadora',
    'contas',
    'pagamentos',
    estado.value,
    prestador.value,
    cursor.value,
  ]),
  queryFn: () => lerPagamentos({ estado: estado.value, prestador: prestador.value, apos: cursor.value }),
});

const alvo = ref<PagamentoPrestador | null>(null);
const visivel = computed({
  get: () => alvo.value !== null,
  set: (v: boolean) => {
    if (!v) alvo.value = null;
  },
});
const valor = ref('');
const dataPagamento = ref<string | null>(null);
const documento = ref('');
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);
function abrir(p: PagamentoPrestador): void {
  alvo.value = p;
  valor.value = String(p.saldo).replace('.', ',');
  dataPagamento.value = props.apoio.hoje;
  documento.value = '';
  recusa.value = null;
  erro.value = null;
}
const completo = computed(() => {
  const v = numeroDe(valor.value);
  return v !== null && v > 0 && !!dataPagamento.value && documento.value.trim().length >= 1;
});
async function pagar(): Promise<void> {
  const p = alvo.value;
  if (!p || !completo.value) return;
  recusa.value = null;
  erro.value = null;
  enviando.value = true;
  try {
    const r = await pagarConta(p.id, {
      versao: p.versao,
      valor: numeroDe(valor.value),
      data: dataPagamento.value,
      documento: documento.value,
    });
    alvo.value = null;
    emit('gravado', r);
    await lista.refetch();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="conta-pag-titulo" data-testid="conta-pagamentos">
    <h2 id="conta-pag-titulo">{{ t('operadoraContas.pagamentos.titulo') }}</h2>
    <p class="secundario">{{ t('operadoraContas.pagamentos.texto') }}</p>
    <dl v-if="lista.data.value" class="totais" data-testid="conta-pag-totais">
      <div>
        <dt>{{ t('operadoraContas.totais.aPagar') }}</dt>
        <dd>{{ lista.data.value.totais.aPagar }}</dd>
      </div>
      <div>
        <dt>{{ t('operadoraContas.totais.valorAPagar') }}</dt>
        <dd data-testid="conta-pag-valor">{{ brl(lista.data.value.totais.valorAPagar) }}</dd>
      </div>
      <div>
        <dt>{{ t('operadoraContas.totais.vencidas') }}</dt>
        <dd>{{ lista.data.value.totais.vencidas }}</dd>
      </div>
    </dl>
    <div class="campos">
      <SanteSelecao
        v-model="estado"
        :rotulo="t('operadoraContas.pagamentos.estado')"
        :opcoes="opcoesEstado"
        data-testid="conta-pag-estado"
        @update:model-value="cursores = [null]"
      />
      <SanteSelecao
        v-model="prestador"
        :rotulo="t('operadoraContas.filtro.prestador')"
        :opcoes="opcoesPrestador"
        :busca="true"
        data-testid="conta-pag-prestador"
        @update:model-value="cursores = [null]"
      />
    </div>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('operadoraContas.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="conta-pag-vazia">
      {{ t('operadoraContas.pagamentos.nenhum') }}
    </p>
    <table v-else class="tabela" data-testid="conta-pag-lista">
      <caption class="visualmente-oculto">
        {{
          t('operadoraContas.pagamentos.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraContas.colunas.protocolo') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.prestador') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.lote') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.competencia') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.liberado') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.pago') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.saldo') }}</th>
          <th scope="col">{{ t('operadoraContas.colunas.prazo') }}</th>
          <th scope="col">
            <span class="visualmente-oculto">{{ t('operadoraContas.colunas.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`conta-pag-${p.id}`">
          <td>{{ p.protocolo }}</td>
          <td>{{ p.prestadorNome }}</td>
          <td>{{ p.numeroLote }}</td>
          <td>{{ p.competencia }}</td>
          <td>{{ brl(p.liberado) }}</td>
          <td>{{ brl(p.pago) }}</td>
          <td :data-testid="`conta-pag-${p.id}-saldo`">{{ brl(p.saldo) }}</td>
          <td>
            {{ dataBr(p.prazoPagamento) }}
            <strong v-if="p.vencida"> · {{ t('operadoraContas.prazoVencido') }}</strong>
          </td>
          <td>
            <SanteBotao
              v-if="p.situacao === 'analisada' && p.saldo > 0"
              variante="texto"
              :rotulo="t('operadoraContas.acoes.pagar')"
              :data-testid="`conta-pagar-${p.id}`"
              @acionar="abrir(p)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="lista.data.value" class="acoes">
      <SanteBotao
        v-if="cursores.length > 1"
        variante="secundario"
        :rotulo="t('operadoraContas.paginas.anterior')"
        @acionar="cursores = cursores.slice(0, -1)"
      />
      <SanteBotao
        v-if="lista.data.value.proxima"
        variante="secundario"
        :rotulo="t('operadoraContas.paginas.proxima')"
        @acionar="cursores = [...cursores, lista.data.value.proxima]"
      />
    </div>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="
        alvo
          ? t('operadoraContas.pagamentos.dialogo', {
              protocolo: alvo.protocolo,
              prestador: alvo.prestadorNome,
            })
          : ''
      "
      largura="36rem"
    >
      <div v-if="alvo" class="formulario" data-testid="form-pagamento">
        <p class="secundario">
          {{ t('operadoraContas.pagamentos.textoDialogo', { saldo: brl(alvo.saldo) }) }}
        </p>
        <SanteCampoTexto
          id="conta-pag-valor-campo"
          v-model="valor"
          :rotulo="t('operadoraContas.pagamentos.valor')"
          :max-bytes="16"
          obrigatorio
        />
        <SanteData
          v-model="dataPagamento"
          :rotulo="t('operadoraContas.pagamentos.data')"
          editavel
          data-testid="conta-pag-data"
        />
        <SanteCampoTexto
          id="conta-pag-documento"
          v-model="documento"
          :rotulo="t('operadoraContas.pagamentos.documento')"
          :max-bytes="40"
          obrigatorio
        />
        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="conta-pag-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraContas.acoes.voltar')"
          @acionar="alvo = null"
        />
        <SanteBotao
          :rotulo="t('operadoraContas.acoes.pagar')"
          :desabilitado="!completo || enviando"
          data-testid="conta-pag-confirmar"
          @acionar="pagar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.totais div {
  display: grid;
  gap: 0.125rem;
}
.totais dd {
  font-size: 1.4rem;
  margin: 0;
}
.formulario {
  display: grid;
  gap: 0.75rem;
}
</style>
