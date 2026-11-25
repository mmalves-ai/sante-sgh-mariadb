<script setup lang="ts">
// Lançamento de eventos (ficha do M33, seção 7): `/repasse/lancamentos`. Os lançamentos da competência (origem, RPA em
// que entraram e, no estorno, o lançamento original ligado), o ajuste avulso com justificativa e o estorno por glosa
// (negativo, no período seguinte, ligado ao original; nunca altera o repasse pago). O lançamento da apuração aprovada
// sai da tela de apuração. O médico é escolhido pela busca (nome e conselho); o estorno herda o médico e o registro
// do lançamento original.
import type { LancamentoRepasseResposta } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import MinhaCompetenciaTrabalho from '../../tiss/componentes/MinhaCompetenciaTrabalho.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import { lancar, lerLancamentos, novaChave } from '../api-repasse.js';
import { data, opcoes, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo } = usarRepasse();
const competencia = ref('');
const consultada = ref('');
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !competencia.value) {
      competencia.value = h.slice(0, 7);
      consultada.value = competencia.value;
    }
  },
  { immediate: true },
);
// A competência de trabalho do faturista no módulo do repasse é o padrão do filtro (sem ela, o mês corrente); o mês
// que o usuário trocou à mão não é sobrescrito.
const padraoTrabalho = ref('');
function aoEscolherTrabalho(c: string) {
  const anterior = padraoTrabalho.value || (apoio.data.value?.hoje ?? '').slice(0, 7);
  if (!competencia.value || competencia.value === anterior) {
    competencia.value = c;
    consultada.value = c;
  }
  padraoTrabalho.value = c;
}
const lista = useQuery({
  queryKey: computed(() => ['repasse', 'lancamentos', consultada.value]),
  queryFn: () => lerLancamentos(consultada.value),
  enabled: computed(() => consultada.value !== ''),
});
const eventos = computed(() => opcoes(apoio.data.value?.eventos));
const form = reactive({
  origem: 'ajuste' as 'ajuste' | 'estorno',
  prestador: '',
  profissional: '',
  evento: '',
  valor: '',
  estornaDe: null as number | null,
  justificativa: '',
});
const aberto = ref(false);
/** O estorno herda o médico do original; sem o registro ligado no original, a busca fica aberta. */
const herdado = ref(false);
function novo(original?: LancamentoRepasseResposta) {
  herdado.value = !!original?.registro;
  Object.assign(form, {
    origem: original ? 'estorno' : 'ajuste',
    prestador: original?.registro ? String(original.prestador) : '',
    profissional: original?.registro ? String(original.registro) : '',
    evento: original ? String(original.evento) : (eventos.value[0]?.valor ?? ''),
    valor: '',
    estornaDe: original?.id ?? null,
    justificativa: '',
  });
  aberto.value = true;
}
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const mensagem = ref<string | null>(null);
async function gravar() {
  erro.value = null;
  mensagem.value = null;
  aviso.value = null;
  if (!form.prestador || !form.profissional) {
    aviso.value = t('repasse.busca.escolha');
    return;
  }
  try {
    const hoje = apoio.data.value?.hoje ?? '';
    const valor = Math.abs(Number(form.valor.replace(',', '.')));
    const r = await lancar(
      {
        origem: form.origem,
        empresa: 1,
        competencia: hoje.slice(0, 7),
        data: hoje,
        evento: Number(form.evento),
        tipo: 'M',
        prestador: Number(form.prestador),
        profissional: Number(form.profissional) || null,
        valor: form.origem === 'estorno' ? -valor : valor,
        justificativa: form.justificativa,
        estornaDe: form.estornaDe,
      },
      novaChave('lancar'),
    );
    mensagem.value = r.mensagem;
    aberto.value = false;
    consultada.value = hoje.slice(0, 7);
    await qc.invalidateQueries({ queryKey: ['repasse'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="lc-titulo" data-testid="tela-rep-lancamentos">
    <h1 id="lc-titulo">{{ t('repasse.lancamentos.titulo') }}</h1>
    <MinhaCompetenciaTrabalho
      modulo="repasse"
      :hoje="apoio.data.value?.hoje ?? ''"
      @escolhida="aoEscolherTrabalho"
    />
    <form class="filtros" @submit.prevent="consultada = competencia">
      <span class="campo">
        <label for="lc-comp">{{ t('repasse.competencia') }}</label>
        <input id="lc-comp" v-model="competencia" type="month" data-testid="lc-competencia" />
      </span>
      <button type="submit" data-testid="lc-consultar">{{ t('repasse.consultar') }}</button>
      <button
        type="button"
        :disabled="!pode('repasse.lancarEvento', 'repasse.lancamento.criar')"
        :title="motivo('repasse.lancarEvento') ?? undefined"
        data-testid="lc-novo"
        @click="novo()"
      >
        {{ t('repasse.lancamentos.novo') }}
      </button>
    </form>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="lc-lista">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{{ t('repasse.prestador') }}</th>
          <th scope="col">{{ t('repasse.data') }}</th>
          <th scope="col">{{ t('repasse.evento') }}</th>
          <th scope="col">{{ t('repasse.valor') }}</th>
          <th scope="col">{{ t('repasse.lancamentos.emRpa') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in lista.data.value" :key="l.id">
          <td>{{ l.id }}</td>
          <td>{{ l.prestador }}</td>
          <td>{{ data(l.data) }}</td>
          <td>
            {{ l.eventoRotulo }}
            <span v-if="l.estornaDe" class="secundario"
              >({{ t('repasse.lancamentos.estornoDe', { id: l.estornaDe }) }})</span
            >
          </td>
          <td>{{ reais(l.valor) }}</td>
          <td>{{ l.emRpa ?? t('repasse.lancamentos.semRpa') }}</td>
          <td>
            <button
              v-if="l.valor > 0"
              type="button"
              :disabled="!pode('repasse.lancarEvento', 'repasse.lancamento.criar')"
              :data-testid="`lc-estornar-${l.id}`"
              @click="novo(l)"
            >
              {{ t('repasse.lancamentos.estorno') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>

    <form v-if="aberto" class="formulario" data-testid="lc-form" @submit.prevent="gravar">
      <h2>
        {{
          form.origem === 'estorno'
            ? t('repasse.lancamentos.estornoDe', { id: form.estornaDe })
            : t('repasse.lancamentos.ajuste')
        }}
      </h2>
      <BuscaPrestador
        v-model="form.prestador"
        v-model:registro="form.profissional"
        :rotulo="t('repasse.prestador')"
        :fixo="form.origem === 'estorno' && herdado"
        testid="lc-prestador"
      />
      <span class="campo">
        <SanteSelecao
          v-model="form.evento"
          :rotulo="t('repasse.evento')"
          :opcoes="eventos"
          data-testid="lc-evento"
        />
      </span>
      <span class="campo">
        <label for="lc-valor">{{ t('repasse.valor') }}</label>
        <input id="lc-valor" v-model="form.valor" inputmode="decimal" required data-testid="lc-valor" />
      </span>
      <span class="campo largo">
        <label for="lc-just">{{ t('repasse.justificativa') }}</label>
        <textarea
          id="lc-just"
          v-model="form.justificativa"
          rows="2"
          required
          data-testid="lc-justificativa"
        />
        <small>{{ t('repasse.justificativaAjuda') }}</small>
      </span>
      <p v-if="aviso" role="alert" data-testid="lc-aviso">{{ aviso }}</p>
      <button type="submit" data-testid="lc-gravar">{{ t('repasse.gravar') }}</button>
      <button type="button" @click="aberto = false">{{ t('repasse.cancelar') }}</button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="lc-mensagem" />
  </section>
</template>

<style src="../estilo-repasse.css"></style>
