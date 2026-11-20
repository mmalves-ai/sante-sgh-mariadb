<script setup lang="ts">
// Aba Conciliação (M54.2; `contabil.conciliacao.registrar` para gravar): as partidas pendentes de uma conta analítica
// (até uma data, opcional), marcadas pela pessoa, com a soma dos débitos e créditos marcados à vista; concilia só
// quando fecham. O histórico das conciliações da conta, com o desfazer (justificativa; as partidas voltam a ficar
// pendentes e a desfeita fica registrada com quem e quando).
import type { ApoioLancamentos, ConciliacaoListada } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import ErroContabil from './ErroContabil.vue';
import {
  conciliarPartidas,
  desfazerConciliacao,
  lerConciliacoes,
  lerPendentesConciliacao,
} from './api-lancamentos.js';
import { dataBr, instante, reais } from './comum-contabil.js';
import { somaDaSelecao } from './comum-lancamentos.js';

const props = defineProps<{ apoio: ApoioLancamentos; empresa: number }>();
const { t } = useI18n();
const cliente = useQueryClient();

const conta = ref<string | null>(null);
const ate = ref<string | null>(null);
const opcoesConta = computed(() =>
  props.apoio.contas.map((c) => ({ valor: c.codigo as string | null, rotulo: `${c.codigo} ${c.nome}` })),
);
const marcadas = ref<Set<number>>(new Set());
watch([conta, ate, () => props.empresa], () => {
  marcadas.value = new Set();
});
const pendentes = useQuery({
  queryKey: computed(() => ['contabil', 'conciliacao', 'pendentes', props.empresa, conta.value, ate.value]),
  queryFn: () => lerPendentesConciliacao({ empresa: props.empresa, conta: conta.value!, ate: ate.value }),
  enabled: computed(() => conta.value !== null),
});
const p = computed(() => (conta.value ? (pendentes.data.value ?? null) : null));
const historico = useQuery({
  queryKey: computed(() => ['contabil', 'conciliacao', 'historico', props.empresa, conta.value]),
  queryFn: () => lerConciliacoes(props.empresa, conta.value!),
  enabled: computed(() => conta.value !== null),
});
const h = computed(() => (conta.value ? (historico.data.value ?? null) : null));
const soma = computed(() => somaDaSelecao(p.value?.itens ?? [], marcadas.value));

function alternar(id: number, marcada: boolean) {
  const s = new Set(marcadas.value);
  if (marcada) s.add(id);
  else s.delete(id);
  marcadas.value = s;
}

