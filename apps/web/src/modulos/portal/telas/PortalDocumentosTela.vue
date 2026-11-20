<script setup lang="ts">
// Portal do paciente: resultados, receitas e documentos (M50, etapa 1; ficha, seção 7; regras 1 e 13). Só os
// resultados liberados de setor publicado (a visualização é gravada como no portal de resultados) e os documentos do
// prontuário assinados no nível mínimo (ICP-Brasil, M49), do titular escolhido. Abrir grava a visualização; o documento
// assinado baixa o PDF e mostra o código do verificador público.
import type { DocumentoPortalAberto, ItemDocumentoPortal, LaudoPortalAberto } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  abrirDocumentoPortal,
  abrirResultadoPortal,
  documentosPortal,
  enderecoPdfDocumento,
} from '../api-portal-paciente.js';
import PortalCasca from '../componentes/PortalCasca.vue';

const { t, te } = useI18n();
const pronta = ref(false);
const versao = ref(0);
const pagina = ref(1);
const lista = useQuery({
  queryKey: computed(() => ['portal-paciente', 'documentos', versao.value, pagina.value]),
  queryFn: () => documentosPortal(pagina.value),
  enabled: pronta,
});
const resultado = ref<LaudoPortalAberto | null>(null);
const documento = ref<DocumentoPortalAberto | null>(null);
const erro = ref<unknown>(null);

const titulo = (i: ItemDocumentoPortal) =>
  i.origem === 'resultado'
    ? i.titulo
    : te(`portal.documentos.tipos.${i.titulo}`)
      ? t(`portal.documentos.tipos.${i.titulo}`)
      : i.titulo;
const dia = (s: string) => s.slice(0, 10).split('-').reverse().join('/');

async function abrir(i: ItemDocumentoPortal): Promise<void> {
  erro.value = null;
  resultado.value = null;
  documento.value = null;
  try {
    if (i.origem === 'resultado') resultado.value = await abrirResultadoPortal(i.item);
    else documento.value = await abrirDocumentoPortal(i.item);
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  }
}
function trocou(): void {
  resultado.value = null;
  documento.value = null;
  pagina.value = 1;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.documentos.titulo')" @sessao="pronta = true" @trocou="trocou">
    <p>{{ t('portal.documentos.ajuda') }}</p>
    <ErroPortal v-if="lista.isError.value" :erro="lista.error.value" />
    <template v-else-if="lista.data.value">
      <SanteAlerta
        v-if="lista.data.value.semDocumentosAssinados"
        :texto="t('portal.documentos.semAssinados')"
        variante="info"
      />
      <p v-if="lista.data.value.itens.length === 0" data-testid="portal-documentos-vazio">
        {{ t('portal.nenhum') }}
      </p>
      <table v-else class="portal-tabela" data-testid="portal-documentos">
        <caption>
          {{
            t('portal.documentos.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('portal.documentos.colunas.item') }}</th>
            <th scope="col">{{ t('portal.documentos.colunas.data') }}</th>
            <th scope="col">{{ t('portal.documentos.colunas.assinatura') }}</th>
            <th scope="col">{{ t('portal.documentos.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in lista.data.value.itens" :key="`${i.origem}-${i.item}`">
            <td>
              {{ titulo(i) }}
              <span class="portal-secundario"> · {{ t(`portal.documentos.origens.${i.origem}`) }}</span>
            </td>
            <td>{{ dia(i.data) }}</td>
            <td>{{ i.assinatura ? t(`portal.documentos.assinaturas.${i.assinatura}`) : '—' }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('portal.documentos.abrir')"
                :data-testid="`portal-abrir-${i.origem}-${i.item}`"
                @acionar="abrir(i)"
              />
              <span class="portal-secundario">
                · {{ i.visto ? t('portal.documentos.visto') : t('portal.documentos.novo') }}</span
              >
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="lista.data.value.haMais"
        variante="secundario"
        :rotulo="t('portal.documentos.maisAntigos')"
        @acionar="pagina++"
      />
    </template>
    <p v-else role="status">{{ t('portal.carregando') }}</p>
    <ErroPortal v-if="erro" :erro="erro" />
    <section
      v-if="resultado"
      class="portal-painel"
      aria-labelledby="portal-resultado"
      data-testid="portal-resultado"
    >
      <h2 id="portal-resultado">{{ resultado.laudo.nome }}</h2>
      <table v-if="resultado.valores.length" class="portal-tabela">
        <caption>
          {{
            resultado.laudo.setor
          }}
        </caption>
        <tbody>
          <tr v-for="v in resultado.valores" :key="v.elemento">
            <th scope="row">{{ v.elemento }}</th>
            <td>{{ v.valor }} {{ v.unidade ?? '' }}</td>
            <td>{{ v.referencia ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-for="(x, k) in resultado.texto" :key="k" class="portal-texto">{{ x }}</p>
      <!-- M47 (etapa 3): o link das imagens do exame (estudo concluído no PACS). -->
      <p v-if="resultado.imagem" data-testid="portal-imagem">
        <a :href="resultado.imagem.link" target="_blank" rel="noopener noreferrer">{{
          t('pacs.portal.imagens', { visualizador: resultado.imagem.visualizador })
        }}</a>
      </p>
    </section>
    <section
      v-if="documento"
      class="portal-painel"
      aria-labelledby="portal-documento"
      data-testid="portal-documento"
    >
      <h2 id="portal-documento">{{ titulo(documento.item) }}</h2>
      <p>{{ dia(documento.item.data) }}</p>
      <p v-if="documento.item.assinatura">
        {{ t(`portal.documentos.assinaturas.${documento.item.assinatura}`) }}
      </p>
      <a
        v-if="documento.temPdf"
        :href="enderecoPdfDocumento(documento.item.item)"
        data-testid="portal-baixar"
        >{{ t('portal.documentos.baixar') }}</a
      >
      <RouterLink v-if="documento.item.verificacao" :to="`/verificar/${documento.item.verificacao}`">{{
        t('portal.documentos.verificar')
      }}</RouterLink>
    </section>
  </PortalCasca>
</template>

<style scoped>
.portal-texto {
  white-space: pre-wrap;
}
</style>
