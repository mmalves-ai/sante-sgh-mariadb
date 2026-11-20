<script setup lang="ts">
// Detalhe da notificação para o NSP (M48, etapa 1; ficha, seção 7; regras 1, 2, 3 e 11): o que foi notificado, o
// paciente (relido pelo servidor), os prazos regulatórios e a linha do tempo; os painéis de triagem (classificação da
// OMS e grau de dano coerentes; corrigir a proposta exige justificativa), distribuição ao gestor da área (busca remota
// das contas ativas), retorno ao notificador, descarte e Notivisa. Quem notificou aparece só para o NSP e só na
// identificada. Cada gravação vai com a versão lida (outra pessoa gravou antes: a tela pede para recarregar).
import {
  CLASSIFICACOES_OMS,
  type ClassificacaoOms,
  GRAUS_DANO,
  type GrauDano,
  MOTIVOS_DESCARTE_NOTIFICACAO,
  type MotivoDescarteNotificacao,
  SITUACOES_NOTIFICACAO,
  SITUACOES_NOTIVISA,
  type TipoIncidente,
  TIPOS_INCIDENTE,
  TIPOS_PRAZO_REGULATORIO,
} from '@sgh/contratos';
import { conferirClassificacao, exigeAtencaoImediata, propostaDeClassificacao } from '@sgh/dominio-qualidade';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarGestores,
  descartarNotificacao,
  devolverAoNotificador,
  distribuirNotificacao,
  lerFormularioNotificacao,
  lerNotificacao,
  novaChaveQualidade,
  triarNotificacao,
} from '../api.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import PainelNotivisa from '../componentes/PainelNotivisa.vue';
import PrazoChip from '../componentes/PrazoChip.vue';
import { RECUSAS_NOTIFICACAO } from '../i18n.js';
import { acoesDaSituacao, dataHora, diasDepois } from '../regras-qualidade.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.id));
const consulta = useQuery({
  queryKey: computed(() => ['qualidade', 'nsp', 'notificacao', id.value]),
  queryFn: () => lerNotificacao(id.value),
});
const formulario = useQuery({
  queryKey: ['qualidade', 'formulario'],
  queryFn: lerFormularioNotificacao,
  staleTime: 60_000,
});
const n = computed(() => consulta.data.value?.notificacao ?? null);
const agora = computed(() => consulta.data.value?.agora ?? '');
const gravacao = computed(() => consulta.data.value?.gravacao ?? null);
const acoes = computed(() => (n.value ? acoesDaSituacao(n.value.situacao) : null));
const podeTriar = computed(() => gravacao.value?.acoes.triar ?? false);

const rotulo = {
  tipo: (c: string) => TIPOS_INCIDENTE.find((x) => x.codigo === c)?.rotulo ?? c,
  classificacao: (c: string) => CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.rotulo ?? c,
  dano: (c: string) => GRAUS_DANO.find((x) => x.codigo === c)?.rotulo ?? c,
  situacao: (c: string) => SITUACOES_NOTIFICACAO.find((x) => x.codigo === c)?.rotulo ?? c,
  notivisa: (c: string) => SITUACOES_NOTIVISA.find((x) => x.codigo === c)?.rotulo ?? c,
  prazo: (c: string) => TIPOS_PRAZO_REGULATORIO.find((x) => x.codigo === c)?.rotulo ?? c,
};

const feito = ref<string | null>(null);
const erro = ref<unknown>(null);
const falta = ref<string | null>(null);
async function recarregar(texto: string): Promise<void> {
  feito.value = texto;
  await cliente.invalidateQueries({ queryKey: ['qualidade', 'nsp'] });
}
async function gravar(fn: () => Promise<unknown>, texto: string): Promise<void> {
  erro.value = null;
  falta.value = null;
  feito.value = null;
  try {
    await fn();
    await recarregar(texto);
  } catch (e) {
    erro.value = e;
  }
}

