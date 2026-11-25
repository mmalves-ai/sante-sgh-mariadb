<script setup lang="ts">
// Transplante para a central estadual (F8, 06-SUS linha 65) — `Faturamento > Faturamento SUS > Transplantes`. Uma
// tela, com a visão por paciente: a busca pelo prontuário ou nome filtra as duas listas e já preenche o paciente do
// formulário novo. Receptores: inscrição, aptidão, saída da lista (o histórico guarda cada mudança como pendente de
// envio), número da central e envio registrados num passo só, ficha impressa e arquivo de conferência (CSV).
// Doadores: notificação com número automático, protocolo de morte encefálica, abordagem familiar, desfecho e o
// protocolo devolvido pela central. A validação aparece enquanto se digita, com as mesmas regras do domínio que a
// API aplica; nada é apagado.
import {
  conferirInscricao,
  conferirNotificacaoDoador,
  DESFECHOS_DOACAO,
  type DesfechoDoacao,
  PRIORIDADES_INSCRICAO,
  SITUACOES_INSCRICAO,
  SITUACOES_NOTIFICACAO,
  type SituacaoInscricao,
  type SituacaoNotificacao,
  TIPOS_DOADOR,
  type TipoDoador,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarInscricaoTransplante,
  alterarNotificacaoDoador,
  buscarPacientesTransplante,
  type CorpoInscricao,
  type CorpoNotificacao,
  type Inscricao,
  inscreverReceptor,
  lerInscricaoTransplante,
  lerInscricoesTransplante,
  lerNotificacoesDoador,
  lerOpcoesTransplante,
  type NotificacaoDoador,
  notificarDoador,
  type PacienteTransplante,
  registrarCentralInscricao,
  registrarProtocoloDoador,
  urlConferenciaTransplante,
} from '../api-transplante.js';
import { mensagensTransplante } from '../i18n-transplante.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensTransplante });
const v = (x: string | null | undefined) => (x ? t(`valores.${x}`) : '');
const cliente = useQueryClient();
const podeRegistrar = computed(() => pode('faturamento.susTransplante.registrar'));
const opcoes = useQuery({ queryKey: ['sus', 'transplante', 'opcoes'], queryFn: lerOpcoesTransplante });

// Paciente em foco (visão por paciente).
const busca = ref('');
const termo = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termo.value = b.trim()), 300);
});
const achados = useQuery({
  queryKey: computed(() => ['sus', 'transplante', 'pacientes', termo.value]),
  queryFn: () => buscarPacientesTransplante(termo.value),
  enabled: computed(() => termo.value.length >= 2),
});
const paciente = ref<PacienteTransplante | null>(null);
const escolherPaciente = (p: PacienteTransplante | null) => {
  paciente.value = p;
  busca.value = '';
  termo.value = '';
};

