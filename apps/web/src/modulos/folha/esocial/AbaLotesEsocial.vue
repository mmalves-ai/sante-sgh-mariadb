<script setup lang="ts">
// Aba "Lotes" (M53.6; consulta com `pessoas.esocial.ler`, ações com `pessoas.esocial.transmitir`; regra 3): os lotes do
// empregador com o grupo, o destino (coletor local fora de produção), a situação e o protocolo; o detalhe com os eventos;
// enviar o lote montado (com confirmação); registrar o retorno evento a evento (aceito com o recibo, rejeitado com o
// código e a descrição; D-RETORNO-536: nenhum recibo inventado); cancelar o lote ainda não enviado (com motivo).
import {
  type ApoioEsocial,
  type DetalheLoteEsocial,
  esquemaCancelarLoteEsocial,
  esquemaRetornoLoteEsocial,
  type LoteEsocial,
  SITUACOES_LOTE_ESOCIAL,
  type SituacaoLoteEsocial,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { instanteBr } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  cancelarLoteEsocial,
  enviarLoteEsocial,
  consultarRetornoEsocial,
  lerLoteEsocial,
  lerLotesEsocial,
  registrarRetornoEsocial,
} from './api-esocial.js';
import {
  acoesDoLote,
  entradaRetorno,
  type LinhaRetorno,
  linhaRetornoOk,
  linhasRetorno,
  rotuloEvento,
} from './comum-esocial.js';

const props = defineProps<{ apoio: ApoioEsocial; empresa: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const situacao = ref<SituacaoLoteEsocial | null>(null);
const opcoesSituacao = computed(() => [
  { valor: null, rotulo: t('folha.esocial.eventos.todas') },
  ...SITUACOES_LOTE_ESOCIAL.map((s) => ({ valor: s, rotulo: t(`folha.esocial.situacoesLote.${s}`) })),
]);
const q = useQuery({
  queryKey: computed(() => ['folha', 'esocial', 'lotes', props.empresa, situacao.value]),
  queryFn: () => lerLotesEsocial({ empresa: props.empresa, situacao: situacao.value ?? undefined }),
});
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['folha', 'esocial'] });
}
const destino = (l: LoteEsocial) => t(`folha.esocial.ambientes.${l.ambiente}`);

// ── Detalhe ───────────────────────────────────────────────────────────────────────────────────────────────────
const detalheVisivel = ref(false);
const detalhe = ref<DetalheLoteEsocial | null>(null);
const erroDetalhe = ref<unknown>(null);
async function ver(id: number): Promise<void> {
  detalhe.value = null;
  erroDetalhe.value = null;
  detalheVisivel.value = true;
  try {
    detalhe.value = await lerLoteEsocial(id);
  } catch (x) {
    erroDetalhe.value = x;
  }
}

// ── Enviar ────────────────────────────────────────────────────────────────────────────────────────────────────
async function enviar(l: LoteEsocial): Promise<void> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    await enviarLoteEsocial(l.id, { versao: l.versao });
    aviso.value = t('folha.esocial.lotes.enviadoOk', { id: l.id });
    await atualizar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Consultar o retorno no eSocial (envio real) ────────────────────────────────────────────────────────────────
async function consultar(l: LoteEsocial): Promise<void> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    await consultarRetornoEsocial(l.id, { versao: l.versao });
    aviso.value = t('folha.esocial.lotes.consultadoOk', { id: l.id });
    await atualizar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Retorno ───────────────────────────────────────────────────────────────────────────────────────────────────
