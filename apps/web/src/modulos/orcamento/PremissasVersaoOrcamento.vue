<script setup lang="ts">
// Premissas e cenário da versão aberta (C1-125): o cenário escolhido com o resultado projetado e a conta impressa (as
// parcelas), as premissas da versão (tipo, valor, justificativa, quem alterou por último) e o formulário de inclusão e
// alteração com a validação na hora pela regra do domínio (o tipo diz qual valor é obrigatório; acima de 20% pede
// justificativa). Retirar é lógico: a premissa fica no histórico. Só a versão em elaboração recebe mudança.
import {
  type PremissaOrcamentoEntrada,
  TIPOS_PREMISSA_ORCAMENTO,
  type TipoPremissaOrcamento,
  validarPremissaOrcamento,
} from '@sgh/dominio-financeiro';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../pep/formato.js';
import {
  alterarPremissaOrcamento,
  centesimosDoTexto,
  escolherCenarioVersao,
  incluirPremissaOrcamento,
  lerCenariosOrcamento,
  lerPremissasVersao,
  numeroDoTexto,
  type PremissaOrcamentoVisao,
  percentualTexto,
  retirarPremissaOrcamento,
} from './api-premissas-cenarios.js';
import { reais } from './comum-orcamento.js';
import ErroOrcamento from './ErroOrcamento.vue';

const props = defineProps<{ id: number }>();
const { t } = useI18n();
const T = 'orcamentoEmpresarial.premissasCenarios.versao';
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['orcamento', 'premissas', props.id]),
  queryFn: () => lerPremissasVersao(props.id),
});
const cenarios = useQuery({ queryKey: ['orcamento', 'cenarios'], queryFn: lerCenariosOrcamento });
const d = computed(() => dados.data.value ?? null);

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);

// ── Cenário da versão ──
const cenarioEscolhido = ref<number | null>(null);
watch(
  () => d.value?.cenario?.id ?? null,
  (v) => (cenarioEscolhido.value = v),
  { immediate: true },
);
const opcoesCenario = computed(() => [
  { valor: null as number | null, rotulo: t(`${T}.semCenario`) },
  ...(cenarios.data.value?.cenarios ?? [])
    .filter((c) => c.ativo || c.id === d.value?.cenario?.id)
    .map((c) => ({
      valor: c.id as number | null,
      rotulo: `${c.codigo}: ${c.descricao} (${percentualTexto(c.ajusteCentesimos)})`,
    })),
]);

// ── Formulário da premissa ──
const editando = ref<PremissaOrcamentoVisao | null>(null);
const tipo = ref<TipoPremissaOrcamento>('inflacao');
const descricao = ref('');
const percentual = ref('');
const valorNumerico = ref('');
const unidade = ref('');
const valorTexto = ref('');
const justificativa = ref('');
const tocado = ref(false);

const opcoesTipo = computed(() =>
  TIPOS_PREMISSA_ORCAMENTO.map((x) => ({
    valor: x,
    rotulo: t(`orcamentoEmpresarial.premissasCenarios.tipos.${x}`),
  })),
);
const percentualC = computed(() => centesimosDoTexto(percentual.value));
const numero = computed(() => numeroDoTexto(valorNumerico.value));
const vazioOu = (s: string) => (s.trim() === '' ? null : s.trim());
const entrada = computed<PremissaOrcamentoEntrada>(() => ({
  tipo: tipo.value,
  descricao: descricao.value,
  percentualCentesimos: percentualC.value,
  valorNumerico: numero.value,
  valorTexto: vazioOu(valorTexto.value),
  unidade: vazioOu(unidade.value),
  justificativa: vazioOu(justificativa.value),
}));
const numerosInvalidos = computed(() => Number.isNaN(percentualC.value) || Number.isNaN(numero.value));
const falhas = computed(() => validarPremissaOrcamento(entrada.value));
const falhaDe = (campo: string) =>
  tocado.value ? (falhas.value.find((f) => f.campo === campo)?.mensagem ?? null) : null;

function limpar(): void {
  editando.value = null;
  tipo.value = 'inflacao';
  descricao.value = '';
  percentual.value = '';
  valorNumerico.value = '';
  unidade.value = '';
  valorTexto.value = '';
  justificativa.value = '';
  tocado.value = false;
}

function alterar(p: PremissaOrcamentoVisao): void {
  editando.value = p;
  tipo.value = p.tipo;
  descricao.value = p.descricao;
  percentual.value =
    p.percentualCentesimos === null ? '' : (p.percentualCentesimos / 100).toFixed(2).replace('.', ',');
  valorNumerico.value = p.valorNumerico === null ? '' : String(p.valorNumerico).replace('.', ',');
  unidade.value = p.unidade ?? '';
  valorTexto.value = p.valorTexto ?? '';
  justificativa.value = p.justificativa ?? '';
  tocado.value = true;
}

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['orcamento'] });
}

