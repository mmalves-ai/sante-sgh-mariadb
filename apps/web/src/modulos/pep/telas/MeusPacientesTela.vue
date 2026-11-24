<script setup lang="ts">
// Meus pacientes (ficha do M23, seção 7): `/pep/pacientes`. Internados e atendidos nas últimas 24 horas por
// unidade e por vínculo (todos, meus, equipe), com os alertas de completude e a situação das alergias; favoritos e
// colunas ficam neste navegador, por rede, estabelecimento e login (D-PAINEL-1), e só quem tem pep.painel.configurar
// os muda. Abre o prontuário na aba pedida pelo menu (`?aba=`).
import { COLUNAS_PAINEL, type ColunaPainel, VINCULOS_PAINEL, type VinculoPainel } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerPainel } from '../api-documentos.js';
import { dataHoraBr } from '../formato.js';
import {
  acompanhar,
  deixarDeAcompanhar,
  escolherFiltroPadrao,
  type FiltroPainelSalvo,
  gravarColunas,
  gravarColunasDoFiltro,
  gravarFiltroPadrao,
  incluirFiltro,
  lerAcompanhados,
  lerColunas,
  lerColunasDoFiltro,
  lerFiltroPadrao,
  lerFiltros,
} from '../api-equipe-painel.js';
import { chavePainel, gravarPreferenciasPainel, lerPreferenciasPainel } from '../preferencias-painel.js';

const { t } = useI18n();
const rota = useRoute();
const { sessao } = usarSessao();
const chave = computed(() => {
  const s = sessao.value;
  return chavePainel(
    s && s.estabelecimentoAtivo
      ? {
          rede: s.rede ?? '',
          estabelecimento: s.estabelecimentoAtivo,
          login: s.usuario.login ?? s.usuario.id,
        }
      : null,
  );
});

const favoritos = ref<number[]>([]);
const colunas = ref<ColunaPainel[]>([...COLUNAS_PAINEL]);
const unidade = ref<number | null>(null);
// A preferência é do dono da sessão: troca de usuário ou de estabelecimento relê a dele.
watch(
  chave,
  (k) => {
    const p = lerPreferenciasPainel(k);
    favoritos.value = p.favoritos;
    colunas.value = p.colunas;
    unidade.value = p.unidade;
  },
  { immediate: true },
);
// F3.3 (L90): acompanhados e colunas vêm do banco, por usuário (a troca de computador não perde o painel); o
// navegador guarda só a unidade e serve de reserva quando o banco não responde.
const doBanco = ref(false);
watch(
  chave,
  async (k) => {
    if (!k) return;
    try {
      const [a, c, f] = await Promise.all([lerAcompanhados(), lerColunas(), lerFiltroPadrao()]);
      if (f.unidade !== null) unidade.value = f.unidade;
      favoritos.value = a.itens.map((x) => x.paciente);
      const cols = c.colunas.filter((x): x is ColunaPainel =>
        (COLUNAS_PAINEL as readonly string[]).includes(x),
      );
      if (cols.length >= 2) colunas.value = cols;
      doBanco.value = true;
      await carregarFiltros(true);
    } catch {
      doBanco.value = false;
    }
  },
  { immediate: true },
);
const erroPreferencia = ref<string | null>(null);
// F3.3 (L90): filtros salvos nomeados no banco (vários por usuário e estabelecimento, um padrão que abre o painel); o
// filtro escolhido aplica a unidade e "apenas meus pacientes" e traz as colunas dele, quando tem colunas próprias.
const filtros = ref<FiltroPainelSalvo[]>([]);
const filtroAtual = ref<number | null>(null);
const nomeNovoFiltro = ref('');
const avisoFiltro = ref<string | null>(null);
const opcoesFiltro = computed(() => [
  { valor: null, rotulo: t('pep.equipe.filtros.nenhum') },
  ...filtros.value.map((f) => ({
    valor: f.id,
    rotulo: f.padrao ? t('pep.equipe.filtros.padrao', { nome: f.nome }) : f.nome,
  })),
]);
async function carregarFiltros(aplicarPadrao: boolean): Promise<void> {
  filtros.value = (await lerFiltros()).filtros;
  const padrao = filtros.value.find((f) => f.padrao);
  if (aplicarPadrao && padrao) filtroAtual.value = padrao.id;
}
function falhaPreferencia(e: unknown): void {
  erroPreferencia.value = e instanceof Error ? e.message : String(e);
}
watch(filtroAtual, async (id) => {
  const f = filtros.value.find((x) => x.id === id);
  if (!f) return;
  unidade.value = f.unidade;
  vinculo.value = f.apenasMeusPacientes ? 'meus' : 'todos';
  try {
    const c = (await lerColunasDoFiltro(f.id)).colunas
      .map((x) => x.coluna)
      .filter((x): x is ColunaPainel => (COLUNAS_PAINEL as readonly string[]).includes(x));
    if (c.length >= 2) colunas.value = c;
  } catch (e) {
    falhaPreferencia(e);
  }
});
async function salvarFiltro(): Promise<void> {
  const nome = nomeNovoFiltro.value.trim();
  if (!nome) return;
  try {
    const { id } = await incluirFiltro({
      nome,
      unidade: unidade.value,
      apenasMeusPacientes: vinculo.value === 'meus',
    });
    await gravarColunasDoFiltro(
      id,
      colunas.value.map((coluna) => ({ coluna, largura: null })),
    );
    await carregarFiltros(false);
    filtroAtual.value = id;
    nomeNovoFiltro.value = '';
    avisoFiltro.value = t('pep.equipe.filtros.salvo_ok', { nome });
    erroPreferencia.value = null;
  } catch (e) {
    falhaPreferencia(e);
  }
}
async function tornarPadrao(): Promise<void> {
  if (filtroAtual.value === null) return;
  try {
    await escolherFiltroPadrao(filtroAtual.value);
    await carregarFiltros(false);
  } catch (e) {
    falhaPreferencia(e);
  }
}
const soFavoritos = ref(false);
const vinculo = ref<VinculoPainel>('todos');
const termo = ref('');
const busca = ref('');
const mostrarColunas = ref(false);

