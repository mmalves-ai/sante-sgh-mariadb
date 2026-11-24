<script setup lang="ts">
// Calendário de feriados e dias não úteis (F3.1, 02-CAD linha 28): `/cadastros/estrutura/calendario`. Uma tela só para
// o ano: o cadastro por mês (o que vale neste estabelecimento em destaque), o que a agenda de consultas e a de exames
// vão pular (com os nacionais calculados) e o formulário já preenchido com o município e a UF do estabelecimento.
// Validação na hora pelos mesmos códigos do servidor; inativar pede o motivo e nunca apaga; datas móveis (Carnaval,
// Sexta-feira Santa, Páscoa, Corpus Christi) geradas para vários anos num clique.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type Abrangencia,
  alterarDia,
  type BaseMovel,
  buscarMunicipios,
  type EntradaDia,
  gerarMoveis,
  incluirDia,
  type ItemCalendario,
  lerCalendario,
  mudarSituacaoDia,
  type Recorrencia,
} from '../api-calendario.js';

const { t } = useI18n();
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const ABRANGENCIAS: [Abrangencia, string][] = [
  ['estabelecimento', 'Só este estabelecimento'],
  ['municipal', 'Municipal'],
  ['estadual', 'Estadual'],
  ['nacional', 'Nacional'],
];
const RECORRENCIAS: [Recorrencia, string][] = [
  ['anual', 'Todo ano (dia e mês)'],
  ['data_unica', 'Só nesta data'],
];
const BASES: [BaseMovel, string][] = [
  ['carnaval', 'Carnaval'],
  ['sexta_santa', 'Sexta-feira Santa'],
  ['pascoa', 'Páscoa'],
  ['corpus_christi', 'Corpus Christi'],
];

const fila = useQueryClient();
const podeEditar = computed(() => pode('cadastro.calendario.editar'));
const ano = ref(new Date().getFullYear());
const visao = useQuery({
  queryKey: computed(() => ['cadastro', 'calendario', ano.value]),
  queryFn: () => lerCalendario(ano.value),
});
const soAqui = ref(true);
const erro = ref<unknown>(null);
const aviso = ref('');

const vazio = (): EntradaDia & { id: number | null; versao: number } => ({
  id: null,
  versao: 0,
  descricao: '',
  abrangencia: 'municipal',
  ufId: null,
  municipio: visao.data.value?.local.municipio ?? null,
  estabelecimento: null,
  recorrencia: 'anual',
  dia: null,
  mes: null,
  data: null,
  facultativo: false,
  horaInicio: null,
  horaFim: null,
});
const f = reactive(vazio());
const meioExpediente = ref(false);
const municipioNome = ref('');
const municipios = ref<{ id: number; nome: string; uf: string }[]>([]);

function novo(): void {
  Object.assign(f, vazio());
  meioExpediente.value = false;
  municipioNome.value = visao.data.value?.local.municipioNome ?? '';
  erro.value = null;
}
function editar(x: ItemCalendario): void {
  Object.assign(f, { ...x });
  meioExpediente.value = x.horaInicio !== null;
  municipioNome.value = x.municipioNome ?? '';
  erro.value = null;
}

/** Os mesmos códigos do servidor, na hora (o servidor confere de novo). */
const problemas = computed(() => {
  const p: string[] = [];
  if (f.descricao.trim().length < 3) p.push('Descrição com ao menos 3 letras.');
  if (f.abrangencia === 'estadual' && !f.ufId) p.push('Escolha a UF.');
  if (f.abrangencia === 'municipal' && !f.municipio) p.push('Escolha o município.');
  if (f.recorrencia === 'anual') {
    const max = f.mes ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][f.mes - 1]! : 31;
    if (!f.mes || !f.dia || f.dia < 1 || f.dia > max) p.push('O dia não existe no mês.');
  } else if (!f.data) p.push('Informe a data.');
  if (meioExpediente.value && (!f.horaInicio || !f.horaFim || f.horaFim <= f.horaInicio))
    p.push('O fim do período é depois do início.');
  return p;
});

const local = computed(() => visao.data.value?.local);
function corpo(): EntradaDia {
  const anual = f.recorrencia === 'anual';
  return {
    descricao: f.descricao.trim(),
    abrangencia: f.abrangencia,
    ufId: f.abrangencia === 'estadual' ? f.ufId : null,
    municipio: f.abrangencia === 'municipal' ? f.municipio : null,
    estabelecimento: f.abrangencia === 'estabelecimento' ? (local.value?.estabelecimento ?? null) : null,
    recorrencia: f.recorrencia,
    dia: anual ? f.dia : null,
    mes: anual ? f.mes : null,
    data: anual ? null : f.data,
    facultativo: f.facultativo,
    horaInicio: meioExpediente.value ? f.horaInicio : null,
    horaFim: meioExpediente.value ? f.horaFim : null,
  };
}

