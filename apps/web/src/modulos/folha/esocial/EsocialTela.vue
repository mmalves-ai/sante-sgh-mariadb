<script setup lang="ts">
// eSocial: eventos e conciliação (M53.6, etapa F5; item `Gestão de pessoas > eSocial`; `pessoas.esocial.ler`; gerar
// com `pessoas.esocial.gerar`, lotes, envio, retorno e conferência com `pessoas.esocial.transmitir`; ficha seção 7,
// regras 1, 2, 3 e 9). O empregador com busca (ADR 0027) e as abas: eventos (gerar os de tabela e os do trabalhador,
// prévia com o XML conferido no leiaute, descarte, exclusão S-3000, retificação, escolha para o lote), lotes (enviar ao
// coletor fora de produção, retorno evento a evento, cancelar), conciliação do transmissor único, pendências acumuladas
// (só contagem), parâmetros do empregador com vigência e a ficha do eSocial do colaborador (D-FICHA-TELA-536: na
// própria tela, aberta também pela ficha do colaborador com `?aba=fichas&vinculo=N`). O servidor confere tudo de novo.
// M53.7 (F6): a aba dos periódicos do período fechado na folha (S-1200, S-1210, S-1299 e S-1298).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroFolha from '../telas/ErroFolha.vue';
import AbaConciliacaoEsocial from './AbaConciliacaoEsocial.vue';
import AbaEventosEsocial from './AbaEventosEsocial.vue';
import AbaFichaEsocial from './AbaFichaEsocial.vue';
import AbaLotesEsocial from './AbaLotesEsocial.vue';
import AbaParametrosEsocial from './AbaParametrosEsocial.vue';
import AbaPendenciasEsocial from './AbaPendenciasEsocial.vue';
import AbaPeriodicosEsocial from './AbaPeriodicosEsocial.vue';
import { lerApoioEsocial } from './api-esocial.js';

const { t } = useI18n();
const rota = useRoute();
const apoio = useQuery({ queryKey: ['folha', 'esocial', 'apoio'], queryFn: lerApoioEsocial });
const a = computed(() => apoio.data.value ?? null);

type Aba = 'eventos' | 'periodicos' | 'lotes' | 'conciliacao' | 'pendencias' | 'parametros' | 'fichas';
// A ficha do colaborador (dado pessoal decifrado) e os parâmetros (gravação) só para quem gera os eventos; o resto
// para quem consulta o eSocial.
const abas = computed<Aba[]>(() => [
  'eventos',
  'periodicos',
  'lotes',
  'conciliacao',
  'pendencias',
  'parametros',
  ...(a.value?.acoes.gerar ? (['fichas'] as const) : []),
]);
const pedida = typeof rota?.query['aba'] === 'string' ? (rota.query['aba'] as Aba) : null;
const aba = ref<Aba>(pedida ?? 'eventos');
const vinculoPedido = computed(() => {
  const v = Number(rota?.query['vinculo']);
  return Number.isInteger(v) && v > 0 ? v : null;
});
watch(abas, (xs) => {
  if (a.value && !xs.includes(aba.value)) aba.value = 'eventos';
});
const empresa = ref<number | null>(null);
watch(a, (x) => {
  if (x && empresa.value === null && x.empresas.length === 1) empresa.value = x.empresas[0]!.codigo;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas ?? []).map((e) => ({ valor: e.codigo, rotulo: e.rotulo })),
);
const semCnpj = computed(
  () =>
    empresa.value !== null && a.value?.empresas.find((e) => e.codigo === empresa.value)?.temCnpj === false,
);
const consulta = computed(() => !!a.value && !a.value.acoes.gerar && !a.value.acoes.transmitir);
const precisaEmpresa = computed(() => aba.value !== 'fichas' && aba.value !== 'pendencias');
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="esocial-titulo" data-testid="tela-esocial">
    <h1 id="esocial-titulo">{{ t('folha.esocial.titulo') }}</h1>
    <p>{{ t('folha.esocial.subtitulo') }}</p>
    <ErroFolha v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('folha.esocial.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="consulta"
        :texto="t('folha.esocial.soConsulta')"
        variante="info"
        data-testid="esocial-so-consulta"
      />
      <SanteAlerta
        :texto="
          a.transmissao.motivo && !consulta
            ? t('folha.esocial.transmissao.desligada', { motivo: a.transmissao.motivo })
            : a.transmissao.ambiente === 'producao'
              ? t('folha.esocial.transmissao.producao')
              : t('folha.esocial.transmissao.coletor')
        "
        variante="info"
        data-testid="esocial-transmissao"
      />
      <div class="campos" data-testid="esocial-filtros">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('folha.esocial.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="esocial-empresa"
        />
      </div>
      <SanteAlerta
        v-if="semCnpj"
        :texto="t('folha.esocial.semCnpj')"
        variante="aviso"
        data-testid="esocial-sem-cnpj"
      />
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`folha.esocial.abas.${x}`)"
          :data-testid="`esocial-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <p v-if="precisaEmpresa && empresa === null" role="status" data-testid="esocial-escolha-empresa">
        {{ t('folha.esocial.escolhaEmpresa') }}
      </p>
      <AbaEventosEsocial v-else-if="aba === 'eventos' && empresa !== null" :apoio="a" :empresa="empresa" />
      <AbaPeriodicosEsocial
        v-else-if="aba === 'periodicos' && empresa !== null"
        :apoio="a"
        :empresa="empresa"
      />
      <AbaLotesEsocial v-else-if="aba === 'lotes' && empresa !== null" :apoio="a" :empresa="empresa" />
      <AbaConciliacaoEsocial
        v-else-if="aba === 'conciliacao' && empresa !== null"
        :apoio="a"
        :empresa="empresa"
      />
      <AbaParametrosEsocial
        v-else-if="aba === 'parametros' && empresa !== null"
        :apoio="a"
        :empresa="empresa"
      />
      <AbaPendenciasEsocial v-else-if="aba === 'pendencias'" :empresa="empresa" />
      <AbaFichaEsocial v-else-if="aba === 'fichas'" :apoio="a" :vinculo-inicial="vinculoPedido" />
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
