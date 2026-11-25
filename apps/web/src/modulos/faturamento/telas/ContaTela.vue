<script setup lang="ts">
// A conta do paciente (ficha do M30, seção 7): `/faturamento/contas/:id`. Abas: resumo (situação derivada, totais e o
// pré-voo do fechamento), beneficiário (CPF mascarado), guias, parciais, pendências e etapas. Ações: fechar (vetos e
// pré-voo, regra 4), reabrir (supervisor, motivo; nunca a apresentada), iniciar e concluir a conferência, registrar e
// resolver pendência. O preço e o total são os do banco.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  fecharConta,
  lerConta,
  lerTiposPendencia,
  novaChave,
  reabrirConta,
  registrarEtapa,
  registrarPendencia,
  resolverPendencia,
} from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { competenciaTexto, data, quando, reais, usarFaturamento } from '../usar-faturamento.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade } = usarFaturamento();
const id = computed(() => Number(props.id));
const c = useQuery({
  queryKey: computed(() => ['faturamento', 'conta', id.value]),
  queryFn: () => lerConta(id.value),
});
const tipos = useQuery({
  queryKey: ['faturamento', 'tipos'],
  queryFn: () => lerTiposPendencia(),
  staleTime: 300_000,
});
const aba = ref<'resumo' | 'beneficiario' | 'guias' | 'parciais' | 'pendencias' | 'etapas'>('resumo');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const motivo = ref('');
const nova = ref({ tipo: 0, descricao: '', bloqueante: true });
const opcoesTipoPendencia = computed(() => [
  { valor: 0, rotulo: t('faturamento.conta.tipoOutro') },
  ...(tipos.data.value?.tipos ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);
const resolucao = ref<Record<number, string>>({});
const ocupado = ref(false);

async function agir(fn: () => Promise<{ mensagem: string; avisos: string[] }>) {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const fechar = () => agir(() => fecharConta(id.value, c.data.value!.versao, novaChave('fechar')));
const reabrir = () =>
  agir(() => reabrirConta(id.value, c.data.value!.versao, motivo.value, novaChave('reabrir')));
const etapa = (acao: 'iniciar' | 'concluir') =>
  agir(() => registrarEtapa(id.value, { etapa: 'conferencia', acao }, novaChave('etapa')));
const pendencia = () => agir(() => registrarPendencia(id.value, { ...nova.value }, novaChave('pendencia')));
const resolver = (p: number) =>
  agir(() => resolverPendencia(p, resolucao.value[p] ?? '', novaChave('resolver')));
const emConferencia = computed(
  () => c.data.value?.etapas.some((e) => e.etapa === 'conferencia' && e.situacao === 'em-andamento') ?? false,
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cta-titulo" data-testid="tela-faturamento-conta">
    <ErroFaturamento v-if="c.error.value" :erro="c.error.value" />
    <p v-else-if="!c.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <h1 id="cta-titulo">{{ t('faturamento.conta.titulo', { id }) }} · {{ c.data.value.paciente }}</h1>
      <p data-testid="cta-situacao">
        <strong>{{ c.data.value.situacaoRotulo }}</strong>
        <span v-if="c.data.value.inferida" class="secundario"> — {{ t('faturamento.inferida') }}</span>
      </p>
      <p class="secundario">
        {{ t('faturamento.regua') }} {{ competenciaTexto(c.data.value.ano, c.data.value.mes) }}
      </p>
      <nav class="filtros" :aria-label="t('faturamento.conta.abas')">
        <RouterLink :to="`/faturamento/contas/${id}/lancamentos`" data-testid="cta-lancamentos">{{
          t('faturamento.conta.lancamentos')
        }}</RouterLink>
        <RouterLink :to="`/faturamento/contas/${id}/complementos`" data-testid="cta-complementos">{{
          t('faturamento.conta.complementos')
        }}</RouterLink>
        <RouterLink :to="`/faturamento/contas/${id}/ajustes`" data-testid="cta-ajustes">{{
          t('faturamento.conta.ajustes')
        }}</RouterLink>
        <RouterLink
          :to="`/faturamento/servicos-acessorios?conta=${id}`"
          data-testid="cta-servicos-acessorios"
          >{{ t('faturamento.conta.servicosAcessorios') }}</RouterLink
        >
        <RouterLink
          :to="`/faturamento/descontos-franquias?conta=${id}`"
          data-testid="cta-descontos-franquias"
          >{{ t('faturamento.conta.descontosFranquias') }}</RouterLink
        >
        <RouterLink :to="`/faturamento/contas/${id}/notas-fiscais`" data-testid="cta-notas-fiscais">{{
          t('faturamento.conta.notasFiscais')
        }}</RouterLink>
        <RouterLink :to="`/faturamento/contas/${id}/movimentos`" data-testid="cta-movimentos">{{
          t('movimentosConta.link')
        }}</RouterLink>
        <RouterLink :to="`/faturamento/contas/${id}/auditoria`" data-testid="cta-auditoria">{{
          t('faturamento.conta.auditoria')
        }}</RouterLink>
        <RouterLink :to="`/faturamento/contas/${id}/auditoria-itens`" data-testid="cta-auditoria-itens">{{
          t('auditoriaTramite.auditoria.link')
        }}</RouterLink>
        <RouterLink :to="`/faturamento/contas/${id}/sigtap`" data-testid="cta-sigtap">{{
          t('faturamento.conta.sigtap')
        }}</RouterLink>
      </nav>
      <div class="filtros" role="tablist">
        <button
          v-for="a in ['resumo', 'beneficiario', 'guias', 'parciais', 'pendencias', 'etapas'] as const"
          :key="a"
          type="button"
          role="tab"
          :aria-selected="aba === a"
          :data-testid="`cta-aba-${a}`"
          @click="aba = a"
        >
          {{ t(`faturamento.conta.${a === 'pendencias' ? 'abaPendencias' : a}`) }}
        </button>
      </div>
      <AvisoFaturamento :motivo="motivoFuncionalidade('contas')" />
      <ErroFaturamento v-if="erro" :erro="erro" />
      <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="cta-mensagem" />

      <div v-if="aba === 'resumo'" data-testid="cta-resumo">
        <dl class="resumo">
          <dt>{{ t('faturamento.convenio') }}</dt>
          <dd>{{ c.data.value.convenioNome || c.data.value.convenio }}</dd>
          <dt>{{ t('faturamento.total') }}</dt>
          <dd data-testid="cta-total">{{ reais(c.data.value.total) }}</dd>
          <dt>{{ t('faturamento.conta.somaItens') }}</dt>
          <dd>
            {{ reais(c.data.value.somaItens) }} ({{ c.data.value.itens }} {{ t('faturamento.conta.itens') }})
          </dd>
          <dt>{{ t('faturamento.pacote') }}</dt>
          <dd>{{ c.data.value.pacoteRotulo }}</dd>
          <dt>{{ t('faturamento.conta.remessa') }}</dt>
          <dd>{{ c.data.value.remessa || '—' }}</dd>
          <dt>{{ t('faturamento.conta.emissao') }}</dt>
          <dd>{{ data(c.data.value.dataEmissao) }}</dd>
          <dt>{{ t('faturamento.conta.fechamento') }}</dt>
          <dd>{{ data(c.data.value.dataFechamento) }} {{ c.data.value.usuarioFechamento }}</dd>
          <dt>{{ t('faturamento.conta.lotes') }}</dt>
          <dd>{{ c.data.value.lotesTiss }}</dd>
        </dl>
        <p v-for="a in c.data.value.avisos" :key="a" class="secundario">{{ a }}</p>
        <template v-if="c.data.value.fechada === 'N'">
          <p v-if="c.data.value.preVooFechamento" data-testid="cta-prevoo">
            {{ t('faturamento.conta.preVoo') }} {{ c.data.value.preVooFechamento.mensagem }}
          </p>
          <p v-else data-testid="cta-prevoo-ok">{{ t('faturamento.conta.podeFechar') }}</p>
          <div class="filtros">
            <button
              v-if="pode('faturamento.fecharConta')"
              type="button"
              :disabled="ocupado"
              data-testid="cta-fechar"
              @click="fechar"
            >
              {{ t('faturamento.conta.fechar') }}
            </button>
            <button
              v-if="pode('etapaConferencia') && !emConferencia"
              type="button"
              :disabled="ocupado"
              data-testid="cta-iniciar-conferencia"
              @click="etapa('iniciar')"
            >
              {{ t('faturamento.conta.iniciarConferencia') }}
            </button>
            <button
              v-if="pode('etapaConferencia') && emConferencia"
              type="button"
              :disabled="ocupado"
              data-testid="cta-concluir-conferencia"
              @click="etapa('concluir')"
            >
              {{ t('faturamento.conta.concluirConferencia') }}
            </button>
          </div>
        </template>
        <form v-else-if="pode('faturamento.reabrirConta')" class="filtros" @submit.prevent="reabrir">
          <span class="campo">
            <label for="cta-motivo">{{ t('faturamento.conta.motivoReabrir') }}</label>
            <input id="cta-motivo" v-model="motivo" maxlength="250" data-testid="cta-motivo" />
          </span>
          <button type="submit" :disabled="ocupado" data-testid="cta-reabrir">
            {{ t('faturamento.conta.reabrir') }}
          </button>
        </form>
      </div>

      <dl v-else-if="aba === 'beneficiario'" class="resumo" data-testid="cta-beneficiario">
        <dt>{{ t('faturamento.conta.matricula') }}</dt>
        <dd>{{ c.data.value.beneficiario.matricula || '—' }}</dd>
        <dt>{{ t('faturamento.conta.validade') }}</dt>
        <dd>{{ data(c.data.value.beneficiario.validadeCarteira) }}</dd>
        <dt>{{ t('faturamento.conta.cpf') }}</dt>
        <dd data-testid="cta-cpf">{{ c.data.value.beneficiario.cpfMascarado || '—' }}</dd>
        <dt>{{ t('faturamento.conta.plano') }}</dt>
        <dd>{{ c.data.value.beneficiario.plano || '—' }}</dd>
      </dl>

      <table v-else-if="aba === 'guias'" class="tabela" data-testid="cta-guias">
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.codigo') }}</th>
            <th scope="col">{{ t('faturamento.conta.guias') }}</th>
            <th scope="col">{{ t('faturamento.data') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, i) in c.data.value.guias" :key="i">
            <td>{{ g.tipo }}</td>
            <td>{{ g.principal }} {{ g.secundaria }}</td>
            <td>{{ g.sequencia ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else-if="aba === 'parciais'" class="tabela" data-testid="cta-parciais">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{{ t('faturamento.data') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="c.data.value.parciais.length === 0">
            <td colspan="2">{{ t('faturamento.nenhum') }}</td>
          </tr>
          <tr v-for="p in c.data.value.parciais" :key="p.seq">
            <td>{{ p.seq }}</td>
            <td>{{ t('faturamento.periodo', { de: data(p.inicio), ate: data(p.fim) }) }}</td>
          </tr>
        </tbody>
      </table>

      <div v-else-if="aba === 'pendencias'" data-testid="cta-pendencias">
        <p v-if="c.data.value.pendenciasLista.length === 0">{{ t('faturamento.conta.semPendencias') }}</p>
        <ul v-else>
          <li v-for="p in c.data.value.pendenciasLista" :key="p.id" :data-testid="`cta-pendencia-${p.id}`">
            <strong>{{ p.tipoNome }}</strong
            >: {{ p.descricao }} ·
            {{ p.aberta ? t('faturamento.conta.aberta') : t('faturamento.conta.resolvida') }}
            <span v-if="p.bloqueante"> · {{ t('faturamento.conta.bloqueante') }}</span>
            <span v-if="p.origem === 'outro'" class="secundario"> · {{ t('faturamento.conta.antiga') }}</span>
            <form
              v-if="p.aberta && p.origem === 'novo' && pode('registrarPendencia')"
              class="filtros"
              @submit.prevent="resolver(p.id)"
            >
              <label :for="`cta-resolucao-${p.id}`">{{ t('faturamento.conta.resolucao') }}</label>
              <input
                :id="`cta-resolucao-${p.id}`"
                v-model="resolucao[p.id]"
                maxlength="250"
                :data-testid="`cta-resolucao-${p.id}`"
              />
              <button type="submit" :disabled="ocupado" :data-testid="`cta-resolver-${p.id}`">
                {{ t('faturamento.conta.resolver') }}
              </button>
            </form>
          </li>
        </ul>
        <form v-if="pode('registrarPendencia')" class="filtros" @submit.prevent="pendencia">
          <span class="campo">
            <SanteSelecao
              v-model="nova.tipo"
              :rotulo="t('faturamento.conta.tipoPendencia')"
              :opcoes="opcoesTipoPendencia"
              data-testid="cta-tipo"
            />
          </span>
          <span class="campo">
            <label for="cta-descricao">{{ t('faturamento.conta.descricao') }}</label>
            <input id="cta-descricao" v-model="nova.descricao" maxlength="250" data-testid="cta-descricao" />
          </span>
          <label
            ><input v-model="nova.bloqueante" type="checkbox" data-testid="cta-bloqueante" />
            {{ t('faturamento.conta.bloqueante') }}</label
          >
          <button type="submit" :disabled="ocupado" data-testid="cta-registrar-pendencia">
            {{ t('faturamento.conta.novaPendencia') }}
          </button>
        </form>
      </div>

      <div v-else data-testid="cta-etapas">
        <p v-if="c.data.value.etapas.length === 0">{{ t('faturamento.conta.semEtapas') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('faturamento.conta.etapas') }}</th>
              <th scope="col">{{ t('faturamento.situacao') }}</th>
              <th scope="col">{{ t('faturamento.usuario') }}</th>
              <th scope="col">{{ t('faturamento.data') }}</th>
              <th scope="col">{{ t('faturamento.motivo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in c.data.value.etapas" :key="e.id">
              <td>{{ e.etapa }}</td>
              <td>{{ e.situacao }}</td>
              <td>{{ e.usuario }}</td>
              <td>{{ quando(e.inicio) }}</td>
              <td>{{ e.observacao }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.resumo {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.resumo dd {
  margin: 0;
}
</style>
