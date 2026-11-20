<script setup lang="ts">
// O meu espelho de ponto (M52.4; `pessoas.ponto.ciencia`, toda pessoa, só o próprio vínculo; cap-07 §7.1.3: "Espelho
// de ponto no autosserviço, com ciência do colaborador"): os períodos fechados do próprio vínculo, o espelho e a
// ciência (concordo ou não, com a observação), dada sobre o resumo que a pessoa viu. O autosserviço completo é da F6.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import { darCiencia, lerMeuEspelho, urlMeuEspelhoPdf } from './api-ponto.js';
import EspelhoConteudo from './EspelhoConteudo.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const competencia = ref<string | null>(null);
const vinculo = ref<number | null>(null);
const meu = useQuery({
  queryKey: computed(() => ['ponto', 'meu', competencia.value, vinculo.value]),
  queryFn: () => lerMeuEspelho(competencia.value, vinculo.value),
});
const m = computed(() => meu.data.value ?? null);
const e = computed(() => m.value?.espelho ?? null);
const opcoesCompetencia = computed(() => (m.value?.competencias ?? []).map((c) => ({ valor: c, rotulo: c })));
const opcoesVinculo = computed(() =>
  (m.value?.vinculos ?? []).map((v) => ({
    valor: v.vinculo,
    rotulo: [v.cargo, v.unidadeNome].filter(Boolean).join(' · '),
  })),
);
const concorda = ref<'sim' | 'nao'>('sim');
const observacao = ref('');
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const opcoesConcorda = computed(() => [
  { valor: 'sim' as const, rotulo: t('ponto.meu.concordo') },
  { valor: 'nao' as const, rotulo: t('ponto.meu.naoConcordo') },
]);
const pode = computed(() => concorda.value === 'sim' || observacao.value.trim().length >= 10);
async function registrar(): Promise<void> {
  if (!e.value || !pode.value) return;
  erro.value = null;
  try {
    const r = await darCiencia({
      vinculo: e.value.colaborador.vinculo,
      competencia: e.value.competencia,
      hash: e.value.hash,
      concorda: concorda.value === 'sim',
      observacao: concorda.value === 'nao' ? observacao.value.trim() : null,
    });
    aviso.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['ponto', 'meu'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="meu-ponto-titulo" data-testid="tela-meu-espelho">
    <h1 id="meu-ponto-titulo">{{ t('ponto.meu.titulo') }}</h1>
    <p>{{ t('ponto.meu.subtitulo') }}</p>
    <ErroPessoas v-if="meu.isError.value" :erro="meu.error.value" />
    <p v-else-if="!m" role="status">{{ t('ponto.carregando') }}</p>
    <SanteAlerta v-else-if="m.vinculos.length === 0" :texto="t('ponto.meu.semVinculo')" variante="info" />
    <template v-else>
      <div class="campos">
        <SanteSelecao
          v-if="opcoesVinculo.length > 1"
          v-model="vinculo"
          :rotulo="t('ponto.meu.vinculo')"
          :opcoes="opcoesVinculo"
        />
        <SanteSelecao
          v-if="opcoesCompetencia.length > 0"
          v-model="competencia"
          :rotulo="t('ponto.competencia')"
          :opcoes="opcoesCompetencia"
          data-testid="meu-competencia"
        />
      </div>
      <SanteAlerta v-if="!e" :texto="t('ponto.meu.semFechado')" variante="info" />
      <template v-else>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="meu-aviso" />
        <SanteAlerta
          v-if="e.acoes.motivo && !e.ciencia && !e.acoes.ciencia"
          :texto="e.acoes.motivo"
          variante="info"
          data-testid="meu-acoes-motivo"
        />
        <div class="acoes">
          <a :href="urlMeuEspelhoPdf(e.competencia, e.colaborador.vinculo)">{{ t('ponto.espelho.pdf') }}</a>
        </div>
        <EspelhoConteudo :espelho="e" />
        <p v-if="e.ciencia" data-testid="meu-ciencia-dada">
          {{
            t('ponto.meu.cienciaDada', {
              em: `${dataBr(e.ciencia.registradoEm.slice(0, 10))} ${e.ciencia.registradoEm.slice(11, 16)}`,
              d: e.ciencia.concorda === false ? t('ponto.meu.discordou') : '',
            })
          }}
        </p>
        <form
          v-else-if="e.acoes.ciencia"
          class="bloco"
          :aria-label="t('ponto.meu.darCiencia')"
          data-testid="form-ciencia"
          @submit.prevent="registrar"
        >
          <SanteOpcoes
            v-model="concorda"
            :legenda="t('ponto.meu.darCiencia')"
            :opcoes="opcoesConcorda"
            data-testid="ciencia-concorda"
          />
          <SanteCampoTexto
            v-if="concorda === 'nao'"
            v-model="observacao"
            :rotulo="t('ponto.meu.observacao')"
            :max-bytes="400"
            data-testid="ciencia-observacao"
          />
          <ErroPessoas v-if="erro" :erro="erro" />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('ponto.meu.darCiencia')"
              tipo="submit"
              :desabilitado="!pode"
              data-testid="ciencia-registrar"
            />
          </div>
        </form>
      </template>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
