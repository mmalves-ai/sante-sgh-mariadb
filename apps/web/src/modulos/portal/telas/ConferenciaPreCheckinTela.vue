<script setup lang="ts">
// Conferência do pré-check-in pela recepção (M50, etapa 2; ficha, seção 7: `/recepcao/pre-checkin`,
// `recepcao.precheckin.conferir`; regra 4). A fila do dia (ou da data escolhida) por situação, em páginas; ao abrir: o
// que o paciente enviou ao lado do que está no cadastro, campo a campo (os que mudam vêm marcados), os documentos
// (abertos aqui, sem sair do sistema; a leitura vai à trilha), a carteirinha e o termo. "Conferir e gravar o marcado"
// grava no cadastro só os campos marcados, com quem conferiu; "Recusar" volta ao paciente com o motivo.
// A busca pelo nome ou pelo prontuário do paciente (a do cadastro) acha o pré-check-in de quem está no balcão; a
// marcação cancelada ou transferida por outro canal aparece marcada e não é conferida.
import type { CampoPreCheckin, DetalhePreCheckin } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useInfiniteQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  conferirPreCheckin,
  detalhePreCheckin,
  documentoPreCheckin,
  filaPreCheckin,
  recusarPreCheckin,
} from '../api-portal-agenda.js';

const { t } = useI18n();
const situacao = ref('enviado');
const data = ref('');
const termo = ref('');
const termoAplicado = ref('');
const fila = useInfiniteQuery({
  queryKey: computed(() => ['precheckin', situacao.value, data.value, termoAplicado.value]),
  queryFn: ({ pageParam }) =>
    filaPreCheckin(situacao.value, data.value || null, pageParam, termoAplicado.value || null),
  initialPageParam: null as number | null,
  getNextPageParam: (p) => p.proximo,
});
const itens = computed(() => fila.data.value?.pages.flatMap((p) => p.itens) ?? []);
const podeConferir = computed(() => fila.data.value?.pages[0]?.podeConferir ?? false);
const buscaTruncada = computed(() => fila.data.value?.pages[0]?.buscaTruncada ?? false);
function buscar(): void {
  termoAplicado.value = termo.value.trim().length >= 2 ? termo.value.trim() : '';
}
const opcoesSituacao = computed(() =>
  (['enviado', 'conferido', 'recusado'] as const).map((v) => ({
    valor: v,
    rotulo: t(`portal.interno.precheckin.situacoes.${v}`),
  })),
);
const aberto = ref<DetalhePreCheckin | null>(null);
const marcados = ref<CampoPreCheckin[]>([]);
const documento = ref<{ tipo: string; url: string } | null>(null);
const motivo = ref('');
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const dia = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const hora = (h: string) => `${h.slice(0, 2)}:${h.slice(2, 4)}`;

