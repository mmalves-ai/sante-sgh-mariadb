<script setup lang="ts">
// Coparticipação e cobrança avulsa (M56, etapa 3, F2): a coparticipação do evento de um beneficiário (o valor pela regra
// do produto: percentual do evento ou valor fixo, nunca acima do evento) e a cobrança avulsa ao contrato (opcionalmente
// de um beneficiário dele). O pagador vem do contrato (o titular na pessoa física, o contratante na jurídica).
import type { BeneficiarioLista, TelaCobranca } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lancarAvulsa, lancarCoparticipacao } from '../../api-cobranca.js';
import { lerBeneficiariosOperadora } from '../../api-operadora.js';
import ErroOperadora from '../f1/ErroOperadora.vue';
import { competenciaDe, numeroDe } from './comum.js';
import SeletorContrato from './SeletorContrato.vue';

const props = defineProps<{ tela: TelaCobranca; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const tipo = ref<'coparticipacao' | 'avulsa'>('coparticipacao');
const opcoesTipo = computed(() => [
  { valor: 'coparticipacao' as const, rotulo: t('operadoraCobranca.lancamentos.coparticipacao') },
  { valor: 'avulsa' as const, rotulo: t('operadoraCobranca.lancamentos.avulsa') },
]);
const busca = ref('');
const achados = ref<BeneficiarioLista[]>([]);
const beneficiario = ref<number | null>(null);
const contrato = ref<number | null>(null);
const competencia = ref(props.tela.hoje ? competenciaDe(props.tela.hoje) : '');
const vencimento = ref<string | null>(null);
const valor = ref('');
const descricao = ref('');
const mensagem = ref<string | null>(null);
/** Os avisos do lançamento (por exemplo, a coparticipação limitada pelo teto: o calculado e o lançado). */
const avisos = ref<readonly string[]>([]);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const opcoesBeneficiario = computed(() => [
  ...(tipo.value === 'avulsa'
    ? [{ valor: null as number | null, rotulo: t('operadoraCobranca.lancamentos.nenhumBeneficiario') }]
    : []),
  ...achados.value
    .filter((b) => tipo.value === 'coparticipacao' || b.contrato === contrato.value)
    .map((b) => ({
      valor: b.id as number | null,
      rotulo: `${b.nome} · ${b.carteirinha} · ${b.contratoNumero}`,
    })),
]);

async function buscar(): Promise<void> {
  erro.value = null;
  try {
    const r = await lerBeneficiariosOperadora({
      operadora: props.operadora,
      busca: busca.value.trim() || null,
      contrato: tipo.value === 'avulsa' ? contrato.value : null,
    });
    achados.value = r.itens;
    beneficiario.value = tipo.value === 'coparticipacao' ? (r.itens[0]?.id ?? null) : null;
  } catch (e) {
    erro.value = e;
  }
}

async function lancar(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  avisos.value = [];
  try {
    const comum = {
      competencia: competencia.value.trim(),
      vencimento: vencimento.value,
      descricao: descricao.value,
    };
    const r =
      tipo.value === 'coparticipacao'
        ? await lancarCoparticipacao({
            ...comum,
            beneficiario: beneficiario.value,
            valorEvento: numeroDe(valor.value),
          })
        : await lancarAvulsa({
            ...comum,
            contrato: contrato.value,
            beneficiario: beneficiario.value,
            valor: numeroDe(valor.value),
          });
    mensagem.value = r.mensagem;
    avisos.value = r.avisos ?? [];
    valor.value = '';
    descricao.value = '';
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
  <section class="bloco" aria-labelledby="ope-lancamentos-titulo" data-testid="operadora-lancamentos">
    <h2 id="ope-lancamentos-titulo">{{ t('operadoraCobranca.lancamentos.titulo') }}</h2>
    <SanteOpcoes
      v-model="tipo"
      :legenda="t('operadoraCobranca.lancamentos.tipo')"
      :opcoes="opcoesTipo"
      nome="lancamento-tipo"
    />
    <SeletorContrato
      v-if="tipo === 'avulsa'"
      v-model="contrato"
      :operadora="operadora"
      :rotulo="t('operadoraCobranca.lancamentos.contrato')"
      testid="lancamento-contrato"
    />
    <form class="campos" role="search" @submit.prevent="buscar">
      <SanteCampoTexto
        v-model="busca"
        :rotulo="t('operadoraCobranca.lancamentos.buscarBeneficiario')"
        :max-bytes="60"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.filtro.buscar')"
          variante="secundario"
          tipo="submit"
          data-testid="lancamento-buscar"
        />
      </div>
    </form>
    <form class="campos" data-testid="form-lancamento" @submit.prevent="lancar">
      <SanteSelecao
        v-model="beneficiario"
        :rotulo="
          tipo === 'avulsa'
            ? t('operadoraCobranca.lancamentos.beneficiarioOpcional')
            : t('operadoraCobranca.lancamentos.beneficiario')
        "
        :opcoes="opcoesBeneficiario"
        busca
        data-testid="lancamento-beneficiario"
      />
      <SanteCampoTexto
        v-model="competencia"
        :rotulo="t('operadoraCobranca.lancamentos.competencia')"
        :max-bytes="7"
        obrigatorio
      />
      <SanteData v-model="vencimento" :rotulo="t('operadoraCobranca.lancamentos.vencimento')" editavel />
      <SanteCampoTexto
        v-model="valor"
        :rotulo="
          tipo === 'coparticipacao'
            ? t('operadoraCobranca.lancamentos.valorEvento')
            : t('operadoraCobranca.lancamentos.valor')
        "
        :max-bytes="15"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="descricao"
        :rotulo="t('operadoraCobranca.lancamentos.descricao')"
        :max-bytes="200"
        obrigatorio
      />
      <div class="acoes">
        <SanteBotao
          v-if="tela.acoes.gerar"
          :rotulo="t('operadoraCobranca.lancamentos.lancar')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="lancamento-gravar"
        />
      </div>
    </form>
    <div v-if="mensagem" role="status" data-testid="mensagem-lancamento">
      <p>{{ mensagem }}</p>
      <p v-for="(a, i) in avisos" :key="i" data-testid="aviso-lancamento">{{ a }}</p>
    </div>
    <ErroOperadora v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
