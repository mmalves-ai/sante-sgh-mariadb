<script setup lang="ts">
// Chamado de ambulância com cobrança e maqueiro do transporte interno (C2-068, 04-INT linha 83). Duas entradas:
//   - `/internacao/:reg/ambulancia`: a visão do paciente. O chamado nasce do atendimento da internação, com a categoria
//     e o destino (estabelecimento cadastrado, trajeto padrão ou endereço), e pode ficar ligado ao pedido de transporte
//     em aberto. Valida na hora pela mesma regra do domínio que a API aplica. Abaixo, os chamados do paciente;
//   - `/internacao/ambulancias`: a fila (em trânsito, aprovados e solicitados, pela previsão) e os transportes internos
//     à espera do maqueiro.
// O ciclo é aprovar (ambulância da categoria e equipe mínima), sair (hodômetro), concluir (hodômetro final: a remoção
// entra na conta pelos quilômetros rodados ou pelo trajeto, pela regra de cobrança) ou reprovar/cancelar com motivo.
// Os botões só se habilitam quando a regra do domínio aceita a ação. Nada se apaga.
import {
  conferirAcaoChamado,
  conferirChamadoAmbulancia,
  conferirMaqueiro,
  type AcaoChamadoAmbulancia,
  FUNCOES_EQUIPE_AMBULANCIA,
  POSICOES_CHAMADO_AMBULANCIA,
  SITUACOES_ABERTAS_CHAMADO,
  TIPOS_CHAMADO_AMBULANCIA,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  aprovarChamado,
  cancelarChamado,
  type Chamado,
  cobrarChamado,
  concluirChamado,
  designarMaqueiro,
  lerOpcoesAmbulancia,
  listarChamados,
  listarInternos,
  reprovarChamado,
  sairChamado,
  solicitarAmbulancia,
  type TransporteInterno,
} from '../api-ambulancia.js';
import { lerInternacaoTransporte, listarTransportes } from '../api-transporte.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const props = defineProps<{ reg?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const internacaoId = computed(() => (props.reg ? Number(props.reg) : null));
const podeGravar = computed(() => pode('leitos.transferencia.criar'));

const opcoes = useQuery({ queryKey: ['adt', 'ambulancia', 'opcoes'], queryFn: lerOpcoesAmbulancia });
const internacao = useQuery({
  queryKey: computed(() => ['adt', 'ambulancia', 'internacao', internacaoId.value]),
  queryFn: () => lerInternacaoTransporte(internacaoId.value!),
  enabled: computed(() => internacaoId.value !== null),
});
const atendimento = computed(() => internacao.data.value?.atendimento ?? null);
const lista = useQuery({
  queryKey: computed(() => ['adt', 'ambulancia', 'lista', internacaoId.value, atendimento.value]),
  queryFn: () => listarChamados(atendimento.value ? { atendimento: atendimento.value } : {}),
  enabled: computed(() => internacaoId.value === null || atendimento.value !== null),
});
const transportes = useQuery({
  queryKey: computed(() => ['adt', 'ambulancia', 'transportes', internacaoId.value]),
  queryFn: () => listarTransportes({ internacao: internacaoId.value }),
  enabled: computed(() => internacaoId.value !== null),
});
const internos = useQuery({
  queryKey: ['adt', 'ambulancia', 'internos'],
  queryFn: listarInternos,
  enabled: computed(() => internacaoId.value === null),
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'ambulancia'] });

