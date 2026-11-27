<script setup lang="ts">
// Remuneração variável por faixa e por resultado, e rateio da equipe pelas cotas (C2-106, 06-FAT linha 48), na tela de
// regras do repasse. Três blocos numa tela só: as equipes com a composição vigente (nova equipe ou nova composição, com a
// soma das cotas conferida na hora pelo domínio), as regras por faixa (profissional ou equipe, indicador, período,
// fonte pagadora, pacote, eventos de acréscimo e de desconto e as faixas, conferidas na hora pela mesma regra do
// servidor; encerramento sem apagar) e, numa apuração em aberto, a simulação com medida, faixa, valor e partes, com o
// botão de lançar. Combos pelo SanteSelecao; o profissional pela BuscaPrestador (ninguém digita código interno).
import {
  AJUSTES_FAIXA,
  conferirComposicao,
  INDICADORES_VARIAVEL,
  PERIODOS_VARIAVEL,
  ultimoDiaDoMes,
  validarMembroEquipe,
  validarRegraVariavelFaixa,
  type AjusteFaixa,
  type IndicadorVariavel,
  type PeriodoVariavel,
} from '@sgh/dominio-repasse';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  encerrarRegraVariavelFaixa,
  incluirEquipeVariavel,
  incluirRegraVariavelFaixa,
  lancarVariavelFaixa,
  lerPainelVariavelFaixa,
  recomporEquipeVariavel,
  simularVariavelFaixa,
  type EquipeLida,
  type FaixaVariavel,
} from '../api-variavel-faixa.js';
import { reais, usarRepasse } from '../usar-repasse.js';
import BuscaPrestador from './BuscaPrestador.vue';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarRepasse();
const k = (c: string, p?: Record<string, unknown>) => t(`repasse.variavelFaixa.${c}`, p ?? {});
const hoje = computed(() => apoio.data.value?.hoje ?? '');
const podeEditar = computed(() => tem('repasse.regra.propor'));
const podeLancar = computed(() => tem('repasse.lancamento.criar'));
const CHAVE = ['repasse', 'variavel-faixa'];

const painel = useQuery({ queryKey: CHAVE, queryFn: lerPainelVariavelFaixa });
const eventos = computed(() =>
  (painel.data.value?.eventos ?? []).map((e) => ({ valor: String(e.id), rotulo: `${e.codigo} · ${e.nome}` })),
);
const fontes = computed(() => [
  { valor: '', rotulo: k('qualquer') },
  ...(painel.data.value?.fontes ?? []).map((f) => ({ valor: String(f.id), rotulo: f.nome })),
]);
const equipesOpcoes = computed(() =>
  (painel.data.value?.equipes ?? [])
    .filter((e) => e.ativo)
    .map((e) => ({ valor: String(e.id), rotulo: `${e.codigo} · ${e.nome}` })),
);
const apuracoes = computed(() =>
  (painel.data.value?.apuracoes ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: `${a.numero} · ${a.competencia.slice(0, 7)} · ${a.situacao}`,
  })),
);
const indicadores = computed(() =>
  INDICADORES_VARIAVEL.map((i) => ({ valor: i, rotulo: k(`regra.indicadores.${i}`) })),
);
const periodos = computed(() =>
  PERIODOS_VARIAVEL.map((p) => ({ valor: p, rotulo: k(`regra.periodos.${p}`) })),
);
const ajustes = computed(() => AJUSTES_FAIXA.map((a) => ({ valor: a, rotulo: k(`regra.ajustes.${a}`) })));
const beneficiarios = computed(() => [
  { valor: 'profissional', rotulo: k('regra.paraProfissional') },
  { valor: 'equipe', rotulo: k('regra.paraEquipe') },
]);
const n = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/\./g, '').replace(',', '.')));
const nOuNulo = (v: string) => (v.trim() === '' ? null : n(v));
const pct = (v: number) => `${String(v).replace('.', ',')}%`;
const nomeEquipe = (id: number | null) => painel.data.value?.equipes.find((e) => e.id === id)?.nome ?? '—';

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function acao(fn: () => Promise<unknown>, texto: string): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await fn();
    mensagem.value = texto;
    await qc.invalidateQueries({ queryKey: CHAVE });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Equipe: nova ou nova composição de uma existente ──
