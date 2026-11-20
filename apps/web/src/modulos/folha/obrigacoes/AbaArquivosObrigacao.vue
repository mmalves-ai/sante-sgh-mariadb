<script setup lang="ts">
// Aba "SEFIP, CAGED e RAIS" (M53.8, etapa F7; consulta com `pessoas.obrigacao.ler`; prévia e geração com
// `pessoas.obrigacao.gerar`; ficha do M53, seção 7, regras 3 e 7; DP-47): a obrigação e o período (competência ou
// ano-base), o regime em vigor nos parâmetros (exigida de/até, leiaute e se ele foi conferido), a prévia com os totais,
// a prova da soma, as pendências e os avisos, e a geração do arquivo para o programa oficial. As obrigações em vigor
// do período aparecem com o arquivo, a entrega e o cancelamento. O servidor confere tudo de novo.
import {
  type ApoioObrigacoes,
  type ObrigacaoLegal,
  type ResultadoGeracaoObrigacao,
  type TipoObrigacao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFolha from '../telas/ErroFolha.vue';
import { gerarObrigacao, lerObrigacoes, lerParametrosObrigacoes } from './api-obrigacoes.js';
import {
  anual,
  periodosDoTipo,
  periodoSugeridoObrigacao,
  regimeNoPeriodo,
  rotuloPeriodoObrigacao,
  TIPOS_ARQUIVO,
  vigenciaNoPeriodo,
} from './comum-obrigacoes.js';
import ObrigacaoGerada from './ObrigacaoGerada.vue';
import ResumoObrigacao from './ResumoObrigacao.vue';

const props = defineProps<{ apoio: ApoioObrigacoes; empresa: number; pode: boolean; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const B = 'folha.obrigacoes.recusa';

const tipo = ref<TipoObrigacao>('sefip');
const opcoesTipo = TIPOS_ARQUIVO.map((x) => ({ valor: x, rotulo: t(`folha.obrigacoes.tipos.${x}`) }));
const params = useQuery({
  queryKey: computed(() => ['folha', 'obrigacoes', 'parametros', props.empresa]),
  queryFn: () => lerParametrosObrigacoes(props.empresa),
});
const vigencias = computed(() => params.data.value?.itens ?? []);
const sugestao = { competencia: props.apoio.competenciaSugerida, ano: props.apoio.anoSugerido };
/** O regime do tipo na vigência mais recente (para sugerir o último período exigido). */
const regimeAtual = computed(() => {
  const v = [...vigencias.value].sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
  return v ? v.regimes[tipo.value] : null;
});
const periodo = ref(periodoSugeridoObrigacao('sefip', sugestao, null));
watch([tipo, regimeAtual], () => {
  periodo.value = periodoSugeridoObrigacao(tipo.value, sugestao, regimeAtual.value);
  limpar();
});
const opcoesPeriodo = computed(() =>
  periodosDoTipo(tipo.value, props.hoje).map((p) => ({
    valor: p,
    rotulo: rotuloPeriodoObrigacao(tipo.value, p),
  })),
);
const regime = computed(() => regimeNoPeriodo(vigencias.value, props.empresa, tipo.value, periodo.value));
const leiauteDoPeriodo = computed(() =>
  vigenciaNoPeriodo(vigencias.value, props.empresa, tipo.value, periodo.value),
);
const textoLimite = (s: string | null, fim: boolean) =>
  s ? s : fim ? t('folha.obrigacoes.arquivos.semFim') : t('folha.obrigacoes.arquivos.desdeSempre');
const recolhimento = ref<string | null>(null);

// As obrigações em vigor do período (geradas ou entregues).
const ano = computed(() => periodo.value.slice(0, 4));
const lista = useQuery({
  queryKey: computed(() => ['folha', 'obrigacoes', 'lista', props.empresa, tipo.value, ano.value]),
  queryFn: () => lerObrigacoes({ empresa: props.empresa, tipo: tipo.value, ano: ano.value }),
});
const doPeriodo = computed<ObrigacaoLegal[]>(() =>
  (lista.data.value?.itens ?? []).filter(
    (o) => o.periodo === periodo.value && (o.situacao === 'gerada' || o.situacao === 'entregue'),
  ),
);

// ── Prévia e geração ──────────────────────────────────────────────────────────────────────────────────────────
const resultado = ref<ResultadoGeracaoObrigacao | null>(null);
const visivel = ref(false);
const erro = ref<unknown>(null);
const erroResultado = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
function limpar(): void {
  resultado.value = null;
  erro.value = null;
  aviso.value = null;
}
const entrada = (simular: boolean) => ({
  empresa: props.empresa,
  tipo: tipo.value,
  periodo: periodo.value,
  simular,
  recolhimento: tipo.value === 'sefip' ? recolhimento.value : null,
});
async function previa(): Promise<void> {
  limpar();
  ocupado.value = true;
  try {
    resultado.value = await gerarObrigacao(entrada(true));
    erroResultado.value = null;
    visivel.value = true;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const podeGerar = computed(
  () => props.pode && !!resultado.value && !resultado.value.gerado && resultado.value.pendencias.length === 0,
);
async function gerar(): Promise<void> {
  erroResultado.value = null;
  ocupado.value = true;
  try {
    const r = await gerarObrigacao(entrada(false));
    resultado.value = r;
    aviso.value =
      r.gerado && r.obrigacao
        ? t('folha.obrigacoes.gerada', {
            tipo: t(`folha.obrigacoes.tipos.${tipo.value}`),
            periodo: rotuloPeriodoObrigacao(tipo.value, periodo.value),
            n: r.obrigacao.numero,
          })
        : t('folha.obrigacoes.nadaGerado');
    if (r.gerado) visivel.value = false;
    await cliente.invalidateQueries({ queryKey: ['folha', 'obrigacoes'] });
  } catch (e) {
    erroResultado.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function mudou(_o: ObrigacaoLegal, texto: string): Promise<void> {
  aviso.value = texto;
  await cliente.invalidateQueries({ queryKey: ['folha', 'obrigacoes'] });
}
</script>

<template>
  <section
    class="bloco"
    :aria-label="t('folha.obrigacoes.arquivos.titulo')"
    data-testid="obrigacoes-arquivos"
  >
    <h2>{{ t('folha.obrigacoes.arquivos.titulo') }}</h2>
    <p class="secundario">{{ t('folha.obrigacoes.arquivos.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="obrigacoes-arquivos-aviso"
    />
    <ErroFolha v-if="erro" :erro="erro" :base="B" />
    <div class="campos">
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('folha.obrigacoes.tipo')"
        :opcoes="opcoesTipo"
        data-testid="obrigacoes-arquivos-tipo"
      />
      <SanteSelecao
        :model-value="periodo"
        :rotulo="anual(tipo) ? t('folha.obrigacoes.anoBase') : t('folha.obrigacoes.competencia')"
        :opcoes="opcoesPeriodo"
        busca
        data-testid="obrigacoes-arquivos-periodo"
        @update:model-value="
          (p: string) => {
            periodo = p;
            limpar();
          }
        "
      />
      <SanteData
        v-if="tipo === 'sefip'"
        v-model="recolhimento"
        :rotulo="t('folha.obrigacoes.arquivos.recolhimento')"
        editavel
        data-testid="obrigacoes-arquivos-recolhimento"
      />
    </div>
    <p v-if="tipo === 'sefip'" class="secundario">{{ t('folha.obrigacoes.arquivos.recolhimentoAjuda') }}</p>
    <ErroFolha v-if="params.isError.value" :erro="params.error.value" :base="B" />
    <p v-else-if="params.data.value" data-testid="obrigacoes-arquivos-regime">
      <template v-if="regime && leiauteDoPeriodo">
        {{
          t('folha.obrigacoes.arquivos.regime', {
            de: textoLimite(regime.regime.exigidaDe, false),
            ate: textoLimite(regime.regime.exigidaAte, true),
          })
        }}
        · {{ t('folha.obrigacoes.leiaute') }}: {{ regime.regime.leiaute }} ·
        <strong>{{
          regime.regime.leiauteConferido
            ? t('folha.obrigacoes.leiauteConferido')
            : t('folha.obrigacoes.leiauteNaoConferido')
        }}</strong>
      </template>
      <template v-else>{{ t('folha.obrigacoes.arquivos.regimeSemParametros') }}</template>
    </p>
    <div v-if="pode" class="acoes">
      <SanteBotao
        :rotulo="t('folha.obrigacoes.previa')"
        :desabilitado="ocupado"
        data-testid="obrigacoes-arquivos-previa"
        @acionar="previa"
      />
    </div>
    <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" :base="B" />
    <ObrigacaoGerada
      v-for="o in doPeriodo"
      :key="`${o.id}-${o.versao}`"
      :obrigacao="o"
      :pode="pode"
      :hoje="hoje"
      @mudou="mudou"
    />

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="resultado?.gerado ? t('folha.obrigacoes.geradaTitulo') : t('folha.obrigacoes.previaTitulo')"
      largura="48rem"
    >
      <div v-if="resultado" data-testid="obrigacoes-arquivos-resultado">
        <p class="secundario">
          {{ t(`folha.obrigacoes.tipos.${tipo}`) }} · {{ rotuloPeriodoObrigacao(tipo, periodo) }}
          <template v-if="resultado.nomeArquivo">
            · {{ resultado.nomeArquivo }} ·
            {{ t('folha.obrigacoes.tamanho', { n: resultado.tamanho }) }}</template
          >
        </p>
        <ErroFolha v-if="erroResultado" :erro="erroResultado" :base="B" />
        <ResumoObrigacao
          :tipo="tipo"
          :totais="resultado.totais"
          :trabalhadores="resultado.trabalhadores"
          :conferencia="resultado.conferencia"
          :pendencias="resultado.pendencias"
          :avisos="resultado.avisos"
          prefixo="obrigacoes-arquivos-previa"
        />
        <div class="acoes">
          <SanteBotao
            v-if="podeGerar"
            :rotulo="t('folha.obrigacoes.gerar')"
            :desabilitado="ocupado"
            data-testid="obrigacoes-arquivos-gerar"
            @acionar="gerar"
          />
          <SanteBotao
            :rotulo="t('folha.obrigacoes.fechar')"
            variante="secundario"
            data-testid="obrigacoes-arquivos-resultado-fechar"
            @acionar="visivel = false"
          />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
