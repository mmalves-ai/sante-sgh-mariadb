<script setup lang="ts">
// Minhas aprovações (F8, 07-FIN linha 65): `/financeiro/aprovacoes`. A fila do aprovador do fluxo configurável, feita
// para o telefone: um cartão por pedido com o documento, o valor, a etapa (n de m) e quem pediu, e um botão por resposta
// padrão do fluxo (um toque decide). A justificativa é conferida enquanto se digita (obrigatória quando a resposta a
// exige ou quando não aprova). Em tela estreita o canal gravado é 'celular', e só o aprovador liberado para o celular
// naquela etapa vê os botões; no computador, o canal é 'web'. O histórico do pedido (cada decisão, com a etapa, a
// resposta, o canal e quando) abre no próprio cartão. Nada se apaga.
import { JUSTIFICATIVA_MINIMA_APROVACAO } from '@sgh/dominio-financeiro';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  type CanalDecisaoTela,
  decidirAprovacao,
  type HistoricoPedido,
  lerHistoricoPedido,
  lerPendenciasAprovacao,
  type PendenciaAprovacao,
} from '../api-fluxo-aprovacao.js';
import { novaChave } from '../api-financeiro.js';
import { data, reais } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const fila = useQuery({
  queryKey: ['financeiro', 'fluxo-aprovacao', 'pendencias'],
  queryFn: lerPendenciasAprovacao,
});

// Tela estreita: o canal é o celular (largura de telefone).
const estreita = ref(false);
let consulta: MediaQueryList | null = null;
const medir = () => (estreita.value = consulta?.matches ?? false);
onMounted(() => {
  consulta = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 600px)') : null;
  medir();
  consulta?.addEventListener('change', medir);
});
onBeforeUnmount(() => consulta?.removeEventListener('change', medir));
const canal = computed<CanalDecisaoTela>(() => (estreita.value ? 'celular' : 'web'));

const justificativas = reactive<Record<number, string>>({});
const historicos = reactive<Record<number, HistoricoPedido | null>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref<number | null>(null);
let chave = novaChave('fluxo-aprov');

const pedeJustificativa = (r: PendenciaAprovacao['respostas'][number]) =>
  r.exigeJustificativa || r.efeito !== 'aprova';
const justificativaOk = (p: number) =>
  (justificativas[p] ?? '').trim().length >= JUSTIFICATIVA_MINIMA_APROVACAO;
const bloqueadoNoCelular = (p: PendenciaAprovacao) => canal.value === 'celular' && !p.celular;
const podeResponder = (p: PendenciaAprovacao, r: PendenciaAprovacao['respostas'][number]) =>
  !bloqueadoNoCelular(p) && gravando.value === null && (!pedeJustificativa(r) || justificativaOk(p.pedido));
const precisaJustificativa = (p: PendenciaAprovacao) => p.respostas.some(pedeJustificativa);

async function decidir(p: PendenciaAprovacao, r: PendenciaAprovacao['respostas'][number]) {
  if (!podeResponder(p, r)) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = p.pedido;
  try {
    mensagem.value = (
      await decidirAprovacao(p.pedido, r.id, (justificativas[p.pedido] ?? '').trim(), canal.value, chave)
    ).mensagem;
    chave = novaChave('fluxo-aprov');
    delete justificativas[p.pedido];
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = null;
  }
}

