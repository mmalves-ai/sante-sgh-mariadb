<script setup lang="ts">
// Regulação de entrada (C1-080, 02-REC linha 38): a aba "Recebidos da central" da regulação do NIR. Registrar o pedido
// que a central mandou (número da central à mão, paciente pela busca do cadastro), a fila com a emergência primeiro e o
// aceite ou a recusa com motivo padronizado, com a validação na hora pela regra do domínio. No aceite de consulta,
// exame ou cirurgia, o paciente entra na lista de espera da especialidade; a resposta volta à central pela integração
// (central por webservice) ou a tela diz por onde avisá-la.
import type { ResultadoBuscaPaciente } from '@sgh/contratos';
import {
  CODIGOS_MOTIVO_RECUSA_REGULACAO,
  conferirRecebimentoRegulacao,
  conferirRespostaRegulacao,
  PRIORIDADES_REGULACAO_ENTRADA,
  SITUACOES_A_RESPONDER,
  TIPOS_COM_LISTA_ESPERA,
  TIPOS_REGULACAO_ENTRADA,
} from '@sgh/dominio-internacao';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  lerOpcoesRegulacaoEntrada,
  listarRegulacoesRecebidas,
  receberRegulacao,
  type RegulacaoRecebida,
  responderRegulacao,
} from '../api-regulacao-entrada.js';
import { horaCurta } from '../regras-nir.js';
import ErroAdt from './ErroAdt.vue';

const props = defineProps<{ podeRegistrar: boolean }>();
const { t } = useI18n();
const k = (c: string) => t(`adt.regulacaoEntrada.${c}`);

