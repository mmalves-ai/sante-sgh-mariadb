<script setup lang="ts">
// Abertura de atendimento (ficha do M20, seção 7): `/recepcao/atendimento/novo`. A partir da senha chamada no guichê
// (`?senha=&local=`) ou do agendamento (`?marcacao=`), ou na demanda direta: o paciente do cadastro único, o tipo
// (consulta, pronto atendimento, exame, requisição de laboratório), o convênio aceito, o profissional e a
// especialidade, o procedimento, o caráter (obrigatório), o CID, a carteirinha e o responsável. O que a configuração
// manda herdar do atendimento anterior do paciente vem preenchido, e a pessoa confere antes de gravar. Do agendamento,
// a leitura dele preenche o paciente, o convênio, o profissional, a especialidade, a unidade e o procedimento. Da senha,
// o tipo fica sem padrão (qualquer recepção chama senha) e é obrigatório. O paciente não identificado da emergência:
// o cadastro temporário (cadastro de pacientes) recebe a marca com as características, e a identificação fica
// pendente na lista do dia.
import {
  CODIGOS_TIPO_ATENDIMENTO,
  type HerancaPaciente,
  type ResultadoBuscaPaciente,
  TIPOS_ATENDIMENTO,
} from '@sgh/contratos';
import { caraterSugerido } from '@sgh/dominio-atendimento';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { type Coberturas, lerCoberturas } from '../../cadastro/api-vinculos.js';
import CadastroPendenteAbertura from '../../cadastro/componentes/CadastroPendenteAbertura.vue';
import RecusaCadastroIncompleto from '../../cadastro/componentes/RecusaCadastroIncompleto.vue';
import RepresentacaoNaAbertura from '../../cadastro/componentes/RepresentacaoNaAbertura.vue';
import OrigemNaAbertura from '../../cadastro/componentes/OrigemNaAbertura.vue';
import {
  camposDaRecusaDeCadastro,
  consultaDeRotaDoEscopo,
  escopoDaAbertura,
} from '../../cadastro/escopo-regra-campo.js';
import { dataBr } from '../../agenda/formato.js';
import {
  abrirAtendimento,
  buscarCid,
  buscarProcedimentosAtendimento,
  buscarSolicitantesAtendimento,
  codigoDaRecusa,
  lerHistoricoPaciente,
  lerMarcacaoAtendimento,
  marcarNaoIdentificado,
  novaChave,
} from '../api-atendimento.js';
import { marcaDasCoberturas, motivoSemCarteira, preenchimentoDaCobertura } from '../cobertura-abertura.js';
import { preenchimentoDaMarcacao, tipoInicialDaAbertura } from '../regras-tela.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import ElegibilidadeNaAbertura from '../componentes/ElegibilidadeNaAbertura.vue';
import RegraPlanoNaAbertura from '../componentes/RegraPlanoNaAbertura.vue';
import { usarAtendimento } from '../usar-atendimento.js';
import { lerServicosAbertura } from '../api-regras-plano.js';

type Tipo = (typeof CODIGOS_TIPO_ATENDIMENTO)[number];
const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const { apoio, pode, motivoAmbulatorio, motivoPa } = usarAtendimento();
const q = (k: string) => (typeof rota.query[k] === 'string' ? Number(rota.query[k]) || null : null);
const senha = q('senha');
const local = q('local');
const marcacao = q('marcacao');
// Módulo de recepção da regra de campo do cadastro: o servidor o tira da origem da abertura, na conferência da tela e
// na gravação (o local do guichê, o local da marcação ou da senha, depois o canal de entrada e o guichê da sessão);
// `?modulo=` só vale sem local nem origem registrada com módulo.
const moduloRecepcao = q('modulo');

// ── Paciente ──
const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['atendimento', 'pacientes', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string; prontuario: number; nascimento: string | null } | null>(
  null,
);
const historico = useQuery({
  queryKey: computed(() => ['atendimento', 'historico', paciente.value?.id ?? 0]),
  queryFn: (): Promise<HerancaPaciente> => lerHistoricoPaciente(paciente.value?.id ?? 0),
  enabled: computed(() => paciente.value !== null),
});

