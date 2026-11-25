<script setup lang="ts">
// F3.8, 07-FIN linha 109: o saldo a compensar do tributo que os tomadores retiveram do hospital. Por tributo: o retido,
// o já compensado e o que sobra, com a competência mais antiga em aberto. A compensação usa o crédito até a competência
// da tela: antes de gravar, a tela mostra o valor exato e pede a confirmação (depois dela as retenções não podem ser
// estornadas). As compensações feitas ficam listadas e podem ser canceladas com motivo: o crédito volta ao saldo.
import { creditoAteACompetencia } from '@sgh/dominio-financeiro';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  cancelarCompensacaoSofrida,
  compensarRetencaoSofrida,
  lerCompensacoesSofridas,
  lerSaldoACompensar,
  type SaldoACompensar,
} from '../api-retencao-sofrida.js';

const props = defineProps<{ competencia: string; pode: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Retido pelos tomadores: saldo a compensar',
      tributo: 'Tributo',
      retido: 'Retido',
      compensado: 'Compensado',
      aCompensar: 'A compensar',
      desde: 'Em aberto desde',
      compensar: 'Compensar na apuração de {competencia}',
      confirma:
        'Usar {valor} de {tributo} (retido até {competencia}) na apuração de {competencia}? Depois disso essas retenções não podem ser estornadas, só cancelando a compensação.',
      confirmar: 'Confirmar compensação de {valor}',
      desistir: 'Desistir',
      futuro: 'O crédito é de competência posterior a {competencia}.',
      nada: 'Nenhum tributo retido pelos tomadores.',
      acao: 'Compensar',
      feitas: 'Compensações feitas',
      numero: 'Número',
      competencia: 'Competência',
      valor: 'Valor',
      retencoes: 'Retenções',
      em: 'Feita em',
      cancelar: 'Cancelar compensação',
      motivo: 'Motivo do cancelamento da compensação {numero}',
      motivoCurto: 'Diga o motivo (5 letras ou mais).',
      confirmarCancelamento: 'Confirmar cancelamento',
    },
  },
});
const qc = useQueryClient();
const saldo = useQuery({ queryKey: ['financeiro', 'saldo-compensar'], queryFn: () => lerSaldoACompensar() });
const feitas = useQuery({
  queryKey: ['financeiro', 'saldo-compensar', 'compensacoes'],
  queryFn: () => lerCompensacoesSofridas(),
});
const valida = computed(() => /^\d{4}-\d{2}$/.test(props.competencia));
const erro = ref<unknown>(null);
const ok = ref('');
const gravando = ref(false);
/** O tributo com a confirmação aberta e a compensação com o motivo do cancelamento aberto. */
const confirmando = ref<number | null>(null);
const cancelando = ref<number | null>(null);
const motivo = ref('');
watch(
  () => props.competencia,
  () => (confirmando.value = null),
);
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** O valor que a compensação vai usar: só o crédito até a competência da tela. */
const cabe = (s: SaldoACompensar) => creditoAteACompetencia(s.creditos ?? [], props.competencia);
async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  ok.value = '';
  gravando.value = true;
  try {
    ok.value = (await fn()).mensagem;
    confirmando.value = null;
    cancelando.value = null;
    motivo.value = '';
    await qc.invalidateQueries({ queryKey: ['financeiro', 'saldo-compensar'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const compensar = (tributo: number) =>
  agir(() =>
    compensarRetencaoSofrida({ competencia: props.competencia, tributo }, novaChave('compensar-retido')),
  );
const cancelar = (apuracao: number) =>
  agir(() =>
    cancelarCompensacaoSofrida({ apuracao, motivo: motivo.value.trim() }, novaChave('cancelar-compensacao')),
  );
</script>

<template>
  <section aria-labelledby="sc-titulo" data-testid="sc-painel">
    <h2 id="sc-titulo">{{ t('titulo') }}</h2>
    <ErroFaturamento
      v-if="erro || saldo.error.value || feitas.error.value"
      :erro="erro ?? saldo.error.value ?? feitas.error.value"
    />
    <p v-if="ok" role="status" class="secundario" data-testid="sc-ok">{{ ok }}</p>
    <p v-if="saldo.data.value && !saldo.data.value.length" data-testid="sc-nada">{{ t('nada') }}</p>
    <table v-else-if="saldo.data.value" class="tabela" data-testid="sc-saldo">
      <thead>
        <tr>
          <th scope="col">{{ t('tributo') }}</th>
          <th scope="col">{{ t('retido') }}</th>
          <th scope="col">{{ t('compensado') }}</th>
          <th scope="col">{{ t('aCompensar') }}</th>
          <th scope="col">{{ t('desde') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('acao') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in saldo.data.value" :key="s.tributoId" :data-testid="`sc-linha-${s.tributo}`">
          <th scope="row">{{ s.tributo }}</th>
          <td>{{ brl(s.retido) }}</td>
          <td>{{ brl(s.compensado) }}</td>
          <td>{{ brl(s.aCompensar) }}</td>
          <td>{{ s.desde ?? '' }}</td>
          <td>
            <template v-if="s.aCompensar > 0 && valida">
              <small v-if="!(cabe(s) > 0)" class="secundario">
                {{ t('futuro', { competencia }) }}
              </small>
              <template v-else-if="confirmando === s.tributoId">
                <small class="secundario" role="alert" :data-testid="`sc-confirma-${s.tributo}`">
                  {{ t('confirma', { valor: brl(cabe(s)), tributo: s.tributo, competencia }) }}
                </small>
                <button
                  type="button"
                  :disabled="gravando || !pode"
                  data-testid="sc-confirmar"
                  @click="compensar(s.tributoId)"
                >
                  {{ t('confirmar', { valor: brl(cabe(s)) }) }}
                </button>
                <button type="button" data-testid="sc-desistir" @click="confirmando = null">
                  {{ t('desistir') }}
                </button>
              </template>
              <button
                v-else
                type="button"
                :disabled="gravando || !pode"
                :data-testid="`sc-compensar-${s.tributo}`"
                @click="confirmando = s.tributoId"
              >
                {{ t('compensar', { competencia }) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <template v-if="feitas.data.value?.length">
      <h3>{{ t('feitas') }}</h3>
      <table class="tabela" data-testid="sc-feitas">
        <thead>
          <tr>
            <th scope="col">{{ t('numero') }}</th>
            <th scope="col">{{ t('tributo') }}</th>
            <th scope="col">{{ t('competencia') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('retencoes') }}</th>
            <th scope="col">{{ t('em') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('cancelar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in feitas.data.value" :key="c.id" :data-testid="`sc-feita-${c.id}`">
            <th scope="row">{{ c.numero }}</th>
            <td>{{ c.tributo }}</td>
            <td>{{ c.competencia }}</td>
            <td>{{ brl(c.valor) }}</td>
            <td>{{ c.retencoes }}</td>
            <td>{{ c.em }}</td>
            <td>
              <button
                v-if="pode && cancelando !== c.id"
                type="button"
                :data-testid="`sc-cancelar-${c.id}`"
                @click="((cancelando = c.id), (motivo = ''))"
              >
                {{ t('cancelar') }}
              </button>
              <span v-if="cancelando === c.id" class="campo">
                <label :for="`sc-motivo-${c.id}`">{{ t('motivo', { numero: c.numero }) }}</label>
                <input :id="`sc-motivo-${c.id}`" v-model="motivo" maxlength="300" data-testid="sc-motivo" />
                <small v-if="motivo.trim().length < 5" class="secundario">{{ t('motivoCurto') }}</small>
                <button
                  type="button"
                  :disabled="gravando || motivo.trim().length < 5"
                  data-testid="sc-confirmar-cancelamento"
                  @click="cancelar(c.id)"
                >
                  {{ t('confirmarCancelamento') }}
                </button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