const todos = ref(false);
const fila = useQuery({
  queryKey: computed(() => ['nir', 'regulacao', 'recebidos', todos.value]),
  queryFn: () => listarRegulacoesRecebidas(todos.value ? { todos: 'sim' } : {}),
});
const opcoes = useQuery({
  queryKey: ['nir', 'regulacao', 'recebidos', 'opcoes'],
  queryFn: lerOpcoesRegulacaoEntrada,
});
const centrais = computed(() =>
  (opcoes.data.value?.centrais ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.sigla} · ${c.nome}`,
  })),
);
const especialidades = computed(() =>
  (opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: e.id as number | null, rotulo: e.nome })),
);
const tipos = computed(() =>
  TIPOS_REGULACAO_ENTRADA.map((x) => ({ valor: x as string, rotulo: k(`tipos.${x}`) })),
);
const prioridades = computed(() =>
  PRIORIDADES_REGULACAO_ENTRADA.map((x) => ({ valor: x as string, rotulo: k(`prioridades.${x}`) })),
);
const motivos = computed(() =>
  CODIGOS_MOTIVO_RECUSA_REGULACAO.map((x) => ({ valor: x as string | null, rotulo: k(`motivos.${x}`) })),
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

// ── Registro do pedido recebido ──
const abrirNovo = ref(false);
const central = ref<number | null>(null);
const numero = ref('');
const tipo = ref<string>('internacao');
const prioridade = ref<string>('eletivo');
const solicitadoEm = ref('');
const resumo = ref('');
const observacao = ref('');
const termo = ref('');
const pedidoBusca = ref('');
const paciente = ref<{ id: number; nome: string; prontuario: number } | null>(null);
const busca = useQuery({
  queryKey: computed(() => ['nir', 'regulacao', 'pacientes', pedidoBusca.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedidoBusca.value),
  enabled: computed(() => pedidoBusca.value.length >= 2),
});

const problemasNovo = computed(() =>
  conferirRecebimentoRegulacao({
    numero: numero.value,
    tipo: tipo.value,
    prioridade: prioridade.value,
    solicitadoEm: solicitadoEm.value ? new Date(solicitadoEm.value) : new Date(),
    agora: new Date(),
    resumoClinico: resumo.value,
  }),
);
const problemaDe = (campo: string) => problemasNovo.value.find((p) => p.campo === campo)?.mensagem ?? null;
const podeGravarNovo = computed(
  () =>
    !ocupado.value && central.value !== null && paciente.value !== null && problemasNovo.value.length === 0,
);

function limparNovo(): void {
  abrirNovo.value = false;
  central.value = null;
  numero.value = '';
  tipo.value = 'internacao';
  prioridade.value = 'eletivo';
  solicitadoEm.value = '';
  resumo.value = '';
  observacao.value = '';
  termo.value = '';
  pedidoBusca.value = '';
  paciente.value = null;
}

async function registrar(): Promise<void> {
  if (!podeGravarNovo.value || central.value === null || !paciente.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await receberRegulacao({
      central: central.value,
      numero: numero.value.trim().toUpperCase(),
      tipo: tipo.value,
      prioridade: prioridade.value,
      paciente: paciente.value.id,
      solicitadoEm: solicitadoEm.value ? new Date(solicitadoEm.value).toISOString() : null,
      resumoClinico: resumo.value.trim() || null,
      observacao: observacao.value.trim() || null,
    });
    mensagem.value = k('registrado');
    limparNovo();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
    await fila.refetch();
  }
}

// ── Resposta (aceite ou recusa) ──
const respondendo = ref<{ id: number; decisao: 'aceitar' | 'recusar' } | null>(null);
const motivo = ref<string | null>(null);
const complemento = ref('');
const especialidade = ref<number | null>(null);

function abrirResposta(r: RegulacaoRecebida, decisao: 'aceitar' | 'recusar'): void {
  respondendo.value = { id: r.id, decisao };
  motivo.value = null;
  complemento.value = '';
  especialidade.value = null;
  erro.value = null;
  mensagem.value = null;
}
const conferencia = (r: RegulacaoRecebida) =>
  conferirRespostaRegulacao({
    situacao: r.situacao,
    tipo: r.tipo,
    decisao: respondendo.value?.decisao ?? 'aceitar',
    motivo: respondendo.value?.decisao === 'recusar' ? motivo.value : null,
    complemento: complemento.value,
    especialidade: especialidade.value,
  });
const problemasResposta = (r: RegulacaoRecebida) => {
  const c = conferencia(r);
  return c.ok ? [] : c.problemas;
};
const aberto = (r: RegulacaoRecebida) => (SITUACOES_A_RESPONDER as readonly string[]).includes(r.situacao);
const pedeEspecialidade = (r: RegulacaoRecebida) =>
  (TIPOS_COM_LISTA_ESPERA as readonly string[]).includes(r.tipo);

function textoDevolucao(r: RegulacaoRecebida, devolucao: string): string {
  if (devolucao === 'conector') return k('devolucaoConector');
  const c = opcoes.data.value?.centrais.find((x) => x.id === r.central.id);
  const contato = [c?.telefone, c?.email].filter(Boolean).join(' · ');
  return t('adt.regulacaoEntrada.devolucaoManual', {
    central: r.central.sigla,
    contato: contato ? t('adt.regulacaoEntrada.contato', { contato }) : '',
  });
}

async function responder(r: RegulacaoRecebida): Promise<void> {
  if (!respondendo.value || problemasResposta(r).length) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const recusar = respondendo.value.decisao === 'recusar';
    const x = await responderRegulacao(r.id, {
      decisao: respondendo.value.decisao,
      motivo: recusar ? motivo.value : null,
      complemento: complemento.value.trim() || null,
      especialidade: !recusar && pedeEspecialidade(r) ? especialidade.value : null,
      versao: r.versao,
    });
    mensagem.value = `${k('respondido')} ${textoDevolucao(r, x.devolucao)}`;
    respondendo.value = null;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
    await fila.refetch();
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="recebidos-titulo" data-testid="regulacao-recebidos">
    <h2 id="recebidos-titulo">{{ k('titulo') }}</h2>
    <p>{{ k('texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="recebidos-mensagem">{{ mensagem }}</p>
    <div v-if="erro" role="alert" data-testid="recebidos-erro"><ErroAdt :erro="erro" /></div>

    <p v-if="props.podeRegistrar && !abrirNovo" class="acoes">
      <SanteBotao :rotulo="k('novo')" data-testid="recebidos-novo" @acionar="abrirNovo = true" />
    </p>
    <form v-if="abrirNovo" class="painel" data-testid="form-recebido" @submit.prevent="registrar">
      <h3>{{ k('novo') }}</h3>
      <SanteSelecao v-model="central" data-testid="rec-central" :rotulo="k('central')" :opcoes="centrais" />
      <SanteCampoTexto
        v-model="numero"
        data-testid="rec-numero"
        :rotulo="k('numero')"
        :max-bytes="30"
        obrigatorio
      />
      <p v-if="numero && problemaDe('numero')" class="erro-campo">{{ problemaDe('numero') }}</p>
      <SanteSelecao v-model="tipo" data-testid="rec-tipo" :rotulo="k('tipo')" :opcoes="tipos" />
      <SanteSelecao
        v-model="prioridade"
        data-testid="rec-prioridade"
        :rotulo="k('prioridade')"
        :opcoes="prioridades"
      />
      <fieldset>
        <legend>{{ k('paciente') }}</legend>
        <p v-if="paciente" data-testid="rec-paciente-escolhido">
          {{
            t('adt.regulacaoEntrada.pacienteEscolhido', {
              nome: paciente.nome,
              prontuario: paciente.prontuario,
            })
          }}
          <SanteBotao variante="secundario" :rotulo="k('trocarPaciente')" @acionar="paciente = null" />
        </p>
        <template v-else>
          <SanteCampoTexto
            v-model="termo"
            data-testid="rec-busca"
            :rotulo="k('buscarPaciente')"
            :max-bytes="100"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('buscar')"
            data-testid="rec-buscar"
            @acionar="pedidoBusca = termo.trim()"
          />
          <p v-if="busca.data.value && busca.data.value.itens.length === 0">{{ k('nenhumPaciente') }}</p>
          <ul v-else-if="busca.data.value" class="lista">
            <li v-for="p in busca.data.value.itens" :key="p.id">
              {{ p.nomeSocial ?? p.nome }} · {{ p.prontuario }}
              <SanteBotao
                variante="secundario"
                :rotulo="k('escolher')"
                :data-testid="`rec-paciente-${p.id}`"
                @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome, prontuario: p.prontuario }"
              />
            </li>
          </ul>
        </template>
      </fieldset>
      <label>
        {{ k('solicitadoEm') }}
        <input v-model="solicitadoEm" type="datetime-local" data-testid="rec-solicitado-em" />
      </label>
      <p v-if="problemaDe('solicitadoEm')" class="erro-campo">{{ problemaDe('solicitadoEm') }}</p>
      <SanteCampoTexto
        v-model="resumo"
        data-testid="rec-resumo"
        :rotulo="k('resumoClinico')"
        :max-bytes="4000"
        multilinha
      />
      <p v-if="problemaDe('resumoClinico')" class="erro-campo" data-testid="rec-erro-resumo">
        {{ problemaDe('resumoClinico') }}
      </p>
      <SanteCampoTexto v-model="observacao" :rotulo="k('observacao')" :max-bytes="300" />
      <p class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="k('registrar')"
          :desabilitado="!podeGravarNovo"
          data-testid="rec-registrar"
        />
        <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="limparNovo" />
      </p>
    </form>

    <p>
      <label>
        <input v-model="todos" type="checkbox" data-testid="recebidos-todos" />
        {{ k('mostrarRespondidos') }}
      </label>
    </p>
    <ErroAdt v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ k('carregando') }}</p>
    <p v-else-if="fila.data.value.itens.length === 0" data-testid="recebidos-vazio">{{ k('vazio') }}</p>
    <article
      v-for="r in fila.data.value?.itens ?? []"
      :key="r.id"
      class="cartao"
      :data-testid="`recebido-${r.numero}`"
      :aria-labelledby="`recebido-titulo-${r.id}`"
    >
      <h3 :id="`recebido-titulo-${r.id}`">
        <span v-if="r.prioridade" :class="`prioridade-${r.prioridade}`">{{
          k(`prioridades.${r.prioridade}`)
        }}</span>
        · {{ r.paciente.nome }} · {{ r.paciente.prontuario }}
      </h3>
      <p class="secundario">
        {{
          t('adt.regulacaoEntrada.cartao', {
            central: r.central.sigla,
            numero: r.numero,
            tipo: k(`tipos.${r.tipo}`),
          })
        }}
        · {{ t('adt.regulacaoEntrada.espera', { em: horaCurta(r.solicitadoEm) }) }}
      </p>
      <p data-testid="recebido-situacao">
        <strong>{{ k(`situacoes.${r.situacao}`) }}</strong>
      </p>
      <p v-if="r.resumoClinico">{{ r.resumoClinico }}</p>
      <p v-if="r.mensagemCentral" data-testid="recebido-resposta">
        {{ t('adt.regulacaoEntrada.mensagemCentral', { texto: r.mensagemCentral }) }}
      </p>
      <p v-if="r.listaEspera" data-testid="recebido-lista">
        {{ t('adt.regulacaoEntrada.listaEspera', { id: r.listaEspera }) }}
      </p>
      <details>
        <summary>{{ k('historico') }}</summary>
        <ul class="lista">
          <li v-for="e in r.eventos" :key="e.id">
            {{
              t('adt.regulacaoEntrada.linhaEvento', {
                em: horaCurta(e.em),
                evento: k(`eventos.${e.tipo}`),
                por: e.por ?? '',
              })
            }}
            <span v-if="e.observacao"> · {{ e.observacao }}</span>
          </li>
        </ul>
      </details>
      <p v-if="props.podeRegistrar && aberto(r) && respondendo?.id !== r.id" class="acoes">
        <SanteBotao
          :rotulo="k('aceitar')"
          :data-testid="`aceitar-${r.numero}`"
          @acionar="abrirResposta(r, 'aceitar')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="k('recusar')"
          :data-testid="`recusar-${r.numero}`"
          @acionar="abrirResposta(r, 'recusar')"
        />
      </p>
      <form
        v-if="respondendo?.id === r.id"
        class="painel"
        :data-testid="`form-resposta-${r.numero}`"
        @submit.prevent="responder(r)"
      >
        <SanteSelecao
          v-if="respondendo.decisao === 'aceitar' && pedeEspecialidade(r)"
          v-model="especialidade"
          data-testid="resp-especialidade"
          :rotulo="k('especialidade')"
          :opcoes="especialidades"
        />
        <SanteSelecao
          v-if="respondendo.decisao === 'recusar'"
          v-model="motivo"
          data-testid="resp-motivo"
          :rotulo="k('motivo')"
          :opcoes="motivos"
        />
        <SanteCampoTexto
          v-model="complemento"
          data-testid="resp-complemento"
          :rotulo="k('complemento')"
          :max-bytes="600"
          multilinha
        />
        <ul v-if="problemasResposta(r).length" class="erro-campo" data-testid="resp-problemas">
          <li v-for="p in problemasResposta(r)" :key="p.campo">{{ p.mensagem }}</li>
        </ul>
        <p class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="respondendo.decisao === 'aceitar' ? k('confirmarAceite') : k('confirmarRecusa')"
            :desabilitado="ocupado || problemasResposta(r).length > 0"
            data-testid="resp-confirmar"
          />
          <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="respondendo = null" />
        </p>
      </form>
    </article>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.erro-campo,
.prioridade-emergencia,
.prioridade-urgente {
  color: var(--sgh-alerta);
}
</style>
