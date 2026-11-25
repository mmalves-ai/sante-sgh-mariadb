<script setup lang="ts">
// 09-AREA linha 86 (C1-035): auditoria das checagens de enfermagem. A lista mostra as auditorias com o filtro de
// situação; "Nova auditoria" sorteia a amostra no período (unidade, atendimento, tamanho e auditores escolhidos na
// mesma janela) e abre o detalhe já com as checagens sorteadas. Cada checagem é avaliada ali mesmo: conforme, não
// conforme (motivo padronizado e justificativa) ou não aplicável (justificativa); a justificativa mínima e o período
// são conferidos na hora pelas regras do domínio. Concluir mostra os totais e o resultado pela taxa; cancelar pede o
// motivo. Gravar pede enfermagem.auditoriaChecagem.auditar; sem ela, a tela é só consulta. Nada é apagado: a
// auditoria cancelada fica no histórico.
import { conferirAvaliacao, totaisDaAuditoria } from '@sgh/dominio-enfermagem';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  abrirAuditoria,
  avaliarItem,
  cancelarAuditoria,
  concluirAuditoria,
  lerApoioAuditoria,
  lerAuditoria,
  lerAuditorias,
  type ItemAuditoria,
  type ResultadoItem,
  type SituacaoAuditoria,
} from '../api-auditoria-checagem.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const podeAuditar = computed(() => permissoes.value.has('enfermagem.auditoriaChecagem.auditar'));
const MINIMO = 10;
const SITUACOES: SituacaoAuditoria[] = ['aberta', 'em_andamento', 'concluida', 'cancelada'];

// Lista
const filtro = ref<SituacaoAuditoria | ''>('');
const lista = useQuery({
  queryKey: computed(() => ['enfermagem', 'auditoria-checagem', filtro.value]),
  queryFn: () => lerAuditorias(filtro.value || null),
});
const auditorias = computed(() => lista.data.value ?? []);
const opcoesFiltro = computed(() => [
  { valor: '' as const, rotulo: t('enfermagem.auditoriaChecagem.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: t(`enfermagem.auditoriaChecagem.situacoes.${s}`) })),
]);
const apoio = useQuery({
  queryKey: ['enfermagem', 'auditoria-checagem', 'apoio'],
  queryFn: () => lerApoioAuditoria(),
});
const hora = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

// Nova auditoria
const dialogoNova = ref(false);
const inicio = ref('');
const fim = ref('');
const unidade = ref('');
const atendimento = ref('');
const tamanho = ref(20);
const criterio = ref('');
const observacao = ref('');
const auditorEscolhido = ref<number | null>(null);
const papelEscolhido = ref<'auditor' | 'observador'>('auditor');
const designados = ref<{ usuario: number; papel: 'auditor' | 'observador' }[]>([]);
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('enfermagem.auditoriaChecagem.semUnidade') },
  ...(apoio.data.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.descricao })),
]);
const opcoesUsuario = computed(() =>
  (apoio.data.value?.usuarios ?? [])
    .filter((u) => !designados.value.some((d) => d.usuario === u.id))
    .map((u) => ({ valor: u.id as number | null, rotulo: `${u.nome} (${u.login})` })),
);
const opcoesPapel = computed(() =>
  (['auditor', 'observador'] as const).map((p) => ({
    valor: p,
    rotulo: t(`enfermagem.auditoriaChecagem.${p}`),
  })),
);
const nomeUsuario = (id: number) => {
  const u = apoio.data.value?.usuarios.find((x) => x.id === id);
  return u ? `${u.nome} (${u.login})` : String(id);
};
const periodoInvalido = computed(() => inicio.value !== '' && fim.value !== '' && fim.value <= inicio.value);
const podeSortear = computed(
  () =>
    inicio.value !== '' &&
    fim.value !== '' &&
    !periodoInvalido.value &&
    Number.isInteger(tamanho.value) &&
    tamanho.value >= 1 &&
    tamanho.value <= 200 &&
    (atendimento.value === '' || /^\d+$/.test(atendimento.value)) &&
    !ocupado.value,
);
function novaAuditoria(): void {
  inicio.value = '';
  fim.value = '';
  unidade.value = '';
  atendimento.value = '';
  tamanho.value = 20;
  criterio.value = '';
  observacao.value = '';
  designados.value = [];
  auditorEscolhido.value = null;
  papelEscolhido.value = 'auditor';
  erro.value = null;
  dialogoNova.value = true;
}
function incluirAuditor(): void {
  if (auditorEscolhido.value === null) return;
  designados.value = [...designados.value, { usuario: auditorEscolhido.value, papel: papelEscolhido.value }];
  auditorEscolhido.value = null;
}
async function sortear(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await abrirAuditoria({
      inicio: inicio.value,
      fim: fim.value,
      unidade: unidade.value || null,
      atendimento: atendimento.value ? Number(atendimento.value) : null,
      tamanho: tamanho.value,
      criterio: criterio.value.trim() || null,
      auditores: designados.value,
      observacao: observacao.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    dialogoNova.value = false;
    await lista.refetch();
    selecionado.value = r.id;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// Detalhe
const selecionado = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['enfermagem', 'auditoria-checagem', 'detalhe', selecionado.value]),
  queryFn: () => lerAuditoria(selecionado.value!),
  enabled: computed(() => selecionado.value !== null),
});
const aud = computed(() => (selecionado.value !== null ? (detalhe.data.value ?? null) : null));
const encerrada = computed(() => aud.value?.situacao === 'concluida' || aud.value?.situacao === 'cancelada');
const totais = computed(() => totaisDaAuditoria((aud.value?.itens ?? []).map((i) => i.resultado)));
const taxa = computed(() => (totais.value.taxa === null ? '—' : Math.round(totais.value.taxa * 100)));

