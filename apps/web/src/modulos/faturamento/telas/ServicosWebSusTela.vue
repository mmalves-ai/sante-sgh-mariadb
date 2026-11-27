<script setup lang="ts">
// Serviços web do SUS (F7, 08-INTG linha 131, C1-054) — `Faturamento > Faturamento SUS > Serviços web do SUS`:
// o rastreamento de câncer (pelo prontuário: os exames pedidos do paciente, a linha de cuidado escolhida e o botão
// Registrar) e o cadastro de prestador (busca do profissional pelo nome); depois, a lista dos envios com as respostas,
// o Enviar e o Cancelar com motivo. As regras ficam no domínio e no servidor (a tela só mostra a recusa). Fora de
// produção responde o simulador (selo na tela, decisão 53); o envio real depende da definição do gestor do SUS, e o
// aviso lista o que pedir (catálogo da central de integrações externas, `sus-webservices`).
import { entradaIntegracaoExterna } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarPrestadoresSus,
  cancelarServicoWebSus,
  type EnvioServicoWebSus,
  enviarServicoWebSus,
  LINHAS_CUIDADO_SUS_TELA,
  type LinhaCuidadoSusTela,
  lerRastreamentoSus,
  lerServicosWebSus,
  registrarServicoWebSus,
  SERVICOS_WEB_SUS_TELA,
  type ServicoWebSusTela,
  SITUACOES_ENVIO_SUS_TELA,
  type SituacaoEnvioSusTela,
} from '../api-sus-servico-web.js';

const { t } = useI18n();
const P = 'faturamentoSus.servicoWeb';
const qc = useQueryClient();
const podeEnviar = computed(() => pode('faturamento.susServicoWeb.enviar'));
const pedirAoGestor = entradaIntegracaoExterna('sus-webservices')?.oQuePedirAoFornecedor ?? [];

// ── Envios ──
const filtro = reactive<{ servico: ServicoWebSusTela | ''; situacao: SituacaoEnvioSusTela | '' }>({
  servico: '',
  situacao: '',
});
const envios = useQuery({
  queryKey: computed(() => ['sus-servicos-web', filtro.servico, filtro.situacao]),
  queryFn: () =>
    lerServicosWebSus({
      ...(filtro.servico ? { servico: filtro.servico } : {}),
      ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
    }),
});
const opServicos = computed(() => [
  { valor: '' as const, rotulo: t(`${P}.envios.todos`) },
  ...SERVICOS_WEB_SUS_TELA.map((s) => ({ valor: s, rotulo: t(`${P}.servico.${s}`) })),
]);
const opSituacoes = computed(() => [
  { valor: '' as const, rotulo: t(`${P}.envios.todas`) },
  ...SITUACOES_ENVIO_SUS_TELA.map((s) => ({ valor: s, rotulo: t(`${P}.situacao.${s}`) })),
]);
const quem = (e: EnvioServicoWebSus): string =>
  e.servico === 'rastreamento_cancer'
    ? `${e.pacienteNome ?? ''}${e.prontuario ? ` (${e.prontuario})` : ''}${e.exameNome ? ` · ${e.exameNome}` : ''}`
    : (e.profissionalNome ?? '');
const situacaoTexto = (s: string | null): string =>
  s && (SITUACOES_ENVIO_SUS_TELA as readonly string[]).includes(s) ? t(`${P}.situacao.${s}`) : (s ?? '');
const ativo = (s: string): boolean => !['aceito', 'aceito_com_critica', 'cancelado'].includes(s);

const aviso = ref('');
const atualizar = async (msg: string) => {
  aviso.value = t(msg);
  await qc.invalidateQueries({ queryKey: ['sus-servicos-web'] });
};

