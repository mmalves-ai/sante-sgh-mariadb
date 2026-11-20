<script setup lang="ts">
// Aba Períodos (M54.2; regra 3): os períodos com movimento (situação, lançamentos, débitos e créditos) e a situação de
// uma competência: o total com as parcelas por tipo de lançamento, os fatos por situação e o que impede o
// encerramento, com o caminho para resolver. Encerrar (`contabil.periodo.encerrar`) e reabrir o último encerrado
// (`contabil.periodo.reabrir`, com justificativa) são críticos: a senha de novo. O servidor confere os impedimentos de
// novo na mesma transação.
import {
  type ApoioLancamentos,
  type ImpedimentoEncerramento,
  SITUACOES_FATO,
  type SituacaoFato,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import ErroContabil from './ErroContabil.vue';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import { encerrarPeriodo, lerPeriodos, lerSituacaoPeriodo, reabrirPeriodo } from './api-lancamentos.js';
import { instante, reais, rotuloCompetencia } from './comum-contabil.js';

const props = defineProps<{ apoio: ApoioLancamentos; empresa: number }>();
const emit = defineEmits<{ lancamentos: [competencia: string]; fatos: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const periodos = useQuery({
  queryKey: computed(() => ['contabil', 'periodos', props.empresa]),
  queryFn: () => lerPeriodos(props.empresa),
});
const ps = computed(() => periodos.data.value ?? null);
const competencia = ref<string | null>(null);
watch(
  () => props.empresa,
  () => {
    competencia.value = null;
  },
);
const situacao = useQuery({
  queryKey: computed(() => ['contabil', 'periodo', props.empresa, competencia.value]),
  queryFn: () => lerSituacaoPeriodo(props.empresa, competencia.value!),
  enabled: computed(() => competencia.value !== null),
});
const s = computed(() => (competencia.value ? (situacao.data.value ?? null) : null));
const fatosComValor = computed(() =>
  (Object.keys(SITUACOES_FATO) as SituacaoFato[])
    .map((x) => ({ situacao: x, n: s.value?.fatos[x] ?? 0 }))
    .filter((x) => x.n > 0),
);
const parcelasTexto = computed(() =>
  (s.value?.parcelas ?? [])
    .map((p) => `${t(`contabil.lancamentos.tipos.${p.tipo}`)} ${reais(p.debitosCentavos)}`)
    .join(' + '),
);

const caminho = (i: ImpedimentoEncerramento) =>
  i.codigo === 'fatos-sem-regra'
    ? { para: '/contabil/plano', rotulo: t('contabil.periodos.irParaRegras') }
    : i.codigo === 'fatos-sem-conta'
      ? { para: '/financeiro/contabil/exportacao', rotulo: t('contabil.periodos.irParaIntegracao') }
      : null;

const observacao = ref('');
const justificativa = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const mensagem = ref<string | null>(null);
async function agir(acao: 'encerrar' | 'reabrir') {
  if (!competencia.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r =
      acao === 'encerrar'
        ? await encerrarPeriodo({
            empresa: props.empresa,
            competencia: competencia.value,
            observacao: observacao.value.trim() || null,
            senha: senha.value,
          })
        : await reabrirPeriodo({
            empresa: props.empresa,
            competencia: competencia.value,
            justificativa: justificativa.value.trim(),
            senha: senha.value,
          });
    mensagem.value = r.mensagem;
    observacao.value = '';
    justificativa.value = '';
    await cliente.invalidateQueries({ queryKey: ['contabil'] });
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="periodos-titulo" data-testid="aba-periodos">
    <h2 id="periodos-titulo">{{ t('contabil.periodos.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.periodos.ajuda') }}</p>
    <p v-if="mensagem" role="status" data-testid="periodo-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="periodos.isError.value" :erro="periodos.error.value" />
    <p v-else-if="!ps" role="status">{{ t('contabil.carregando') }}</p>
    <p v-else-if="ps.itens.length === 0" data-testid="periodos-vazio">{{ t('contabil.periodos.nenhum') }}</p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-periodos">
        <thead>
          <tr>
            <th scope="col">{{ t('contabil.competencia') }}</th>
            <th scope="col">{{ t('contabil.periodos.situacao') }}</th>
            <th scope="col">{{ t('contabil.periodos.lancamentosN') }}</th>
            <th scope="col">{{ t('contabil.lancamentos.debitos') }}</th>
            <th scope="col">{{ t('contabil.lancamentos.creditos') }}</th>
            <th scope="col">{{ t('contabil.periodos.encerradoPor') }}</th>
            <th scope="col">{{ t('contabil.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in ps.itens" :key="x.competencia" :data-testid="`periodo-${x.competencia}`">
            <td>{{ rotuloCompetencia(x.competencia) }}</td>
            <td>{{ t(`contabil.periodos.situacoes.${x.situacao}`) }}</td>
            <td>{{ x.lancamentos }}</td>
            <td>{{ reais(x.debitosCentavos) }}</td>
            <td>{{ reais(x.creditosCentavos) }}</td>
            <td>{{ x.encerradoPor ? `${x.encerradoPor} (${instante(x.encerradoEm)})` : '—' }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('contabil.periodos.abrir')"
                :data-testid="`periodo-abrir-${x.competencia}`"
                @acionar="
                  competencia = x.competencia;
                  mensagem = null;
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <MensagemErro v-if="competencia && situacao.isError.value" :erro="situacao.error.value" />
    <section v-if="s" class="bloco" aria-labelledby="periodo-situacao-titulo" data-testid="periodo-situacao">
      <h3 id="periodo-situacao-titulo">
        {{ t('contabil.periodos.situacaoTitulo', { competencia: rotuloCompetencia(s.competencia) }) }}:
        {{ t(`contabil.periodos.situacoes.${s.situacao}`) }}
      </h3>
      <h4>{{ t('contabil.periodos.parcelas') }}</h4>
      <div class="rolagem">
        <table class="tabela" data-testid="tabela-parcelas">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.lancamentos.tipo') }}</th>
              <th scope="col">{{ t('contabil.periodos.lancamentosN') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.debitos') }}</th>
              <th scope="col">{{ t('contabil.lancamentos.creditos') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in s.parcelas" :key="p.tipo" :data-testid="`parcela-${p.tipo}`">
              <td>{{ t(`contabil.lancamentos.tipos.${p.tipo}`) }}</td>
              <td>{{ p.lancamentos }}</td>
              <td>{{ reais(p.debitosCentavos) }}</td>
              <td>{{ reais(p.creditosCentavos) }}</td>
            </tr>
            <tr data-testid="parcela-total">
              <th scope="row">{{ t('contabil.periodos.total') }}</th>
              <td>{{ s.lancamentos }}</td>
              <td>{{ reais(s.debitosCentavos) }}</td>
              <td>{{ reais(s.creditosCentavos) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="parcelasTexto" class="secundario" data-testid="periodo-parcelas-texto">
        {{ t('contabil.lancamentos.debitos') }}: {{ parcelasTexto }} = {{ reais(s.debitosCentavos) }}
      </p>
      <h4>{{ t('contabil.periodos.fatos') }}</h4>
      <p data-testid="periodo-fatos">
        <span v-for="x in fatosComValor" :key="x.situacao" class="marca">
          {{ t(`contabil.situacoesFato.${x.situacao}`) }}: {{ x.n }}
        </span>
        <span v-if="fatosComValor.length === 0">{{ t('contabil.nenhum') }}</span>
      </p>
      <h4>{{ t('contabil.periodos.impedimentos') }}</h4>
      <p v-if="s.impedimentos.length === 0" data-testid="periodo-sem-impedimento">
        {{ t('contabil.periodos.semImpedimento') }}
      </p>
      <ul v-else data-testid="periodo-impedimentos">
        <li v-for="i in s.impedimentos" :key="i.codigo" :data-testid="`impedimento-${i.codigo}`">
          {{ i.mensagem }}
          <RouterLink v-if="caminho(i)" :to="caminho(i)!.para">{{ caminho(i)!.rotulo }}</RouterLink>
          <SanteBotao
            v-else-if="i.codigo === 'fatos-pendentes' && apoio.podeVerFatos"
            variante="texto"
            :rotulo="t('contabil.periodos.irParaFatos')"
            @acionar="emit('fatos')"
          />
        </li>
      </ul>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.abas.lancamentos')"
          data-testid="periodo-ver-lancamentos"
          @acionar="emit('lancamentos', s.competencia)"
        />
      </div>

      <section
        v-if="apoio.podeEncerrar && s.podeEncerrar"
        class="bloco"
        aria-labelledby="encerrar-titulo"
        data-testid="periodo-encerrar"
      >
        <h4 id="encerrar-titulo">{{ t('contabil.periodos.encerrar') }}</h4>
        <p class="secundario">{{ t('contabil.periodos.encerrarAjuda') }}</p>
        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('contabil.periodos.observacao')"
          :max-bytes="300"
          data-testid="encerrar-observacao"
        />
        <SenhaConfirmacao v-model="senha" testid="encerrar-senha" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.periodos.encerrar')"
            :desabilitado="ocupado || !senha"
            data-testid="encerrar-confirmar"
            @acionar="agir('encerrar')"
          />
        </div>
      </section>
      <p v-if="s.situacao === 'encerrado' && !s.podeReabrir && s.motivoNaoReabre" class="secundario">
        {{ t('contabil.periodos.naoReabre', { motivo: s.motivoNaoReabre }) }}
      </p>
      <section
        v-if="apoio.podeReabrir && s.podeReabrir"
        class="bloco"
        aria-labelledby="reabrir-titulo"
        data-testid="periodo-reabrir"
      >
        <h4 id="reabrir-titulo">{{ t('contabil.periodos.reabrir') }}</h4>
        <p class="secundario">{{ t('contabil.periodos.reabrirAjuda') }}</p>
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t('contabil.justificativa')"
          :max-bytes="300"
          multilinha
          obrigatorio
          data-testid="reabrir-justificativa"
        />
        <SenhaConfirmacao v-model="senha" testid="reabrir-senha" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.periodos.reabrir')"
            :desabilitado="ocupado || !senha || justificativa.trim().length < 10"
            data-testid="reabrir-confirmar"
            @acionar="agir('reabrir')"
          />
        </div>
      </section>
      <ErroContabil v-if="erro" :erro="erro" />
    </section>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
