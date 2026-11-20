<script setup lang="ts">
// Reajuste anual dos contratos (M56, etapa 3, F2): a lista dos reajustes (vigentes e cancelados, com as vidas e o ofício
// da ANS) e o registro do reajuste do contrato na competência do aniversário (no individual ou familiar, com o teto e
// o ofício da ANS; no coletivo pequeno, o aviso do agrupamento). O cancelamento só antes da mensalidade cobrada.
import type { ReajusteLido, TelaCobranca } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { cancelarReajuste, lerReajustes, reajustarContrato } from '../../api-cobranca.js';
import ErroOperadora from '../f1/ErroOperadora.vue';
import { competenciaBr, numeroDe } from './comum.js';
import SeletorContrato from './SeletorContrato.vue';

const props = defineProps<{ tela: TelaCobranca; operadora: number }>();
const { t } = useI18n();
const pagina = ref<number[]>([]);
const apos = computed(() => pagina.value.at(-1) ?? null);
const q = useQuery({
  queryKey: computed(() => ['operadora', 'reajustes', props.operadora, apos.value]),
  queryFn: () => lerReajustes(props.operadora, apos.value),
});
const contrato = ref<number | null>(null);
const competencia = ref('');
const percentual = ref('');
const tetoAns = ref('');
const oficioAns = ref('');
const motivo = ref('');
const cancelarMotivo = ref('');
const cancelando = ref<ReajusteLido | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function registrar(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await reajustarContrato({
      contrato: contrato.value,
      competencia: competencia.value.trim(),
      percentual: numeroDe(percentual.value),
      tetoAns: numeroDe(tetoAns.value),
      oficioAns: oficioAns.value || null,
      motivo: motivo.value,
    });
    mensagem.value = [r.mensagem, ...r.avisos].join(' ');
    await q.refetch();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

async function cancelar(): Promise<void> {
  const r0 = cancelando.value;
  if (!r0) return;
  ocupado.value = true;
  erro.value = null;
  try {
    mensagem.value = (await cancelarReajuste(r0.id, cancelarMotivo.value)).mensagem;
    cancelando.value = null;
    cancelarMotivo.value = '';
    await q.refetch();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-reajustes-titulo" data-testid="operadora-reajustes">
    <h2 id="ope-reajustes-titulo">{{ t('operadoraCobranca.reajustes.titulo') }}</h2>
    <p>{{ t('operadoraCobranca.reajustes.texto') }}</p>
    <template v-if="tela.acoes.gerar">
      <SeletorContrato
        v-model="contrato"
        :operadora="operadora"
        :rotulo="t('operadoraCobranca.reajustes.contrato')"
        testid="reajuste-contrato"
      />
      <form class="campos" data-testid="form-reajuste" @submit.prevent="registrar">
        <SanteCampoTexto
          v-model="competencia"
          :rotulo="t('operadoraCobranca.reajustes.competencia')"
          :max-bytes="7"
          obrigatorio
        />
        <SanteCampoTexto
          v-model="percentual"
          :rotulo="t('operadoraCobranca.reajustes.percentual')"
          :max-bytes="10"
          obrigatorio
        />
        <SanteCampoTexto
          v-model="tetoAns"
          :rotulo="t('operadoraCobranca.reajustes.tetoAns')"
          :max-bytes="10"
        />
        <SanteCampoTexto
          v-model="oficioAns"
          :rotulo="t('operadoraCobranca.reajustes.oficioAns')"
          :max-bytes="40"
        />
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('operadoraCobranca.reajustes.motivo')"
          :max-bytes="200"
          obrigatorio
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('operadoraCobranca.reajustes.registrar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="reajuste-gravar"
          />
        </div>
      </form>
    </template>
    <p v-if="mensagem" role="status" data-testid="mensagem-reajuste">{{ mensagem }}</p>
    <ErroOperadora v-if="erro" :erro="erro" />
    <ErroOperadora v-if="q.isError.value" :erro="q.error.value" />
    <table v-else-if="q.data.value?.itens.length" class="tabela" data-testid="tabela-reajustes">
      <caption>
        {{
          t('operadoraCobranca.reajustes.lista')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraCobranca.colunas.contrato') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.competencia') }}</th>
          <th scope="col">{{ t('operadoraCobranca.reajustes.percentual') }}</th>
          <th scope="col">{{ t('operadoraCobranca.reajustes.tetoAns') }}</th>
          <th scope="col">{{ t('operadoraCobranca.reajustes.vidas') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.situacao') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in q.data.value.itens"
          :key="r.id"
          :data-testid="`reajuste-${r.contratoNumero}-${r.competencia}`"
        >
          <th scope="row">{{ r.contratoNumero }}</th>
          <td>{{ competenciaBr(r.competencia) }}</td>
          <td>{{ String(r.percentual).replace('.', ',') }}%</td>
          <td>
            {{ r.tetoAns !== null ? `${String(r.tetoAns).replace('.', ',')}% (${r.oficioAns ?? ''})` : '—' }}
          </td>
          <td>{{ r.vidas }}</td>
          <td>{{ t(`operadoraCobranca.reajustes.situacoes.${r.situacao}`) }}</td>
          <td>
            <SanteBotao
              v-if="tela.acoes.gerar && r.situacao === 'vigente'"
              :rotulo="t('operadoraCobranca.reajustes.cancelar')"
              variante="texto"
              @acionar="cancelando = r"
            />
          </td>
        </tr>
      </tbody>
    </table>
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
    <form v-if="cancelando" class="campos" data-testid="form-cancelar-reajuste" @submit.prevent>
      <SanteCampoTexto
        v-model="cancelarMotivo"
        :rotulo="t('operadoraCobranca.motivo')"
        :max-bytes="200"
        obrigatorio
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.reajustes.cancelar')"
          variante="destrutivo"
          :confirmacao="t('operadoraCobranca.reajustes.confirmarCancelar')"
          :desabilitado="ocupado"
          data-testid="reajuste-cancelar"
          @acionar="cancelar"
        />
        <SanteBotao
          :rotulo="t('operadoraCobranca.acoes.voltar')"
          variante="texto"
          @acionar="cancelando = null"
        />
      </div>
    </form>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
