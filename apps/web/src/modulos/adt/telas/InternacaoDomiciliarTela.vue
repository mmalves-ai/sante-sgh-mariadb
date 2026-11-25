<script setup lang="ts">
// Internação domiciliar (C2-079, 04-INT linha 84). Duas entradas:
//   - `/internacao/domiciliar`: o painel (internações em aberto, fila dos chamados pela prioridade e hora, visitas dos
//     próximos 7 dias e orçamentos à espera) e a busca do paciente;
//   - `/internacao/domiciliar/paciente/:pac`: a visão do paciente, com tudo numa tela: orçamento (total na hora),
//     transferência para casa, chamados e visitas.
// Cada formulário valida na hora pela mesma regra do domínio que a API aplica, e os botões das linhas só se habilitam
// quando a regra aceita a ação. Nada se apaga.
import {
  conferirAcaoChamadoDomiciliar,
  conferirAcaoInternacaoDomiciliar,
  conferirAcaoOrcamento,
  conferirAcaoVisitaDomiciliar,
  conferirOrcamentoDomiciliar,
  conferirTransferenciaDomicilio,
  DESFECHOS_CHAMADO_DOMICILIAR,
  PRIORIDADES_CHAMADO_DOMICILIAR,
  TIPOS_ITEM_ORCAMENTO_DOMICILIAR,
  TIPOS_ORCAMENTO_DOMICILIAR,
  totaisOrcamentoDomiciliar,
  type AcaoChamadoDomiciliar,
  type AcaoInternacaoDomiciliar,
  type AcaoVisitaDomiciliar,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirChamadoDomiciliar,
  agendarVisitaDomiciliar,
  agirChamadoDomiciliar,
  agirInternacaoDomiciliar,
  agirOrcamentoDomiciliar,
  agirVisitaDomiciliar,
  type ChamadoDomiciliar,
  type InternacaoDomiciliar,
  lerOpcoesDomiciliar,
  lerPacienteDomiciliar,
  lerPainelDomiciliar,
  type OrcamentoDomiciliar,
  salvarOrcamentoDomiciliar,
  transferirParaCasa,
  type VisitaDomiciliar,
} from '../api-internacao-domiciliar.js';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const props = defineProps<{ pac?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const pacienteId = computed(() => (props.pac ? Number(props.pac) : null));
const podeGravar = computed(() => pode('internacao.internacao.criar'));
const D = 'adt.domiciliar';

const opcoes = useQuery({ queryKey: ['adt', 'domiciliar', 'opcoes'], queryFn: lerOpcoesDomiciliar });
const painel = useQuery({
  queryKey: ['adt', 'domiciliar', 'painel'],
  queryFn: lerPainelDomiciliar,
  enabled: computed(() => pacienteId.value === null),
});
const visao = useQuery({
  queryKey: computed(() => ['adt', 'domiciliar', 'paciente', pacienteId.value]),
  queryFn: () => lerPacienteDomiciliar(pacienteId.value!),
  enabled: computed(() => pacienteId.value !== null),
});
const dados = computed(() => (pacienteId.value === null ? painel.data.value : visao.data.value));
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'domiciliar'] });

type Id = number | '';
const nulo = (v: Id) => (v === '' ? null : v);
const op = computed(() => opcoes.data.value);
const comVazio = (vazio: string, itens: readonly { id: number; nome: string }[]) => [
  { valor: '' as Id, rotulo: vazio },
  ...itens.map((x) => ({ valor: x.id as Id, rotulo: x.nome })),
];
const enumOpcoes = (lista: readonly string[], chave: string, vazio?: string) => [
  ...(vazio !== undefined ? [{ valor: '', rotulo: vazio }] : []),
  ...lista.map((x) => ({ valor: x, rotulo: t(`${D}.${chave}.${x}`) })),
];
const hoje = () => new Date().toISOString().slice(0, 10);
const instante = (local: string) => (local ? new Date(local).toISOString() : null);
const hora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '');
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t(`${D}.feito`);
    void recarregar();
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
const executar = (fn: () => Promise<unknown>) => acao.mutate(fn);

