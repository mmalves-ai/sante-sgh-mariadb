<script setup lang="ts">
// Acordo de parcelamento (M56, etapa 3, F2): as cobranças em aberto do contrato escolhidas, o número de parcelas e o
// primeiro vencimento; a prévia (principal, multa e juros até hoje ou a dispensa com o motivo, e as parcelas mensais com
// os centavos na última) e o acordo, com a confirmação. As escolhidas ficam renegociadas no acordo.
import type { PreviaAcordo, TelaCobranca } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fazerAcordo, lerCobrancas, previaAcordo } from '../../api-cobranca.js';
import ErroOperadora from '../f1/ErroOperadora.vue';
import { competenciaBr, dataBr, reais, brl } from './comum.js';
import SeletorContrato from './SeletorContrato.vue';

const props = defineProps<{ tela: TelaCobranca; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const contrato = ref<number | null>(null);
const escolhidas = ref<number[]>([]);
const parcelas = ref<number>(3);
const primeiroVencimento = ref<string | null>(props.tela.hoje || null);
const dispensar = ref(false);
const motivoDispensa = ref('');
const previa = ref<PreviaAcordo | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const abertas = useQuery({
  queryKey: computed(() => ['operadora', 'cobrancas', 'acordo', props.operadora, contrato.value]),
  queryFn: () => lerCobrancas({ operadora: props.operadora, contrato: contrato.value, situacao: 'aberta' }),
  enabled: computed(() => contrato.value !== null),
});
watch(contrato, () => {
  escolhidas.value = [];
  previa.value = null;
});
const opcoesParcelas = computed(() =>
  Array.from({ length: props.tela.parametros.parcelasMaximas }, (_, i) => ({
    valor: i + 1,
    rotulo: String(i + 1),
  })),
);

const corpo = () => ({
  contrato: contrato.value,
  cobrancas: (abertas.data.value?.itens ?? [])
    .filter((c) => escolhidas.value.includes(c.id))
    .map((c) => ({ id: c.id, versao: c.versao })),
  parcelas: parcelas.value,
  primeiroVencimento: primeiroVencimento.value,
  dispensarEncargos: dispensar.value,
  motivoDispensa: dispensar.value ? motivoDispensa.value || null : null,
});

async function verPrevia(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    previa.value = await previaAcordo(corpo());
  } catch (e) {
    erro.value = e;
    previa.value = null;
  } finally {
    ocupado.value = false;
  }
}

async function fazer(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await fazerAcordo(corpo());
    mensagem.value = r.mensagem;
    previa.value = null;
    escolhidas.value = [];
    await cliente.invalidateQueries({ queryKey: ['operadora', 'cobrancas'] });
    emit('mudou');
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-acordo-titulo" data-testid="operadora-acordo">
    <h2 id="ope-acordo-titulo">{{ t('operadoraCobranca.acordo.titulo') }}</h2>
    <p>{{ t('operadoraCobranca.acordo.texto') }}</p>
    <SeletorContrato
      v-model="contrato"
      :operadora="operadora"
      :rotulo="t('operadoraCobranca.acordo.contrato')"
      testid="acordo-contrato"
    />
    <ErroOperadora v-if="abertas.isError.value" :erro="abertas.error.value" />
    <table v-else-if="abertas.data.value?.itens.length" class="tabela" data-testid="tabela-acordo-abertas">
      <caption>
        {{
          t('operadoraCobranca.acordo.abertas')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraCobranca.acordo.escolher') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.tipo') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.competencia') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.vencimento') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.valor') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.encargos') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in abertas.data.value.itens" :key="c.id">
          <td>
            <input
              v-model="escolhidas"
              type="checkbox"
              :value="c.id"
              :aria-label="`${t('operadoraCobranca.acordo.escolher')}: ${competenciaBr(c.competencia)} ${dataBr(c.vencimento)}`"
              :data-testid="`acordo-escolher-${c.competencia}-${c.tipo}`"
            />
          </td>
          <td>{{ t(`operadoraCobranca.tipos.${c.tipo}`) }}</td>
          <td>{{ competenciaBr(c.competencia) }}</td>
          <td>{{ dataBr(c.vencimento) }}</td>
          <td>{{ brl(c.valor) }}</td>
          <td>{{ c.encargosHoje.total > 0 ? `${brl(c.encargosHoje.total)}` : '—' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="abertas.data.value">{{ t('operadoraCobranca.nenhum') }}</p>
    <form v-if="contrato !== null" class="campos" data-testid="form-acordo" @submit.prevent="verPrevia">
      <SanteSelecao
        v-model="parcelas"
        :rotulo="t('operadoraCobranca.acordo.parcelas')"
        :opcoes="opcoesParcelas"
        data-testid="acordo-parcelas"
      />
      <SanteData
        v-model="primeiroVencimento"
        :rotulo="t('operadoraCobranca.acordo.primeiroVencimento')"
        editavel
      />
      <label class="acoes">
        <input v-model="dispensar" type="checkbox" data-testid="acordo-dispensar" />
        <span>{{ t('operadoraCobranca.acordo.dispensar') }}</span>
      </label>
      <SanteCampoTexto
        v-if="dispensar"
        v-model="motivoDispensa"
        :rotulo="t('operadoraCobranca.acordo.motivoDispensa')"
        :max-bytes="200"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.acordo.previa')"
          variante="secundario"
          tipo="submit"
          :desabilitado="ocupado || escolhidas.length === 0"
          data-testid="acordo-previa"
        />
      </div>
    </form>
    <template v-if="previa">
      <p data-testid="acordo-resumo">
        {{
          t('operadoraCobranca.acordo.resumo', {
            principal: reais(previa.principal),
            encargos: reais(previa.encargos),
            total: reais(previa.total),
          })
        }}
      </p>
      <table class="tabela" data-testid="tabela-acordo-parcelas">
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraCobranca.acordo.parcela') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.vencimento') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in previa.parcelas" :key="p.numero">
            <th scope="row">{{ p.numero }}</th>
            <td>{{ dataBr(p.vencimento) }}</td>
            <td>{{ brl(p.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="tela.acoes.gerar" class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.acordo.fazer')"
          variante="destrutivo"
          :confirmacao="
            t('operadoraCobranca.acordo.resumo', {
              principal: reais(previa.principal),
              encargos: reais(previa.encargos),
              total: reais(previa.total),
            })
          "
          :desabilitado="ocupado"
          data-testid="acordo-fazer"
          @acionar="fazer"
        />
      </div>
    </template>
    <p v-if="mensagem" role="status" data-testid="mensagem-acordo">{{ mensagem }}</p>
    <ErroOperadora v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
