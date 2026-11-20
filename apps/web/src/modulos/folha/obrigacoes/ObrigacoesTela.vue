<script setup lang="ts">
// Obrigações legais (M53.8, etapa F7; item `Gestão de pessoas > Obrigações legais`; consulta com
// `pessoas.obrigacao.ler`; gerar, baixar o arquivo, registrar a entrega, cancelar e gravar os parâmetros com
// `pessoas.obrigacao.gerar`; os valores só com `pessoas.salario.ler`; ficha do M53, seções 1, 6 a 8, regras 3 e 7). A
// empresa com busca (ADR 0027) e as abas: FGTS Digital (apuração da competência, conferência com o eSocial,
// conciliação da guia), SEFIP/CAGED/RAIS (arquivos dos períodos em que ainda são exigidos), Parâmetros (vigências com
// os regimes e os leiautes) e Histórico. O sistema não transmite nada: gera, o departamento pessoal confere e entrega
// no programa oficial e registra aqui o protocolo. O servidor confere tudo de novo.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import ErroFolha from '../telas/ErroFolha.vue';
import AbaArquivosObrigacao from './AbaArquivosObrigacao.vue';
import AbaFgtsDigital from './AbaFgtsDigital.vue';
import AbaHistoricoObrigacao from './AbaHistoricoObrigacao.vue';
import AbaParametrosObrigacao from './AbaParametrosObrigacao.vue';
import { lerApoioObrigacoes } from './api-obrigacoes.js';

const { t } = useI18n();
const rota = useRoute();
const { permissoes } = usarSessao();
const pode = computed(() => permissoes.value.has('pessoas.obrigacao.gerar'));
const veValores = computed(() => permissoes.value.has('pessoas.salario.ler'));
const apoio = useQuery({ queryKey: ['folha', 'obrigacoes', 'apoio'], queryFn: lerApoioObrigacoes });
const a = computed(() => apoio.data.value ?? null);

const ABAS = ['fgts', 'arquivos', 'parametros', 'historico'] as const;
type Aba = (typeof ABAS)[number];
const pedida = rota?.query['aba'];
const aba = ref<Aba>(ABAS.includes(pedida as Aba) ? (pedida as Aba) : 'fgts');
const empresa = ref<number | null>(null);
watch(a, (x) => {
  if (x && empresa.value === null && x.empresas.length === 1) empresa.value = x.empresas[0]!.codigo;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas ?? []).map((e) => ({ valor: e.codigo, rotulo: e.rotulo })),
);
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="obrigacoes-titulo" data-testid="tela-obrigacoes">
    <h1 id="obrigacoes-titulo">{{ t('folha.obrigacoes.titulo') }}</h1>
    <p>{{ t('folha.obrigacoes.subtitulo') }}</p>
    <ErroFolha v-if="apoio.isError.value" :erro="apoio.error.value" base="folha.obrigacoes.recusa" />
    <p v-else-if="!a" role="status">{{ t('folha.obrigacoes.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!pode"
        :texto="t('folha.obrigacoes.soConsulta')"
        variante="info"
        data-testid="obrigacoes-so-consulta"
      />
      <SanteAlerta
        v-if="!veValores"
        :texto="t('folha.obrigacoes.semValores')"
        variante="info"
        data-testid="obrigacoes-sem-valores"
      />
      <SanteAlerta
        :texto="t('folha.obrigacoes.naoTransmite')"
        variante="info"
        data-testid="obrigacoes-nao-transmite"
      />
      <div class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('folha.obrigacoes.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="obrigacoes-empresa"
        />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in ABAS"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`folha.obrigacoes.abas.${x}`)"
          :data-testid="`obrigacoes-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <p v-if="empresa === null" role="status" data-testid="obrigacoes-escolha-empresa">
        {{ t('folha.obrigacoes.escolhaEmpresa') }}
      </p>
      <template v-else>
        <AbaFgtsDigital
          v-if="aba === 'fgts'"
          :key="`f-${empresa}`"
          :apoio="a"
          :empresa="empresa"
          :pode="pode"
          :hoje="a.hoje"
        />
        <AbaArquivosObrigacao
          v-else-if="aba === 'arquivos'"
          :key="`a-${empresa}`"
          :apoio="a"
          :empresa="empresa"
          :pode="pode"
          :hoje="a.hoje"
        />
        <AbaParametrosObrigacao
          v-else-if="aba === 'parametros'"
          :key="`p-${empresa}`"
          :apoio="a"
          :empresa="empresa"
          :pode="pode"
          :hoje="a.hoje"
        />
        <AbaHistoricoObrigacao
          v-else
          :key="`h-${empresa}`"
          :apoio="a"
          :empresa="empresa"
          :pode="pode"
          :hoje="a.hoje"
        />
      </template>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
