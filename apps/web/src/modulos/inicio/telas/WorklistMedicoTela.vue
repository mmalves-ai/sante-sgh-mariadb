<script setup lang="ts">
// Médico: meus pacientes (ficha do M27, seção 7; regras 2 a 4; cap-08 §8.4): `/inicio/medico`. Só os pacientes com
// vínculo assistencial (o atendimento é do médico, ele registrou no episódio ou aceitou o parecer): leito, idade, dias,
// previsão de alta, alergias e as pendências — crítico não visto e resultado novo (até a visualização ou a ciência,
// inclusive os liberados no outro sistema), internado sem evolução médica há mais de 24 h (os dois sistemas; a suspensa
// não conta), prescrição a renovar, pareceres e documentos a assinar —, os mais urgentes primeiro. Só leitura: cada
// pendência abre a tela que a resolve (prontuário, prescrição, resultados, interconsultas, assinaturas). Relê a cada
// minuto e no botão.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { dataBr } from '../../agenda/formato.js';
import { horaDe } from '../../recepcao/formato.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { donoDaSessao, lerWorklistMedico } from '../api-inicio.js';
import ErroTrabalho from '../componentes/ErroTrabalho.vue';
import { type FiltroMedico, filtrarFilaMedico, nivelDaPendencia } from '../regras-tela.js';

const { t } = useI18n();
const { sessao, permissoes } = usarSessao();
// M29: o aviso das intervenções farmacêuticas ao prescritor (a fila de trabalho do médico).
const respondeIntervencao = computed(() => permissoes.value.has('suprimentos.intervencao.responder'));
const fila = useQuery({
  queryKey: computed(() => ['inicio', 'medico', donoDaSessao(sessao.value)]),
  queryFn: () => lerWorklistMedico(),
  refetchInterval: 60_000,
});
const filtro = ref<FiltroMedico>('todos');
const filtros = computed(() =>
  (['todos', 'pendentes', 'internados'] as const).map((v) => ({
    valor: v,
    rotulo: t(`trabalho.medico.filtros.${v}`),
  })),
);
const linhas = computed(() => filtrarFilaMedico(fila.data.value?.pacientes ?? [], filtro.value));
const comPendencia = computed(
  () => (fila.data.value?.pacientes ?? []).filter((p) => p.pendencias.length > 0).length,
);
const localDe = (p: { leito: string | null; unidade: string | null; tipo: string }) =>
  p.leito
    ? [p.unidade, p.leito].filter(Boolean).join(' · ')
    : p.tipo === 'internacao'
      ? t('trabalho.medico.semLeito')
      : t(`trabalho.medico.${p.tipo === 'urgencia' ? 'urgencia' : 'externo'}`);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="wl-medico-titulo" data-testid="tela-worklist-medico">
    <h1 id="wl-medico-titulo">{{ t('trabalho.medico.titulo') }}</h1>
    <p>{{ t('trabalho.medico.texto') }}</p>
    <p v-if="respondeIntervencao">
      <RouterLink to="/farmacia/intervencoes" data-testid="wl-medico-intervencoes">{{
        t('farmacia.intervencoes.titulo')
      }}</RouterLink>
    </p>
    <div class="filtros">
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('trabalho.medico.filtro')"
        :opcoes="filtros"
        data-testid="wl-medico-filtro"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('trabalho.atualizar')"
        data-testid="wl-medico-atualizar"
        @acionar="fila.refetch()"
      />
    </div>
    <ErroTrabalho v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('trabalho.carregando') }}</p>
    <template v-else>
      <p class="secundario" role="status" data-testid="wl-medico-contagem">
        {{ t('trabalho.medico.contagem', { n: fila.data.value.total, p: comPendencia }) }} ·
        {{ t('trabalho.atualizada', { hora: horaDe(fila.data.value.geradaEm) }) }}
      </p>
      <p v-if="fila.data.value.semVinculo" class="painel" data-testid="wl-medico-sem-vinculo">
        {{ t('trabalho.medico.semVinculo') }}
      </p>
      <p v-else-if="linhas.length === 0" data-testid="wl-medico-vazia">{{ t('trabalho.medico.vazia') }}</p>
      <table v-else class="tabela" data-testid="tabela-worklist-medico">
        <caption class="sgh-visualmente-oculto">
          {{
            t('trabalho.medico.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('trabalho.medico.leito') }}</th>
            <th scope="col">{{ t('trabalho.medico.paciente') }}</th>
            <th scope="col">{{ t('trabalho.medico.dias') }}</th>
            <th scope="col">{{ t('trabalho.medico.previsaoAlta') }}</th>
            <th scope="col">{{ t('trabalho.medico.pendencias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in linhas" :key="p.atendimento" :data-testid="`wl-medico-${p.atendimento}`">
            <td>{{ localDe(p) }}</td>
            <td>
              <RouterLink
                :to="`/pep/paciente/${p.paciente}`"
                :aria-label="t('trabalho.medico.abrirProntuario', { nome: p.nome })"
                >{{ p.nome }}</RouterLink
              >
              <span class="secundario">
                · {{ [p.idade, p.sexo].filter(Boolean).join(' · ') }} · {{ t('trabalho.medico.prontuario') }}
                {{ p.prontuario }}</span
              >
              <span class="chip" :class="{ alerta: p.alergias === 'lista' }">{{
                t(`trabalho.medico.alergias.${p.alergias}`)
              }}</span>
            </td>
            <td>{{ p.dias === null ? '—' : t('trabalho.medico.diasN', { n: p.dias }) }}</td>
            <td>{{ p.previsaoAlta ? dataBr(p.previsaoAlta) : '—' }}</td>
            <td>
              <ul v-if="p.pendencias.length > 0" class="pendencias">
                <li v-for="x in p.pendencias" :key="x.tipo">
                  <RouterLink
                    :to="x.link"
                    class="pendencia"
                    :class="nivelDaPendencia(x.tipo)"
                    :title="x.texto"
                    :data-testid="`pend-${x.tipo}-${p.atendimento}`"
                    >{{ t(`trabalho.medico.tipos.${x.tipo}`)
                    }}<template v-if="x.quantidade > 1"> ({{ x.quantidade }})</template></RouterLink
                  >
                  <span class="sgh-visualmente-oculto">{{ x.texto }}</span>
                </li>
              </ul>
              <span v-else class="secundario">{{ t('trabalho.nenhum') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="fila.data.value.limitado" class="secundario">
        {{ t('trabalho.medico.limitada', { n: fila.data.value.teto }) }}
      </p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.pendencias {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.pendencia {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  color: var(--sgh-texto);
  text-decoration: none;
}
.pendencia.urgente {
  border-width: 2px;
  font-weight: 700;
}
.pendencia.prazo {
  border-style: dashed;
  font-weight: 600;
}
.chip {
  display: inline-block;
  margin-left: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda);
  border-radius: 4px;
  font-size: var(--sgh-fonte-pequena);
}
.chip.alerta {
  border-color: var(--sgh-borda-forte);
  font-weight: 700;
}
</style>
