<script setup lang="ts">
// Meus pacientes no portal do médico externo (W0-10, M4): `/medico-externo/pacientes`, fora da casca interna. O servidor
// monta a lista pela fila do médico interno com os registros do profissional ligado à conta (vínculo assistencial):
// internados e atendidos, leito, dias, previsão de alta, resultados novos e críticos. "Abrir o prontuário" pede o resumo
// ao servidor, que confere de novo o vínculo (fora da lista, 403) e registra o acesso. Só leitura.
import type { ProntuarioPortalMedico } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pacientesPortalMedico, prontuarioPortalMedico } from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const pronto = ref(false);
const lista = useQuery({
  queryKey: ['portal-medico', 'pacientes'],
  queryFn: pacientesPortalMedico,
  enabled: pronto,
});
const aberto = ref<ProntuarioPortalMedico | null>(null);
const abrindo = ref<number | null>(null);
const erroAbrir = ref<unknown>(null);
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string | null) => (d ? `${data(d)} ${d.slice(11, 16)}`.trim() : '—');

async function abrir(paciente: number): Promise<void> {
  abrindo.value = paciente;
  erroAbrir.value = null;
  aberto.value = null;
  try {
    aberto.value = await prontuarioPortalMedico(paciente);
  } catch (e) {
    erroAbrir.value = e;
  } finally {
    abrindo.value = null;
  }
}
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.pacientes.titulo')" @sessao="pronto = true">
    <template #default>
      <p class="secundario">{{ t('portalMedico.pacientes.explicacao') }}</p>
      <ErroPortalMedico v-if="lista.error.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('portalMedico.carregando') }}</p>
      <p v-else-if="!lista.data.value.vinculado" role="note" data-testid="pm-sem-vinculo">
        {{ t('portalMedico.semVinculo') }}
      </p>
      <template v-else>
        <p class="secundario" data-testid="pm-profissional">
          {{ t('portalMedico.profissional', { nome: lista.data.value.profissional }) }}
        </p>
        <p v-if="lista.data.value.limitado" role="note">
          {{ t('portalMedico.pacientes.cortada', { n: lista.data.value.teto }) }}
        </p>
        <table v-if="lista.data.value.pacientes.length" class="tabela" data-testid="pm-pacientes">
          <thead>
            <tr>
              <th scope="col">{{ t('portalMedico.pacientes.paciente') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.local') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.dias') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.previsaoAlta') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.resultados') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in lista.data.value.pacientes"
              :key="p.paciente"
              :data-testid="`pm-paciente-${p.paciente}`"
            >
              <td>
                <strong>{{ p.nome }}</strong>
                <span class="secundario">
                  · {{ [p.idade, p.sexo].filter(Boolean).join(', ') }} ·
                  {{ t('portalMedico.pacientes.prontuario', { numero: p.prontuario }) }}</span
                >
              </td>
              <td>
                {{ t(`portalMedico.pacientes.tipo.${p.tipo}`) }}
                <span v-if="p.unidade || p.leito" class="secundario">
                  · {{ [p.unidade, p.leito].filter(Boolean).join(' / ') }}</span
                >
              </td>
              <td>{{ p.dias === null ? '—' : t('portalMedico.pacientes.diasN', { n: p.dias }) }}</td>
              <td>{{ data(p.previsaoAlta) }}</td>
              <td>
                <strong v-if="p.criticos" class="critico" :data-testid="`pm-criticos-${p.paciente}`">{{
                  t('portalMedico.pacientes.criticos', { n: p.criticos })
                }}</strong>
                <span v-if="p.resultadosNovos">
                  {{ t('portalMedico.pacientes.novos', { n: p.resultadosNovos }) }}</span
                >
                <span v-if="!p.criticos && !p.resultadosNovos">—</span>
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('portalMedico.pacientes.abrir')"
                  :desabilitado="abrindo !== null"
                  :data-testid="`pm-abrir-${p.paciente}`"
                  @acionar="abrir(p.paciente)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else data-testid="pm-pacientes-vazia">{{ t('portalMedico.pacientes.nenhum') }}</p>
      </template>

      <ErroPortalMedico v-if="erroAbrir" :erro="erroAbrir" />
      <section v-if="aberto" class="resumo" data-testid="pm-prontuario" aria-live="polite">
        <h2>{{ t('portalMedico.pacientes.resumo', { nome: aberto.paciente.nome }) }}</h2>
        <p class="secundario" data-testid="pm-acesso-registrado">
          {{ t('portalMedico.pacientes.registrado') }}
        </p>
        <table v-if="aberto.resultados.length" class="tabela" data-testid="pm-resultados">
          <thead>
            <tr>
              <th scope="col">{{ t('portalMedico.pacientes.exame') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.liberadoEm') }}</th>
              <th scope="col">{{ t('portalMedico.pacientes.valores') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in aberto.resultados" :key="r.exame" :data-testid="`pm-resultado-${r.exame}`">
              <td>
                {{ r.nome }}
                <strong v-if="r.critico" class="critico">· {{ t('portalMedico.pacientes.critico') }}</strong>
              </td>
              <td>{{ quando(r.liberadoEm) }}</td>
              <td>
                <span v-for="v in r.valores" :key="v.elemento" class="valor">
                  {{ v.elemento }}: {{ v.valor ?? '—' }} {{ v.unidade ?? '' }}
                  <span v-if="v.referencia" class="secundario">({{ v.referencia }})</span>
                </span>
                <span v-if="r.texto">{{ r.texto }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('portalMedico.pacientes.semResultados') }}</p>
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalMedico.pacientes.fechar')"
          data-testid="pm-fechar"
          @acionar="aberto = null"
        />
      </section>
    </template>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.critico {
  color: var(--sgh-perigo);
}
.valor {
  display: block;
}
.resumo {
  margin-top: var(--sgh-espaco-4);
}
</style>