// Busca do paciente (painel).
const termo = ref('');
const achados = ref<{ id: number; nome: string; prontuario: number }[] | null>(null);
const procurar = async () => {
  try {
    const r = await buscarPacientes(termo.value.trim());
    achados.value = r.itens.map((x) => ({
      id: x.id,
      nome: x.nomeSocial ?? x.nome,
      prontuario: x.prontuario,
    }));
  } catch (e) {
    erro.value = e;
  }
};

// Orçamento novo.
const tipoOrc = ref<string>('operadora');
const fonte = ref<Id>('');
const validade = ref('');
const impostos = ref(0);
const diagnostico = ref('');
const itemVazio = () => ({
  tipoItem: 'visita',
  tipoCusto: '' as Id,
  descricao: '',
  quantidade: 1,
  dias: 30,
  valorUnitario: 0,
});
const itens = ref([itemVazio()]);
const itensDominio = computed(() =>
  itens.value.map((i) => ({
    tipoItem: i.tipoItem,
    itemFaturavel: null,
    tipoCusto: nulo(i.tipoCusto),
    descricao: i.descricao,
    quantidade: Number(i.quantidade),
    dias: i.dias ? Number(i.dias) : null,
    valorUnitario: Number(i.valorUnitario),
    valorCustoUnitario: null,
    percentualAcrescimo: null,
  })),
);
const totais = computed(() => totaisOrcamentoDomiciliar(itensDominio.value, Number(impostos.value)));
const problemasOrc = computed(() =>
  conferirOrcamentoDomiciliar({
    tipo: tipoOrc.value,
    fontePagadora: nulo(fonte.value),
    periodoInicio: null,
    periodoFim: null,
    validade: validade.value || null,
    percentualImpostos: Number(impostos.value),
    itens: itensDominio.value,
    hoje: hoje(),
  }).map((p) => p.mensagem),
);
const salvarOrc = () =>
  executar(async () => {
    await salvarOrcamentoDomiciliar(null, {
      paciente: pacienteId.value,
      tipo: tipoOrc.value,
      fontePagadora: nulo(fonte.value),
      validade: validade.value || null,
      percentualImpostos: Number(impostos.value),
      diagnostico: diagnostico.value || null,
      itens: itensDominio.value.map((i) => ({
        tipoItem: i.tipoItem,
        tipoCusto: i.tipoCusto,
        descricao: i.descricao,
        quantidade: i.quantidade,
        dias: i.dias,
        valorUnitario: i.valorUnitario,
      })),
    });
    itens.value = [itemVazio()];
  });
const podeOrc = (o: OrcamentoDomiciliar, a: 'enviar' | 'aprovar' | 'recusar' | 'cancelar') =>
  conferirAcaoOrcamento({
    acao: a,
    situacao: o.situacao,
    itens: o.itens.length,
    validade: o.validade,
    hoje: hoje(),
  }).situacao !== null;
const agirOrc = (o: OrcamentoDomiciliar, a: string) =>
  executar(() => agirOrcamentoDomiciliar(o.id, a, { versao: o.versao }));

// Transferência para casa.
const endereco = ref<Id>('');
const origem = ref<Id>('');
const orcamento = ref<Id>('');
const motivoTr = ref<Id>('');
const medico = ref<Id>('');
const prevista = ref('');
const liminarNumero = ref('');
const liminarData = ref('');
const aprovados = computed(() =>
  (visao.data.value?.orcamentos ?? []).filter((o) => o.situacao === 'aprovado'),
);
const abertaDoPaciente = computed(() =>
  (visao.data.value?.internacoes ?? []).find((d) =>
    ['solicitada', 'em_avaliacao', 'ativa', 'suspensa'].includes(d.situacao),
  ),
);
const problemasTr = computed(() => {
  const pac = pacienteId.value ?? 0;
  const liminar = liminarNumero.value || liminarData.value;
  return conferirTransferenciaDomicilio({
    paciente: pac,
    enderecoDoPaciente: endereco.value !== '',
    origem: null,
    orcamento: orcamento.value === '' ? null : { paciente: pac, situacao: 'aprovado' },
    liminar: liminar ? { numero: liminarNumero.value || null, data: liminarData.value || null } : null,
    dataPrevista: prevista.value || null,
    outraAberta: !!abertaDoPaciente.value,
    hoje: hoje(),
  }).map((p) => p.mensagem);
});
const transferir = () =>
  executar(() =>
    transferirParaCasa({
      paciente: pacienteId.value,
      endereco: nulo(endereco.value),
      origemInternacao: nulo(origem.value),
      orcamento: nulo(orcamento.value),
      motivo: nulo(motivoTr.value),
      medico: nulo(medico.value),
      dataPrevista: prevista.value || null,
      liminarNumero: liminarNumero.value || null,
      liminarData: liminarData.value || null,
    }),
  );