// ── Rastreamento de câncer ──
const prontuario = ref('');
const prontuarioBuscado = ref('');
const rastreamento = useQuery({
  queryKey: computed(() => ['sus-servicos-web-rastreamento', prontuarioBuscado.value]),
  queryFn: () => lerRastreamentoSus(prontuarioBuscado.value),
  enabled: computed(() => prontuarioBuscado.value !== ''),
});
const linhas = reactive<Record<number, LinhaCuidadoSusTela | null>>({});
const opLinhas = computed(() => [
  { valor: null, rotulo: t(`${P}.rastreamento.escolhaLinha`) },
  ...LINHAS_CUIDADO_SUS_TELA.map((l) => ({ valor: l, rotulo: t(`${P}.linha.${l}`) })),
]);
const registrarExame = useMutation({
  mutationFn: (exameItem: number) =>
    registrarServicoWebSus({
      servico: 'rastreamento_cancer',
      exameItem,
      linha: linhas[exameItem] as LinhaCuidadoSusTela,
    }),
  onSuccess: async () => {
    await atualizar(`${P}.envios.registrado`);
    await qc.invalidateQueries({ queryKey: ['sus-servicos-web-rastreamento'] });
  },
});

// ── Cadastro de prestador ──
const termo = ref('');
const termoBuscado = ref('');
const prestadores = useQuery({
  queryKey: computed(() => ['sus-servicos-web-prestadores', termoBuscado.value]),
  queryFn: () => buscarPrestadoresSus(termoBuscado.value),
  enabled: computed(() => termoBuscado.value.length >= 3),
});
const registrarPrestador = useMutation({
  mutationFn: (profissional: number) =>
    registrarServicoWebSus({ servico: 'cadastro_prestador', profissional }),
  onSuccess: () => atualizar(`${P}.envios.registrado`),
});

// ── Enviar e cancelar ──
const enviarEnvio = useMutation({
  mutationFn: (id: number) => enviarServicoWebSus(id),
  onSuccess: () => atualizar(`${P}.envios.enviado`),
});
const cancelando = ref<EnvioServicoWebSus | null>(null);
const motivo = ref('');
const cancelarEnvio = useMutation({
  mutationFn: (e: EnvioServicoWebSus) => cancelarServicoWebSus(e.id, e.versao, motivo.value.trim()),
  onSuccess: async () => {
    cancelando.value = null;
    motivo.value = '';
    await atualizar(`${P}.envios.cancelado`);
  },
});
const erroAcao = computed(
  () =>
    registrarExame.error.value ??
    registrarPrestador.error.value ??
    enviarEnvio.error.value ??
    cancelarEnvio.error.value,
);
</script>