// ── Triagem ──────────────────────────────────────────────────────────────────────────────────────
const triagem = reactive({
  tipo: '' as TipoIncidente,
  tipoOutro: '',
  classificacao: '' as ClassificacaoOms,
  dano: '' as GrauDano,
  neverEvent: false,
  justificativa: '',
});
watch(
  n,
  (x) => {
    if (!x) return;
    Object.assign(triagem, {
      tipo: x.tipo,
      tipoOutro: x.tipoOutro ?? '',
      classificacao: x.classificacao,
      dano: x.dano,
      neverEvent: x.neverEvent,
      justificativa: '',
    });
  },
  { immediate: true },
);
const proposta = computed(() =>
  n.value ? propostaDeClassificacao(n.value.chegouAoPaciente, n.value.danoPercebido) : null,
);
const mudou = computed(
  () =>
    !!n.value &&
    (triagem.tipo !== n.value.tipo ||
      triagem.classificacao !== n.value.classificacao ||
      triagem.dano !== n.value.dano ||
      triagem.neverEvent !== n.value.neverEvent),
);
const incoerente = computed(() => {
  const p = conferirClassificacao(triagem.classificacao, triagem.dano);
  return p ? RECUSAS_NOTIFICACAO[p] : null;
});
const opTipo = TIPOS_INCIDENTE.map((x) => ({ valor: x.codigo as TipoIncidente, rotulo: x.rotulo }));
const opClassificacao = CLASSIFICACOES_OMS.map((x) => ({
  valor: x.codigo as ClassificacaoOms,
  rotulo: x.rotulo,
}));
const opDano = GRAUS_DANO.map((x) => ({ valor: x.codigo as GrauDano, rotulo: x.rotulo }));
let chaveTriar = novaChaveQualidade('triar');
async function triar(): Promise<void> {
  const x = n.value;
  if (!x) return;
  if (incoerente.value) {
    falta.value = incoerente.value;
    return;
  }
  if (mudou.value && triagem.justificativa.trim().length < 10) {
    falta.value = RECUSAS_NOTIFICACAO['justificativa-obrigatoria'];
    return;
  }
  await gravar(async () => {
    await triarNotificacao(
      x.id,
      {
        versao: x.versao,
        tipo: triagem.tipo,
        tipoOutro: triagem.tipo === 'outro' ? triagem.tipoOutro.trim() || null : null,
        classificacao: triagem.classificacao,
        dano: triagem.dano,
        neverEvent: triagem.neverEvent,
        justificativa: mudou.value ? triagem.justificativa.trim() : null,
      },
      chaveTriar,
    );
    chaveTriar = novaChaveQualidade('triar');
  }, t('qualidade.triagem.triada'));
}