const retornoVisivel = ref(false);
const alvoRetorno = ref<DetalheLoteEsocial | null>(null);
const protocolo = ref('');
const linhas = ref<LinhaRetorno[]>([]);
const erroRetorno = ref<unknown>(null);
async function abrirRetorno(l: LoteEsocial): Promise<void> {
  erro.value = null;
  aviso.value = null;
  erroRetorno.value = null;
  try {
    const d = await lerLoteEsocial(l.id);
    alvoRetorno.value = d;
    protocolo.value = d.lote.protocolo ?? '';
    linhas.value = linhasRetorno(d.eventos);
    retornoVisivel.value = true;
  } catch (x) {
    erro.value = x;
  }
}
const opcoesAceito = computed(() => [
  { valor: 'aceito', rotulo: t('folha.esocial.retorno.aceito') },
  { valor: 'rejeitado', rotulo: t('folha.esocial.retorno.rejeitado') },
]);
const eventoDaLinha = (id: number) => alvoRetorno.value?.eventos.find((e) => e.id === id) ?? null;
const retornoOk = computed(() => linhas.value.length > 0 && linhas.value.every(linhaRetornoOk));
const entradaDoRetorno = computed(() =>
  alvoRetorno.value
    ? esquemaRetornoLoteEsocial.safeParse(
        entradaRetorno(alvoRetorno.value.lote.versao, protocolo.value, linhas.value),
      )
    : null,
);
async function registrarRetorno(): Promise<void> {
  const e = entradaDoRetorno.value;
  if (!alvoRetorno.value || !retornoOk.value || !e?.success) return;
  erroRetorno.value = null;
  ocupado.value = true;
  try {
    await registrarRetornoEsocial(alvoRetorno.value.lote.id, e.data);
    retornoVisivel.value = false;
    aviso.value = t('folha.esocial.retorno.registrado', { id: alvoRetorno.value.lote.id });
    await atualizar();
  } catch (x) {
    erroRetorno.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Cancelar ──────────────────────────────────────────────────────────────────────────────────────────────────
const cancelarVisivel = ref(false);
const alvoCancelar = ref<LoteEsocial | null>(null);
const motivo = ref('');
const erroCancelar = ref<unknown>(null);
const entradaCancelar = computed(() =>
  esquemaCancelarLoteEsocial.safeParse({
    motivo: motivo.value.trim(),
    versao: alvoCancelar.value?.versao ?? 0,
  }),
);
function abrirCancelar(l: LoteEsocial): void {
  alvoCancelar.value = l;
  motivo.value = '';
  erroCancelar.value = null;
  aviso.value = null;
  cancelarVisivel.value = true;
}
async function cancelar(): Promise<void> {
  if (!alvoCancelar.value || !entradaCancelar.value.success) return;
  erroCancelar.value = null;
  ocupado.value = true;
  try {
    await cancelarLoteEsocial(alvoCancelar.value.id, entradaCancelar.value.data);
    cancelarVisivel.value = false;
    aviso.value = t('folha.esocial.lotes.cancelado');
    await atualizar();
  } catch (x) {
    erroCancelar.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.esocial.lotes.titulo')" data-testid="esocial-lotes">
    <h2>{{ t('folha.esocial.lotes.titulo') }}</h2>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="esocial-lotes-aviso" />
    <ErroFolha v-if="erro" :erro="erro" />
    <div class="campos">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('folha.esocial.lotes.filtroSituacao')"
        :opcoes="opcoesSituacao"
        data-testid="esocial-lotes-situacao"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('folha.esocial.carregando') }}</p>
    <p v-else-if="q.data.value.itens.length === 0" data-testid="esocial-lotes-vazio">
      {{ t('folha.esocial.lotes.nenhum') }}
    </p>
    <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('folha.esocial.lotes.titulo')">
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.esocial.lotes.lote') }}</th>
            <th scope="col">{{ t('folha.esocial.lotes.grupo') }}</th>
            <th scope="col">{{ t('folha.esocial.lotes.ambiente') }}</th>
            <th scope="col">{{ t('folha.esocial.lotes.quantidade') }}</th>
            <th scope="col">{{ t('folha.esocial.situacao') }}</th>
            <th scope="col">{{ t('folha.esocial.lotes.protocolo') }}</th>
            <th scope="col">{{ t('folha.esocial.lotes.criado') }}</th>
            <th scope="col">{{ t('folha.esocial.lotes.enviado') }}</th>
            <th scope="col">{{ t('folha.esocial.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in q.data.value.itens" :key="l.id" :data-testid="`esocial-lote-${l.id}`">
            <th scope="row">{{ l.id }}</th>
            <td>{{ t(`folha.esocial.grupos.${l.grupo}`) }}</td>
            <td>{{ destino(l) }}</td>
            <td>{{ l.quantidade }}</td>
            <td>{{ t(`folha.esocial.situacoesLote.${l.situacao}`) }}</td>
            <td>{{ l.protocolo ?? '—' }}</td>
            <td class="secundario">{{ l.criadoPor }} · {{ instanteBr(l.criadoEm) }}</td>
            <td class="secundario">
              {{ l.enviadoEm ? `${l.enviadoPor ?? ''} · ${instanteBr(l.enviadoEm)}` : '—' }}
            </td>
            <td class="acoes-linha">
              <SanteBotao
                :rotulo="t('folha.esocial.lotes.ver')"
                variante="texto"
                :data-testid="`esocial-lote-ver-${l.id}`"
                @acionar="ver(l.id)"
              />
              <SanteBotao
                v-if="acoesDoLote(l, apoio).enviar"
                :rotulo="t('folha.esocial.lotes.enviar')"
                variante="destrutivo"
                :confirmacao="
                  t('folha.esocial.lotes.confirmarEnvio', { id: l.id, n: l.quantidade, destino: destino(l) })
                "
                :desabilitado="ocupado"
                :data-testid="`esocial-lote-enviar-${l.id}`"
                @acionar="enviar(l)"
              />
              <SanteBotao
                v-if="acoesDoLote(l, apoio).consultar"
                :rotulo="t('folha.esocial.lotes.consultar')"
                variante="texto"
                :desabilitado="ocupado"
                :data-testid="`esocial-lote-consultar-${l.id}`"
                @acionar="consultar(l)"
              />
              <SanteBotao
                v-if="acoesDoLote(l, apoio).retorno"
                :rotulo="t('folha.esocial.lotes.retorno')"
                variante="texto"
                :data-testid="`esocial-lote-retorno-${l.id}`"
                @acionar="abrirRetorno(l)"
              />
              <SanteBotao
                v-if="acoesDoLote(l, apoio).cancelar"
                :rotulo="t('folha.esocial.lotes.cancelar')"
                variante="texto"
                :data-testid="`esocial-lote-cancelar-${l.id}`"
                @acionar="abrirCancelar(l)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="q.data.value?.truncado" class="secundario">{{ t('folha.esocial.limitado') }}</p>

    <SanteDialogo
      v-model:visivel="detalheVisivel"
      :titulo="t('folha.esocial.lotes.detalhe', { id: detalhe?.lote.id ?? '' })"
      largura="48rem"
    >
      <div data-testid="esocial-lote-detalhe">
        <ErroFolha v-if="erroDetalhe" :erro="erroDetalhe" />
        <p v-else-if="!detalhe" role="status">{{ t('folha.esocial.carregando') }}</p>
        <template v-else>
          <p>
            {{ t(`folha.esocial.grupos.${detalhe.lote.grupo}`) }} · {{ destino(detalhe.lote) }} ·
            {{ t(`folha.esocial.situacoesLote.${detalhe.lote.situacao}`) }}
          </p>
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.esocial.eventos.evento') }}</th>
                <th scope="col">{{ t('folha.esocial.eventos.colaborador') }}</th>
                <th scope="col">{{ t('folha.esocial.situacao') }}</th>
                <th scope="col">{{ t('folha.esocial.eventos.recibo') }}</th>
                <th scope="col">{{ t('folha.esocial.eventos.retorno') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in detalhe.eventos" :key="e.id" :data-testid="`esocial-lote-evento-${e.id}`">
                <th scope="row">{{ e.id }} · {{ rotuloEvento(e.evento) }}</th>
                <td>{{ e.vinculo ? t('folha.esocial.vinculo', { v: e.vinculo }) : '—' }}</td>
                <td>{{ t(`folha.esocial.situacoesEvento.${e.situacao}`) }}</td>
                <td>{{ e.recibo ?? '—' }}</td>
                <td>{{ e.retorno ? `${e.retorno.codigo} · ${e.retorno.descricao}` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="detalheVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="retornoVisivel"
      :titulo="t('folha.esocial.retorno.titulo', { id: alvoRetorno?.lote.id ?? '' })"
      largura="56rem"
    >
      <form data-testid="esocial-retorno-form" @submit.prevent="registrarRetorno">
        <p class="secundario">{{ t('folha.esocial.retorno.ajuda') }}</p>
        <ErroFolha v-if="erroRetorno" :erro="erroRetorno" />
        <SanteCampoTexto
          v-model="protocolo"
          :rotulo="t('folha.esocial.retorno.protocolo')"
          :max-bytes="40"
          data-testid="esocial-retorno-protocolo"
        />
        <fieldset
          v-for="l in linhas"
          :key="l.evento"
          class="bloco"
          :data-testid="`esocial-retorno-evento-${l.evento}`"
        >
          <legend>{{ l.evento }} · {{ rotuloEvento(eventoDaLinha(l.evento)?.evento ?? '') }}</legend>
          <SanteOpcoes
            :model-value="l.aceito ? 'aceito' : 'rejeitado'"
            :legenda="t('folha.esocial.situacao')"
            :opcoes="opcoesAceito"
            @update:model-value="(v: string) => (l.aceito = v === 'aceito')"
          />
          <div class="campos">
            <SanteCampoTexto
              v-model="l.recibo"
              :rotulo="t('folha.esocial.retorno.recibo')"
              :max-bytes="23"
              :data-testid="`esocial-retorno-recibo-${l.evento}`"
            />
            <SanteCampoTexto
              v-model="l.codigo"
              :rotulo="t('folha.esocial.retorno.codigo')"
              :max-bytes="10"
              :data-testid="`esocial-retorno-codigo-${l.evento}`"
            />
            <SanteCampoTexto
              v-model="l.descricao"
              :rotulo="t('folha.esocial.retorno.descricao')"
              :max-bytes="400"
              :data-testid="`esocial-retorno-descricao-${l.evento}`"
            />
          </div>
        </fieldset>
        <p v-if="!retornoOk" class="secundario" data-testid="esocial-retorno-incompleto">
          {{ t('folha.esocial.retorno.incompleto') }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.gravar')"
            tipo="submit"
            :desabilitado="ocupado || !retornoOk"
            data-testid="esocial-retorno-gravar"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="retornoVisivel = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="cancelarVisivel"
      :titulo="t('folha.esocial.cancelamento.titulo', { id: alvoCancelar?.id ?? '' })"
    >
      <form data-testid="esocial-lote-cancelar-form" @submit.prevent="cancelar">
        <ErroFolha v-if="erroCancelar" :erro="erroCancelar" />
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('folha.esocial.cancelamento.motivo')"
          :max-bytes="200"
          multilinha
          data-testid="esocial-lote-cancelar-motivo"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.confirmar')"
            tipo="submit"
            :desabilitado="ocupado || !entradaCancelar.success"
            data-testid="esocial-lote-cancelar-confirmar"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="cancelarVisivel = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
