<script setup lang="ts">
// F3.9, 08-INTG L133: modelos e regras de envio ao paciente pela Hal-AI, com conferência na hora (variáveis do texto,
// respostas da confirmação), e a visão por paciente: os pedidos registrados, a situação e os retornos; cancelar só o
// pendente, com o motivo (nada é apagado). C2-023: modelo do cliente inteiro (permissão de alcance do cliente), avisos
// gerados agora a partir dos eventos (marcação, véspera, resultado, alta) e o efeito da resposta na marcação.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarPedido,
  dispararEventos,
  gravarModelo,
  gravarModeloCliente,
  gravarRegra,
  lerModelos,
  lerRegras,
  pedidosDoPaciente,
} from '../api-comunicacao.js';

const VARIAVEIS = [
  'paciente_nome',
  'data',
  'hora',
  'profissional',
  'estabelecimento',
  'local',
  'servico',
  'link',
];
const FINALIDADES = [
  'confirmacao',
  'lembrete',
  'aviso',
  'resultado_disponivel',
  'cancelamento',
  'comprovante',
  'pesquisa_satisfacao',
  'outro',
];
const CANAIS = ['whatsapp', 'sms', 'email', 'push'];
const GATILHOS = [
  'agendamento_criado',
  'lembrete_agendamento',
  'confirmacao_agendamento',
  'resultado_liberado',
  'alta',
  'aniversario',
  'pesquisa_satisfacao',
  'cobranca',
  'manual',
];

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      modelos: 'Modelos de mensagem',
      regras: 'Regras de envio por tipo de aviso',
      novoModelo: 'Novo modelo',
      novaRegra: 'Nova regra',
      codigo: 'Código',
      descricao: 'Descrição',
      finalidade: 'Finalidade',
      canal: 'Canal',
      assunto: 'Assunto (e-mail)',
      corpo: 'Texto',
      sim: 'Resposta que confirma',
      nao: 'Resposta que recusa',
      gravar: 'Gravar',
      modelo: 'Modelo',
      gatilho: 'Aviso',
      antecedencia: 'Antecedência (minutos)',
      inicio: 'Enviar a partir de',
      fim: 'Enviar até',
      maximo: 'Máximo por paciente',
      consentimento: 'Exige consentimento',
      variaveis: 'Variáveis: {v}',
      desconhecidas: 'Variável desconhecida: {v}',
      paciente: 'Paciente (número interno)',
      verPaciente: 'Ver as mensagens do paciente',
      situacao: 'Situação',
      agendado: 'Envio previsto',
      retornos: 'Retornos',
      cancelar: 'Cancelar',
      motivo: 'Motivo do cancelamento',
      gravado: 'Gravado.',
      nenhum: 'Nenhuma mensagem para este paciente.',
      doCliente: 'Modelo do cliente inteiro (todos os estabelecimentos)',
      gerar: 'Gerar avisos dos eventos agora',
      gerados: 'Avisos gerados: {n}. Recusados: {r}.',
      efeito: 'Efeito na marcação',
      efeito_confirmar_presenca: 'Presença confirmada',
      efeito_pedir_cancelamento: 'Pedido de cancelamento aberto',
      efeito_pedir_reagendamento: 'Pedido de reagendamento aberto',
      efeito_nenhum: 'Sem efeito',
    },
  },
});

const listaVariaveis = VARIAVEIS.map((v) => '{' + '{' + v + '}' + '}').join(' ');
const cliente = useQueryClient();
const modelos = useQuery({ queryKey: ['integracoes', 'mensagens', 'modelos'], queryFn: lerModelos });
const regras = useQuery({ queryKey: ['integracoes', 'mensagens', 'regras'], queryFn: lerRegras });
const aviso = ref('');
const falha = ref('');

