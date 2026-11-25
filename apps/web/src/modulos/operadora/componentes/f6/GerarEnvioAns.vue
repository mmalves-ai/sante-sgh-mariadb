<script setup lang="ts">
// Novo arquivo para a ANS (M56, etapa 7, F6; `operadora.ans.ler` vê a prévia, `operadora.ans.gerar` grava): a operadora,
// a obrigação e a competência (sugerida: o último período encerrado), o balancete do DIOPS e os descontos da TPS; a
// prévia mostra os registros, os quadros com as parcelas e as pendências (o que impede o arquivo e o que fica fora dele)
// sem gravar; gerar grava o arquivo com o SHA-256 (o servidor confere tudo de novo). A prévia vale para os dados vistos:
// mudar um campo pede outra prévia antes de gerar.
import { type ApoioAns, type ObrigacaoAns, type PreviaEnvioAns } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { gerarEnvioAns, previaEnvioAns, type ResultadoAns } from '../../api-ans.js';
import { dataBr, hoje, numeroDe } from '../f1/comum.js';
import { reais } from '../f2/comum.js';
import { competenciaNoFormato, competenciaSugerida } from './comum.js';
import QuadrosAns from './QuadrosAns.vue';

const props = defineProps<{ apoio: ApoioAns; operadora: number | null; podeGerar: boolean }>();
const emit = defineEmits<{ gravado: [r: ResultadoAns]; cancelar: [] }>();
const { t } = useI18n();

const obrigacoes = computed(() => props.apoio.obrigacoes.filter((o) => o.codigo !== 'RESSARCIMENTO_SUS'));
const operadora = ref<number | null>(props.operadora ?? props.apoio.operadoras[0]?.id ?? null);
const obrigacao = ref<ObrigacaoAns>(obrigacoes.value[0]?.codigo ?? 'SIB');
const competencia = ref(competenciaSugerida(obrigacao.value, hoje()));
watch(obrigacao, (o) => {
  competencia.value = competenciaSugerida(o, hoje());
});
const periodicidade = computed(
  () => obrigacoes.value.find((o) => o.codigo === obrigacao.value)?.periodicidade ?? 'mensal',
);
const formatoOk = computed(() => competenciaNoFormato(obrigacao.value, competencia.value.trim()));

// ── DIOPS: o balancete ──────────────────────────────────────────────────────────────────────────
const ativo = ref('');
const passivo = ref('');
const pl = ref('');
const provisoes = ref('');
const responsavel = ref('');
const balanco = computed(() => {
  const a = numeroDe(ativo.value);
  const p = numeroDe(passivo.value);
  const l = numeroDe(pl.value);
  if (a === null || p === null || l === null) return null;
  return { a, soma: Math.round((p + l) * 100) / 100, ok: Math.round(a * 100) === Math.round((p + l) * 100) };
});
const balanceteOk = computed(
  () =>
    obrigacao.value !== 'DIOPS' ||
    (balanco.value?.ok === true &&
      numeroDe(provisoes.value) !== null &&
      responsavel.value.trim().length >= 3),
);

// ── TPS: os descontos por plano ─────────────────────────────────────────────────────────────────
interface Desconto {
  plano: string;
  percentual: string;
  motivo: string;
}
const descontos = ref<Desconto[]>([]);
const descontosOk = computed(() =>
  descontos.value.every((d) => {
    const pl = Number(d.plano);
    const pc = numeroDe(d.percentual);
    return (
      Number.isInteger(pl) && pl > 0 && pc !== null && pc >= 0 && pc <= 100 && d.motivo.trim().length >= 3
    );
  }),
);

const corpo = computed(() => ({
  operadora: operadora.value,
  obrigacao: obrigacao.value,
  competencia: competencia.value.trim(),
  ...(obrigacao.value === 'DIOPS'
    ? {
        balancete: {
          ativo: numeroDe(ativo.value) ?? 0,
          passivo: numeroDe(passivo.value) ?? 0,
          patrimonioLiquido: numeroDe(pl.value) ?? 0,
          provisoesTecnicas: numeroDe(provisoes.value) ?? 0,
          responsavel: responsavel.value,
        },
      }
    : {}),
  ...(obrigacao.value === 'TPS' && descontos.value.length
    ? {
        descontos: descontos.value.map((d) => ({
          produto: Number(d.plano),
          percentual: numeroDe(d.percentual) ?? 0,
          motivo: d.motivo,
        })),
      }
    : {}),
}));
const completo = computed(
  () => operadora.value !== null && formatoOk.value && balanceteOk.value && descontosOk.value,
);

