<script setup lang="ts">
// Revisão W0-03, mercado M1: a profilaxia de TEV pendente na tela própria de quem prescreve. Só a permissão de
// prescrever (pep.prescricao.criar): a leitura GET /api/enfermagem/escores/profilaxia traz as unidades e as pendências
// da escolhida, sem exigir a permissão de ler os escores da enfermagem. A decisão (prescrita, ou não prescrita com o
// motivo) é a mesma da tela dos escores; a correção da decisão fica no cartão do paciente.
import { ROTULOS_ESCALA, type EscalaEscore, type PendenciaProfilaxia } from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { decidirProfilaxia, lerProfilaxiasPendentes } from '../api-escores.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';

const { t } = useI18n();
const unidade = ref('');
const leitura = useQuery({
  queryKey: computed(() => ['escores', 'profilaxia', unidade.value]),
  queryFn: () => lerProfilaxiasPendentes(unidade.value),
});
const dados = computed(() => leitura.data.value ?? null);
const opcoesUnidade = computed(() =>
  (dados.value?.unidades ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
);
watch(
  () => dados.value?.unidades,
  (us) => {
    if (!unidade.value && us && us.length > 0) unidade.value = us[0]!.unidade;
  },
  { immediate: true },
);
const pendentes = computed(() => (dados.value?.unidade ? dados.value.pendentes : []));
const podeDecidir = computed(() => dados.value?.decidir === true);

const hora = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
const nomeEscala = (e: string) => ROTULOS_ESCALA[e as EscalaEscore].split(' (')[0];

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const decidindo = ref<PendenciaProfilaxia | null>(null);
const dialogo = ref(false);
const decisao = ref<'prescrita' | 'nao-prescrita'>('prescrita');
const motivo = ref('');
const opcoesDecisao = computed(() =>
  (['prescrita', 'nao-prescrita'] as const).map((d) => ({
    valor: d,
    rotulo: t(`enfermagem.mercado.tev.decisoes.${d}`),
  })),
);
function abrir(p: PendenciaProfilaxia): void {
  decidindo.value = p;
  decisao.value = 'prescrita';
  motivo.value = '';
  erro.value = null;
  dialogo.value = true;
}
async function confirmar(): Promise<void> {
  const p = decidindo.value;
  if (!p) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await decidirProfilaxia(p.escore, {
      decisao: decisao.value,
      ...(decisao.value === 'nao-prescrita' ? { motivo: motivo.value.trim() } : {}),
    });
    mensagem.value = r.mensagem;
    dialogo.value = false;
    await leitura.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="pt-titulo" data-testid="tela-profilaxia-tev">
    <h1 id="pt-titulo">{{ t('enfermagem.mercado.tev.telaTitulo') }}</h1>
    <p>{{ t('enfermagem.mercado.tev.telaTexto') }}</p>
    <div class="barra">
      <SeletorUnidade v-model="unidade" :opcoes="opcoesUnidade" />
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.comum.atualizar')"
        @acionar="() => void leitura.refetch()"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="pt-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="leitura.error.value" :erro="leitura.error.value" />
    <p v-else-if="!unidade">{{ t('enfermagem.mercado.tev.escolhaUnidade') }}</p>
    <section v-else class="cartao" data-testid="pt-pendentes" aria-labelledby="pt-lista">
      <h2 id="pt-lista">{{ t('enfermagem.mercado.tev.titulo') }}</h2>
      <p v-if="pendentes.length === 0">{{ t('enfermagem.mercado.tev.vazio') }}</p>
      <ul v-else>
        <li v-for="p in pendentes" :key="p.escore" class="cuidado" :data-testid="`pt-tev-${p.escore}`">
          <span>
            <strong>{{ p.leito }} · {{ p.nome }}</strong> ·
            {{
              t('enfermagem.mercado.tev.escore', {
                escala: nomeEscala(p.escala),
                total: p.total,
                faixa: p.rotuloFaixa,
                quando: hora(p.aferidoEm),
                por: p.usuario,
              })
            }}
            · {{ p.sugestao }}
          </span>
          <SanteBotao
            v-if="podeDecidir"
            variante="secundario"
            :rotulo="t('enfermagem.mercado.tev.decidir')"
            :data-testid="`pt-tev-decidir-${p.escore}`"
            @acionar="abrir(p)"
          />
          <span v-else class="secundario">{{ t('enfermagem.mercado.tev.soPrescritor') }}</span>
        </li>
      </ul>
    </section>
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('enfermagem.mercado.tev.dialogo')">
      <div class="campos-coluna" data-testid="pt-dialogo">
        <p v-if="decidindo">
          {{ decidindo.leito }} · {{ decidindo.nome }} · {{ nomeEscala(decidindo.escala) }}
          {{ decidindo.total }} ({{ decidindo.rotuloFaixa }}) · {{ decidindo.sugestao }}
        </p>
        <SanteSelecao
          v-model="decisao"
          :rotulo="t('enfermagem.mercado.tev.decisao')"
          :opcoes="opcoesDecisao"
          data-testid="pt-decisao-escolher"
        />
        <span v-if="decisao === 'nao-prescrita'" class="campo">
          <label for="pt-motivo">{{ t('enfermagem.mercado.tev.motivo') }}</label>
          <input id="pt-motivo" v-model="motivo" maxlength="300" data-testid="pt-motivo" />
          <small class="secundario">{{ t('enfermagem.mercado.tev.motivoAjuda') }}</small>
        </span>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.mercado.tev.confirmar')"
          :desabilitado="(decisao === 'nao-prescrita' && motivo.trim().length < 10) || ocupado"
          data-testid="pt-confirmar"
          @acionar="confirmar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos-coluna {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.cuidado {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-1);
}
</style>