const lista = (xs: readonly string[]) => xs.map((x) => ({ valor: x, rotulo: x }));
const m = reactive({
  codigo: '',
  descricao: '',
  finalidade: 'lembrete',
  canal: 'whatsapp',
  assunto: '',
  corpo: '',
  respostaConfirmacao: '',
  respostaRecusa: '',
});
const modeloDoCliente = ref(false);
const desconhecidas = computed(() =>
  [...m.corpo.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((x) => x[1]!).filter((v) => !VARIAVEIS.includes(v)),
);
const r = reactive({
  codigo: '',
  descricao: '',
  modeloId: 0,
  gatilho: 'lembrete_agendamento',
  antecedenciaMinutos: 1440,
  horaInicio: '08:00',
  horaFim: '20:00',
  maximoEnviosPaciente: null as number | null,
  exigeConsentimento: true,
});
const opcoesModelo = computed(() =>
  (modelos.data.value?.itens ?? []).map((x) => ({ valor: x.id, rotulo: `${x.descricao} (${x.canal})` })),
);

async function executar(fn: () => Promise<unknown>) {
  aviso.value = '';
  falha.value = '';
  try {
    await fn();
    aviso.value = t('gravado');
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'mensagens'] });
  } catch (e) {
    falha.value = e instanceof Error ? e.message : String(e);
  }
}
const salvarModelo = () =>
  executar(() =>
    (modeloDoCliente.value ? gravarModeloCliente : gravarModelo)({
      ...m,
      assunto: m.assunto || null,
      respostaConfirmacao: m.respostaConfirmacao || null,
      respostaRecusa: m.respostaRecusa || null,
    }),
  );
const salvarRegra = () => executar(() => gravarRegra({ ...r }));
async function gerarAvisos() {
  aviso.value = '';
  falha.value = '';
  try {
    const d = await dispararEventos();
    const rec = Object.values(d.recusados).reduce((a, b) => a + b, 0);
    aviso.value = t('gerados', { n: d.pedidos, r: rec });
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'mensagens'] });
  } catch (e) {
    falha.value = e instanceof Error ? e.message : String(e);
  }
}
const efeitos = (rs: readonly { efeitoResposta?: string | null }[]) =>
  rs
    .map((x) => x.efeitoResposta)
    .filter((x): x is string => !!x)
    .map((x) => t('efeito_' + x))
    .join('; ');

const pacienteId = ref<number | null>(null);
const pedidos = useQuery({
  queryKey: computed(() => ['integracoes', 'mensagens', 'paciente', pacienteId.value]),
  queryFn: () => pedidosDoPaciente(pacienteId.value!),
  enabled: computed(() => !!pacienteId.value),
});
const motivo = ref('');
const cancelar = (id: number) => executar(() => cancelarPedido(id, motivo.value));
</script>

