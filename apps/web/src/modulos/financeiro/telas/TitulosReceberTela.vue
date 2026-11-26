<script setup lang="ts">
// Títulos a receber (ficha do M32, seção 7): `/financeiro/receber/titulos`. Os títulos de convênio e de particular
// (paginados no servidor) e as contas apresentadas sem título: gerar os títulos da competência (um por convênio, com
// as contas da competência fechada) ou o título das contas marcadas. O servidor confere de novo se a conta já ganhou
// título depois da leitura.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  contasSemTitulo,
  criarTituloReceber,
  listarTitulosReceber,
  novaChave,
  titulosDaCompetencia,
} from '../api-financeiro.js';
import { lerTiposDocumentoReceber } from '../api-gestao.js';
import { data, reais, somarDias, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const filtro = reactive({ devedor: '', convenio: '', aberto: 'sim', de: '', ate: '' });
const pedido = ref({ ...filtro });
/** Página do servidor (0 = a primeira). */
const pagina = ref(0);
const lista = useQuery({
  queryKey: computed(() => ['financeiro', 'receber', pedido.value, pagina.value]),
  queryFn: () => listarTitulosReceber({ ...pedido.value, pagina: pagina.value }),
});
const abertos = computed(() => [
  { valor: '', rotulo: t('financeiro.todos') },
  { valor: 'sim', rotulo: t('financeiro.receber.aberto') },
  { valor: 'nao', rotulo: t('financeiro.situacoesReceber.recebido') },
]);
function consultar() {
  pagina.value = 0;
  pedido.value = { ...filtro };
}

// ── Contas sem título ───────────────────────────────────────────────────────────────────────────────────────────
const comp = reactive({ convenio: '', ano: '', mes: '', vencimento: '', documento: '' });
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !comp.ano) {
      comp.ano = h.slice(0, 4);
      comp.vencimento = somarDias(h, 30);
    }
  },
  { immediate: true },
);
const pedidoContas = ref<{ convenio: string; ano: string; mes: string } | null>(null);
const contas = useQuery({
  queryKey: computed(() => ['financeiro', 'contas-sem-titulo', pedidoContas.value]),
  queryFn: () => contasSemTitulo(pedidoContas.value ?? {}),
  enabled: computed(() => pedidoContas.value !== null),
});
// F3.8, 07-FIN linha 99: o tipo de documento do título, só entre os liberados aos perfis do usuário (a API recusa o
// resto); com o perfil livre, todos, e o padrão do cadastro já escolhido.
const tiposDoc = useQuery({
  queryKey: ['financeiro', 'tipos-documento-receber'],
  queryFn: lerTiposDocumentoReceber,
  enabled: computed(() => pode('financeiro.criarTituloReceber')),
});
const tipoDoc = ref('');
const opcoesTipoDoc = computed(() =>
  (tiposDoc.data.value?.tipos ?? [])
    .filter((x) => x.liberado)
    .map((x) => ({ valor: String(x.tipo), rotulo: x.descricao })),
);
watch(
  opcoesTipoDoc,
  (ops) => {
    if (ops.some((o) => o.valor === tipoDoc.value)) return;
    const padrao = String(tiposDoc.data.value?.padrao ?? '');
    tipoDoc.value = ops.find((o) => o.valor === padrao)?.valor ?? ops[0]?.valor ?? '';
  },
  { immediate: true },
);
const semTipoDoc = computed(() => !!tiposDoc.data.value && opcoesTipoDoc.value.length === 0);
const tipoEscolhido = () => (tipoDoc.value ? Number(tipoDoc.value) : null);
const marcadas = reactive(new Set<number>());
function alternar(id: number) {
  if (marcadas.has(id)) marcadas.delete(id);
  else marcadas.add(id);
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);
async function gravar(f: () => Promise<{ mensagem: string; avisos: readonly string[] }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await f();
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    marcadas.clear();
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const daCompetencia = () =>
  gravar(() =>
    titulosDaCompetencia(
      {
        convenio: Number(comp.convenio),
        ano: Number(comp.ano),
        mes: Number(comp.mes),
        vencimento: comp.vencimento,
        documento: Number(comp.documento) || 0,
        tipoDocumento: tipoEscolhido(),
      },
      novaChave('competencia'),
    ),
  );
const dasMarcadas = () =>
  gravar(() =>
    criarTituloReceber(
      {
        contas: (contas.data.value ?? [])
          .filter((c) => marcadas.has(c.id))
          .map((c) => ({ conta: c.id, versao: c.versao })),
        vencimento: comp.vencimento,
        documento: Number(comp.documento) || 0,
        referente: '',
        tipoDocumento: tipoEscolhido(),
      },
      novaChave('titulo-receber'),
    ),
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tr-titulo" data-testid="tela-fin-titulos-receber">
    <h1 id="tr-titulo">{{ t('financeiro.receber.titulo') }}</h1>
    <p>{{ t('financeiro.receber.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasReceber')" />
    <form class="filtros" @submit.prevent="consultar">
      <span class="campo">
        <label for="tr-devedor">{{ t('financeiro.receber.devedor') }}</label>
        <input id="tr-devedor" v-model="filtro.devedor" maxlength="1" data-testid="tr-devedor" />
      </span>
      <span class="campo">
        <label for="tr-convenio">{{ t('financeiro.convenio') }}</label>
        <input id="tr-convenio" v-model="filtro.convenio" inputmode="numeric" data-testid="tr-convenio" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="filtro.aberto"
          :rotulo="t('financeiro.situacao')"
          :opcoes="abertos"
          data-testid="tr-aberto"
        />
      </span>
      <span class="campo">
        <label for="tr-de">{{ t('financeiro.vencimento') }} — {{ t('financeiro.de') }}</label>
        <input id="tr-de" v-model="filtro.de" type="date" data-testid="tr-de" />
      </span>
      <span class="campo">
        <label for="tr-ate">{{ t('financeiro.ate') }}</label>
        <input id="tr-ate" v-model="filtro.ate" type="date" data-testid="tr-ate" />
      </span>
      <button type="submit" data-testid="tr-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="lista.data.value?.itens.length">
      <table class="tabela" data-testid="tr-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.receber.devedor') }}</th>
            <th scope="col">{{ t('financeiro.convenio') }}</th>
            <th scope="col">{{ t('financeiro.documento') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.receber.recebido') }}</th>
            <th scope="col">{{ t('financeiro.receber.glosaAceita') }}</th>
            <th scope="col">{{ t('financeiro.receber.contas') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`tr-linha-${x.id}`">
            <td>{{ x.devedor }} — {{ x.nome }}</td>
            <td>{{ x.convenio }}</td>
            <td>{{ x.documento }}</td>
            <td>{{ data(x.vencimento) }}</td>
            <td>{{ reais(x.valor) }}</td>
            <td>{{ reais(x.recebido) }}</td>
            <td>{{ reais(x.glosaAceita) }}</td>
            <td>{{ x.contas }}</td>
            <td>{{ t(`financeiro.situacoesReceber.${x.situacao}`) }}</td>
            <td>
              <RouterLink :to="`/financeiro/receber/titulos/${x.id}`" :data-testid="`tr-abrir-${x.id}`">
                {{ t('financeiro.abrir') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <nav class="paginacao">
        <button type="button" :disabled="pagina <= 0" @click="pagina--">
          {{ t('financeiro.anterior') }}
        </button>
        <span>{{ pagina + 1 }}</span>
        <button type="button" :disabled="!lista.data.value.mais" @click="pagina++">
          {{ t('financeiro.proxima') }}
        </button>
      </nav>
    </template>
    <p v-else>{{ t('financeiro.nenhum') }}</p>

    <h2>{{ t('financeiro.receber.semTitulo') }}</h2>
    <p>{{ t('financeiro.receber.semTituloTexto') }}</p>
    <form
      class="filtros"
      @submit.prevent="pedidoContas = { convenio: comp.convenio, ano: comp.ano, mes: comp.mes }"
    >
      <span class="campo">
        <label for="tr-c-convenio">{{ t('financeiro.convenio') }}</label>
        <input id="tr-c-convenio" v-model="comp.convenio" inputmode="numeric" data-testid="tr-c-convenio" />
      </span>
      <span class="campo">
        <label for="tr-c-ano">{{ t('financeiro.receber.ano') }}</label>
        <input id="tr-c-ano" v-model="comp.ano" inputmode="numeric" data-testid="tr-c-ano" />
      </span>
      <span class="campo">
        <label for="tr-c-mes">{{ t('financeiro.receber.mes') }}</label>
        <input id="tr-c-mes" v-model="comp.mes" inputmode="numeric" data-testid="tr-c-mes" />
      </span>
      <button type="submit" data-testid="tr-c-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <ErroFaturamento v-if="contas.error.value" :erro="contas.error.value" />
    <table v-else-if="contas.data.value?.length" class="tabela" data-testid="tr-contas">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.marcar') }}</th>
          <th scope="col">{{ t('financeiro.receber.contas') }}</th>
          <th scope="col">{{ t('financeiro.convenio') }}</th>
          <th scope="col">{{ t('financeiro.tipo') }}</th>
          <th scope="col">{{ t('financeiro.competencia') }}</th>
          <th scope="col">{{ t('financeiro.receber.fechada') }}</th>
          <th scope="col">{{ t('financeiro.receber.apresentacao') }}</th>
          <th scope="col">{{ t('financeiro.total') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in contas.data.value" :key="c.id">
          <td>
            <input
              type="checkbox"
              :checked="marcadas.has(c.id)"
              :aria-label="`${t('financeiro.marcar')} ${c.id}`"
              :data-testid="`tr-marcar-${c.id}`"
              @change="alternar(c.id)"
            />
          </td>
          <td>{{ c.id }}</td>
          <td>{{ c.convenio }}</td>
          <td>{{ c.tipo }}</td>
          <td>{{ c.competencia }}</td>
          <td>{{ c.fechada }}</td>
          <td>{{ data(c.apresentacao) }}</td>
          <td>{{ reais(c.total) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="contas.data.value">{{ t('financeiro.nenhum') }}</p>
    <form class="filtros" @submit.prevent>
      <span class="campo">
        <label for="tr-c-venc">{{ t('financeiro.vencimento') }}</label>
        <input id="tr-c-venc" v-model="comp.vencimento" type="date" required data-testid="tr-c-vencimento" />
      </span>
      <span class="campo">
        <label for="tr-c-doc">{{ t('financeiro.receber.numeroFatura') }}</label>
        <input
          id="tr-c-doc"
          v-model="comp.documento"
          inputmode="numeric"
          required
          data-testid="tr-c-documento"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="tipoDoc"
          :rotulo="t('financeiro.gestao.emissaoReceber.tipoDocumento')"
          :opcoes="opcoesTipoDoc"
          :desabilitado="semTipoDoc"
          obrigatorio
          data-testid="tr-tipo-documento"
        />
      </span>
      <button
        type="button"
        :disabled="
          gravando ||
          semTipoDoc ||
          !comp.convenio ||
          !comp.mes ||
          !comp.documento ||
          !pode('financeiro.criarTituloReceber')
        "
        data-testid="tr-gerar-competencia"
        @click="daCompetencia"
      >
        {{ t('financeiro.receber.gerarDaCompetencia') }}
      </button>
      <button
        type="button"
        :disabled="gravando || semTipoDoc || marcadas.size === 0 || !pode('financeiro.criarTituloReceber')"
        data-testid="tr-gerar-marcadas"
        @click="dasMarcadas"
      >
        {{ t('financeiro.receber.gerarDasMarcadas') }}
      </button>
    </form>
    <p v-if="semTipoDoc" class="secundario" role="status" data-testid="tr-tipo-documento-aviso">
      {{ t('financeiro.gestao.emissaoReceber.semTipo') }}
    </p>
    <p v-else-if="tiposDoc.data.value?.restrito" class="secundario" data-testid="tr-tipo-documento-aviso">
      {{ t('financeiro.gestao.emissaoReceber.restrito') }}
    </p>
    <p v-if="!pode('financeiro.criarTituloReceber')" class="secundario">
      {{ motivo('financeiro.criarTituloReceber') }}
    </p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="tr-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