// Barra de ação das linhas: motivo, profissional, prioridade e desfecho escolhidos uma vez para a linha clicada.
const motivo = ref('');
const profissional = ref<Id>('');
const prioridade = ref('');
const desfecho = ref('');
const ACOES_INT: AcaoInternacaoDomiciliar[] = [
  'avaliar',
  'iniciar',
  'suspender',
  'retomar',
  'encerrar',
  'cancelar',
];
const podeInt = (d: InternacaoDomiciliar, a: AcaoInternacaoDomiciliar) =>
  conferirAcaoInternacaoDomiciliar({
    acao: a,
    situacao: d.situacao,
    medicoResponsavel: d.medico !== null || profissional.value !== '',
    inicio: d.inicio ? new Date(d.inicio) : null,
    quando: new Date(),
    agora: new Date(),
    motivo: motivo.value,
    chamadosAbertos: 0,
    visitasEmAndamento: 0,
  }).situacao !== null;
const agirInt = (d: InternacaoDomiciliar, a: AcaoInternacaoDomiciliar) =>
  executar(() =>
    agirInternacaoDomiciliar(d.id, a, {
      versao: d.versao,
      motivo: motivo.value || null,
      medico: a === 'iniciar' ? nulo(profissional.value) : null,
    }),
  );
const ACOES_CH: Exclude<AcaoChamadoDomiciliar, 'iniciar'>[] = ['triar', 'atribuir', 'concluir', 'anular'];
const podeCh = (c: ChamadoDomiciliar, a: AcaoChamadoDomiciliar) =>
  conferirAcaoChamadoDomiciliar({
    acao: a,
    situacao: c.situacao,
    prioridade: prioridade.value || null,
    profissional: nulo(profissional.value),
    desfecho: desfecho.value || null,
    visitaRealizada: (dados.value?.visitas ?? []).some(
      (v) => v.chamado === c.id && v.situacao === 'realizada',
    ),
    motivo: motivo.value,
  }).situacao !== null;
const agirCh = (c: ChamadoDomiciliar, a: string) =>
  executar(() =>
    agirChamadoDomiciliar(c.id, a, {
      versao: c.versao,
      prioridade: prioridade.value || null,
      profissional: a === 'atribuir' ? nulo(profissional.value) : null,
      desfecho: a === 'concluir' ? desfecho.value || null : null,
      motivo: a === 'anular' ? motivo.value || null : null,
    }),
  );
const ACOES_VIS: AcaoVisitaDomiciliar[] = ['confirmar', 'iniciar', 'realizar', 'cancelar', 'nao_realizar'];
const podeVis = (v: VisitaDomiciliar, a: AcaoVisitaDomiciliar) =>
  conferirAcaoVisitaDomiciliar({
    acao: a,
    situacao: v.situacao,
    inicio: v.iniciadaEm
      ? new Date(v.iniciadaEm)
      : new Date(Math.min(Date.parse(v.agendadaPara), Date.now())),
    fim: new Date(),
    agora: new Date(),
    motivo: motivo.value,
  }).situacao !== null;
const agirVis = (v: VisitaDomiciliar, a: string) =>
  executar(() =>
    agirVisitaDomiciliar(v.id, a, {
      versao: v.versao,
      motivo: a === 'cancelar' || a === 'nao_realizar' ? motivo.value || null : null,
    }),
  );

