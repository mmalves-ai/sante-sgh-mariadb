<script setup lang="ts">
// SPED ECD/ECF (M54.3, etapa F3; item `Controladoria > Contabilidade > SPED ECD/ECF`; `contabil.sped.ler`, gerar com
// `contabil.sped.gerar`): a escrituração contábil digital (ECD) e a fiscal (ECF) geradas da contabilidade própria. A
// parte nasce DESLIGADA (chave própria): até a controladoria ligar, a tela diz o motivo e a escrituração segue com o
// escritório contábil. Ligada: a prévia do exercício (impedimentos, avisos e a contagem dos registros), a geração com os
// signatários (o arquivo leva o CPF deles e é guardado cifrado), a lista dos arquivos com o hash, o arquivo para o
// programa oficial (leitura registrada), o recibo da transmissão e o cancelamento.
import { type ApoioSped, LEIAUTE_ECD, TIPOS_ARQUIVO_SPED, type TipoArquivoSped } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { usarSessao } from '../../casca/sessao/sessao.js';
import FormGerarSped from './FormGerarSped.vue';
import ListaArquivosSped from './ListaArquivosSped.vue';
import { lerApoioSped, lerPreviaSped } from './api-demonstracoes.js';
import { exerciciosAte } from './comum-demonstracoes.js';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
// As tabelas do SPED contábil são uma consulta do catálogo: o atalho só para quem a lê.
const { permissoes } = usarSessao();
const veTabelas = computed(() => permissoes.value.has('catalogo.item.ler'));
const empresa = ref(1);
const apoio = useQuery({
  queryKey: computed(() => ['contabil', 'apoio-sped', empresa.value]),
  queryFn: () => lerApoioSped(empresa.value),
});
const a = computed<ApoioSped | null>(() => apoio.data.value ?? null);
const hoje = computed(() => props.hoje ?? a.value?.hoje ?? new Date().toISOString().slice(0, 10));
watch(a, (x) => {
  if (x && x.empresas.length > 0 && !x.empresas.includes(empresa.value)) empresa.value = x.empresas[0]!;
});
const opcoesEmpresa = computed(() =>
  (a.value?.empresas.length ? a.value.empresas : [1]).map((e) => ({
    valor: e,
    rotulo: t('contabil.empresaN', { n: e }),
  })),
);
const tipo = ref<TipoArquivoSped>('ecd');
const opcoesTipo = (Object.keys(TIPOS_ARQUIVO_SPED) as TipoArquivoSped[]).map((x) => ({
  valor: x,
  rotulo: TIPOS_ARQUIVO_SPED[x],
}));
const exercicio = ref<number>(Number((props.hoje ?? new Date().toISOString()).slice(0, 4)) - 1);
const exercicios = computed(() => exerciciosAte(hoje.value).map((x) => ({ valor: x, rotulo: String(x) })));
const pedido = ref<{ empresa: number; tipo: TipoArquivoSped; exercicio: number } | null>(null);
function verPrevia() {
  pedido.value = { empresa: empresa.value, tipo: tipo.value, exercicio: exercicio.value };
}
watch([empresa, tipo, exercicio], () => {
  pedido.value = null;
});
const previa = useQuery({
  queryKey: computed(() => ['contabil', 'sped-previa', pedido.value]),
  queryFn: () => lerPreviaSped(pedido.value!),
  enabled: computed(() => pedido.value !== null && a.value?.ligada === true),
});
const p = computed(() => (pedido.value ? (previa.data.value ?? null) : null));
const leiaute = computed(() =>
  tipo.value === 'ecd' ? (a.value?.leiautes.ecd ?? LEIAUTE_ECD) : a.value?.leiautes.ecf,
);
</script>

