<script setup lang="ts">
// Aba Versões do orçamento (M54, etapa 7): o ano (com busca, ADR 0027), as versões com a situação, a origem, as linhas e
// o total do ano com as parcelas por natureza; e a criação de uma versão (vazia, cópia de outra versão da mesma
// empresa ou o realizado do ano anterior com um ajuste percentual). Criar só com `financeiro.orcamento.editar` e a
// liberação (o apoio diz); o servidor confere de novo.
import {
  type ApoioOrcamento,
  esquemaCriarVersaoOrcamento,
  ROTULOS_SITUACAO_VERSAO_ORCAMENTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../pep/formato.js';
import { criarVersaoOrcamento, lerVersoesOrcamento } from './api-orcamento.js';
import { anosDoOrcamento, lerAjuste, reais } from './comum-orcamento.js';
import ErroOrcamento from './ErroOrcamento.vue';

const props = defineProps<{ apoio: ApoioOrcamento; hoje: string }>();
const emit = defineEmits<{ abrir: [id: number] }>();
const ano = defineModel<number>('ano', { required: true });
const { t } = useI18n();
const cliente = useQueryClient();

const opcoesAno = anosDoOrcamento(props.hoje).map((a) => ({ valor: a, rotulo: String(a) }));
const versoes = useQuery({
  queryKey: computed(() => ['orcamento', 'versoes', ano.value]),
  queryFn: () => lerVersoesOrcamento(ano.value),
});
const lista = computed(() => versoes.data.value?.versoes ?? []);
// Para copiar: todas as versões (de qualquer ano) da mesma empresa.
const todas = useQuery({
  queryKey: ['orcamento', 'versoes', 'todas'],
  queryFn: () => lerVersoesOrcamento(null),
});

type Base = 'vazio' | 'versao' | 'realizado';
const criando = ref(false);
const gravando = ref(false);
const novoAno = ref<number>(ano.value);
const descricao = ref('');
const base = ref<Base>('vazio');
const versaoBase = ref<number | null>(null);
const ajuste = ref('');
const erro = ref<unknown>(null);
const criada = ref<string | null>(null);
const opcoesBase = computed(() =>
  (['vazio', 'versao', 'realizado'] as const).map((b) => ({
    valor: b,
    rotulo: t(`orcamentoEmpresarial.nova.bases.${b}`),
  })),
);
const opcoesVersaoBase = computed(() =>
  (todas.data.value?.versoes ?? [])
    .filter((v) => v.situacao !== 'descartado')
    .map((v) => ({
      valor: v.id,
      rotulo: `${v.ano} · v${v.numero} · ${v.descricao} (${ROTULOS_SITUACAO_VERSAO_ORCAMENTO[v.situacao]})`,
    })),
);
const ajusteCentesimos = computed(() => lerAjuste(ajuste.value));
const entrada = computed(() =>
  esquemaCriarVersaoOrcamento.safeParse({
    ano: novoAno.value,
    descricao: descricao.value,
    base:
      base.value === 'vazio'
        ? { tipo: 'vazio' }
        : base.value === 'versao'
          ? { tipo: 'versao', id: versaoBase.value }
          : { tipo: 'realizado', ajusteCentesimos: ajusteCentesimos.value },
  }),
);

function abrirCriacao(): void {
  criando.value = true;
  novoAno.value = ano.value;
  descricao.value = '';
  base.value = 'vazio';
  versaoBase.value = null;
  ajuste.value = '';
  erro.value = null;
  criada.value = null;
}

async function criar(): Promise<void> {
  if (!entrada.value.success || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await criarVersaoOrcamento(entrada.value.data);
    criada.value = r.descartadas
      ? t('orcamentoEmpresarial.nova.criadaDescartadas', {
          numero: r.numero,
          linhas: r.linhas,
          descartadas: r.descartadas,
        })
      : t('orcamentoEmpresarial.nova.criada', { numero: r.numero, linhas: r.linhas });
    criando.value = false;
    ano.value = entrada.value.data.ano;
    await cliente.invalidateQueries({ queryKey: ['orcamento', 'versoes'] });
    emit('abrir', r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const conta = (v: { totaisPorNatureza: Record<'despesa' | 'receita' | 'consumo', number> }) =>
  t('orcamentoEmpresarial.versoes.conta', {
    receita: reais(v.totaisPorNatureza.receita),
    despesa: reais(v.totaisPorNatureza.despesa),
    consumo: reais(v.totaisPorNatureza.consumo),
  });
</script>

<template>
  <section class="bloco" aria-labelledby="orc-versoes-titulo" data-testid="orc-versoes">
    <h2 id="orc-versoes-titulo">{{ t('orcamentoEmpresarial.versoes.titulo') }}</h2>
    <div class="campos">
      <SanteSelecao
        v-model="ano"
        :rotulo="t('orcamentoEmpresarial.versoes.ano')"
        :opcoes="opcoesAno"
        busca
        data-testid="orc-ano"
      />
      <div v-if="apoio.acoes.editar && apoio.chaveLigada && !criando" class="acoes">
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.versoes.nova')"
          data-testid="orc-nova"
          @acionar="abrirCriacao"
        />
      </div>
    </div>
    <SanteAlerta v-if="criada" :texto="criada" variante="info" anunciar data-testid="orc-criada" />

    <form
      v-if="criando"
      class="bloco"
      :aria-label="t('orcamentoEmpresarial.nova.titulo')"
      data-testid="orc-form-nova"
      @submit.prevent="criar"
    >
      <h3>{{ t('orcamentoEmpresarial.nova.titulo') }}</h3>
      <div class="campos">
        <SanteSelecao
          v-model="novoAno"
          :rotulo="t('orcamentoEmpresarial.nova.ano')"
          :opcoes="opcoesAno"
          busca
          obrigatorio
          data-testid="orc-nova-ano"
        />
        <SanteCampoTexto
          v-model="descricao"
          :rotulo="t('orcamentoEmpresarial.nova.descricao')"
          :max-bytes="120"
          obrigatorio
          data-testid="orc-nova-descricao"
        />
      </div>
      <SanteOpcoes
        v-model="base"
        :legenda="t('orcamentoEmpresarial.nova.base')"
        :opcoes="opcoesBase"
        data-testid="orc-nova-base"
      />
      <template v-if="base === 'versao'">
        <SanteSelecao
          v-if="opcoesVersaoBase.length"
          v-model="versaoBase"
          :rotulo="t('orcamentoEmpresarial.nova.versaoBase')"
          :opcoes="opcoesVersaoBase"
          busca
          obrigatorio
          data-testid="orc-nova-versao-base"
        />
        <p v-else class="secundario">{{ t('orcamentoEmpresarial.nova.semVersaoBase') }}</p>
      </template>
      <label v-if="base === 'realizado'" class="campo-numero">
        <span>{{ t('orcamentoEmpresarial.nova.ajuste') }}</span>
        <input
          v-model="ajuste"
          inputmode="decimal"
          maxlength="9"
          :aria-invalid="ajusteCentesimos === null"
          aria-describedby="orc-ajuste-ajuda"
          data-testid="orc-nova-ajuste"
        />
        <span id="orc-ajuste-ajuda" class="secundario">{{ t('orcamentoEmpresarial.nova.ajusteAjuda') }}</span>
        <span v-if="ajusteCentesimos === null" class="secundario" role="alert">{{
          t('orcamentoEmpresarial.nova.ajusteInvalido')
        }}</span>
      </label>
      <ErroOrcamento v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.nova.cancelar')"
          variante="texto"
          @acionar="criando = false"
        />
        <SanteBotao
          :rotulo="gravando ? t('orcamentoEmpresarial.nova.criando') : t('orcamentoEmpresarial.nova.criar')"
          tipo="submit"
          :desabilitado="!entrada.success || gravando"
          data-testid="orc-nova-criar"
        />
      </div>
    </form>

    <ErroOrcamento v-if="versoes.isError.value" :erro="versoes.error.value" />
    <p v-else-if="versoes.isPending.value" role="status">{{ t('orcamentoEmpresarial.carregando') }}</p>
    <p v-else-if="lista.length === 0" data-testid="orc-sem-versoes">
      {{ t('orcamentoEmpresarial.versoes.nenhuma') }}
    </p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="orc-lista">
        <caption class="secundario">
          {{
            t('orcamentoEmpresarial.versoes.titulo')
          }}
          ·
          {{
            ano
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('orcamentoEmpresarial.versoes.colunas.numero') }}</th>
            <th scope="col">{{ t('orcamentoEmpresarial.versoes.colunas.descricao') }}</th>
            <th scope="col">{{ t('orcamentoEmpresarial.versoes.colunas.situacao') }}</th>
            <th scope="col">{{ t('orcamentoEmpresarial.versoes.colunas.base') }}</th>
            <th scope="col" class="numero">{{ t('orcamentoEmpresarial.versoes.colunas.linhas') }}</th>
            <th scope="col" class="numero">{{ t('orcamentoEmpresarial.versoes.colunas.total') }}</th>
            <th scope="col">{{ t('orcamentoEmpresarial.versoes.colunas.alterado') }}</th>
            <th scope="col">{{ t('orcamentoEmpresarial.versoes.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in lista" :key="v.id" :data-testid="`orc-versao-${v.numero}`">
            <td>{{ t('orcamentoEmpresarial.versoes.numero', { numero: v.numero }) }}</td>
            <td>{{ v.descricao }}</td>
            <td>{{ ROTULOS_SITUACAO_VERSAO_ORCAMENTO[v.situacao] }}</td>
            <td>{{ v.base }}</td>
            <td class="numero">{{ v.linhas }}</td>
            <td class="numero">
              {{ t('orcamentoEmpresarial.moeda', { valor: reais(v.totalCentavos) }) }}
              <div class="secundario parcelas">{{ conta(v) }}</div>
            </td>
            <td>{{ v.alteradoPor }} · {{ dataHoraBr(v.alteradoEm) }}</td>
            <td>
              <SanteBotao
                :rotulo="t('orcamentoEmpresarial.versoes.abrir')"
                variante="secundario"
                :aria-label="t('orcamentoEmpresarial.versoes.abrirRotulo', { numero: v.numero, ano: v.ano })"
                :data-testid="`orc-abrir-${v.numero}`"
                @acionar="emit('abrir', v.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
