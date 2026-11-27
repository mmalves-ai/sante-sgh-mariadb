<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Guias do convênio no hospital (F3.7, 06-FAT linha 24): `/faturamento/guias-convenio`.
// A fila mostra as guias abertas (pendentes primeiro, com a contagem de pendências, o responsável e a marca da
// cirurgia); ao escolher uma, o painel ao lado reúne a resposta da operadora (número, senha, validade, dias), as
// pendências (abrir e resolver), os anexos e a linha do tempo, sem trocar de tela. A validação é a do domínio.
import {
  TIPOS_ANEXO_GUIA,
  validarAnexoGuia,
  validarPendenciaGuia,
  validarRespostaGuia,
} from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  abrirPendenciaGuia,
  anexarGuia,
  assumirGuia,
  lerGuia,
  lerGuiasConvenio,
  resolverPendenciaGuia,
  responderGuia,
} from '../api-auditoria-tramite.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t } = useI18n();
const qc = useQueryClient();
/** As cinco gravações da guia (assumir, responder, pendência, resolução, anexo) pedem esta permissão no servidor;
 * quem só consulta (faturamento.guia.ler) vê a fila e o painel, sem as ações. */
const podeEditar = computed(() => pode('faturamento.pendencia.editar'));
const situacao = ref<string | null>(null);
const minhas = ref(false);
const cirurgia = ref(false);
const fila = useQuery({
  queryKey: ['faturamento', 'guias-convenio', situacao, minhas, cirurgia],
  queryFn: () => lerGuiasConvenio(situacao.value, minhas.value, cirurgia.value),
});
const dia = (v: string | null) => (v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');
/** O prazo já passou ou a senha já venceu: a linha pede atenção. */
const vencido = (v: string | null) => !!v && v.slice(0, 10) < new Date().toISOString().slice(0, 10);
const escolhida = ref<number | null>(null);
const guia = useQuery({
  queryKey: ['faturamento', 'guia-convenio', escolhida],
  queryFn: () => lerGuia(escolhida.value!),
  enabled: computed(() => escolhida.value !== null),
});
const erro = ref<unknown>(null);
const aviso = ref('');
const chave = () => crypto.randomUUID();
const dataHora = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
async function rodar(fn: () => Promise<unknown>) {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = t('auditoriaTramite.feito');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'guias-convenio'] });
    await qc.invalidateQueries({ queryKey: ['faturamento', 'guia-convenio'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
const SITUACOES = [
  'pendente',
  'em_analise',
  'solicitada',
  'autorizada',
  'autorizada_parcial',
  'negada',
] as const;
const RESPOSTAS = ['em_analise', 'autorizada', 'autorizada_parcial', 'negada'] as const;
const hoje = () => new Date().toISOString().slice(0, 10);

// ── Resposta da operadora ──
const resposta = reactive({
  resposta: 'autorizada' as (typeof RESPOSTAS)[number],
  numeroOperadora: '',
  senha: '',
  validadeSenha: '',
  diasAutorizados: null as number | null,
  motivoNegacao: '',
});
const errosResposta = computed(() => {
  const g = guia.data.value;
  if (!g) return {};
  return validarRespostaGuia({
    situacaoAtual: g.situacao,
    resposta: resposta.resposta,
    senha: resposta.senha,
    validadeSenha: resposta.validadeSenha || null,
    diasSolicitados: g.diasSolicitados,
    diasAutorizados: resposta.diasAutorizados,
    motivoNegacao: resposta.motivoNegacao,
    pendenciasAbertas: g.pendencias.filter((p) => p.situacao === 'aberta' || p.situacao === 'em_tratamento')
      .length,
    hoje: hoje(),
  });
});
const responder = () =>
  rodar(() =>
    responderGuia(
      escolhida.value!,
      {
        resposta: resposta.resposta,
        numeroOperadora: resposta.numeroOperadora || null,
        senha: resposta.senha || null,
        validadeSenha: resposta.validadeSenha || null,
        diasAutorizados: resposta.diasAutorizados,
        motivoNegacao: resposta.motivoNegacao || null,
      },
      chave(),
    ),
  );

// ── Pendência ──
const pendencia = reactive({ motivoId: null as number | null, descricao: '', prazo: '' });
const errosPendencia = computed(() =>
  guia.data.value
    ? validarPendenciaGuia({
        situacaoAtual: guia.data.value.situacao,
        motivoId: pendencia.motivoId,
        prazo: pendencia.prazo ? new Date(pendencia.prazo).toISOString() : null,
        agora: new Date().toISOString(),
      })
    : {},
);
const abrirPendencia = () =>
  rodar(() =>
    abrirPendenciaGuia(
      escolhida.value!,
      {
        motivoId: pendencia.motivoId,
        descricao: pendencia.descricao || null,
        prazo: pendencia.prazo ? new Date(pendencia.prazo).toISOString() : null,
      },
      chave(),
    ),
  );
const solucoes = ref<Record<number, string>>({});

// ── Anexo ──
const anexo = reactive({ tipoDocumento: 'laudo', descricao: '', arquivo: null as File | null });
const errosAnexo = computed(() =>
  anexo.arquivo && guia.data.value
    ? validarAnexoGuia({
        situacaoGuia: guia.data.value.situacao,
        tipoDocumento: anexo.tipoDocumento,
        tipoMime: anexo.arquivo.type,
        tamanhoBytes: anexo.arquivo.size,
      })
    : {},
);
function escolherArquivo(e: Event) {
  anexo.arquivo = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function anexar() {
  const f = anexo.arquivo;
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await rodar(() =>
    anexarGuia(
      escolhida.value!,
      {
        tipoDocumento: anexo.tipoDocumento,
        descricao: anexo.descricao || null,
        nomeOriginal: f.name,
        tipoMime: f.type,
        conteudo: btoa(bin),
      },
      chave(),
    ),
  );
}
</script>

<template>
  <section class="tela" data-testid="guias-convenio">
    <h1>{{ t('auditoriaTramite.guia.titulo') }}</h1>
    <ErroFaturamento v-if="fila.error.value" :erro="fila.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="gc-aviso">{{ aviso }}</p>
    <div class="filtros">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('auditoriaTramite.guia.filtro')"
        :opcoes="[
          { valor: null, rotulo: t('auditoriaTramite.guia.abertas') },
          ...SITUACOES.map((x) => ({ valor: x, rotulo: t(`auditoriaTramite.guia.situacoes.${x}`) })),
        ]"
        data-testid="gc-situacao"
      />
      <label><input v-model="minhas" type="checkbox" /> {{ t('auditoriaTramite.guia.minhas') }}</label>
      <label
        ><input v-model="cirurgia" type="checkbox" data-testid="gc-fila-cirurgia" />
        {{ t('auditoriaTramite.guia.filaCirurgia') }}</label
      >
    </div>
    <p v-if="fila.data.value && !fila.data.value.length" class="secundario">
      {{ t('auditoriaTramite.guia.vazio') }}
    </p>
    <table v-if="fila.data.value?.length">
      <thead>
        <tr>
          <th>{{ t('auditoriaTramite.guia.paciente') }}</th>
          <th>{{ t('auditoriaTramite.guia.numero') }}</th>
          <th>{{ t('auditoriaTramite.guia.fonte') }}</th>
          <th>{{ t('auditoriaTramite.situacao') }}</th>
          <th>{{ t('auditoriaTramite.guia.pendencias') }}</th>
          <th>
            {{ t(cirurgia ? 'auditoriaTramite.guia.cirurgiaPrevista' : 'auditoriaTramite.guia.prazo') }}
          </th>
          <th>{{ t('auditoriaTramite.guia.validadeSenha') }}</th>
          <th>{{ t('auditoriaTramite.guia.responsavel') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="g in fila.data.value"
          :key="g.id"
          :data-testid="`gc-${g.numero}`"
          :aria-selected="escolhida === g.id"
          @click="escolhida = g.id"
        >
          <td>
            <template v-if="g.paciente !== null">{{ g.paciente }}</template>
            <em v-else class="secundario" data-testid="guia-sem-paciente">{{
              t('auditoriaTramite.guia.pacienteNaoRegistrado')
            }}</em>
            <span v-if="g.prontuario !== null" class="secundario"
              >· {{ t('auditoriaTramite.guia.prontuario', { n: g.prontuario }) }}</span
            >
            <RouterLink
              v-if="g.contaId"
              :to="`/faturamento/contas/${g.contaId}`"
              :data-testid="`gc-conta-${g.numero}`"
              @click.stop
              >{{ t('auditoriaTramite.guia.abrirConta') }}</RouterLink
            >
          </td>
          <td>
            {{ g.numero }}<span v-if="g.numeroOperadora" class="secundario"> · {{ g.numeroOperadora }}</span>
            <span v-if="g.cirurgia" class="secundario"> · {{ t('auditoriaTramite.guia.cirurgia') }}</span>
          </td>
          <td>{{ g.fonte }}</td>
          <td>{{ t(`auditoriaTramite.guia.situacoes.${g.situacao}`) }}</td>
          <td>{{ g.pendencias }}</td>
          <td v-if="cirurgia">{{ dataHora(g.cirurgiaPrevista) }}</td>
          <td v-else :class="{ alerta: vencido(g.prazoPendencia) }">{{ dataHora(g.prazoPendencia) }}</td>
          <td :class="{ alerta: vencido(g.validadeSenha) }">{{ dia(g.validadeSenha) }}</td>
          <td>{{ g.responsavel ?? t('auditoriaTramite.guia.semResponsavel') }}</td>
        </tr>
      </tbody>
    </table>

    <aside v-if="guia.data.value" data-testid="gc-painel">
      <h2>
        {{ guia.data.value.numero }} · {{ guia.data.value.fonte }} ·
        {{ t(`auditoriaTramite.guia.situacoes.${guia.data.value.situacao}`) }}
      </h2>
      <p>
        {{ t('auditoriaTramite.guia.responsavel') }}:
        {{ guia.data.value.responsavel ?? t('auditoriaTramite.guia.semResponsavel') }}
        <button
          v-if="podeEditar"
          type="button"
          data-testid="gc-assumir"
          @click="rodar(() => assumirGuia(escolhida!, chave()))"
        >
          {{ t('auditoriaTramite.guia.assumir') }}
        </button>
      </p>
      <p v-if="guia.data.value.senha">
        {{ t('auditoriaTramite.guia.senha') }}: {{ guia.data.value.senha }}
        <span v-if="guia.data.value.validadeSenha"> · {{ guia.data.value.validadeSenha }}</span>
      </p>

      <p v-if="!podeEditar" class="secundario" data-testid="gc-somente-consulta">
        {{ t('auditoriaTramite.guia.somenteConsulta') }}
      </p>
      <form v-if="podeEditar" class="filtros" data-testid="gc-form-resposta" @submit.prevent="responder">
        <h3>{{ t('auditoriaTramite.guia.resposta') }}</h3>
        <SanteSelecao
          v-model="resposta.resposta"
          :rotulo="t('auditoriaTramite.guia.resposta')"
          ocultar-rotulo
          :opcoes="[
            ...RESPOSTAS.map((x) => ({ valor: x, rotulo: t(`auditoriaTramite.guia.respostas.${x}`) })),
          ]"
          data-testid="gc-resposta"
        />
        <label>
          {{ t('auditoriaTramite.guia.operadora') }}
          <input v-model="resposta.numeroOperadora" maxlength="20" />
        </label>
        <template v-if="resposta.resposta === 'autorizada' || resposta.resposta === 'autorizada_parcial'">
          <label>
            {{ t('auditoriaTramite.guia.senha') }}
            <input v-model="resposta.senha" maxlength="20" data-testid="gc-senha" />
          </label>
          <label>
            {{ t('auditoriaTramite.guia.validadeSenha') }}
            <input v-model="resposta.validadeSenha" type="date" />
          </label>
          <label v-if="guia.data.value.diasSolicitados !== null">
            {{ t('auditoriaTramite.guia.diasAutorizados', { n: guia.data.value.diasSolicitados }) }}
            <input v-model.number="resposta.diasAutorizados" type="number" min="0" />
          </label>
        </template>
        <label v-if="resposta.resposta === 'negada'">
          {{ t('auditoriaTramite.guia.motivoNegacao') }}
          <input v-model="resposta.motivoNegacao" maxlength="500" />
        </label>
        <p v-for="(m, k) in errosResposta" :key="k" role="alert">{{ m }}</p>
        <button type="submit" :disabled="Object.keys(errosResposta).length > 0" data-testid="gc-responder">
          {{ t('auditoriaTramite.guia.registrar') }}
        </button>
      </form>

      <h3>{{ t('auditoriaTramite.guia.pendencias') }}</h3>
      <ul>
        <li v-for="p in guia.data.value.pendencias" :key="p.id" :data-testid="`gc-pend-${p.sequencia}`">
          {{ p.motivo }}<span v-if="p.descricao"> · {{ p.descricao }}</span> · {{ dataHora(p.abertaEm) }}
          <template v-if="p.situacao === 'aberta' || p.situacao === 'em_tratamento'">
            <template v-if="podeEditar">
              <input
                v-model="solucoes[p.id]"
                :placeholder="t('auditoriaTramite.guia.solucao')"
                :aria-label="t('auditoriaTramite.guia.solucao')"
                maxlength="500"
              />
              <button
                type="button"
                :disabled="(solucoes[p.id] ?? '').trim().length < 3"
                @click="rodar(() => resolverPendenciaGuia(p.id, solucoes[p.id]!, chave()))"
              >
                {{ t('auditoriaTramite.guia.resolver') }}
              </button>
            </template>
          </template>
          <span v-else class="secundario"> · {{ p.solucao }} ({{ p.resolvidoPor }})</span>
        </li>
      </ul>
      <form
        v-if="podeEditar"
        class="filtros"
        data-testid="gc-form-pendencia"
        @submit.prevent="abrirPendencia"
      >
        <SanteSelecao
          v-model="pendencia.motivoId"
          :rotulo="t('auditoriaTramite.motivo')"
          ocultar-rotulo
          :opcoes="[...guia.data.value.motivosPendencia.map((m) => ({ valor: m.id, rotulo: m.descricao }))]"
          data-testid="gc-motivo"
        />
        <input
          v-model="pendencia.descricao"
          maxlength="500"
          :placeholder="t('auditoriaTramite.motivo')"
          :aria-label="t('auditoriaTramite.guia.descricaoPendencia')"
        />
        <label>
          {{ t('auditoriaTramite.guia.prazo') }}
          <input v-model="pendencia.prazo" type="datetime-local" />
        </label>
        <p v-for="(m, k) in errosPendencia" :key="k" role="alert">{{ m }}</p>
        <button
          type="submit"
          :disabled="Object.keys(errosPendencia).length > 0"
          data-testid="gc-abrir-pendencia"
        >
          {{ t('auditoriaTramite.guia.novaPendencia') }}
        </button>
      </form>

      <h3>{{ t('auditoriaTramite.guia.anexos') }}</h3>
      <ul>
        <li v-for="a in guia.data.value.anexos" :key="a.id">
          {{ t(`auditoriaTramite.guia.tiposAnexo.${a.tipo}`) }} · {{ a.nome }} · {{ dataHora(a.em) }}
        </li>
      </ul>
      <form v-if="podeEditar" class="filtros" data-testid="gc-form-anexo" @submit.prevent="anexar">
        <SanteSelecao
          v-model="anexo.tipoDocumento"
          :rotulo="t('auditoriaTramite.guia.tipoDocumento')"
          ocultar-rotulo
          :opcoes="[
            ...TIPOS_ANEXO_GUIA.map((x) => ({
              valor: x,
              rotulo: t(`auditoriaTramite.guia.tiposAnexo.${x}`),
            })),
          ]"
        />
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          :aria-label="t('auditoriaTramite.guia.arquivoAnexo')"
          @change="escolherArquivo"
        />
        <p v-for="(m, k) in errosAnexo" :key="k" role="alert">{{ m }}</p>
        <button type="submit" :disabled="!anexo.arquivo || Object.keys(errosAnexo).length > 0">
          {{ t('auditoriaTramite.guia.anexar') }}
        </button>
      </form>

      <h3>{{ t('auditoriaTramite.guia.historico') }}</h3>
      <ol data-testid="gc-historico">
        <li v-for="h in guia.data.value.historico" :key="h.id">
          {{ dataHora(h.em) }} · {{ t(`auditoriaTramite.guia.eventos.${h.evento}`) }}
          <span v-if="h.de && h.para && h.de !== h.para">
            {{ '·' }} {{ t(`auditoriaTramite.guia.situacoes.${h.de}`) }} {{ '→' }}
            {{ t(`auditoriaTramite.guia.situacoes.${h.para}`) }}
          </span>
          <span v-if="h.observacao"> · {{ h.observacao }}</span>
          <span v-if="h.usuario" class="secundario"> · {{ h.usuario }}</span>
        </li>
      </ol>
    </aside>
  </section>
</template>

<style scoped>
.alerta {
  color: var(--sgh-alerta);
  font-weight: 600;
}
</style>