// ── Ficha ──
const tipo = ref<Tipo | ''>(tipoInicialDaAbertura({ senha }));
const convenio = ref('');
const profissional = ref('');
const especialidade = ref('');
const unidade = ref('');
/** 02-REC linha 37: o serviço do atendimento; a regra do plano (e a senha que ela exige) pode valer só nele. */
const servico = ref('');
const centroCusto = ref('');
const procedimento = ref('');
const termoProcedimento = ref('');
const carater = ref<'eletivo' | 'urgencia'>(tipo.value ? caraterSugerido(tipo.value) : 'eletivo');
const cid = ref<{ id: number; rotulo: string } | null>(null);
const termoCid = ref('');
const retorno = ref(false);
const matricula = ref('');
const validadeCarteira = ref('');
const guia = ref('');
// 02-REC linha 37: a senha de autorização da operadora e a validade dela (a regra do plano pode exigi-la).
const senhaConvenio = ref('');
const validadeSenha = ref('');
const plano = ref('');
const horarioEspecial = ref(false);
const comResponsavel = ref(false);
const respNome = ref('');
const respParentesco = ref('8');
const respTelefone = ref('');
const solicitante = ref<{ id: number; rotulo: string } | null>(null);
const termoSolicitante = ref('');
const dataRequisicao = ref('');
const observacao = ref('');
const lab = computed(() => tipo.value === 'requisicaoLab');
watch(tipo, (v) => {
  if (!v) return;
  carater.value = caraterSugerido(v);
  const padrao = apoio.data.value?.procedimentosPadrao.find((p) => p.tipo === v);
  if (padrao && !procedimento.value) procedimento.value = String(padrao.codigo);
  if (v === 'requisicaoLab') especialidade.value = '';
});

// ── Paciente não identificado (regra 9) ──
const naoIdentificado = ref(false);
const caracteristicas = ref('');

// ── Do agendamento: a leitura preenche a abertura (a pessoa confere) ──
const agendamento = useQuery({
  queryKey: ['atendimento', 'marcacao', marcacao ?? 0],
  queryFn: () => lerMarcacaoAtendimento(marcacao ?? 0),
  enabled: marcacao !== null,
});
const preenchido = ref(false);
watch(
  () => [agendamento.data.value, apoio.data.value] as const,
  ([m, a]) => {
    if (!m || !a || preenchido.value || m.registro > 0) return;
    preenchido.value = true;
    if (m.paciente) paciente.value = { ...m.paciente };
    const p = preenchimentoDaMarcacao(m, a);
    tipo.value = 'consulta';
    convenio.value = p.convenio;
    especialidade.value = p.especialidade;
    profissional.value = p.profissional;
    unidade.value = p.unidade;
    centroCusto.value = p.centroCusto || centroCusto.value;
    if (p.procedimento) procedimento.value = p.procedimento;
    retorno.value = p.retorno;
  },
  { immediate: true },
);

// A carteira do cadastro do paciente (cobertura permanente): a proposta do servidor preenche o convênio, o plano, a
// carteirinha e a validade, sem digitar de novo. O convênio que veio do agendamento fica, e a carteira desse convênio
// completa. Ao trocar o convênio, a carteira dele entra; sem carteira, o que veio de outra carteira sai da tela. O
// cadastro vence a herança do atendimento anterior nesses campos. Sem acesso às carteiras, a abertura segue à mão.
// A leitura nunca vem de cópia guardada (a carteira muda na ficha do paciente, aberta em outra aba, e a abertura
// continua montada): relida ao escolher o paciente, ao voltar à aba e pelo botão de reler.
const coberturas = useQuery({
  queryKey: computed(() => ['atendimento', 'coberturas', paciente.value?.id ?? 0]),
  queryFn: (): Promise<Coberturas> => lerCoberturas(paciente.value?.id ?? 0),
  enabled: computed(() => paciente.value !== null),
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: 'always',
});
const herdou = ref<string[]>([]);
// Os campos que os valores habituais (do usuário ou do estabelecimento) preencheram.
const habitual = ref<string[]>([]);
const daCarteira = ref<number | null>(null);
// A marca da última resposta do cadastro já proposta, e o que a carteira pôs na tela (para não repor o mesmo).
const respostaVista = ref<string | null>(null);
const aplicado = ref<string | null>(null);
const CAMPOS_DA_CARTEIRA = ['convenio', 'matricula', 'plano', 'validadeCarteira'];
const conveniosAceitos = computed(() =>
  (apoio.data.value?.convenios ?? []).filter((x) => x.aceita).map((x) => x.codigo),
);
const avisosCobertura = computed(() => (paciente.value ? (coberturas.data.value?.avisos ?? []) : []));
const semCarteira = computed(() =>
  paciente.value !== null && coberturas.data.value !== undefined && apoio.data.value !== undefined
    ? motivoSemCarteira(coberturas.data.value, conveniosAceitos.value)
    : null,
);
function limparCarteira(): void {
  aplicado.value = null;
  if (daCarteira.value === null) return;
  daCarteira.value = null;
  matricula.value = '';
  plano.value = '';
  validadeCarteira.value = '';
}
watch(
  () => paciente.value?.id ?? 0,
  () => {
    // A carteira é do paciente: ao trocar de paciente, o convênio que veio dela sai junto.
    if (daCarteira.value !== null) convenio.value = '';
    limparCarteira();
    respostaVista.value = null;
  },
);
watch(
  () =>
    [
      coberturas.data.value,
      coberturas.isFetching.value,
      convenio.value,
      apoio.data.value,
      paciente.value?.id ?? 0,
    ] as const,
  ([c, lendo, conv, a, pac]) => {
    // Só a resposta lida agora conta: enquanto relê, a anterior não decide nada.
    if (!c || !a || !pac || lendo) return;
    // A proposta entra uma vez por resposta do cadastro (quem esvaziar o convênio depois não é contrariado) e vence
    // o convênio herdado do atendimento anterior; o convênio do agendamento ou escolhido pela pessoa fica. Resposta
    // nova (carteira renovada, incluída ou corrigida na ficha) é proposta de novo.
    const marca = marcaDasCoberturas(c);
    const primeira = respostaVista.value !== marca;
    if (conv === '' && !primeira) return limparCarteira();
    respostaVista.value = marca;
    // O convênio habitual de quem atende também cede à carteira do paciente.
    const herdado = primeira && (herdou.value.includes('convenio') || habitual.value.includes('convenio'));
    let p = preenchimentoDaCobertura(c, herdado ? '' : conv, conveniosAceitos.value, herdado ? conv : '');
    // O convênio que estava na tela veio de uma carteira que deixou de servir: vale a proposta nova.
    if (!p && primeira && daCarteira.value !== null) {
      p = preenchimentoDaCobertura(c, '', conveniosAceitos.value);
      if (!p) convenio.value = '';
    }
    if (!p) return limparCarteira();
    // Mesma carteira com o mesmo conteúdo: nada a repor (o que a pessoa ajustou à mão fica).
    const conteudo = JSON.stringify(p);
    if (conteudo === aplicado.value) return;
    aplicado.value = conteudo;
    daCarteira.value = p.carteira;
    convenio.value = p.convenio;
    matricula.value = p.matricula;
    plano.value = p.plano;
    validadeCarteira.value = p.validadeCarteira;
    herdou.value = herdou.value.filter((x) => !CAMPOS_DA_CARTEIRA.includes(x));
    habitual.value = habitual.value.filter((x) => x !== 'convenio');
  },
);

