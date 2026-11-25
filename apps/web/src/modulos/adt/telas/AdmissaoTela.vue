<script setup lang="ts">
// Admissão (ficha do M21, seção 7): `/internacao/admissao` (`?paciente=` da pré-internação, `?leito=bloco|acom|leito`
// do mapa). O paciente do cadastro único, o leito livre do mapa operacional (bloqueado e em higienização não aparecem),
// o convênio e a carteirinha, a especialidade, os médicos, o CID e o procedimento, a origem (o atendimento do PA) e o
// nível de cuidado. A pré-internação do paciente preenche o que tem. Ao gravar, a pulseira sai na impressora da estação.
import {
  ACOMODACOES_PLANO,
  CARATERES_INTERNACAO,
  CLINICAS_INTERNACAO,
  leitoDaChaveTexto,
  NIVEIS_CUIDADO,
  ORIGENS_INTERNACAO,
} from '@sgh/contratos';
import { conferirAcidente, ehAcidenteDeTrabalho, TIPOS_ACIDENTE } from '@sgh/dominio-internacao';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import CadastroPendenteAbertura from '../../cadastro/componentes/CadastroPendenteAbertura.vue';
import RecusaCadastroIncompleto from '../../cadastro/componentes/RecusaCadastroIncompleto.vue';
import RepresentacaoNaAbertura from '../../cadastro/componentes/RepresentacaoNaAbertura.vue';
import {
  camposDaRecusaDeCadastro,
  consultaDeRotaDoEscopo,
  escopoDaAbertura,
} from '../../cadastro/escopo-regra-campo.js';
import {
  buscarCid,
  buscarMedicos,
  emitirImpresso,
  internar,
  lerMapa,
  lerPreDoPaciente,
  novaChave,
} from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { leitoTexto } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { apoio, pode, motivoDe } = usarAdt();
const podeInternar = pode('internacao.internar');
const aviso = motivoDe('internacao.internar');
const q = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');

