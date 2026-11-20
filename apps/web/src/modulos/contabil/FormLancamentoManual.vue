<script setup lang="ts">
// Lançamento manual (M54.2; `contabil.lancamento.criar`): data num período aberto (regra 3), histórico e as partidas
// (lado, conta analítica com busca, valor em reais, centro de custo quando a conta exige), com os totais e a diferença
// à vista e a conferência antes de enviar (débitos = créditos, regra 5). A chave da intenção vai no corpo: o envio
// repetido não duplica.
import { type ApoioLancamentos, MAX_PARTIDAS_MANUAL, type ResultadoLancamento } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroContabil from './ErroContabil.vue';
import { incluirLancamentoManual } from './api-lancamentos.js';
import { reais } from './comum-contabil.js';
import {
  novaIdempotencia,
  type PartidaRascunhoManual,
  partidasDoCorpo,
  partidaVaziaManual,
  problemasDoManual,
  totaisDoManual,
} from './comum-lancamentos.js';

const props = defineProps<{ apoio: ApoioLancamentos; empresa: number; hoje: string }>();
const emit = defineEmits<{ gravado: [r: ResultadoLancamento]; cancelar: [] }>();
const { t } = useI18n();

const data = ref<string | null>(props.hoje);
const historico = ref('');
const partidas = ref<PartidaRascunhoManual[]>([partidaVaziaManual('D'), partidaVaziaManual('C')]);
/** A mesma intenção até gravar: repetir o envio (rede caiu) não duplica. */
let idempotencia = novaIdempotencia();

const opcoesLado = computed(() => [
  { valor: 'D' as const, rotulo: t('contabil.lancamentos.lados.D') },
  { valor: 'C' as const, rotulo: t('contabil.lancamentos.lados.C') },
]);
const opcoesConta = computed(() =>
  props.apoio.contas.map((c) => ({ valor: c.codigo as string | null, rotulo: `${c.codigo} ${c.nome}` })),
);
const totais = computed(() => totaisDoManual(partidas.value));
const problemas = computed(() =>
  problemasDoManual(
    { data: data.value ?? '', historico: historico.value, partidas: partidas.value },
    props.apoio.contas,
  ),
);
const tentou = ref(false);
const erro = ref<unknown>(null);
const ocupado = ref(false);

function incluir() {
  const ultimo = partidas.value.at(-1)?.lado ?? 'C';
  partidas.value.push(partidaVaziaManual(ultimo === 'D' ? 'C' : 'D'));
}
function remover(i: number) {
  partidas.value.splice(i, 1);
}
async function gravar() {
  tentou.value = true;
  if (problemas.value.length > 0) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await incluirLancamentoManual({
      empresa: props.empresa,
      data: data.value!,
      historico: historico.value.trim(),
      partidas: partidasDoCorpo(partidas.value),
      idempotencia,
    });
    idempotencia = novaIdempotencia();
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="manual-titulo" data-testid="lancamento-manual">
    <h3 id="manual-titulo">{{ t('contabil.lancamentos.manualTitulo') }}</h3>
    <p class="secundario">{{ t('contabil.lancamentos.manualAjuda') }}</p>
    <div class="campos">
      <SanteData
        v-model="data"
        :rotulo="t('contabil.data')"
        editavel
        :maximo="hoje"
        data-testid="manual-data"
      />
      <SanteCampoTexto
        v-model="historico"
        :rotulo="t('contabil.lancamentos.historico')"
        :max-bytes="200"
        obrigatorio
        data-testid="manual-historico"
      />
    </div>
    <fieldset v-for="(p, i) in partidas" :key="i" class="bloco" :data-testid="`manual-partida-${i}`">
      <legend>{{ t('contabil.lancamentos.partidaN', { n: i + 1 }) }}</legend>
      <div class="campos">
        <SanteSelecao
          v-model="p.lado"
          :rotulo="t('contabil.lancamentos.lado')"
          :opcoes="opcoesLado"
          :data-testid="`manual-lado-${i}`"
        />
        <SanteSelecao
          v-model="p.conta"
          :rotulo="t('contabil.lancamentos.conta')"
          :opcoes="opcoesConta"
          busca
          :data-testid="`manual-conta-${i}`"
        />
        <SanteCampoTexto
          v-model="p.valor"
          :rotulo="t('contabil.lancamentos.valorReais')"
          :max-bytes="20"
          :data-testid="`manual-valor-${i}`"
        />
        <SanteCampoTexto
          v-model="p.centroCusto"
          :rotulo="t('contabil.lancamentos.centroCusto')"
          :max-bytes="9"
          :data-testid="`manual-centro-${i}`"
        />
        <SanteCampoTexto
          v-model="p.historico"
          :rotulo="t('contabil.lancamentos.historicoPartida')"
          :max-bytes="120"
          :data-testid="`manual-historico-${i}`"
        />
      </div>
      <div v-if="partidas.length > 2" class="acoes">
        <SanteBotao
          variante="texto"
          :rotulo="t('contabil.lancamentos.removerPartida', { n: i + 1 })"
          :data-testid="`manual-remover-${i}`"
          @acionar="remover(i)"
        />
      </div>
    </fieldset>
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('contabil.lancamentos.incluirPartida')"
        :desabilitado="partidas.length >= MAX_PARTIDAS_MANUAL"
        data-testid="manual-incluir-partida"
        @acionar="incluir"
      />
    </div>
    <p role="status" data-testid="manual-totais">
      {{
        t('contabil.lancamentos.totaisManual', {
          debitos: reais(totais.debitos),
          creditos: reais(totais.creditos),
          diferenca: reais(Math.abs(totais.diferenca)),
        })
      }}
    </p>
    <ul v-if="tentou && problemas.length > 0" class="erro" data-testid="manual-problemas">
      <li v-for="x in problemas" :key="x">{{ x }}</li>
    </ul>
    <div class="acoes">
      <SanteBotao
        :rotulo="t('contabil.lancamentos.gravarManual')"
        :desabilitado="ocupado"
        data-testid="manual-gravar"
        @acionar="gravar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('contabil.cancelar')"
        data-testid="manual-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
    <ErroContabil v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
