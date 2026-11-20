<script setup lang="ts">
// Mapa de leitos operacional (ficha do M21, seção 7): `/leitos/mapa`. Os mesmos leitos e números do painel ao vivo,
// com os estados só do novo (bloqueio, precaução, leito extra, higienização) e o conflito: o leito bloqueado ou em
// higienização aqui que o outro sistema ocupou aparece na hora (a coordenação é avisada; o outro sistema nunca é
// impedido). Do leito: admitir, transferir para cá, bloquear e desbloquear, a precaução, os atributos, a limpeza e a
// etiqueta com o QR code da solicitação de limpeza. Arrastar o paciente de um leito ocupado para um livre abre a
// confirmação da transferência (o link "Transferir para cá" faz o mesmo pelo teclado). O canal de eventos avisa cada
// mudança (as gravações e o vigia de 1 a 2 s) e o mapa relê; sem o canal, a cada 15 s.
import {
  CODIGOS_MOTIVO_BLOQUEIO_LEITO,
  MOTIVOS_BLOQUEIO_LEITO,
  PRECAUCOES,
  type LeitoMapa,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import {
  abrirEstadoLeito,
  CANAL_MAPA,
  emitirEtiquetaLeito,
  alterarEstadoLeito,
  encerrarEstadoLeito,
  gravarAtributosLeito,
  limparAtributosLeito,
  lerMapa,
  novaChave,
  solicitarLimpeza,
} from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { agruparMapa, classeSituacao } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';
import { usarAvisos } from '../vigia.js';
import DialogoAlteracaoNir from '../componentes/DialogoAlteracaoNir.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivoDe } = usarAdt('leitos');
let primeira = true;
const avisos = usarAvisos(CANAL_MAPA, () => void mapa.refetch());
const mapa = useQuery({
  queryKey: ['adt', 'mapa'],
  queryFn: () => {
    const abertura = primeira;
    primeira = false;
    return lerMapa(abertura);
  },
  refetchInterval: computed(() => avisos.intervalo()),
});
const bloco = ref('');
const situacao = ref('');
const grupos = computed(() =>
  mapa.data.value ? agruparMapa(mapa.data.value, { bloco: bloco.value, situacao: situacao.value }) : [],
);
const opcoesBloco = computed(() => [
  { valor: '', rotulo: t('adt.todos') },
  ...(mapa.data.value?.painel.blocos ?? []).map((b) => ({ valor: b.bloco, rotulo: b.nome })),
]);
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('adt.todos') },
  ...['livre', 'reservado', 'ocupado', 'bloqueado', 'higienizacao', 'conflito', 'inativo'].map((s) => ({
    valor: s,
    rotulo: t(`adt.mapa.situacoes.${s}`),
  })),
]);
const podeAdmitir = podeNaSessao('internacao.internacao.criar');
const podeTransferir = podeNaSessao('leitos.transferencia.criar');
const podeBloquear = pode('bloqueio');
const podeAtributo = pode('atributo');
const podeLimpeza = pode('hotelaria.solicitarLimpeza');
const aviso = motivoDe('bloqueio');

