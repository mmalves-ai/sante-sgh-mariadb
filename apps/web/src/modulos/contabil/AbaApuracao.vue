<script setup lang="ts">
// Aba Apuração do resultado (M54.3): a prévia do encerramento do exercício (receitas, custos, despesas e o resultado,
// com a conferência e o número de partidas), os impedimentos com o motivo e, para quem pode encerrar
// (`contabil.periodo.encerrar`), apurar: um lançamento em 31/12 que zera as contas de resultado contra a conta do
// patrimônio líquido escolhida. Operação crítica: a senha de novo. Refazer = estornar a apuração (na tela dos
// lançamentos) e apurar de novo.
import type { ApoioDemonstracoes } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import ErroContabil from './ErroContabil.vue';
import { apurarResultado, lerPreviaApuracao } from './api-demonstracoes.js';
import { dataBr, reais } from './comum-contabil.js';
import { exerciciosAte } from './comum-demonstracoes.js';

const props = defineProps<{ apoio: ApoioDemonstracoes; empresa: number; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();

const exercicio = ref<number | null>(Number(props.hoje.slice(0, 4)) - 1);
const exercicios = computed(() =>
  exerciciosAte(props.hoje).map((a) => ({ valor: a as number | null, rotulo: String(a) })),
);
const previa = useQuery({
  queryKey: computed(() => ['contabil', 'apuracao', props.empresa, exercicio.value]),
  queryFn: () => lerPreviaApuracao(props.empresa, exercicio.value!),
  enabled: computed(() => exercicio.value !== null),
});
const p = computed(() => previa.data.value ?? null);
const destino = ref<string | null>(null);
watch(p, (x) => {
  if (x && !x.contasDestino.some((c) => c.codigo === destino.value))
    destino.value = x.contasDestino.length === 1 ? x.contasDestino[0]!.codigo : null;
});
const opcoesDestino = computed(() =>
  (p.value?.contasDestino ?? []).map((c) => ({
    valor: c.codigo as string | null,
    rotulo: `${c.codigo} ${c.nome}`,
  })),
);
const observacao = ref('');
const senha = ref('');
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const podeApurar = computed(() => props.apoio.podeApurar && p.value?.podeApurar === true);
async function apurar() {
  if (!p.value || !destino.value || !senha.value || exercicio.value === null) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await apurarResultado({
      empresa: props.empresa,
      exercicio: exercicio.value,
      contaDestino: destino.value,
      observacao: observacao.value.trim() || null,
      senha: senha.value,
    });
    mensagem.value = r.mensagem;
    observacao.value = '';
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
  <section class="bloco" aria-labelledby="apuracao-titulo" data-testid="aba-apuracao">
    <h2 id="apuracao-titulo">{{ t('contabil.demonstracoes.apuracao.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.demonstracoes.apuracao.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="exercicio"
        :rotulo="t('contabil.demonstracoes.exercicio')"
        :opcoes="exercicios"
        data-testid="apuracao-exercicio"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="apuracao-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="previa.isError.value" :erro="previa.error.value" />
    <p v-else-if="!p" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <dl class="dados" data-testid="apuracao-previa">
        <dt>{{ t('contabil.data') }}</dt>
        <dd>{{ dataBr(p.data) }}</dd>
        <dt>{{ t('contabil.demonstracoes.apuracao.receitas') }}</dt>
        <dd>{{ reais(p.receitasCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.apuracao.custos') }}</dt>
        <dd>{{ reais(p.custosCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.apuracao.despesas') }}</dt>
        <dd>{{ reais(p.despesasCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.apuracao.resultado') }}</dt>
        <dd data-testid="apuracao-resultado">
          {{
            p.resultadoCentavos < 0
              ? t('contabil.demonstracoes.apuracao.deficit', { valor: reais(-p.resultadoCentavos) })
              : t('contabil.demonstracoes.apuracao.superavit', { valor: reais(p.resultadoCentavos) })
          }}
        </dd>
        <dt>{{ t('contabil.razao.conferencia') }}</dt>
        <dd data-testid="apuracao-conferencia">{{ p.conferencia }}</dd>
        <dt>{{ t('contabil.demonstracoes.apuracao.partidas') }}</dt>
        <dd>{{ p.partidas }}</dd>
      </dl>
      <SanteAlerta
        v-if="p.apuracaoAtiva !== null"
        variante="info"
        :texto="t('contabil.demonstracoes.apuracao.ativa', { n: p.apuracaoAtiva })"
        data-testid="apuracao-ativa"
      />
      <section v-if="p.impedimentos.length > 0" class="bloco" data-testid="apuracao-impedimentos">
        <h3>{{ t('contabil.demonstracoes.impedimentos') }}</h3>
        <ul>
          <li v-for="i in p.impedimentos" :key="i.codigo" :data-testid="`apuracao-impedimento-${i.codigo}`">
            {{ i.mensagem }}<template v-if="i.quantidade > 1"> ({{ i.quantidade }})</template>
          </li>
        </ul>
      </section>
      <p v-if="!apoio.podeApurar" class="secundario" data-testid="apuracao-sem-permissao">
        {{ t('contabil.demonstracoes.apuracao.semPermissao') }}
      </p>
      <section
        v-else-if="podeApurar"
        class="bloco"
        aria-labelledby="apurar-titulo"
        data-testid="apuracao-apurar"
      >
        <h3 id="apurar-titulo">{{ t('contabil.demonstracoes.apuracao.apurar') }}</h3>
        <SanteSelecao
          v-model="destino"
          :rotulo="t('contabil.demonstracoes.apuracao.destino')"
          :opcoes="opcoesDestino"
          busca
          data-testid="apuracao-destino"
        />
        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('contabil.periodos.observacao')"
          :max-bytes="200"
          data-testid="apuracao-observacao"
        />
        <SenhaConfirmacao v-model="senha" testid="apuracao-senha" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.demonstracoes.apuracao.apurar')"
            :desabilitado="ocupado || !senha || !destino"
            data-testid="apuracao-confirmar"
            @acionar="apurar"
          />
        </div>
      </section>
      <ErroContabil v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
