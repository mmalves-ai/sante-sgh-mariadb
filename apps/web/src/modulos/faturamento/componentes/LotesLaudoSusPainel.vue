<script setup lang="ts">
// Os lotes de laudos de internação SUS para o gestor (F7, 06-SUS linha 57): os laudos emitidos ainda sem lote, já
// marcados, viram um lote num clique; cada lote mostra só as ações que a situação permite (enviar, registrar o
// retorno, cancelar), com a mesma regra do domínio. A observação, opcional, acompanha a ação.
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { carimboBr } from '../../cadastro/formato.js';
import {
  acaoLoteLaudos,
  gerarLoteLaudos,
  lerLaudosSemLote,
  lerLotesLaudo,
  type LoteLaudoSus,
} from '../api-laudo-internacao-sus.js';

defineProps<{ podeRegistrar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const p = (k: string, a?: Record<string, unknown>) => t(`faturamentoSus.aih.lotesLaudo.${k}`, a ?? {});

const MAXIMO_POR_LOTE = 200;
type Acao = 'enviar' | 'retornar' | 'cancelar';
// A mesma tabela de acaoLotePermitida do domínio: o botão só aparece quando a ação vale.
const ACOES_POR_SITUACAO: Record<Acao, readonly string[]> = {
  enviar: ['fechado', 'exportado'],
  cancelar: ['aberto', 'fechado'],
  retornar: ['enviado'],
};
const ACOES: readonly Acao[] = ['enviar', 'retornar', 'cancelar'];
const acoesDo = (l: LoteLaudoSus) => ACOES.filter((a) => ACOES_POR_SITUACAO[a].includes(l.situacao));

const semLote = useQuery({ queryKey: ['sus', 'laudos-internacao', 'sem-lote'], queryFn: lerLaudosSemLote });
const lotes = useQuery({ queryKey: ['sus', 'laudos-internacao', 'lotes'], queryFn: lerLotesLaudo });

// Os laudos novos chegam marcados: o caso comum é mandar todos.
const marcados = ref<number[]>([]);
watch(
  () => semLote.data.value,
  (v) => {
    marcados.value = (v ?? []).slice(0, MAXIMO_POR_LOTE).map((l) => l.id);
  },
  { immediate: true },
);
const todosMarcados = computed(
  () => (semLote.data.value?.length ?? 0) > 0 && marcados.value.length === semLote.data.value?.length,
);
function marcarTodos(v: boolean): void {
  marcados.value = v ? (semLote.data.value ?? []).slice(0, MAXIMO_POR_LOTE).map((l) => l.id) : [];
}

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const observacao = ref('');
async function executar(fn: () => Promise<void>, feito: string): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = feito;
    observacao.value = '';
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const gerar = () => executar(() => gerarLoteLaudos([...marcados.value]), p('gerado'));
const agir = (l: LoteLaudoSus, a: Acao) =>
  executar(() => acaoLoteLaudos(l.id, a, l.versao, observacao.value.trim() || null), p(`feito.${a}`));
</script>

<template>
  <section aria-labelledby="lotes-laudo-titulo" data-testid="lotes-laudo-sus">
    <h2 id="lotes-laudo-titulo">{{ p('titulo') }}</h2>
    <p>{{ p('explicacao') }}</p>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="lotes-laudo-mensagem" />
    <MensagemErro v-if="erro" :erro="erro" />

    <h3>{{ p('semLote') }}</h3>
    <MensagemErro v-if="semLote.isError.value" :erro="semLote.error.value" />
    <p v-else-if="!semLote.data.value">{{ t('faturamentoSus.carregando') }}</p>
    <p v-else-if="semLote.data.value.length === 0" data-testid="lotes-laudo-sem-pendentes">
      {{ p('nenhumSemLote') }}
    </p>
    <template v-else>
      <table class="tabela" data-testid="lotes-laudo-sem-lote">
        <thead>
          <tr>
            <th scope="col">
              <label v-if="podeRegistrar">
                <input
                  type="checkbox"
                  :checked="todosMarcados"
                  data-testid="lotes-laudo-marcar-todos"
                  @change="marcarTodos(($event.target as HTMLInputElement).checked)"
                />
                {{ p('marcarTodos') }}
              </label>
            </th>
            <th scope="col">{{ t('faturamentoSus.aih.laudoSus.numero') }}</th>
            <th scope="col">{{ t('faturamentoSus.aih.laudoSus.tipo') }}</th>
            <th scope="col">{{ t('faturamentoSus.aih.numero') }}</th>
            <th scope="col">{{ t('faturamentoSus.aih.laudoSus.procedimento') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in semLote.data.value" :key="l.id" :data-testid="`lotes-laudo-livre-${l.id}`">
            <td>
              <input
                v-if="podeRegistrar"
                v-model="marcados"
                type="checkbox"
                :value="l.id"
                :aria-label="p('marcar', { numero: l.numero })"
                :data-testid="`lotes-laudo-marcar-${l.id}`"
              />
            </td>
            <td>{{ l.numero }}</td>
            <td>{{ t(`faturamentoSus.aih.laudoSus.tiposLaudo.${l.tipo}`) }}</td>
            <td>{{ l.numeroAih ?? '—' }}</td>
            <td>{{ l.procedimentoSolicitado }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeRegistrar"
        :rotulo="p('gerar', { n: marcados.length })"
        :desabilitado="ocupado || marcados.length === 0 || marcados.length > MAXIMO_POR_LOTE"
        data-testid="botao-gerar-lote-laudos"
        @acionar="gerar"
      />
    </template>

    <h3>{{ p('lotes') }}</h3>
    <MensagemErro v-if="lotes.isError.value" :erro="lotes.error.value" />
    <p v-else-if="!lotes.data.value">{{ t('faturamentoSus.carregando') }}</p>
    <p v-else-if="lotes.data.value.length === 0" data-testid="lotes-laudo-vazio">{{ p('nenhumLote') }}</p>
    <template v-else>
      <SanteCampoTexto
        v-if="podeRegistrar"
        v-model="observacao"
        :rotulo="p('observacao')"
        :max-bytes="500"
        data-testid="lotes-laudo-observacao"
      />
      <table class="tabela" data-testid="lotes-laudo-lista">
        <thead>
          <tr>
            <th scope="col">{{ p('numero') }}</th>
            <th scope="col">{{ p('situacao') }}</th>
            <th scope="col">{{ p('quantidade') }}</th>
            <th scope="col">{{ p('geradoEm') }}</th>
            <th scope="col">{{ p('enviadoEm') }}</th>
            <th scope="col">{{ p('retornadoEm') }}</th>
            <th scope="col">{{ p('acao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lotes.data.value" :key="l.id" :data-testid="`lote-laudo-${l.numero}`">
            <td>{{ l.numero }}</td>
            <td data-testid="lote-laudo-situacao">{{ p(`situacoes.${l.situacao}`) }}</td>
            <td>{{ l.quantidadeLaudos }}</td>
            <td>{{ carimboBr(l.geradoEm) }}</td>
            <td>{{ carimboBr(l.enviadoEm) }}</td>
            <td>{{ carimboBr(l.retornadoEm) }}</td>
            <td class="acoes">
              <template v-if="podeRegistrar">
                <SanteBotao
                  v-for="a in acoesDo(l)"
                  :key="a"
                  :rotulo="p(`acoes.${a}`)"
                  :variante="a === 'cancelar' ? 'secundario' : 'primario'"
                  :desabilitado="ocupado"
                  :data-testid="`botao-lote-laudo-${a}-${l.id}`"
                  @acionar="agir(l, a)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