// A herança: o servidor aplica as marcas em vigor e as regras da cobertura (plano e carteirinha só com o convênio,
// validade vencida vira aviso); a tela preenche todos os campos herdados e a pessoa confere.
const avisosHeranca = computed(() => historico.data.value?.anterior?.avisos ?? []);
watch(
  () => historico.data.value,
  (h) => {
    const v = h?.anterior?.herdados;
    if (!v) return;
    // Do agendamento, o que a marcação trouxe vence a herança (a herança só completa o que ficou vazio).
    const doAgendamento = preenchido.value;
    const usados: string[] = [];
    const alvos: Record<string, { value: string }> = {
      convenio,
      profissional,
      especialidade,
      unidade,
      centroCusto,
      matricula,
      plano,
      validadeCarteira,
    };
    for (const [campo, x] of Object.entries(v)) {
      const alvo = alvos[campo];
      if (!alvo || (doAgendamento && alvo.value !== '')) continue;
      // O que a carteira do cadastro preencheu não é trocado pelo atendimento anterior.
      if (daCarteira.value !== null && CAMPOS_DA_CARTEIRA.includes(campo)) continue;
      alvo.value = String(x);
      usados.push(campo);
    }
    herdou.value = usados;
  },
);

// Os valores habituais: o servidor manda só o que a herança não preencheu (o paciente sem atendimento anterior
// recebe todos); a tela só completa o campo vazio, nunca troca o que veio do paciente, do agendamento ou da pessoa.
const avisosPadrao = computed(() => historico.data.value?.padrao?.avisos ?? []);
const ROTULOS_HABITUAIS: Record<string, string> = {
  convenio: t('atendimento.convenio'),
  especialidade: t('atendimento.especialidade'),
  unidade: t('atendimento.unidade'),
  centroCusto: t('atendimento.centroCusto'),
};
watch(
  () => historico.data.value,
  (h) => {
    habitual.value = [];
    const v = h?.padrao?.valores;
    if (!v) return;
    const alvos: Record<string, { value: string }> = { convenio, especialidade, unidade, centroCusto };
    const usados: string[] = [];
    for (const [campo, x] of Object.entries(v)) {
      const alvo = alvos[campo];
      if (!alvo || alvo.value !== '') continue;
      // Com a carteira do cadastro na tela, o convênio é o dela.
      if (campo === 'convenio' && daCarteira.value !== null) continue;
      // Requisição de laboratório não tem especialidade.
      if (campo === 'especialidade' && lab.value) continue;
      alvo.value = String(x);
      usados.push(campo);
    }
    habitual.value = usados;
  },
);