// ── Paciente ──
const termo = ref('');
// M44: a admissão vinda do NIR busca pelo prontuário (`?prontuario=`) e escolhe o cadastro pelo `?paciente=`.
const pedido = ref(q('prontuario') || q('paciente'));
const pacientes = useQuery({
  queryKey: computed(() => ['adt', 'pacientes', pedido.value]),
  queryFn: () => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string; prontuario: number } | null>(null);
watch(
  () => pacientes.data.value,
  (d) => {
    // Da pré-internação (`?paciente=`): o cadastro do paciente pedido entra direto.
    const id = Number(q('paciente'));
    const p = id ? d?.itens.find((x) => x.id === id) : undefined;
    if (p && !paciente.value)
      paciente.value = { id: p.id, nome: p.nomeSocial ?? p.nome, prontuario: p.prontuario };
  },
);
const pre = useQuery({
  queryKey: computed(() => ['adt', 'pre-paciente', paciente.value?.id ?? 0]),
  queryFn: () => lerPreDoPaciente(paciente.value?.id ?? 0),
  enabled: computed(() => paciente.value !== null),
});

// ── Campos ──
const leito = ref(q('leito'));
const convenio = ref('');
const especialidade = ref('');
const assistente = ref('');
const solicitante = ref('');
const cid = ref('');
const procedimento = ref('');
const matricula = ref('');
const validadeCarteira = ref('');
const senhaConvenio = ref('');
const guia = ref('');
// F3.4 (04-INT 68): a guia da admissão é a inicial do histórico e precisa das diárias autorizadas (validação na hora).
const diariasGuia = ref('');
const plano = ref<string>('ENFERMARIA');
const carater = ref('urgencia');
const clinica = ref('M');
const origem = ref(q('origem') || 'ambulatorio');
const atendimentoOrigem = ref(q('atendimento'));
// M44 (etapa 2): a admissão vinda do NIR (`?solicitacao=`): o leito reservado para ela é admissível só para ela.
const solicitacaoNir = /^\d+$/.test(q('solicitacao')) ? Number(q('solicitacao')) : null;
const cirurgia = ref('');
const nivel = ref('');
const unidade = ref('');
const centroCusto = ref('');
const isolamento = ref(false);
// F3.4 (04-INT 67): o acidente que motivou a internação, conferido na hora pela regra do domínio (o servidor confere de
// novo e grava na mesma transação da admissão, com o indicador de acidente da guia TISS).
const acidente = ref({
  tipo: '',
  ocorridoEm: '',
  local: '',
  empregadorCnpj: '',
  empregadorNome: '',
  numeroComunicacao: '',
});
const acidenteDeTrabalho = computed(() => ehAcidenteDeTrabalho(acidente.value.tipo));
const corpoAcidente = computed(() => {
  const a = acidente.value;
  if (!a.tipo) return undefined;
  const trabalho = acidenteDeTrabalho.value;
  return {
    tipo: a.tipo as (typeof TIPOS_ACIDENTE)[number],
    ...(a.ocorridoEm ? { ocorridoEm: a.ocorridoEm.slice(0, 16) } : {}),
    ...(a.local.trim() ? { local: a.local.trim() } : {}),
    ...(trabalho && a.empregadorCnpj.trim() ? { empregadorCnpj: a.empregadorCnpj.trim() } : {}),
    ...(trabalho && a.empregadorNome.trim() ? { empregadorNome: a.empregadorNome.trim() } : {}),
    ...(trabalho && a.numeroComunicacao.trim() ? { numeroComunicacao: a.numeroComunicacao.trim() } : {}),
  };
});
const agoraLocal = () => {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};
/** A mesma regra do servidor, na hora; a entrada da internação é agora. */
const conferenciaAcidente = computed(() => {
  const c = corpoAcidente.value;
  if (!c) return null;
  const r = conferirAcidente(c, agoraLocal());
  return r.ok ? null : r.motivo;
});
watch(
  () => pre.data.value?.pre,
  (p) => {
    if (!p) return;
    convenio.value = String(p.convenio);
    especialidade.value = String(p.especialidade);
    if (p.clinica) clinica.value = p.clinica;
    carater.value = p.carater === '2' ? 'urgencia' : 'eletivo';
    procedimento.value = p.procedimento === null ? '' : String(p.procedimento);
    solicitante.value = String(p.vinculoSolicitante);
    assistente.value = String(p.vinculoAssistente);
    matricula.value = p.matricula === '0' ? '' : p.matricula;
    plano.value = p.plano.includes('APART') ? 'APARTAMENTO' : 'ENFERMARIA';
    origem.value = 'eletiva';
  },
);
watch(
  () => apoio.data.value,
  (a) => {
    if (!a) return;
    if (!unidade.value && a.unidades[0]) unidade.value = String(a.unidades[0].codigo);
    if (!centroCusto.value && a.centrosCusto[0]) centroCusto.value = String(a.centrosCusto[0].codigo);
  },
  { immediate: true },
);

// O mapa para o paciente escolhido: o servidor diz quais leitos não o aceitam pelos atributos (sexo e faixa de idade).
const mapa = useQuery({
  queryKey: computed(() => ['adt', 'mapa', 'paciente', paciente.value?.id ?? 0, solicitacaoNir ?? 0]),
  queryFn: () =>
    lerMapa(false, {
      ...(paciente.value ? { paciente: paciente.value.id } : {}),
      ...(solicitacaoNir ? { solicitacao: solicitacaoNir } : {}),
    }),
});
const incompativeis = computed(() =>
  (mapa.data.value?.leitos ?? []).filter((l) => l.admissivel && l.incompatibilidade),
);
const termoMedico = ref('');
const pedidoMedico = ref('');
const medicos = useQuery({
  queryKey: computed(() => ['adt', 'medicos', pedidoMedico.value]),
  queryFn: () => buscarMedicos(pedidoMedico.value),
  enabled: computed(() => pedidoMedico.value.length >= 2 || !!pre.data.value?.pre),
});
const termoCid = ref('');
const pedidoCid = ref('');
const cids = useQuery({
  queryKey: computed(() => ['adt', 'cid', pedidoCid.value]),
  queryFn: () => buscarCid(pedidoCid.value),
  enabled: computed(() => pedidoCid.value.length >= 2),
});
const vazio = computed(() => ({ valor: '', rotulo: t('adt.escolha') }));
const opcoes = computed(() => {
  const a = apoio.data.value;
  return {
    leitos: [
      vazio.value,
      ...(mapa.data.value?.leitos ?? [])
        .filter((l) => l.admissivel && !l.incompatibilidade)
        .map((l) => ({ valor: l.chave, rotulo: leitoTexto(l.leito) })),
    ],
    convenios: [
      vazio.value,
      ...(a?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
    ],
    especialidades: [
      vazio.value,
      ...(a?.especialidades ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
    ],
    medicos: [
      vazio.value,
      ...(medicos.data.value ?? []).map((m) => ({
        valor: String(m.vinculo),
        rotulo: `${m.nome} (${m.conselho})`,
      })),
    ],
    cids: [
      vazio.value,
      ...(cids.data.value ?? []).map((c) => ({ valor: String(c.id), rotulo: `${c.codigo} ${c.nome}` })),
    ],
    planos: ACOMODACOES_PLANO.map((p) => ({
      valor: p as string,
      rotulo: p.charAt(0) + p.slice(1).toLowerCase(),
    })),
    acidentes: [
      { valor: '', rotulo: t('adt.admissao.semAcidente') },
      ...TIPOS_ACIDENTE.map((v) => ({ valor: v as string, rotulo: t(`adt.registros.tiposAcidente.${v}`) })),
    ],
    carateres: CARATERES_INTERNACAO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo })),
    clinicas: CLINICAS_INTERNACAO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo })),
    origens: ORIGENS_INTERNACAO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo })),
    niveis: [vazio.value, ...NIVEIS_CUIDADO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo }))],
    unidades: (a?.unidades ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
    centros: (a?.centrosCusto ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  };
});
const leitoEscolhido = computed(() => leitoDaChaveTexto(leito.value));
const completo = computed(
  () =>
    (!guia.value.trim() || Number(diariasGuia.value) >= 1) &&
    conferenciaAcidente.value === null &&
    paciente.value !== null &&
    leitoEscolhido.value !== null &&
    !!convenio.value &&
    !!especialidade.value &&
    !!assistente.value &&
    !!solicitante.value &&
    !!cid.value &&
    /^\d+$/.test(procedimento.value.trim()) &&
    !!unidade.value &&
    !!centroCusto.value &&
    (origem.value !== 'pa' || /^\d+$/.test(atendimentoOrigem.value.trim())) &&
    (origem.value !== 'cirurgia' || /^\d+$/.test(cirurgia.value.trim())),
);

