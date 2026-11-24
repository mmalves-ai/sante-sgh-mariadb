<script setup lang="ts">
// Parâmetros e permissões financeiras (ficha do M32, seção 7): `/financeiro/parametros`. As faixas de alçada (valor,
// centro de custo, tipo de credor, quantas aprovações e a permissão de quem aprova, com vigência): o servidor recusa
// faixas que se sobrepõem. Os parâmetros financeiros e o escopo de contas de cada usuário ficam no cadastro genérico.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { lerAlcadas, novaChave, salvarAlcada } from '../api-financeiro.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo } = usarFinanceiro();
const faixas = useQuery({ queryKey: ['financeiro', 'alcadas'], queryFn: () => lerAlcadas() });
const vazia = () => ({
  id: null as number | null,
  centroCusto: '',
  tipoCredor: '',
  valorDe: '0',
  valorAte: '',
  aprovacoes: '1',
  permissao: 'financeiro.tituloPagar.aprovar',
  vigenciaInicio: apoio.data.value?.hoje ?? '',
  vigenciaFim: '',
  ativa: true,
});
const form = reactive(vazia());
const editando = ref(false);
const tipos = computed(() => [
  { valor: '', rotulo: t('financeiro.todos') },
  ...(apoio.data.value?.tiposCredor ?? []).map((x) => ({
    valor: x.codigo,
    rotulo: `${x.codigo} — ${x.rotulo}`,
  })),
]);
const aprovacoes = [
  { valor: '1', rotulo: '1' },
  { valor: '2', rotulo: '2' },
];
const permissoes = [
  { valor: 'financeiro.tituloPagar.aprovar', rotulo: 'financeiro.tituloPagar.aprovar' },
  { valor: 'financeiro.tituloPagar.aprovarDiretoria', rotulo: 'financeiro.tituloPagar.aprovarDiretoria' },
];
function editar(f?: (typeof faixas.data.value & object)[number]) {
  Object.assign(
    form,
    f
      ? {
          id: f.id,
          centroCusto: f.centroCusto === null ? '' : String(f.centroCusto),
          tipoCredor: f.tipoCredor ?? '',
          valorDe: String(f.valorDe),
          valorAte: f.valorAte === null ? '' : String(f.valorAte),
          aprovacoes: String(f.aprovacoes),
          permissao: f.permissao,
          vigenciaInicio: f.vigenciaInicio,
          vigenciaFim: f.vigenciaFim ?? '',
          ativa: f.ativa,
        }
      : vazia(),
  );
  editando.value = true;
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function salvar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await salvarAlcada(
      {
        id: form.id,
        centroCusto: form.centroCusto ? Number(form.centroCusto) : null,
        tipoCredor: form.tipoCredor || null,
        valorDe: Number(String(form.valorDe).replace(',', '.')),
        valorAte: form.valorAte ? Number(String(form.valorAte).replace(',', '.')) : null,
        aprovacoes: Number(form.aprovacoes),
        permissao: form.permissao,
        vigenciaInicio: form.vigenciaInicio,
        vigenciaFim: form.vigenciaFim || null,
        ativa: form.ativa,
      },
      novaChave('alcada'),
    );
    mensagem.value = r.mensagem;
    editando.value = false;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pr-titulo" data-testid="tela-fin-parametros">
    <h1 id="pr-titulo">{{ t('financeiro.parametros.titulo') }}</h1>
    <p>{{ t('financeiro.parametros.texto') }}</p>
    <p>
      <RouterLink to="/cadastros/dominios/grupo/financeiroParametros" data-testid="pr-cadastros">
        {{ t('financeiro.parametros.cadastros') }}
      </RouterLink>
      ·
      <RouterLink to="/cadastros/dominios/grupo/financeiroCadastros">
        {{ t('financeiro.parametros.cadastrosFinanceiros') }}
      </RouterLink>
      ·
      <RouterLink to="/financeiro/parametros/permissoes" data-testid="pr-permissoes">
        {{ t('financeiro.gestao.permissoes.titulo') }}
      </RouterLink>
    </p>
    <h2>{{ t('financeiro.parametros.faixas') }}</h2>
    <ErroFaturamento v-if="faixas.error.value" :erro="faixas.error.value" />
    <table v-else-if="faixas.data.value?.length" class="tabela" data-testid="pr-faixas">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.parametros.valorDe') }}</th>
          <th scope="col">{{ t('financeiro.ate') }}</th>
          <th scope="col">{{ t('financeiro.parametros.centroCusto') }}</th>
          <th scope="col">{{ t('financeiro.parametros.tipoCredor') }}</th>
          <th scope="col">{{ t('financeiro.parametros.aprovacoes') }}</th>
          <th scope="col">{{ t('financeiro.parametros.permissao') }}</th>
          <th scope="col">{{ t('financeiro.parametros.vigenciaInicio') }}</th>
          <th scope="col">{{ t('financeiro.parametros.ativa') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in faixas.data.value" :key="f.id">
          <td>{{ reais(f.valorDe) }}</td>
          <td>{{ f.valorAte === null ? '—' : reais(f.valorAte) }}</td>
          <td>{{ f.centroCusto ?? t('financeiro.todos') }}</td>
          <td>{{ f.tipoCredor ?? t('financeiro.todos') }}</td>
          <td>{{ f.aprovacoes }}</td>
          <td>{{ f.permissao }}</td>
          <td>{{ data(f.vigenciaInicio) }}{{ f.vigenciaFim ? ` — ${data(f.vigenciaFim)}` : '' }}</td>
          <td>{{ f.ativa ? t('financeiro.sim') : t('financeiro.nao') }}</td>
          <td>
            <button
              type="button"
              :disabled="!pode('editarAlcada')"
              :data-testid="`pr-editar-${f.id}`"
              @click="editar(f)"
            >
              {{ t('financeiro.parametros.editar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
    <button type="button" :disabled="!pode('editarAlcada')" data-testid="pr-nova" @click="editar()">
      {{ t('financeiro.parametros.nova') }}
    </button>
    <p v-if="!pode('editarAlcada')" class="secundario">{{ motivo('editarAlcada') }}</p>
    <form v-if="editando" class="formulario" data-testid="pr-formulario" @submit.prevent="salvar">
      <span class="campo">
        <label for="pr-de">{{ t('financeiro.parametros.valorDe') }}</label>
        <input id="pr-de" v-model="form.valorDe" inputmode="decimal" required data-testid="pr-de" />
      </span>
      <span class="campo">
        <label for="pr-ate">{{ t('financeiro.parametros.valorAte') }}</label>
        <input id="pr-ate" v-model="form.valorAte" inputmode="decimal" data-testid="pr-ate" />
      </span>
      <span class="campo">
        <label for="pr-cdc">{{ t('financeiro.parametros.centroCusto') }}</label>
        <input id="pr-cdc" v-model="form.centroCusto" inputmode="numeric" data-testid="pr-cdc" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.tipoCredor"
          :rotulo="t('financeiro.parametros.tipoCredor')"
          :opcoes="tipos"
          data-testid="pr-tipo"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.aprovacoes"
          :rotulo="t('financeiro.parametros.aprovacoes')"
          :opcoes="aprovacoes"
          data-testid="pr-aprovacoes"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.permissao"
          :rotulo="t('financeiro.parametros.permissao')"
          :opcoes="permissoes"
          data-testid="pr-permissao"
        />
      </span>
      <span class="campo">
        <label for="pr-vi">{{ t('financeiro.parametros.vigenciaInicio') }}</label>
        <input
          id="pr-vi"
          v-model="form.vigenciaInicio"
          type="date"
          required
          data-testid="pr-vigencia-inicio"
        />
      </span>
      <span class="campo">
        <label for="pr-vf">{{ t('financeiro.parametros.vigenciaFim') }}</label>
        <input id="pr-vf" v-model="form.vigenciaFim" type="date" data-testid="pr-vigencia-fim" />
      </span>
      <span class="campo">
        <label for="pr-ativa">
          <input id="pr-ativa" v-model="form.ativa" type="checkbox" data-testid="pr-ativa" />
          {{ t('financeiro.parametros.ativa') }}
        </label>
      </span>
      <button type="submit" :disabled="gravando" data-testid="pr-gravar">{{ t('financeiro.gravar') }}</button>
      <button type="button" @click="editando = false">{{ t('financeiro.cancelar') }}</button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="pr-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