const opc = (l: { valor: string; rotulo: string }[], vazio = t('atendimento.escolha')) => [
  { valor: '', rotulo: vazio },
  ...l,
];
const tipos = computed(() => [
  ...(tipo.value === '' ? [{ valor: '', rotulo: t('atendimento.abrir.escolhaTipo') }] : []),
  ...TIPOS_ATENDIMENTO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
]);
const convenios = computed(() =>
  opc(
    (apoio.data.value?.convenios ?? [])
      .filter((c) => c.aceita)
      .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ),
);
const especialidades = computed(() =>
  opc((apoio.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome }))),
);
const profissionais = computed(() =>
  opc(
    (apoio.data.value?.profissionais ?? [])
      .filter(
        (p) => lab.value || !especialidade.value || p.especialidades.includes(Number(especialidade.value)),
      )
      .map((p) => ({ valor: String(p.id), rotulo: p.nome })),
  ),
);
const unidades = computed(() =>
  opc((apoio.data.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome }))),
);
const servicosAbertura = useQuery({
  queryKey: ['atendimento', 'regras-plano', 'servicos'],
  queryFn: lerServicosAbertura,
  staleTime: 300_000,
  retry: false,
});
const servicos = computed(() =>
  opc(
    (servicosAbertura.data.value ?? []).map((s) => ({ valor: String(s.id), rotulo: s.rotulo })),
    t('atendimento.servicoNenhum'),
  ),
);
const centros = computed(() =>
  opc((apoio.data.value?.centrosCusto ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome }))),
);
const caracteres = computed(() => [
  { valor: 'eletivo' as const, rotulo: t('atendimento.abrir.eletivo') },
  { valor: 'urgencia' as const, rotulo: t('atendimento.abrir.urgencia') },
]);
const parentescos = computed(() =>
  [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    valor: String(n),
    rotulo: t(`atendimento.abrir.parentescos.${n}`),
  })),
);

// Buscas da abertura (CID, procedimento do convênio, solicitante).
const cids = ref<{ id: number; codigo: string; nome: string }[]>([]);
const procedimentos = ref<{ codigo: number; nome: string }[]>([]);
const solicitantes = ref<{ id: number; nome: string; registro: string }[]>([]);
const erroBusca = ref<unknown>(null);
async function procurar(f: () => Promise<void>): Promise<void> {
  erroBusca.value = null;
  try {
    await f();
  } catch (e) {
    erroBusca.value = e;
  }
}
const procurarCid = () => procurar(async () => void (cids.value = await buscarCid(termoCid.value.trim())));
const procurarProcedimento = () =>
  procurar(
    async () =>
      void (procedimentos.value = await buscarProcedimentosAtendimento(
        Number(convenio.value),
        termoProcedimento.value.trim(),
      )),
  );
const procurarSolicitante = () =>
  procurar(
    async () =>
      void (solicitantes.value = await buscarSolicitantesAtendimento(termoSolicitante.value.trim())),
  );

const podeAbrir = computed(() =>
  tipo.value === 'pa'
    ? pode('pa:atendimento.abrirAtendimento').value
    : pode('atendimento.abrirAtendimento').value,
);
const pronto = computed(
  () =>
    tipo.value !== '' &&
    (!naoIdentificado.value || caracteristicas.value.trim().length >= 5) &&
    paciente.value !== null &&
    convenio.value !== '' &&
    profissional.value !== '' &&
    unidade.value !== '' &&
    centroCusto.value !== '' &&
    (lab.value
      ? solicitante.value !== null
      : especialidade.value !== '' && procedimento.value !== '' && cid.value !== null),
);
const chave = ref(novaChave('abrir'));
const erro = ref<unknown>(null);
const ocupado = ref(false);
// 02-CAD linha 24: os avisos da regra do plano que o servidor devolveu na abertura. Com aviso, a tela para e mostra
// o texto antes de seguir para os impressos (a recepção lê o que o plano pede); sem aviso, segue direto.
const avisoPlano = ref<{ alerta: string | null; orientacao: string | null; reg: number } | null>(null);
const textoOuNulo = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