interface MembroForm {
  profissional: number;
  cota: number;
  chefe: boolean;
}
const recompondo = ref<EquipeLida | null>(null);
const equipe = reactive({ codigo: '', nome: '', descricao: '', inicio: '' });
const membros = ref<MembroForm[]>([]);
const novoMembro = reactive({ profissional: '', cota: '', chefe: false });
watch(hoje, (h) => {
  if (!equipe.inicio) equipe.inicio = h;
});
const somaCotas = computed(() => Math.round(membros.value.reduce((s, m) => s + m.cota, 0) * 10_000) / 10_000);
const problemasNovoMembro = computed(() =>
  Number(novoMembro.profissional) > 0
    ? validarMembroEquipe({
        profissional: Number(novoMembro.profissional),
        terceiro: null,
        cota: n(novoMembro.cota),
        chefe: novoMembro.chefe,
        inicio: equipe.inicio,
        fim: null,
      }).map((p) => p.mensagem)
    : [k('equipe.semMembro')],
);
function adicionarMembro() {
  if (problemasNovoMembro.value.length) return;
  membros.value.push({
    profissional: Number(novoMembro.profissional),
    cota: n(novoMembro.cota),
    chefe: novoMembro.chefe,
  });
  Object.assign(novoMembro, { profissional: '', cota: '', chefe: false });
}
// A composição como ficará no início informado, pela mesma conferência do servidor.
const problemasEquipe = computed(() => {
  const p = membros.value.length
    ? conferirComposicao(
        membros.value.map((m) => ({ ...m, terceiro: null, inicio: equipe.inicio, fim: null })),
        equipe.inicio || hoje.value,
      ).map((x) => x.mensagem)
    : [];
  if (!membros.value.length) p.push(k('equipe.semMembro'));
  if (!recompondo.value && (!equipe.codigo.trim() || !equipe.nome.trim())) p.push(k('equipe.semNome'));
  return p;
});
function recompor(e: EquipeLida) {
  recompondo.value = e;
  membros.value = e.membros
    .filter((m) => m.profissional !== null && m.fim === null)
    .map((m) => ({ profissional: m.profissional!, cota: m.cota, chefe: m.chefe }));
  equipe.inicio = hoje.value;
}
function cancelarEquipe() {
  recompondo.value = null;
  membros.value = [];
  Object.assign(equipe, { codigo: '', nome: '', descricao: '', inicio: hoje.value });
}
function gravarEquipe() {
  if (problemasEquipe.value.length) return;
  const corpoMembros = membros.value.map((m) => ({
    profissional: m.profissional,
    cota: m.cota,
    chefe: m.chefe,
  }));
  const alvo = recompondo.value;
  void acao(async () => {
    if (alvo)
      await recomporEquipeVariavel(alvo.id, {
        versao: alvo.versao,
        inicio: equipe.inicio,
        membros: corpoMembros,
      });
    else
      await incluirEquipeVariavel({
        codigo: equipe.codigo.trim(),
        nome: equipe.nome.trim(),
        descricao: equipe.descricao.trim() || null,
        inicio: equipe.inicio,
        membros: corpoMembros,
      });
    cancelarEquipe();
  }, k('gravado'));
}