<template>
  <section class="tela-contabil" aria-labelledby="sped-titulo" data-testid="tela-sped">
    <h1 id="sped-titulo">{{ t('contabil.sped.titulo') }}</h1>
    <p>{{ t('contabil.sped.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('contabil.carregando') }}</p>
    <SanteAlerta
      v-else-if="!a.ligada"
      :texto="a.motivo ?? t('contabil.sped.desligado')"
      variante="info"
      data-testid="sped-desligado"
    />
    <template v-else>
      <SanteAlerta
        v-if="!a.cifraDisponivel"
        variante="alerta"
        :texto="t('contabil.sped.semCifra')"
        data-testid="sped-sem-cifra"
      />
      <div class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('contabil.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="sped-empresa"
        />
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('contabil.sped.tipo')"
          :opcoes="opcoesTipo"
          data-testid="sped-tipo"
        />
        <SanteSelecao
          v-model="exercicio"
          :rotulo="t('contabil.demonstracoes.exercicio')"
          :opcoes="exercicios"
          data-testid="sped-exercicio"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.sped.verPrevia')"
            data-testid="sped-ver-previa"
            @acionar="verPrevia"
          />
        </div>
      </div>
      <p class="secundario" data-testid="sped-leiaute">
        {{ t('contabil.sped.leiaute', { versao: leiaute ?? '' }) }}
      </p>
      <p v-if="veTabelas">
        <RouterLink to="/contabil/sped/tabelas" data-testid="sped-tabelas">{{
          t('contabil.sped.tabelas')
        }}</RouterLink>
      </p>
      <section v-if="pedido" class="bloco" aria-labelledby="sped-previa-titulo" data-testid="sped-previa">
        <h2 id="sped-previa-titulo">{{ t('contabil.sped.previa') }}</h2>
        <MensagemErro v-if="previa.isError.value" :erro="previa.error.value" />
        <p v-else-if="!p" role="status">{{ t('contabil.carregando') }}</p>
        <template v-else>
          <p data-testid="sped-previa-resumo">
            {{ t('contabil.sped.resumo', { linhas: p.linhas, registros: p.registros.length }) }}
          </p>
          <section v-if="p.impedimentos.length > 0" data-testid="sped-impedimentos">
            <h3>{{ t('contabil.demonstracoes.impedimentos') }}</h3>
            <ul>
              <li v-for="i in p.impedimentos" :key="i.codigo" :data-testid="`sped-impedimento-${i.codigo}`">
                {{ i.mensagem }}<template v-if="i.quantidade > 1"> ({{ i.quantidade }})</template>
              </li>
            </ul>
          </section>
          <section v-if="p.avisos.length > 0" data-testid="sped-avisos">
            <h3>{{ t('contabil.sped.avisos') }}</h3>
            <ul>
              <li v-for="(x, i) in p.avisos" :key="i">{{ x }}</li>
            </ul>
          </section>
          <details v-if="p.registros.length > 0" data-testid="sped-registros">
            <summary>{{ t('contabil.sped.registros') }}</summary>
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('contabil.sped.registro') }}</th>
                  <th scope="col">{{ t('contabil.sped.quantidade') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in p.registros" :key="r.registro">
                  <th scope="row">{{ r.registro }}</th>
                  <td>{{ r.quantidade }}</td>
                </tr>
              </tbody>
            </table>
          </details>
          <FormGerarSped
            v-if="a.podeGerar && p.podeGerar"
            :key="`${pedido.empresa}-${pedido.tipo}-${pedido.exercicio}`"
            :apoio="a"
            :empresa="pedido.empresa"
            :tipo="pedido.tipo"
            :exercicio="pedido.exercicio"
          />
          <p v-else-if="!a.podeGerar" class="secundario" data-testid="sped-sem-permissao">
            {{ a.cifraDisponivel ? t('contabil.sped.semPermissao') : t('contabil.sped.semCifra') }}
          </p>
        </template>
      </section>
      <ListaArquivosSped :key="`l-${empresa}`" :apoio="a" :empresa="empresa" :hoje="hoje" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