async function rodar(fn: () => Promise<unknown>, ok: string): Promise<void> {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    // A geração das móveis escreve o próprio resumo; o aviso fixo vazio não o apaga.
    if (ok) aviso.value = ok;
    await fila.invalidateQueries({ queryKey: ['cadastro', 'calendario'] });
  } catch (e) {
    erro.value = e;
  }
}
const gravar = () =>
  rodar(async () => {
    await (f.id ? alterarDia(f.id, f.versao, corpo()) : incluirDia(corpo()));
    novo();
  }, 'Gravado.');
function inativar(x: ItemCalendario): void {
  const motivo = window.prompt('Motivo da inativação (o registro fica, inativo):') ?? '';
  if (motivo.trim()) void rodar(() => mudarSituacaoDia(x.id, x.versao, false, motivo), 'Inativado.');
}
const reativar = (x: ItemCalendario) => rodar(() => mudarSituacaoDia(x.id, x.versao, true, ''), 'Reativado.');

async function procurarMunicipio(): Promise<void> {
  municipios.value =
    municipioNome.value.trim().length >= 2 ? await buscarMunicipios(municipioNome.value) : [];
}
function escolherMunicipio(m: { id: number; nome: string; uf: string }): void {
  f.municipio = m.id;
  municipioNome.value = `${m.nome} (${m.uf})`;
  municipios.value = [];
}

const movel = reactive({ base: 'carnaval' as BaseMovel, anos: 5 });
const gerar = () =>
  rodar(async () => {
    const c = corpo();
    const r = await gerarMoveis({
      base: movel.base,
      anoInicio: ano.value,
      anoFim: ano.value + movel.anos - 1,
      descricao: f.descricao.trim() || null,
      abrangencia: c.abrangencia,
      ufId: c.ufId,
      municipio: c.municipio,
      estabelecimento: c.estabelecimento,
      facultativo: f.facultativo,
    });
    aviso.value = `${r.incluidos.length} ano(s) incluído(s), ${r.pulados} já estava(m) no calendário.`;
  }, '');

const itens = computed(() => (visao.data.value?.itens ?? []).filter((x) => !soAqui.value || x.valeAqui));
const porMes = computed(() =>
  MESES.map((nome, i) => ({
    nome,
    itens: itens.value.filter((x) => (x.datasNoAno[0] ?? '').slice(5, 7) === String(i + 1).padStart(2, '0')),
  })).filter((m) => m.itens.length),
);
const alvo = (x: ItemCalendario) =>
  x.abrangencia === 'nacional'
    ? 'Nacional'
    : x.abrangencia === 'estadual'
      ? `Estadual ${x.ufSigla ?? ''}`
      : x.abrangencia === 'municipal'
        ? `Municipal ${x.municipioNome ?? ''}`
        : (x.estabelecimentoNome ?? 'Estabelecimento');
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
</script>