const aba = ref<'receptores' | 'doadores'>('receptores');
const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t('salvo');
    formReceptor.value = null;
    formDoador.value = null;
    void cliente.invalidateQueries({ queryKey: ['sus', 'transplante'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

const opOrgaos = computed(() => [
  { valor: null, rotulo: t('receptor.escolhaOrgao') },
  ...(opcoes.data.value?.orgaos ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
]);
const opProfissionais = (vazio: string) => [
  { valor: null, rotulo: vazio },
  ...(opcoes.data.value?.profissionais ?? []).map((p) => ({ valor: p.id, rotulo: p.nome })),
];
const opValores = <T extends string>(lista: readonly T[], vazio?: string) => [
  ...(vazio ? [{ valor: null, rotulo: vazio }] : []),
  ...lista.map((x) => ({ valor: x, rotulo: v(x) })),
];

// ---------- Receptores ----------
const filtro = reactive({ situacao: null as string | null, pendentes: false });
const inscricoes = useQuery({
  queryKey: computed(() => [
    'sus',
    'transplante',
    'inscricoes',
    filtro.situacao,
    filtro.pendentes,
    paciente.value?.id,
  ]),
  queryFn: () =>
    lerInscricoesTransplante({
      ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
      pendentes: filtro.pendentes,
      ...(paciente.value ? { paciente: paciente.value.id } : {}),
    }),
});
const linkConferencia = computed(() =>
  urlConferenciaTransplante({
    ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
    pendentes: filtro.pendentes,
  }),
);

interface FormReceptor extends CorpoInscricao {
  id: number | null;
  orgao: number | null;
  versao: number;
  atual: Inscricao | null;
}
const formReceptor = ref<FormReceptor | null>(null);
const aberta = useQuery({
  queryKey: computed(() => ['sus', 'transplante', 'inscricao', formReceptor.value?.id]),
  queryFn: () => lerInscricaoTransplante(formReceptor.value!.id!),
  enabled: computed(() => !!formReceptor.value?.id),
});
const novaInscricao = () => {
  formReceptor.value = {
    id: null,
    orgao: null,
    versao: 0,
    atual: null,
    dataInscricao: new Date().toISOString().slice(0, 10),
    prioridade: 'normal',
    situacao: 'ativa',
    apto: true,
    motivo: null,
    dataTransplante: null,
    notificacaoDoador: null,
    responsavel: null,
    numeroCentral: null,
  };
};
const abrirInscricao = (x: Inscricao) => {
  formReceptor.value = {
    id: x.id,
    orgao: x.orgao,
    versao: x.versao,
    atual: x,
    dataInscricao: x.dataInscricao,
    prioridade: x.prioridade,
    situacao: x.situacao,
    apto: x.apto,
    motivo: x.motivo,
    dataTransplante: x.dataTransplante,
    notificacaoDoador: x.notificacaoDoador,
    responsavel: x.responsavel,
    numeroCentral: x.numeroCentral,
  };
};
const problemasReceptor = computed(() => {
  const f = formReceptor.value;
  if (!f) return [];
  const p: string[] = [];
  if (!f.id && !paciente.value) p.push(t('receptor.escolhaPaciente'));
  if (!f.orgao) p.push(t('receptor.escolhaOrgao'));
  const atual = f.atual
    ? {
        dataInscricao: f.atual.dataInscricao,
        situacao: f.atual.situacao as SituacaoInscricao,
        apto: f.atual.apto,
        motivo: f.atual.motivo,
        dataTransplante: f.atual.dataTransplante,
      }
    : null;
  const outras = (inscricoes.data.value?.itens ?? [])
    .filter(
      (o) => o.id !== f.id && o.orgao === f.orgao && o.paciente === (f.atual?.paciente ?? paciente.value?.id),
    )
    .map((o) => ({ id: o.id, situacao: o.situacao as SituacaoInscricao }));
  const r = conferirInscricao(
    {
      dataInscricao: f.dataInscricao,
      situacao: f.situacao as SituacaoInscricao,
      apto: f.apto,
      motivo: f.motivo,
      dataTransplante: f.dataTransplante || null,
    },
    atual,
    outras,
  );
  return [...p, ...r.problemas.map((x) => x.mensagem)];
});
const corpoReceptor = (f: FormReceptor): CorpoInscricao => ({
  dataInscricao: f.dataInscricao,
  prioridade: f.prioridade,
  situacao: f.situacao,
  apto: f.apto,
  motivo: f.motivo || null,
  dataTransplante: f.dataTransplante || null,
  notificacaoDoador: f.notificacaoDoador,
  responsavel: f.responsavel,
  numeroCentral: f.numeroCentral || null,
});
const gravarReceptor = () => {
  const f = formReceptor.value!;
  acao.mutate(() =>
    f.id
      ? alterarInscricaoTransplante(f.id, { ...corpoReceptor(f), versao: f.versao })
      : inscreverReceptor({ ...corpoReceptor(f), paciente: paciente.value!.id, orgao: f.orgao! }),
  );
};
const registrarCentral = () => {
  const f = formReceptor.value!;
  acao.mutate(() =>
    registrarCentralInscricao(f.id!, { numeroCentral: f.numeroCentral || null, versao: f.versao }),
  );
};

// ---------- Doadores ----------
const notificacoes = useQuery({
  queryKey: computed(() => ['sus', 'transplante', 'notificacoes', paciente.value?.id]),
  queryFn: () => lerNotificacoesDoador(paciente.value?.id),
});
interface FormDoador extends CorpoNotificacao {
  id: number | null;
  versao: number;
  atual: NotificacaoDoador | null;
  protocoloCentral: string;
}
const formDoador = ref<FormDoador | null>(null);
const agoraLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const novaNotificacao = () => {
  formDoador.value = {
    id: null,
    versao: 0,
    atual: null,
    protocoloCentral: '',
    tipoDoador: 'morte_encefalica',
    notificadoEm: agoraLocal(),
    notificante: null as unknown as number,
    central: null,
    obitoEm: null,
    protocoloInicioEm: null,
    protocoloFimEm: null,
    abordagemFamiliarEm: null,
    familiaConsentiu: null,
    orgaosDoados: [],
    desfecho: null,
    desfechoEm: null,
    situacao: 'notificada',
    observacao: null,
  };
};
const abrirNotificacao = (x: NotificacaoDoador) => {
  formDoador.value = {
    id: x.id,
    versao: x.versao,
    atual: x,
    protocoloCentral: x.protocoloCentral ?? '',
    tipoDoador: x.tipoDoador,
    notificadoEm: x.notificadoEm,
    notificante: x.notificante,
    central: x.central,
    obitoEm: x.obitoEm,
    protocoloInicioEm: x.protocoloInicioEm,
    protocoloFimEm: x.protocoloFimEm,
    abordagemFamiliarEm: x.abordagemFamiliarEm,
    familiaConsentiu: x.familiaConsentiu,
    orgaosDoados: [...x.orgaosDoados],
    desfecho: x.desfecho,
    desfechoEm: x.desfechoEm,
    situacao: x.situacao,
    observacao: x.observacao,
  };
};
const opConsentimento = computed(() => [
  { valor: null, rotulo: t('doador.semResposta') },
  { valor: 'sim', rotulo: t('doador.consentiu') },
  { valor: 'nao', rotulo: t('doador.naoConsentiu') },
]);
// A seleção trabalha com texto; o formulário guarda o consentimento da família como sim, não ou sem resposta.
const consentimentoEscolhido = computed<string | number | null>({
  get: () => {
    const v = formDoador.value?.familiaConsentiu ?? null;
    return v === null ? null : v ? 'sim' : 'nao';
  },
  set: (v) => {
    if (formDoador.value) formDoador.value.familiaConsentiu = v === null ? null : v === 'sim';
  },
});
const opCentrais = computed(() => [
  { valor: null, rotulo: t('doador.semCentral') },
  ...(opcoes.data.value?.centrais ?? []).map((c) => ({ valor: c.id, rotulo: `${c.sigla} — ${c.nome}` })),
]);
const opNotificacoes = computed(() => [
  { valor: null, rotulo: t('receptor.semDoacao') },
  ...(notificacoes.data.value?.itens ?? []).map((n) => ({
    valor: n.id,
    rotulo: `${n.numero} — ${n.pacienteNome}`,
  })),
]);
// O desfecho registrado encerra a notificação (sem passo à parte).
watch(
  () => formDoador.value?.desfecho,
  (d) => {
    const f = formDoador.value;
    if (f && d && f.situacao !== 'encerrada') f.situacao = 'encerrada';
  },
);
const problemasDoador = computed(() => {
  const f = formDoador.value;
  if (!f) return [];
  const p: string[] = [];
  if (!f.id && !paciente.value) p.push(t('doador.escolhaPaciente'));
  if (!f.notificante) p.push(t('doador.escolhaNotificante'));
  const vazio = (x: string | null) => x || null;
  return [
    ...p,
    ...conferirNotificacaoDoador({
      tipoDoador: f.tipoDoador as TipoDoador,
      notificadoEm: f.notificadoEm,
      obitoEm: vazio(f.obitoEm),
      protocoloInicioEm: vazio(f.protocoloInicioEm),
      protocoloFimEm: vazio(f.protocoloFimEm),
      abordagemFamiliarEm: vazio(f.abordagemFamiliarEm),
      familiaConsentiu: f.familiaConsentiu,
      orgaosDoados: f.orgaosDoados,
      desfecho: f.desfecho as DesfechoDoacao | null,
      desfechoEm: vazio(f.desfechoEm),
      situacao: f.situacao as SituacaoNotificacao,
    }).map((x) => x.mensagem),
  ];
});
const corpoDoador = (f: FormDoador): CorpoNotificacao => ({
  tipoDoador: f.tipoDoador,
  notificadoEm: f.notificadoEm,
  notificante: f.notificante,
  central: f.central,
  obitoEm: f.obitoEm || null,
  protocoloInicioEm: f.protocoloInicioEm || null,
  protocoloFimEm: f.protocoloFimEm || null,
  abordagemFamiliarEm: f.abordagemFamiliarEm || null,
  familiaConsentiu: f.familiaConsentiu,
  orgaosDoados: f.orgaosDoados,
  desfecho: f.desfecho,
  desfechoEm: f.desfechoEm || null,
  situacao: f.situacao,
  observacao: f.observacao || null,
});
const gravarDoador = () => {
  const f = formDoador.value!;
  acao.mutate(() =>
    f.id
      ? alterarNotificacaoDoador(f.id, { ...corpoDoador(f), versao: f.versao })
      : notificarDoador({ ...corpoDoador(f), paciente: paciente.value!.id }),
  );
};
const gravarProtocolo = () => {
  const f = formDoador.value!;
  acao.mutate(() =>
    registrarProtocoloDoador(f.id!, { protocoloCentral: f.protocoloCentral.trim(), versao: f.versao }),
  );
};
const imprimir = () => window.print();
</script>

<template>
  <section class="tela" aria-labelledby="transplante-titulo" data-testid="tela-transplante">
    <h1 id="transplante-titulo">{{ t('titulo') }}</h1>
    <p class="nao-imprime">{{ t('explicacao') }}</p>

    <div class="paciente nao-imprime">
      <label
        >{{ t('buscarPaciente') }}
        <input v-model="busca" type="search" autocomplete="off" data-testid="transplante-busca-paciente"
      /></label>
      <ul v-if="termo.length >= 2 && achados.data.value" data-testid="transplante-pacientes">
        <li v-if="!achados.data.value.itens.length">{{ t('semPaciente') }}</li>
        <li v-for="p in achados.data.value.itens" :key="p.id">
          <button type="button" :data-testid="`transplante-paciente-${p.id}`" @click="escolherPaciente(p)">
            {{ p.prontuario }} — {{ p.nome }}
          </button>
        </li>
      </ul>
      <p v-if="paciente" data-testid="transplante-paciente-escolhido">
        {{ t('pacienteEscolhido', { nome: paciente.nome, prontuario: paciente.prontuario }) }}
        <button type="button" @click="escolherPaciente(null)">{{ t('trocarPaciente') }}</button>
      </p>
    </div>

    <div class="abas nao-imprime" role="group">
      <button
        type="button"
        :aria-pressed="aba === 'receptores'"
        data-testid="transplante-aba-receptores"
        @click="aba = 'receptores'"
      >
        {{ t('abaReceptores') }}
      </button>
      <button
        type="button"
        :aria-pressed="aba === 'doadores'"
        data-testid="transplante-aba-doadores"
        @click="aba = 'doadores'"
      >
        {{ t('abaDoadores') }}
      </button>
    </div>

    <p v-if="aviso" role="status" data-testid="transplante-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="!podeRegistrar" data-testid="transplante-so-consulta">{{ t('soConsulta') }}</p>

    <!-- Receptores -->
    <template v-if="aba === 'receptores'">
      <div class="filtros nao-imprime">
        <SanteSelecao
          v-model="filtro.situacao"
          :rotulo="t('receptor.filtroSituacao')"
          :opcoes="opValores(SITUACOES_INSCRICAO, t('receptor.todas'))"
          data-testid="transplante-filtro-situacao"
        />
        <label
          ><input v-model="filtro.pendentes" type="checkbox" data-testid="transplante-filtro-pendentes" />
          {{ t('receptor.soPendentes') }}</label
        >
        <a :href="linkConferencia" download data-testid="transplante-conferencia">{{
          t('receptor.conferencia')
        }}</a>
        <button
          v-if="podeRegistrar"
          type="button"
          data-testid="transplante-nova-inscricao"
          @click="novaInscricao"
        >
          {{ t('receptor.novo') }}
        </button>
      </div>

      <form
        v-if="formReceptor"
        class="ficha"
        data-testid="transplante-form-receptor"
        @submit.prevent="gravarReceptor"
      >
        <h2>{{ formReceptor.atual?.pacienteNome ?? paciente?.nome }}</h2>
        <SanteSelecao
          v-model="formReceptor.orgao"
          :rotulo="t('receptor.orgao')"
          :opcoes="opOrgaos"
          :desabilitado="!!formReceptor.id"
          data-testid="transplante-receptor-orgao"
        />
        <label
          >{{ t('receptor.dataInscricao') }}
          <input
            v-model="formReceptor.dataInscricao"
            type="date"
            required
            data-testid="transplante-receptor-data"
        /></label>
        <SanteSelecao
          v-model="formReceptor.prioridade"
          :rotulo="t('receptor.prioridade')"
          :opcoes="opValores(PRIORIDADES_INSCRICAO)"
          data-testid="transplante-receptor-prioridade"
        />
        <SanteSelecao
          v-model="formReceptor.situacao"
          :rotulo="t('receptor.situacao')"
          :opcoes="opValores(SITUACOES_INSCRICAO)"
          data-testid="transplante-receptor-situacao"
        />
        <label
          ><input v-model="formReceptor.apto" type="checkbox" data-testid="transplante-receptor-apto" />
          {{ t('receptor.apto') }}</label
        >
        <label
          >{{ t('receptor.motivo') }}
          <input v-model="formReceptor.motivo" maxlength="500" data-testid="transplante-receptor-motivo"
        /></label>
        <label v-if="formReceptor.situacao === 'transplantado'"
          >{{ t('receptor.dataTransplante') }}
          <input
            v-model="formReceptor.dataTransplante"
            type="date"
            data-testid="transplante-receptor-data-transplante"
        /></label>
        <SanteSelecao
          v-model="formReceptor.responsavel"
          :rotulo="t('receptor.responsavel')"
          :opcoes="opProfissionais(t('receptor.semResponsavel'))"
          data-testid="transplante-receptor-responsavel"
        />
        <SanteSelecao
          v-model="formReceptor.notificacaoDoador"
          :rotulo="t('receptor.doacao')"
          :opcoes="opNotificacoes"
          data-testid="transplante-receptor-doacao"
        />
        <label
          >{{ t('receptor.numeroCentral') }}
          <input
            v-model="formReceptor.numeroCentral"
            maxlength="30"
            data-testid="transplante-receptor-numero"
        /></label>
        <ul v-if="problemasReceptor.length" class="problemas" data-testid="transplante-receptor-problemas">
          <li v-for="p in problemasReceptor" :key="p">{{ p }}</li>
        </ul>
        <div class="acoes nao-imprime">
          <button
            v-if="podeRegistrar"
            type="submit"
            :disabled="problemasReceptor.length > 0 || acao.isPending.value"
            data-testid="transplante-receptor-gravar"
          >
            {{ t('gravar') }}
          </button>
          <button
            v-if="podeRegistrar && formReceptor.id"
            type="button"
            :disabled="!formReceptor.numeroCentral || acao.isPending.value"
            data-testid="transplante-receptor-central"
            @click="registrarCentral"
          >
            {{ t('receptor.registrarCentral') }}
          </button>
          <button type="button" data-testid="transplante-imprimir" @click="imprimir">
            {{ t('imprimir') }}
          </button>
          <button type="button" @click="formReceptor = null">{{ t('fechar') }}</button>
        </div>
        <table v-if="aberta.data.value" data-testid="transplante-historico">
          <caption>
            {{
              t('receptor.historico')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('receptor.ocorrido') }}</th>
              <th scope="col">{{ t('receptor.operacao') }}</th>
              <th scope="col">{{ t('receptor.motivo') }}</th>
              <th scope="col">{{ t('receptor.enviado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in aberta.data.value.historico" :key="h.id">
              <td>{{ h.ocorridoEm.replace('T', ' ') }}</td>
              <td>{{ v(h.operacao) }}</td>
              <td>{{ h.motivo }}</td>
              <td>{{ h.enviadoCentralEm?.replace('T', ' ') ?? t('receptor.naoEnviado') }}</td>
            </tr>
          </tbody>
        </table>
      </form>

      <MensagemErro v-if="inscricoes.isError.value" :erro="inscricoes.error.value" />
      <p v-else-if="inscricoes.data.value?.itens.length === 0" data-testid="transplante-receptores-vazio">
        {{ t('vazio') }}
      </p>
      <table v-else-if="inscricoes.data.value" class="nao-imprime" data-testid="transplante-receptores">
        <thead>
          <tr>
            <th scope="col">{{ t('paciente') }}</th>
            <th scope="col">{{ t('receptor.orgao') }}</th>
            <th scope="col">{{ t('receptor.dataInscricao') }}</th>
            <th scope="col">{{ t('receptor.situacao') }}</th>
            <th scope="col">{{ t('receptor.prioridade') }}</th>
            <th scope="col">{{ t('receptor.numeroCentral') }}</th>
            <th scope="col">{{ t('receptor.pendentes') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('receptor.abrir') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in inscricoes.data.value.itens"
            :key="x.id"
            :data-testid="`transplante-inscricao-${x.id}`"
          >
            <td>{{ x.prontuario }} — {{ x.pacienteNome }}</td>
            <td>{{ x.orgaoDescricao }}</td>
            <td>{{ x.dataInscricao }}</td>
            <td>
              {{ v(x.situacao) }}{{ x.apto ? '' : ` (${v('nao')} ${t('receptor.apto').toLowerCase()})` }}
            </td>
            <td>{{ v(x.prioridade) }}</td>
            <td>{{ x.numeroCentral ?? '—' }}</td>
            <td>{{ x.pendentesEnvio }}</td>
            <td>
              <button
                type="button"
                :data-testid="`transplante-abrir-inscricao-${x.id}`"
                @click="abrirInscricao(x)"
              >
                {{ t('receptor.abrir') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Doadores -->
    <template v-else>
      <div class="filtros nao-imprime">
        <button
          v-if="podeRegistrar"
          type="button"
          data-testid="transplante-nova-notificacao"
          @click="novaNotificacao"
        >
          {{ t('doador.novo') }}
        </button>
      </div>
      <form
        v-if="formDoador"
        class="ficha"
        data-testid="transplante-form-doador"
        @submit.prevent="gravarDoador"
      >
        <h2>
          {{
            formDoador.atual
              ? `${formDoador.atual.numero} — ${formDoador.atual.pacienteNome}`
              : paciente?.nome
          }}
        </h2>
        <SanteSelecao
          v-model="formDoador.tipoDoador"
          :rotulo="t('doador.tipo')"
          :opcoes="opValores(TIPOS_DOADOR)"
          data-testid="transplante-doador-tipo"
        />
        <label
          >{{ t('doador.notificadoEm') }}
          <input
            v-model="formDoador.notificadoEm"
            type="datetime-local"
            required
            data-testid="transplante-doador-notificado"
        /></label>
        <SanteSelecao
          v-model="formDoador.notificante"
          :rotulo="t('doador.notificante')"
          :opcoes="opProfissionais(t('doador.escolhaNotificante'))"
          data-testid="transplante-doador-notificante"
        />
        <SanteSelecao
          v-model="formDoador.central"
          :rotulo="t('doador.central')"
          :opcoes="opCentrais"
          data-testid="transplante-doador-central"
        />
        <template v-if="formDoador.tipoDoador === 'morte_encefalica'">
          <label
            >{{ t('doador.protocoloInicio') }}
            <input
              v-model="formDoador.protocoloInicioEm"
              type="datetime-local"
              data-testid="transplante-doador-protocolo-inicio"
          /></label>
          <label
            >{{ t('doador.protocoloFim') }}
            <input
              v-model="formDoador.protocoloFimEm"
              type="datetime-local"
              data-testid="transplante-doador-protocolo-fim"
          /></label>
        </template>
        <label
          >{{ t('doador.obitoEm') }}
          <input v-model="formDoador.obitoEm" type="datetime-local" data-testid="transplante-doador-obito"
        /></label>
        <label
          >{{ t('doador.abordagem') }}
          <input
            v-model="formDoador.abordagemFamiliarEm"
            type="datetime-local"
            data-testid="transplante-doador-abordagem"
        /></label>
        <SanteSelecao
          v-model="consentimentoEscolhido"
          :rotulo="t('doador.consentimento')"
          :opcoes="opConsentimento"
          data-testid="transplante-doador-consentimento"
        />
        <SanteSelecao
          v-model="formDoador.desfecho"
          :rotulo="t('doador.desfecho')"
          :opcoes="opValores(DESFECHOS_DOACAO, t('doador.semDesfecho'))"
          data-testid="transplante-doador-desfecho"
        />
        <label v-if="formDoador.desfecho"
          >{{ t('doador.desfechoEm') }}
          <input
            v-model="formDoador.desfechoEm"
            type="datetime-local"
            data-testid="transplante-doador-desfecho-em"
        /></label>
        <fieldset v-if="formDoador.desfecho === 'doacao_efetivada'" data-testid="transplante-doador-orgaos">
          <legend>{{ t('doador.orgaos') }}</legend>
          <label v-for="o in opcoes.data.value?.orgaos ?? []" :key="o.id"
            ><input
              v-model="formDoador.orgaosDoados"
              type="checkbox"
              :value="o.codigo"
              :data-testid="`transplante-doador-orgao-${o.codigo}`"
            />
            {{ o.descricao }}</label
          >
        </fieldset>
        <SanteSelecao
          v-model="formDoador.situacao"
          :rotulo="t('doador.situacao')"
          :opcoes="opValores(SITUACOES_NOTIFICACAO)"
          data-testid="transplante-doador-situacao"
        />
        <label
          >{{ t('doador.observacao') }}
          <textarea v-model="formDoador.observacao" maxlength="4000" rows="2"></textarea>
        </label>
        <ul v-if="problemasDoador.length" class="problemas" data-testid="transplante-doador-problemas">
          <li v-for="p in problemasDoador" :key="p">{{ p }}</li>
        </ul>
        <div class="acoes nao-imprime">
          <button
            v-if="podeRegistrar && formDoador.atual?.situacao !== 'cancelada'"
            type="submit"
            :disabled="problemasDoador.length > 0 || acao.isPending.value"
            data-testid="transplante-doador-gravar"
          >
            {{ t('gravar') }}
          </button>
          <button type="button" data-testid="transplante-imprimir-doador" @click="imprimir">
            {{ t('imprimir') }}
          </button>
          <button type="button" @click="formDoador = null">{{ t('fechar') }}</button>
        </div>
        <div v-if="formDoador.id && podeRegistrar" class="acoes nao-imprime">
          <label
            >{{ t('doador.protocoloCentral') }}
            <input
              v-model="formDoador.protocoloCentral"
              maxlength="30"
              data-testid="transplante-doador-protocolo-central"
          /></label>
          <button
            type="button"
            :disabled="!formDoador.protocoloCentral.trim() || acao.isPending.value"
            data-testid="transplante-doador-gravar-protocolo"
            @click="gravarProtocolo"
          >
            {{ t('doador.registrarProtocolo') }}
          </button>
        </div>
      </form>

      <MensagemErro v-if="notificacoes.isError.value" :erro="notificacoes.error.value" />
      <p v-else-if="notificacoes.data.value?.itens.length === 0" data-testid="transplante-doadores-vazio">
        {{ t('vazio') }}
      </p>
      <table v-else-if="notificacoes.data.value" class="nao-imprime" data-testid="transplante-doadores">
        <thead>
          <tr>
            <th scope="col">{{ t('doador.numero') }}</th>
            <th scope="col">{{ t('paciente') }}</th>
            <th scope="col">{{ t('doador.tipo') }}</th>
            <th scope="col">{{ t('doador.notificadoEm') }}</th>
            <th scope="col">{{ t('doador.situacao') }}</th>
            <th scope="col">{{ t('doador.desfecho') }}</th>
            <th scope="col">{{ t('doador.protocoloCentral') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('receptor.abrir') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in notificacoes.data.value.itens"
            :key="x.id"
            :data-testid="`transplante-notificacao-${x.id}`"
          >
            <td>{{ x.numero }}</td>
            <td>{{ x.prontuario }} — {{ x.pacienteNome }}</td>
            <td>{{ v(x.tipoDoador) }}</td>
            <td>{{ x.notificadoEm.replace('T', ' ') }}</td>
            <td>{{ v(x.situacao) }}</td>
            <td>{{ v(x.desfecho) }}</td>
            <td>{{ x.protocoloCentral ?? '—' }}</td>
            <td>
              <button
                type="button"
                :data-testid="`transplante-abrir-notificacao-${x.id}`"
                @click="abrirNotificacao(x)"
              >
                {{ t('receptor.abrir') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
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
caption {
  text-align: left;
  font-weight: 600;
}
.ficha,
.filtros,
.acoes,
.abas,
.paciente {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.ficha h2,
.ficha table,
.problemas,
.acoes {
  flex-basis: 100%;
}
.problemas {
  color: var(--sgh-alerta-texto);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
@media print {
  .nao-imprime {
    display: none;
  }
}
</style>
