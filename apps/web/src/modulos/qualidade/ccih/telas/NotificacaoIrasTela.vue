<script setup lang="ts">
// Qualidade e segurança › CCIH › Notificação mensal (F7, 09-AREA linha 68): as competências fechadas da vigilância com o
// prazo do envio ao órgão sanitário (dia 15 do mês seguinte), o atraso e a situação mais recente de cada formulário.
// O registro abre na própria competência: o tipo (inicial ou retificação) é decidido pela regra, o que falta aparece na
// hora (botão travado até estar completo) e o andamento (aceito, rejeitado) é registrado na linha do envio. As recusas
// são as mesmas da API (@sgh/dominio-qualidade). Nada é apagado: a retificação é um envio novo.
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import {
  avaliarEnvioIras,
  FORMULARIOS_IRAS,
  type FormularioIras,
  MENSAGENS_NOTIFICACAO_IRAS,
  type SituacaoEnvioIras,
} from '@sgh/dominio-qualidade';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { codigoDaRecusa, novaChaveCcih } from '../api-ccih.js';
import {
  type CompetenciaNotificacaoDaTela,
  type EnvioIrasDaTela,
  lerCompetenciasNotificacao,
  registrarAndamentoIras,
  registrarEnvioIras,
} from '../api-notificacao-iras.js';
import ErroCcih from '../componentes/ErroCcih.vue';
import NavCcih from '../componentes/NavCcih.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeRegistrar = pode('qualidade.iras.registrar');
const lista = useQuery({ queryKey: ['ccih', 'notificacao'], queryFn: lerCompetenciasNotificacao });
const hoje = new Date().toISOString().slice(0, 10);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const recusa = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && c in MENSAGENS_NOTIFICACAO_IRAS
    ? MENSAGENS_NOTIFICACAO_IRAS[c as keyof typeof MENSAGENS_NOTIFICACAO_IRAS]
    : null;
});
const nomeFormulario = (f: string) => t(`ccih.notificacao.formularios.${f}`);
const nomeSituacao = (s: string) => t(`ccih.notificacao.situacoes.${s}`);
const dia = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');