// ── Regra por faixa ──
interface FaixaForm {
  de: string;
  ate: string;
  ajuste: AjusteFaixa;
  percentual: string;
  valorFixo: string;
  incremento: string;
  sobreLiquido: boolean;
}
const faixaVazia = (): FaixaForm => ({
  de: '',
  ate: '',
  ajuste: 'acrescimo',
  percentual: '',
  valorFixo: '',
  incremento: '',
  sobreLiquido: false,
});
const regra = reactive({
  codigo: '',
  descricao: '',
  beneficiario: 'profissional',
  profissional: '',
  equipe: '',
  indicador: 'quantidade_procedimentos' as IndicadorVariavel,
  periodo: 'mensal' as PeriodoVariavel,
  fonte: '',
  considerarPacote: false,
  percentualPacote: '',
  evento: '',
  eventoDesconto: '',
  inicio: '',
  fim: '',
});
const faixas = ref<FaixaForm[]>([faixaVazia()]);
watch(eventos, (lista) => {
  if (!regra.evento) regra.evento = lista[0]?.valor ?? '';
});
watch(hoje, (h) => {
  if (!regra.inicio) regra.inicio = h;
});
const faixasLidas = computed<FaixaVariavel[]>(() =>
  faixas.value.map((f) => ({
    de: n(f.de),
    ate: nOuNulo(f.ate),
    ajuste: f.ajuste,
    percentual: nOuNulo(f.percentual),
    valorFixo: nOuNulo(f.valorFixo),
    incremento: nOuNulo(f.incremento),
    sobreLiquido: f.sobreLiquido,
  })),
);
const corpoRegra = computed(() => ({
  codigo: regra.codigo.trim(),
  descricao: regra.descricao.trim(),
  profissional: regra.beneficiario === 'profissional' ? Number(regra.profissional) || null : null,
  equipe: regra.beneficiario === 'equipe' ? Number(regra.equipe) || null : null,
  indicador: regra.indicador,
  periodo: regra.periodo,
  fontePagadora: Number(regra.fonte) || null,
  considerarPacote: regra.considerarPacote,
  percentualPacote: regra.considerarPacote ? nOuNulo(regra.percentualPacote) : null,
  evento: Number(regra.evento),
  eventoDesconto: Number(regra.eventoDesconto) || null,
  inicio: regra.inicio,
  fim: regra.fim || null,
  faixas: faixasLidas.value,
}));
const problemasRegra = computed(() => {
  const p = validarRegraVariavelFaixa(corpoRegra.value).map((x) => x.mensagem);
  if (!regra.evento) p.push(k('regra.semEvento'));
  return p;
});
function gravarRegra() {
  if (problemasRegra.value.length) return;
  void acao(async () => {
    await incluirRegraVariavelFaixa(corpoRegra.value);
    Object.assign(regra, { codigo: '', descricao: '', profissional: '', fim: '', percentualPacote: '' });
    faixas.value = [faixaVazia()];
  }, k('gravado'));
}
const fimEncerrar = reactive<Record<number, string>>({});
function encerrar(id: number, versao: number) {
  void acao(() => encerrarRegraVariavelFaixa(id, versao, fimEncerrar[id] || hoje.value), k('encerrado'));
}
const contaFaixa = (f: FaixaVariavel) =>
  [
    f.percentual !== null ? pct(f.percentual) : '',
    f.incremento !== null ? `+${pct(f.incremento)}` : '',
    f.valorFixo !== null ? reais(f.valorFixo) : '',
    f.sobreLiquido ? `(${k('regra.sobreLiquido').toLowerCase()})` : '',
  ]
    .filter(Boolean)
    .join(' ');

// ── Apuração ──
const apuracao = ref('');
const simulacao = useQuery({
  queryKey: computed(() => [...CHAVE, 'sim', apuracao.value]),
  queryFn: () => simularVariavelFaixa(Number(apuracao.value)),
  enabled: computed(() => Number(apuracao.value) > 0),
});
const aLancar = computed(() =>
  (simulacao.data.value?.regras ?? []).some(
    (r) => r.fecha && r.partes.some((p) => !p.lancado && p.valor !== 0),
  ),
);
async function lancar() {
  let r = { lancamentos: 0, credito: 0, debito: 0, pendencias: [] as string[] };
  const ok = await acao(async () => {
    r = await lancarVariavelFaixa(Number(apuracao.value));
  }, '');
  if (ok)
    mensagem.value = k('apuracao.lancou', {
      lancamentos: r.lancamentos,
      credito: reais(r.credito),
      debito: reais(r.debito),
    });
}
</script>