<template>
  <section class="tela" aria-labelledby="servicos-web-sus-titulo" data-testid="tela-servicos-web-sus">
    <h1 id="servicos-web-sus-titulo">{{ t(`${P}.titulo`) }}</h1>
    <p class="ajuda">{{ t(`${P}.explicacao`) }}</p>

    <div v-if="envios.data.value" class="modo" role="status" data-testid="servicos-web-sus-modo">
      <span class="selo" data-testid="servicos-web-sus-selo">{{
        t(`${P}.modo.${envios.data.value.modo}`)
      }}</span>
      {{ t(envios.data.value.modo === 'simulador' ? `${P}.modo.textoSimulador` : `${P}.modo.textoProducao`) }}
    </div>
    <div class="fornecedor" data-testid="servicos-web-sus-fornecedor">
      <p>{{ t(`${P}.modo.fornecedor`) }}</p>
      <ul>
        <li v-for="item in pedirAoGestor" :key="item">{{ item }}</li>
      </ul>
    </div>
    <p v-if="!podeEnviar" class="ajuda" data-testid="servicos-web-sus-somente-leitura">
      {{ t(`${P}.somenteLeitura`) }}
    </p>
    <p v-if="aviso" role="status" data-testid="servicos-web-sus-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erroAcao" :erro="erroAcao" />

    <template v-if="podeEnviar">
      <h2>{{ t(`${P}.rastreamento.titulo`) }}</h2>
      <form class="formulario" @submit.prevent="prontuarioBuscado = prontuario.trim()">
        <label
          >{{ t(`${P}.rastreamento.prontuario`) }}
          <input
            v-model="prontuario"
            inputmode="numeric"
            pattern="\d{1,20}"
            required
            data-testid="servicos-web-sus-prontuario"
        /></label>
        <button type="submit" data-testid="servicos-web-sus-buscar-exames">
          {{ t(`${P}.rastreamento.buscar`) }}
        </button>
      </form>
      <MensagemErro v-if="rastreamento.isError.value" :erro="rastreamento.error.value" />
      <template v-else-if="rastreamento.data.value">
        <p v-if="!rastreamento.data.value.paciente" data-testid="servicos-web-sus-sem-paciente">
          {{ t(`${P}.rastreamento.semPaciente`) }}
        </p>
        <template v-else>
          <p data-testid="servicos-web-sus-paciente">
            <strong>{{ rastreamento.data.value.paciente.nome }}</strong>
            <span v-if="!rastreamento.data.value.paciente.temCns" class="alerta">
              — {{ t(`${P}.rastreamento.semCns`) }}</span
            >
          </p>
          <p v-if="rastreamento.data.value.exames.length === 0">{{ t(`${P}.rastreamento.semExames`) }}</p>
          <table v-else data-testid="servicos-web-sus-exames">
            <thead>
              <tr>
                <th scope="col">{{ t(`${P}.rastreamento.exame`) }}</th>
                <th scope="col">{{ t(`${P}.rastreamento.requisicao`) }}</th>
                <th scope="col">{{ t(`${P}.rastreamento.solicitadoEm`) }}</th>
                <th scope="col">{{ t(`${P}.rastreamento.envio`) }}</th>
                <th scope="col">{{ t(`${P}.rastreamento.linhaCuidado`) }}</th>
                <th scope="col">
                  <span class="sr-only">{{ t(`${P}.envios.acoes`) }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ex in rastreamento.data.value.exames"
                :key="ex.exameItem"
                :data-testid="`servicos-web-sus-exame-${ex.exameItem}`"
              >
                <td>{{ ex.exame }}</td>
                <td>{{ ex.requisicao }}</td>
                <td>{{ ex.solicitadoEm }}</td>
                <td>{{ situacaoTexto(ex.envioSituacao) }}</td>
                <td>
                  <SanteSelecao
                    :model-value="linhas[ex.exameItem] ?? null"
                    :rotulo="`${t(`${P}.rastreamento.linhaCuidado`)}: ${ex.exame}`"
                    ocultar-rotulo
                    :opcoes="opLinhas"
                    :data-testid="`servicos-web-sus-linha-${ex.exameItem}`"
                    @update:model-value="(v) => (linhas[ex.exameItem] = v)"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    :disabled="!linhas[ex.exameItem] || registrarExame.isPending.value"
                    :data-testid="`servicos-web-sus-registrar-exame-${ex.exameItem}`"
                    @click="registrarExame.mutate(ex.exameItem)"
                  >
                    {{ t(`${P}.rastreamento.registrar`) }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>

      <h2>{{ t(`${P}.prestador.titulo`) }}</h2>
      <form class="formulario" @submit.prevent="termoBuscado = termo.trim()">
        <label
          >{{ t(`${P}.prestador.termo`) }}
          <input v-model="termo" minlength="3" required data-testid="servicos-web-sus-termo"
        /></label>
        <button type="submit" data-testid="servicos-web-sus-buscar-prestador">
          {{ t(`${P}.prestador.buscar`) }}
        </button>
      </form>
      <MensagemErro v-if="prestadores.isError.value" :erro="prestadores.error.value" />
      <template v-else-if="prestadores.data.value">
        <p v-if="prestadores.data.value.itens.length === 0">{{ t(`${P}.prestador.nenhum`) }}</p>
        <ul v-else class="prestadores" data-testid="servicos-web-sus-prestadores">
          <li
            v-for="pr in prestadores.data.value.itens"
            :key="pr.id"
            :data-testid="`servicos-web-sus-prestador-${pr.id}`"
          >
            <strong>{{ pr.nome }}</strong>
            · {{ pr.temCns ? t(`${P}.prestador.temCns`) : t(`${P}.prestador.semCns`) }} ·
            {{ pr.cbo ?? t(`${P}.prestador.semCbo`) }}
            <span v-if="!pr.ativo"> · {{ t(`${P}.prestador.inativo`) }}</span>
            <button
              type="button"
              :disabled="registrarPrestador.isPending.value"
              :data-testid="`servicos-web-sus-registrar-prestador-${pr.id}`"
              @click="registrarPrestador.mutate(pr.id)"
            >
              {{ t(`${P}.prestador.registrar`) }}
            </button>
          </li>
        </ul>
      </template>
    </template>

    <h2>{{ t(`${P}.envios.titulo`) }}</h2>
    <div class="formulario">
      <SanteSelecao
        v-model="filtro.servico"
        :rotulo="t(`${P}.envios.filtroServico`)"
        :opcoes="opServicos"
        data-testid="servicos-web-sus-filtro-servico"
      />
      <SanteSelecao
        v-model="filtro.situacao"
        :rotulo="t(`${P}.envios.filtroSituacao`)"
        :opcoes="opSituacoes"
        data-testid="servicos-web-sus-filtro-situacao"
      />
    </div>
    <MensagemErro v-if="envios.isError.value" :erro="envios.error.value" />
    <template v-else-if="envios.data.value">
      <p v-if="envios.data.value.itens.length === 0" data-testid="servicos-web-sus-sem-envios">
        {{ t(`${P}.envios.nenhum`) }}
      </p>
      <table v-else data-testid="servicos-web-sus-envios">
        <thead>
          <tr>
            <th scope="col">{{ t(`${P}.envios.servico`) }}</th>
            <th scope="col">{{ t(`${P}.envios.quem`) }}</th>
            <th scope="col">{{ t(`${P}.envios.situacao`) }}</th>
            <th scope="col">{{ t(`${P}.envios.tentativas`) }}</th>
            <th scope="col">{{ t(`${P}.envios.protocolo`) }}</th>
            <th scope="col">{{ t(`${P}.envios.retornos`) }}</th>
            <th scope="col">{{ t(`${P}.envios.acoes`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in envios.data.value.itens"
            :key="e.id"
            :data-testid="`servicos-web-sus-envio-${e.id}`"
          >
            <td>{{ t(`${P}.servico.${e.servico}`) }}</td>
            <td>{{ quem(e) }}</td>
            <td :data-testid="`servicos-web-sus-situacao-${e.id}`">{{ situacaoTexto(e.situacao) }}</td>
            <td>{{ e.tentativas }}</td>
            <td :data-testid="`servicos-web-sus-protocolo-${e.id}`">{{ e.protocolo ?? '' }}</td>
            <td>
              <ul v-if="e.retornos.length" class="retornos">
                <li v-for="r in e.retornos" :key="r.sequencia">
                  {{ r.tipo }}<template v-if="r.codigo"> {{ r.codigo }}</template
                  ><template v-if="r.mensagem">: {{ r.mensagem }}</template>
                </li>
              </ul>
            </td>
            <td>
              <template v-if="podeEnviar && ativo(e.situacao)">
                <button
                  type="button"
                  :disabled="enviarEnvio.isPending.value"
                  :data-testid="`servicos-web-sus-enviar-${e.id}`"
                  @click="enviarEnvio.mutate(e.id)"
                >
                  {{ t(`${P}.envios.enviar`) }}
                </button>
                <button
                  type="button"
                  :data-testid="`servicos-web-sus-cancelar-${e.id}`"
                  @click="cancelando = e"
                >
                  {{ t(`${P}.envios.cancelar`) }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="cancelando"
        class="formulario"
        data-testid="servicos-web-sus-cancelamento"
        @submit.prevent="cancelando && motivo.trim() && cancelarEnvio.mutate(cancelando)"
      >
        <label
          >{{ t(`${P}.envios.motivo`) }}
          <input v-model="motivo" required maxlength="500" data-testid="servicos-web-sus-motivo"
        /></label>
        <button
          type="submit"
          :disabled="!motivo.trim() || cancelarEnvio.isPending.value"
          data-testid="servicos-web-sus-confirmar-cancelar"
        >
          {{ t(`${P}.envios.confirmarCancelar`) }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.modo,
.fornecedor {
  margin: var(--sgh-espaco-2) 0;
}
.selo {
  display: inline-block;
  padding: 0 var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda);
  border-radius: 4px;
  font-weight: 600;
}
.alerta {
  color: var(--sgh-alerta-texto);
}
.prestadores li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: center;
  margin: var(--sgh-espaco-1) 0;
}
.retornos {
  margin: 0;
  padding-left: var(--sgh-espaco-2);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