const observacao = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const mensagem = ref<string | null>(null);
async function conciliar() {
  if (!soma.value.fecha || !conta.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await conciliarPartidas({
      empresa: props.empresa,
      conta: conta.value,
      partidas: [...marcadas.value].sort((a, b) => a - b),
      observacao: observacao.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    marcadas.value = new Set();
    observacao.value = '';
    await cliente.invalidateQueries({ queryKey: ['contabil'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const desfazendo = ref<ConciliacaoListada | null>(null);
const justificativa = ref('');
async function desfazer() {
  if (!desfazendo.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await desfazerConciliacao({
      empresa: props.empresa,
      id: desfazendo.value.id,
      justificativa: justificativa.value.trim(),
    });
    mensagem.value = r.mensagem;
    desfazendo.value = null;
    justificativa.value = '';
    await cliente.invalidateQueries({ queryKey: ['contabil'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="conciliacao-titulo" data-testid="aba-conciliacao">
    <h2 id="conciliacao-titulo">{{ t('contabil.conciliacao.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.conciliacao.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="conta"
        :rotulo="t('contabil.lancamentos.conta')"
        :opcoes="opcoesConta"
        busca
        data-testid="conciliacao-conta"
      />
      <SanteData v-model="ate" :rotulo="t('contabil.razao.ate')" editavel data-testid="conciliacao-ate" />
    </div>
    <p v-if="mensagem" role="status" data-testid="conciliacao-mensagem">{{ mensagem }}</p>
    <p v-if="!conta" data-testid="conciliacao-escolha">{{ t('contabil.razao.escolhaConta') }}</p>
    <template v-else>
      <h3>{{ t('contabil.conciliacao.pendentes') }}</h3>
      <MensagemErro v-if="pendentes.isError.value" :erro="pendentes.error.value" />
      <p v-else-if="!p" role="status">{{ t('contabil.carregando') }}</p>
      <p v-else-if="p.itens.length === 0" data-testid="conciliacao-vazio">
        {{ t('contabil.conciliacao.semPendentes') }}
      </p>
      <template v-else>
        <p v-if="p.parcial" class="secundario" data-testid="conciliacao-parcial">
          {{ t('contabil.conciliacao.parcial') }}
        </p>
        <div class="rolagem">
          <table class="tabela" data-testid="tabela-pendentes">
            <thead>
              <tr>
                <th scope="col">
                  <span class="sgh-visualmente-oculto">{{ t('contabil.acoes') }}</span>
                </th>
                <th scope="col">{{ t('contabil.data') }}</th>
                <th scope="col">{{ t('contabil.lancamentos.numero') }}</th>
                <th scope="col">{{ t('contabil.lancamentos.historico') }}</th>
                <th scope="col">{{ t('contabil.lancamentos.debito') }}</th>
                <th scope="col">{{ t('contabil.lancamentos.credito') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in p.itens" :key="x.id" :data-testid="`pendente-${x.id}`">
                <td>
                  <input
                    type="checkbox"
                    class="marcador"
                    :checked="marcadas.has(x.id)"
                    :disabled="!apoio.podeConciliar"
                    :aria-label="t('contabil.conciliacao.marcar', { id: x.id })"
                    :data-testid="`marcar-${x.id}`"
                    @change="alternar(x.id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>{{ dataBr(x.data) }}</td>
                <td>{{ x.lancamento }}</td>
                <td>{{ x.historico }}</td>
                <td>{{ x.lado === 'D' ? reais(x.valorCentavos) : '' }}</td>
                <td>{{ x.lado === 'C' ? reais(x.valorCentavos) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p role="status" data-testid="conciliacao-soma">
          {{
            t('contabil.conciliacao.selecao', {
              partidas: soma.partidas,
              debitos: reais(soma.debitos),
              creditos: reais(soma.creditos),
            })
          }}
          {{ soma.fecha ? t('contabil.conciliacao.fecha') : t('contabil.conciliacao.naoFecha') }}
        </p>
        <template v-if="apoio.podeConciliar">
          <SanteCampoTexto
            v-model="observacao"
            :rotulo="t('contabil.conciliacao.observacao')"
            :max-bytes="300"
            data-testid="conciliacao-observacao"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('contabil.conciliacao.conciliar')"
              :desabilitado="ocupado || !soma.fecha"
              data-testid="conciliacao-conciliar"
              @acionar="conciliar"
            />
          </div>
        </template>
        <p v-else class="secundario" data-testid="conciliacao-sem-permissao">
          {{ t('contabil.conciliacao.semPermissao') }}
        </p>
      </template>

      <h3>{{ t('contabil.conciliacao.historico') }}</h3>
      <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
      <p v-else-if="!h" role="status">{{ t('contabil.carregando') }}</p>
      <p v-else-if="h.length === 0" data-testid="conciliacoes-vazio">{{ t('contabil.nenhum') }}</p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="tabela-conciliacoes">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.lancamentos.numero') }}</th>
              <th scope="col">{{ t('contabil.conciliacao.situacao') }}</th>
              <th scope="col">{{ t('contabil.conciliacao.partidas') }}</th>
              <th scope="col">{{ t('contabil.valor') }}</th>
              <th scope="col">{{ t('contabil.conciliacao.criadaPor') }}</th>
              <th scope="col">{{ t('contabil.conciliacao.desfeitaPor') }}</th>
              <th scope="col">{{ t('contabil.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in h" :key="x.id" :data-testid="`conciliacao-${x.id}`">
              <td>{{ x.id }}</td>
              <td>{{ t(`contabil.conciliacao.situacoes.${x.situacao}`) }}</td>
              <td>{{ x.partidas }}</td>
              <td>{{ reais(x.valorCentavos) }}</td>
              <td>{{ x.criadaPor }} ({{ instante(x.criadaEm) }})</td>
              <td>{{ x.desfeitaPor ? `${x.desfeitaPor} (${instante(x.desfeitaEm)})` : '—' }}</td>
              <td>
                <SanteBotao
                  v-if="apoio.podeConciliar && x.situacao === 'ativa'"
                  variante="secundario"
                  :rotulo="t('contabil.conciliacao.desfazer')"
                  :data-testid="`conciliacao-desfazer-${x.id}`"
                  @acionar="desfazendo = x"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section
        v-if="desfazendo"
        class="bloco"
        aria-labelledby="desfazer-titulo"
        data-testid="conciliacao-desfazer"
      >
        <h4 id="desfazer-titulo">{{ t('contabil.conciliacao.desfazerTitulo', { id: desfazendo.id }) }}</h4>
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t('contabil.justificativa')"
          :max-bytes="300"
          multilinha
          obrigatorio
          data-testid="desfazer-justificativa"
        />
        <p class="secundario">{{ t('contabil.justificativaAjuda') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.conciliacao.confirmarDesfazer')"
            :desabilitado="ocupado || justificativa.trim().length < 10"
            data-testid="desfazer-confirmar"
            @acionar="desfazer"
          />
          <SanteBotao variante="secundario" :rotulo="t('contabil.cancelar')" @acionar="desfazendo = null" />
        </div>
      </section>
      <ErroContabil v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
<style scoped>
.marcador {
  width: 24px;
  height: 24px;
}
</style>
