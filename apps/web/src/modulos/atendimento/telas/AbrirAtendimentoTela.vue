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
import { preenchimentoDaMarcacao, tipoInicialDaAbertura } from '../regras-tela.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

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

// A herança: os campos marcados vêm do atendimento anterior (a pessoa confere).
const herdados = computed(() => new Set((apoio.data.value?.heranca ?? []).map((h) => h.campo)));
const herdou = ref<string[]>([]);
watch(
  () => historico.data.value,
  (h) => {
    const v = h?.anterior?.valores;
    if (!v) return;
    // Do agendamento, o que a marcação trouxe vence a herança (a herança só completa o que ficou vazio).
    const doAgendamento = preenchido.value;
    const usados: string[] = [];
    const usar = (campo: string, alvo: { value: string }) => {
      const x = v[campo];
      if (doAgendamento && alvo.value !== '') return;
      if (herdados.value.has(campo) && x !== null && x !== undefined && x !== '' && x !== 0) {
        alvo.value = String(x);
        usados.push(campo);
      }
    };
    usar('convenio', convenio);
    usar('profissional', profissional);
    usar('especialidade', especialidade);
    usar('unidade', unidade);
    usar('centroCusto', centroCusto);
    usar('matricula', matricula);
    usar('plano', plano);
    usar('validadeCarteira', validadeCarteira);
    herdou.value = usados;
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
        centroCusto: Number(centroCusto.value),
        procedimento: lab.value ? Number(procedimento.value || 0) : Number(procedimento.value),
        carater: carater.value,
        retorno: retorno.value,
        horarioEspecial: lab.value ? false : horarioEspecial.value,
        ...(cid.value ? { cidPrincipal: cid.value.id } : {}),
        ...(matricula.value.trim() ? { matricula: matricula.value } : {}),
        ...(validadeCarteira.value ? { validadeCarteira: validadeCarteira.value } : {}),
        ...(guia.value.trim() ? { guia: guia.value } : {}),
        ...(plano.value.trim() ? { plano: plano.value } : {}),
        ...(observacao.value.trim() ? { observacao: observacao.value } : {}),
        ...(lab.value && solicitante.value ? { solicitante: solicitante.value.id } : {}),
        ...(lab.value && dataRequisicao.value ? { dataRequisicao: dataRequisicao.value } : {}),
        ...(senha ? { senha, local: local ?? undefined } : {}),
        ...(marcacao ? { marcacao } : {}),
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
        <RouterLink to="/cadastros/pacientes/novo">{{ t('atendimento.abrir.cadastrar') }}</RouterLink>
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

    <p class="acoes">
      <SanteBotao
        v-if="podeAbrir"
        :rotulo="t('atendimento.abrir.gravar')"
        :desabilitado="!pronto || ocupado"
        data-testid="botao-abrir-atendimento"
        @acionar="abrir"
      />
      <span v-else class="secundario">{{ t('atendimento.semAcao') }}</span>
    </p>
    <ErroAtendimento v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.lista-simples {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-3);
}
</style>
