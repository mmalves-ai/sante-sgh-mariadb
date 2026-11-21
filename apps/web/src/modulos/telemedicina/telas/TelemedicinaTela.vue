<script setup lang="ts">
// Telemedicina, tela do médico (M50, etapa 4; ficha, seção 7: `PEP > Telemedicina (teleconsulta e teleinterconsulta)`,
// `/pep/telemedicina`). As teleconsultas do dia (o paciente na sala de espera do portal aparece marcado; filtro pelo dia
// e pela própria agenda), as teleinterconsultas pedidas pelo médico ou para ele, e o pedido de teleinterconsulta num
// atendimento aberto de hoje (o médico convidado do corpo clínico, o motivo e o consentimento do paciente).
import type { AtendimentoResumo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';
import {
  apoioTelemedicina,
  atendimentosAbertos,
  listaTelemedicina,
  solicitarTeleinterconsulta,
} from '../api-telemedicina.js';
import ErroTelemedicina from '../componentes/ErroTelemedicina.vue';

const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const fData = ref('');
const fMinhas = ref(false);
const filtro = ref<{ data: string | null; minhas: boolean }>({ data: null, minhas: false });
const lista = useQuery({
  queryKey: computed(() => ['telemedicina', 'lista', filtro.value]),
  queryFn: () => listaTelemedicina(filtro.value),
  // O paciente entra na sala de espera pelo portal: a lista relê a cada 20 segundos.
  refetchInterval: 20_000,
});
const podeRealizar = computed(() => pode('atendimento.teleconsulta.realizar'));
const apoio = useQuery({
  queryKey: ['telemedicina', 'apoio'],
  queryFn: () => apoioTelemedicina(),
  enabled: podeRealizar,
});
function filtrar(): void {
  filtro.value = {
    data: /^\d{4}-\d{2}-\d{2}$/.test(fData.value) ? fData.value : null,
    minhas: fMinhas.value,
  };
}
const dia = (d: string) => d.split('-').reverse().join('/');
const hora = (h: string) => h.slice(0, 5);

// ── Pedido de teleinterconsulta ──
const termoAtendimento = ref('');
const achados = ref<AtendimentoResumo[]>([]);
const atendimento = ref('');
const convidado = ref('');
const motivo = ref('');
const consentimento = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const opcoesAtendimento = computed(() => [
  { valor: '', rotulo: t('telemedicina.pedir.escolha') },
  ...achados.value.map((a) => ({
    valor: String(a.reg),
    rotulo: `${a.reg} · ${a.paciente.nome} · ${a.hora}`,
  })),
]);
const opcoesConvidado = computed(() => [
  { valor: '', rotulo: t('telemedicina.pedir.escolha') },
  ...(apoio.data.value?.medicos ?? [])
    .filter((m) => m.vinculo !== lista.data.value?.profissional?.vinculo)
    .map((m) => ({ valor: String(m.vinculo), rotulo: `${m.nome} (${m.crm})` })),
]);
async function buscarAtendimentos(): Promise<void> {
  erro.value = null;
  try {
    achados.value = await atendimentosAbertos(termoAtendimento.value);
  } catch (x) {
    erro.value = x;
  }
}
async function pedir(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  aviso.value = null;
  if (!atendimento.value || !convidado.value) {
    aviso.value = t('telemedicina.pedir.faltaAtendimento');
    return;
  }
  ocupado.value = true;
  try {
    const r = await solicitarTeleinterconsulta({
      atendimento: Number(atendimento.value),
      convidado: Number(convidado.value),
      motivo: motivo.value,
      consentimento: consentimento.value as true,
    });
    mensagem.value = r.mensagem;
    motivo.value = '';
    consentimento.value = false;
    await cliente.invalidateQueries({ queryKey: ['telemedicina', 'lista'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tele-titulo" data-testid="tela-telemedicina">
    <h1 id="tele-titulo">{{ t('telemedicina.titulo') }}</h1>
    <p>{{ t('telemedicina.ajuda') }}</p>
    <ErroTelemedicina v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('telemedicina.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!lista.data.value.ligada"
        :texto="t('telemedicina.desligada', { motivo: lista.data.value.motivo ?? '' })"
        variante="info"
        data-testid="tele-desligada"
      />
      <SanteAlerta
        v-if="!lista.data.value.profissional"
        :texto="t('telemedicina.semProfissional')"
        variante="info"
      />
      <form class="filtros" role="search" data-testid="tele-filtro" @submit.prevent="filtrar">
        <span class="campo">
          <label for="tele-data">{{ t('telemedicina.data') }}</label>
          <input id="tele-data" v-model="fData" type="date" data-testid="tele-data" />
        </span>
        <label
          ><input v-model="fMinhas" type="checkbox" data-testid="tele-minhas" />
          {{ t('telemedicina.minhas') }}</label
        >
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('telemedicina.atualizar')" />
      </form>
      <SanteAlerta v-if="lista.data.value.truncado" :texto="t('telemedicina.truncado')" variante="info" />

      <h2>{{ t('telemedicina.teleconsultas') }} · {{ dia(lista.data.value.data) }}</h2>
      <p v-if="lista.data.value.teleconsultas.length === 0" data-testid="tele-nenhuma">
        {{ t('telemedicina.nenhumaTeleconsulta') }}
      </p>
      <table v-else class="tabela" data-testid="tele-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('telemedicina.colunas.hora') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.paciente') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.agenda') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.situacao') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.teleconsultas" :key="x.id" :data-testid="`tele-item-${x.id}`">
            <td>{{ hora(x.hora) }}</td>
            <td>{{ x.paciente?.nome ?? '' }}</td>
            <td>{{ x.agenda }}</td>
            <td>
              <strong v-if="x.pacienteNaEspera" :data-testid="`tele-espera-${x.id}`">{{
                t('telemedicina.situacoes.aguardando')
              }}</strong>
              <span v-else>{{ t(`telemedicina.situacoes.${x.situacao}`) }}</span>
            </td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('telemedicina.abrir')"
                :data-testid="`tele-abrir-${x.id}`"
                @acionar="roteador.push({ name: 'telemedicina.detalhe', params: { id: x.id } })"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ t('telemedicina.interconsultas') }}</h2>
      <p v-if="lista.data.value.interconsultas.length === 0">{{ t('telemedicina.nenhumaInterconsulta') }}</p>
      <table v-else class="tabela" data-testid="tele-inter-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('telemedicina.colunas.hora') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.paciente') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.agenda') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.situacao') }}</th>
            <th scope="col">{{ t('telemedicina.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.interconsultas" :key="x.id" :data-testid="`tele-inter-${x.id}`">
            <td>{{ dia(x.data) }} {{ hora(x.hora) }}</td>
            <td>{{ x.paciente?.nome ?? '' }}</td>
            <td>{{ x.agenda }}</td>
            <td>{{ t(`telemedicina.situacoes.${x.situacao}`) }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('telemedicina.abrir')"
                :data-testid="`tele-inter-abrir-${x.id}`"
                @acionar="roteador.push({ name: 'telemedicina.detalhe', params: { id: x.id } })"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <section
        v-if="podeRealizar && lista.data.value.ligada && lista.data.value.profissional"
        class="painel"
        aria-labelledby="tele-pedir"
        data-testid="tele-pedir"
      >
        <h2 id="tele-pedir">{{ t('telemedicina.pedir.titulo') }}</h2>
        <p>{{ t('telemedicina.pedir.ajuda') }}</p>
        <form class="filtros" role="search" @submit.prevent="buscarAtendimentos">
          <span class="campo">
            <label for="tele-busca-atd">{{ t('telemedicina.pedir.buscarAtendimento') }}</label>
            <input
              id="tele-busca-atd"
              v-model="termoAtendimento"
              type="search"
              autocomplete="off"
              maxlength="60"
              data-testid="tele-busca-atd"
            />
          </span>
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('telemedicina.atualizar')" />
        </form>
        <div class="filtros">
          <SanteSelecao
            v-model="atendimento"
            :rotulo="t('telemedicina.pedir.atendimento')"
            :opcoes="opcoesAtendimento"
            :busca="true"
            data-testid="tele-pedir-atendimento"
          />
          <SanteSelecao
            v-model="convidado"
            :rotulo="t('telemedicina.pedir.convidado')"
            :opcoes="opcoesConvidado"
            :busca="true"
            data-testid="tele-pedir-convidado"
          />
        </div>
        <SanteCampoTexto
          id="tele-pedir-motivo"
          v-model="motivo"
          :rotulo="t('telemedicina.pedir.motivo')"
          :max-bytes="1000"
          multilinha
          data-testid="tele-pedir-motivo"
        />
        <label
          ><input v-model="consentimento" type="checkbox" data-testid="tele-pedir-consentimento" />
          {{ t('telemedicina.pedir.consentimento') }}</label
        >
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <SanteBotao
          :rotulo="t('telemedicina.pedir.enviar')"
          :desabilitado="ocupado"
          data-testid="tele-pedir-enviar"
          @acionar="pedir"
        />
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="tele-mensagem">{{ mensagem }}</p>
    <ErroTelemedicina v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
