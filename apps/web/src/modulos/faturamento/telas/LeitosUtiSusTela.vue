<script setup lang="ts">
// Leitos de UTI habilitados (M51, etapa 4; F7, 06-SUS linha 59) — `Faturamento > Faturamento SUS > AIH (internação,
// SIH)`: a quantidade de leitos de UTI habilitados no CNES por tipo de UTI do SIH, unidade e vigência por competência.
// Um formulário só inclui; a nova quantidade a partir de uma competência encerra a anterior no mês anterior (sem passo
// de encerrar à parte). Na lista, a vigência se altera na própria linha e a habilitação se inativa (nada apagado). A
// validação aparece enquanto se digita; a regra final é a do domínio na API. As diárias de UTI da AIH só passam com
// leito habilitado do tipo, e a diária guardada por competência aponta a habilitação vigente. O resumo por tipo vem da
// mesma leitura da AIH.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarVigenciaLeitoUti,
  inativarLeitoUti,
  incluirLeitoUti,
  type LeitoUti,
  lerLeitosUti,
  lerOpcoesLeitosUti,
} from '../api-leitos-uti.js';
import { lerPainelAih } from '../api-sus-aih.js';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['sus', 'aih', 'painel'], queryFn: () => lerPainelAih() });
const lista = useQuery({ queryKey: ['sus', 'leitos-uti', 'lista'], queryFn: lerLeitosUti });
const opcoes = useQuery({ queryKey: ['sus', 'leitos-uti', 'opcoes'], queryFn: lerOpcoesLeitosUti });
const podeCriar = computed(() => pode('faturamento.susLeitoUti.criar'));
const podeEditar = computed(() => pode('faturamento.susLeitoUti.editar'));

const mesAtual = () => new Date().toISOString().slice(0, 7);
/** AAAA-MM → primeiro dia; AAAA-MM → último dia da competência. */
const inicioDe = (m: string) => `${m}-01`;
const fimDe = (m: string) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
};
const mesDe = (d: string | null) => (d ? d.slice(0, 7) : '');

