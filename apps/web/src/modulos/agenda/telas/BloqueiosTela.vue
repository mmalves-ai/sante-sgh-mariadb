<script setup lang="ts">
// Bloqueios e indisponibilidades (ficha do M17, seção 7): `/agenda/consultas/bloqueios`. Bloqueio de período com
// motivo codificado e previsão de retorno; a prévia mostra os vagos que fecham e os marcados (para remarcar antes).
// Encerrar devolve só os horários que o bloqueio fechou.
import type { PreviaBloqueio } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { bloquear, encerrarBloqueio, listarBloqueios, novaChave, previaBloqueio } from '../api-agenda.js';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr, horaDoContrato } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { opcoes, opcoesAgenda, pode, motivoGravacao } = usarAgenda();
const agenda = ref('');
const inicio = ref('');
const fim = ref('');
const horaInicio = ref('');
const horaFim = ref('');
const motivo = ref('FERIAS');
const complemento = ref('');
const previsao = ref('');
const previa = ref<PreviaBloqueio | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const podeBloquear = pode('agenda.bloquearHorarios');
const podeRemarcar = pode('agenda.remarcarConsulta');
/** Dias com marcados na prévia: cada um abre a remarcação em lote com a agenda e o dia de origem escolhidos. */
const diasMarcados = computed(() => [...new Set((previa.value?.marcados ?? []).map((m) => m.data))].sort());
const lista = useQuery({
  queryKey: computed(() => ['agenda', 'bloqueios', agenda.value]),
  queryFn: () => listarBloqueios(agenda.value ? Number(agenda.value) : null),
});
const escolhas = computed(() => [{ valor: '', rotulo: t('agenda.todas') }, ...opcoesAgenda.value]);
const motivos = computed(() =>
  (opcoes.data.value?.motivosBloqueio ?? []).map((m) => ({ valor: m.codigo, rotulo: m.rotulo })),
);
const periodo = () => ({
  agenda: Number(agenda.value),
  inicio: inicio.value,
  fim: fim.value,
  horaInicio: horaDoContrato(horaInicio.value),
  horaFim: horaDoContrato(horaFim.value),
});

