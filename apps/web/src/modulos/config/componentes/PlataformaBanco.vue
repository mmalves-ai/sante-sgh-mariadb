<script setup lang="ts">
// Cartão "Plataforma do banco" do estabelecimento ativo (M58, etapa 1; ficha, seção 7; regras 5 a 7), na tela de
// verificação da estrutura do banco: a versão do motor e o formato do arquivo, a codificação declarada no banco e a que
// este sistema usa (e se conferem), as funções externas com os dependentes e as que impedem a troca para a versão 5,
// as colunas de texto por tipo e codificação, os índices com texto e a restrição de entrada de hoje. Só leitura.
// M58 (etapa 2): o resumo do ensaio da versão 5 na cópia, com o caminho para a tela do ensaio.
// M58 (etapa 3): o resumo do ensaio da conversão do texto para UTF-8, idem.
import type { CartaoPlataforma, ResumoEnsaioFirebird5, ResumoEnsaioUtf8 } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { buscarEnsaioFirebird5, buscarEnsaioUtf8, buscarPlataformaBanco } from '../api.js';

const { t } = useI18n();
const cartao = ref<CartaoPlataforma | null>(null);
const erro = ref<string | null>(null);
const ensaio = ref<ResumoEnsaioFirebird5 | null>(null);
const aprovadas = computed(() => ensaio.value?.etapas.filter((e) => e.situacao === 'aprovada').length ?? 0);
const ensaioUtf8 = ref<ResumoEnsaioUtf8 | null>(null);
const aprovadasUtf8 = computed(
  () => ensaioUtf8.value?.etapas.filter((e) => e.situacao === 'aprovada').length ?? 0,
);

onMounted(async () => {
  try {
    cartao.value = await buscarPlataformaBanco();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
  // O resumo do ensaio é complemento: sem ele, o cartão segue (a tela do ensaio mostra o motivo).
  try {
    ensaio.value = await buscarEnsaioFirebird5();
  } catch {
    ensaio.value = null;
  }
  try {
    ensaioUtf8.value = await buscarEnsaioUtf8();
  } catch {
    ensaioUtf8.value = null;
  }
});
</script>

<template>
  <section aria-labelledby="titulo-plataforma" data-testid="cartao-plataforma">
    <h2 id="titulo-plataforma">{{ t('desligamento.plataforma.titulo') }}</h2>
    <p>{{ t('desligamento.plataforma.descricao') }}</p>
    <p v-if="erro" role="alert">{{ t('config.schema.erro', { erro }) }}</p>
    <p v-else-if="!cartao" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p>
        {{ t('desligamento.plataforma.atualizadoEm', { em: new Date(cartao.em).toLocaleString('pt-BR') }) }}
      </p>
      <dl class="plataforma">
        <dt>{{ t('desligamento.plataforma.versao') }}</dt>
        <dd data-testid="plataforma-versao">{{ cartao.plataforma.versaoMotor }}</dd>
        <dt>{{ t('desligamento.plataforma.ods') }}</dt>
        <dd>{{ cartao.plataforma.ods }}</dd>
        <dt>{{ t('desligamento.plataforma.charsetBanco') }}</dt>
        <dd data-testid="plataforma-charset-banco">{{ cartao.plataforma.charsetBanco }}</dd>
        <dt>{{ t('desligamento.plataforma.charsetParametro') }}</dt>
        <dd data-testid="plataforma-charset-parametro">{{ cartao.plataforma.charsetParametro }}</dd>
        <dt>{{ t('desligamento.plataforma.impressao') }}</dt>
        <dd>
          <code v-if="cartao.plataforma.impressao">{{ cartao.plataforma.impressao }}</code>
          <template v-else>{{ t('desligamento.plataforma.semImpressao') }}</template>
        </dd>
      </dl>
      <SanteAlerta
        :texto="
          cartao.plataforma.charsetConfere
            ? t('desligamento.plataforma.confere')
            : t('desligamento.plataforma.naoConfere')
        "
        :variante="cartao.plataforma.charsetConfere ? 'info' : 'aviso'"
        data-testid="plataforma-confere"
      />
      <p data-testid="plataforma-entrada">
        {{ t(`desligamento.plataforma.restricaoEntrada.${cartao.restricaoEntrada}`) }}
      </p>
      <h3>{{ t('desligamento.plataforma.funcoes') }}</h3>
      <ul data-testid="plataforma-funcoes">
        <li v-for="f in cartao.plataforma.funcoesExternas" :key="f.nome">
          <code>{{ f.nome }}</code> ({{ f.modulo }}):
          {{ t('desligamento.plataforma.funcaoDependentes', { n: f.dependentes }) }}
          <strong v-if="!f.esperada">· {{ t('desligamento.plataforma.funcaoNova') }}</strong>
        </li>
      </ul>
      <p data-testid="plataforma-pendentes">
        {{
          cartao.funcoesPendentes.length
            ? t('desligamento.plataforma.pendentes', { lista: cartao.funcoesPendentes.join(', ') })
            : t('desligamento.plataforma.semPendentes')
        }}
      </p>
      <h3>{{ t('desligamento.plataforma.colunasTexto') }}</h3>
      <ul data-testid="plataforma-colunas">
        <li v-for="c in cartao.colunasTexto" :key="`${c.tipo}-${c.charset}`">
          {{
            t('desligamento.plataforma.colunasLinha', {
              tipo: t(`desligamento.plataforma.tiposColuna.${c.tipo}`),
              charset: c.charset,
              n: c.colunas,
            })
          }}
        </li>
      </ul>
      <p>{{ t('desligamento.plataforma.indices', { n: cartao.indicesComTexto }) }}</p>
      <p v-if="ensaio" data-testid="plataforma-ensaio">
        {{ t('ensaioFirebird5.resumoCartao', { aprovadas, total: ensaio.etapas.length }) }} ·
        <RouterLink
          to="/administracao/coexistencia/desligamento/ensaio-firebird5"
          data-testid="ir-ensaio-firebird5"
          >{{ t('ensaioFirebird5.verTela') }}</RouterLink
        >
      </p>
      <p v-if="ensaioUtf8" data-testid="plataforma-ensaio-utf8">
        {{ t('ensaioUtf8.resumoCartao', { aprovadas: aprovadasUtf8, total: ensaioUtf8.etapas.length }) }} ·
        <RouterLink to="/administracao/coexistencia/desligamento/ensaio-utf8" data-testid="ir-ensaio-utf8">{{
          t('ensaioUtf8.verTela')
        }}</RouterLink>
      </p>
    </template>
  </section>
</template>

<style scoped>
.plataforma {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.plataforma dd {
  margin: 0;
}
</style>