watch(
  [favoritos, colunas, unidade],
  () =>
    gravarPreferenciasPainel(chave.value, {
      favoritos: favoritos.value,
      colunas: colunas.value,
      unidade: unidade.value,
    }),
  { deep: true },
);

const painel = useQuery({
  queryKey: computed(() => [
    'pep',
    'painel',
    unidade.value,
    busca.value,
    vinculo.value,
    soFavoritos.value,
    favoritos.value.join(','),
  ]),
  queryFn: () =>
    lerPainel({
      unidade: unidade.value,
      busca: busca.value,
      vinculo: vinculo.value,
      favoritos: soFavoritos.value ? favoritos.value : null,
    }),
});
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('pep.doc.painel.todas') },
  ...(painel.data.value?.unidades ?? []).map((u) => ({ valor: u.id, rotulo: u.nome })),
]);
const opcoesVinculo = computed(() =>
  VINCULOS_PAINEL.map((v) => ({ valor: v, rotulo: t(`pep.doc.painel.vinculos.${v}`) })),
);
/** pep.painel.configurar: colunas e favoritos; sem ela, o painel mostra o padrão. */
const configurar = computed(() => painel.data.value?.configurar === true);
// O filtro salvo (unidade) vai ao banco quando o profissional troca a unidade do painel.
watch(unidade, (u, antes) => {
  if (!doBanco.value || !configurar.value || u === antes || filtroAtual.value !== null) return;
  gravarFiltroPadrao(u).catch((e: unknown) => {
    erroPreferencia.value = e instanceof Error ? e.message : String(e);
  });
});
const aba = computed(() => (typeof rota.query['aba'] === 'string' ? rota.query['aba'] : 'linha-do-tempo'));
/** Destino do paciente: a aba do prontuário, ou o novo registro (item "Evoluções multiprofissionais"). */
function destino(paciente: number): string {
  return aba.value === 'registro-novo'
    ? `/pep/paciente/${paciente}/registros/novo`
    : `/pep/paciente/${paciente}/${aba.value}`;
}
const ver = (c: ColunaPainel) => (configurar.value ? colunas.value : COLUNAS_PAINEL).includes(c);
const colunasVistas = computed(() => COLUNAS_PAINEL.filter(ver));