async function abrir(): Promise<void> {
  const p = paciente.value;
  if (!p || !tipo.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    // O cadastro temporário do não identificado recebe a marca antes da ficha (já marcado: segue).
    if (naoIdentificado.value)
      try {
        await marcarNaoIdentificado(
          p.id,
          { caracteristicas: caracteristicas.value.trim(), prontuario: p.prontuario },
          novaChave('nao-identificado'),
        );
      } catch (x) {
        if (codigoDaRecusa(x) !== 'ja-marcado') throw x;
      }
    const r = await abrirAtendimento(
      {
        tipo: tipo.value,
        paciente: p.id,
        convenio: Number(convenio.value),
        profissional: Number(profissional.value),
        especialidade: lab.value ? 0 : Number(especialidade.value),
        unidade: Number(unidade.value),
        ...(servico.value ? { servico: Number(servico.value) } : {}),
        centroCusto: Number(centroCusto.value),
        procedimento: lab.value ? Number(procedimento.value || 0) : Number(procedimento.value),
        carater: carater.value,
        retorno: retorno.value,
        horarioEspecial: lab.value ? false : horarioEspecial.value,
        ...(cid.value ? { cidPrincipal: cid.value.id } : {}),
        ...(matricula.value.trim() ? { matricula: matricula.value } : {}),
        ...(validadeCarteira.value ? { validadeCarteira: validadeCarteira.value } : {}),
        ...(guia.value.trim() ? { guia: guia.value } : {}),
        ...(senhaConvenio.value.trim() ? { senhaConvenio: senhaConvenio.value.trim() } : {}),
        ...(validadeSenha.value ? { validadeSenha: validadeSenha.value } : {}),
        ...(plano.value.trim() ? { plano: plano.value } : {}),
        ...(observacao.value.trim() ? { observacao: observacao.value } : {}),
        ...(lab.value && solicitante.value ? { solicitante: solicitante.value.id } : {}),
        ...(lab.value && dataRequisicao.value ? { dataRequisicao: dataRequisicao.value } : {}),
        ...(senha ? { senha, local: local ?? undefined } : {}),
        ...(marcacao ? { marcacao } : {}),
        ...(moduloRecepcao ? { moduloRecepcao } : {}),
        ...(comResponsavel.value
          ? {
              responsavel: {
                nome: respNome.value,
                parentesco: Number(respParentesco.value),
                ...(respTelefone.value.trim() ? { telefone: respTelefone.value } : {}),
              },
            }
          : {}),
      },
      chave.value,
    );
    chave.value = novaChave('abrir');
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
    const alerta = textoOuNulo(r.resultado['alertaPlanoMotivo']);
    const orientacao = textoOuNulo(r.resultado['orientacaoPlano']);
    if (alerta || orientacao) {
      avisoPlano.value = { alerta, orientacao, reg: Number(r.resultado['reg']) };
      return;
    }
    await roteador.push(`/recepcao/atendimento/${Number(r.resultado['reg'])}/impressos?novo=sim`);
  } catch (x) {
    erro.value = x;
    chave.value = novaChave('abrir');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="abrir-atd-titulo" data-testid="tela-abrir-atendimento">
    <h1 id="abrir-atd-titulo">{{ t('atendimento.abrir.titulo') }}</h1>
    <p>{{ t('atendimento.abrir.texto') }}</p>
    <AvisoAtendimento :motivo="tipo === 'pa' ? motivoPa : motivoAmbulatorio" />
    <SanteAlerta v-if="senha" variante="info" :texto="t('atendimento.abrir.daSenha', { senha })" />
    <template v-if="marcacao">
      <ErroAtendimento v-if="agendamento.isError.value" :erro="agendamento.error.value" />
      <SanteAlerta
        v-else-if="agendamento.data.value && agendamento.data.value.registro > 0"
        variante="alerta"
        :texto="t('atendimento.abrir.agendamentoJaAtendido', { reg: agendamento.data.value.registro })"
        data-testid="abrir-atd-agendamento-atendido"
      />
      <SanteAlerta
        v-else-if="agendamento.data.value && !agendamento.data.value.hoje"
        variante="alerta"
        :texto="t('atendimento.abrir.agendamentoOutroDia', { data: dataBr(agendamento.data.value.data) })"
      />
      <SanteAlerta
        v-else-if="agendamento.data.value"
        variante="info"
        :texto="t('atendimento.abrir.doAgendamento', { hora: agendamento.data.value.hora })"
        data-testid="abrir-atd-do-agendamento"
      />
    </template>

    <section class="painel" aria-labelledby="abrir-atd-paciente">
      <h2 id="abrir-atd-paciente">{{ t('atendimento.abrir.paciente') }}</h2>
      <form v-if="!paciente" class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
        <div class="campo">
          <label for="abrir-atd-termo">{{ t('atendimento.abrir.termoPaciente') }}</label>
          <input
            id="abrir-atd-termo"
            v-model="termo"
            type="search"
            autocomplete="off"
            data-testid="abrir-atd-termo"
          />
        </div>
        <SanteBotao
          tipo="submit"
          :rotulo="t('atendimento.abrir.buscarPaciente')"
          data-testid="abrir-atd-buscar"
        />
      </form>
      <p v-if="!paciente" class="secundario">
        {{ t('atendimento.abrir.semCadastro') }}
        <RouterLink
          :to="{
            path: '/cadastros/pacientes/novo',
            query: consultaDeRotaDoEscopo(escopoDaAbertura({ tipo, convenio, modulo: moduloRecepcao })),
          }"
          data-testid="abrir-atd-cadastrar"
          >{{ t('atendimento.abrir.cadastrar') }}</RouterLink
        >
      </p>
      <ErroAtendimento v-if="pacientes.isError.value" :erro="pacientes.error.value" />
      <ul v-else-if="pacientes.data.value && !paciente" class="lista-simples">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="
              t('atendimento.abrir.escolherPaciente', { nome: p.nomeSocial ?? p.nome, pront: p.prontuario })
            "
            :data-testid="`abrir-atd-paciente-${p.id}`"
            @acionar="
              paciente = {
                id: p.id,
                nome: p.nomeSocial ?? p.nome,
                prontuario: p.prontuario,
                nascimento: p.nascimento,
              }
            "
          />
        </li>
      </ul>
      <template v-if="paciente">
        <p class="acoes" data-testid="abrir-atd-paciente-escolhido">
          <strong>{{ paciente.nome }}</strong>
          <span>{{ t('atendimento.prontuario', { n: paciente.prontuario }) }}</span>
          <span v-if="paciente.nascimento">{{
            t('atendimento.nascimento', { data: dataBr(paciente.nascimento) })
          }}</span>
          <SanteBotao variante="texto" :rotulo="t('atendimento.trocar')" @acionar="paciente = null" />
        </p>
        <SanteAlerta
          v-if="herdou.length"
          variante="info"
          :texto="
            t('atendimento.abrir.herdado', { data: dataBr(historico.data.value?.anterior?.data ?? '') })
          "
          data-testid="abrir-atd-herdado"
        />
        <SanteAlerta
          v-if="habitual.length"
          variante="info"
          :texto="
            t('atendimento.abrir.habitual', {
              campos: habitual.map((c) => ROTULOS_HABITUAIS[c] ?? c).join(', '),
            })
          "
          data-testid="abrir-atd-habitual"
        />
        <SanteAlerta
          v-for="(aviso, i) in avisosPadrao"
          :key="`padrao-aviso-${i}`"
          variante="alerta"
          :texto="aviso"
          data-testid="abrir-atd-padrao-aviso"
        />
        <SanteAlerta
          v-if="daCarteira !== null"
          variante="info"
          :texto="t('atendimento.abrir.daCarteira')"
          data-testid="abrir-atd-da-carteira"
        />
        <SanteAlerta
          v-for="aviso in avisosCobertura"
          :key="`carteira-aviso-${aviso.id}`"
          variante="alerta"
          :texto="aviso.mensagem"
          data-testid="abrir-atd-carteira-aviso"
        />
        <p v-if="semCarteira || avisosCobertura.length" class="secundario">
          <span v-if="semCarteira === 'sem-vigor'">{{ t('atendimento.abrir.semCarteiraUtil') }} </span>
          <span v-if="semCarteira === 'nao-aceita'">{{ t('atendimento.abrir.semCarteiraAceita') }} </span>
          <!-- Em outra aba: a abertura fica montada, com o que já foi preenchido, a senha e a marcação. -->
          <RouterLink
            :to="`/cadastros/pacientes/${paciente.id}`"
            target="_blank"
            rel="noopener"
            data-testid="abrir-atd-ver-carteiras"
            >{{ t('atendimento.abrir.verCarteiras') }}</RouterLink
          >
          <SanteBotao
            variante="texto"
            :rotulo="t('atendimento.abrir.relerCarteiras')"
            :desabilitado="coberturas.isFetching.value"
            data-testid="abrir-atd-reler-carteiras"
            @acionar="coberturas.refetch()"
          />
        </p>
        <SanteAlerta
          v-for="(aviso, i) in avisosHeranca"
          :key="`heranca-aviso-${i}`"
          variante="alerta"
          :texto="aviso"
          data-testid="abrir-atd-heranca-aviso"
        />
        <div class="filtros">
          <label
            ><input v-model="naoIdentificado" type="checkbox" data-testid="abrir-atd-nao-identificado" />
            {{ t('atendimento.abrir.naoIdentificado') }}</label
          >
        </div>
        <SanteCampoTexto
          v-if="naoIdentificado"
          v-model="caracteristicas"
          :rotulo="t('atendimento.abrir.caracteristicas')"
          :max-bytes="200"
          multilinha
          data-testid="abrir-atd-caracteristicas"
        />
        <details v-if="historico.data.value?.historico.length">
          <summary>
            {{ t('atendimento.abrir.anteriores', { n: historico.data.value.historico.length }) }}
          </summary>
          <ul>
            <li v-for="h in historico.data.value.historico.slice(0, 10)" :key="h.reg">
              {{ dataBr(h.data) }} · {{ h.tipo }} · {{ h.convenio }} · {{ h.profissional }}
            </li>
          </ul>
        </details>
        <OrigemNaAbertura v-if="!naoIdentificado" :id-paciente="paciente.id" />
        <CadastroPendenteAbertura
          v-if="!naoIdentificado"
          :id-paciente="paciente.id"
          :tipo="tipo"
          :convenio="convenio"
          :modulo="moduloRecepcao"
          :local="local"
          :senha="senha"
          :marcacao="marcacao"
        />
        <RepresentacaoNaAbertura v-if="!naoIdentificado" :id-paciente="paciente.id" />
      </template>
    </section>

    <section class="painel" aria-labelledby="abrir-atd-ficha">
      <h2 id="abrir-atd-ficha">{{ t('atendimento.abrir.ficha') }}</h2>
      <div class="filtros">
        <SanteSelecao v-model="tipo" :rotulo="t('atendimento.tipo')" :opcoes="tipos" />
        <SanteSelecao v-model="convenio" :rotulo="t('atendimento.convenio')" :opcoes="convenios" />
        <SanteSelecao
          v-if="!lab"
          v-model="especialidade"
          :rotulo="t('atendimento.especialidade')"
          :opcoes="especialidades"
        />
        <SanteSelecao
          v-model="profissional"
          :rotulo="t('atendimento.profissional')"
          :opcoes="profissionais"
        />
        <SanteSelecao v-model="unidade" :rotulo="t('atendimento.unidade')" :opcoes="unidades" />
        <SanteSelecao
          v-model="servico"
          :rotulo="t('atendimento.servico')"
          :opcoes="servicos"
          data-testid="abrir-servico"
        />
        <SanteSelecao v-model="centroCusto" :rotulo="t('atendimento.centroCusto')" :opcoes="centros" />
      </div>
      <SanteOpcoes v-model="carater" :legenda="t('atendimento.carater')" :opcoes="caracteres" />
      <div class="filtros">
        <label><input v-model="retorno" type="checkbox" /> {{ t('atendimento.abrir.retorno') }}</label>
        <label v-if="!lab"
          ><input v-model="horarioEspecial" type="checkbox" />
          {{ t('atendimento.abrir.horarioEspecial') }}</label
        >
      </div>

      <form class="filtros" role="search" @submit.prevent="procurarProcedimento">
        <div class="campo">
          <label for="abrir-atd-proc">{{ t('atendimento.procedimento') }}</label>
          <input
            id="abrir-atd-proc"
            v-model="procedimento"
            inputmode="numeric"
            data-testid="abrir-atd-procedimento"
          />
        </div>
        <div class="campo">
          <label for="abrir-atd-proc-termo">{{ t('atendimento.abrir.buscarProcedimento') }}</label>
          <input id="abrir-atd-proc-termo" v-model="termoProcedimento" type="search" autocomplete="off" />
        </div>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('atendimento.buscar')"
          :desabilitado="!convenio"
        />
      </form>
      <ul v-if="procedimentos.length" class="lista-simples">
        <li v-for="p in procedimentos" :key="p.codigo">
          <SanteBotao
            variante="texto"
            :rotulo="`${p.codigo} · ${p.nome}`"
            @acionar="((procedimento = String(p.codigo)), (procedimentos = []))"
          />
        </li>
      </ul>

      <template v-if="!lab">
        <form class="filtros" role="search" @submit.prevent="procurarCid">
          <div class="campo">
            <label for="abrir-atd-cid">{{ t('atendimento.abrir.cid') }}</label>
            <input
              id="abrir-atd-cid"
              v-model="termoCid"
              type="search"
              autocomplete="off"
              data-testid="abrir-atd-cid"
            />
          </div>
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('atendimento.buscar')"
            data-testid="abrir-atd-cid-buscar"
          />
        </form>
        <p v-if="cid" class="acoes" data-testid="abrir-atd-cid-escolhido">
          {{ cid.rotulo }}
          <SanteBotao variante="texto" :rotulo="t('atendimento.trocar')" @acionar="cid = null" />
        </p>
        <ul v-else-if="cids.length" class="lista-simples">
          <li v-for="c in cids" :key="c.id">
            <SanteBotao
              variante="texto"
              :rotulo="`${c.codigo} · ${c.nome}`"
              :data-testid="`abrir-atd-cid-${c.id}`"
              @acionar="((cid = { id: c.id, rotulo: `${c.codigo} · ${c.nome}` }), (cids = []))"
            />
          </li>
        </ul>
      </template>
      <template v-else>
        <form class="filtros" role="search" @submit.prevent="procurarSolicitante">
          <div class="campo">
            <label for="abrir-atd-sol">{{ t('atendimento.abrir.solicitante') }}</label>
            <input id="abrir-atd-sol" v-model="termoSolicitante" type="search" autocomplete="off" />
          </div>
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('atendimento.buscar')" />
          <div class="campo">
            <label for="abrir-atd-dt-req">{{ t('atendimento.abrir.dataRequisicao') }}</label>
            <input id="abrir-atd-dt-req" v-model="dataRequisicao" type="date" />
          </div>
        </form>
        <p v-if="solicitante" class="acoes">
          {{ solicitante.rotulo }}
          <SanteBotao variante="texto" :rotulo="t('atendimento.trocar')" @acionar="solicitante = null" />
        </p>
        <ul v-else-if="solicitantes.length" class="lista-simples">
          <li v-for="s in solicitantes" :key="s.id">
            <SanteBotao
              variante="texto"
              :rotulo="`${s.nome} · ${s.registro}`"
              @acionar="((solicitante = { id: s.id, rotulo: s.nome }), (solicitantes = []))"
            />
          </li>
        </ul>
      </template>
      <ErroAtendimento v-if="erroBusca" :erro="erroBusca" />
    </section>

    <section class="painel" aria-labelledby="abrir-atd-segurado">
      <h2 id="abrir-atd-segurado">{{ t('atendimento.segurado.titulo') }}</h2>
      <div class="filtros">
        <SanteCampoTexto v-model="matricula" :rotulo="t('atendimento.segurado.matricula')" :max-bytes="24" />
        <div class="campo">
          <label for="abrir-atd-val">{{ t('atendimento.segurado.validade') }}</label>
          <input id="abrir-atd-val" v-model="validadeCarteira" type="date" />
        </div>
        <SanteCampoTexto v-model="guia" :rotulo="t('atendimento.segurado.guia')" :max-bytes="20" />
        <SanteCampoTexto v-model="plano" :rotulo="t('atendimento.segurado.plano')" :max-bytes="40" />
      </div>
      <ElegibilidadeNaAbertura
        v-model:senha="senhaConvenio"
        v-model:validade-senha="validadeSenha"
        :paciente="paciente?.id ?? null"
      />
      <RegraPlanoNaAbertura
        :fonte="convenio === '' ? 0 : Number(convenio)"
        :paciente="paciente?.id ?? null"
        :carteira="matricula"
        :validade-carteira="validadeCarteira"
        :guia="guia"
        :senha="senhaConvenio"
        :validade-senha="validadeSenha"
        :especialidade="especialidade === '' ? null : Number(especialidade)"
        :servico="servico === '' ? null : Number(servico)"
        :setor="unidade === '' ? null : Number(unidade)"
        :aberto="avisoPlano"
      />
      <label
        ><input v-model="comResponsavel" type="checkbox" /> {{ t('atendimento.abrir.comResponsavel') }}</label
      >
      <div v-if="comResponsavel" class="filtros">
        <SanteCampoTexto v-model="respNome" :rotulo="t('atendimento.abrir.responsavel')" :max-bytes="70" />
        <SanteSelecao
          v-model="respParentesco"
          :rotulo="t('atendimento.abrir.parentesco')"
          :opcoes="parentescos"
        />
        <div class="campo">
          <label for="abrir-atd-resp-tel">{{ t('atendimento.abrir.telefone') }}</label>
          <input id="abrir-atd-resp-tel" v-model="respTelefone" inputmode="tel" maxlength="20" />
        </div>
      </div>
      <SanteCampoTexto
        v-model="observacao"
        :rotulo="t('atendimento.abrir.observacao')"
        :max-bytes="400"
        multilinha
      />
    </section>

    <p v-if="avisoPlano" class="acoes">
      <RouterLink
        :to="`/recepcao/atendimento/${avisoPlano.reg}/impressos?novo=sim`"
        data-testid="abrir-atd-seguir-impressos"
        >{{ t('atendimento.impressos.titulo') }}</RouterLink
      >
    </p>
    <p v-else class="acoes">
      <SanteBotao
        v-if="podeAbrir"
        :rotulo="t('atendimento.abrir.gravar')"
        :desabilitado="!pronto || ocupado"
        data-testid="botao-abrir-atendimento"
        @acionar="abrir"
      />
      <span v-else class="secundario">{{ t('atendimento.semAcao') }}</span>
    </p>
    <RecusaCadastroIncompleto
      v-if="paciente && camposDaRecusaDeCadastro(erro)"
      :erro="erro"
      :id-paciente="paciente.id"
      :tipo="tipo"
      :convenio="convenio"
      :modulo="moduloRecepcao"
    />
    <ErroAtendimento v-else-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.lista-simples {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-3);
}
</style>
