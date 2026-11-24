<script setup lang="ts">
// Resultados lado a lado (F3.3, linha 03-PEP L128): grupo comparativo ou filtro salvo do profissional (abre com o
// padrão), período em um clique, matriz analito × coleta com a faixa do laudo, o crítico e a tendência; salvar a
// escolha atual como filtro sem sair da aba.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import {
  type Comparativo,
  excluirFiltro,
  type Filtro,
  gravarFiltro,
  type Grupo,
  lerComparativo,
  lerFiltros,
  lerGrupos,
} from '../../api-resultados-grupos.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number; atendimento?: number | null }>();
const { t } = useI18n();
const k = (c: string, p?: Record<string, unknown>) =>
  p ? t(`pep.resultadosGrupos.${c}`, p) : t(`pep.resultadosGrupos.${c}`);
const grupos = ref<Grupo[]>([]);
const filtros = ref<Filtro[]>([]);
const grupo = ref<number | null>(null);
const filtro = ref<number | null>(null);
const dias = ref<number | null>(null);
const dados = ref<Comparativo | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const PERIODOS = [7, 30, 90, 365] as const;

async function carregar(): Promise<void> {
  erro.value = null;
  try {
    dados.value = await lerComparativo(props.paciente, {
      grupo: grupo.value,
      filtro: filtro.value,
      dias: dias.value,
      atendimento: props.atendimento ?? null,
    });
    if (!grupo.value && !filtro.value && dados.value.filtroAplicado)
      filtro.value = dados.value.filtroAplicado.id;
    if (!grupo.value && !filtro.value && dados.value.grupos.length === 1)
      grupo.value = dados.value.grupos[0]!;
  } catch (e) {
    erro.value = e;
  }
}

onMounted(async () => {
  try {
    const [g, f] = await Promise.all([lerGrupos(), lerFiltros()]);
    grupos.value = g.itens.filter((x) => x.ativo);
    filtros.value = f.itens;
  } catch (e) {
    erro.value = e;
  }
  await carregar();
});
watch(() => props.paciente, carregar);

function escolherGrupo(id: number | null): void {
  grupo.value = id;
  filtro.value = null;
  void carregar();
}
function escolherFiltro(id: number | null): void {
  filtro.value = id;
  grupo.value = null;
  dias.value = null;
  void carregar();
}
function escolherDias(n: number | null): void {
  dias.value = n;
  void carregar();
}

// Salvar a escolha atual como filtro (um clique + nome).
const salvando = ref(false);
const novo = ref({
  nome: '',
  padrao: true,
  incluirPendentes: false,
  somenteLiberados: true,
  somenteMeusPedidos: false,
  escopoAtual: false,
});
async function salvar(): Promise<void> {
  erro.value = null;
  try {
    await gravarFiltro({
      id: null,
      versao: null,
      nome: novo.value.nome.trim(),
      padrao: novo.value.padrao,
      escopo: novo.value.escopoAtual ? 'atual' : 'todos',
      incluirPendentes: novo.value.incluirPendentes,
      somenteLiberados: novo.value.somenteLiberados,
      somenteMeusPedidos: novo.value.somenteMeusPedidos,
      periodoDias: dias.value,
      grupos: dados.value?.grupos ?? (grupo.value ? [grupo.value] : []),
      exames: [],
    });
    filtros.value = (await lerFiltros()).itens;
    const f = filtros.value.find((x) => x.nome === novo.value.nome.trim());
    salvando.value = false;
    mensagem.value = k('gravado');
    if (f) escolherFiltro(f.id);
  } catch (e) {
    erro.value = e;
  }
}
async function excluir(): Promise<void> {
  const f = filtros.value.find((x) => x.id === filtro.value);
  if (!f?.id || f.versao === null) return;
  erro.value = null;
  try {
    await excluirFiltro(f.id, f.versao);
    filtros.value = (await lerFiltros()).itens;
    escolherFiltro(null);
  } catch (e) {
    erro.value = e;
  }
}

const seta = (x: string | null) =>
  x === 'subindo' ? '↑' : x === 'descendo' ? '↓' : x === 'estavel' ? '→' : '';
const celula = computed(() => {
  const m = new Map<string, Comparativo['linhas'][number]['celulas'][number]>();
  for (const l of dados.value?.linhas ?? [])
    for (const c of l.celulas) m.set(`${l.exame}|${l.analito}|${c.coluna}`, c);
  return m;
});
</script>