async function alternarFavorito(p: number): Promise<void> {
  if (!configurar.value) return;
  const tinha = favoritos.value.includes(p);
  favoritos.value = tinha ? favoritos.value.filter((x) => x !== p) : [...favoritos.value, p];
  if (!doBanco.value) return;
  try {
    erroPreferencia.value = null;
    await (tinha ? deixarDeAcompanhar(p) : acompanhar(p));
  } catch (e) {
    favoritos.value = tinha ? [...favoritos.value, p] : favoritos.value.filter((x) => x !== p);
    erroPreferencia.value = e instanceof Error ? e.message : String(e);
  }
}
async function alternarColuna(c: ColunaPainel): Promise<void> {
  if (!configurar.value) return;
  const antes = colunas.value;
  if (colunas.value.includes(c)) {
    if (colunas.value.length > 2) colunas.value = colunas.value.filter((x) => x !== c);
  } else colunas.value = COLUNAS_PAINEL.filter((x) => x === c || colunas.value.includes(x));
  if (!doBanco.value || antes === colunas.value) return;
  try {
    erroPreferencia.value = null;
    await gravarColunas(colunas.value);
  } catch (e) {
    colunas.value = antes;
    erroPreferencia.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="painel-titulo" data-testid="tela-meus-pacientes">
    <h1 id="painel-titulo">{{ t('pep.doc.painel.titulo') }}</h1>
    <p>{{ t('pep.doc.painel.texto') }}</p>

    <form class="filtros" role="search" @submit.prevent="busca = termo.trim()">
      <SanteSelecao
        v-model="unidade"
        class="campo"
        :rotulo="t('pep.doc.painel.unidade')"
        :opcoes="opcoesUnidade"
        data-testid="painel-unidade"
      />
      <SanteSelecao
        v-model="vinculo"
        class="campo"
        :rotulo="t('pep.doc.painel.vinculo')"
        :opcoes="opcoesVinculo"
        data-testid="painel-vinculo"
      />
      <label>
        <span>{{ t('pep.doc.painel.busca') }}</span>
        <input v-model="termo" type="search" autocomplete="off" data-testid="painel-busca" />
      </label>
      <label v-if="configurar" class="marca">
        <input v-model="soFavoritos" type="checkbox" data-testid="painel-favoritos" />
        <span>{{ t('pep.doc.painel.favoritos') }}</span>
      </label>
      <SanteBotao tipo="submit" :rotulo="t('pep.doc.painel.buscar')" />
      <SanteBotao
        v-if="configurar"
        variante="secundario"
        :rotulo="t('pep.doc.painel.colunas')"
        @acionar="mostrarColunas = !mostrarColunas"
      />
    </form>
    <form v-if="doBanco" class="filtros" data-testid="painel-filtros-salvos" @submit.prevent="salvarFiltro">
      <SanteSelecao
        v-model="filtroAtual"
        class="campo"
        :rotulo="t('pep.equipe.filtros.salvo')"
        :opcoes="opcoesFiltro"
        data-testid="painel-filtro-salvo"
      />
      <SanteBotao
        v-if="configurar && filtroAtual !== null"
        variante="secundario"
        :rotulo="t('pep.equipe.filtros.tornarPadrao')"
        data-testid="painel-filtro-padrao"
        @acionar="tornarPadrao"
      />
      <label v-if="configurar">
        <span>{{ t('pep.equipe.filtros.nome') }}</span>
        <input v-model="nomeNovoFiltro" maxlength="60" autocomplete="off" data-testid="painel-filtro-nome" />
      </label>
      <SanteBotao
        v-if="configurar"
        tipo="submit"
        variante="secundario"
        :desabilitado="!nomeNovoFiltro.trim()"
        :rotulo="t('pep.equipe.filtros.salvar')"
        data-testid="painel-filtro-salvar"
      />
    </form>
    <p v-if="avisoFiltro" role="status" data-testid="painel-filtro-aviso">{{ avisoFiltro }}</p>
    <SanteAlerta v-if="erroPreferencia" :texto="erroPreferencia" data-testid="painel-erro-preferencia" />
    <fieldset v-if="mostrarColunas && configurar" class="colunas" data-testid="painel-colunas">
      <legend>{{ t('pep.doc.painel.colunas') }}</legend>
      <label v-for="c in COLUNAS_PAINEL" :key="c">
        <input type="checkbox" :checked="ver(c)" @change="alternarColuna(c)" />
        {{ t(`pep.doc.painel.col.${c}`) }}
      </label>
    </fieldset>

    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="painel.data.value.limitado"
        variante="aviso"
        :texto="t('pep.doc.painel.limitado', { teto: painel.data.value.teto })"
      />
      <table class="tabela" data-testid="tabela-painel">
        <caption>
          {{
            t('pep.doc.painel.legenda', { n: painel.data.value.total })
          }}
        </caption>
        <thead>
          <tr>
            <th v-if="configurar" scope="col">
              <span class="sr">{{ t('pep.doc.painel.favoritos') }}</span>
            </th>
            <th v-for="c in colunasVistas" :key="c" scope="col">{{ t(`pep.doc.painel.col.${c}`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in painel.data.value.pacientes"
            :key="l.atendimento"
            :data-testid="`painel-paciente-${l.paciente}`"
          >
            <td v-if="configurar">
              <button
                type="button"
                class="estrela"
                :aria-pressed="favoritos.includes(l.paciente)"
                :aria-label="
                  favoritos.includes(l.paciente)
                    ? t('pep.doc.painel.desfavoritar', { nome: l.nome })
                    : t('pep.doc.painel.favoritar', { nome: l.nome })
                "
                @click="alternarFavorito(l.paciente)"
              >
                {{ favoritos.includes(l.paciente) ? '★' : '☆' }}
              </button>
            </td>
            <template v-for="c in colunasVistas" :key="c">
              <td v-if="c === 'leito'">{{ l.leito ?? '-' }}</td>
              <td v-else-if="c === 'paciente'">
                <RouterLink
                  :to="destino(l.paciente)"
                  :aria-label="t('pep.doc.painel.abrir', { nome: l.nome })"
                  :data-testid="`abrir-prontuario-${l.paciente}`"
                  >{{ l.nome }}</RouterLink
                >
                <small> · {{ l.prontuario }}</small>
              </td>
              <td v-else-if="c === 'idade'">{{ l.idade ?? '-' }}</td>
              <td v-else-if="c === 'atendimento'">{{ l.registro }}</td>
              <td v-else-if="c === 'entrada'">{{ dataHoraBr(l.entrada) }}</td>
              <td v-else-if="c === 'dias'">
                {{ l.dias !== null ? t('pep.doc.painel.dias', { n: l.dias }) : '-' }}
              </td>
              <td v-else-if="c === 'convenio'">{{ l.convenio ?? '-' }}</td>
              <td v-else-if="c === 'medico'">{{ l.medico ?? '-' }}</td>
              <td v-else-if="c === 'alergias'">{{ t(`pep.doc.painel.alergias.${l.alergias}`) }}</td>
              <td v-else-if="c === 'alertas'">
                <ul class="alertas">
                  <li v-for="a in l.alertas" :key="a.tipo">{{ a.texto }}</li>
                </ul>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.filtros label {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.filtros .campo {
  flex-direction: column;
  align-items: stretch;
  gap: var(--sgh-espaco-1);
}
.filtros .marca {
  flex-direction: row;
  align-items: center;
}
.filtros input,
.filtros select {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.colunas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.tabela {
  border-collapse: collapse;
  width: 100%;
}
.tabela caption {
  text-align: start;
  font-weight: 600;
}
.tabela th,
.tabela td {
  border-bottom: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  text-align: start;
  vertical-align: top;
}
.estrela {
  font: inherit;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sgh-texto);
}
.alertas {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-3);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