// ── Distribuição ao gestor da área ───────────────────────────────────────────────────────────────
const distribuicao = reactive({
  busca: '',
  gestor: '',
  unidade: null as number | null,
  prazo: null as string | null,
  orientacao: '',
});
watch(
  [n, () => formulario.data.value],
  ([x, f]) => {
    if (!x || distribuicao.prazo !== null) return;
    distribuicao.prazo = x.prazoAnalise ?? (agora.value ? diasDepois(agora.value, 30) : null);
    distribuicao.gestor = x.gestor ?? '';
    distribuicao.unidade = f?.unidades.find((u) => u.nome === x.unidade)?.codigo ?? null;
  },
  { immediate: true },
);
const termoGestor = ref('');
const gestores = useQuery({
  queryKey: computed(() => ['qualidade', 'nsp', 'gestores', termoGestor.value]),
  queryFn: () => buscarGestores(termoGestor.value),
  enabled: computed(() => termoGestor.value.length >= 2),
  staleTime: 30_000,
});
const opGestor = computed(() => {
  const itens = gestores.data.value?.itens ?? [];
  const atual =
    distribuicao.gestor && !itens.some((g) => g.login === distribuicao.gestor) ? [distribuicao.gestor] : [];
  return [
    { valor: '', rotulo: t('qualidade.triagem.escolhaGestor') },
    ...atual.map((l) => ({ valor: l, rotulo: l })),
    ...itens.map((g) => ({
      valor: g.login,
      rotulo: g.nome === g.login ? g.login : `${g.nome} (${g.login})`,
    })),
  ];
});
function procurarGestor(): void {
  termoGestor.value = distribuicao.busca.trim().slice(0, 40);
}
const opUnidade = computed(() => [
  { valor: null as number | null, rotulo: t('qualidade.notificar.escolhaUnidade') },
  ...(formulario.data.value?.unidades ?? []).map((u) => ({
    valor: u.codigo as number | null,
    rotulo: u.nome,
  })),
]);
let chaveDistribuir = novaChaveQualidade('distribuir');
async function distribuir(): Promise<void> {
  const x = n.value;
  if (!x) return;
  if (!distribuicao.gestor || distribuicao.unidade === null || !distribuicao.prazo) {
    falta.value = t('qualidade.triagem.distribuirFalta');
    return;
  }
  const { gestor, unidade, prazo } = distribuicao;
  await gravar(async () => {
    await distribuirNotificacao(
      x.id,
      {
        versao: x.versao,
        gestor,
        unidade,
        prazoAnalise: prazo,
        orientacao: distribuicao.orientacao.trim() || null,
      },
      chaveDistribuir,
    );
    chaveDistribuir = novaChaveQualidade('distribuir');
  }, t('qualidade.triagem.distribuida'));
}

// ── Retorno ao notificador ───────────────────────────────────────────────────────────────────────
const devolutiva = ref('');
let chaveDevolutiva = novaChaveQualidade('devolutiva');
async function devolver(): Promise<void> {
  const x = n.value;
  if (!x) return;
  if (devolutiva.value.trim().length < 10) {
    falta.value = t('qualidade.triagem.devolutivaFalta');
    return;
  }
  await gravar(async () => {
    await devolverAoNotificador(x.id, { versao: x.versao, texto: devolutiva.value.trim() }, chaveDevolutiva);
    chaveDevolutiva = novaChaveQualidade('devolutiva');
    devolutiva.value = '';
  }, t('qualidade.triagem.devolvida'));
}