const erro = ref<unknown>(null);
// A admissão recusada por cadastro incompleto (regra de campo, 02-CAD linha 2) mostra os campos e o atalho da ficha.
const recusaDeCadastro = computed(() => camposDaRecusaDeCadastro(erro.value) !== null);
const ocupado = ref(false);
const feito = ref<{ reg: number; mensagem: string } | null>(null);
async function gravar(): Promise<void> {
  const p = paciente.value;
  const l = leitoEscolhido.value;
  if (!p || !l) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await internar(
      {
        paciente: p.id,
        leito: l,
        convenio: Number(convenio.value),
        especialidade: Number(especialidade.value),
        medicoAssistente: Number(assistente.value),
        medicoSolicitante: Number(solicitante.value),
        cidPrincipal: Number(cid.value),
        procedimento: Number(procedimento.value),
        centroCusto: Number(centroCusto.value),
        unidade: Number(unidade.value),
        acomodacaoPlano: plano.value,
        carater: carater.value,
        clinica: clinica.value,
        origem: origem.value,
        isolamento: isolamento.value,
        ...(matricula.value.trim() ? { matricula: matricula.value.trim() } : {}),
        ...(validadeCarteira.value ? { validadeCarteira: validadeCarteira.value } : {}),
        ...(senhaConvenio.value.trim() ? { senhaConvenio: senhaConvenio.value.trim() } : {}),
        ...(guia.value.trim()
          ? { guia: guia.value.trim(), diariasAutorizadas: Number(diariasGuia.value) }
          : {}),
        ...(origem.value === 'pa' ? { atendimentoOrigem: Number(atendimentoOrigem.value) } : {}),
        ...(origem.value === 'cirurgia' ? { cirurgia: Number(cirurgia.value) } : {}),
        ...(nivel.value ? { nivelCuidado: nivel.value } : {}),
        ...(solicitacaoNir ? { solicitacaoNir } : {}),
        ...(corpoAcidente.value ? { acidente: corpoAcidente.value } : {}),
      },
      novaChave('internar'),
    );
    feito.value = {
      reg: Number(r.resultado['reg']),
      mensagem: t('adt.admissao.internado', { reg: r.resultado['reg'] }),
    };
    await cliente.invalidateQueries({ queryKey: ['adt'] });
  } catch (x) {
    erro.value = x;
    await mapa.refetch();
  } finally {
    ocupado.value = false;
  }
}
const pulseira = ref<string | null>(null);
async function imprimirPulseira(): Promise<void> {
  if (!feito.value) return;
  erro.value = null;
  try {
    await emitirImpresso(
      feito.value.reg,
      { impresso: 'pulseira', formato: 'zpl', copias: 1 },
      novaChave('pulseira'),
    );
    pulseira.value = t('adt.impressos.enviado');
  } catch (x) {
    erro.value = x;
  }
}
const textoLeito = (k: string) => {
  const l = leitoDaChaveTexto(k);
  return l ? leitoTexto(l) : k;
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="admissao-titulo" data-testid="tela-admissao">
    <h1 id="admissao-titulo">{{ t('adt.admissao.titulo') }}</h1>
    <p>{{ t('adt.admissao.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <template v-if="feito">
      <p role="status" data-testid="admissao-feita">{{ feito.mensagem }}</p>
      <p class="acoes">
        <SanteBotao
          :rotulo="t('adt.admissao.pulseira')"
          data-testid="admissao-pulseira"
          @acionar="imprimirPulseira"
        />
        <RouterLink :to="`/internacao/${feito.reg}/guias`" data-testid="admissao-abrir">{{
          t('adt.admissao.abrir')
        }}</RouterLink>
      </p>
      <p v-if="pulseira" role="status" data-testid="pulseira-enviada">{{ pulseira }}</p>
      <ErroAdt v-if="erro && !recusaDeCadastro" :erro="erro" />
    </template>
    <template v-else>
      <section class="painel" aria-labelledby="admissao-paciente">
        <h2 id="admissao-paciente">{{ t('adt.paciente') }}</h2>
        <form v-if="!paciente" class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('adt.admissao.pacienteBusca')"
            :max-bytes="60"
            data-testid="admissao-termo"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('adt.admissao.buscarPaciente')"
            data-testid="admissao-buscar"
          />
        </form>
        <p v-if="!paciente" class="secundario">
          {{ t('adt.admissao.semCadastro') }}
          <RouterLink
            :to="{
              path: '/cadastros/pacientes/novo',
              query: consultaDeRotaDoEscopo(escopoDaAbertura({ tipo: 'internacao', convenio })),
            }"
            data-testid="admissao-cadastrar"
            >{{ t('adt.admissao.cadastrar') }}</RouterLink
          >
        </p>
        <ul v-if="!paciente && pacientes.data.value" class="lista-simples">
          <li v-for="p in pacientes.data.value.itens" :key="p.id">
            <SanteBotao
              variante="texto"
              :rotulo="
                t('adt.admissao.escolherPaciente', { nome: p.nomeSocial ?? p.nome, pront: p.prontuario })
              "
              :data-testid="`admissao-paciente-${p.id}`"
              @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome, prontuario: p.prontuario }"
            />
          </li>
        </ul>
        <p v-if="paciente" class="acoes" data-testid="admissao-paciente-escolhido">
          <strong>{{ paciente.nome }}</strong>
          <span>{{ t('adt.prontuario', { n: paciente.prontuario }) }}</span>
          <SanteBotao variante="texto" :rotulo="t('adt.trocar')" @acionar="paciente = null" />
        </p>
        <CadastroPendenteAbertura
          v-if="paciente"
          :id-paciente="paciente.id"
          tipo="internacao"
          :convenio="convenio"
        />
        <RepresentacaoNaAbertura v-if="paciente" :id-paciente="paciente.id" />
        <SanteAlerta v-if="pre.data.value?.pre" variante="info" :texto="t('adt.admissao.temPre')" />
        <SanteAlerta
          v-if="solicitacaoNir"
          variante="info"
          data-testid="admissao-vinda-nir"
          :texto="t('adt.admissao.vindaNir', { solicitacao: solicitacaoNir })"
        />
      </section>
      <section v-if="paciente" class="painel" aria-labelledby="admissao-dados">
        <h2 id="admissao-dados">{{ t('adt.internacao') }}</h2>
        <div class="filtros">
          <SanteSelecao
            v-model="leito"
            :rotulo="t('adt.admissao.leitoLivre')"
            :opcoes="opcoes.leitos"
            data-testid="admissao-leito"
          />
          <p v-if="leito && !leitoEscolhido" class="secundario">{{ textoLeito(leito) }}</p>
          <details v-if="incompativeis.length > 0" class="secundario" data-testid="admissao-incompativeis">
            <summary>{{ t('adt.admissao.incompativeis', { n: incompativeis.length }) }}</summary>
            <ul class="lista-simples">
              <li v-for="l in incompativeis" :key="l.chave">
                {{ leitoTexto(l.leito) }}: {{ l.incompatibilidade }}
              </li>
            </ul>
          </details>
          <SanteSelecao
            v-model="convenio"
            :rotulo="t('adt.convenio')"
            :opcoes="opcoes.convenios"
            data-testid="admissao-convenio"
          />
          <SanteSelecao v-model="plano" :rotulo="t('adt.admissao.acomodacaoPlano')" :opcoes="opcoes.planos" />
          <SanteCampoTexto v-model="matricula" :rotulo="t('adt.admissao.matricula')" :max-bytes="24" />
          <div class="campo">
            <label for="admissao-validade">{{ t('adt.admissao.validadeCarteira') }}</label>
            <input id="admissao-validade" v-model="validadeCarteira" type="date" />
          </div>
          <SanteCampoTexto
            v-model="senhaConvenio"
            :rotulo="t('adt.admissao.senhaConvenio')"
            :max-bytes="20"
          />
          <SanteCampoTexto v-model="guia" :rotulo="t('adt.admissao.guia')" :max-bytes="20" />
          <div v-if="guia.trim()" class="campo">
            <label for="admissao-diarias-guia">{{ t('adt.guias.validade') }}</label>
            <input
              id="admissao-diarias-guia"
              v-model="diariasGuia"
              type="number"
              min="1"
              max="999"
              required
              data-testid="admissao-diarias-guia"
            />
          </div>
        </div>
        <div class="filtros">
          <SanteSelecao
            v-model="especialidade"
            :rotulo="t('adt.especialidade')"
            :opcoes="opcoes.especialidades"
            data-testid="admissao-especialidade"
          />
          <SanteSelecao v-model="clinica" :rotulo="t('adt.clinica')" :opcoes="opcoes.clinicas" />
          <SanteSelecao v-model="carater" :rotulo="t('adt.admissao.carater')" :opcoes="opcoes.carateres" />
          <SanteSelecao v-model="nivel" :rotulo="t('adt.admissao.nivelCuidado')" :opcoes="opcoes.niveis" />
        </div>
        <form class="filtros" role="search" @submit.prevent="pedidoMedico = termoMedico.trim()">
          <SanteCampoTexto
            v-model="termoMedico"
            :rotulo="t('adt.admissao.buscarMedico')"
            :max-bytes="60"
            data-testid="admissao-termo-medico"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('adt.buscar')"
            data-testid="admissao-buscar-medico"
          />
          <SanteSelecao
            v-model="assistente"
            :rotulo="t('adt.medicoAssistente')"
            :opcoes="opcoes.medicos"
            data-testid="admissao-assistente"
          />
          <SanteSelecao
            v-model="solicitante"
            :rotulo="t('adt.medicoSolicitante')"
            :opcoes="opcoes.medicos"
            data-testid="admissao-solicitante"
          />
        </form>
        <form class="filtros" role="search" @submit.prevent="pedidoCid = termoCid.trim()">
          <SanteCampoTexto
            v-model="termoCid"
            :rotulo="t('adt.admissao.cid')"
            :max-bytes="60"
            data-testid="admissao-termo-cid"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('adt.buscar')"
            data-testid="admissao-buscar-cid"
          />
          <SanteSelecao
            v-model="cid"
            :rotulo="t('adt.admissao.cid')"
            :opcoes="opcoes.cids"
            data-testid="admissao-cid"
          />
        </form>
        <div class="filtros">
          <SanteCampoTexto
            v-model="procedimento"
            :rotulo="t('adt.admissao.procedimento')"
            :max-bytes="10"
            obrigatorio
            data-testid="admissao-procedimento"
          />
          <SanteSelecao v-model="unidade" :rotulo="t('adt.admissao.unidade')" :opcoes="opcoes.unidades" />
          <SanteSelecao
            v-model="centroCusto"
            :rotulo="t('adt.admissao.centroCusto')"
            :opcoes="opcoes.centros"
          />
          <SanteSelecao
            v-model="origem"
            :rotulo="t('adt.admissao.origem')"
            :opcoes="opcoes.origens"
            data-testid="admissao-origem"
          />
          <SanteCampoTexto
            v-if="origem === 'pa'"
            v-model="atendimentoOrigem"
            :rotulo="t('adt.admissao.atendimentoOrigem')"
            :max-bytes="10"
            obrigatorio
          />
          <SanteCampoTexto
            v-if="origem === 'cirurgia'"
            v-model="cirurgia"
            :rotulo="t('adt.admissao.cirurgia')"
            :max-bytes="10"
            obrigatorio
          />
          <label><input v-model="isolamento" type="checkbox" /> {{ t('adt.isolamento') }}</label>
        </div>
        <fieldset class="filtros" data-testid="admissao-acidente">
          <legend>{{ t('adt.admissao.acidente') }}</legend>
          <SanteSelecao
            v-model="acidente.tipo"
            :rotulo="t('adt.registros.tipoAcidente')"
            :opcoes="opcoes.acidentes"
            data-testid="admissao-acidente-tipo"
          />
          <template v-if="acidente.tipo">
            <div class="campo">
              <label for="admissao-acidente-ocorrido">{{ t('adt.registros.ocorridoEm') }}</label>
              <input
                id="admissao-acidente-ocorrido"
                v-model="acidente.ocorridoEm"
                type="datetime-local"
                data-testid="admissao-acidente-ocorrido"
              />
            </div>
            <SanteCampoTexto v-model="acidente.local" :rotulo="t('adt.registros.local')" :max-bytes="255" />
            <template v-if="acidenteDeTrabalho">
              <SanteCampoTexto
                v-model="acidente.empregadorCnpj"
                :rotulo="t('adt.registros.empregadorCnpj')"
                :max-bytes="18"
                data-testid="admissao-acidente-cnpj"
              />
              <SanteCampoTexto
                v-model="acidente.empregadorNome"
                :rotulo="t('adt.registros.empregadorNome')"
                :max-bytes="150"
                data-testid="admissao-acidente-empregador"
              />
              <SanteCampoTexto
                v-model="acidente.numeroComunicacao"
                :rotulo="t('adt.registros.numeroComunicacao')"
                :max-bytes="30"
              />
            </template>
          </template>
          <p class="secundario">{{ t('adt.admissao.acidenteAjuda') }}</p>
          <p
            v-if="conferenciaAcidente"
            class="secundario"
            role="alert"
            data-testid="admissao-acidente-conferencia"
          >
            {{ conferenciaAcidente }}
          </p>
        </fieldset>
        <SanteBotao
          :rotulo="t('adt.admissao.gravar')"
          :desabilitado="!podeInternar || !completo || ocupado"
          data-testid="admissao-gravar"
          @acionar="gravar"
        />
        <RecusaCadastroIncompleto
          v-if="paciente && recusaDeCadastro"
          :erro="erro"
          :id-paciente="paciente.id"
          tipo="internacao"
          :convenio="convenio"
        />
        <ErroAdt v-else-if="erro" :erro="erro" />
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
