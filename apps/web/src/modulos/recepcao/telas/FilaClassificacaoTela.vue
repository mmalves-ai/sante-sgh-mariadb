<script setup lang="ts">
// Fila de classificação de risco (ficha do M44, seção 7): `/pa/classificacao`. Quem chegou ao PA e ainda não foi
// classificado, na ordem de chegada com a prioridade legal primeiro, com a espera e os sinais já registrados pelo
// técnico; e os classificados cujo tempo-alvo passou sem o atendimento médico (reclassificação obrigatória; regra 4).
// O canal do quadro do PA avisa cada mudança (as gravações do novo e o vigia das senhas) e a fila relê; sem o canal, a
// cada 15 s. Com `?lista=reclassificar` (item "Reclassificação por estouro do tempo-alvo"), os estourados vêm primeiro.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { CANAL_CLASSIFICACAO, lerFilaClassificacao } from '../api-classificacao.js';
import ErroClassificacao from '../componentes/ErroClassificacao.vue';
import MarcaRisco from '../componentes/MarcaRisco.vue';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';

const { t } = useI18n();
const rota = useRoute();
const estourosPrimeiro = computed(() => rota.query['lista'] === 'reclassificar');
const avisos = usarAvisosAtendimento(CANAL_CLASSIFICACAO, () => void fila.refetch());
const fila = useQuery({
  queryKey: ['classificacao', 'fila'],
  queryFn: () => lerFilaClassificacao(),
  // O estouro depende do relógio (não há evento quando o tempo-alvo passa): no máximo 30 s entre as leituras.
  refetchInterval: computed(() => Math.min(avisos.intervalo(), 30_000)),
});
const tempo = (m: number) =>
  m >= 60
    ? t('atendimento.horasMinutos', { h: Math.floor(m / 60), m: m % 60 })
    : t('atendimento.minutos', { n: m });
const maisAntigo = computed(() => Math.max(0, ...(fila.data.value?.itens ?? []).map((i) => i.minutosEspera)));
const prioridade = (p: '0' | '1' | '2') => t(`atendimento.fila.prioridades.${p}`);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fila-class-titulo" data-testid="tela-fila-classificacao">
    <h1 id="fila-class-titulo">{{ t('classificacao.fila.titulo') }}</h1>
    <p>{{ t('classificacao.fila.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/pa/quadro">{{ t('classificacao.fila.quadro') }}</RouterLink>
      <RouterLink to="/administracao/pa/protocolos" data-testid="link-protocolos">{{
        t('classificacao.fila.protocolos')
      }}</RouterLink>
      <RouterLink to="/administracao/pa/cores-legado">{{
        t('classificacao.fila.coresAnteriores')
      }}</RouterLink>
      <RouterLink to="/pa/classificacao/indicadores">{{ t('classificacao.fila.indicadores') }}</RouterLink>
    </p>
    <ErroClassificacao v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('classificacao.carregando') }}</p>
    <template v-else>
      <p v-if="fila.data.value.protocoloVigente" class="secundario" data-testid="fila-protocolo">
        {{
          t('classificacao.fila.vigente', {
            nome: fila.data.value.protocoloVigente.nome,
            versao: fila.data.value.protocoloVigente.versao,
          })
        }}
      </p>
      <SanteAlerta v-else variante="aviso" :texto="t('classificacao.fila.semProtocolo')" />
      <div class="colunas-fila" :class="{ inverter: estourosPrimeiro }">
        <section aria-labelledby="fila-aguardando" class="painel" data-testid="fila-aguardando">
          <h2 id="fila-aguardando">
            {{
              t('classificacao.fila.resumo', { n: fila.data.value.itens.length, tempo: tempo(maisAntigo) })
            }}
          </h2>
          <p v-if="fila.data.value.itens.length === 0">{{ t('classificacao.nenhum') }}</p>
          <ul v-else class="lista-simples">
            <li v-for="i in fila.data.value.itens" :key="i.reg" :data-testid="`fila-${i.reg}`">
              <strong>{{ i.paciente }}</strong>
              <span v-if="i.idade !== null" class="secundario">
                · {{ t('atendimento.anos', { n: i.idade }) }}</span
              >
              · {{ i.senha ?? t('atendimento.semSenha') }} · {{ prioridade(i.prioridadeLegal) }} ·
              {{ t('classificacao.fila.aguardando', { tempo: tempo(i.minutosEspera) }) }}
              <template v-if="i.comSinais"> · {{ t('classificacao.fila.comSinais') }}</template>
              ·
              <RouterLink :to="`/pa/classificacao/${i.reg}`" :data-testid="`classificar-${i.reg}`">{{
                t('classificacao.fila.classificar')
              }}</RouterLink>
            </li>
          </ul>
        </section>
        <section aria-labelledby="fila-estourados" class="painel" data-testid="fila-estourados">
          <h2 id="fila-estourados">{{ t('classificacao.fila.estourados') }}</h2>
          <p class="secundario">{{ t('classificacao.fila.estouradosTexto') }}</p>
          <p v-if="fila.data.value.reclassificarAgora.length === 0">
            {{ t('classificacao.fila.nenhumEstourado') }}
          </p>
          <ul v-else class="lista-simples">
            <li
              v-for="i in fila.data.value.reclassificarAgora"
              :key="i.reg"
              :data-testid="`estourado-${i.reg}`"
            >
              <MarcaRisco :cor="i.cor" />
              <strong> {{ i.paciente }}</strong> ·
              {{ t('classificacao.fila.passou', { min: i.minutosPassados }) }} ·
              <RouterLink
                :to="`/pa/classificacao/${i.reg}/reclassificar`"
                :data-testid="`reclassificar-${i.reg}`"
                >{{ t('classificacao.fila.reclassificar') }}</RouterLink
              >
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.colunas-fila {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.colunas-fila.inverter {
  flex-direction: column-reverse;
}
</style>