type Id = number | '';
const nulo = (v: Id) => (v === '' ? null : v);
const comVazio = (vazio: string, itens: { id: number; nome: string }[]) => [
  { valor: '' as Id, rotulo: vazio },
  ...itens.map((x) => ({ valor: x.id as Id, rotulo: x.nome })),
];
const op = computed(() => opcoes.data.value);
const opTipos = computed(() =>
  TIPOS_CHAMADO_AMBULANCIA.map((x) => ({ valor: x as string, rotulo: t(`adt.ambulancia.tipos.${x}`) })),
);
const opPosicoes = computed(() => [
  { valor: '', rotulo: t('adt.ambulancia.nenhum') },
  ...POSICOES_CHAMADO_AMBULANCIA.map((x) => ({
    valor: x as string,
    rotulo: t(`adt.ambulancia.posicoes.${x}`),
  })),
]);
const opFuncoes = computed(() =>
  FUNCOES_EQUIPE_AMBULANCIA.filter((f) => f !== 'condutor').map((f) => ({
    valor: f as string,
    rotulo: t(`adt.ambulancia.funcoes.${f}`),
  })),
);
const opCategorias = computed(() => comVazio(t('adt.ambulancia.escolha'), op.value?.categorias ?? []));
const opRotas = computed(() => comVazio(t('adt.ambulancia.nenhum'), op.value?.rotas ?? []));
const opDestinos = computed(() => comVazio(t('adt.ambulancia.nenhum'), op.value?.destinos ?? []));
const opMotivosCancel = computed(() =>
  comVazio(t('adt.ambulancia.escolha'), op.value?.motivosCancelamento ?? []),
);
const opTransportes = computed(() =>
  comVazio(
    t('adt.ambulancia.semTransporte'),
    (transportes.data.value?.itens ?? [])
      .filter((x) => ['solicitado', 'agendado'].includes(x.situacao))
      .map((x) => ({ id: x.id, nome: `${x.destinoNome ?? ''} · ${hora(x.solicitado)}` })),
  ),
);
const profissionais = (funcoes: string[] | null) =>
  (op.value?.profissionais ?? []).filter(
    (p) => p.tipo !== 'interno' && (funcoes === null || funcoes.includes(p.funcao)),
  );
const opCondutores = computed(() => comVazio(t('adt.ambulancia.escolha'), profissionais(['motorista'])));
const opEquipe = computed(() =>
  comVazio(
    t('adt.ambulancia.nenhum'),
    profissionais(null).filter((p) => p.funcao !== 'motorista'),
  ),
);
const opMaqueiros = computed(() =>
  comVazio(
    t('adt.ambulancia.escolha'),
    (op.value?.profissionais ?? []).filter((p) => p.funcao === 'maqueiro' && p.tipo !== 'ambulancia'),
  ),
);

// Pedido novo (só na visão do paciente).
const tipo = ref<string>('remocao_inter_hospitalar');
const categoria = ref<Id>('');
const transporte = ref<Id>('');
const rota = ref<Id>('');
const destinoExterno = ref<Id>('');
const logradouro = ref('');
const numero = ref('');
const bairro = ref('');
const cep = ref('');
const posicao = ref<string>('');
const previsto = ref('');
const contato = ref('');
const observacao = ref('');
const quando = (s: string) => (s ? new Date(s) : null);
const abertos = (s: string) => (SITUACOES_ABERTAS_CHAMADO as readonly string[]).includes(s);
const problemas = computed(() =>
  conferirChamadoAmbulancia({
    tipo: tipo.value,
    categoria: nulo(categoria.value),
    destinoExterno: nulo(destinoExterno.value),
    rota: nulo(rota.value),
    destinoLogradouro: logradouro.value.trim() || null,
    destinoCep: cep.value.replace(/\D/g, '') || null,
    previsto: quando(previsto.value),
    agora: new Date(),
    abertoNoAtendimento: (lista.data.value?.itens ?? []).some((x) => abertos(x.situacao)),
  }).map((p) => p.mensagem),
);

