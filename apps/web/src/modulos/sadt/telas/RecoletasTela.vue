<script setup lang="ts">
// Recoleta e alíquotas (F3.5, 05-SADT linha 7): pela etiqueta, o laboratório pede a recoleta com o motivo (a amostra
// original fica rejeitada e ligada à nova) ou gera as alíquotas pelas regras do exame. A lista mostra as recoletas em
// aberto: coletar pede a identificação positiva do paciente (identificadores, pulseira no internado, estação), como a
// coleta comum; cancelar pede o motivo e o destino dos exames que esperavam a recoleta.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  cancelarRecoleta,
  coletarRecoleta,
  gerarAliquotas,
  lerMotivosPedido,
  listarRecoletas,
  pedirRecoleta,
} from '../api-pedido.js';
import { listarPostos, reimprimirEtiqueta } from '../api-posto-coleta.js';
import { lerAmostraPorCodigo, novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { quando } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['sadt', 'recoletas'], queryFn: listarRecoletas });
const motivos = useQuery({ queryKey: ['sadt', 'pedido', 'motivos'], queryFn: lerMotivosPedido });
const opcoes = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(motivos.data.value?.recoleta ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
// Os postos ativos do cadastro: a coleta da recoleta diz onde a amostra foi colhida (à beira do leito, sem posto).
const postos = useQuery({ queryKey: ['sadt', 'postos-coleta', 'ativos'], queryFn: () => listarPostos() });
const opcoesPosto = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.postos.semPosto') },
  ...(postos.data.value?.itens ?? []).map((p) => ({ valor: String(p.id), rotulo: p.descricao })),
]);
const posto = ref<Record<number, string>>({});
const codigo = ref('');
const motivo = ref('');
const motivoCancelar = ref<Record<number, string>>({});
const destino = ref<Record<number, '' | 'cancelar' | 'manter'>>({});
const motivoExames = ref<Record<number, string>>({});
const identificadores = ref<Record<number, boolean>>({});
const pulseira = ref<Record<number, string>>({});
const estacao = ref<Record<number, string>>({});
const opcoesDestino = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  { valor: 'manter', rotulo: t('sadt.pedido.destinos.manter') },
  { valor: 'cancelar', rotulo: t('sadt.pedido.destinos.cancelar') },
]);
const opcoesMotivoExames = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(motivos.data.value?.cancelamento ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const podeCancelar = (id: number) =>
  (motivoCancelar.value[id] ?? '').trim().length >= 5 &&
  !!destino.value[id] &&
  (destino.value[id] !== 'cancelar' || !!motivoExames.value[id]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const atualizar = () => cliente.invalidateQueries({ queryKey: ['sadt', 'recoletas'] });

async function executar(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await fn();
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const amostraDoCodigo = async () => (await lerAmostraPorCodigo(codigo.value.trim())).id;
const pedir = () =>
  executar(async () => {
    const r = await pedirRecoleta(await amostraDoCodigo(), Number(motivo.value), novaChave('recoleta.pedir'));
    return t('sadt.pedido.pedida', { numero: r.numero });
  });
const aliquotar = () =>
  executar(async () => {
    const r = await gerarAliquotas(await amostraDoCodigo(), novaChave('amostra.aliquotar'));
    const texto = t('sadt.pedido.aliquotas', {
      n: r.subamostras.length,
      codigos: r.subamostras.map((s) => s.codigo).join(', '),
    });
    const naFila = r.etiquetasNaFila ?? 0;
    return `${texto} ${
      naFila === r.subamostras.length
        ? t('sadt.pedido.postos.etiquetasNaFila', { n: naFila })
        : t('sadt.pedido.postos.etiquetaPendente')
    }`;
  });
const reimprimir = () =>
  executar(async () => {
    const r = await reimprimirEtiqueta(await amostraDoCodigo(), novaChave('amostra.etiqueta'));
    return r.naFila > 0
      ? t('sadt.pedido.postos.reimpressa', { via: r.via ?? 2 })
      : t('sadt.pedido.postos.naoReimpressa');
  });
const coletar = (id: number) =>
  executar(async () => {
    const r = await coletarRecoleta(
      id,
      {
        identificadoresConferidos: identificadores.value[id] ?? false,
        pulseira: pulseira.value[id]?.trim() || null,
        estacao: estacao.value[id]?.trim() || null,
        posto: posto.value[id] ? Number(posto.value[id]) : null,
      },
      novaChave('recoleta.coletar'),
    );
    return `${t('sadt.pedido.coletada', { codigo: r.codigo })} ${t(
      r.etiquetaNaFila ? 'sadt.pedido.postos.etiquetaNaFila' : 'sadt.pedido.postos.etiquetaPendente',
    )}`;
  });
const cancelar = (id: number) =>
  executar(async () => {
    const d = destino.value[id] as 'cancelar' | 'manter';
    const r = await cancelarRecoleta(
      id,
      motivoCancelar.value[id] ?? '',
      d,
      d === 'cancelar' ? Number(motivoExames.value[id]) : null,
      novaChave('recoleta.cancelar'),
    );
    return t('sadt.pedido.canceladaComExames', { n: r.exames });
  });
</script>

<template>
  <section class="recoletas" data-testid="recoletas">
    <h1>{{ t('sadt.pedido.recoletas') }}</h1>
    <div class="linha">
      <label for="recoleta-codigo">{{ t('sadt.pedido.codigoAmostra') }}</label>
      <input id="recoleta-codigo" v-model="codigo" data-testid="recoleta-codigo" />
      <SanteSelecao
        v-model="motivo"
        :rotulo="t('sadt.pedido.motivo')"
        :opcoes="opcoes"
        data-testid="recoleta-motivo"
      />
      <SanteBotao
        :rotulo="t('sadt.pedido.pedirRecoleta')"
        :desabilitado="!codigo || !motivo"
        data-testid="recoleta-pedir"
        @acionar="pedir"
      />
      <SanteBotao
        :rotulo="t('sadt.pedido.gerarAliquotas')"
        :desabilitado="!codigo"
        data-testid="recoleta-aliquotar"
        @acionar="aliquotar"
      />
      <SanteBotao
        :rotulo="t('sadt.pedido.postos.reimprimir')"
        :desabilitado="!codigo"
        data-testid="recoleta-reimprimir"
        @acionar="reimprimir"
      />
      <RouterLink to="/sadt/postos-coleta" data-testid="recoleta-postos">{{
        t('sadt.pedido.postos.abrir')
      }}</RouterLink>
    </div>
    <p v-if="mensagem" role="status" data-testid="recoleta-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <h2>{{ t('sadt.pedido.abertas') }}</h2>
    <p v-if="(lista.data.value?.itens ?? []).length === 0">{{ t('sadt.pedido.nenhuma') }}</p>
    <article v-for="r in lista.data.value?.itens ?? []" :key="r.id" :data-testid="`recoleta-${r.id}`">
      <p>
        {{ r.numero }} · {{ t(`sadt.pedido.situacoes.${r.situacao}`) }} · {{ r.motivo }} ·
        {{ t('sadt.pedido.original') }} {{ r.codigoOriginal }} · {{ quando(r.solicitadaEm) }}
      </p>
      <div class="linha">
        <label>
          <input
            v-model="identificadores[r.id]"
            type="checkbox"
            :data-testid="`recoleta-identificadores-${r.id}`"
          />
          {{ t('sadt.pedido.identificadores') }}
        </label>
        <input
          v-model="pulseira[r.id]"
          :aria-label="t('sadt.pedido.pulseira')"
          :placeholder="t('sadt.pedido.pulseira')"
          maxlength="120"
        />
        <input
          v-model="estacao[r.id]"
          :aria-label="t('sadt.pedido.estacao')"
          :placeholder="t('sadt.pedido.estacao')"
          maxlength="64"
          :data-testid="`recoleta-estacao-${r.id}`"
        />
        <SanteSelecao
          v-if="(postos.data.value?.itens ?? []).length > 0"
          :model-value="posto[r.id] ?? ''"
          :rotulo="t('sadt.pedido.postos.naColeta')"
          :opcoes="opcoesPosto"
          :data-testid="`recoleta-posto-${r.id}`"
          @update:model-value="(v: string) => (posto = { ...posto, [r.id]: v })"
        />
        <SanteBotao
          :rotulo="t('sadt.pedido.coletar')"
          :desabilitado="!identificadores[r.id] || !(estacao[r.id] ?? '').trim()"
          :data-testid="`recoleta-coletar-${r.id}`"
          @acionar="coletar(r.id)"
        />
      </div>
      <div class="linha">
        <input v-model="motivoCancelar[r.id]" :aria-label="t('sadt.pedido.motivo')" maxlength="500" />
        <SanteSelecao
          :model-value="destino[r.id] ?? ''"
          :rotulo="t('sadt.pedido.destinoExames')"
          :opcoes="opcoesDestino"
          @update:model-value="
            (v: string) => (destino = { ...destino, [r.id]: v as '' | 'cancelar' | 'manter' })
          "
        />
        <SanteSelecao
          v-if="destino[r.id] === 'cancelar'"
          :model-value="motivoExames[r.id] ?? ''"
          :rotulo="t('sadt.pedido.motivoExames')"
          :opcoes="opcoesMotivoExames"
          @update:model-value="(v: string) => (motivoExames = { ...motivoExames, [r.id]: v })"
        />
        <SanteBotao
          :rotulo="t('sadt.pedido.cancelarRecoleta')"
          :desabilitado="!podeCancelar(r.id)"
          @acionar="cancelar(r.id)"
        />
      </div>
    </article>
  </section>
</template>

<style scoped>
.recoletas {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
</style>