async function abrir(id: string): Promise<void> {
  erro.value = null;
  feito.value = null;
  if (documento.value) URL.revokeObjectURL(documento.value.url);
  documento.value = null;
  try {
    aberto.value = await detalhePreCheckin(id);
    marcados.value = aberto.value.campos.filter((c) => c.muda).map((c) => c.campo);
    motivo.value = '';
  } catch (x) {
    erro.value = x;
  }
}
async function verDocumento(indice: number): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    const d = await documentoPreCheckin(aberto.value.item.id, indice);
    const bytes = Uint8Array.from(atob(d.conteudo), (c) => c.charCodeAt(0));
    if (documento.value) URL.revokeObjectURL(documento.value.url);
    documento.value = { tipo: d.tipo, url: URL.createObjectURL(new Blob([bytes], { type: d.tipo })) };
  } catch (x) {
    erro.value = x;
  }
}
async function conferir(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    aberto.value = await conferirPreCheckin(aberto.value.item.id, {
      versao: aberto.value.versao,
      versaoCadastro: aberto.value.versaoCadastro,
      campos: marcados.value,
    });
    feito.value = t('portal.interno.precheckin.conferido', {
      campos: aberto.value.camposGravados.length
        ? aberto.value.camposGravados.map((c) => t(`portal.precheckin.campos.${c}`)).join(', ')
        : t('portal.interno.precheckin.semCampos'),
    });
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function recusar(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    aberto.value = await recusarPreCheckin(aberto.value.item.id, {
      versao: aberto.value.versao,
      motivo: motivo.value,
    });
    feito.value = t('portal.interno.precheckin.recusado');
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="pre-titulo" data-testid="tela-conferencia-precheckin">
    <h1 id="pre-titulo">{{ t('portal.interno.precheckin.titulo') }}</h1>
    <p>{{ t('portal.interno.precheckin.ajuda') }}</p>
    <RouterLink to="/agenda/online">{{ t('portal.interno.precheckin.agendasLink') }}</RouterLink>
    <form class="conf-busca" @submit.prevent="buscar">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('portal.interno.precheckin.buscar')"
        :max-bytes="60"
        data-testid="pre-busca"
      />
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('portal.buscar')"
        data-testid="pre-buscar"
        @acionar="buscar"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('portal.interno.precheckin.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="pre-situacao"
      />
      <span class="campo">
        <label for="pre-data">{{ t('portal.interno.precheckin.data') }}</label>
        <input id="pre-data" v-model="data" type="date" data-testid="pre-data" />
      </span>
    </form>
    <ErroPortal v-if="fila.isError.value" :erro="fila.error.value" />
    <template v-else-if="fila.data.value">
      <SanteAlerta
        v-if="buscaTruncada"
        :texto="t('portal.interno.precheckin.buscaTruncada')"
        variante="aviso"
      />
      <p v-if="itens.length === 0">{{ t('portal.nenhum') }}</p>
      <table v-else class="conf-tabela" data-testid="pre-fila">
        <caption>
          {{
            t('portal.interno.precheckin.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('portal.interno.precheckin.quando') }}</th>
            <th scope="col">{{ t('portal.interno.precheckin.paciente') }}</th>
            <th scope="col">{{ t('portal.interno.online.agenda') }}</th>
            <th scope="col">{{ t('portal.interno.precheckin.enviadoEm') }}</th>
            <th scope="col">{{ t('portal.interno.vinculos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens" :key="i.id">
            <td>{{ dia(i.data) }} {{ hora(i.hora) }}</td>
            <td>
              {{ i.paciente.nome }} ·
              {{ t('portal.interno.vinculos.prontuario', { n: i.paciente.prontuario }) }}
            </td>
            <td>
              {{ i.agenda
              }}<strong v-if="i.marcacaoCancelada" :data-testid="`pre-cancelada-${i.id}`">
                · {{ t('portal.interno.precheckin.marcacaoCancelada') }}</strong
              >
            </td>
            <td>
              {{ dia(i.enviadoEm) }} ·
              {{ t('portal.interno.precheckin.campos', { n: i.campos }, i.campos) }} ·
              {{ t('portal.interno.precheckin.documentos', { n: i.documentos }, i.documentos) }}
            </td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('portal.interno.precheckin.abrir')"
                :data-testid="`pre-abrir-${i.id}`"
                @acionar="abrir(i.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="fila.hasNextPage.value"
        variante="secundario"
        :rotulo="t('portal.interno.precheckin.carregarMais')"
        :desabilitado="fila.isFetchingNextPage.value"
        @acionar="fila.fetchNextPage()"
      />
    </template>
    <p v-else role="status">{{ t('portal.carregando') }}</p>
    <SanteAlerta v-if="feito" :texto="feito" variante="info" anunciar data-testid="pre-feito" />
    <ErroPortal v-if="erro" :erro="erro" />
    <section v-if="aberto" class="conf-detalhe" aria-labelledby="pre-detalhe" data-testid="pre-detalhe">
      <h2 id="pre-detalhe">
        {{ aberto.item.paciente.nome }} · {{ dia(aberto.item.data) }} {{ hora(aberto.item.hora) }}
      </h2>
      <SanteAlerta v-if="aberto.motivoRecusa" :texto="aberto.motivoRecusa" variante="aviso" />
      <SanteAlerta
        v-if="aberto.item.marcacaoCancelada"
        :texto="t('portal.interno.precheckin.marcacaoCancelada')"
        variante="aviso"
        data-testid="pre-detalhe-cancelada"
      />
      <SanteAlerta
        v-if="aberto.reservadoPor"
        :texto="t('portal.interno.precheckin.emConferencia', { quem: aberto.reservadoPor })"
        variante="aviso"
      />
      <table class="conf-tabela" data-testid="pre-campos">
        <caption>
          {{
            t('portal.interno.precheckin.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('portal.interno.precheckin.gravar') }}</th>
            <th scope="col">{{ t('portal.interno.precheckin.campo') }}</th>
            <th scope="col">{{ t('portal.interno.precheckin.atual') }}</th>
            <th scope="col">{{ t('portal.interno.precheckin.proposto') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in aberto.campos" :key="c.campo">
            <td>
              <input
                :id="`pre-marcar-${c.campo}`"
                v-model="marcados"
                type="checkbox"
                :value="c.campo"
                :disabled="!c.muda || aberto.item.situacao !== 'enviado'"
                :aria-label="t(`portal.precheckin.campos.${c.campo}`)"
                :data-testid="`pre-marcar-${c.campo}`"
              />
            </td>
            <td>{{ t(`portal.precheckin.campos.${c.campo}`) }}</td>
            <td>{{ c.atual ?? '—' }}</td>
            <td>
              {{ c.proposto
              }}<span v-if="!c.muda" class="portal-secundario">
                · {{ t('portal.precheckin.semMudanca') }}</span
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="aberto.carteirinha" data-testid="pre-carteirinha">
        {{ t('portal.interno.precheckin.carteirinha', { numero: aberto.carteirinha.numero }) }}
        <span v-if="aberto.carteirinha.validade">
          · {{ t('portal.interno.precheckin.validade', { dia: dia(aberto.carteirinha.validade) }) }}</span
        >
      </p>
      <p>{{ t('portal.interno.precheckin.termo', { termo: aberto.termo }) }}</p>
      <div class="conf-busca">
        <SanteBotao
          v-for="d in aberto.documentos"
          :key="d.indice"
          variante="secundario"
          :rotulo="
            t('portal.interno.precheckin.verDocumento', { tipo: t(`portal.precheckin.documento.${d.tipo}`) })
          "
          :data-testid="`pre-documento-${d.indice}`"
          @acionar="verDocumento(d.indice)"
        />
      </div>
      <template v-if="documento">
        <img
          v-if="documento.tipo.startsWith('image/')"
          :src="documento.url"
          :alt="t('portal.interno.vinculos.verDocumento')"
          class="conf-prova"
          data-testid="pre-documento"
        />
        <a v-else :href="documento.url" target="_blank" rel="noopener" data-testid="pre-documento">{{
          t('portal.interno.vinculos.verDocumento')
        }}</a>
      </template>
      <form
        v-if="aberto.item.situacao === 'enviado' && !aberto.item.marcacaoCancelada && podeConferir"
        class="form"
        @submit.prevent
      >
        <SanteBotao
          :rotulo="t('portal.interno.precheckin.conferir')"
          data-testid="pre-conferir"
          @acionar="conferir"
        />
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('portal.interno.precheckin.motivo')"
          :max-bytes="300"
          multilinha
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portal.interno.precheckin.recusar')"
          data-testid="pre-recusar"
          @acionar="recusar"
        />
      </form>
    </section>
  </section>
</template>

<style scoped>
.conf-tabela {
  border-collapse: collapse;
  width: 100%;
}
.conf-tabela th,
.conf-tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.conf-busca {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
}
.conf-detalhe,
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-3);
}
.campo {
  display: flex;
  flex-direction: column;
}
.conf-prova {
  max-width: 100%;
  max-height: 32rem;
  object-fit: contain;
}
</style>