<template>
  <section class="comparativo" aria-labelledby="comparativo-titulo" data-testid="resultados-comparativo">
    <h3 id="comparativo-titulo">{{ k('titulo') }}</h3>
    <p class="explica">{{ k('explica') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="mensagem" variante="info">{{ mensagem }}</SanteAlerta>
    <div class="escolhas">
      <label>
        {{ k('grupo') }}
        <select
          data-testid="comparativo-grupo"
          :value="grupo ?? ''"
          @change="escolherGrupo(Number(($event.target as HTMLSelectElement).value) || null)"
        >
          <option value="">{{ k('nenhum') }}</option>
          <option v-for="g in grupos" :key="g.id ?? 0" :value="g.id">{{ g.nome }}</option>
        </select>
      </label>
      <label>
        {{ k('filtro') }}
        <select
          data-testid="comparativo-filtro"
          :value="filtro ?? ''"
          @change="escolherFiltro(Number(($event.target as HTMLSelectElement).value) || null)"
        >
          <option value="">{{ k('nenhum') }}</option>
          <option v-for="f in filtros" :key="f.id ?? 0" :value="f.id">
            {{ f.nome }}{{ f.padrao ? ' ★' : '' }}
          </option>
        </select>
      </label>
      <span class="periodos" role="group" :aria-label="k('periodo')">
        <SanteBotao
          v-for="n in PERIODOS"
          :key="n"
          :variante="dias === n ? 'primario' : 'secundario'"
          :data-testid="`comparativo-dias-${n}`"
          @click="escolherDias(n)"
          >{{ k('dias', { n }) }}</SanteBotao
        >
        <SanteBotao :variante="dias === null ? 'primario' : 'secundario'" @click="escolherDias(null)">{{
          k('tudo')
        }}</SanteBotao>
      </span>
      <SanteBotao variante="secundario" data-testid="comparativo-salvar" @click="salvando = !salvando">{{
        k('salvarFiltro')
      }}</SanteBotao>
      <SanteBotao v-if="filtro" variante="secundario" @click="excluir">{{ k('excluirFiltro') }}</SanteBotao>
    </div>
    <form v-if="salvando" class="salvar" data-testid="comparativo-form-filtro" @submit.prevent="salvar">
      <label
        >{{ k('nomeFiltro') }}
        <input v-model="novo.nome" data-testid="comparativo-nome-filtro" maxlength="80" required
      /></label>
      <label><input v-model="novo.padrao" type="checkbox" /> {{ k('padrao') }}</label>
      <label><input v-model="novo.escopoAtual" type="checkbox" /> {{ k('escopoAtual') }}</label>
      <label><input v-model="novo.somenteLiberados" type="checkbox" /> {{ k('somenteLiberados') }}</label>
      <label><input v-model="novo.somenteMeusPedidos" type="checkbox" /> {{ k('somenteMeus') }}</label>
      <label><input v-model="novo.incluirPendentes" type="checkbox" /> {{ k('incluirPendentes') }}</label>
      <SanteBotao tipo="submit" data-testid="comparativo-gravar-filtro">{{
        k('gravado').replace('.', '')
      }}</SanteBotao>
    </form>
    <p v-if="!grupos.length && !filtros.length" role="status">{{ k('semGrupo') }}</p>
    <template v-else-if="dados">
      <p v-if="!dados.linhas.length" role="status" data-testid="comparativo-vazio">{{ k('vazio') }}</p>
      <template v-else>
        <p class="resumo" data-testid="comparativo-resumo">
          {{ k('resumo', { fora: dados.foraDaFaixa, criticos: dados.criticos }) }}
        </p>
        <div class="rolagem">
          <table data-testid="comparativo-tabela">
            <thead>
              <tr>
                <th scope="col">{{ k('analito') }}</th>
                <th scope="col">{{ k('faixa') }}</th>
                <th v-for="c in dados.colunas" :key="c" scope="col">{{ dataHoraBr(c) }}</th>
                <th scope="col">{{ k('tendencia') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in dados.linhas" :key="`${l.exame}|${l.analito}`">
                <th scope="row">
                  {{ l.rotulo }}<span v-if="l.unidade" class="unidade"> ({{ l.unidade }})</span>
                </th>
                <td class="faixa">{{ l.faixa ?? '—' }}</td>
                <td
                  v-for="c in dados.colunas"
                  :key="c"
                  :class="celula.get(`${l.exame}|${l.analito}|${c}`)?.situacao"
                  :title="
                    celula.get(`${l.exame}|${l.analito}|${c}`)
                      ? k(`situacao.${celula.get(`${l.exame}|${l.analito}|${c}`)!.situacao}`) +
                        (celula.get(`${l.exame}|${l.analito}|${c}`)!.preliminar
                          ? ` · ${k('preliminar')}`
                          : '')
                      : ''
                  "
                >
                  <template v-if="celula.get(`${l.exame}|${l.analito}|${c}`)">
                    {{ celula.get(`${l.exame}|${l.analito}|${c}`)!.valor
                    }}<em v-if="celula.get(`${l.exame}|${l.analito}|${c}`)!.preliminar">*</em>
                  </template>
                </td>
                <td :data-testid="`tendencia-${l.analito}`">
                  {{ seta(l.tendencia) }} {{ l.tendencia ? k(l.tendencia) : '' }}
                  <span v-if="l.variacao !== null">({{ l.variacao > 0 ? '+' : '' }}{{ l.variacao }}%)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div v-if="dados.pendentes.length" data-testid="comparativo-pendentes">
        <h4>{{ k('pendentes') }}</h4>
        <ul>
          <li v-for="(p, i) in dados.pendentes" :key="i">
            {{ p.exame }} — {{ p.pedidoEm ? dataHoraBr(p.pedidoEm) : '' }}
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped>
.comparativo {
  margin-block: 1rem;
}
.explica {
  color: var(--sante-cor-texto-suave, #555);
}
.escolhas,
.salvar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: end;
  margin-block: 0.5rem;
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
}
th,
td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--sante-cor-borda, #ddd);
  text-align: right;
  white-space: nowrap;
}
th[scope='row'],
.faixa {
  text-align: left;
}
.acima,
.abaixo {
  font-weight: 600;
  color: var(--sante-cor-alerta, #a15c00);
}
.critico {
  font-weight: 700;
  color: var(--sante-cor-erro, #b00020);
}
.unidade {
  color: var(--sante-cor-texto-suave, #555);
}
</style>