// Chamado novo e visita.
const tipoCh = ref<Id>('');
const motivoCh = ref<Id>('');
const prioridadeNova = ref('');
const sintoma = ref('');
const logradouro = ref('');
const opMotivosCh = computed(() =>
  comVazio(
    t(`${D}.nenhum`),
    (op.value?.motivosChamado ?? []).filter((m) => m.tipo === null || m.tipo === nulo(tipoCh.value)),
  ),
);
const problemasCh = computed(() => [
  ...(tipoCh.value === '' ? [t(`${D}.tipoChamado`)] : []),
  ...(!abertaDoPaciente.value && !logradouro.value.trim() ? [t(`${D}.logradouro`)] : []),
]);
const abrirCh = () =>
  executar(() =>
    abrirChamadoDomiciliar({
      paciente: pacienteId.value,
      tipo: nulo(tipoCh.value),
      motivo: nulo(motivoCh.value),
      prioridade: prioridadeNova.value || null,
      sintoma: sintoma.value || null,
      logradouro: logradouro.value || null,
    }),
  );
const ativa = computed(() => (visao.data.value?.internacoes ?? []).find((d) => d.situacao === 'ativa'));
const tipoVis = ref<Id>('');
const profVis = ref<Id>('');
const quandoVis = ref('');
const duracao = ref<number | ''>(60);
const agendar = () =>
  executar(() =>
    agendarVisitaDomiciliar({
      internacao: ativa.value?.id,
      profissional: nulo(profVis.value),
      tipo: nulo(tipoVis.value),
      quando: instante(quandoVis.value),
      duracao: duracao.value === '' ? null : Number(duracao.value),
    }),
  );