<template>
  <section class="painel" aria-labelledby="vf-titulo" data-testid="vf-variavel-faixa">
    <h2 id="vf-titulo">{{ k('secao') }}</h2>
    <p>{{ k('resumo') }}</p>
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <template v-if="painel.data.value">
      <h3>{{ k('equipe.titulo') }}</h3>
      <p>{{ k('equipe.explica') }}</p>
      <table v-if="painel.data.value.equipes.length" class="tabela" data-testid="vf-equipes">
        <thead>
          <tr>
            <th scope="col">{{ k('equipe.nome') }}</th>
            <th scope="col">{{ k('equipe.membros') }}</th>
            <th scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in painel.data.value.equipes" :key="e.id" :data-testid="`vf-equipe-${e.id}`">
            <td>{{ `${e.codigo} · ${e.nome}` }}</td>
            <td>
              <ul>
                <li v-for="m in e.membros.filter((x) => x.fim === null || x.fim >= hoje)" :key="m.id">
                  {{ `${m.nome} · ${pct(m.cota)}` }}<strong v-if="m.chefe"> ({{ k('equipe.chefe') }})</strong>
                </li>
              </ul>
            </td>
            <td>
              <button
                v-if="podeEditar && e.ativo"
                type="button"
                :disabled="gravando"
                :data-testid="`vf-recompor-${e.id}`"
                @click="recompor(e)"
              >
                {{ k('equipe.recompor') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.nenhum') }}</p>

      <form v-if="podeEditar" class="formulario" data-testid="vf-form-equipe" @submit.prevent="gravarEquipe">
        <h4>{{ recompondo ? k('equipe.recomporDe', { nome: recompondo.nome }) : k('equipe.nova') }}</h4>
        <template v-if="!recompondo">
          <span class="campo">
            <label for="vf-eq-codigo">{{ k('equipe.codigo') }}</label>
            <input id="vf-eq-codigo" v-model="equipe.codigo" maxlength="30" data-testid="vf-equipe-codigo" />
          </span>
          <span class="campo">
            <label for="vf-eq-nome">{{ k('equipe.nome') }}</label>
            <input id="vf-eq-nome" v-model="equipe.nome" maxlength="150" data-testid="vf-equipe-nome" />
          </span>
          <span class="campo">
            <label for="vf-eq-desc">{{ k('equipe.descricao') }}</label>
            <input
              id="vf-eq-desc"
              v-model="equipe.descricao"
              maxlength="500"
              data-testid="vf-equipe-descricao"
            />
          </span>
        </template>
        <span class="campo">
          <label for="vf-eq-inicio">{{ k('inicio') }}</label>
          <input id="vf-eq-inicio" v-model="equipe.inicio" type="date" data-testid="vf-equipe-inicio" />
        </span>
        <ol v-if="membros.length" data-testid="vf-membros">
          <li v-for="(m, i) in membros" :key="i" :data-testid="`vf-membro-${i}`">
            {{ k('equipe.membroN', { n: i + 1 }) }} · {{ pct(m.cota) }}
            <strong v-if="m.chefe">({{ k('equipe.chefe') }})</strong>
            <button type="button" :data-testid="`vf-membro-remover-${i}`" @click="membros.splice(i, 1)">
              {{ k('remover') }}
            </button>
          </li>
        </ol>
        <p role="status" data-testid="vf-soma-cotas">
          {{ k('equipe.somaCotas', { soma: String(somaCotas).replace('.', ',') }) }}
        </p>
        <fieldset>
          <legend>{{ k('equipe.adicionar') }}</legend>
          <BuscaPrestador v-model="novoMembro.profissional" :rotulo="k('equipe.membro')" testid="vf-membro" />
          <span class="campo">
            <label for="vf-membro-cota">{{ k('equipe.cota') }}</label>
            <input
              id="vf-membro-cota"
              v-model="novoMembro.cota"
              inputmode="decimal"
              data-testid="vf-membro-cota"
            />
          </span>
          <span class="campo">
            <input
              id="vf-membro-chefe"
              v-model="novoMembro.chefe"
              type="checkbox"
              data-testid="vf-membro-chefe"
            />
            <label for="vf-membro-chefe">{{ k('equipe.chefe') }}</label>
          </span>
          <button
            type="button"
            :disabled="problemasNovoMembro.length > 0"
            data-testid="vf-membro-adicionar"
            @click="adicionarMembro"
          >
            {{ k('equipe.adicionar') }}
          </button>
        </fieldset>
        <!-- role="status" no invólucro: na própria lista ele tira a semântica de lista (axe listitem). -->
        <div v-if="problemasEquipe.length" role="status">
          <ul data-testid="vf-equipe-problemas">
            <li v-for="p in problemasEquipe" :key="p">{{ p }}</li>
          </ul>
        </div>
        <button
          type="submit"
          :disabled="gravando || problemasEquipe.length > 0"
          data-testid="vf-equipe-gravar"
        >
          {{ recompondo ? k('equipe.gravarRecomposicao') : k('incluir') }}
        </button>
        <button v-if="recompondo" type="button" data-testid="vf-equipe-cancelar" @click="cancelarEquipe">
          {{ k('equipe.cancelar') }}
        </button>
      </form>

      <h3>{{ k('regra.titulo') }}</h3>
      <p>{{ k('regra.explica') }}</p>
      <table v-if="painel.data.value.regras.length" class="tabela" data-testid="vf-regras">
        <thead>
          <tr>
            <th scope="col">{{ k('regra.descricao') }}</th>
            <th scope="col">{{ k('regra.beneficiario') }}</th>
            <th scope="col">{{ k('regra.indicador') }}</th>
            <th scope="col">{{ k('regra.faixas') }}</th>
            <th scope="col">{{ k('vigencia') }}</th>
            <th scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in painel.data.value.regras" :key="r.id" :data-testid="`vf-regra-${r.id}`">
            <td>{{ `${r.codigo} · ${r.descricao}` }}</td>
            <td>{{ r.equipe !== null ? nomeEquipe(r.equipe) : r.beneficiario }}</td>
            <td>{{ `${k(`regra.indicadores.${r.indicador}`)} · ${k(`regra.periodos.${r.periodo}`)}` }}</td>
            <td>
              <ul>
                <li v-for="(f, i) in r.faixas" :key="i">
                  {{
                    k('regra.faixaResumo', {
                      de: f.de,
                      ate: f.ate ?? '∞',
                      ajuste: k(`regra.ajustes.${f.ajuste}`),
                      conta: contaFaixa(f),
                    })
                  }}
                </li>
              </ul>
            </td>
            <td>{{ `${r.inicio} – ${r.fim ?? k('semFim')}` }}</td>
            <td>
              <template v-if="podeEditar && (r.fim === null || r.fim > hoje)">
                <label class="visualmente-oculto" :for="`vf-fim-${r.id}`">{{ k('encerrarEm') }}</label>
                <input
                  :id="`vf-fim-${r.id}`"
                  v-model="fimEncerrar[r.id]"
                  type="date"
                  :data-testid="`vf-fim-${r.id}`"
                />
                <button
                  type="button"
                  :disabled="gravando"
                  :data-testid="`vf-encerrar-${r.id}`"
                  @click="encerrar(r.id, r.versao)"
                >
                  {{ k('encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.nenhum') }}</p>

      <form v-if="podeEditar" class="formulario" data-testid="vf-form-regra" @submit.prevent="gravarRegra">
        <span class="campo">
          <label for="vf-rg-codigo">{{ k('regra.codigo') }}</label>
          <input id="vf-rg-codigo" v-model="regra.codigo" maxlength="30" data-testid="vf-regra-codigo" />
        </span>
        <span class="campo">
          <label for="vf-rg-desc">{{ k('regra.descricao') }}</label>
          <input id="vf-rg-desc" v-model="regra.descricao" maxlength="150" data-testid="vf-regra-descricao" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.beneficiario"
            :rotulo="k('regra.beneficiario')"
            :opcoes="beneficiarios"
            data-testid="vf-regra-beneficiario"
          />
        </span>
        <BuscaPrestador
          v-if="regra.beneficiario === 'profissional'"
          v-model="regra.profissional"
          :rotulo="k('regra.profissional')"
          testid="vf-regra-profissional"
        />
        <span v-else class="campo">
          <SanteSelecao
            v-model="regra.equipe"
            :rotulo="k('regra.equipe')"
            :opcoes="equipesOpcoes"
            data-testid="vf-regra-equipe"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.indicador"
            :rotulo="k('regra.indicador')"
            :opcoes="indicadores"
            data-testid="vf-regra-indicador"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.periodo"
            :rotulo="k('regra.periodo')"
            :opcoes="periodos"
            data-testid="vf-regra-periodo"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.fonte"
            :rotulo="k('regra.fonte')"
            :opcoes="fontes"
            data-testid="vf-regra-fonte"
          />
        </span>
        <span class="campo">
          <input
            id="vf-rg-pacote"
            v-model="regra.considerarPacote"
            type="checkbox"
            data-testid="vf-regra-pacote"
          />
          <label for="vf-rg-pacote">{{ k('regra.pacote') }}</label>
        </span>
        <span v-if="regra.considerarPacote" class="campo">
          <label for="vf-rg-pp">{{ k('regra.percentualPacote') }}</label>
          <input
            id="vf-rg-pp"
            v-model="regra.percentualPacote"
            inputmode="decimal"
            data-testid="vf-regra-percentual-pacote"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.evento"
            :rotulo="k('regra.evento')"
            :opcoes="eventos"
            data-testid="vf-regra-evento"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.eventoDesconto"
            :rotulo="k('regra.eventoDesconto')"
            :opcoes="[{ valor: '', rotulo: '—' }, ...eventos]"
            data-testid="vf-regra-evento-desconto"
          />
        </span>
        <span class="campo">
          <label for="vf-rg-inicio">{{ k('inicio') }}</label>
          <input id="vf-rg-inicio" v-model="regra.inicio" type="date" data-testid="vf-regra-inicio" />
        </span>
        <span class="campo">
          <label for="vf-rg-fim">{{ k('fimOpcional') }}</label>
          <input id="vf-rg-fim" v-model="regra.fim" type="date" data-testid="vf-regra-fim" />
        </span>
        <fieldset data-testid="vf-faixas">
          <legend>{{ k('regra.faixas') }}</legend>
          <div v-for="(f, i) in faixas" :key="i" class="formulario" :data-testid="`vf-faixa-${i}`">
            <span class="campo">
              <label :for="`vf-fx-de-${i}`">{{ k('regra.de') }}</label>
              <input
                :id="`vf-fx-de-${i}`"
                v-model="f.de"
                inputmode="decimal"
                :data-testid="`vf-faixa-${i}-de`"
              />
            </span>
            <span class="campo">
              <label :for="`vf-fx-ate-${i}`">{{ k('regra.ate') }}</label>
              <input
                :id="`vf-fx-ate-${i}`"
                v-model="f.ate"
                inputmode="decimal"
                :data-testid="`vf-faixa-${i}-ate`"
              />
            </span>
            <span class="campo">
              <SanteSelecao
                v-model="f.ajuste"
                :rotulo="k('regra.ajuste')"
                :opcoes="ajustes"
                :data-testid="`vf-faixa-${i}-ajuste`"
              />
            </span>
            <span class="campo">
              <label :for="`vf-fx-pct-${i}`">{{ k('regra.percentual') }}</label>
              <input
                :id="`vf-fx-pct-${i}`"
                v-model="f.percentual"
                inputmode="decimal"
                :data-testid="`vf-faixa-${i}-percentual`"
              />
            </span>
            <span class="campo">
              <label :for="`vf-fx-fixo-${i}`">{{ k('regra.valorFixo') }}</label>
              <input
                :id="`vf-fx-fixo-${i}`"
                v-model="f.valorFixo"
                inputmode="decimal"
                :data-testid="`vf-faixa-${i}-valor-fixo`"
              />
            </span>
            <span class="campo">
              <label :for="`vf-fx-inc-${i}`">{{ k('regra.incremento') }}</label>
              <input
                :id="`vf-fx-inc-${i}`"
                v-model="f.incremento"
                inputmode="decimal"
                :data-testid="`vf-faixa-${i}-incremento`"
              />
            </span>
            <span class="campo">
              <input
                :id="`vf-fx-liq-${i}`"
                v-model="f.sobreLiquido"
                type="checkbox"
                :data-testid="`vf-faixa-${i}-liquido`"
              />
              <label :for="`vf-fx-liq-${i}`">{{ k('regra.sobreLiquido') }}</label>
            </span>
            <button
              v-if="faixas.length > 1"
              type="button"
              :data-testid="`vf-faixa-${i}-remover`"
              @click="faixas.splice(i, 1)"
            >
              {{ k('remover') }}
            </button>
          </div>
          <button
            type="button"
            :disabled="faixas.length >= 20"
            data-testid="vf-faixa-adicionar"
            @click="faixas.push(faixaVazia())"
          >
            {{ k('regra.adicionarFaixa') }}
          </button>
        </fieldset>
        <!-- role="status" no invólucro: na própria lista ele tira a semântica de lista (axe listitem). -->
        <div v-if="problemasRegra.length" role="status">
          <ul data-testid="vf-regra-problemas">
            <li v-for="p in problemasRegra" :key="p">{{ p }}</li>
          </ul>
        </div>
        <button
          type="submit"
          :disabled="gravando || problemasRegra.length > 0"
          data-testid="vf-regra-incluir"
        >
          {{ k('incluir') }}
        </button>
      </form>

      <h3>{{ k('apuracao.titulo') }}</h3>
      <span class="campo">
        <SanteSelecao
          v-if="apuracoes.length"
          v-model="apuracao"
          :rotulo="k('apuracao.escolher')"
          :opcoes="apuracoes"
          data-testid="vf-apuracao"
        />
        <small v-else role="status">{{ k('apuracao.nenhuma') }}</small>
      </span>
      <ErroFaturamento v-if="simulacao.error.value" :erro="simulacao.error.value" />
      <div v-if="simulacao.data.value" data-testid="vf-simulacao">
        <table v-if="simulacao.data.value.regras.length" class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ k('regra.descricao') }}</th>
              <th scope="col">{{ k('apuracao.medida') }}</th>
              <th scope="col">{{ k('apuracao.faixa') }}</th>
              <th scope="col">{{ k('apuracao.valor') }}</th>
              <th scope="col">{{ k('apuracao.partes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in simulacao.data.value.regras" :key="r.regra" :data-testid="`vf-sim-${r.regra}`">
              <th scope="row">
                {{ `${r.codigo} · ${r.descricao}` }}
                <small>
                  {{ k('apuracao.periodo', { de: r.periodoInicio, ate: ultimoDiaDoMes(r.periodoFim) }) }}
                  <template v-if="!r.fecha"> · {{ k('apuracao.naoFecha') }}</template>
                </small>
              </th>
              <td :data-testid="`vf-sim-${r.regra}-medida`">{{ r.medida }}</td>
              <td :data-testid="`vf-sim-${r.regra}-faixa`">
                {{ r.faixa ?? k('apuracao.semFaixa') }}<small> · {{ r.memoria }}</small>
              </td>
              <td :data-testid="`vf-sim-${r.regra}-valor`">{{ reais(r.valor) }}</td>
              <td>
                <ul>
                  <li v-for="(p, i) in r.partes" :key="i" :data-testid="`vf-sim-${r.regra}-parte-${i}`">
                    {{ `${p.nome} · ${pct(p.cota)} · ${reais(p.valor)} · ` }}
                    {{ p.lancado ? k('apuracao.lancado') : k('apuracao.aLancar') }}
                  </li>
                </ul>
                <!-- role="status" no invólucro: na própria lista ele tira a semântica de lista (axe listitem). -->
                <div v-if="r.pendencias.length" role="status">
                  <ul :data-testid="`vf-sim-${r.regra}-pendencias`">
                    <li v-for="p in r.pendencias" :key="p">{{ p }}</li>
                  </ul>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ k('apuracao.nenhumaRegra') }}</p>
        <button
          v-if="podeLancar"
          type="button"
          :disabled="gravando || !aLancar"
          data-testid="vf-lancar"
          @click="void lancar()"
        >
          {{ k('apuracao.lancar') }}
        </button>
      </div>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="vf-mensagem" />
  </section>
</template>