// Avaliação
const dialogoAvaliar = ref(false);
const avaliando = ref<ItemAuditoria | null>(null);
const resultado = ref<Exclude<ResultadoItem, 'pendente'>>('conforme');
const motivo = ref<number | null>(null);
const justificativa = ref('');
const opcoesResultado = computed(() =>
  (['conforme', 'nao_conforme', 'nao_aplicavel'] as const).map((r) => ({
    valor: r,
    rotulo: t(`enfermagem.auditoriaChecagem.resultados.${r}`),
  })),
);
const opcoesMotivo = computed(() => [
  { valor: null as number | null, rotulo: '—' },
  ...(apoio.data.value?.motivos ?? []).map((m) => ({ valor: m.id as number | null, rotulo: m.descricao })),
]);
const problemaAvaliacao = computed(() =>
  aud.value
    ? conferirAvaliacao({
        situacao: aud.value.situacao,
        resultado: resultado.value,
        motivo: resultado.value === 'nao_conforme' ? motivo.value : null,
        motivoExigeComplemento: false,
        justificativa: justificativa.value,
      })
    : null,
);
function abrirAvaliacao(i: ItemAuditoria): void {
  avaliando.value = i;
  resultado.value = i.resultado === 'pendente' ? 'conforme' : i.resultado;
  motivo.value = i.motivo;
  justificativa.value = i.justificativa ?? '';
  erro.value = null;
  dialogoAvaliar.value = true;
}
async function gravarAvaliacao(): Promise<void> {
  const i = avaliando.value;
  if (!i || !aud.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await avaliarItem(aud.value.id, i.id, {
      resultado: resultado.value,
      motivo: resultado.value === 'nao_conforme' ? motivo.value : null,
      justificativa: justificativa.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    dialogoAvaliar.value = false;
    await Promise.all([detalhe.refetch(), lista.refetch()]);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function concluir(): Promise<void> {
  if (!aud.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await concluirAuditoria(aud.value.id);
    mensagem.value = r.mensagem;
    await Promise.all([detalhe.refetch(), lista.refetch()]);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const dialogoCancelar = ref(false);
const motivoCancelamento = ref('');
async function cancelar(): Promise<void> {
  if (!aud.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await cancelarAuditoria(aud.value.id, motivoCancelamento.value.trim());
    mensagem.value = r.mensagem;
    dialogoCancelar.value = false;
    await Promise.all([detalhe.refetch(), lista.refetch()]);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
function recorte(a: { unidade: string | null; atendimento: number | null }): string {
  if (a.atendimento !== null)
    return t('enfermagem.auditoriaChecagem.recorteAtendimento', { atendimento: a.atendimento });
  if (a.unidade) return t('enfermagem.auditoriaChecagem.recorteUnidade', { unidade: a.unidade });
  return t('enfermagem.auditoriaChecagem.recorteEstabelecimento');
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="ac-titulo" data-testid="tela-auditoria-checagem">
    <h1 id="ac-titulo">{{ t('enfermagem.auditoriaChecagem.titulo') }}</h1>
    <p>{{ t('enfermagem.auditoriaChecagem.texto') }}</p>
    <p class="secundario">{{ t('enfermagem.auditoriaChecagem.base') }}</p>
    <div class="barra">
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('enfermagem.auditoriaChecagem.filtro')"
        :opcoes="opcoesFiltro"
        data-testid="ac-filtro"
      />
      <SanteBotao
        v-if="podeAuditar"
        :rotulo="t('enfermagem.auditoriaChecagem.nova')"
        data-testid="ac-nova"
        @acionar="novaAuditoria"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="ac-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="lista.error.value" :erro="lista.error.value" />
    <section v-else class="cartao" aria-labelledby="ac-lista">
      <h2 id="ac-lista" class="sr-only">{{ t('enfermagem.auditoriaChecagem.titulo') }}</h2>
      <p v-if="auditorias.length === 0" data-testid="ac-vazio">
        {{ t('enfermagem.auditoriaChecagem.vazio') }}
      </p>
      <ul v-else>
        <li v-for="a in auditorias" :key="a.id" class="linha" :data-testid="`ac-auditoria-${a.id}`">
          <span>
            {{
              t('enfermagem.auditoriaChecagem.linha', {
                id: a.id,
                inicio: hora(a.inicio),
                fim: hora(a.fim),
                recorte: recorte(a),
                avaliados: a.avaliados,
                tamanho: a.tamanho,
                situacao: t(`enfermagem.auditoriaChecagem.situacoes.${a.situacao}`),
              })
            }}
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.auditoriaChecagem.abrir')"
            :data-testid="`ac-abrir-${a.id}`"
            @acionar="selecionado = a.id"
          />
        </li>
      </ul>
    </section>

    <section v-if="aud" class="cartao" aria-labelledby="ac-detalhe" data-testid="ac-detalhe">
      <h2 id="ac-detalhe">{{ t('enfermagem.auditoriaChecagem.detalhe', { id: aud.id }) }}</h2>
      <p>
        {{ hora(aud.inicio) }} — {{ hora(aud.fim) }} · {{ recorte(aud) }} ·
        {{ t(`enfermagem.auditoriaChecagem.situacoes.${aud.situacao}`) }}
      </p>
      <p>{{ t('enfermagem.auditoriaChecagem.responsavel', { login: aud.responsavel }) }}</p>
      <p v-if="aud.criterio" class="secundario">
        {{ t('enfermagem.auditoriaChecagem.criterioGravado', { criterio: aud.criterio }) }}
      </p>
      <h3>{{ t('enfermagem.auditoriaChecagem.auditores') }}</h3>
      <ul data-testid="ac-auditores">
        <li v-for="x in aud.auditores" :key="x.usuario">
          {{ x.nome }} ({{ x.login }}) · {{ t(`enfermagem.auditoriaChecagem.papeis.${x.papel}`) }}
        </li>
      </ul>
      <h3>{{ t('enfermagem.auditoriaChecagem.amostra') }}</h3>
      <ul data-testid="ac-amostra">
        <li v-for="i in aud.itens" :key="i.id" class="linha" :data-testid="`ac-item-${i.id}`">
          <span>
            {{
              t('enfermagem.auditoriaChecagem.item', {
                seq: i.sequencia,
                paciente: i.paciente,
                atendimento: i.atendimento,
                previsto: hora(i.previsto),
                situacao: i.situacaoChecagem,
                por: i.checadoPor ? t('enfermagem.auditoriaChecagem.checadoPor', { nome: i.checadoPor }) : '',
              })
            }}
            · <strong>{{ t(`enfermagem.auditoriaChecagem.resultados.${i.resultado}`) }}</strong>
            <template v-if="i.motivoDescricao"> · {{ i.motivoDescricao }}</template>
            <template v-if="i.justificativa"> · {{ i.justificativa }}</template>
          </span>
          <SanteBotao
            v-if="podeAuditar && !encerrada"
            variante="secundario"
            :rotulo="t('enfermagem.auditoriaChecagem.avaliar')"
            :data-testid="`ac-avaliar-${i.id}`"
            @acionar="abrirAvaliacao(i)"
          />
        </li>
      </ul>
      <p data-testid="ac-totais">
        {{
          t('enfermagem.auditoriaChecagem.totais', {
            conformes: aud.totalConforme ?? totais.conformes,
            auditados: aud.totalAuditado ?? totais.avaliados,
            taxa,
            resultado: aud.resultado
              ? t(`enfermagem.auditoriaChecagem.resultadoFinal.${aud.resultado}`)
              : '—',
          })
        }}
      </p>
      <p v-if="!encerrada && totais.pendentes > 0" class="secundario" data-testid="ac-faltam">
        {{ t('enfermagem.auditoriaChecagem.faltam', { n: totais.pendentes }) }}
      </p>
      <ErroEnfermagem v-if="erro && !dialogoAvaliar && !dialogoCancelar && !dialogoNova" :erro="erro" />
      <div v-if="podeAuditar && !encerrada" class="barra">
        <SanteBotao
          :rotulo="t('enfermagem.auditoriaChecagem.concluir')"
          :desabilitado="totais.pendentes > 0 || ocupado"
          data-testid="ac-concluir"
          @acionar="concluir"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('enfermagem.auditoriaChecagem.cancelar')"
          data-testid="ac-cancelar"
          @acionar="
            () => {
              motivoCancelamento = '';
              erro = null;
              dialogoCancelar = true;
            }
          "
        />
      </div>
    </section>

    <SanteDialogo v-model:visivel="dialogoNova" :titulo="t('enfermagem.auditoriaChecagem.nova')">
      <div class="campos-coluna" data-testid="ac-dialogo-nova">
        <span class="campo">
          <label for="ac-inicio">{{ t('enfermagem.auditoriaChecagem.inicio') }}</label>
          <input id="ac-inicio" v-model="inicio" type="datetime-local" data-testid="ac-inicio" />
        </span>
        <span class="campo">
          <label for="ac-fim">{{ t('enfermagem.auditoriaChecagem.fim') }}</label>
          <input id="ac-fim" v-model="fim" type="datetime-local" data-testid="ac-fim" />
        </span>
        <p v-if="periodoInvalido" role="alert" data-testid="ac-periodo-invalido">
          {{ t('enfermagem.auditoriaChecagem.periodoInvalido') }}
        </p>
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('enfermagem.auditoriaChecagem.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="ac-unidade"
        />
        <span class="campo">
          <label for="ac-atendimento">{{ t('enfermagem.auditoriaChecagem.atendimento') }}</label>
          <input
            id="ac-atendimento"
            v-model="atendimento"
            inputmode="numeric"
            maxlength="12"
            data-testid="ac-atendimento"
          />
        </span>
        <span class="campo">
          <label for="ac-tamanho">{{ t('enfermagem.auditoriaChecagem.tamanho') }}</label>
          <input
            id="ac-tamanho"
            v-model.number="tamanho"
            type="number"
            min="1"
            max="200"
            data-testid="ac-tamanho"
          />
          <small class="secundario">{{ t('enfermagem.auditoriaChecagem.tamanhoAjuda') }}</small>
        </span>
        <span class="campo">
          <label for="ac-criterio">{{ t('enfermagem.auditoriaChecagem.criterio') }}</label>
          <input id="ac-criterio" v-model="criterio" maxlength="300" data-testid="ac-criterio" />
        </span>
        <fieldset class="campos-coluna">
          <legend>{{ t('enfermagem.auditoriaChecagem.auditores') }}</legend>
          <p v-if="designados.length === 0" class="secundario">
            {{ t('enfermagem.auditoriaChecagem.semAuditores') }}
          </p>
          <ul v-else data-testid="ac-designados">
            <li v-for="d in designados" :key="d.usuario" class="linha">
              {{ nomeUsuario(d.usuario) }} · {{ t(`enfermagem.auditoriaChecagem.${d.papel}`) }}
              <SanteBotao
                variante="secundario"
                :rotulo="t('enfermagem.auditoriaChecagem.remover')"
                @acionar="designados = designados.filter((x) => x.usuario !== d.usuario)"
              />
            </li>
          </ul>
          <div class="barra">
            <SanteSelecao
              v-model="auditorEscolhido"
              :rotulo="t('enfermagem.auditoriaChecagem.auditor')"
              :opcoes="opcoesUsuario"
              data-testid="ac-auditor"
            />
            <SanteSelecao
              v-model="papelEscolhido"
              :rotulo="t('enfermagem.auditoriaChecagem.papeis.auditor')"
              :opcoes="opcoesPapel"
              data-testid="ac-papel"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.auditoriaChecagem.incluirAuditor')"
              :desabilitado="auditorEscolhido === null"
              data-testid="ac-incluir-auditor"
              @acionar="incluirAuditor"
            />
          </div>
        </fieldset>
        <span class="campo">
          <label for="ac-observacao">{{ t('enfermagem.auditoriaChecagem.observacao') }}</label>
          <textarea id="ac-observacao" v-model="observacao" maxlength="2000" data-testid="ac-observacao" />
        </span>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.auditoriaChecagem.sortear')"
          :desabilitado="!podeSortear"
          data-testid="ac-sortear"
          @acionar="sortear"
        />
      </div>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoAvaliar" :titulo="t('enfermagem.auditoriaChecagem.avaliacao')">
      <div class="campos-coluna" data-testid="ac-dialogo-avaliar">
        <p v-if="avaliando">
          {{ avaliando.sequencia }}. {{ avaliando.paciente }} · {{ hora(avaliando.previsto) }}
        </p>
        <SanteSelecao
          v-model="resultado"
          :rotulo="t('enfermagem.auditoriaChecagem.avaliacao')"
          :opcoes="opcoesResultado"
          data-testid="ac-resultado"
        />
        <SanteSelecao
          v-if="resultado === 'nao_conforme'"
          v-model="motivo"
          :rotulo="t('enfermagem.auditoriaChecagem.motivo')"
          :opcoes="opcoesMotivo"
          data-testid="ac-motivo"
        />
        <span v-if="resultado !== 'conforme'" class="campo">
          <label for="ac-justificativa">{{ t('enfermagem.auditoriaChecagem.justificativa') }}</label>
          <textarea
            id="ac-justificativa"
            v-model="justificativa"
            maxlength="2000"
            data-testid="ac-justificativa"
          />
          <small class="secundario">
            {{ t('enfermagem.auditoriaChecagem.justificativaAjuda') }} ({{ justificativa.trim().length }}/{{
              MINIMO
            }})
          </small>
        </span>
        <p v-if="problemaAvaliacao" role="alert" data-testid="ac-problema">
          {{ problemaAvaliacao.mensagem }}
        </p>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.auditoriaChecagem.gravar')"
          :desabilitado="problemaAvaliacao !== null || ocupado"
          data-testid="ac-gravar"
          @acionar="gravarAvaliacao"
        />
      </div>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoCancelar" :titulo="t('enfermagem.auditoriaChecagem.cancelar')">
      <div class="campos-coluna" data-testid="ac-dialogo-cancelar">
        <span class="campo">
          <label for="ac-motivo-cancelamento">{{
            t('enfermagem.auditoriaChecagem.motivoCancelamento')
          }}</label>
          <input
            id="ac-motivo-cancelamento"
            v-model="motivoCancelamento"
            maxlength="500"
            data-testid="ac-motivo-cancelamento"
          />
        </span>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.auditoriaChecagem.confirmarCancelamento')"
          :desabilitado="motivoCancelamento.trim().length === 0 || ocupado"
          data-testid="ac-confirmar-cancelamento"
          @acionar="cancelar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos-coluna {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-1);
}
fieldset {
  border: none;
  padding: 0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