const aviso = ref('');
const erro = ref<unknown>(null);
const acao = useMutation({
  mutationFn: (f: () => Promise<unknown>) => f(),
  onSuccess: () => {
    erro.value = null;
    void recarregar();
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
const pedir = () =>
  acao.mutate(async () => {
    const r = await solicitarAmbulancia({
      atendimento: atendimento.value!,
      transporte: nulo(transporte.value),
      tipo: tipo.value,
      categoria: nulo(categoria.value)!,
      rota: nulo(rota.value),
      destinoExterno: nulo(destinoExterno.value),
      destinoLogradouro: logradouro.value.trim() || null,
      destinoNumero: numero.value.trim() || null,
      destinoBairro: bairro.value.trim() || null,
      destinoCep: cep.value.replace(/\D/g, '') || null,
      posicao: posicao.value || null,
      previsto: quando(previsto.value)?.toISOString() ?? null,
      contato: contato.value.trim() || null,
      observacao: observacao.value.trim() || null,
    });
    aviso.value = t('adt.ambulancia.pedido', { numero: r.numero ?? '' });
    observacao.value = '';
    previsto.value = '';
  });

// Ações no chamado: os campos ficam acima da tabela e valem para o chamado em que se clica.
const ambulancia = ref<Id>('');
const condutor = ref<Id>('');
const membro = ref<Id>('');
const funcaoMembro = ref<string>('tecnico_enfermagem');
const membro2 = ref<Id>('');
const funcaoMembro2 = ref<string>('enfermeiro');
const kmInicial = ref<number | null>(null);
const kmFinal = ref<number | null>(null);
const motivoReprovacao = ref('');
const motivoCancelamento = ref<Id>('');
const maqueiro = ref<Id>('');
const equipe = computed(() =>
  [
    condutor.value !== '' ? { profissional: condutor.value, funcao: 'condutor' } : null,
    membro.value !== '' ? { profissional: membro.value, funcao: funcaoMembro.value } : null,
    membro2.value !== '' ? { profissional: membro2.value, funcao: funcaoMembro2.value } : null,
  ].filter((m): m is { profissional: number; funcao: string } => m !== null),
);
const opAmbulancias = computed(() => comVazio(t('adt.ambulancia.escolha'), op.value?.ambulancias ?? []));
function regra(x: Chamado, a: AcaoChamadoAmbulancia) {
  const vId = a === 'aprovar' ? nulo(ambulancia.value) : x.ambulancia;
  const v = vId === null ? undefined : op.value?.ambulancias.find((y) => y.id === vId);
  return conferirAcaoChamado({
    acao: a,
    situacao: x.situacao,
    categoriaPedida: x.categoria,
    classificacao: op.value?.categorias.find((c) => c.id === x.categoria)?.classificacao ?? null,
    veiculo: v ? { categoria: v.categoria, ativo: true, quilometragemAtual: v.quilometragem } : null,
    equipe: equipe.value,
    motivoReprovacao: motivoReprovacao.value.trim() || null,
    motivoCancelamento: nulo(motivoCancelamento.value),
    kmInicial: a === 'sair' ? kmInicial.value : x.kmInicial,
    kmFinal: kmFinal.value,
    saida: x.saida ? new Date(x.saida) : null,
    agora: new Date(),
  });
}
const podeAgir = (x: Chamado, a: AcaoChamadoAmbulancia) =>
  podeGravar.value && !acao.isPending.value && regra(x, a).situacao !== null;
const motivosDe = (x: Chamado, a: AcaoChamadoAmbulancia) =>
  regra(x, a)
    .problemas.map((p) => p.mensagem)
    .join(' ');
const feito = () => {
  aviso.value = t('adt.ambulancia.feito');
};
const aprovar = (x: Chamado) =>
  acao.mutate(async () => {
    await aprovarChamado(x.id, {
      ambulancia: nulo(ambulancia.value),
      equipe: equipe.value,
      versao: x.versao,
    });
    feito();
  });
const reprovar = (x: Chamado) =>
  acao.mutate(async () => {
    await reprovarChamado(x.id, { motivo: motivoReprovacao.value.trim(), versao: x.versao });
    feito();
  });
const sair = (x: Chamado) =>
  acao.mutate(async () => {
    await sairChamado(x.id, { kmInicial: kmInicial.value, versao: x.versao });
    feito();
  });
const cobrancaTexto = (r: {
  cobranca?: { situacao: string; motivo?: string | undefined; quantidade?: number | undefined } | undefined;
}) =>
  r.cobranca?.situacao === 'lancada'
    ? t('adt.ambulancia.concluidoLancado', { quantidade: r.cobranca.quantidade ?? '' })
    : r.cobranca
      ? t('adt.ambulancia.concluidoPendente', { motivo: r.cobranca.motivo ?? '' })
      : t('adt.ambulancia.feito');
const concluir = (x: Chamado) =>
  acao.mutate(async () => {
    const r = await concluirChamado(x.id, { kmFinal: kmFinal.value, versao: x.versao });
    aviso.value = cobrancaTexto(r);
  });
const cobrar = (x: Chamado) =>
  acao.mutate(async () => {
    const r = await cobrarChamado(x.id, { versao: x.versao });
    aviso.value = cobrancaTexto(r);
  });
const cancelar = (x: Chamado) =>
  acao.mutate(async () => {
    await cancelarChamado(x.id, { motivo: nulo(motivoCancelamento.value), versao: x.versao });
    feito();
  });

const habilitacao = (id: Id) => {
  const p = id === '' ? null : op.value?.profissionais.find((y) => y.id === id && y.funcao === 'maqueiro');
  return p ? { funcao: p.funcao, tipo: p.tipo, ativo: true } : null;
};
const podeDesignar = (x: TransporteInterno) =>
  podeGravar.value &&
  !acao.isPending.value &&
  conferirMaqueiro({
    tipoPedido: x.tipo,
    situacaoPedido: x.situacao,
    habilitacao: habilitacao(maqueiro.value),
    emAndamento: 0,
  }).length === 0;
const designar = (x: TransporteInterno) =>
  acao.mutate(async () => {
    await designarMaqueiro(x.id, { maqueiro: nulo(maqueiro.value)!, versao: x.versao });
    feito();
  });

const hora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '');
const temAberto = computed(() => (lista.data.value?.itens ?? []).some((x) => abertos(x.situacao)));
const destinoDe = (x: Chamado) => [x.rotaNome, x.destino].filter(Boolean).join(' · ');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ambulancia-titulo" data-testid="tela-ambulancia">
    <h1 id="ambulancia-titulo">
      {{ internacaoId ? t('adt.ambulancia.tituloInternacao') : t('adt.ambulancia.tituloFila') }}
    </h1>
    <p>{{ internacaoId ? t('adt.ambulancia.textoInternacao') : t('adt.ambulancia.textoFila') }}</p>
    <p v-if="internacaoId" class="acoes">
      <RouterLink :to="{ name: 'adt.ambulancias' }" data-testid="ambulancia-ir-fila">{{
        t('adt.ambulancia.irFila')
      }}</RouterLink>
    </p>
    <ErroAdt v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <ErroAdt v-if="internacao.isError.value" :erro="internacao.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="ambulancia-aviso">{{ aviso }}</p>
    <p v-if="!podeGravar" role="note" data-testid="ambulancia-somente-leitura">
      {{ t('adt.ambulancia.somenteLeitura') }}
    </p>

    <template v-if="internacaoId">
      <p v-if="internacao.data.value" data-testid="ambulancia-internacao">
        {{
          t('adt.ambulancia.internacao', {
            numero: internacao.data.value.numero,
            prontuario: internacao.data.value.prontuario ?? '',
          })
        }}
      </p>
      <h2 v-if="podeGravar">{{ t('adt.ambulancia.novo') }}</h2>
      <form v-if="podeGravar" class="filtros" data-testid="ambulancia-form" @submit.prevent="pedir">
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('adt.ambulancia.tipo')"
          :opcoes="opTipos"
          obrigatorio
          data-testid="ambulancia-tipo"
        />
        <SanteSelecao
          v-model="categoria"
          :rotulo="t('adt.ambulancia.categoria')"
          :opcoes="opCategorias"
          obrigatorio
          data-testid="ambulancia-categoria"
        />
        <SanteSelecao
          v-model="transporte"
          :rotulo="t('adt.ambulancia.transporte')"
          :opcoes="opTransportes"
          data-testid="ambulancia-transporte"
        />
        <SanteSelecao
          v-model="destinoExterno"
          :rotulo="t('adt.ambulancia.destinoExterno')"
          :opcoes="opDestinos"
          data-testid="ambulancia-destino-externo"
        />
        <SanteSelecao
          v-model="rota"
          :rotulo="t('adt.ambulancia.rota')"
          :opcoes="opRotas"
          data-testid="ambulancia-rota"
        />
        <label
          >{{ t('adt.ambulancia.logradouro') }}
          <input v-model="logradouro" maxlength="150" data-testid="ambulancia-logradouro"
        /></label>
        <label
          >{{ t('adt.ambulancia.numero') }}
          <input v-model="numero" maxlength="10" data-testid="ambulancia-numero"
        /></label>
        <label
          >{{ t('adt.ambulancia.bairro') }}
          <input v-model="bairro" maxlength="100" data-testid="ambulancia-bairro"
        /></label>
        <label
          >{{ t('adt.ambulancia.cep') }}
          <input v-model="cep" maxlength="9" inputmode="numeric" data-testid="ambulancia-cep"
        /></label>
        <SanteSelecao
          v-model="posicao"
          :rotulo="t('adt.ambulancia.posicao')"
          :opcoes="opPosicoes"
          data-testid="ambulancia-posicao"
        />
        <label
          >{{ t('adt.ambulancia.previsto') }}
          <input v-model="previsto" type="datetime-local" data-testid="ambulancia-previsto"
        /></label>
        <label
          >{{ t('adt.ambulancia.contato') }}
          <input v-model="contato" maxlength="20" type="tel" data-testid="ambulancia-contato"
        /></label>
        <label
          >{{ t('adt.ambulancia.observacao') }}
          <input v-model="observacao" maxlength="2000" data-testid="ambulancia-observacao"
        /></label>
        <ul v-if="problemas.length" class="problemas" data-testid="ambulancia-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemas.length > 0 || acao.isPending.value || atendimento === null"
          data-testid="ambulancia-pedir"
        >
          {{ t('adt.ambulancia.pedir') }}
        </button>
      </form>
    </template>

    <h2>{{ t('adt.ambulancia.chamados') }}</h2>
    <ErroAdt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('adt.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="ambulancia-vazio">
      {{ t('adt.ambulancia.vazio') }}
    </p>
    <template v-else>
      <form v-if="temAberto && podeGravar" class="filtros" data-testid="ambulancia-acoes" @submit.prevent>
        <SanteSelecao
          v-model="ambulancia"
          :rotulo="t('adt.ambulancia.ambulancia')"
          :opcoes="opAmbulancias"
          data-testid="ambulancia-veiculo"
        />
        <SanteSelecao
          v-model="condutor"
          :rotulo="t('adt.ambulancia.condutor')"
          :opcoes="opCondutores"
          data-testid="ambulancia-condutor"
        />
        <SanteSelecao
          v-model="membro"
          :rotulo="t('adt.ambulancia.membro')"
          :opcoes="opEquipe"
          data-testid="ambulancia-membro"
        />
        <SanteSelecao
          v-model="funcaoMembro"
          :rotulo="t('adt.ambulancia.funcaoMembro')"
          :opcoes="opFuncoes"
          data-testid="ambulancia-funcao-membro"
        />
        <SanteSelecao
          v-model="membro2"
          :rotulo="t('adt.ambulancia.membro2')"
          :opcoes="opEquipe"
          data-testid="ambulancia-membro2"
        />
        <SanteSelecao
          v-model="funcaoMembro2"
          :rotulo="t('adt.ambulancia.funcaoMembro2')"
          :opcoes="opFuncoes"
          data-testid="ambulancia-funcao-membro2"
        />
        <label
          >{{ t('adt.ambulancia.kmInicial') }}
          <input
            v-model.number="kmInicial"
            type="number"
            min="0"
            step="1"
            data-testid="ambulancia-km-inicial"
        /></label>
        <label
          >{{ t('adt.ambulancia.kmFinal') }}
          <input v-model.number="kmFinal" type="number" min="0" step="1" data-testid="ambulancia-km-final"
        /></label>
        <label
          >{{ t('adt.ambulancia.motivoReprovacao') }}
          <input v-model="motivoReprovacao" maxlength="1000" data-testid="ambulancia-motivo-reprovacao"
        /></label>
        <SanteSelecao
          v-model="motivoCancelamento"
          :rotulo="t('adt.ambulancia.motivoCancelamento')"
          :opcoes="opMotivosCancel"
          data-testid="ambulancia-motivo-cancelamento"
        />
      </form>
      <table class="tabela" data-testid="tabela-ambulancias">
        <thead>
          <tr>
            <th scope="col">{{ t('adt.ambulancia.colNumero') }}</th>
            <th scope="col">{{ t('adt.ambulancia.paciente') }}</th>
            <th scope="col">{{ t('adt.ambulancia.tipo') }}</th>
            <th scope="col">{{ t('adt.ambulancia.destino') }}</th>
            <th scope="col">{{ t('adt.ambulancia.veiculo') }}</th>
            <th scope="col">{{ t('adt.ambulancia.equipe') }}</th>
            <th scope="col">{{ t('adt.ambulancia.km') }}</th>
            <th scope="col">{{ t('adt.ambulancia.cobranca') }}</th>
            <th scope="col">{{ t('adt.ambulancia.situacao') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`ambulancia-${x.id}`">
            <td>{{ x.numero }}<br />{{ hora(x.previsto ?? x.solicitado) }}</td>
            <td>{{ x.pacienteNome ?? '' }}</td>
            <td>{{ t(`adt.ambulancia.tipos.${x.tipo}`) }}<br />{{ x.categoriaNome ?? '' }}</td>
            <td>{{ destinoDe(x) }}</td>
            <td>{{ x.ambulanciaPlaca ?? '' }}</td>
            <td>
              <template v-for="m in x.equipe" :key="m.profissional"
                >{{ m.nome ?? '' }} ({{ t(`adt.ambulancia.funcoes.${m.funcao}`) }})<br
              /></template>
            </td>
            <td>
              <template v-if="x.kmRodados !== null">{{
                t('adt.ambulancia.kmRodados', { km: x.kmRodados })
              }}</template>
            </td>
            <td>
              <template v-if="x.itemConta">{{ t('adt.ambulancia.naConta') }}</template>
              <template v-else-if="x.situacao === 'concluido'">{{ t('adt.ambulancia.pendente') }}</template>
            </td>
            <td>
              {{ t(`adt.ambulancia.situacoes.${x.situacao}`) }}
              <template v-if="x.motivoReprovacao"><br />{{ x.motivoReprovacao }}</template>
            </td>
            <td>
              <template v-if="podeGravar && abertos(x.situacao)">
                <template v-if="x.situacao === 'solicitado'">
                  <button
                    type="button"
                    :disabled="!podeAgir(x, 'aprovar')"
                    :title="motivosDe(x, 'aprovar')"
                    :data-testid="`ambulancia-aprovar-${x.id}`"
                    @click="aprovar(x)"
                  >
                    {{ t('adt.ambulancia.aprovar') }}
                  </button>
                  <button
                    type="button"
                    :disabled="!podeAgir(x, 'reprovar')"
                    :data-testid="`ambulancia-reprovar-${x.id}`"
                    @click="reprovar(x)"
                  >
                    {{ t('adt.ambulancia.reprovar') }}
                  </button>
                </template>
                <button
                  v-if="x.situacao === 'aprovado'"
                  type="button"
                  :disabled="!podeAgir(x, 'sair')"
                  :title="motivosDe(x, 'sair')"
                  :data-testid="`ambulancia-sair-${x.id}`"
                  @click="sair(x)"
                >
                  {{ t('adt.ambulancia.sair') }}
                </button>
                <button
                  v-if="x.situacao === 'em_transito'"
                  type="button"
                  :disabled="!podeAgir(x, 'concluir')"
                  :title="motivosDe(x, 'concluir')"
                  :data-testid="`ambulancia-concluir-${x.id}`"
                  @click="concluir(x)"
                >
                  {{ t('adt.ambulancia.concluir') }}
                </button>
                <button
                  v-if="x.situacao !== 'em_transito'"
                  type="button"
                  :disabled="!podeAgir(x, 'cancelar')"
                  :data-testid="`ambulancia-cancelar-${x.id}`"
                  @click="cancelar(x)"
                >
                  {{ t('adt.ambulancia.cancelar') }}
                </button>
              </template>
              <button
                v-if="podeGravar && x.situacao === 'concluido' && !x.itemConta"
                type="button"
                :disabled="acao.isPending.value"
                :data-testid="`ambulancia-cobrar-${x.id}`"
                @click="cobrar(x)"
              >
                {{ t('adt.ambulancia.cobrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="!internacaoId">
      <h2>{{ t('adt.ambulancia.maqueiros') }}</h2>
      <ErroAdt v-if="internos.isError.value" :erro="internos.error.value" />
      <p v-else-if="!internos.data.value" role="status">{{ t('adt.carregando') }}</p>
      <p v-else-if="internos.data.value.itens.length === 0" data-testid="maqueiros-vazio">
        {{ t('adt.ambulancia.maqueirosVazio') }}
      </p>
      <template v-else>
        <form v-if="podeGravar" class="filtros" data-testid="maqueiro-form" @submit.prevent>
          <SanteSelecao
            v-model="maqueiro"
            :rotulo="t('adt.ambulancia.maqueiro')"
            :opcoes="opMaqueiros"
            data-testid="maqueiro-escolha"
          />
        </form>
        <table class="tabela" data-testid="tabela-maqueiros">
          <thead>
            <tr>
              <th scope="col">{{ t('adt.ambulancia.paciente') }}</th>
              <th scope="col">{{ t('adt.ambulancia.prioridade') }}</th>
              <th scope="col">{{ t('adt.ambulancia.origem') }}</th>
              <th scope="col">{{ t('adt.ambulancia.destino') }}</th>
              <th scope="col">{{ t('adt.ambulancia.previsto') }}</th>
              <th scope="col">{{ t('adt.ambulancia.maqueiro') }}</th>
              <th scope="col">{{ t('adt.acoesColuna') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in internos.data.value.itens" :key="x.id" :data-testid="`maqueiro-${x.id}`">
              <td>{{ x.pacienteNome ?? '' }}</td>
              <td>{{ t(`adt.transporte.prioridades.${x.prioridade}`) }}</td>
              <td>{{ x.origem ?? '' }}</td>
              <td>{{ x.destino ?? '' }}</td>
              <td>{{ hora(x.previsto ?? x.solicitado) }}</td>
              <td>{{ x.maqueiroNome ?? t('adt.ambulancia.semMaqueiro') }}</td>
              <td>
                <button
                  v-if="podeGravar"
                  type="button"
                  :disabled="!podeDesignar(x)"
                  :data-testid="`maqueiro-designar-${x.id}`"
                  @click="designar(x)"
                >
                  {{ t('adt.ambulancia.designar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
