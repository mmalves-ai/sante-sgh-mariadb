<script setup lang="ts">
// Fechamento do período financeiro (F3.8, 07-FIN linha 85): `/financeiro/tesouraria/periodo`. A tela já sugere a
// próxima competência a fechar (um clique); o servidor confere a ordem dos meses e trava os lançamentos com data no mês
// fechado. Reabrir só aparece no último mês fechado, com a justificativa conferida enquanto se digita. Ao escolher uma
// competência, o saldo gravado de cada dia da conta aparece abaixo (consulta histórica sem recalcular).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import { fecharPeriodo, lerPeriodos, lerSaldoDiario, reabrirPeriodo } from '../api-periodo.js';
import { data, opcoesContas, quando, reais, somarMeses, usarFinanceiro } from '../usar-financeiro.js';

const MINIMO = 15;
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const periodos = useQuery({ queryKey: ['financeiro', 'periodos'], queryFn: () => lerPeriodos() });
const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const mesDeHoje = computed(() => (apoio.data.value ? `${apoio.data.value.hoje.slice(0, 7)}-01` : null));

const ultimaFechada = computed(
  () =>
    (periodos.data.value ?? [])
      .filter((p) => p.situacao === 'fechado')
      .map((p) => p.competencia)
      .sort()
      .at(-1) ?? null,
);
/** A próxima a fechar: a mais antiga aberta depois da última fechada, ou o mês seguinte a ela; nunca o mês corrente. */
const proxima = computed(() => {
  const hoje = mesDeHoje.value;
  if (!hoje) return null;
  const u = ultimaFechada.value;
  const abertas = (periodos.data.value ?? [])
    .filter((p) => p.situacao !== 'fechado' && (!u || p.competencia > u))
    .map((p) => p.competencia);
  const candidata = [...abertas, u ? somarMeses(u, 1) : somarMeses(hoje, -1)].sort()[0];
  return candidata && candidata < hoje ? candidata : null;
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
const reabrindo = ref<string | null>(null);
const justificativa = ref('');
let chave = novaChave('periodo');
async function acao(f: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f()).mensagem;
    chave = novaChave('periodo');
    reabrindo.value = null;
    justificativa.value = '';
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const fechar = (c: string) => acao(() => fecharPeriodo(c, chave));
const faltam = computed(() => Math.max(0, MINIMO - justificativa.value.trim().length));
const reabrir = () => {
  const c = reabrindo.value;
  if (c) void acao(() => reabrirPeriodo(c, justificativa.value, chave));
};

// Saldo diário: a conta do escopo e a competência escolhida (padrão: a última fechada).
const conta = ref('');
const escolhida = ref<string | null>(null);
watch(
  () => apoio.data.value,
  (a) => {
    if (a && !conta.value && a.contas[0]) conta.value = String(a.contas[0].id);
  },
  { immediate: true },
);
watch(ultimaFechada, (u) => {
  if (u && !escolhida.value) escolhida.value = u;
});
const contas = computed(() => opcoesContas(apoio.data.value?.contas));
const fimDoMes = (c: string) => {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const saldos = useQuery({
  queryKey: computed(() => ['financeiro', 'saldo-diario', conta.value, escolhida.value]),
  queryFn: () =>
    lerSaldoDiario({
      conta: Number(conta.value),
      de: escolhida.value as string,
      ate: fimDoMes(escolhida.value as string),
    }),
  enabled: computed(() => !!conta.value && !!escolhida.value),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pf-titulo" data-testid="tela-fin-periodo">
    <h1 id="pf-titulo">{{ t('financeiro.periodo.titulo') }}</h1>
    <p>{{ t('financeiro.periodo.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('tesouraria')" />
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />

    <p v-if="proxima" class="resumo">
      {{ t('financeiro.periodo.proxima', { competencia: mes(proxima) }) }}
      <button
        type="button"
        :disabled="gravando || !pode('financeiro.fecharPeriodo', 'financeiro.movimento.criar')"
        :title="motivo('financeiro.fecharPeriodo') ?? undefined"
        data-testid="pf-fechar"
        @click="fechar(proxima)"
      >
        {{ t('financeiro.periodo.fechar') }}
      </button>
    </p>

    <ErroFaturamento v-if="periodos.error.value" :erro="periodos.error.value" />
    <table v-else-if="periodos.data.value?.length" class="tabela" data-testid="pf-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.periodo.competencia') }}</th>
          <th scope="col">{{ t('financeiro.periodo.situacao') }}</th>
          <th scope="col">{{ t('financeiro.periodo.fechadoEm') }}</th>
          <th scope="col">{{ t('financeiro.periodo.fechadoPor') }}</th>
          <th scope="col">{{ t('financeiro.periodo.movimentos') }}</th>
          <th scope="col">{{ t('financeiro.periodo.reabertura') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in periodos.data.value" :key="p.competencia" :data-testid="`pf-linha-${p.competencia}`">
          <td>
            <button type="button" class="link" @click="escolhida = p.competencia">
              {{ mes(p.competencia) }}
            </button>
          </td>
          <td>{{ t(`financeiro.periodo.situacoes.${p.situacao}`) }}</td>
          <td>{{ p.fechadoEm ? quando(p.fechadoEm) : '—' }}</td>
          <td>{{ p.fechadoPor ?? '—' }}</td>
          <td>{{ p.movimentos ?? '—' }}</td>
          <td>
            {{ p.reabertoEm ? `${quando(p.reabertoEm)} · ${p.reabertoPor} · ${p.justificativa}` : '—' }}
          </td>
          <td>
            <button
              v-if="
                p.competencia === ultimaFechada &&
                pode('financeiro.reabrirPeriodo', 'financeiro.parametro.editar')
              "
              type="button"
              :data-testid="`pf-reabrir-${p.competencia}`"
              @click="reabrindo = p.competencia"
            >
              {{ t('financeiro.periodo.reabrir') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="periodos.data.value">{{ t('financeiro.nenhum') }}</p>

    <form v-if="reabrindo" class="formulario" data-testid="pf-reabertura" @submit.prevent="reabrir">
      <h2>{{ t('financeiro.periodo.reabrir') }} {{ mes(reabrindo) }}</h2>
      <span class="campo">
        <label for="pf-justificativa">{{ t('financeiro.periodo.justificativa') }}</label>
        <textarea
          id="pf-justificativa"
          v-model="justificativa"
          maxlength="500"
          :aria-invalid="faltam > 0"
          data-testid="pf-justificativa"
        ></textarea>
        <small v-if="faltam > 0">{{ faltam }}</small>
      </span>
      <button type="submit" :disabled="gravando || faltam > 0" data-testid="pf-confirmar-reabertura">
        {{ t('financeiro.periodo.confirmarReabertura') }}
      </button>
      <button type="button" @click="reabrindo = null">{{ t('financeiro.cancelar') }}</button>
    </form>

    <h2>{{ t('financeiro.periodo.saldoDiario') }} {{ escolhida ? mes(escolhida) : '' }}</h2>
    <span class="campo">
      <SanteSelecao v-model="conta" :rotulo="t('financeiro.conta')" :opcoes="contas" data-testid="pf-conta" />
    </span>
    <ErroFaturamento v-if="saldos.error.value" :erro="saldos.error.value" />
    <table v-else-if="saldos.data.value?.length" class="tabela" data-testid="pf-saldos">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.data') }}</th>
          <th scope="col">{{ t('financeiro.periodo.saldoAnterior') }}</th>
          <th scope="col">{{ t('financeiro.periodo.entradas') }}</th>
          <th scope="col">{{ t('financeiro.periodo.saidas') }}</th>
          <th scope="col">{{ t('financeiro.periodo.saldoFinal') }}</th>
          <th scope="col">{{ t('financeiro.periodo.fechadoDia') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in saldos.data.value" :key="d.data">
          <td>{{ data(d.data) }}</td>
          <td>{{ reais(d.saldoAnterior) }}</td>
          <td>{{ reais(d.entradas) }}</td>
          <td>{{ reais(d.saidas) }}</td>
          <td>{{ reais(d.saldoFinal) }}</td>
          <td>{{ d.fechado ? t('financeiro.periodo.sim') : t('financeiro.periodo.nao') }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="saldos.data.value" data-testid="pf-sem-saldo">{{ t('financeiro.periodo.semSaldo') }}</p>
  </section>
</template>
