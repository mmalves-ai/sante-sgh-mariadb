<script setup lang="ts">
// Aba Cenários do orçamento empresarial (C1-125): os cenários da rede (código, tendência, ajuste sobre a receita,
// ativo), o cadastro com a validação na hora pela regra do domínio (a tendência combina com o sinal do ajuste) e o
// ativar/desativar em um clique. Gravar exige `financeiro.orcamento.editar` (o servidor confere de novo).
import {
  TENDENCIAS_CENARIO_ORCAMENTO,
  type TendenciaCenarioOrcamento,
  validarCenarioOrcamento,
} from '@sgh/dominio-financeiro';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarCenarioOrcamento,
  type CenarioOrcamentoVisao,
  centesimosDoTexto,
  criarCenarioOrcamento,
  lerCenariosOrcamento,
  percentualTexto,
} from './api-premissas-cenarios.js';
import ErroOrcamento from './ErroOrcamento.vue';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['orcamento', 'cenarios'], queryFn: lerCenariosOrcamento });
const cenarios = computed(() => lista.data.value?.cenarios ?? []);

const codigo = ref('');
const descricao = ref('');
const tendencia = ref<TendenciaCenarioOrcamento>('base');
const ajuste = ref('0');
const tocado = ref(false);
const enviando = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const opcoesTendencia = computed(() =>
  TENDENCIAS_CENARIO_ORCAMENTO.map((x) => ({
    valor: x,
    rotulo: t(`orcamentoEmpresarial.premissasCenarios.tendencias.${x}`),
  })),
);
const ajusteCentesimos = computed(() => centesimosDoTexto(ajuste.value));
const falhas = computed(() => {
  const a = ajusteCentesimos.value;
  return validarCenarioOrcamento({
    codigo: codigo.value,
    descricao: descricao.value,
    tendencia: tendencia.value,
    ajusteCentesimos: a === null || Number.isNaN(a) ? Number.NaN : a,
  });
});
const falhaDe = (campo: string) =>
  tocado.value || campo === 'ajuste' ? (falhas.value.find((f) => f.campo === campo)?.mensagem ?? null) : null;

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['orcamento'] });
}

async function cadastrar(): Promise<void> {
  tocado.value = true;
  if (falhas.value.length || enviando.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await criarCenarioOrcamento({
      codigo: codigo.value.trim().toUpperCase(),
      descricao: descricao.value.trim(),
      tendencia: tendencia.value,
      ajusteCentesimos: ajusteCentesimos.value ?? 0,
      ativo: true,
    });
    mensagem.value = t('orcamentoEmpresarial.premissasCenarios.cenarios.gravado');
    codigo.value = '';
    descricao.value = '';
    ajuste.value = '0';
    tendencia.value = 'base';
    tocado.value = false;
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}

async function alternar(c: CenarioOrcamentoVisao): Promise<void> {
  if (enviando.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await alterarCenarioOrcamento(c.id, {
      codigo: c.codigo,
      descricao: c.descricao,
      tendencia: c.tendencia,
      ajusteCentesimos: c.ajusteCentesimos,
      ativo: !c.ativo,
      versao: c.versao,
    });
    mensagem.value = t('orcamentoEmpresarial.premissasCenarios.cenarios.alterado');
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="orc-cen-titulo" data-testid="orc-cenarios">
    <h2 id="orc-cen-titulo">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.titulo') }}</h2>
    <p class="secundario">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.ajuda') }}</p>
    <ErroOrcamento v-if="lista.isError.value" :erro="lista.error.value" />
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="orc-cen-mensagem" />
    <ErroOrcamento v-if="erro" :erro="erro" />
    <p v-if="!cenarios.length" data-testid="orc-cen-nenhum">
      {{ t('orcamentoEmpresarial.premissasCenarios.cenarios.nenhum') }}
    </p>
    <table v-else class="tabela" data-testid="orc-cen-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.colunas.codigo') }}</th>
          <th scope="col">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.colunas.descricao') }}</th>
          <th scope="col">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.colunas.tendencia') }}</th>
          <th scope="col">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.colunas.ajuste') }}</th>
          <th scope="col">{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.colunas.situacao') }}</th>
          <th v-if="props.podeEditar" scope="col">
            {{ t('orcamentoEmpresarial.premissasCenarios.cenarios.colunas.acoes') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in cenarios" :key="c.id" :data-testid="`orc-cen-${c.codigo}`">
          <td>{{ c.codigo }}</td>
          <td>{{ c.descricao }}</td>
          <td>{{ t(`orcamentoEmpresarial.premissasCenarios.tendencias.${c.tendencia}`) }}</td>
          <td>{{ percentualTexto(c.ajusteCentesimos) }}</td>
          <td>
            {{
              c.ativo
                ? t('orcamentoEmpresarial.premissasCenarios.cenarios.ativo')
                : t('orcamentoEmpresarial.premissasCenarios.cenarios.inativo')
            }}
          </td>
          <td v-if="props.podeEditar">
            <SanteBotao
              variante="secundario"
              :rotulo="
                c.ativo
                  ? t('orcamentoEmpresarial.premissasCenarios.cenarios.desativar')
                  : t('orcamentoEmpresarial.premissasCenarios.cenarios.ativar')
              "
              :desabilitado="enviando"
              :data-testid="`orc-cen-alternar-${c.codigo}`"
              @acionar="alternar(c)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <form v-if="props.podeEditar" class="bloco" data-testid="orc-cen-form" @submit.prevent="cadastrar">
      <h3>{{ t('orcamentoEmpresarial.premissasCenarios.cenarios.novo') }}</h3>
      <SanteCampoTexto
        v-model="codigo"
        :rotulo="t('orcamentoEmpresarial.premissasCenarios.cenarios.codigo')"
        :max-bytes="30"
        obrigatorio
        data-testid="orc-cen-codigo"
      />
      <span v-if="falhaDe('codigo')" class="secundario" role="alert">{{ falhaDe('codigo') }}</span>
      <SanteCampoTexto
        v-model="descricao"
        :rotulo="t('orcamentoEmpresarial.premissasCenarios.cenarios.descricao')"
        :max-bytes="150"
        obrigatorio
        data-testid="orc-cen-descricao"
      />
      <span v-if="falhaDe('descricao')" class="secundario" role="alert">{{ falhaDe('descricao') }}</span>
      <SanteSelecao
        v-model="tendencia"
        :rotulo="t('orcamentoEmpresarial.premissasCenarios.cenarios.tendencia')"
        :opcoes="opcoesTendencia"
        obrigatorio
        data-testid="orc-cen-tendencia"
      />
      <label>
        {{ t('orcamentoEmpresarial.premissasCenarios.cenarios.ajuste') }}
        <input
          v-model="ajuste"
          inputmode="decimal"
          maxlength="8"
          :aria-invalid="falhaDe('ajuste') !== null"
          data-testid="orc-cen-ajuste"
        />
      </label>
      <span v-if="falhaDe('ajuste')" class="secundario" role="alert" data-testid="orc-cen-ajuste-erro">{{
        falhaDe('ajuste')
      }}</span>
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          variante="primario"
          :rotulo="t('orcamentoEmpresarial.premissasCenarios.cenarios.gravar')"
          :desabilitado="enviando || (tocado && falhas.length > 0)"
          data-testid="orc-cen-gravar"
        />
      </div>
    </form>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
