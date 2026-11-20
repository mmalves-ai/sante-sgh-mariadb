<script setup lang="ts">
// Grade de horários e vagas (ficha do M17, seção 7): `/agenda/consultas/grade`. A semana da agenda (segunda a
// domingo) com o estado de cada horário em texto (a cor nunca é a única informação); o vago abre a marcação já
// com a agenda, a data e a hora escolhidas.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { lerGrade } from '../api-agenda.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr, somarDias } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const { t } = useI18n();
const rota = useRoute();
const { opcoesAgenda } = usarAgenda();
const agenda = ref(String(rota.query['agenda'] ?? ''));
const inicio = ref<string | null>(typeof rota.query['inicio'] === 'string' ? rota.query['inicio'] : null);
const grade = useQuery({
  queryKey: computed(() => ['agenda', 'grade', agenda.value, inicio.value]),
  queryFn: () => lerGrade(Number(agenda.value), inicio.value),
  enabled: computed(() => agenda.value !== ''),
});
const escolhas = computed(() => [{ valor: '', rotulo: t('agenda.escolha') }, ...opcoesAgenda.value]);
function semana(n: number): void {
  const base = grade.data.value?.inicio;
  if (base) inicio.value = somarDias(base, 7 * n);
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="grade-titulo" data-testid="tela-grade">
    <h1 id="grade-titulo">{{ t('agenda.grade.titulo') }}</h1>
    <p>{{ t('agenda.grade.texto') }}</p>
    <div class="filtros">
      <SanteSelecao v-model="agenda" :rotulo="t('agenda.agenda')" :opcoes="escolhas" />
      <SanteBotao
        variante="secundario"
        :rotulo="t('agenda.grade.anterior')"
        :desabilitado="!grade.data.value"
        @acionar="semana(-1)"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('agenda.grade.proxima')"
        :desabilitado="!grade.data.value"
        @acionar="semana(1)"
      />
    </div>
    <ErroAgenda v-if="grade.isError.value" :erro="grade.error.value" />
    <p v-else-if="agenda && !grade.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else-if="grade.data.value">
      <p role="status">{{ t('agenda.grade.totais', grade.data.value.totais) }}</p>
      <div class="semana" data-testid="grade-semana">
        <section
          v-for="d in grade.data.value.dias"
          :key="d.data"
          class="dia"
          :aria-labelledby="`dia-${d.data}`"
        >
          <h2 :id="`dia-${d.data}`">{{ d.dia }} {{ dataBr(d.data) }}</h2>
          <p v-if="d.horarios.length === 0" class="secundario">{{ t('agenda.grade.semHorarios') }}</p>
          <ul v-else>
            <li
              v-for="h in d.horarios"
              :key="h.hora"
              :class="`estado-${h.estado}`"
              :data-testid="`horario-${d.data}-${h.hora.replace(':', '')}`"
            >
              <RouterLink
                v-if="h.estado === 'vago'"
                :to="{ path: '/agenda/consultas/marcar', query: { agenda, data: d.data, hora: h.hora } }"
              >
                {{ horaBr(h.hora) }} · {{ t('agenda.estados.vago') }}
              </RouterLink>
              <RouterLink v-else-if="h.marcacao" :to="`/agenda/consultas/marcacoes/${h.marcacao}`">
                {{ horaBr(h.hora) }} · {{ t(`agenda.estados.${h.estado}`) }} · {{ h.paciente }}
              </RouterLink>
              <span v-else>
                {{ horaBr(h.hora) }} · {{ t(`agenda.estados.${h.estado}`)
                }}<template v-if="h.rotuloSituacao"> ({{ h.rotuloSituacao }})</template>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
<style scoped>
.semana {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.dia {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
}
.dia h2 {
  font-size: 1rem;
  margin: 0 0 var(--sgh-espaco-1);
}
.dia ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dia li {
  padding: 2px var(--sgh-espaco-1);
  border-inline-start: 4px solid var(--sgh-borda);
}
.estado-vago {
  border-inline-start-color: var(--sgh-sucesso, var(--sgh-info)) !important;
}
.estado-ocupado,
.estado-encaixe {
  border-inline-start-color: var(--sgh-info) !important;
}
.estado-bloqueado {
  border-inline-start-color: var(--sgh-alerta) !important;
}
.estado-passado {
  color: var(--sgh-texto-secundario);
}
</style>
