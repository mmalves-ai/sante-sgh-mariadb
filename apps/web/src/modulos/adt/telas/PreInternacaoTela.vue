<script setup lang="ts">
// Pré-internação e agendamento (ficha do M21, seção 7): `/internacao/pre`. As pré-internações pendentes com as
// contagens (sem data = data nula, a fila de espera; as datas impossíveis vão à lista de saneamento) e o
// agendamento novo (paciente, convênio, plano, especialidade, médico, procedimento, data opcional, acomodação
// desejada). A correção da data confere a data lida (outro terminal pode ter mudado). A admissão parte daqui.
import { CARATERES_INTERNACAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { dataBr } from '../../agenda/formato.js';
import {
  buscarMedicos,
  corrigirPreInternacao,
  listarPreInternacoes,
  novaChave,
  preInternar,
} from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import FilaEsperaInternacao from '../componentes/FilaEsperaInternacao.vue';
import PlanoPreInternacao from '../componentes/PlanoPreInternacao.vue';
import { hhmm } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivoDe } = usarAdt();
const podeAgendar = pode('internacao.preInternar');
const podeCorrigir = pode('internacao.corrigirPreInternacao');
const aviso = motivoDe('internacao.preInternar');
const podeAdmitir = pode('internacao.internar');
// C2-048: plano previsto (procedimentos, materiais, equipe) da pré-internação do paciente aberto na lista ou na fila.
const planoDe = ref<number | null>(null);
const saneamento = ref(false);
const todas = ref(false);
const lista = useQuery({
  queryKey: computed(() => ['adt', 'pre', saneamento.value, todas.value]),
  queryFn: () => listarPreInternacoes({ saneamento: saneamento.value, todas: todas.value }),
});