const opProfs = computed(() => comVazio(t(`${D}.escolha`), op.value?.profissionais ?? []));
const opTiposCh = computed(() => comVazio(t(`${D}.escolha`), op.value?.tiposChamado ?? []));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="domiciliar-titulo" data-testid="tela-internacao-domiciliar">
    <h1 id="domiciliar-titulo">{{ pacienteId ? t(`${D}.tituloPaciente`) : t(`${D}.titulo`) }}</h1>
    <p>{{ pacienteId ? t(`${D}.textoPaciente`) : t(`${D}.texto`) }}</p>
    <p v-if="pacienteId" class="acoes">
      <RouterLink :to="{ name: 'adt.domiciliar' }" data-testid="domiciliar-ir-painel">{{
        t(`${D}.irPainel`)
      }}</RouterLink>
    </p>
    <ErroAdt v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <ErroAdt v-if="painel.isError.value" :erro="painel.error.value" />
    <ErroAdt v-if="visao.isError.value" :erro="visao.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="domiciliar-aviso">{{ aviso }}</p>
    <p v-if="!podeGravar" role="note" data-testid="domiciliar-somente-leitura">
      {{ t(`${D}.somenteLeitura`) }}
    </p>

    <form v-if="!pacienteId" class="filtros" data-testid="domiciliar-busca" @submit.prevent="procurar">
      <label
        >{{ t(`${D}.busca`) }} <input v-model="termo" maxlength="100" required data-testid="domiciliar-termo"
      /></label>
      <button type="submit" data-testid="domiciliar-buscar">{{ t(`${D}.buscar`) }}</button>
    </form>
    <ul v-if="achados" data-testid="domiciliar-achados">
      <li v-if="!achados.length">{{ t(`${D}.semResultado`) }}</li>
      <li v-for="a in achados" :key="a.id">
        <RouterLink
          :to="{ name: 'adt.domiciliar.paciente', params: { pac: a.id } }"
          :data-testid="`domiciliar-paciente-${a.id}`"
          >{{ a.nome }} · {{ a.prontuario }}</RouterLink
        >
      </li>
    </ul>
    <p v-if="pacienteId && visao.data.value" data-testid="domiciliar-paciente-nome">
      <strong>{{ visao.data.value.paciente.nome }}</strong>
    </p>

    <!-- Barra de ação das linhas -->
    <fieldset v-if="podeGravar" class="filtros" data-testid="domiciliar-barra">
      <SanteSelecao
        v-model="profissional"
        :rotulo="t(`${D}.profissional`)"
        :opcoes="opProfs"
        data-testid="domiciliar-acao-profissional"
      />
      <SanteSelecao
        v-model="prioridade"
        :rotulo="t(`${D}.prioridade`)"
        :opcoes="enumOpcoes(PRIORIDADES_CHAMADO_DOMICILIAR, 'prioridades', t(`${D}.escolha`))"
        data-testid="domiciliar-acao-prioridade"
      />
      <SanteSelecao
        v-model="desfecho"
        :rotulo="t(`${D}.desfecho`)"
        :opcoes="enumOpcoes(DESFECHOS_CHAMADO_DOMICILIAR, 'desfechos', t(`${D}.escolha`))"
        data-testid="domiciliar-acao-desfecho"
      />
      <label
        >{{ t(`${D}.motivo`) }} <input v-model="motivo" maxlength="300" data-testid="domiciliar-acao-motivo"
      /></label>
    </fieldset>

    <template v-if="pacienteId && visao.data.value">
      <h2>{{ t(`${D}.orcamentos`) }}</h2>
      <form
        v-if="podeGravar"
        class="filtros"
        data-testid="domiciliar-orcamento-form"
        @submit.prevent="salvarOrc"
      >
        <SanteSelecao
          v-model="tipoOrc"
          :rotulo="t(`${D}.tipoOrcamento`)"
          :opcoes="enumOpcoes(TIPOS_ORCAMENTO_DOMICILIAR, 'tiposOrcamento')"
          obrigatorio
          data-testid="domiciliar-orcamento-tipo"
        />
        <SanteSelecao
          v-model="fonte"
          :rotulo="t(`${D}.fonte`)"
          :opcoes="comVazio(t(`${D}.nenhum`), op?.fontes ?? [])"
          data-testid="domiciliar-orcamento-fonte"
        />
        <label
          >{{ t(`${D}.validade`) }}
          <input v-model="validade" type="date" data-testid="domiciliar-orcamento-validade"
        /></label>
        <label
          >{{ t(`${D}.impostos`) }}
          <input
            v-model.number="impostos"
            type="number"
            min="0"
            max="100"
            step="0.01"
            data-testid="domiciliar-orcamento-impostos"
        /></label>
        <label
          >{{ t(`${D}.diagnostico`) }}
          <input v-model="diagnostico" maxlength="500" data-testid="domiciliar-orcamento-diagnostico"
        /></label>
        <fieldset v-for="(i, n) in itens" :key="n" :data-testid="`domiciliar-item-${n}`">
          <legend>{{ t(`${D}.itens`) }} {{ n + 1 }}</legend>
          <SanteSelecao
            v-model="i.tipoItem"
            :rotulo="t(`${D}.tipoItem`)"
            :opcoes="enumOpcoes(TIPOS_ITEM_ORCAMENTO_DOMICILIAR, 'tiposItem')"
            :data-testid="`domiciliar-item-${n}-tipo`"
          />
          <SanteSelecao
            v-model="i.tipoCusto"
            :rotulo="t(`${D}.tipoCusto`)"
            :opcoes="comVazio(t(`${D}.escolha`), op?.tiposCusto ?? [])"
            :data-testid="`domiciliar-item-${n}-custo`"
          />
          <label
            >{{ t(`${D}.descricao`) }}
            <input v-model="i.descricao" maxlength="150" :data-testid="`domiciliar-item-${n}-descricao`"
          /></label>
          <label
            >{{ t(`${D}.quantidade`) }}
            <input
              v-model.number="i.quantidade"
              type="number"
              min="0"
              step="0.01"
              :data-testid="`domiciliar-item-${n}-quantidade`"
          /></label>
          <label
            >{{ t(`${D}.dias`) }}
            <input v-model.number="i.dias" type="number" min="1" :data-testid="`domiciliar-item-${n}-dias`"
          /></label>
          <label
            >{{ t(`${D}.valorUnitario`) }}
            <input
              v-model.number="i.valorUnitario"
              type="number"
              min="0"
              step="0.01"
              :data-testid="`domiciliar-item-${n}-valor`"
          /></label>
          <button v-if="itens.length > 1" type="button" @click="itens.splice(n, 1)">
            {{ t(`${D}.tirarItem`) }}
          </button>
        </fieldset>
        <button type="button" data-testid="domiciliar-mais-item" @click="itens.push(itemVazio())">
          {{ t(`${D}.maisItem`) }}
        </button>
        <p role="status" data-testid="domiciliar-orcamento-total">
          {{
            t(`${D}.total`, {
              total: reais(totais.valorTotal),
              subtotal: reais(totais.subtotal),
              impostos: reais(totais.valorImpostos),
            })
          }}
        </p>
        <ul v-if="problemasOrc.length" class="problemas" data-testid="domiciliar-orcamento-problemas">
          <li v-for="p in problemasOrc" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasOrc.length > 0 || acao.isPending.value"
          data-testid="domiciliar-orcamento-salvar"
        >
          {{ t(`${D}.salvarOrcamento`) }}
        </button>
      </form>
    </template>

    <table v-if="dados?.orcamentos.length" data-testid="domiciliar-orcamentos">
      <thead>
        <tr>
          <th>{{ t(`${D}.numero`) }}</th>
          <th>{{ t(`${D}.paciente`) }}</th>
          <th>{{ t(`${D}.situacao`) }}</th>
          <th>{{ t(`${D}.fonte`) }}</th>
          <th>{{ t(`${D}.validade`) }}</th>
          <th>{{ t(`${D}.acoes`) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in dados.orcamentos" :key="o.id" :data-testid="`domiciliar-orcamento-${o.numero}`">
          <td>{{ o.numero }}</td>
          <td>
            <RouterLink :to="{ name: 'adt.domiciliar.paciente', params: { pac: o.paciente } }">{{
              o.pacienteNome
            }}</RouterLink>
          </td>
          <td>{{ t(`${D}.situacoes.${o.situacao}`) }} · {{ reais(o.valorTotal) }}</td>
          <td>{{ o.fonteNome ?? t(`${D}.tiposOrcamento.particular`) }}</td>
          <td>{{ o.validade }}</td>
          <td>
            <template v-if="podeGravar">
              <button
                v-for="a in ['enviar', 'aprovar', 'recusar', 'cancelar'] as const"
                :key="a"
                type="button"
                :disabled="!podeOrc(o, a) || acao.isPending.value"
                :data-testid="`domiciliar-orcamento-${a}`"
                @click="agirOrc(o, a)"
              >
                {{ t(`${D}.acoesOrcamento.${a}`) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="pacienteId && visao.data.value && podeGravar">
      <h2>{{ t(`${D}.transferir`) }}</h2>
      <form class="filtros" data-testid="domiciliar-transferir-form" @submit.prevent="transferir">
        <SanteSelecao
          v-model="endereco"
          :rotulo="t(`${D}.endereco`)"
          :opcoes="comVazio(t(`${D}.escolha`), visao.data.value.enderecos)"
          obrigatorio
          data-testid="domiciliar-endereco"
        />
        <SanteSelecao
          v-model="origem"
          :rotulo="t(`${D}.origem`)"
          :opcoes="comVazio(t(`${D}.nenhum`), visao.data.value.hospitalares)"
          data-testid="domiciliar-origem"
        />
        <SanteSelecao
          v-model="orcamento"
          :rotulo="t(`${D}.orcamento`)"
          :opcoes="
            comVazio(
              t(`${D}.nenhum`),
              aprovados.map((o) => ({ id: o.id, nome: `${o.numero} · ${reais(o.valorTotal)}` })),
            )
          "
          data-testid="domiciliar-orcamento"
        />
        <SanteSelecao
          v-model="motivoTr"
          :rotulo="t(`${D}.motivoTransferencia`)"
          :opcoes="comVazio(t(`${D}.nenhum`), op?.motivosTransferencia ?? [])"
          data-testid="domiciliar-motivo-transferencia"
        />
        <SanteSelecao
          v-model="medico"
          :rotulo="t(`${D}.medico`)"
          :opcoes="opProfs"
          data-testid="domiciliar-medico"
        />
        <label
          >{{ t(`${D}.prevista`) }} <input v-model="prevista" type="date" data-testid="domiciliar-prevista"
        /></label>
        <label
          >{{ t(`${D}.liminarNumero`) }}
          <input v-model="liminarNumero" maxlength="50" data-testid="domiciliar-liminar-numero"
        /></label>
        <label
          >{{ t(`${D}.liminarData`) }}
          <input v-model="liminarData" type="date" data-testid="domiciliar-liminar-data"
        /></label>
        <ul v-if="problemasTr.length" class="problemas" data-testid="domiciliar-transferir-problemas">
          <li v-for="p in problemasTr" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasTr.length > 0 || acao.isPending.value"
          data-testid="domiciliar-transferir"
        >
          {{ t(`${D}.transferir`) }}
        </button>
      </form>
    </template>

    <h2>{{ t(`${D}.internacoes`) }}</h2>
    <p v-if="!dados?.internacoes.length">{{ t(`${D}.vazio`) }}</p>
    <table v-else data-testid="domiciliar-internacoes">
      <thead>
        <tr>
          <th>{{ t(`${D}.numero`) }}</th>
          <th>{{ t(`${D}.paciente`) }}</th>
          <th>{{ t(`${D}.situacao`) }}</th>
          <th>{{ t(`${D}.endereco`) }}</th>
          <th>{{ t(`${D}.medico`) }}</th>
          <th>{{ t(`${D}.acoes`) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in dados.internacoes" :key="d.id" :data-testid="`domiciliar-internacao-${d.numero}`">
          <td>{{ d.numero }}</td>
          <td>
            <RouterLink :to="{ name: 'adt.domiciliar.paciente', params: { pac: d.paciente } }">{{
              d.pacienteNome
            }}</RouterLink>
          </td>
          <td data-testid="domiciliar-internacao-situacao">{{ t(`${D}.situacoes.${d.situacao}`) }}</td>
          <td>{{ d.endereco }}</td>
          <td>{{ d.medicoNome }}</td>
          <td>
            <template v-if="podeGravar">
              <button
                v-for="a in ACOES_INT"
                :key="a"
                type="button"
                :disabled="!podeInt(d, a) || acao.isPending.value"
                :data-testid="`domiciliar-internacao-${a}`"
                @click="agirInt(d, a)"
              >
                {{ t(`${D}.acoesInternacao.${a}`) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="pacienteId && visao.data.value && podeGravar">
      <h2>{{ t(`${D}.novoChamado`) }}</h2>
      <form class="filtros" data-testid="domiciliar-chamado-form" @submit.prevent="abrirCh">
        <SanteSelecao
          v-model="tipoCh"
          :rotulo="t(`${D}.tipoChamado`)"
          :opcoes="opTiposCh"
          obrigatorio
          data-testid="domiciliar-chamado-tipo"
        />
        <SanteSelecao
          v-model="motivoCh"
          :rotulo="t(`${D}.motivoChamado`)"
          :opcoes="opMotivosCh"
          data-testid="domiciliar-chamado-motivo"
        />
        <SanteSelecao
          v-model="prioridadeNova"
          :rotulo="t(`${D}.prioridade`)"
          :opcoes="enumOpcoes(PRIORIDADES_CHAMADO_DOMICILIAR, 'prioridades', t(`${D}.nenhum`))"
          data-testid="domiciliar-chamado-prioridade"
        />
        <label
          >{{ t(`${D}.sintoma`) }}
          <input v-model="sintoma" maxlength="1000" data-testid="domiciliar-chamado-sintoma"
        /></label>
        <label v-if="!abertaDoPaciente"
          >{{ t(`${D}.logradouro`) }}
          <input v-model="logradouro" maxlength="150" data-testid="domiciliar-chamado-logradouro"
        /></label>
        <button
          type="submit"
          :disabled="problemasCh.length > 0 || acao.isPending.value"
          data-testid="domiciliar-chamado-abrir"
        >
          {{ t(`${D}.abrirChamado`) }}
        </button>
      </form>
    </template>

    <h2>{{ pacienteId ? t(`${D}.chamados`) : t(`${D}.filaChamados`) }}</h2>
    <p v-if="!dados?.chamados.length">{{ t(`${D}.vazio`) }}</p>
    <table v-else data-testid="domiciliar-chamados">
      <thead>
        <tr>
          <th>{{ t(`${D}.numero`) }}</th>
          <th>{{ t(`${D}.paciente`) }}</th>
          <th>{{ t(`${D}.tipoChamado`) }}</th>
          <th>{{ t(`${D}.prioridade`) }}</th>
          <th>{{ t(`${D}.situacao`) }}</th>
          <th>{{ t(`${D}.acoes`) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in dados.chamados" :key="c.id" :data-testid="`domiciliar-chamado-${c.numero}`">
          <td>{{ c.numero }} · {{ hora(c.chamadoEm) }}</td>
          <td>
            <RouterLink :to="{ name: 'adt.domiciliar.paciente', params: { pac: c.paciente } }">{{
              c.pacienteNome
            }}</RouterLink>
          </td>
          <td>
            {{ c.tipoNome }}<template v-if="c.endereco"> · {{ c.endereco }}</template>
          </td>
          <td>{{ c.prioridade ? t(`${D}.prioridades.${c.prioridade}`) : '' }}</td>
          <td data-testid="domiciliar-chamado-situacao">
            {{ t(`${D}.situacoes.${c.situacao}`)
            }}<template v-if="c.profissionalNome"> · {{ c.profissionalNome }}</template>
          </td>
          <td>
            <template v-if="podeGravar">
              <button
                v-for="a in ACOES_CH"
                :key="a"
                type="button"
                :disabled="!podeCh(c, a) || acao.isPending.value"
                :data-testid="`domiciliar-chamado-${a}`"
                @click="agirCh(c, a)"
              >
                {{ t(`${D}.acoesChamado.${a}`) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="pacienteId && ativa && podeGravar">
      <h2>{{ t(`${D}.agendarVisita`) }}</h2>
      <form class="filtros" data-testid="domiciliar-visita-form" @submit.prevent="agendar">
        <SanteSelecao
          v-model="profVis"
          :rotulo="t(`${D}.profissional`)"
          :opcoes="opProfs"
          obrigatorio
          data-testid="domiciliar-visita-profissional"
        />
        <SanteSelecao
          v-model="tipoVis"
          :rotulo="t(`${D}.tipoVisita`)"
          :opcoes="opTiposCh"
          obrigatorio
          data-testid="domiciliar-visita-tipo"
        />
        <label
          >{{ t(`${D}.quando`) }}
          <input v-model="quandoVis" type="datetime-local" required data-testid="domiciliar-visita-quando"
        /></label>
        <label
          >{{ t(`${D}.duracao`) }}
          <input
            v-model.number="duracao"
            type="number"
            min="1"
            max="720"
            data-testid="domiciliar-visita-duracao"
        /></label>
        <button
          type="submit"
          :disabled="profVis === '' || tipoVis === '' || !quandoVis || acao.isPending.value"
          data-testid="domiciliar-visita-agendar"
        >
          {{ t(`${D}.agendarVisita`) }}
        </button>
      </form>
    </template>

    <h2>{{ pacienteId ? t(`${D}.visitas`) : t(`${D}.visitasSemana`) }}</h2>
    <p v-if="!dados?.visitas.length">{{ t(`${D}.vazio`) }}</p>
    <table v-else data-testid="domiciliar-visitas">
      <thead>
        <tr>
          <th>{{ t(`${D}.quando`) }}</th>
          <th>{{ t(`${D}.paciente`) }}</th>
          <th>{{ t(`${D}.profissional`) }}</th>
          <th>{{ t(`${D}.situacao`) }}</th>
          <th>{{ t(`${D}.acoes`) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in dados.visitas" :key="v.id" :data-testid="`domiciliar-visita-${v.id}`">
          <td>
            {{ hora(v.agendadaPara) }}<template v-if="v.extra"> ({{ t(`${D}.extra`) }})</template>
          </td>
          <td>
            <RouterLink :to="{ name: 'adt.domiciliar.paciente', params: { pac: v.paciente } }">{{
              v.pacienteNome
            }}</RouterLink>
          </td>
          <td>{{ v.profissionalNome }} · {{ v.tipoNome }}</td>
          <td data-testid="domiciliar-visita-situacao">{{ t(`${D}.situacoes.${v.situacao}`) }}</td>
          <td>
            <template v-if="podeGravar">
              <button
                v-for="a in ACOES_VIS"
                :key="a"
                type="button"
                :disabled="!podeVis(v, a) || acao.isPending.value"
                :data-testid="`domiciliar-visita-${a}`"
                @click="agirVis(v, a)"
              >
                {{ t(`${D}.acoesVisita.${a}`) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