async function executar(fn: () => Promise<unknown>, ok: string): Promise<void> {
  if (enviando.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await fn();
    mensagem.value = ok;
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}

async function gravarPremissa(): Promise<void> {
  tocado.value = true;
  if (falhas.value.length || numerosInvalidos.value) return;
  const e = { ...entrada.value, descricao: descricao.value.trim() };
  const atual = editando.value;
  await executar(
    () =>
      atual
        ? alterarPremissaOrcamento(props.id, atual.id, { ...e, versao: atual.versao })
        : incluirPremissaOrcamento(props.id, e),
    atual ? t(`${T}.alterada`) : t(`${T}.incluida`),
  );
  if (!erro.value) limpar();
}

const retirar = (p: PremissaOrcamentoVisao) =>
  executar(() => retirarPremissaOrcamento(props.id, p.id, p.versao), t(`${T}.retirada`));

const aplicarCenario = () =>
  d.value
    ? executar(
        () => escolherCenarioVersao(props.id, d.value!.versaoRegistro, cenarioEscolhido.value),
        t(`${T}.escolhido`),
      )
    : Promise.resolve();

const valorDa = (p: PremissaOrcamentoVisao) =>
  [
    percentualTexto(p.percentualCentesimos),
    p.valorNumerico === null ? '' : `${String(p.valorNumerico).replace('.', ',')} ${p.unidade ?? ''}`.trim(),
    p.valorTexto ?? '',
  ]
    .filter((x) => x !== '')
    .join(' · ');
</script>

<template>
  <section class="bloco" aria-labelledby="orc-prem-titulo" data-testid="orc-premissas">
    <h2 id="orc-prem-titulo">{{ t(`${T}.titulo`) }}</h2>
    <ErroOrcamento v-if="dados.isError.value" :erro="dados.error.value" />
    <template v-else-if="d">
      <SanteAlerta
        v-if="!d.editavel"
        :texto="t(`${T}.fechada`)"
        variante="info"
        data-testid="orc-prem-fechada"
      />
      <SanteAlerta
        v-if="mensagem"
        :texto="mensagem"
        variante="info"
        anunciar
        data-testid="orc-prem-mensagem"
      />
      <ErroOrcamento v-if="erro" :erro="erro" />

      <h3>{{ t(`${T}.cenario`) }}</h3>
      <div class="acoes">
        <SanteSelecao
          v-model="cenarioEscolhido"
          :rotulo="t(`${T}.cenario`)"
          :opcoes="opcoesCenario"
          :desabilitado="!d.editavel"
          data-testid="orc-prem-cenario"
        />
        <SanteBotao
          v-if="d.editavel"
          variante="secundario"
          :rotulo="t(`${T}.escolher`)"
          :desabilitado="enviando || cenarioEscolhido === (d.cenario?.id ?? null)"
          data-testid="orc-prem-aplicar-cenario"
          @acionar="aplicarCenario"
        />
      </div>
      <div v-if="d.projecao" data-testid="orc-prem-projecao">
        <h4>{{ t(`${T}.projecao`) }}</h4>
        <dl class="dados">
          <dt>{{ t(`${T}.receitaBase`) }}</dt>
          <dd>{{ reais(d.projecao.receitaBase) }}</dd>
          <dt>{{ t(`${T}.receitaProjetada`) }}</dt>
          <dd data-testid="orc-prem-receita-projetada">{{ reais(d.projecao.receitaProjetada) }}</dd>
          <dt>{{ t(`${T}.despesa`) }}</dt>
          <dd>{{ reais(d.projecao.despesa) }}</dd>
          <dt>{{ t(`${T}.consumo`) }}</dt>
          <dd>{{ reais(d.projecao.consumo) }}</dd>
          <dt>{{ t(`${T}.resultadoBase`) }}</dt>
          <dd>{{ reais(d.projecao.resultadoBase) }}</dd>
          <dt>{{ t(`${T}.resultadoProjetado`) }}</dt>
          <dd data-testid="orc-prem-resultado-projetado">{{ reais(d.projecao.resultadoProjetado) }}</dd>
        </dl>
        <p class="secundario" data-testid="orc-prem-conta">
          {{ t(`${T}.conta`, { conta: d.projecao.conta }) }}
        </p>
      </div>

      <h3>{{ t(`${T}.premissas`) }}</h3>
      <p v-if="!d.premissas.length" data-testid="orc-prem-nenhuma">{{ t(`${T}.nenhuma`) }}</p>
      <table v-else class="tabela" data-testid="orc-prem-lista">
        <thead>
          <tr>
            <th scope="col">{{ t(`${T}.colunas.sequencia`) }}</th>
            <th scope="col">{{ t(`${T}.colunas.tipo`) }}</th>
            <th scope="col">{{ t(`${T}.colunas.descricao`) }}</th>
            <th scope="col">{{ t(`${T}.colunas.valor`) }}</th>
            <th scope="col">{{ t(`${T}.colunas.justificativa`) }}</th>
            <th scope="col">{{ t(`${T}.colunas.alterado`) }}</th>
            <th v-if="d.editavel" scope="col">{{ t(`${T}.colunas.acoes`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in d.premissas" :key="p.id" :data-testid="`orc-prem-${p.sequencia}`">
            <td>{{ p.sequencia }}</td>
            <td>{{ t(`orcamentoEmpresarial.premissasCenarios.tipos.${p.tipo}`) }}</td>
            <td>{{ p.descricao }}</td>
            <td>{{ valorDa(p) }}</td>
            <td>{{ p.justificativa ?? '' }}</td>
            <td>{{ p.alteradoPor }} {{ p.alteradoEm ? dataHoraBr(p.alteradoEm) : '' }}</td>
            <td v-if="d.editavel">
              <div class="acoes">
                <SanteBotao
                  variante="texto"
                  :rotulo="t(`${T}.alterar`)"
                  :data-testid="`orc-prem-alterar-${p.sequencia}`"
                  @acionar="alterar(p)"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t(`${T}.retirar`)"
                  :desabilitado="enviando"
                  :data-testid="`orc-prem-retirar-${p.sequencia}`"
                  @acionar="retirar(p)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="d.editavel" class="bloco" data-testid="orc-prem-form" @submit.prevent="gravarPremissa">
        <h4>{{ editando ? t(`${T}.editando`, { numero: editando.sequencia }) : t(`${T}.nova`) }}</h4>
        <SanteSelecao
          v-model="tipo"
          :rotulo="t(`${T}.tipo`)"
          :opcoes="opcoesTipo"
          obrigatorio
          data-testid="orc-prem-tipo"
        />
        <SanteCampoTexto
          v-model="descricao"
          :rotulo="t(`${T}.descricao`)"
          :max-bytes="150"
          obrigatorio
          data-testid="orc-prem-descricao"
        />
        <span v-if="falhaDe('descricao')" class="secundario" role="alert">{{ falhaDe('descricao') }}</span>
        <label>
          {{ t(`${T}.percentual`) }}
          <input
            v-model="percentual"
            inputmode="decimal"
            maxlength="9"
            :aria-invalid="falhaDe('percentual') !== null || Number.isNaN(percentualC)"
            data-testid="orc-prem-percentual"
          />
        </label>
        <span v-if="Number.isNaN(percentualC)" class="secundario" role="alert">{{
          t(`${T}.numeroInvalido`)
        }}</span>
        <span
          v-else-if="falhaDe('percentual')"
          class="secundario"
          role="alert"
          data-testid="orc-prem-percentual-erro"
          >{{ falhaDe('percentual') }}</span
        >
        <template v-if="tipo === 'volume' || tipo === 'outro'">
          <label>
            {{ t(`${T}.valorNumerico`) }}
            <input
              v-model="valorNumerico"
              inputmode="decimal"
              maxlength="18"
              :aria-invalid="falhaDe('valorNumerico') !== null || Number.isNaN(numero)"
              data-testid="orc-prem-valor"
            />
          </label>
          <span v-if="Number.isNaN(numero)" class="secundario" role="alert">{{
            t(`${T}.numeroInvalido`)
          }}</span>
          <span v-else-if="falhaDe('valorNumerico')" class="secundario" role="alert">{{
            falhaDe('valorNumerico')
          }}</span>
          <SanteCampoTexto
            v-model="unidade"
            :rotulo="t(`${T}.unidade`)"
            :max-bytes="20"
            :obrigatorio="tipo === 'volume'"
            data-testid="orc-prem-unidade"
          />
          <span v-if="falhaDe('unidade')" class="secundario" role="alert">{{ falhaDe('unidade') }}</span>
          <SanteCampoTexto
            v-model="valorTexto"
            :rotulo="t(`${T}.valorTexto`)"
            :max-bytes="100"
            data-testid="orc-prem-valor-texto"
          />
          <span v-if="falhaDe('valorTexto')" class="secundario" role="alert">{{
            falhaDe('valorTexto')
          }}</span>
        </template>
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t(`${T}.justificativa`)"
          :max-bytes="2000"
          multilinha
          data-testid="orc-prem-justificativa"
        />
        <span class="secundario">{{ t(`${T}.justificativaAjuda`) }}</span>
        <span
          v-if="falhaDe('justificativa')"
          class="secundario"
          role="alert"
          data-testid="orc-prem-justificativa-erro"
          >{{ falhaDe('justificativa') }}</span
        >
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            variante="primario"
            :rotulo="editando ? t(`${T}.gravarAlteracao`) : t(`${T}.incluir`)"
            :desabilitado="enviando || (tocado && (falhas.length > 0 || numerosInvalidos))"
            data-testid="orc-prem-gravar"
          />
          <SanteBotao
            v-if="editando"
            variante="secundario"
            :rotulo="t(`${T}.cancelar`)"
            data-testid="orc-prem-cancelar"
            @acionar="limpar"
          />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