async function alternarHistorico(pedido: number) {
  if (historicos[pedido]) {
    historicos[pedido] = null;
    return;
  }
  try {
    historicos[pedido] = await lerHistoricoPedido(pedido);
  } catch (e) {
    erro.value = e;
  }
}
const quando = (iso: string) => `${data(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
</script>

<template>
  <section class="tela-agenda fila-aprov" aria-labelledby="fap-titulo" data-testid="tela-fin-aprovacoes">
    <h1 id="fap-titulo">{{ t('financeiro.fluxoAprovacao.fila.titulo') }}</h1>
    <p>{{ t('financeiro.fluxoAprovacao.fila.texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="fila.error.value" :erro="fila.error.value" />
    <button type="button" class="secundario" data-testid="fap-atualizar" @click="fila.refetch()">
      {{ t('financeiro.fluxoAprovacao.fila.atualizar') }}
    </button>
    <p v-if="fila.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <p v-else-if="fila.data.value && !fila.data.value.length" data-testid="fap-vazia">
      {{ t('financeiro.fluxoAprovacao.fila.vazia') }}
    </p>
    <ul v-else class="cartoes" data-testid="fap-lista">
      <li
        v-for="p in fila.data.value ?? []"
        :key="p.pedido"
        class="cartao-aprov"
        :data-testid="`fap-pedido-${p.pedido}`"
      >
        <h2 :id="`fap-ped-${p.pedido}`">
          {{ t(`financeiro.fluxoAprovacao.tipos.${p.tipo}`) }} {{ p.numero || p.documento }}
        </h2>
        <p class="valor" data-testid="fap-valor">{{ reais(p.valor) }}</p>
        <p v-if="p.descricao">{{ p.descricao }}</p>
        <p data-testid="fap-etapa">
          {{
            t('financeiro.fluxoAprovacao.fila.etapa', {
              nivel: p.nivel,
              total: p.totalEtapas,
              etapa: p.etapa,
            })
          }}
        </p>
        <p class="secundario-texto">
          {{
            t('financeiro.fluxoAprovacao.fila.solicitante', {
              nome: p.solicitante || '—',
              quando: quando(p.solicitadoEm),
            })
          }}
        </p>
        <p v-if="bloqueadoNoCelular(p)" role="alert" data-testid="fap-celular-bloqueado">
          {{ t('financeiro.fluxoAprovacao.fila.celularBloqueado') }}
        </p>
        <template v-else>
          <span v-if="precisaJustificativa(p)" class="campo">
            <label :for="`fap-just-${p.pedido}`">{{
              t('financeiro.fluxoAprovacao.fila.justificativa')
            }}</label>
            <textarea
              :id="`fap-just-${p.pedido}`"
              v-model="justificativas[p.pedido]"
              rows="2"
              maxlength="500"
              :aria-describedby="`fap-just-dica-${p.pedido}`"
              :data-testid="`fap-justificativa-${p.pedido}`"
            />
            <small
              v-if="(justificativas[p.pedido] ?? '').length > 0 && !justificativaOk(p.pedido)"
              :id="`fap-just-dica-${p.pedido}`"
              role="status"
            >
              {{
                t('financeiro.fluxoAprovacao.fila.justificativaCurta', { n: JUSTIFICATIVA_MINIMA_APROVACAO })
              }}
            </small>
          </span>
          <div class="respostas" role="group" :aria-labelledby="`fap-ped-${p.pedido}`">
            <button
              v-for="r in p.respostas"
              :key="r.id"
              type="button"
              :class="r.efeito === 'aprova' ? 'primario' : 'secundario'"
              :disabled="!podeResponder(p, r)"
              :data-testid="`fap-resposta-${p.pedido}-${r.efeito}`"
              @click="decidir(p, r)"
            >
              {{ r.descricao }}
            </button>
          </div>
        </template>
        <button
          type="button"
          class="ligacao"
          :aria-expanded="!!historicos[p.pedido]"
          :data-testid="`fap-historico-${p.pedido}`"
          @click="alternarHistorico(p.pedido)"
        >
          {{
            historicos[p.pedido]
              ? t('financeiro.fluxoAprovacao.fila.ocultarHistorico')
              : t('financeiro.fluxoAprovacao.fila.historico')
          }}
        </button>
        <ol v-if="historicos[p.pedido]" class="historico" :data-testid="`fap-decisoes-${p.pedido}`">
          <li v-if="!historicos[p.pedido]!.decisoes.length">
            {{ t('financeiro.fluxoAprovacao.fila.semDecisao') }}
          </li>
          <li v-for="(d, i) in historicos[p.pedido]!.decisoes" :key="i">
            {{
              t('financeiro.fluxoAprovacao.fila.decisao', {
                etapa: d.etapa,
                resposta: d.resposta || d.decisao,
                aprovador: d.aprovador,
                canal: t(
                  `financeiro.fluxoAprovacao.fila.canais.${d.canal === 'celular' ? 'celular' : 'web'}`,
                ),
                quando: quando(d.em),
              })
            }}
            <span v-if="d.justificativa"> — {{ d.justificativa }}</span>
          </li>
        </ol>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cartoes {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--sgh-espaco-3);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
}
.cartao-aprov {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-3);
  background: var(--sgh-fundo);
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.cartao-aprov h2 {
  margin: 0;
  font-size: 1.05rem;
}
.valor {
  font-size: 1.4rem;
  font-weight: 600;
  margin: 0;
}
.secundario-texto {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.respostas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.respostas button {
  flex: 1 1 8rem;
  min-height: var(--sgh-alvo-minimo);
}
.campo textarea {
  width: 100%;
}
.historico {
  font-size: var(--sgh-fonte-pequena);
  padding-left: var(--sgh-espaco-3);
}
</style>