async function verPrevia(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    previa.value = await previaBloqueio(periodo());
  } catch (e) {
    erro.value = e;
  }
}
async function gravar(): Promise<void> {
  erro.value = null;
  try {
    const r = await bloquear(
      {
        ...periodo(),
        motivo: motivo.value,
        ...(complemento.value.trim() ? { complemento: complemento.value } : {}),
        previsaoRetorno: previsao.value || null,
      },
      novaChave('bloquear'),
    );
    mensagem.value = r.mensagem;
    previa.value = null;
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
  } catch (e) {
    erro.value = e;
  }
}
async function encerrar(ag: number, id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await encerrarBloqueio(ag, id, novaChave('encerrar'))).mensagem;
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="bloqueios-titulo" data-testid="tela-bloqueios">
    <h1 id="bloqueios-titulo">{{ t('agenda.bloqueios.titulo') }}</h1>
    <p>{{ t('agenda.bloqueios.texto') }}</p>
    <AvisoGravacao :motivo="motivoGravacao" />
    <SanteSelecao v-model="agenda" :rotulo="t('agenda.agenda')" :opcoes="escolhas" />

    <form v-if="agenda" class="painel" @submit.prevent="verPrevia">
      <div class="filtros">
        <div class="campo">
          <label for="bloq-inicio">{{ t('agenda.bloqueios.inicio') }}</label>
          <input id="bloq-inicio" v-model="inicio" type="date" required data-testid="bloqueio-inicio" />
        </div>
        <div class="campo">
          <label for="bloq-fim">{{ t('agenda.bloqueios.fim') }}</label>
          <input id="bloq-fim" v-model="fim" type="date" required data-testid="bloqueio-fim" />
        </div>
        <div class="campo">
          <label for="bloq-hi">{{ t('agenda.bloqueios.horaInicio') }}</label>
          <input
            id="bloq-hi"
            v-model="horaInicio"
            inputmode="numeric"
            :placeholder="t('agenda.horaExemplo')"
          />
        </div>
        <div class="campo">
          <label for="bloq-hf">{{ t('agenda.bloqueios.horaFim') }}</label>
          <input id="bloq-hf" v-model="horaFim" inputmode="numeric" :placeholder="t('agenda.horaExemplo')" />
        </div>
      </div>
      <div class="filtros">
        <SanteSelecao v-model="motivo" :rotulo="t('agenda.motivo')" :opcoes="motivos" />
        <div class="campo">
          <label for="bloq-prev">{{ t('agenda.bloqueios.previsao') }}</label>
          <input id="bloq-prev" v-model="previsao" type="date" />
        </div>
      </div>
      <SanteCampoTexto v-model="complemento" :rotulo="t('agenda.complemento')" :max-bytes="200" />
      <SanteBotao tipo="submit" variante="secundario" :rotulo="t('agenda.bloqueios.previa')" />
    </form>

    <section v-if="previa" class="painel" aria-labelledby="bloq-previa" data-testid="previa-bloqueio">
      <h2 id="bloq-previa">
        {{
          t('agenda.bloqueios.resumoPrevia', {
            livres: previa.horariosLivres.length,
            marcados: previa.marcados.length,
            ja: previa.jaBloqueados,
          })
        }}
      </h2>
      <template v-if="previa.marcados.length">
        <h3>{{ t('agenda.bloqueios.marcados') }}</h3>
        <ul>
          <li v-for="m in previa.marcados" :key="m.id">
            <RouterLink :to="`/agenda/consultas/marcacoes/${m.id}`"
              >{{ dataBr(m.data) }} {{ horaBr(m.hora) }} · {{ m.paciente }}</RouterLink
            >
          </li>
        </ul>
        <ul v-if="podeRemarcar" data-testid="remarcar-lote-bloqueio">
          <li v-for="dia in diasMarcados" :key="dia">
            <RouterLink :to="{ path: '/agenda/espera', query: { agenda, origem: dia } }">
              {{ t('agenda.bloqueios.remarcarLote', { data: dataBr(dia) }) }}
            </RouterLink>
          </li>
        </ul>
      </template>
      <SanteBotao
        v-if="podeBloquear"
        :rotulo="t('agenda.bloqueios.bloquear')"
        data-testid="botao-bloquear"
        @acionar="gravar"
      />
    </section>

    <section class="painel" aria-labelledby="bloq-ativos">
      <h2 id="bloq-ativos">{{ t('agenda.bloqueios.ativos') }}</h2>
      <ErroAgenda v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('agenda.carregando') }}</p>
      <p v-else-if="lista.data.value.itens.length === 0">{{ t('agenda.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-bloqueios">
        <caption class="sgh-visualmente-oculto">
          {{
            t('agenda.bloqueios.ativos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('agenda.agenda') }}</th>
            <th scope="col">{{ t('agenda.bloqueios.periodo') }}</th>
            <th scope="col">{{ t('agenda.motivo') }}</th>
            <th scope="col">{{ t('agenda.bloqueios.horarios') }}</th>
            <th scope="col">{{ t('agenda.bloqueios.autor') }}</th>
            <th scope="col">{{ t('agenda.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in lista.data.value.itens" :key="b.id" :data-testid="`bloqueio-${b.id}`">
            <td>{{ b.nomeAgenda }}</td>
            <td>
              {{ t('agenda.intervalo', { de: dataBr(b.inicio), ate: dataBr(b.fim) }) }}
              <template v-if="b.horaInicio">
                ({{ t('agenda.intervalo', { de: horaBr(b.horaInicio), ate: horaBr(b.horaFim) }) }})</template
              >
            </td>
            <td>
              {{ b.rotuloMotivo }}<template v-if="b.complemento">: {{ b.complemento }}</template>
            </td>
            <td>{{ b.horarios }}</td>
            <td>{{ b.autor }}</td>
            <td>
              <SanteBotao
                v-if="podeBloquear"
                variante="destrutivo"
                :rotulo="t('agenda.bloqueios.encerrar')"
                :confirmacao="
                  t('agenda.bloqueios.encerrarPergunta', { inicio: dataBr(b.inicio), fim: dataBr(b.fim) })
                "
                @acionar="encerrar(b.agenda, b.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p v-if="mensagem" role="status" data-testid="bloqueio-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
