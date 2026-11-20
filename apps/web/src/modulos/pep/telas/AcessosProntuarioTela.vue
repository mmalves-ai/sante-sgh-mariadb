<script setup lang="ts">
// Registro de acesso ao prontuário (M15; ficha, seção 7): quem leu, quando, de onde, o paciente e o registro
// por número, a parte aberta e o motivo (e o ator real numa sessão do suporte técnico). Para o Auditor (e quem
// tem a opção de auditoria do prontuário). Filtros por paciente, usuário, período e "só os alertas" (o e-mail
// do alerta ao Auditor leva a esta tela; o alerta aparece destacado pela criticidade); 100 por página; exportar
// em CSV com a permissão própria. Nenhum conteúdo clínico.
import {
  type AcessoProntuario,
  MOTIVOS_ACESSO_PRONTUARIO,
  ROTULOS_MOTIVO_ACESSO,
  type MotivoAcessoProntuario,
} from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { listarAcessos, urlExportarAcessos } from '../api-pep.js';
import { dataHoraBr } from '../formato.js';

const { t } = useI18n();
const rota = useRoute();
const paciente = ref('');
// ?soAlertas=sim (o e-mail do alerta) já abre filtrado.
const soAlertas = ref(rota.query['soAlertas'] === 'sim');
const usuario = ref('');
const de = ref('');
const ate = ref('');
const pagina = ref(1);
const filtros = ref<Record<string, string | number>>(soAlertas.value ? { soAlertas: 'sim' } : {});

function aplicar(): void {
  pagina.value = 1;
  filtros.value = {
    ...(soAlertas.value ? { soAlertas: 'sim' } : {}),
    ...(/^\d+$/.test(paciente.value.trim()) ? { paciente: Number(paciente.value.trim()) } : {}),
    ...(usuario.value.trim() ? { usuario: usuario.value.trim() } : {}),
    ...(de.value ? { de: de.value } : {}),
    ...(ate.value ? { ate: ate.value } : {}),
  };
}
const consulta = useQuery({
  queryKey: computed(() => ['pep', 'acessos', filtros.value, pagina.value]),
  queryFn: () => listarAcessos({ ...filtros.value, pagina: pagina.value }),
  staleTime: 0,
});
const l = computed(() => consulta.data.value);
const exportar = computed(() => urlExportarAcessos({ ...filtros.value, pagina: pagina.value }));
const motivo = (m: string | null) =>
  m && (MOTIVOS_ACESSO_PRONTUARIO as readonly string[]).includes(m)
    ? ROTULOS_MOTIVO_ACESSO[m as MotivoAcessoProntuario]
    : (m ?? '');
const parte = (p: string | null) => (p ? t(`pep.partes.${p}`, p) : '');
const alerta = (a: AcessoProntuario['alerta']) =>
  a
    ? `${t(`pep.acessos.alertas.${a.tipo}`)} (${t(`pep.acessos.criticidade.${a.criticidade}`, String(a.criticidade))})`
    : '';
</script>

<template>
  <section class="tela" aria-labelledby="pep-acessos-titulo" data-testid="tela-acessos-prontuario">
    <h1 id="pep-acessos-titulo">{{ t('pep.acessos.titulo') }}</h1>
    <p>{{ t('pep.acessos.texto') }}</p>
    <form class="barra" :aria-label="t('pep.filtros.titulo')" @submit.prevent="aplicar">
      <div class="campo">
        <label for="acessos-paciente">{{ t('pep.acessos.paciente') }}</label>
        <input
          id="acessos-paciente"
          v-model="paciente"
          inputmode="numeric"
          maxlength="10"
          data-testid="acessos-paciente"
        />
      </div>
      <div class="campo">
        <label for="acessos-usuario">{{ t('pep.acessos.usuario') }}</label>
        <input id="acessos-usuario" v-model="usuario" maxlength="31" autocomplete="off" />
      </div>
      <div class="campo">
        <label for="acessos-de">{{ t('pep.filtros.de') }}</label>
        <input id="acessos-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="acessos-ate">{{ t('pep.filtros.ate') }}</label>
        <input id="acessos-ate" v-model="ate" type="date" />
      </div>
      <div class="campo-marcar">
        <input id="acessos-so-alertas" v-model="soAlertas" type="checkbox" data-testid="acessos-so-alertas" />
        <label for="acessos-so-alertas">{{ t('pep.acessos.soAlertas') }}</label>
      </div>
      <SanteBotao :rotulo="t('pep.filtros.aplicar')" tipo="submit" data-testid="acessos-aplicar" />
      <a
        v-if="pode('auditoria.acessos.exportar')"
        :href="exportar"
        class="link-acao"
        data-testid="acessos-exportar"
        >{{ t('pep.acessos.exportar') }}</a
      >
    </form>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!l" role="status">{{ t('pep.carregando') }}</p>
    <template v-else>
      <p v-if="l.itens.length === 0" role="status">{{ t('pep.acessos.vazio') }}</p>
      <table v-else data-testid="lista-acessos">
        <caption>
          {{
            t('pep.acessos.legenda', { pagina: l.pagina })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.acessos.em') }}</th>
            <th scope="col">{{ t('pep.acessos.usuario') }}</th>
            <th scope="col">{{ t('pep.acessos.estacao') }}</th>
            <th scope="col">{{ t('pep.acessos.paciente') }}</th>
            <th scope="col">{{ t('pep.acessos.registro') }}</th>
            <th scope="col">{{ t('pep.acessos.parte') }}</th>
            <th scope="col">{{ t('pep.acessos.motivo') }}</th>
            <th scope="col">{{ t('pep.acessos.origem') }}</th>
            <th scope="col">{{ t('pep.acessos.alerta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in l.itens" :key="a.id" :class="{ alerta: a.alerta !== null }">
            <td>{{ dataHoraBr(a.em) }}</td>
            <td>{{ a.usuario }}</td>
            <td>{{ a.estacao ?? '' }}</td>
            <td>{{ a.paciente ?? '' }}</td>
            <td>{{ a.registro ?? '' }}</td>
            <td>{{ parte(a.parte) }}</td>
            <td>{{ motivo(a.motivo) }}</td>
            <td>{{ a.origem ?? '' }}</td>
            <td :data-testid="a.alerta ? 'acesso-alerta' : undefined">
              <strong v-if="a.alerta">{{ alerta(a.alerta) }}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <nav class="paginas" :aria-label="t('pep.registros.paginacao')">
        <SanteBotao
          :rotulo="t('pep.registros.anterior')"
          variante="secundario"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('pep.registros.pagina', { n: pagina }) }}</span>
        <SanteBotao
          :rotulo="t('pep.registros.proxima')"
          variante="secundario"
          :desabilitado="!l.haMais"
          @acionar="pagina++"
        />
      </nav>
    </template>
  </section>
</template>

<style scoped>
.campo-marcar {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
tr.alerta td {
  font-weight: 600;
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.paginas {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
</style>