// ── Descarte ─────────────────────────────────────────────────────────────────────────────────────
const descarte = reactive({
  motivo: '' as MotivoDescarteNotificacao | '',
  justificativa: '',
  duplicadaDe: '',
});
const opMotivo = MOTIVOS_DESCARTE_NOTIFICACAO.map((m) => ({
  valor: m.codigo as MotivoDescarteNotificacao | '',
  rotulo: m.rotulo,
}));
let chaveDescartar = novaChaveQualidade('descartar');
async function descartar(): Promise<void> {
  const x = n.value;
  if (!x) return;
  const motivo = descarte.motivo;
  const duplicadaDe = descarte.duplicadaDe.trim().toUpperCase() || null;
  if (!motivo || descarte.justificativa.trim().length < 10) {
    falta.value = t('qualidade.triagem.descarteFalta');
    return;
  }
  if (motivo === 'duplicada' && !duplicadaDe) {
    falta.value = RECUSAS_NOTIFICACAO['duplicada-sem-protocolo'];
    return;
  }
  await gravar(async () => {
    await descartarNotificacao(
      x.id,
      { versao: x.versao, motivo, justificativa: descarte.justificativa.trim(), duplicadaDe },
      chaveDescartar,
    );
    chaveDescartar = novaChaveQualidade('descartar');
  }, t('qualidade.triagem.descartada'));
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nsp-detalhe-titulo" data-testid="tela-nsp-detalhe">
    <p>
      <RouterLink to="/qualidade/nsp/notificacoes">{{ t('qualidade.voltar') }}</RouterLink>
    </p>
    <ErroQualidade v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!n" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <h1 id="nsp-detalhe-titulo">
        {{ n.protocolo }} · {{ rotulo.tipo(n.tipo) }}
        <span v-if="n.tipoOutro" class="secundario">({{ n.tipoOutro }})</span>
      </h1>
      <p v-if="['distribuida', 'emAnalise', 'concluida'].includes(n.situacao)">
        <RouterLink :to="`/qualidade/nsp/analises/${n.id}`" data-testid="nsp-ir-analise">{{
          t('qualidade.analise.listaTitulo')
        }}</RouterLink>
      </p>
      <SanteAlerta
        v-if="n.situacao === 'recebida' && exigeAtencaoImediata(n.dano, n.neverEvent)"
        variante="alerta"
        :texto="t('qualidade.lista.atencaoImediata')"
        data-testid="atencao-imediata"
      />
      <SanteAlerta v-if="gravacao && !gravacao.ligada" variante="info" :texto="t('qualidade.desligado')" />
      <SanteAlerta v-if="feito" variante="info" :texto="feito" anunciar data-testid="nsp-feito" />
      <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar data-testid="nsp-falta" />
      <ErroQualidade v-if="erro" :erro="erro" />

      <dl class="ficha" data-testid="nsp-ficha">
        <dt>{{ t('qualidade.lista.situacao') }}</dt>
        <dd data-testid="nsp-situacao">{{ rotulo.situacao(n.situacao) }}</dd>
        <dt>{{ t('qualidade.lista.classificacao') }}</dt>
        <dd>
          {{ rotulo.classificacao(n.classificacao) }} · {{ t('qualidade.lista.dano') }}:
          {{ rotulo.dano(n.dano) }}
        </dd>
        <dt>{{ t('qualidade.lista.notivisa') }}</dt>
        <dd>{{ rotulo.notivisa(n.notivisa) }}</dd>
        <dt>{{ t('qualidade.lista.ocorridoEm') }}</dt>
        <dd>{{ dataHora(n.ocorridoEm) }}</dd>
        <dt>{{ t('qualidade.lista.notificadaEm') }}</dt>
        <dd>{{ dataHora(n.notificadaEm) }}</dd>
        <dt>{{ t('qualidade.lista.unidade') }}</dt>
        <dd>
          {{ n.unidade ?? '-' }}<span v-if="n.local"> · {{ n.local }}</span>
        </dd>
        <dt>{{ t('qualidade.detalhe.paciente') }}</dt>
        <dd data-testid="nsp-paciente">
          <template v-if="n.paciente">
            {{ n.paciente.nome }}
            <span v-if="n.paciente.leito" class="secundario">
              · {{ t('qualidade.detalhe.leito') }} {{ n.paciente.leito }}</span
            >
          </template>
          <span v-else class="secundario">{{ t('qualidade.notificar.semPaciente') }}</span>
        </dd>
        <dt>{{ t('qualidade.detalhe.notificador') }}</dt>
        <dd data-testid="nsp-notificador">
          {{ n.anonima ? t('qualidade.detalhe.notificadorAnonimo') : (n.notificador ?? '-') }}
          <div class="secundario">{{ t('qualidade.detalhe.notificadorOculto') }}</div>
        </dd>
        <dt>{{ t('qualidade.notificar.chegouAoPaciente') }}</dt>
        <dd>
          {{ n.chegouAoPaciente ? t('qualidade.sim') : t('qualidade.nao') }} ·
          {{ t('qualidade.notificar.danoPercebido') }}: {{ rotulo.dano(n.danoPercebido) }}
        </dd>
        <template v-if="n.gestor">
          <dt>{{ t('qualidade.detalhe.gestor') }}</dt>
          <dd>{{ n.gestor }} · {{ t('qualidade.detalhe.prazoAnalise') }}: {{ dataHora(n.prazoAnalise) }}</dd>
        </template>
        <dt>{{ t('qualidade.detalhe.descricao') }}</dt>
        <dd class="ficha__texto">{{ n.descricao }}</dd>
      </dl>

      <section v-if="n.prazos.length > 0" class="painel-nsp" :aria-label="t('qualidade.detalhe.prazos')">
        <h2>{{ t('qualidade.detalhe.prazos') }}</h2>
        <ul class="prazos" data-testid="nsp-prazos">
          <li v-for="p in n.prazos" :key="p.tipo">
            {{ rotulo.prazo(p.tipo) }}: {{ dataHora(p.venceEm) }} <PrazoChip :prazo="p" />
          </li>
        </ul>
      </section>

      <form
        v-if="podeTriar && acoes?.triar"
        class="painel-nsp"
        :aria-label="t('qualidade.triagem.titulo')"
        data-testid="painel-triagem"
        @submit.prevent="triar"
      >
        <h2>{{ t('qualidade.triagem.titulo') }}</h2>
        <p v-if="proposta" class="secundario">
          {{ t('qualidade.triagem.proposta', { classificacao: rotulo.classificacao(proposta) }) }}
        </p>
        <SanteSelecao
          v-model="triagem.tipo"
          :rotulo="t('qualidade.lista.tipo')"
          :opcoes="opTipo"
          busca
          data-testid="triagem-tipo"
        />
        <SanteCampoTexto
          v-if="triagem.tipo === 'outro'"
          v-model="triagem.tipoOutro"
          :rotulo="t('qualidade.notificar.tipoOutro')"
          :max-bytes="60"
          obrigatorio
        />
        <SanteOpcoes
          v-model="triagem.classificacao"
          :legenda="t('qualidade.lista.classificacao')"
          :opcoes="opClassificacao"
          nome="triagem-classificacao"
          data-testid="triagem-classificacao"
        />
        <SanteOpcoes
          v-model="triagem.dano"
          :legenda="t('qualidade.lista.dano')"
          :opcoes="opDano"
          nome="triagem-dano"
          data-testid="triagem-dano"
        />
        <label
          ><input v-model="triagem.neverEvent" type="checkbox" data-testid="triagem-never" />
          {{ t('qualidade.detalhe.neverEvent') }}</label
        >
        <SanteAlerta v-if="incoerente" variante="aviso" :texto="incoerente" />
        <SanteCampoTexto
          v-if="mudou"
          v-model="triagem.justificativa"
          :rotulo="t('qualidade.triagem.justificativa')"
          :max-bytes="500"
          multilinha
          obrigatorio
          data-testid="triagem-justificativa"
        />
        <SanteBotao
          :rotulo="t('qualidade.triagem.confirmar')"
          variante="primario"
          tipo="submit"
          data-testid="triagem-confirmar"
        />
      </form>

      <form
        v-if="podeTriar && acoes?.distribuir"
        class="painel-nsp"
        :aria-label="t('qualidade.triagem.distribuir')"
        data-testid="painel-distribuir"
        @submit.prevent="distribuir"
      >
        <h2>{{ t('qualidade.triagem.distribuir') }}</h2>
        <div class="linha-nsp">
          <SanteCampoTexto
            v-model="distribuicao.busca"
            :rotulo="t('qualidade.triagem.buscarGestor')"
            :max-bytes="40"
            data-testid="distribuir-busca"
            @keydown.enter.prevent="procurarGestor"
          />
          <SanteBotao
            :rotulo="t('qualidade.triagem.buscar')"
            variante="secundario"
            data-testid="distribuir-buscar"
            @acionar="procurarGestor"
          />
        </div>
        <p v-if="termoGestor && gestores.data.value?.itens.length === 0" role="status">
          {{ t('qualidade.triagem.nenhumGestor') }}
        </p>
        <SanteSelecao
          v-model="distribuicao.gestor"
          :rotulo="t('qualidade.triagem.gestor')"
          :opcoes="opGestor"
          obrigatorio
          data-testid="distribuir-gestor"
        />
        <SanteSelecao
          v-model="distribuicao.unidade"
          :rotulo="t('qualidade.notificar.unidade')"
          :opcoes="opUnidade"
          obrigatorio
          data-testid="distribuir-unidade"
        />
        <SanteData v-model="distribuicao.prazo" :rotulo="t('qualidade.detalhe.prazoAnalise')" editavel />
        <SanteCampoTexto
          v-model="distribuicao.orientacao"
          :rotulo="t('qualidade.triagem.orientacao')"
          :max-bytes="500"
          multilinha
          data-testid="distribuir-orientacao"
        />
        <SanteBotao
          :rotulo="t('qualidade.triagem.distribuir')"
          variante="primario"
          tipo="submit"
          data-testid="distribuir-enviar"
        />
      </form>

      <form
        v-if="podeTriar && acoes?.devolver"
        class="painel-nsp"
        :aria-label="t('qualidade.triagem.devolutiva')"
        data-testid="painel-devolutiva"
        @submit.prevent="devolver"
      >
        <h2>{{ t('qualidade.triagem.devolutiva') }}</h2>
        <p class="secundario">{{ t('qualidade.triagem.devolutivaAjuda') }}</p>
        <SanteCampoTexto
          v-model="devolutiva"
          :rotulo="t('qualidade.triagem.devolutiva')"
          :max-bytes="2000"
          multilinha
          obrigatorio
          data-testid="devolutiva-texto"
        />
        <SanteBotao
          :rotulo="t('qualidade.triagem.enviarDevolutiva')"
          variante="primario"
          tipo="submit"
          data-testid="devolutiva-enviar"
        />
      </form>

      <PainelNotivisa
        v-if="acoes?.notivisa && gravacao?.acoes.notivisa"
        :id="n.id"
        :protocolo="n.protocolo"
        :versao="n.versao"
        :agora="agora"
        :transcrita="n.notivisa === 'transcrita'"
        :pode-exportar="gravacao.acoes.notivisa"
        @mudou="recarregar(t('qualidade.prazos.atualizado'))"
      />

      <form
        v-if="podeTriar && acoes?.descartar"
        class="painel-nsp"
        :aria-label="t('qualidade.triagem.descartar')"
        data-testid="painel-descartar"
        @submit.prevent
      >
        <h2>{{ t('qualidade.triagem.descartar') }}</h2>
        <SanteOpcoes
          v-model="descarte.motivo"
          :legenda="t('qualidade.triagem.motivoDescarte')"
          :opcoes="opMotivo"
          nome="descarte-motivo"
        />
        <SanteCampoTexto
          v-if="descarte.motivo === 'duplicada'"
          v-model="descarte.duplicadaDe"
          :rotulo="t('qualidade.triagem.duplicadaDe')"
          :max-bytes="15"
          obrigatorio
          data-testid="descarte-duplicada"
        />
        <SanteCampoTexto
          v-model="descarte.justificativa"
          :rotulo="t('qualidade.triagem.justificativaDescarte')"
          :max-bytes="500"
          multilinha
          obrigatorio
          data-testid="descarte-justificativa"
        />
        <SanteBotao
          :rotulo="t('qualidade.triagem.descartar')"
          variante="destrutivo"
          :confirmacao="t('qualidade.triagem.confirmarDescarte')"
          data-testid="descarte-enviar"
          @acionar="descartar"
        />
      </form>

      <section class="painel-nsp" :aria-label="t('qualidade.detalhe.linhaDoTempo')">
        <h2>{{ t('qualidade.detalhe.linhaDoTempo') }}</h2>
        <ol class="tempo" data-testid="nsp-linha-do-tempo">
          <li v-for="(e, i) in n.eventos" :key="i" :data-evento="e.tipo">
            <strong>{{ t(`qualidade.detalhe.eventos.${e.tipo}`) }}</strong>
            <span class="secundario">
              · {{ dataHora(e.em) }}<template v-if="e.por"> · {{ e.por }}</template></span
            >
            <div v-if="e.texto" class="ficha__texto">{{ e.texto }}</div>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.ficha {
  display: grid;
  grid-template-columns: minmax(10rem, max-content) 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: 0;
}
.ficha dt {
  font-weight: 600;
}
.ficha dd {
  margin: 0;
}
.ficha__texto {
  white-space: pre-wrap;
}
.prazos,
.tempo {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-4);
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
</style>