// ── Correção da data ──
const novaData = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function corrigir(paciente: number, versao: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const d = novaData.value[paciente];
    const r = await corrigirPreInternacao(
      paciente,
      { versao, ...(d ? { dataPrevista: d } : {}) },
      novaChave('corrigir-pre'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['adt', 'pre'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Agendamento ──
const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['adt', 'pacientes', pedido.value]),
  queryFn: () => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string; prontuario: number } | null>(null);
const termoMedico = ref('');
const pedidoMedico = ref('');
const medicos = useQuery({
  queryKey: computed(() => ['adt', 'medicos', pedidoMedico.value]),
  queryFn: () => buscarMedicos(pedidoMedico.value),
  enabled: computed(() => pedidoMedico.value.length >= 2),
});
const medico = ref('');
const convenio = ref('');
const especialidade = ref('');
const plano = ref('');
const procedimento = ref('');
const dataPrevista = ref('');
const horaPrevista = ref('');
const clinica = ref('');
const carater = ref('eletivo');
const acomodacao = ref('');
const opcoes = computed(() => ({
  convenios: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(apoio.data.value?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ],
  especialidades: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(apoio.data.value?.especialidades ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ],
  medicos: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(medicos.data.value ?? []).map((m) => ({
      valor: String(m.vinculo),
      rotulo: `${m.nome} (${m.conselho})`,
    })),
  ],
  acomodacoes: [
    { valor: '', rotulo: t('adt.pre.semAcomodacao') },
    ...(apoio.data.value?.acomodacoes ?? []).map((a) => ({
      valor: `${a.bloco}|${a.acomodacao}`,
      rotulo: a.nome,
    })),
  ],
  clinicas: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(apoio.data.value?.clinicas ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ],
  carateres: CARATERES_INTERNACAO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo })),
}));
const completo = computed(
  () =>
    paciente.value !== null &&
    !!convenio.value &&
    !!especialidade.value &&
    !!medico.value &&
    !!clinica.value &&
    plano.value.trim().length > 0 &&
    /^\d*$/.test(procedimento.value.trim()),
);
const erroAgenda = ref<unknown>(null);
async function agendar(): Promise<void> {
  const p = paciente.value;
  if (!p) return;
  erroAgenda.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const [bloco, acomod] = acomodacao.value ? acomodacao.value.split('|') : [];
    const r = await preInternar(
      {
        paciente: p.id,
        convenio: Number(convenio.value),
        plano: plano.value.trim().toUpperCase(),
        especialidade: Number(especialidade.value),
        medicoSolicitante: Number(medico.value),
        ...(procedimento.value.trim() ? { procedimento: Number(procedimento.value) } : {}),
        clinica: Number(clinica.value),
        carater: carater.value,
        ...(dataPrevista.value ? { dataPrevista: dataPrevista.value } : {}),
        ...(horaPrevista.value ? { horaPrevista: horaPrevista.value } : {}),
        ...(bloco && acomod ? { acomodacao: { bloco, acomodacao: acomod } } : {}),
      },
      novaChave('pre'),
    );
    mensagem.value = r.mensagem;
    paciente.value = null;
    await cliente.invalidateQueries({ queryKey: ['adt', 'pre'] });
  } catch (x) {
    erroAgenda.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pre-titulo" data-testid="tela-pre-internacao">
    <h1 id="pre-titulo">{{ t('adt.pre.titulo') }}</h1>
    <p>{{ t('adt.pre.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <div class="filtros">
      <label
        ><input v-model="saneamento" type="checkbox" data-testid="pre-saneamento" />
        {{ t('adt.pre.verSaneamento') }}</label
      >
      <label><input v-model="todas" type="checkbox" /> {{ t('adt.pre.verTodas') }}</label>
    </div>
    <ErroAdt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ul class="cartoes" data-testid="pre-contagens">
        <li>{{ t('adt.pre.pendentes', { n: lista.data.value.contagens.pendentes }) }}</li>
        <li>{{ t('adt.pre.semData', { n: lista.data.value.contagens.semData }) }}</li>
        <li>{{ t('adt.pre.impossiveis', { n: lista.data.value.contagens.impossiveis }) }}</li>
      </ul>
      <p v-if="lista.data.value.itens.length === 0">{{ t('adt.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-pre">
        <caption class="secundario">
          {{
            t('adt.pre.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.paciente') }}</th>
            <th scope="col">{{ t('adt.data') }}</th>
            <th scope="col">{{ t('adt.convenio') }}</th>
            <th scope="col">{{ t('adt.especialidade') }}</th>
            <th scope="col">{{ t('adt.medico') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in lista.data.value.itens" :key="p.paciente" :data-testid="`pre-${p.paciente}`">
            <td>
              {{ p.nome }} <span class="secundario">· {{ t('adt.prontuario', { n: p.prontuario }) }}</span>
            </td>
            <td>
              {{ p.dataPrevista === null ? t('adt.pre.semDataRotulo') : dataBr(p.dataPrevista) }}
              {{ hhmm(p.horaPrevista) }}
              <span v-if="p.problema" class="selo">{{ t(`adt.pre.problema.${p.problema}`) }}</span>
            </td>
            <td>{{ p.convenio.nome }}</td>
            <td>{{ p.especialidade.nome }}</td>
            <td>{{ p.medico }}</td>
            <td class="acoes">
              <template v-if="podeCorrigir">
                <label :for="`pre-data-${p.paciente}`" class="visualmente-oculto">{{
                  t('adt.pre.dataPrevista')
                }}</label>
                <input
                  :id="`pre-data-${p.paciente}`"
                  v-model="novaData[p.paciente]"
                  type="date"
                  :data-testid="`pre-data-${p.paciente}`"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('adt.pre.corrigir')"
                  :desabilitado="ocupado"
                  :data-testid="`pre-corrigir-${p.paciente}`"
                  @acionar="corrigir(p.paciente, p.versao)"
                />
              </template>
              <SanteBotao
                v-if="p.situacao === 'pendente'"
                variante="texto"
                :rotulo="t('adt.prePlano.plano')"
                :data-testid="`pre-plano-abrir-${p.paciente}`"
                @acionar="planoDe = p.paciente"
              />
              <RouterLink
                v-if="podeAdmitir && p.situacao === 'pendente'"
                :to="`/internacao/admissao?paciente=${p.paciente}`"
                :data-testid="`pre-admitir-${p.paciente}`"
                >{{ t('adt.pre.admitir') }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value.cortada" class="secundario">{{ t('adt.cortada') }}</p>
    </template>
    <PlanoPreInternacao
      v-if="planoDe !== null"
      :key="planoDe"
      :paciente="planoDe"
      :pode-gravar="podeAgendar"
      @fechar="planoDe = null"
    />
    <FilaEsperaInternacao :pode-gravar="podeAgendar" @plano="(x) => (planoDe = x)" />
    <p v-if="mensagem" role="status" data-testid="pre-mensagem">{{ mensagem }}</p>
    <ErroAdt v-if="erro" :erro="erro" />

    <section v-if="podeAgendar" class="painel" aria-labelledby="pre-agendar">
      <h2 id="pre-agendar">{{ t('adt.pre.agendar') }}</h2>
      <form v-if="!paciente" class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('adt.admissao.pacienteBusca')"
          :max-bytes="60"
          data-testid="pre-termo"
        />
        <SanteBotao tipo="submit" :rotulo="t('adt.admissao.buscarPaciente')" data-testid="pre-buscar" />
      </form>
      <ul v-if="!paciente && pacientes.data.value" class="lista-simples">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="
              t('adt.admissao.escolherPaciente', { nome: p.nomeSocial ?? p.nome, pront: p.prontuario })
            "
            :data-testid="`pre-paciente-${p.id}`"
            @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome, prontuario: p.prontuario }"
          />
        </li>
      </ul>
      <template v-if="paciente">
        <p class="acoes">
          <strong>{{ paciente.nome }}</strong>
          <span>{{ t('adt.prontuario', { n: paciente.prontuario }) }}</span>
          <SanteBotao variante="texto" :rotulo="t('adt.trocar')" @acionar="paciente = null" />
        </p>
        <div class="filtros">
          <SanteSelecao
            v-model="convenio"
            :rotulo="t('adt.convenio')"
            :opcoes="opcoes.convenios"
            data-testid="pre-convenio"
          />
          <SanteCampoTexto
            v-model="plano"
            :rotulo="t('adt.pre.plano')"
            :max-bytes="40"
            obrigatorio
            data-testid="pre-plano"
          />
          <SanteSelecao
            v-model="especialidade"
            :rotulo="t('adt.especialidade')"
            :opcoes="opcoes.especialidades"
            data-testid="pre-especialidade"
          />
          <SanteSelecao v-model="clinica" :rotulo="t('adt.clinica')" :opcoes="opcoes.clinicas" />
          <SanteSelecao v-model="carater" :rotulo="t('adt.pre.carater')" :opcoes="opcoes.carateres" />
        </div>
        <form class="filtros" role="search" @submit.prevent="pedidoMedico = termoMedico.trim()">
          <SanteCampoTexto
            v-model="termoMedico"
            :rotulo="t('adt.admissao.buscarMedico')"
            :max-bytes="60"
            data-testid="pre-termo-medico"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('adt.buscar')"
            data-testid="pre-buscar-medico"
          />
          <SanteSelecao
            v-model="medico"
            :rotulo="t('adt.medicoSolicitante')"
            :opcoes="opcoes.medicos"
            data-testid="pre-medico"
          />
        </form>
        <div class="filtros">
          <SanteCampoTexto
            v-model="procedimento"
            :rotulo="t('adt.pre.procedimento')"
            :max-bytes="10"
            obrigatorio
            data-testid="pre-procedimento"
          />
          <div class="campo">
            <label for="pre-data">{{ t('adt.pre.dataPrevista') }}</label>
            <input id="pre-data" v-model="dataPrevista" type="date" data-testid="pre-data-prevista" />
          </div>
          <div class="campo">
            <label for="pre-hora">{{ t('adt.pre.horaPrevista') }}</label>
            <input id="pre-hora" v-model="horaPrevista" type="time" />
          </div>
          <SanteSelecao v-model="acomodacao" :rotulo="t('adt.pre.acomodacao')" :opcoes="opcoes.acomodacoes" />
        </div>
        <SanteAlerta v-if="!dataPrevista" variante="info" :texto="t('adt.pre.semDataRotulo')" />
        <SanteBotao
          :rotulo="t('adt.pre.agendar')"
          :desabilitado="!completo || ocupado"
          data-testid="pre-gravar"
          @acionar="agendar"
        />
        <ErroAdt v-if="erroAgenda" :erro="erroAgenda" />
      </template>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.selo {
  margin-left: var(--sgh-espaco-1);
  font-weight: 600;
}
.visualmente-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