// ── Prévia e geração ────────────────────────────────────────────────────────────────────────────
const previa = ref<PreviaEnvioAns | null>(null);
const vista = ref('');
watch(corpo, (c) => {
  if (JSON.stringify(c) !== vista.value) previa.value = null;
});
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const problemasArquivo = computed(() => previa.value?.problemas.filter((p) => p.alcance === 'arquivo') ?? []);
const problemasItem = computed(() => previa.value?.problemas.filter((p) => p.alcance === 'item') ?? []);

async function executar(fn: () => Promise<void>): Promise<void> {
  recusa.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409, 422].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const verPrevia = () =>
  executar(async () => {
    if (!completo.value) return;
    const c = corpo.value;
    previa.value = await previaEnvioAns(c);
    vista.value = JSON.stringify(c);
  });
const gerar = () =>
  executar(async () => {
    if (!previa.value?.podeGerar || !props.podeGerar) return;
    emit('gravado', await gerarEnvioAns(corpo.value));
  });

const opcoesOperadora = computed(() =>
  props.apoio.operadoras.map((o) => ({
    valor: o.id as number | null,
    rotulo: `${o.nome} · ${o.registroAns}`,
  })),
);
const opcoesObrigacao = computed(() =>
  obrigacoes.value.map((o) => ({
    valor: o.codigo,
    rotulo: `${o.rotulo} · ${t(`operadoraAns.periodicidades.${o.periodicidade}`)}`,
  })),
);
</script>