// ── Ação no leito ──
const leito = ref<LeitoMapa | null>(null);
const acao = ref<'bloqueio' | 'precaucao' | 'extra' | 'atributos' | 'limpeza' | null>(null);
const visivel = computed({
  get: () => acao.value !== null,
  set: (v: boolean) => {
    if (!v) acao.value = null;
  },
});
const motivoBloqueio = ref('manutencao');
const precaucao = ref('contato');
const previsaoFim = ref('');
const sexo = ref('A');
const idadeMinima = ref('');
const motivoAtributos = ref('');
const idadeMaxima = ref('');
const criticidade = ref('');
const tipoLimpeza = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function executar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    acao.value = null;
    await cliente.invalidateQueries({ queryKey: ['adt', 'mapa'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
function abrir(l: LeitoMapa, a: NonNullable<typeof acao.value>): void {
  leito.value = l;
  acao.value = a;
  erro.value = null;
  if (a === 'atributos') {
    sexo.value = l.atributos?.sexo ?? 'A';
    idadeMinima.value = l.atributos?.idadeMinima?.toString() ?? '';
    idadeMaxima.value = l.atributos?.idadeMaxima?.toString() ?? '';
    criticidade.value = l.atributos?.criticidade?.toString() ?? '';
    motivoAtributos.value = '';
  }
}
function confirmar(): Promise<void> {
  const l = leito.value;
  if (!l) return Promise.resolve();
  if (acao.value === 'atributos')
    return executar(() =>
      gravarAtributosLeito(
        {
          leito: l.leito,
          sexo: sexo.value,
          ...(idadeMinima.value ? { idadeMinima: Number(idadeMinima.value) } : {}),
          ...(idadeMaxima.value ? { idadeMaxima: Number(idadeMaxima.value) } : {}),
          ...(criticidade.value ? { criticidade: Number(criticidade.value) } : {}),
          ...(motivoAtributos.value.trim() ? { motivo: motivoAtributos.value.trim() } : {}),
        },
        novaChave('atributo'),
      ),
    );
  if (acao.value === 'limpeza')
    return executar(() =>
      solicitarLimpeza(
        { leito: l.leito, tipoLimpeza: Number(tipoLimpeza.value), origem: 'manual' },
        novaChave('limpeza'),
      ),
    );
  const estado = acao.value as 'bloqueio' | 'precaucao' | 'extra';
  return executar(() =>
    abrirEstadoLeito(
      {
        leito: l.leito,
        estado,
        ...(estado === 'bloqueio' ? { motivo: motivoBloqueio.value } : {}),
        ...(estado === 'precaucao' ? { precaucao: precaucao.value } : {}),
        ...(previsaoFim.value ? { previsaoFim: previsaoFim.value } : {}),
      },
      novaChave(`estado-${estado}`),
    ),
  );
}
const encerrar = (l: LeitoMapa, estado: string) =>
  executar(() => encerrarEstadoLeito({ leito: l.leito, estado }, novaChave(`encerrar-${estado}`)));
const tem = (l: LeitoMapa, e: string) => l.estados.some((x) => x.estado === e);
const opcoes = computed(() => ({
  motivos: MOTIVOS_BLOQUEIO_LEITO.filter((m) =>
    (CODIGOS_MOTIVO_BLOQUEIO_LEITO as readonly string[]).includes(m.codigo),
  ).map((m) => ({
    valor: m.codigo as string,
    rotulo: m.rotulo,
  })),
  precaucoes: PRECAUCOES.map((p) => ({ valor: p.codigo as string, rotulo: p.rotulo })),
  sexos: ['A', 'F', 'M'].map((s) => ({ valor: s, rotulo: t(`adt.mapa.sexos.${s}`) })),
  tipos: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(apoio.data.value?.tiposLimpeza ?? []).map((x) => ({ valor: String(x.codigo), rotulo: x.nome })),
  ],
}));
const leitoCodificado = (l: LeitoMapa) => encodeURIComponent(l.chave);

// ── W0-07: alterar o estado aberto sem encerrar e limpar os atributos (volta ao padrão), com a justificativa ──
const dAlterarEstado = ref(false);
const dLimpar = ref(false);
const refAlterarEstado = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const refLimpar = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const alvoMapa = ref<LeitoMapa | null>(null);
const aEstado = ref<'bloqueio' | 'precaucao' | 'extra'>('bloqueio');
const aMotivo = ref('');
const aPrecaucao = ref('');
const aPrevisao = ref('');
const aObservacao = ref('');
function abrirAlterarEstado(l: LeitoMapa, estado: 'bloqueio' | 'precaucao' | 'extra'): void {
  const e = l.estados.find((x) => x.estado === estado);
  alvoMapa.value = l;
  aEstado.value = estado;
  aMotivo.value = e?.motivo ?? '';
  aPrecaucao.value = e?.precaucao ?? '';
  aPrevisao.value = e?.previsaoFim ?? '';
  // A observação atual vem carregada: no bloqueio de uma OS ela leva "OS <número>", a ligação com a OS (o servidor
  // mantém esse prefixo de todo modo).
  aObservacao.value = e?.observacao ?? '';
  dAlterarEstado.value = true;
}
function alterarEstado(d: { motivo: string }): void {
  const l = alvoMapa.value;
  const e = l?.estados.find((x) => x.estado === aEstado.value);
  if (!l || !e) return;
  void refAlterarEstado.value?.executar(async () => {
    const r = await alterarEstadoLeito(
      {
        leito: l.leito,
        estado: aEstado.value,
        ...(aEstado.value === 'bloqueio' && aMotivo.value && aMotivo.value !== e.motivo
          ? { motivo: aMotivo.value }
          : {}),
        ...(aEstado.value === 'precaucao' && aPrecaucao.value && aPrecaucao.value !== e.precaucao
          ? { precaucao: aPrecaucao.value }
          : {}),
        ...((aPrevisao.value || null) !== e.previsaoFim ? { previsaoFim: aPrevisao.value || null } : {}),
        ...(aObservacao.value.trim() !== (e.observacao ?? '')
          ? { observacao: aObservacao.value.trim() || null }
          : {}),
        justificativa: d.motivo,
      },
      novaChave('alterar-estado'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['adt', 'mapa'] });
  });
}
function abrirLimpar(l: LeitoMapa): void {
  alvoMapa.value = l;
  dLimpar.value = true;
}
function limpar(d: { motivo: string }): void {
  const l = alvoMapa.value;
  if (!l) return;
  void refLimpar.value?.executar(async () => {
    const r = await limparAtributosLeito(
      { leito: l.leito, justificativa: d.motivo },
      novaChave('limpar-atributos'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['adt', 'mapa'] });
  });
}

// ── Etiqueta do leito (QR code da solicitação de limpeza) ──
const etiqueta = (l: LeitoMapa) =>
  executar(async () => {
    const r = await emitirEtiquetaLeito({ leito: l.leito }, novaChave('etiqueta-leito'));
    return { mensagem: r.fila ? t('adt.mapa.etiquetaEnviada') : t('adt.mapa.etiquetaGerada') };
  });

// ── Arrastar para transferir: solta o paciente num leito livre e abre a confirmação da transferência ──
const roteador = useRouter();
const arrastado = ref<number | null>(null);
function arrastar(ev: DragEvent, internacao: number | undefined): void {
  if (!internacao || !podeTransferir) return;
  arrastado.value = internacao;
  ev.dataTransfer?.setData('text/plain', String(internacao));
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}
function soltar(ev: DragEvent, destino: LeitoMapa): void {
  const reg = Number(ev.dataTransfer?.getData('text/plain') || arrastado.value || 0);
  arrastado.value = null;
  if (!reg || !destino.admissivel || !podeTransferir) return;
  void roteador.push(`/leitos/transferencias?destino=${leitoCodificado(destino)}&internacao=${reg}`);
}
</script>

<template>
  <section class="tela-agenda mapa-leitos" aria-labelledby="mapa-titulo" data-testid="tela-mapa-leitos">
    <h1 id="mapa-titulo">{{ t('adt.mapa.titulo') }}</h1>
    <p>{{ t('adt.mapa.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <p class="secundario" data-testid="mapa-canal">
      {{ avisos.conectado.value ? t('adt.mapa.aoVivo') : t('adt.mapa.semCanal') }}
    </p>
    <div class="filtros">
      <SanteSelecao v-model="bloco" :rotulo="t('adt.bloco')" :opcoes="opcoesBloco" data-testid="mapa-bloco" />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('adt.mapa.filtroSituacao')"
        :opcoes="opcoesSituacao"
        data-testid="mapa-situacao"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="mapa-mensagem">{{ mensagem }}</p>
    <ErroAdt v-if="erro && !visivel" :erro="erro" />
    <!-- A releitura que falha (rede caída) não apaga o mapa já lido: o aviso de erro fica junto do último estado. -->
    <ErroAdt v-if="mapa.isError.value" :erro="mapa.error.value" />
    <p v-if="!mapa.data.value && !mapa.isError.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-if="mapa.data.value">
      <p data-testid="mapa-resumo">
        {{
          t('adt.mapa.resumo', {
            admissiveis: mapa.data.value.resumo.admissiveis,
            bloqueados: mapa.data.value.resumo.bloqueados,
            higienizacao: mapa.data.value.resumo.emHigienizacao,
            conflitos: mapa.data.value.resumo.conflitos,
          })
        }}
        <span v-if="mapa.data.value.painel.totais.ocupacao !== null">
          · {{ t('adt.mapa.ocupacao', { n: mapa.data.value.painel.totais.ocupacao }) }}</span
        >
      </p>
      <p v-if="podeTransferir" class="secundario">{{ t('adt.mapa.arrastar') }}</p>
      <SanteAlerta
        v-for="l in mapa.data.value.leitos.filter((x) => x.situacao === 'conflito')"
        :key="`conf-${l.chave}`"
        variante="alerta"
        anunciar
        :texto="`${l.leito.acomodacao} ${l.leito.leito}: ${t(l.conflito?.reserva ? 'adt.mapa.conflitoReservaTexto' : 'adt.mapa.conflitoTexto', { desde: (l.conflito?.desde ?? '').replace('T', ' ').slice(0, 16) })}`"
      />
      <section v-for="g in grupos" :key="g.bloco" class="painel" :aria-label="g.nome">
        <h2>{{ g.nome }}</h2>
        <div v-for="a in g.acomodacoes" :key="a.acomodacao">
          <h3>{{ a.nome }}</h3>
          <ul class="grade-leitos">
            <li
              v-for="x in a.leitos"
              :key="x.mapa.chave"
              :class="['leito', classeSituacao(x.mapa.situacao)]"
              :data-testid="`leito-${x.mapa.chave}`"
              :data-situacao="x.mapa.situacao"
              :draggable="podeTransferir && !!x.cartao"
              :aria-dropeffect="arrastado && x.mapa.admissivel ? 'move' : undefined"
              @dragstart="arrastar($event, x.cartao?.internacao)"
              @dragend="arrastado = null"
              @dragover="arrastado && x.mapa.admissivel ? $event.preventDefault() : undefined"
              @drop.prevent="soltar($event, x.mapa)"
            >
              <strong>{{ t('adt.mapa.leitoDe', { leito: x.mapa.leito.leito }) }}</strong>
              <span>{{ t(`adt.mapa.situacoes.${x.mapa.situacao}`) }}</span>
              <span v-if="x.cartao" class="secundario">{{
                t('adt.mapa.cartao', { iniciais: x.cartao.iniciais, reg: x.cartao.internacao })
              }}</span>
              <span
                v-for="e in x.mapa.estados.filter((y) => y.estado !== 'higienizacao')"
                :key="e.estado"
                class="secundario"
                >{{ t(`adt.mapa.estado.${e.estado}`) }}</span
              >
              <span v-if="x.mapa.reserva" class="secundario" :data-testid="`reserva-${x.mapa.chave}`">{{
                t(x.mapa.reserva.confirmada ? 'adt.mapa.reservaConfirmada' : 'adt.mapa.reservaAte', {
                  ate: x.mapa.reserva.validaAte.slice(11, 16),
                  solicitacao: x.mapa.reserva.solicitacao,
                })
              }}</span>
              <span v-if="x.mapa.limpeza" class="secundario">
                {{ t('adt.mapa.limpezaEm', { etapa: t(`adt.hig.etapas.${x.mapa.limpeza.etapa}`) }) }}
                <strong v-if="x.mapa.limpeza.atrasada">{{ t('adt.mapa.atrasada') }}</strong>
              </span>
              <span class="acoes">
                <RouterLink
                  v-if="x.mapa.admissivel && podeAdmitir"
                  :to="`/internacao/admissao?leito=${leitoCodificado(x.mapa)}`"
                  :data-testid="`admitir-${x.mapa.chave}`"
                  >{{ t('adt.mapa.admitir') }}</RouterLink
                >
                <RouterLink
                  v-if="x.mapa.admissivel && podeTransferir"
                  :to="`/leitos/transferencias?destino=${leitoCodificado(x.mapa)}`"
                  >{{ t('adt.mapa.transferirPara') }}</RouterLink
                >
                <template v-if="podeBloquear">
                  <SanteBotao
                    v-if="x.mapa.situacao === 'livre'"
                    variante="texto"
                    :rotulo="t('adt.mapa.bloquear')"
                    :data-testid="`bloquear-${x.mapa.chave}`"
                    @acionar="abrir(x.mapa, 'bloqueio')"
                  />
                  <SanteBotao
                    v-for="e in x.mapa.estados.filter((y) =>
                      ['bloqueio', 'precaucao', 'extra'].includes(y.estado),
                    )"
                    :key="`alterar-${e.estado}`"
                    variante="texto"
                    :rotulo="t('crudNir.alterarEstado', { estado: t(`crudNir.estados.${e.estado}`) })"
                    :data-testid="`alterar-estado-${e.estado}-${x.mapa.chave}`"
                    @acionar="abrirAlterarEstado(x.mapa, e.estado as 'bloqueio' | 'precaucao' | 'extra')"
                  />
                  <SanteBotao
                    v-if="tem(x.mapa, 'bloqueio')"
                    variante="texto"
                    :rotulo="t('adt.mapa.desbloquear')"
                    :data-testid="`desbloquear-${x.mapa.chave}`"
                    @acionar="encerrar(x.mapa, 'bloqueio')"
                  />
                  <SanteBotao
                    v-if="!tem(x.mapa, 'precaucao') && x.mapa.situacao !== 'inativo'"
                    variante="texto"
                    :rotulo="t('adt.mapa.precaucao')"
                    @acionar="abrir(x.mapa, 'precaucao')"
                  />
                  <SanteBotao
                    v-if="tem(x.mapa, 'precaucao')"
                    variante="texto"
                    :rotulo="t('adt.mapa.tirarPrecaucao')"
                    @acionar="encerrar(x.mapa, 'precaucao')"
                  />
                  <SanteBotao
                    v-if="x.mapa.situacao === 'livre' && !tem(x.mapa, 'extra')"
                    variante="texto"
                    :rotulo="t('adt.mapa.extra')"
                    @acionar="abrir(x.mapa, 'extra')"
                  />
                  <SanteBotao
                    v-if="tem(x.mapa, 'extra')"
                    variante="texto"
                    :rotulo="t('adt.mapa.tirarExtra')"
                    @acionar="encerrar(x.mapa, 'extra')"
                  />
                </template>
                <SanteBotao
                  v-if="podeAtributo"
                  variante="texto"
                  :rotulo="t('adt.mapa.atributos')"
                  :data-testid="`atributos-${x.mapa.chave}`"
                  @acionar="abrir(x.mapa, 'atributos')"
                />
                <SanteBotao
                  v-if="podeAtributo && x.mapa.atributos"
                  variante="texto"
                  :rotulo="t('crudNir.limparAtributos')"
                  :data-testid="`limpar-atributos-${x.mapa.chave}`"
                  @acionar="abrirLimpar(x.mapa)"
                />
                <SanteBotao
                  v-if="podeBloquear && x.mapa.situacao !== 'inativo'"
                  variante="texto"
                  :rotulo="t('adt.mapa.etiqueta')"
                  :data-testid="`etiqueta-${x.mapa.chave}`"
                  @acionar="etiqueta(x.mapa)"
                />
                <SanteBotao
                  v-if="podeLimpeza && !x.mapa.limpeza && x.mapa.situacao !== 'inativo'"
                  variante="texto"
                  :rotulo="t('adt.mapa.limpeza')"
                  :data-testid="`limpeza-${x.mapa.chave}`"
                  @acionar="abrir(x.mapa, 'limpeza')"
                />
              </span>
            </li>
          </ul>
        </div>
      </section>
    </template>
    <DialogoAlteracaoNir
      ref="refAlterarEstado"
      v-model:visivel="dAlterarEstado"
      :titulo="t('crudNir.alterarEstadoTitulo', { estado: t(`crudNir.estados.${aEstado}`) })"
      :texto="t('crudNir.alterarEstadoTexto')"
      :rotulo-motivo="t('crudNir.justificativa')"
      :rotulo-confirmar="t('crudNir.alterar')"
      testid="dialogo-alterar-estado"
      @confirmar="alterarEstado"
    >
      <SanteSelecao
        v-if="aEstado === 'bloqueio'"
        v-model="aMotivo"
        :rotulo="t('crudNir.motivoBloqueio')"
        :opcoes="opcoes.motivos"
      />
      <SanteSelecao
        v-if="aEstado === 'precaucao'"
        v-model="aPrecaucao"
        :rotulo="t('adt.mapa.precaucao')"
        :opcoes="opcoes.precaucoes"
      />
      <label for="alterar-estado-previsao">{{ t('crudNir.previsao') }}</label>
      <input
        id="alterar-estado-previsao"
        v-model="aPrevisao"
        type="date"
        data-testid="alterar-estado-previsao"
      />
      <SanteCampoTexto
        v-model="aObservacao"
        :rotulo="t('crudNir.observacao')"
        :max-bytes="200"
        data-testid="alterar-estado-observacao"
      />
    </DialogoAlteracaoNir>
    <DialogoAlteracaoNir
      ref="refLimpar"
      v-model:visivel="dLimpar"
      :titulo="t('crudNir.limparAtributosTitulo')"
      :texto="t('crudNir.limparAtributosTexto')"
      :rotulo-motivo="t('crudNir.justificativa')"
      :rotulo-confirmar="t('crudNir.limparAtributos')"
      destrutivo
      testid="dialogo-limpar-atributos"
      @confirmar="limpar"
    />
    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="
        leito ? t('adt.mapa.leitoDe', { leito: `${leito.leito.acomodacao} ${leito.leito.leito}` }) : ''
      "
    >
      <form class="filtros" @submit.prevent="confirmar">
        <SanteSelecao
          v-if="acao === 'bloqueio'"
          v-model="motivoBloqueio"
          :rotulo="t('adt.mapa.motivoBloqueio')"
          :opcoes="opcoes.motivos"
          data-testid="bloqueio-motivo"
        />
        <SanteSelecao
          v-if="acao === 'precaucao'"
          v-model="precaucao"
          :rotulo="t('adt.mapa.tipoPrecaucao')"
          :opcoes="opcoes.precaucoes"
        />
        <div v-if="acao === 'bloqueio' || acao === 'precaucao' || acao === 'extra'" class="campo">
          <label for="mapa-previsao">{{ t('adt.mapa.previsaoFim') }}</label>
          <input id="mapa-previsao" v-model="previsaoFim" type="date" />
        </div>
        <template v-if="acao === 'atributos'">
          <SanteSelecao
            v-model="sexo"
            :rotulo="t('adt.mapa.sexo')"
            :opcoes="opcoes.sexos"
            data-testid="atributo-sexo"
          />
          <div class="campo">
            <label for="mapa-idade-min">{{ t('adt.mapa.idadeMinima') }}</label>
            <input id="mapa-idade-min" v-model="idadeMinima" type="number" min="0" max="130" />
          </div>
          <div class="campo">
            <label for="mapa-idade-max">{{ t('adt.mapa.idadeMaxima') }}</label>
            <input id="mapa-idade-max" v-model="idadeMaxima" type="number" min="0" max="130" />
          </div>
          <div class="campo">
            <label for="mapa-criticidade">{{ t('adt.mapa.criticidade') }}</label>
            <input id="mapa-criticidade" v-model="criticidade" type="number" min="1" max="3" />
          </div>
          <SanteCampoTexto
            v-if="leito?.atributos"
            v-model="motivoAtributos"
            :rotulo="t('crudNir.motivoAlteracao')"
            :max-bytes="300"
            data-testid="atributo-motivo"
          />
        </template>
        <SanteSelecao
          v-if="acao === 'limpeza'"
          v-model="tipoLimpeza"
          :rotulo="t('adt.hig.tipo')"
          :opcoes="opcoes.tipos"
          data-testid="mapa-tipo-limpeza"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('adt.gravar')"
          :desabilitado="ocupado || (acao === 'limpeza' && !tipoLimpeza)"
          data-testid="mapa-confirmar"
        />
        <ErroAdt v-if="erro" :erro="erro" />
      </form>
    </SanteDialogo>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.grade-leitos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
.leito {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-left-width: 6px;
  border-radius: 4px;
}
.leito-livre {
  border-left-color: var(--sgh-sucesso);
}
.leito-ocupado {
  border-left-color: var(--sgh-primaria);
}
.leito-bloqueado,
.leito-inativo {
  border-left-color: var(--sgh-texto-secundario);
}
.leito-higienizacao {
  border-left-color: var(--sgh-aviso);
}
.leito-reservado {
  border-left-color: var(--sgh-aviso);
  border-left-style: dashed;
}
.leito-conflito {
  border-left-color: var(--sgh-alerta);
  border-left-width: 10px;
}
</style>