<template>
  <section class="tela" data-testid="tela-calendario" aria-labelledby="cal-titulo">
    <h1 id="cal-titulo">{{ t('calendario.titulo') }}</h1>
    <div class="barra">
      <button type="button" data-testid="cal-ano-menos" :aria-label="t('calendario.anterior')" @click="ano--">
        {{ '‹' }}
      </button>
      <strong data-testid="cal-ano">{{ ano }}</strong>
      <button type="button" data-testid="cal-ano-mais" :aria-label="t('calendario.seguinte')" @click="ano++">
        {{ '›' }}
      </button>
      <label
        ><input v-model="soAqui" type="checkbox" data-testid="cal-so-aqui" />
        {{ t('calendario.soAqui') }}</label
      >
    </div>
    <MensagemErro v-if="visao.isError.value" :erro="visao.error.value" />
    <p v-else-if="!visao.data.value">{{ t('calendario.carregando') }}</p>
    <div v-else class="grade">
      <div>
        <p class="resumo" data-testid="cal-resumo">
          {{
            t('calendario.resumo', {
              inteiros: visao.data.value.semExpediente.filter((x) => !x.horaInicio).length,
              meios: visao.data.value.semExpediente.filter((x) => x.horaInicio).length,
              ano,
              local: visao.data.value.local.estabelecimentoNome,
            })
          }}
        </p>
        <p v-if="!porMes.length">{{ t('calendario.nenhum') }}</p>
        <div v-for="m in porMes" :key="m.nome" class="mes">
          <h2>{{ m.nome }}</h2>
          <ul>
            <li
              v-for="x in m.itens"
              :key="x.id"
              :class="{ inativo: !x.ativo }"
              :data-testid="`cal-item-${x.id}`"
            >
              <strong>{{ x.datasNoAno.map(dataBr).join(', ') }}</strong>
              {{ x.descricao }}
              <small>
                {{ alvo(x) }}<template v-if="x.facultativo">{{ t('calendario.facultativo') }}</template
                ><template v-if="x.horaInicio">{{ ` · ${x.horaInicio}–${x.horaFim}` }}</template
                ><template v-if="x.recorrencia === 'anual'">{{ t('calendario.todoAno') }}</template
                ><template v-if="!x.ativo">{{ t('calendario.inativo') }}</template>
              </small>
              <span v-if="podeEditar" class="acoes">
                <button type="button" @click="editar(x)">{{ t('calendario.alterar') }}</button>
                <button v-if="x.ativo" type="button" @click="inativar(x)">
                  {{ t('calendario.inativar') }}
                </button>
                <button v-else type="button" @click="reativar(x)">{{ t('calendario.reativar') }}</button>
              </span>
            </li>
          </ul>
        </div>
      </div>
      <form v-if="podeEditar" class="ficha" data-testid="cal-ficha" @submit.prevent="gravar">
        <h2>{{ f.id ? t('calendario.alterarDia') : t('calendario.novoDia') }}</h2>
        <label
          >{{ t('calendario.descricao') }}
          <input v-model="f.descricao" maxlength="150" data-testid="cal-descricao"
        /></label>
        <SanteSelecao
          v-model="f.abrangencia"
          :rotulo="t('calendario.abrangencia')"
          :opcoes="ABRANGENCIAS.map(([v, r]) => ({ valor: v, rotulo: r }))"
          data-testid="cal-abrangencia"
        />
        <SanteSelecao
          v-if="f.abrangencia === 'estadual'"
          v-model="f.ufId"
          :rotulo="t('calendario.uf')"
          :opcoes="visao.data.value.ufs.map((u) => ({ valor: u.id, rotulo: u.sigla }))"
          data-testid="cal-uf"
        />
        <label v-if="f.abrangencia === 'municipal'"
          >{{ t('calendario.municipio') }}
          <input v-model="municipioNome" data-testid="cal-municipio" @input="procurarMunicipio" />
        </label>
        <ul v-if="municipios.length" class="sugestoes">
          <li v-for="m in municipios" :key="m.id">
            <button type="button" @click="escolherMunicipio(m)">{{ m.nome }} ({{ m.uf }})</button>
          </li>
        </ul>
        <SanteSelecao
          v-model="f.recorrencia"
          :rotulo="t('calendario.repeticao')"
          :opcoes="[
            ...RECORRENCIAS.map(([v, r]) => ({ valor: v, rotulo: r })),
            ...(f.recorrencia === 'movel' ? [{ valor: f.recorrencia, rotulo: t('calendario.movel') }] : []),
          ]"
          data-testid="cal-recorrencia"
        />
        <div v-if="f.recorrencia === 'anual'" class="linha">
          <label
            >{{ t('calendario.dia') }}
            <input v-model.number="f.dia" type="number" min="1" max="31" data-testid="cal-dia"
          /></label>
          <SanteSelecao
            v-model="f.mes"
            :rotulo="t('calendario.mes')"
            :opcoes="MESES.map((n, i) => ({ valor: i + 1, rotulo: n }))"
            data-testid="cal-mes"
          />
        </div>
        <label v-else
          >{{ t('calendario.data') }} <input v-model="f.data" type="date" data-testid="cal-data"
        /></label>
        <label
          ><input v-model="f.facultativo" type="checkbox" /> {{ t('calendario.pontoFacultativo') }}</label
        >
        <label
          ><input v-model="meioExpediente" type="checkbox" data-testid="cal-meio" />
          {{ t('calendario.parteDoDia') }}</label
        >
        <div v-if="meioExpediente" class="linha">
          <label
            >{{ t('calendario.de') }} <input v-model="f.horaInicio" type="time" data-testid="cal-hora-inicio"
          /></label>
          <label
            >{{ t('calendario.ate') }} <input v-model="f.horaFim" type="time" data-testid="cal-hora-fim"
          /></label>
        </div>
        <ul v-if="f.descricao && problemas.length" class="problemas" data-testid="cal-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <MensagemErro v-if="erro" :erro="erro" />
        <p v-if="aviso" role="status" data-testid="cal-aviso">{{ aviso }}</p>
        <div class="linha">
          <button type="submit" :disabled="problemas.length > 0" data-testid="cal-gravar">
            {{ t('calendario.gravar') }}
          </button>
          <button type="button" @click="novo">{{ t('calendario.limpar') }}</button>
        </div>
        <fieldset>
          <legend>{{ t('calendario.movelVariosAnos') }}</legend>
          <SanteSelecao
            v-model="movel.base"
            :rotulo="t('calendario.movelVariosAnos')"
            ocultar-rotulo
            :opcoes="BASES.map(([v, r]) => ({ valor: v, rotulo: r }))"
            data-testid="cal-base"
          />
          <label
            >{{ t('calendario.anosAPartir', { ano }) }}
            <input v-model.number="movel.anos" type="number" min="1" max="20"
          /></label>
          <button type="button" data-testid="cal-gerar-moveis" @click="gerar">
            {{ t('calendario.gerar') }}
          </button>
        </fieldset>
      </form>
    </div>
  </section>
</template>

<style scoped>
.barra,
.linha {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.grade {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
  gap: var(--sgh-espaco-3);
}
.mes ul {
  list-style: none;
  padding: 0;
}
.mes li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.inativo {
  opacity: 0.6;
  text-decoration: line-through;
}
.acoes {
  float: right;
  display: inline-flex;
  gap: var(--sgh-espaco-1);
}
.ficha label {
  display: block;
  margin-bottom: var(--sgh-espaco-1);
}
.problemas {
  color: var(--sgh-alerta);
}
</style>