const f = reactive({
  tipo: null as number | null,
  unidade: null as number | null,
  quantidadeLeitos: null as number | null,
  inicio: mesAtual(),
  fim: '',
  liberaCritica: false,
});
const opTipos = computed(() => [
  { valor: null, rotulo: t('faturamentoSus.aih.leitosUtiCadastro.tipo') },
  ...(opcoes.data.value?.tipos ?? []).map((x) => ({ valor: x.id, rotulo: `${x.codigo} — ${x.descricao}` })),
]);
const opUnidades = computed(() => [
  { valor: null, rotulo: t('faturamentoSus.aih.leitosUtiCadastro.todoEstabelecimento') },
  ...(opcoes.data.value?.unidades ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const problemas = computed(() => {
  const p: string[] = [];
  if (f.tipo === null) p.push(t('faturamentoSus.aih.leitosUtiCadastro.problemas.tipo'));
  const q = Number(f.quantidadeLeitos);
  if (!Number.isInteger(q) || q < 1 || q > 9999)
    p.push(t('faturamentoSus.aih.leitosUtiCadastro.problemas.quantidade'));
  if (f.fim && f.inicio && f.fim < f.inicio) p.push(t('faturamentoSus.aih.leitosUtiCadastro.problemas.fim'));
  return p;
});

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<{ encerrada?: number | null }>) => fn(),
  onSuccess: (r) => {
    erro.value = null;
    aviso.value = t(
      r && typeof r.encerrada === 'number'
        ? 'faturamentoSus.aih.leitosUtiCadastro.encerrada'
        : 'faturamentoSus.aih.leitosUtiCadastro.salvo',
    );
    editando.value = null;
    void cliente.invalidateQueries({ queryKey: ['sus', 'leitos-uti'] });
    void cliente.invalidateQueries({ queryKey: ['sus', 'aih', 'painel'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const incluir = () =>
  acao.mutate(() =>
    incluirLeitoUti({
      tipo: f.tipo!,
      unidade: f.unidade,
      quantidadeLeitos: Number(f.quantidadeLeitos),
      vigenciaInicio: inicioDe(f.inicio),
      vigenciaFim: f.fim ? fimDe(f.fim) : null,
      liberaCritica: f.liberaCritica,
    }),
  );

const editando = ref<number | null>(null);
const v = reactive({ inicio: '', fim: '', liberaCritica: false });
const editar = (x: LeitoUti) => {
  editando.value = x.id;
  v.inicio = mesDe(x.vigenciaInicio);
  v.fim = mesDe(x.vigenciaFim);
  v.liberaCritica = x.liberaCritica;
};
const gravarVigencia = (x: LeitoUti) =>
  acao.mutate(() =>
    alterarVigenciaLeitoUti(x.id, {
      vigenciaInicio: inicioDe(v.inicio),
      vigenciaFim: v.fim ? fimDe(v.fim) : null,
      liberaCritica: v.liberaCritica,
      versao: x.versao,
    }),
  );
const inativar = (x: LeitoUti) => {
  if (!window.confirm(t('faturamentoSus.aih.leitosUtiCadastro.confirmarInativar'))) return;
  acao.mutate(() => inativarLeitoUti(x.id, x.versao));
};
const situacao = (x: LeitoUti) =>
  t(`faturamentoSus.aih.leitosUtiCadastro.${!x.ativo ? 'inativa' : x.vigente ? 'vigente' : 'passada'}`);
</script>

<template>
  <section class="tela" aria-labelledby="leitos-uti-titulo" data-testid="tela-leitos-uti">
    <h1 id="leitos-uti-titulo">{{ t('faturamentoSus.aih.leitosUti') }}</h1>
    <p>{{ t('faturamentoSus.aih.leitosUtiExplicacao') }}</p>
    <RouterLink to="/faturamento/sus/aih">{{ t('faturamentoSus.retorno.irAih') }}</RouterLink>
    ·
    <RouterLink to="/faturamento/sus/cadastros/dominios">{{ t('faturamentoSus.aih.irDominios') }}</RouterLink>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <table v-else-if="painel.data.value" data-testid="tabela-leitos-por-tipo">
      <caption>
        {{
          t('faturamentoSus.aih.leitosPorTipo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('faturamentoSus.aih.tipoUti') }}</th>
          <th scope="col">{{ t('faturamentoSus.aih.leitosHabilitados') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in painel.data.value.leitosUti" :key="x.tipo">
          <td>{{ x.tipo }} — {{ x.nome }}</td>
          <td>{{ x.leitos }}</td>
        </tr>
      </tbody>
    </table>

    <p v-if="aviso" role="status" data-testid="leitos-uti-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <form v-if="podeCriar" class="formulario" data-testid="leitos-uti-form" @submit.prevent="incluir">
      <p class="ajuda">{{ t('faturamentoSus.aih.leitosUtiCadastro.novaQuantidade') }}</p>
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="t('faturamentoSus.aih.leitosUtiCadastro.tipo')"
        :opcoes="opTipos"
        data-testid="leitos-uti-tipo"
      />
      <SanteSelecao
        v-model="f.unidade"
        :rotulo="t('faturamentoSus.aih.leitosUtiCadastro.unidade')"
        :opcoes="opUnidades"
        data-testid="leitos-uti-unidade"
      />
      <label
        >{{ t('faturamentoSus.aih.leitosUtiCadastro.quantidade') }}
        <input
          v-model.number="f.quantidadeLeitos"
          type="number"
          min="1"
          max="9999"
          required
          data-testid="leitos-uti-quantidade"
      /></label>
      <label
        >{{ t('faturamentoSus.aih.leitosUtiCadastro.inicio') }}
        <input v-model="f.inicio" type="month" required data-testid="leitos-uti-inicio"
      /></label>
      <label
        >{{ t('faturamentoSus.aih.leitosUtiCadastro.fim') }}
        <input v-model="f.fim" type="month" data-testid="leitos-uti-fim"
      /></label>
      <label
        ><input v-model="f.liberaCritica" type="checkbox" data-testid="leitos-uti-libera" />
        {{ t('faturamentoSus.aih.leitosUtiCadastro.liberaCritica') }}</label
      >
      <ul v-if="problemas.length" class="problemas" data-testid="leitos-uti-problemas">
        <li v-for="p in problemas" :key="p">{{ p }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemas.length > 0 || acao.isPending.value"
        data-testid="leitos-uti-incluir"
      >
        {{ t('faturamentoSus.aih.leitosUtiCadastro.incluir') }}
      </button>
    </form>
    <p v-else data-testid="leitos-uti-so-consulta">
      {{ t('faturamentoSus.aih.leitosUtiCadastro.semPermissao') }}
    </p>

    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.data.value?.itens.length === 0" data-testid="leitos-uti-vazio">
      {{ t('faturamentoSus.aih.leitosUtiCadastro.vazio') }}
    </p>
    <table v-else-if="lista.data.value" data-testid="leitos-uti-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('faturamentoSus.aih.leitosUtiCadastro.tipo') }}</th>
          <th scope="col">{{ t('faturamentoSus.aih.leitosUtiCadastro.unidade') }}</th>
          <th scope="col">{{ t('faturamentoSus.aih.leitosUtiCadastro.quantidade') }}</th>
          <th scope="col">{{ t('faturamentoSus.aih.leitosUtiCadastro.vigencia') }}</th>
          <th scope="col">{{ t('faturamentoSus.aih.leitosUtiCadastro.situacao') }}</th>
          <th v-if="podeEditar" scope="col">{{ t('faturamentoSus.aih.leitosUtiCadastro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`leitos-uti-linha-${x.id}`">
          <td>{{ x.tipoCodigo }} — {{ x.tipoDescricao }}</td>
          <td>{{ x.unidadeDescricao ?? t('faturamentoSus.aih.leitosUtiCadastro.todoEstabelecimento') }}</td>
          <td>{{ x.quantidadeLeitos }}</td>
          <td v-if="editando === x.id">
            <input v-model="v.inicio" type="month" required data-testid="leitos-uti-vig-inicio" />
            <input v-model="v.fim" type="month" data-testid="leitos-uti-vig-fim" />
            <label
              ><input v-model="v.liberaCritica" type="checkbox" />
              {{ t('faturamentoSus.aih.leitosUtiCadastro.liberaCritica') }}</label
            >
          </td>
          <td v-else>
            {{ mesDe(x.vigenciaInicio) }} —
            {{ x.vigenciaFim ? mesDe(x.vigenciaFim) : t('faturamentoSus.aih.leitosUtiCadastro.abertaAte') }}
          </td>
          <td :data-testid="`leitos-uti-situacao-${x.id}`">{{ situacao(x) }}</td>
          <td v-if="podeEditar">
            <template v-if="x.ativo && editando === x.id">
              <button
                type="button"
                :disabled="!v.inicio || (!!v.fim && v.fim < v.inicio) || acao.isPending.value"
                data-testid="leitos-uti-vig-gravar"
                @click="gravarVigencia(x)"
              >
                {{ t('faturamentoSus.aih.leitosUtiCadastro.gravarVigencia') }}
              </button>
              <button type="button" @click="editando = null">
                {{ t('faturamentoSus.aih.leitosUtiCadastro.cancelar') }}
              </button>
            </template>
            <template v-else-if="x.ativo">
              <button type="button" :data-testid="`leitos-uti-editar-${x.id}`" @click="editar(x)">
                {{ t('faturamentoSus.aih.leitosUtiCadastro.alterarVigencia') }}
              </button>
              <button type="button" :data-testid="`leitos-uti-inativar-${x.id}`" @click="inativar(x)">
                {{ t('faturamentoSus.aih.leitosUtiCadastro.inativar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
caption {
  text-align: left;
  font-weight: 600;
}
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.ajuda {
  flex-basis: 100%;
}
.problemas {
  flex-basis: 100%;
  color: var(--sgh-alerta-texto);
}
</style>
