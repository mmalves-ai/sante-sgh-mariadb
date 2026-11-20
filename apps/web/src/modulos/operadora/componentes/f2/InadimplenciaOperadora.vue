<script setup lang="ts">
// Inadimplência dos contratos da operadora (M56, etapa 3, F2): os contratos com cobrança vencida em aberto, os dias de
// atraso (o atual e os acumulados em 12 meses), as mensalidades em atraso, a situação pela lei (notificar até o 50º
// dia; no prazo de 10 dias; pode ser suspenso ou rescindido; coletivo pelo contrato) e o registro da notificação (data,
// meio e referência). A mensagem ao beneficiário só pela Hal-AI, com a base legal e em produção: a tela mostra o motivo.
import {
  type Inadimplente,
  MEIOS_NOTIFICACAO,
  type MeioNotificacao,
  type TelaCobranca,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerInadimplencia, notificarInadimplencia } from '../../api-cobranca.js';
import ErroOperadora from '../f1/ErroOperadora.vue';
import { brl, dataBr } from './comum.js';

const props = defineProps<{ tela: TelaCobranca; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const pagina = ref<number[]>([]);
const apos = computed(() => pagina.value.at(-1) ?? null);
const q = useQuery({
  queryKey: computed(() => ['operadora', 'cobrancas', 'inadimplencia', props.operadora, apos.value]),
  queryFn: () => lerInadimplencia(props.operadora, apos.value),
});
const notificando = ref<Inadimplente | null>(null);
const em = ref<string | null>(props.tela.hoje || null);
const meio = ref<MeioNotificacao>('carta-ar');
const referencia = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const opcoesMeio = Object.keys(MEIOS_NOTIFICACAO).map((m) => ({
  valor: m as MeioNotificacao,
  rotulo: t(`operadoraCobranca.inadimplencia.meios.${m}`),
}));

function prazo(i: Inadimplente): string {
  if (i.prazoNotificacao)
    return t('operadoraCobranca.inadimplencia.notificarAte', { data: dataBr(i.prazoNotificacao) });
  if (i.prazoPagamento)
    return t('operadoraCobranca.inadimplencia.pagarAte', { data: dataBr(i.prazoPagamento) });
  return '—';
}

async function notificar(): Promise<void> {
  const i = notificando.value;
  if (!i) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await notificarInadimplencia({
      contrato: i.contrato,
      em: em.value,
      meio: meio.value,
      referencia: referencia.value,
    });
    mensagem.value = r.mensagem;
    notificando.value = null;
    referencia.value = '';
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
  <section class="bloco" aria-labelledby="ope-inadimplencia-titulo" data-testid="operadora-inadimplencia">
    <h2 id="ope-inadimplencia-titulo">{{ t('operadoraCobranca.inadimplencia.titulo') }}</h2>
    <p>{{ t('operadoraCobranca.inadimplencia.texto') }}</p>
    <SanteAlerta
      v-if="!tela.mensagens.enviar && tela.mensagens.motivo"
      :texto="`${t('operadoraCobranca.mensagens')}: ${tela.mensagens.motivo}`"
      variante="info"
      data-testid="inadimplencia-mensagens"
    />
    <ErroOperadora v-if="q.isError.value" :erro="q.error.value" />
    <table v-else-if="q.data.value?.itens.length" class="tabela" data-testid="tabela-inadimplencia">
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraCobranca.colunas.contrato') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.pagador') }}</th>
          <th scope="col">{{ t('operadoraCobranca.inadimplencia.vencidas') }}</th>
          <th scope="col">{{ t('operadoraCobranca.inadimplencia.atrasoAtual') }}</th>
          <th scope="col">{{ t('operadoraCobranca.inadimplencia.acumulado') }}</th>
          <th scope="col">{{ t('operadoraCobranca.inadimplencia.mensalidades') }}</th>
          <th scope="col">{{ t('operadoraCobranca.inadimplencia.situacao') }}</th>
          <th scope="col">{{ t('operadoraCobranca.inadimplencia.prazo') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="i in q.data.value.itens"
          :key="i.contrato"
          :data-testid="`inadimplente-${i.contratoNumero}`"
          :data-situacao="i.situacao"
        >
          <th scope="row">{{ i.contratoNumero }}</th>
          <td>
            {{ i.pagadorNome }}<br /><span class="secundario">{{ i.pagadorDocumento }}</span>
          </td>
          <td>
            {{ i.vencidas }} · {{ brl(i.valorVencido) }}<br /><span class="secundario">{{
              dataBr(i.vencimentoMaisAntigo)
            }}</span>
          </td>
          <td>{{ t('operadoraCobranca.dias', { n: i.diasAtrasoAtual }) }}</td>
          <td>{{ i.diasAcumulados12m }}</td>
          <td>{{ i.mensalidadesEmAtraso12m }}</td>
          <td>
            {{ t(`operadoraCobranca.inadimplencia.situacoes.${i.situacao}`) }}
            <span v-if="i.notificadoEm" class="secundario"><br />{{ dataBr(i.notificadoEm) }}</span>
          </td>
          <td>{{ prazo(i) }}</td>
          <td>
            <SanteBotao
              v-if="tela.acoes.gerar && !i.notificadoEm"
              :rotulo="t('operadoraCobranca.inadimplencia.notificar')"
              variante="texto"
              :data-testid="`notificar-${i.contratoNumero}`"
              @acionar="notificando = i"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="q.data.value">{{ t('operadoraCobranca.nenhum') }}</p>
    <div class="acoes">
      <SanteBotao
        v-if="pagina.length"
        :rotulo="t('operadoraCobranca.paginas.primeira')"
        variante="texto"
        @acionar="pagina = []"
      />
      <SanteBotao
        v-if="q.data.value?.proxima"
        :rotulo="t('operadoraCobranca.paginas.proxima')"
        variante="texto"
        @acionar="pagina = [...pagina, q.data.value!.proxima!]"
      />
    </div>
    <p class="secundario">{{ t('operadoraCobranca.inadimplencia.rescisao') }}</p>
    <form v-if="notificando" class="campos" data-testid="form-notificacao" @submit.prevent="notificar">
      <SanteData v-model="em" :rotulo="t('operadoraCobranca.inadimplencia.em')" editavel />
      <SanteSelecao
        v-model="meio"
        :rotulo="t('operadoraCobranca.inadimplencia.meio')"
        :opcoes="opcoesMeio"
        data-testid="notificacao-meio"
      />
      <SanteCampoTexto
        v-model="referencia"
        :rotulo="t('operadoraCobranca.inadimplencia.referencia')"
        :max-bytes="60"
        obrigatorio
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.acoes.gravar')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="notificacao-gravar"
        />
        <SanteBotao
          :rotulo="t('operadoraCobranca.acoes.voltar')"
          variante="texto"
          @acionar="notificando = null"
        />
      </div>
    </form>
    <p v-if="mensagem" role="status" data-testid="mensagem-inadimplencia">{{ mensagem }}</p>
    <ErroOperadora v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