<template>
  <section class="painel" data-testid="mensagens-painel">
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <p v-if="falha" role="alert" data-testid="mensagens-falha">{{ falha }}</p>

    <h2>{{ t('modelos') }}</h2>
    <table v-if="modelos.data.value" data-testid="mensagens-modelos">
      <tr v-for="x in modelos.data.value.itens" :key="x.id">
        <td>{{ x.codigo }}</td>
        <td>{{ x.descricao }}</td>
        <td>{{ x.finalidade }}</td>
        <td>{{ x.canal }}</td>
      </tr>
    </table>
    <form data-testid="mensagens-novo-modelo" @submit.prevent="salvarModelo">
      <h3>{{ t('novoModelo') }}</h3>
      <label>{{ t('codigo') }} <input v-model="m.codigo" required maxlength="30" /></label>
      <label>{{ t('descricao') }} <input v-model="m.descricao" required maxlength="150" /></label>
      <SanteSelecao v-model="m.finalidade" :rotulo="t('finalidade')" :opcoes="lista(FINALIDADES)" />
      <SanteSelecao v-model="m.canal" :rotulo="t('canal')" :opcoes="lista(CANAIS)" />
      <label v-if="m.canal === 'email'"
        >{{ t('assunto') }} <input v-model="m.assunto" maxlength="255"
      /></label>
      <label>{{ t('corpo') }} <textarea v-model="m.corpo" required rows="3" /></label>
      <p class="secundario">{{ t('variaveis', { v: listaVariaveis }) }}</p>
      <p v-if="desconhecidas.length" role="alert">
        {{ t('desconhecidas', { v: desconhecidas.join(', ') }) }}
      </p>
      <template v-if="m.finalidade === 'confirmacao'">
        <label>{{ t('sim') }} <input v-model="m.respostaConfirmacao" maxlength="30" /></label>
        <label>{{ t('nao') }} <input v-model="m.respostaRecusa" maxlength="30" /></label>
      </template>
      <label
        ><input v-model="modeloDoCliente" type="checkbox" data-testid="mensagens-modelo-cliente" />
        {{ t('doCliente') }}</label
      >
      <button type="submit" :disabled="desconhecidas.length > 0">{{ t('gravar') }}</button>
    </form>

    <h2>{{ t('regras') }}</h2>
    <table v-if="regras.data.value" data-testid="mensagens-regras">
      <tr v-for="x in regras.data.value.itens" :key="x.id">
        <td>{{ x.codigo }}</td>
        <td>{{ x.gatilho }}</td>
        <td>{{ x.modelo }}</td>
        <td>{{ x.canal }}</td>
        <td>{{ x.antecedenciaMinutos ?? '' }}</td>
        <td>{{ x.horaInicio ?? '' }}</td>
        <td>{{ x.horaFim ?? '' }}</td>
      </tr>
    </table>
    <form data-testid="mensagens-nova-regra" @submit.prevent="salvarRegra">
      <h3>{{ t('novaRegra') }}</h3>
      <label>{{ t('codigo') }} <input v-model="r.codigo" required maxlength="40" /></label>
      <label>{{ t('descricao') }} <input v-model="r.descricao" required maxlength="150" /></label>
      <SanteSelecao v-model="r.modeloId" :rotulo="t('modelo')" :opcoes="opcoesModelo" obrigatorio />
      <SanteSelecao v-model="r.gatilho" :rotulo="t('gatilho')" :opcoes="lista(GATILHOS)" />
      <label>{{ t('antecedencia') }} <input v-model.number="r.antecedenciaMinutos" type="number" /></label>
      <label>{{ t('inicio') }} <input v-model="r.horaInicio" type="time" /></label>
      <label>{{ t('fim') }} <input v-model="r.horaFim" type="time" /></label>
      <label>{{ t('maximo') }} <input v-model.number="r.maximoEnviosPaciente" type="number" min="1" /></label>
      <label><input v-model="r.exigeConsentimento" type="checkbox" /> {{ t('consentimento') }}</label>
      <button type="submit">{{ t('gravar') }}</button>
    </form>

    <button type="button" data-testid="mensagens-gerar" @click="gerarAvisos">{{ t('gerar') }}</button>

    <h2>{{ t('verPaciente') }}</h2>
    <label
      >{{ t('paciente') }}
      <input v-model.number="pacienteId" type="number" min="1" data-testid="mensagens-paciente"
    /></label>
    <p v-if="pedidos.data.value && !pedidos.data.value.itens.length">{{ t('nenhum') }}</p>
    <table v-else-if="pedidos.data.value" data-testid="mensagens-pedidos">
      <tr>
        <th>{{ t('gatilho') }}</th>
        <th>{{ t('canal') }}</th>
        <th>{{ t('situacao') }}</th>
        <th>{{ t('agendado') }}</th>
        <th>{{ t('retornos') }}</th>
        <th>{{ t('efeito') }}</th>
        <th />
      </tr>
      <tr v-for="p in pedidos.data.value.itens" :key="p.id">
        <td>{{ p.regra ?? p.motivo }}</td>
        <td>{{ p.canal }}</td>
        <td>{{ p.situacao }}</td>
        <td>{{ p.agendadoPara ? new Date(p.agendadoPara).toLocaleString('pt-BR') : '' }}</td>
        <td>{{ p.retornos.map((x) => x.respostaInterpretada ?? x.tipo).join(' → ') }}</td>
        <td data-testid="mensagens-efeito">{{ efeitos(p.retornos) }}</td>
        <td>
          <template v-if="p.situacao === 'pendente'">
            <input v-model="motivo" :placeholder="t('motivo')" maxlength="500" />
            <button type="button" :disabled="!motivo.trim()" @click="cancelar(p.id)">
              {{ t('cancelar') }}
            </button>
          </template>
        </td>
      </tr>
    </table>
  </section>
</template>