// ── Novo envio na competência ──
const f = reactive({
  competencia: 0,
  formulario: '' as FormularioIras | '',
  transcrita: true,
  enviadoEm: hoje,
  protocolo: '',
  motivo: '',
});
const chave = ref(novaChaveCcih('notificacao'));
const opFormularios = [
  { valor: '', rotulo: '' },
  ...FORMULARIOS_IRAS.map((x) => ({ valor: x as string, rotulo: nomeFormulario(x) })),
];
const aberta = computed(() => (lista.data.value ?? []).find((c) => c.id === f.competencia) ?? null);
function abrir(c: CompetenciaNotificacaoDaTela): void {
  Object.assign(f, {
    competencia: c.id,
    formulario: '',
    transcrita: true,
    enviadoEm: hoje,
    protocolo: '',
    motivo: '',
  });
  erro.value = null;
  aviso.value = null;
}
/** A mesma regra do servidor decide o tipo e a recusa, na hora. */
const avaliacao = computed(() =>
  aberta.value && f.formulario
    ? avaliarEnvioIras(
        {
          formulario: f.formulario,
          situacao: f.transcrita ? 'transcrita' : 'pendente',
          enviadoEm: f.transcrita ? f.enviadoEm || null : null,
          protocolo: f.protocolo || null,
          motivoRetificacao: f.motivo || null,
        },
        {
          competencia: aberta.value.competencia,
          situacaoCompetencia: aberta.value.situacao,
          anteriores: aberta.value.envios,
          hoje,
        },
      )
    : null,
);
const falta = computed(() => {
  const r: string[] = [];
  if (!f.formulario) r.push(t('ccih.notificacao.faltas.formulario'));
  if (f.transcrita && !f.enviadoEm) r.push(t('ccih.notificacao.faltas.data'));
  if (avaliacao.value?.tipo === 'retificacao' && f.motivo.trim().length < 5)
    r.push(t('ccih.notificacao.faltas.motivo'));
  return r;
});
const recusaNaHora = computed(() =>
  avaliacao.value?.recusa && !falta.value.length ? MENSAGENS_NOTIFICACAO_IRAS[avaliacao.value.recusa] : null,
);
async function gravar(): Promise<void> {
  if (falta.value.length || recusaNaHora.value || !f.formulario) return;
  erro.value = null;
  try {
    await registrarEnvioIras(
      f.competencia,
      {
        formulario: f.formulario,
        situacao: f.transcrita ? 'transcrita' : 'pendente',
        enviadoEm: f.transcrita ? f.enviadoEm : null,
        protocolo: f.protocolo.trim() || null,
        motivoRetificacao: avaliacao.value?.tipo === 'retificacao' ? f.motivo.trim() : null,
      },
      chave.value,
    );
    chave.value = novaChaveCcih('notificacao');
    f.competencia = 0;
    aviso.value = t('ccih.notificacao.gravado');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'notificacao'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Andamento do envio ──
const a = reactive({
  envio: 0,
  situacao: '' as SituacaoEnvioIras | '',
  enviadoEm: hoje,
  protocolo: '',
  mensagem: '',
});
const chaveA = ref(novaChaveCcih('notificacao-andamento'));
const proximas: Record<SituacaoEnvioIras, SituacaoEnvioIras[]> = {
  pendente: ['transcrita'],
  enviada: ['aceita', 'rejeitada'],
  transcrita: ['aceita', 'rejeitada'],
  aceita: [],
  rejeitada: [],
};
const envioAberto = computed<EnvioIrasDaTela | null>(
  () => (lista.data.value ?? []).flatMap((c) => c.envios).find((e) => e.id === a.envio) ?? null,
);
const opAndamento = computed(() => [
  { valor: '', rotulo: '' },
  ...(envioAberto.value ? proximas[envioAberto.value.situacao] : []).map((s) => ({
    valor: s as string,
    rotulo: nomeSituacao(s),
  })),
]);
function abrirAndamento(e: EnvioIrasDaTela): void {
  Object.assign(a, {
    envio: e.id,
    situacao: '',
    enviadoEm: hoje,
    protocolo: e.protocolo ?? '',
    mensagem: '',
  });
  erro.value = null;
  aviso.value = null;
}
const faltaA = computed(() => {
  const r: string[] = [];
  if (!a.situacao) r.push(t('ccih.notificacao.situacao'));
  if (a.situacao === 'transcrita' && !a.enviadoEm) r.push(t('ccih.notificacao.faltas.data'));
  if (a.situacao === 'rejeitada' && !a.mensagem.trim()) r.push(t('ccih.notificacao.faltas.mensagem'));
  return r;
});
async function gravarAndamento(): Promise<void> {
  if (faltaA.value.length || !a.situacao || !envioAberto.value) return;
  erro.value = null;
  try {
    await registrarAndamentoIras(
      a.envio,
      {
        versao: envioAberto.value.versao,
        situacao: a.situacao,
        enviadoEm: a.situacao === 'transcrita' ? a.enviadoEm : null,
        protocolo: a.protocolo.trim() || null,
        mensagemRetorno: a.mensagem.trim() || null,
      },
      chaveA.value,
    );
    chaveA.value = novaChaveCcih('notificacao-andamento');
    a.envio = 0;
    aviso.value = t('ccih.notificacao.andamentoGravado');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'notificacao'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-not-titulo" data-testid="tela-ccih-notificacao">
    <NavCcih />
    <h1 id="ccih-not-titulo">{{ t('ccih.notificacao.titulo') }}</h1>
    <p class="secundario">{{ t('ccih.notificacao.explicacao') }}</p>
    <div v-if="aviso" role="status" data-testid="notificacao-aviso">{{ aviso }}</div>
    <div v-if="recusa" role="alert" data-testid="notificacao-recusa">{{ recusa }}</div>
    <ErroCcih v-else-if="erro" :erro="erro" />
    <ErroCcih v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.data.value && !lista.data.value.length" data-testid="notificacao-nenhuma">
      {{ t('ccih.notificacao.nenhuma') }}
    </p>
    <article
      v-for="c in lista.data.value ?? []"
      :key="c.id"
      class="painel-ccih"
      :data-testid="`notificacao-competencia-${c.competencia}`"
    >
      <div class="linha-ccih">
        <h2>{{ t('ccih.notificacao.competencia', { competencia: c.competencia }) }}</h2>
        <span class="secundario">{{ t('ccih.notificacao.prazo', { prazo: dia(c.prazo) }) }}</span>
        <span v-if="c.atrasada" class="selo selo--grave" data-testid="notificacao-atrasada">{{
          t('ccih.notificacao.atrasada')
        }}</span>
        <span v-else-if="c.situacao === 'enviada'" class="selo" data-testid="notificacao-enviada">{{
          t('ccih.notificacao.enviada')
        }}</span>
        <SanteBotao
          v-if="podeRegistrar && c.situacao !== 'reaberta'"
          :rotulo="t('ccih.notificacao.novo')"
          variante="secundario"
          :data-testid="`notificacao-novo-${c.competencia}`"
          @acionar="abrir(c)"
        />
      </div>
      <p v-if="!c.envios.length" class="secundario">{{ t('ccih.notificacao.semEnvio') }}</p>
      <ul v-else class="lista-ccih" :aria-label="t('ccih.notificacao.ultimoEnvio')">
        <li
          v-for="x in c.formularios"
          :key="x.formulario"
          :data-testid="`notificacao-formulario-${c.competencia}-${x.formulario}`"
        >
          <strong>{{ nomeFormulario(x.formulario) }}</strong>
          <span>{{ nomeSituacao(x.ultima) }}</span>
          <span v-if="x.atrasado" class="selo selo--grave">{{ t('ccih.notificacao.atrasada') }}</span>
        </li>
      </ul>

      <div v-if="f.competencia === c.id" class="painel-ccih" data-testid="form-notificacao">
        <div class="linha-ccih">
          <SanteSelecao
            v-model="f.formulario"
            :rotulo="t('ccih.notificacao.formulario')"
            :opcoes="opFormularios"
            obrigatorio
            data-testid="notificacao-formulario"
          />
          <span v-if="avaliacao" class="selo" data-testid="notificacao-tipo">{{
            avaliacao.tipo === 'retificacao'
              ? t('ccih.notificacao.retificacao')
              : t('ccih.notificacao.inicial')
          }}</span>
          <label
            ><input v-model="f.transcrita" type="checkbox" data-testid="notificacao-transcrita" />{{
              t('ccih.notificacao.situacoes.transcrita')
            }}</label
          >
        </div>
        <div v-if="f.transcrita" class="linha-ccih">
          <label
            >{{ t('ccih.notificacao.enviadoEm') }}
            <input v-model="f.enviadoEm" type="date" :max="hoje" data-testid="notificacao-data"
          /></label>
          <SanteCampoTexto
            v-model="f.protocolo"
            :rotulo="t('ccih.notificacao.protocolo')"
            :max-bytes="40"
            data-testid="notificacao-protocolo"
          />
        </div>
        <SanteCampoTexto
          v-if="avaliacao?.tipo === 'retificacao'"
          v-model="f.motivo"
          :rotulo="t('ccih.notificacao.motivo')"
          :max-bytes="1000"
          multilinha
          obrigatorio
          data-testid="notificacao-motivo"
        />
        <p v-if="falta.length" class="secundario" data-testid="notificacao-falta">
          {{ t('ccih.notificacao.falta', { itens: falta.join(' ') }) }}
        </p>
        <p v-if="recusaNaHora" role="alert" data-testid="notificacao-recusa-hora">{{ recusaNaHora }}</p>
        <div class="linha-ccih">
          <SanteBotao
            :rotulo="t('ccih.notificacao.registrar')"
            :desabilitado="falta.length > 0 || recusaNaHora !== null"
            data-testid="notificacao-gravar"
            @acionar="gravar"
          />
          <SanteBotao
            :rotulo="t('ccih.notificacao.cancelar')"
            variante="secundario"
            data-testid="notificacao-cancelar"
            @acionar="f.competencia = 0"
          />
        </div>
      </div>

      <details v-if="c.envios.length" :data-testid="`notificacao-historico-${c.competencia}`">
        <summary>{{ t('ccih.notificacao.historico') }}</summary>
        <ul class="lista-ccih">
          <li v-for="e in c.envios" :key="e.id" :data-testid="`notificacao-envio-${e.id}`">
            <strong>{{ nomeFormulario(e.formulario) }}</strong>
            <span>{{
              e.tipo === 'retificacao' ? t('ccih.notificacao.retificacao') : t('ccih.notificacao.inicial')
            }}</span>
            <span :data-testid="`notificacao-envio-situacao-${e.id}`">{{ nomeSituacao(e.situacao) }}</span>
            <span v-if="e.enviadoEm" class="secundario">{{ dia(e.enviadoEm) }}</span>
            <span v-if="e.protocolo" class="secundario">{{ e.protocolo }}</span>
            <span v-if="e.motivoRetificacao" class="secundario">{{ e.motivoRetificacao }}</span>
            <span v-if="e.mensagemRetorno" class="secundario">{{ e.mensagemRetorno }}</span>
            <SanteBotao
              v-if="podeRegistrar && proximas[e.situacao].length"
              :rotulo="t('ccih.notificacao.andamento')"
              variante="secundario"
              :data-testid="`notificacao-andamento-${e.id}`"
              @acionar="abrirAndamento(e)"
            />
            <div v-if="a.envio === e.id" class="painel-ccih" data-testid="form-andamento">
              <div class="linha-ccih">
                <SanteSelecao
                  v-model="a.situacao"
                  :rotulo="t('ccih.notificacao.situacao')"
                  :opcoes="opAndamento"
                  obrigatorio
                  data-testid="andamento-situacao"
                />
                <label v-if="a.situacao === 'transcrita'"
                  >{{ t('ccih.notificacao.enviadoEm') }}
                  <input v-model="a.enviadoEm" type="date" :max="hoje" data-testid="andamento-data"
                /></label>
                <SanteCampoTexto
                  v-model="a.protocolo"
                  :rotulo="t('ccih.notificacao.protocolo')"
                  :max-bytes="40"
                  data-testid="andamento-protocolo"
                />
              </div>
              <SanteCampoTexto
                v-if="a.situacao === 'rejeitada' || a.situacao === 'aceita'"
                v-model="a.mensagem"
                :rotulo="t('ccih.notificacao.mensagem')"
                :max-bytes="1000"
                multilinha
                :obrigatorio="a.situacao === 'rejeitada'"
                data-testid="andamento-mensagem"
              />
              <p v-if="faltaA.length" class="secundario" data-testid="andamento-falta">
                {{ t('ccih.notificacao.falta', { itens: faltaA.join(' ') }) }}
              </p>
              <SanteBotao
                :rotulo="t('ccih.notificacao.gravar')"
                :desabilitado="faltaA.length > 0"
                data-testid="andamento-gravar"
                @acionar="gravarAndamento"
              />
            </div>
          </li>
        </ul>
      </details>
    </article>
  </section>
</template>
