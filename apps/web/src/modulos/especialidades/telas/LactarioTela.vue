<script setup lang="ts">
// Lactário e produção (cap-06a §6.3; ficha do M45, seção 12; DP-32): `/nutricao/lactario`. A produção do dia (as ordens
// por paciente com a fórmula, o volume, os horários das porções, o preparo e a validade, a conferência), os totais por
// fórmula com as parcelas, a ordem nova, a conferência por OUTRA pessoa e as etiquetas em ZPL (só da ordem conferida).
// A validade e a ordem das porções vêm do servidor.
// W0-05: pelo diálogo de correção (motivo obrigatório), alterar a ordem antes da conferência (o valor anterior no
// histórico da ordem); depois da conferência, só cancelar (a recusa 409 do servidor aparece no diálogo). A ordem
// cancelada continua na lista, riscada, com quem, quando e o motivo; o histórico de cada ordem (alterações, etiquetas e
// cancelamento). A impressão sai com as ordens canceladas.
import type { AlteracaoHotLida, OrdemLactarioLida } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import DialogoCorrecao from '../../nutricao/componentes/DialogoCorrecao.vue';
import {
  alterarOrdemLactario,
  cancelarOrdemLactario,
  conferirOrdemLactario,
  gerarEtiquetasLactario,
  lerGravacaoEspecialidade,
  lerInternacoesEspecialidade,
  lerLactario,
  novaChaveEspecialidade,
  registrarOrdemLactario,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import { dataLonga, horariosDoTexto, instanteCurto, leitoTexto } from '../regras-especialidades.js';

const { t } = useI18n();
const { sessao } = usarSessao();
const login = computed(() => (sessao.value?.usuario.login ?? sessao.value?.usuario.id ?? '').toUpperCase());
const gravacao = useQuery({
  queryKey: ['especialidades', 'lactario', 'gravacao'],
  queryFn: () => lerGravacaoEspecialidade('lactario'),
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['produzir']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['produzir']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const data = ref<string | null>(null);
const producao = useQuery({
  queryKey: computed(() => ['especialidades', 'lactario', data.value]),
  queryFn: () => lerLactario(data.value),
});

// ── Ordem nova ───────────────────────────────────────────────────────────────────────────────────
const termo = ref('');
const buscado = ref('');
const internacoes = useQuery({
  queryKey: computed(() => ['especialidades', 'lactario', 'internacoes', buscado.value]),
  queryFn: () => lerInternacoesEspecialidade('lactario', buscado.value),
});
const opcoesInternacao = computed(() =>
  (internacoes.data.value?.itens ?? []).map((i) => ({
    valor: i.internacao,
    rotulo: `${i.nome} · ${t('especialidades.prontuario')} ${i.prontuario} · ${leitoTexto(i.leito)}`,
  })),
);
const internacao = ref<number | null>(null);
const o = reactive({
  formula: '',
  volume: '',
  horarios: '',
  preparoEm: '',
  lote: '',
  observacao: '',
});

// O padrão do preparo é o relógio do estabelecimento (o servidor), não o do navegador.
watch(
  () => producao.data.value?.lidoEm,
  (agora) => {
    if (agora && !o.preparoEm) o.preparoEm = agora;
  },
  { immediate: true },
);

const erro = ref<unknown>(null);
const erroDe = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function registrar(): Promise<void> {
  erro.value = null;
  erroDe.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarOrdemLactario(
      {
        internacao: internacao.value,
        formula: o.formula,
        volumeMl: Number(o.volume),
        horarios: horariosDoTexto(o.horarios),
        preparoEm: o.preparoEm,
        ...(o.lote.trim() ? { lote: o.lote.trim() } : {}),
        ...(o.observacao.trim() ? { observacao: o.observacao.trim() } : {}),
      },
      novaChaveEspecialidade('lactario'),
    );
    mensagem.value = r.mensagem;
    await producao.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function conferir(id: number): Promise<void> {
  erro.value = null;
  erroDe.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await conferirOrdemLactario(id, novaChaveEspecialidade('conferir'))).mensagem;
    await producao.refetch();
  } catch (x) {
    erro.value = x;
    erroDe.value = id;
  } finally {
    ocupado.value = false;
  }
}

const zpl = ref<{ id: number; conteudo: string; etiquetas: number; nomeArquivo: string } | null>(null);
async function etiquetas(id: number): Promise<void> {
  erro.value = null;
  erroDe.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await gerarEtiquetasLactario(id, novaChaveEspecialidade('etiqueta'));
    zpl.value = { id, conteudo: r.conteudo, etiquetas: r.etiquetas, nomeArquivo: r.nomeArquivo };
    mensagem.value = t('especialidades.lactario.etiquetasGeradas', { n: r.etiquetas });
  } catch (x) {
    erro.value = x;
    erroDe.value = id;
  } finally {
    ocupado.value = false;
  }
}
// ── W0-05: alterar antes da conferência; cancelar ──
const acao = ref<{ tipo: 'alterar' | 'cancelar'; ordem: OrdemLactarioLida } | null>(null);
const dialogo = ref(false);
const a = reactive({ formula: '', volume: '', horarios: '', preparoEm: '', lote: '', observacao: '' });
function abrir(tipo: 'alterar' | 'cancelar', ordem: OrdemLactarioLida): void {
  acao.value = { tipo, ordem };
  a.formula = ordem.formula;
  a.volume = String(ordem.volumeMl);
  a.horarios = ordem.horarios.join(', ');
  a.preparoEm = ordem.preparoEm.slice(0, 16);
  a.lote = ordem.lote ?? '';
  a.observacao = ordem.observacao ?? '';
  dialogo.value = true;
}
const incompleto = computed(
  () =>
    acao.value?.tipo === 'alterar' &&
    (a.formula.trim().length < 3 || !a.volume || horariosDoTexto(a.horarios).length === 0 || !a.preparoEm),
);
function gravarAcao({ motivo }: { motivo: string }) {
  const x = acao.value;
  if (!x) return Promise.reject(new Error('sem ação'));
  if (x.tipo === 'cancelar')
    return cancelarOrdemLactario(x.ordem.id, motivo, novaChaveEspecialidade('cancelar-ordem'));
  return alterarOrdemLactario(
    x.ordem.id,
    {
      formula: a.formula.trim(),
      volumeMl: Number(a.volume),
      horarios: horariosDoTexto(a.horarios),
      preparoEm: a.preparoEm,
      ...(a.lote.trim() ? { lote: a.lote.trim() } : {}),
      ...(a.observacao.trim() ? { observacao: a.observacao.trim() } : {}),
      motivo,
    },
    novaChaveEspecialidade('alterar-ordem'),
  );
}
async function feito(r: unknown): Promise<void> {
  erro.value = null;
  erroDe.value = null;
  mensagem.value = (r as { mensagem: string }).mensagem;
  await producao.refetch();
}
const historicoTexto = (h: AlteracaoHotLida) =>
  [
    t('especialidades.lactario.historicoLinha', {
      evento: t(`especialidades.lactario.eventosHot.${h.evento}`),
      em: instanteCurto(h.em),
      por: h.por,
    }),
    h.antes || h.depois
      ? t('especialidades.lactario.antesDepois', { antes: h.antes ?? '—', depois: h.depois ?? '—' })
      : null,
    h.motivo,
  ]
    .filter(Boolean)
    .join(' · ');
const imprimir = () => window.print();
const baixar = computed(() =>
  zpl.value ? `data:text/plain;charset=utf-8,${encodeURIComponent(zpl.value.conteudo)}` : '',
);
</script>

<template>
  <section class="tela-agenda tela-correcoes" aria-labelledby="lactario-titulo" data-testid="tela-lactario">
    <h1 id="lactario-titulo">{{ t('especialidades.lactario.titulo') }}</h1>
    <p>{{ t('especialidades.lactario.texto') }}</p>
    <AvisoEspecialidade :motivo="aviso" />
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="lactario-mensagem" />
    <div class="filtros">
      <SanteData v-model="data" :rotulo="t('especialidades.lactario.dia')" editavel />
    </div>
    <ErroEspecialidade v-if="producao.isError.value" :erro="producao.error.value" />
    <p v-else-if="!producao.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <template v-else>
      <section class="painel" aria-labelledby="lactario-ordens">
        <div class="cabeca-registro">
          <h2 id="lactario-ordens">
            {{ t('especialidades.lactario.producaoDe', { dia: dataLonga(producao.data.value.data) }) }}
          </h2>
          <SanteBotao
            class="nao-imprimir"
            variante="secundario"
            :rotulo="t('especialidades.lactario.imprimir')"
            data-testid="lactario-imprimir"
            @acionar="imprimir"
          />
        </div>
        <p class="secundario">
          {{ t('especialidades.lactario.validade', { h: producao.data.value.validadeHoras }) }}
        </p>
        <p v-if="producao.data.value.ordens.length === 0">{{ t('especialidades.lactario.semOrdens') }}</p>
        <table v-else class="tabela" data-testid="lactario-tabela">
          <caption>
            {{
              t('especialidades.lactario.ordens')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('especialidades.paciente') }}</th>
              <th scope="col">{{ t('especialidades.lactario.formula') }}</th>
              <th scope="col">{{ t('especialidades.lactario.porcoes') }}</th>
              <th scope="col">{{ t('especialidades.lactario.preparoValidade') }}</th>
              <th scope="col">{{ t('especialidades.lactario.situacao') }}</th>
              <th scope="col">{{ t('especialidades.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in producao.data.value.ordens"
              :key="x.id"
              :data-testid="`ordem-${x.id}`"
              :data-situacao="x.cancelada ? 'cancelada' : x.situacao"
              :class="{ inativo: x.cancelada }"
            >
              <td>
                <strong>{{ x.nome }}</strong>
                <div class="secundario">
                  {{ t('especialidades.prontuario') }} {{ x.prontuario }} · {{ leitoTexto(x.leito) }}
                </div>
              </td>
              <td>
                {{ x.formula
                }}<span v-if="x.lote" class="secundario">
                  · {{ t('especialidades.lactario.lote') }} {{ x.lote }}</span
                >
              </td>
              <td>
                {{
                  t('especialidades.lactario.porcoesLinha', {
                    n: x.horarios.length,
                    ml: x.volumeMl,
                    horarios: x.horarios.join(', '),
                  })
                }}
              </td>
              <td>
                {{
                  t('especialidades.un.intervalo', {
                    de: instanteCurto(x.preparoEm),
                    ate: instanteCurto(x.validadeEm),
                  })
                }}
                <strong v-if="x.vencida" class="alerta-texto">
                  · {{ t('especialidades.lactario.vencida') }}</strong
                >
              </td>
              <td>
                <span
                  v-if="x.cancelada"
                  class="pilula pilula--alerta"
                  :data-testid="`ordem-cancelada-${x.id}`"
                  >{{ t('especialidades.lactario.cancelada') }}</span
                >
                <span v-else>{{ t(`especialidades.lactario.situacoes.${x.situacao}`) }}</span>
                <div v-if="x.cancelada" class="nota-correcao">
                  {{
                    t('especialidades.lactario.canceladaPor', {
                      por: x.canceladaPor,
                      em: instanteCurto(x.canceladaEm),
                      motivo: x.motivoCancelamento,
                    })
                  }}
                </div>
                <div class="secundario">
                  {{ t('especialidades.lactario.preparadaPor', { por: x.por }) }}
                  <span v-if="x.conferidoPor">
                    · {{ t('especialidades.lactario.conferidaPor', { por: x.conferidoPor }) }}</span
                  >
                  <span v-if="x.etiquetaEm">
                    · {{ t('especialidades.lactario.etiquetaEm', { em: instanteCurto(x.etiquetaEm) }) }}</span
                  >
                </div>
                <details v-if="x.historico.length" :data-testid="`ordem-historico-${x.id}`">
                  <summary>{{ t('especialidades.lactario.historico') }} ({{ x.historico.length }})</summary>
                  <ul class="eventos">
                    <li v-for="h in x.historico" :key="h.id">{{ historicoTexto(h) }}</li>
                  </ul>
                </details>
              </td>
              <td>
                <div v-if="!x.cancelada" class="acoes nao-imprimir">
                  <SanteBotao
                    v-if="pode && x.situacao === 'preparada'"
                    variante="texto"
                    :rotulo="t('especialidades.lactario.alterar')"
                    :data-testid="`ordem-alterar-${x.id}`"
                    @acionar="abrir('alterar', x)"
                  />
                  <SanteBotao
                    v-if="pode"
                    variante="texto"
                    :rotulo="t('especialidades.lactario.cancelarOrdem')"
                    :data-testid="`ordem-cancelar-${x.id}`"
                    @acionar="abrir('cancelar', x)"
                  />
                  <span v-if="x.vencida" class="alerta-texto" :data-testid="`ordem-vencida-${x.id}`">{{
                    t('especialidades.lactario.vencidaSemAcao')
                  }}</span>
                  <SanteBotao
                    v-else-if="pode && x.situacao === 'preparada' && x.por.toUpperCase() !== login"
                    variante="secundario"
                    :rotulo="t('especialidades.lactario.conferir')"
                    :desabilitado="ocupado"
                    :data-testid="`ordem-conferir-${x.id}`"
                    @click="conferir(x.id)"
                  />
                  <span v-else-if="x.situacao === 'preparada'" class="secundario">{{
                    t('especialidades.lactario.aguardaConferencia')
                  }}</span>
                  <SanteBotao
                    v-if="pode && x.situacao === 'conferida' && !x.vencida"
                    variante="secundario"
                    :rotulo="t('especialidades.lactario.etiquetas')"
                    :desabilitado="ocupado"
                    :data-testid="`ordem-etiquetas-${x.id}`"
                    @click="etiquetas(x.id)"
                  />
                </div>
                <ErroEspecialidade v-if="erro && erroDe === x.id" :erro="erro" />
              </td>
            </tr>
          </tbody>
        </table>
        <table v-if="producao.data.value.totais.length" class="tabela" data-testid="lactario-totais">
          <caption>
            {{
              t('especialidades.lactario.totais')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('especialidades.lactario.formula') }}</th>
              <th scope="col">{{ t('especialidades.lactario.porcoes') }}</th>
              <th scope="col">{{ t('especialidades.lactario.volumeTotal') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in producao.data.value.totais" :key="x.formula">
              <td>{{ x.formula }}</td>
              <td>{{ x.porcoes }}</td>
              <td>{{ t('especialidades.un.ml', { v: x.volumeMl }) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <DialogoCorrecao
        v-model:visivel="dialogo"
        :titulo="acao ? t(`especialidades.lactario.${acao.tipo}Titulo`, { nome: acao.ordem.nome }) : ''"
        :texto="acao ? t(`especialidades.lactario.${acao.tipo}Texto`) : ''"
        :confirmar="
          acao?.tipo === 'cancelar'
            ? t('especialidades.lactario.cancelarOrdem')
            : t('especialidades.lactario.alterar')
        "
        :alerta="
          acao?.tipo === 'cancelar' && acao.ordem.etiquetaEm
            ? t('especialidades.lactario.cancelarComEtiqueta')
            : undefined
        "
        :incompleto="incompleto"
        :gravar="gravarAcao"
        @feito="feito"
      >
        <div v-if="acao?.tipo === 'alterar'" class="grade">
          <SanteCampoTexto
            v-model="a.formula"
            :rotulo="t('especialidades.lactario.formula')"
            :max-bytes="60"
            obrigatorio
          />
          <div class="campo">
            <label for="alt-volume">{{ t('especialidades.lactario.volume') }}</label>
            <input
              id="alt-volume"
              v-model="a.volume"
              type="number"
              min="5"
              max="500"
              required
              data-testid="alterar-volume"
            />
          </div>
          <SanteCampoTexto
            v-model="a.horarios"
            :rotulo="t('especialidades.lactario.horarios')"
            :max-bytes="80"
            obrigatorio
          />
          <div class="campo">
            <label for="alt-preparo">{{ t('especialidades.lactario.preparo') }}</label>
            <input id="alt-preparo" v-model="a.preparoEm" type="datetime-local" required />
          </div>
          <SanteCampoTexto
            v-model="a.lote"
            :rotulo="t('especialidades.lactario.loteOpcional')"
            :max-bytes="30"
          />
        </div>
      </DialogoCorrecao>
      <section v-if="zpl" class="painel" aria-labelledby="lactario-zpl">
        <h2 id="lactario-zpl">{{ t('especialidades.lactario.previa', { n: zpl.etiquetas }) }}</h2>
        <pre class="zpl" tabindex="0" data-testid="lactario-zpl">{{ zpl.conteudo }}</pre>
        <a :href="baixar" :download="zpl.nomeArquivo">{{ t('especialidades.lactario.baixar') }}</a>
      </section>
    </template>
    <section class="painel" aria-labelledby="lactario-nova">
      <h2 id="lactario-nova">{{ t('especialidades.lactario.nova') }}</h2>
      <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
      <form v-else class="formulario" data-testid="form-lactario" @submit.prevent="registrar">
        <div class="filtros">
          <SanteCampoTexto v-model="termo" :rotulo="t('especialidades.buscar')" :max-bytes="60" />
          <SanteBotao
            variante="secundario"
            :rotulo="t('especialidades.pesquisar')"
            @click="buscado = termo.trim()"
          />
        </div>
        <SanteSelecao
          v-model="internacao"
          :rotulo="t('especialidades.lactario.paciente')"
          :opcoes="opcoesInternacao"
          obrigatorio
          busca
          data-testid="lactario-internacao"
        />
        <div class="grade">
          <SanteCampoTexto
            v-model="o.formula"
            :rotulo="t('especialidades.lactario.formula')"
            :max-bytes="60"
            obrigatorio
          />
          <div class="campo">
            <label for="lact-volume">{{ t('especialidades.lactario.volume') }}</label>
            <input id="lact-volume" v-model="o.volume" type="number" min="5" max="500" required />
          </div>
          <SanteCampoTexto
            v-model="o.horarios"
            :rotulo="t('especialidades.lactario.horarios')"
            :max-bytes="80"
            obrigatorio
          />
          <div class="campo">
            <label for="lact-preparo">{{ t('especialidades.lactario.preparo') }}</label>
            <input id="lact-preparo" v-model="o.preparoEm" type="datetime-local" required />
          </div>
          <SanteCampoTexto
            v-model="o.lote"
            :rotulo="t('especialidades.lactario.loteOpcional')"
            :max-bytes="30"
          />
        </div>
        <SanteCampoTexto v-model="o.observacao" :rotulo="t('especialidades.observacao')" :max-bytes="200" />
        <ErroEspecialidade v-if="erro && erroDe === null" :erro="erro" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('especialidades.lactario.registrar')"
          :desabilitado="ocupado || internacao === null"
          data-testid="lactario-gravar"
        />
      </form>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-especialidades.css"></style>
<style src="../../nutricao/componentes/estilo-correcao.css"></style>
<style scoped>
.zpl {
  max-height: 16rem;
  overflow: auto;
  font-family: var(--sgh-fonte-codigo);
  font-size: var(--sgh-fonte-pequena);
  background: var(--sgh-fundo-sutil);
  padding: var(--sgh-espaco-2);
}
</style>