<template>
  <section class="bloco" aria-labelledby="ans-gerar-titulo" data-testid="ans-gerar">
    <div class="acoes cabeca">
      <h2 id="ans-gerar-titulo">{{ t('operadoraAns.geracao.titulo') }}</h2>
      <SanteBotao variante="texto" :rotulo="t('operadoraAns.acoes.fechar')" @acionar="emit('cancelar')" />
    </div>
    <form class="campos" @submit.prevent="verPrevia">
      <SanteSelecao
        v-model="operadora"
        :rotulo="t('operadoraAns.geracao.operadora')"
        :opcoes="opcoesOperadora"
        :busca="true"
        obrigatorio
        data-testid="ans-gerar-operadora"
      />
      <SanteSelecao
        v-model="obrigacao"
        :rotulo="t('operadoraAns.geracao.obrigacao')"
        :opcoes="opcoesObrigacao"
        obrigatorio
        data-testid="ans-gerar-obrigacao"
      />
      <div>
        <SanteCampoTexto
          id="ans-gerar-competencia"
          v-model="competencia"
          :rotulo="t('operadoraAns.geracao.competencia')"
          :max-bytes="10"
          obrigatorio
        />
        <p class="secundario">{{ t(`operadoraAns.formatos.${periodicidade}`) }}</p>
        <p v-if="competencia.trim() && !formatoOk" class="erro" role="alert" data-testid="ans-gerar-formato">
          {{ t('operadoraAns.geracao.formatoInvalido') }}
        </p>
      </div>
    </form>

    <fieldset v-if="obrigacao === 'DIOPS'" class="bloco" data-testid="ans-gerar-balancete">
      <legend>{{ t('operadoraAns.geracao.balancete.titulo') }}</legend>
      <p class="secundario">{{ t('operadoraAns.geracao.balancete.texto') }}</p>
      <div class="campos">
        <SanteCampoTexto
          id="ans-bal-ativo"
          v-model="ativo"
          :rotulo="t('operadoraAns.geracao.balancete.ativo')"
          :max-bytes="20"
        />
        <SanteCampoTexto
          id="ans-bal-passivo"
          v-model="passivo"
          :rotulo="t('operadoraAns.geracao.balancete.passivo')"
          :max-bytes="20"
        />
        <SanteCampoTexto
          id="ans-bal-pl"
          v-model="pl"
          :rotulo="t('operadoraAns.geracao.balancete.patrimonioLiquido')"
          :max-bytes="20"
        />
        <SanteCampoTexto
          id="ans-bal-provisoes"
          v-model="provisoes"
          :rotulo="t('operadoraAns.geracao.balancete.provisoesTecnicas')"
          :max-bytes="20"
        />
        <SanteCampoTexto
          id="ans-bal-responsavel"
          v-model="responsavel"
          :rotulo="t('operadoraAns.geracao.balancete.responsavel')"
          :max-bytes="120"
        />
      </div>
      <p v-if="balanco" :class="balanco.ok ? 'secundario' : 'erro'" data-testid="ans-bal-conferencia">
        {{
          t('operadoraAns.geracao.balancete.conferencia', {
            soma: reais(balanco.soma),
            ativo: reais(balanco.a),
          })
        }}
        <template v-if="!balanco.ok"> {{ t('operadoraAns.geracao.balancete.desequilibrado') }}</template>
      </p>
    </fieldset>

    <fieldset v-if="obrigacao === 'TPS'" class="bloco" data-testid="ans-gerar-tps">
      <legend>{{ t('operadoraAns.geracao.descontos.titulo') }}</legend>
      <p class="secundario">{{ t('operadoraAns.geracao.descontos.texto') }}</p>
      <p class="secundario">{{ t('operadoraAns.geracao.valoresTps') }}</p>
      <ul class="secundario" data-testid="ans-gerar-valores-tps">
        <li v-for="v in apoio.valoresTps" :key="v.vigencia">
          {{
            t('operadoraAns.geracao.vigencia', {
              data: dataBr(v.vigencia),
              trimestral: reais(v.valorTrimestral),
              anual: reais(v.valorAnual),
            })
          }}
        </li>
      </ul>
      <div v-for="(d, i) in descontos" :key="i" class="campos" :data-testid="`ans-desconto-${i}`">
        <SanteCampoTexto
          :id="`ans-desc-plano-${i}`"
          v-model="d.plano"
          :rotulo="t('operadoraAns.geracao.descontos.plano')"
          :max-bytes="10"
        />
        <SanteCampoTexto
          :id="`ans-desc-pc-${i}`"
          v-model="d.percentual"
          :rotulo="t('operadoraAns.geracao.descontos.percentual')"
          :max-bytes="6"
        />
        <SanteCampoTexto
          :id="`ans-desc-motivo-${i}`"
          v-model="d.motivo"
          :rotulo="t('operadoraAns.geracao.descontos.motivo')"
          :max-bytes="200"
        />
        <SanteBotao
          variante="texto"
          :rotulo="t('operadoraAns.geracao.descontos.remover', { plano: d.plano || i + 1 })"
          @acionar="descontos.splice(i, 1)"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAns.geracao.descontos.incluir')"
          data-testid="ans-desconto-incluir"
          @acionar="descontos.push({ plano: '', percentual: '', motivo: '' })"
        />
      </div>
    </fieldset>

    <div class="acoes">
      <SanteBotao
        :rotulo="t('operadoraAns.geracao.previa')"
        :desabilitado="!completo || ocupado"
        variante="secundario"
        data-testid="ans-previa"
        @acionar="verPrevia"
      />
      <SanteBotao
        v-if="podeGerar"
        :rotulo="t('operadoraAns.geracao.gerar')"
        :desabilitado="!previa?.podeGerar || ocupado"
        data-testid="ans-gerar-confirmar"
        @acionar="gerar"
      />
    </div>
    <p v-if="!podeGerar" class="secundario">{{ t('operadoraAns.geracao.semPermissao') }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="ans-gerar-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />

    <section
      v-if="previa"
      class="bloco"
      aria-labelledby="ans-previa-titulo"
      data-testid="ans-previa-resultado"
    >
      <h3 id="ans-previa-titulo">{{ t('operadoraAns.geracao.registros', { n: previa.registros }) }}</h3>
      <QuadrosAns :quadros="previa.quadros" prefixo="ans-previa" />
      <p v-if="previa.problemas.length === 0" data-testid="ans-previa-sem-problemas">
        {{ t('operadoraAns.geracao.semProblemas') }}
      </p>
      <template v-else>
        <h4>{{ t('operadoraAns.geracao.problemas') }}</h4>
        <ul data-testid="ans-previa-problemas">
          <li v-for="(p, i) in problemasArquivo" :key="`a${i}`" data-alcance="arquivo">
            <strong>{{ t('operadoraAns.geracao.problemaArquivo') }}:</strong> {{ p.mensagem }}
            <span v-if="p.referencia" class="secundario"> · {{ p.referencia }}</span>
          </li>
          <li v-for="(p, i) in problemasItem" :key="`i${i}`" data-alcance="item">
            {{ t('operadoraAns.geracao.problemaItem') }}: {{ p.mensagem }}
            <span v-if="p.referencia" class="secundario"> · {{ p.referencia }}</span>
          </li>
        </ul>
      </template>
      <SanteAlerta v-if="!previa.podeGerar" :texto="t('operadoraAns.geracao.naoGera')" variante="aviso" />
    </section>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.cabeca {
  justify-content: space-between;
}
.erro {
  color: var(--sgh-alerta);
}
fieldset {
  margin: 0;
}
</style>
