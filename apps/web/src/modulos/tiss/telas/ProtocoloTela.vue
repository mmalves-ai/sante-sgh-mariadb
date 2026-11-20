<script setup lang="ts">
// O protocolo do lote (ficha do M31, seção 7, diálogo): `/faturamento/lotes/:id/protocolo`, só do supervisor. O número
// do comprovante (normalizado no servidor: sem quebra de linha nem tabulação, até 12 caracteres), a data, o recibo e a
// situação TISS. Registrar CONGELA o lote (nem o lote nem as contas saem dele); limpar só desfaz o protocolo informado.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { lerLote, novaChave, registrarProtocolo } from '../api-tiss.js';
import { usarTiss } from '../usar-tiss.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const rota = useRoute();
const qc = useQueryClient();
const { apoio, pode, motivoFuncionalidade } = usarTiss('lote');
const id = computed(() => Number(props.id));
const l = useQuery({
  queryKey: computed(() => ['tiss', 'lote', id.value]),
  queryFn: () => lerLote(id.value),
});
const protocolo = ref(String(rota.query['protocolo'] ?? ''));
const dataProtocolo = ref('');
const recibo = ref(String(rota.query['recibo'] ?? ''));
const situacao = ref(String(rota.query['situacao'] ?? ''));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);
const situacoes = computed(() => [
  { valor: '', rotulo: t('tiss.nenhuma') },
  ...(apoio.data.value?.situacoesProtocolo ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);

async function gravar(acao: 'registrar' | 'limpar') {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await registrarProtocolo(
      id.value,
      {
        acao,
        protocolo: acao === 'limpar' ? (l.data.value?.protocolo ?? '') : protocolo.value,
        data: dataProtocolo.value || null,
        recibo: recibo.value,
        situacao: situacao.value ? Number(situacao.value) : null,
      },
      novaChave('protocolo'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" role="dialog" aria-labelledby="pr-titulo" data-testid="tela-tiss-protocolo">
    <h1 id="pr-titulo">{{ t('tiss.protocoloTela.titulo', { lote: id }) }}</h1>
    <p>
      <RouterLink :to="`/faturamento/lotes/${id}`">{{ t('tiss.voltarLote') }}</RouterLink>
    </p>
    <p>{{ t('tiss.protocoloTela.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('protocoloRecurso')" />
    <ErroFaturamento v-if="l.error.value" :erro="l.error.value" />
    <template v-else-if="l.data.value">
      <form v-if="!l.data.value.congelado" class="formulario" @submit.prevent="gravar('registrar')">
        <span class="campo">
          <label for="pr-numero">{{ t('tiss.protocoloTela.numero') }}</label>
          <input id="pr-numero" v-model="protocolo" maxlength="64" required data-testid="pr-numero" />
        </span>
        <span class="campo">
          <label for="pr-data">{{ t('tiss.protocoloTela.data') }}</label>
          <input id="pr-data" v-model="dataProtocolo" type="date" data-testid="pr-data" />
        </span>
        <span class="campo">
          <label for="pr-recibo">{{ t('tiss.recibo') }}</label>
          <input id="pr-recibo" v-model="recibo" maxlength="60" data-testid="pr-recibo" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('tiss.protocoloTela.situacao')"
            :opcoes="situacoes"
            data-testid="pr-situacao"
          />
        </span>
        <p class="secundario">{{ t('tiss.protocoloTela.congela') }}</p>
        <button
          type="submit"
          :disabled="gravando || !pode('faturamento.registrarProtocolo')"
          data-testid="pr-registrar"
        >
          {{ t('tiss.loteTela.registrarProtocolo') }}
        </button>
      </form>
      <div v-else>
        <p data-testid="pr-atual">
          {{ t('tiss.protocoloTela.atual', { protocolo: l.data.value.protocolo }) }}
        </p>
        <button
          type="button"
          :disabled="gravando || !pode('faturamento.registrarProtocolo')"
          data-testid="pr-limpar"
          @click="gravar('limpar')"
        >
          {{ t('tiss.loteTela.limparProtocolo') }}
        </button>
      </div>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="pr-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
