<script setup lang="ts">
// Atendimento SADT de externo (ficha do M26, seção 7): `/sadt/atendimentos`. Os atendimentos externos do dia que pedem
// exame, com a requisição de exames do setor (a conta do diagnóstico): abrir a requisição com o médico emissor e o
// solicitante (o médico externo do cadastro), a guia e a senha do convênio; e o protocolo do portal de resultados para
// o paciente (o código sai uma vez, para imprimir).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirRequisicao,
  buscarSolicitantesSadt,
  emitirProtocolo,
  listarRequisicoes,
  novaChave,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const data = ref(hojeLocal());
const termo = ref('');
const buscado = ref('');
const { gravacao, apoio, pode } = usarSadt();
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'requisicoes', data.value, buscado.value]),
  queryFn: () => listarRequisicoes(data.value, buscado.value || null),
});
const motivoRequisicao = computed(() =>
  gravacao.data.value && !gravacao.data.value.requisicao.ligada
    ? gravacao.data.value.requisicao.motivo
    : null,
);
const podeAbrir = computed(() => pode('requisicao', 'sadt.abrirRequisicao'));
const podeProtocolo = computed(() => pode('portal', 'protocolo'));
const emissores = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.executantes ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
const emissor = ref('');
const termoSolicitante = ref('');
const solicitantes = ref<{ id: number; nome: string; registro: string }[]>([]);
const medicoExterno = ref('');
const guia = ref('');
async function buscarSolicitante(): Promise<void> {
  solicitantes.value = await buscarSolicitantesSadt(termoSolicitante.value);
}
const opcoesSolicitantes = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...solicitantes.value.map((s) => ({ valor: String(s.id), rotulo: `${s.nome} (${s.registro})` })),
]);
const aberto = ref<string | null>(null);
const protocolo = ref<string | null>(null);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function abrir(atendimento: string): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await abrirRequisicao(
      {
        atendimento: Number(atendimento),
        emissor: Number(emissor.value),
        ...(medicoExterno.value
          ? { medicoExterno: Number(medicoExterno.value) }
          : { solicitante: Number(emissor.value) }),
        ...(guia.value.trim() ? { guia: guia.value.trim() } : {}),
      },
      novaChave('requisicao'),
    );
    mensagem.value = r.mensagem;
    aberto.value = null;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'requisicoes'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function gerarProtocolo(reg: number): Promise<void> {
  erro.value = null;
  protocolo.value = null;
  ocupado.value = true;
  try {
    const r = await emitirProtocolo(reg, novaChave('protocolo'));
    protocolo.value = r.protocolo;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="atd-sadt-titulo" data-testid="tela-sadt-atendimentos">
    <h1 id="atd-sadt-titulo">{{ t('sadt.atendimentos.titulo') }}</h1>
    <p>{{ t('sadt.atendimentos.texto') }}</p>
    <AvisoSadt :motivo="motivoRequisicao" />
    <div class="filtros">
      <span class="campo">
        <label for="atd-sadt-data">{{ t('sadt.data') }}</label>
        <input id="atd-sadt-data" v-model="data" type="date" />
      </span>
      <span class="campo">
        <label for="atd-sadt-termo">{{ t('sadt.termo') }}</label>
        <input id="atd-sadt-termo" v-model="termo" type="search" @keyup.enter="buscado = termo" />
      </span>
      <SanteBotao variante="secundario" :rotulo="t('sadt.buscar')" @acionar="buscado = termo" />
    </div>
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('sadt.nenhum') }}</p>
    <table v-else class="tabela" data-testid="tabela-requisicoes">
      <caption>
        {{
          t('sadt.atendimentos.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('sadt.atendimento') }}</th>
          <th scope="col">{{ t('sadt.paciente') }}</th>
          <th scope="col">{{ t('sadt.convenio') }}</th>
          <th scope="col">{{ t('sadt.atendimentos.conta') }}</th>
          <th scope="col">{{ t('sadt.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in lista.data.value.itens" :key="r.reg" :data-testid="`requisicao-${r.reg}`">
          <td>{{ r.reg }}</td>
          <td><PacienteSadt :paciente="r.paciente" /></td>
          <td>{{ r.convenio.nome }}</td>
          <td>
            {{
              r.conta
                ? `${r.conta.numero} · ${r.exames} ${t('sadt.examesRotulo').toLowerCase()}`
                : t('sadt.atendimentos.semConta')
            }}
          </td>
          <td class="acoes">
            <SanteBotao
              v-if="podeAbrir && !r.conta"
              variante="secundario"
              :rotulo="t('sadt.atendimentos.abrir')"
              :data-testid="`requisicao-abrir-${r.reg}`"
              @acionar="aberto = r.atendimento"
            />
            <SanteBotao
              v-if="podeProtocolo"
              variante="texto"
              :rotulo="t('sadt.atendimentos.protocolo')"
              :desabilitado="ocupado"
              :data-testid="`requisicao-protocolo-${r.reg}`"
              @acionar="gerarProtocolo(r.reg)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <section v-if="aberto" class="painel" aria-labelledby="abrir-req-titulo">
      <h2 id="abrir-req-titulo">{{ t('sadt.atendimentos.abrir') }} · {{ aberto }}</h2>
      <div class="filtros">
        <SanteSelecao
          v-model="emissor"
          :rotulo="t('sadt.atendimentos.emissor')"
          :opcoes="emissores"
          data-testid="requisicao-emissor"
        />
        <span class="campo">
          <label for="req-solicitante">{{ t('sadt.atendimentos.medicoExterno') }}</label>
          <input
            id="req-solicitante"
            v-model="termoSolicitante"
            type="search"
            @keyup.enter="buscarSolicitante"
          />
        </span>
        <SanteBotao variante="secundario" :rotulo="t('sadt.buscar')" @acionar="buscarSolicitante" />
        <SanteSelecao
          v-if="solicitantes.length"
          v-model="medicoExterno"
          :rotulo="t('sadt.solicitante')"
          :opcoes="opcoesSolicitantes"
        />
        <span class="campo">
          <label for="req-guia">{{ t('sadt.atendimentos.guia') }}</label>
          <input id="req-guia" v-model="guia" maxlength="20" />
        </span>
        <SanteBotao
          :rotulo="t('sadt.atendimentos.abrir')"
          :desabilitado="ocupado || !emissor"
          data-testid="requisicao-gravar"
          @acionar="abrir(aberto)"
        />
      </div>
    </section>
    <p v-if="protocolo" role="status" data-testid="requisicao-protocolo">
      {{ t('sadt.atendimentos.protocoloEmitido', { codigo: protocolo }) }}
    </p>
    <p v-if="mensagem" role="status" data-testid="requisicao-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
