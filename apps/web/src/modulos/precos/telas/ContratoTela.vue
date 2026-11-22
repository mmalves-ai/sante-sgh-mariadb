<script setup lang="ts">
// Contrato do convênio em abas (M12, ficha seção 7): cadastro, tabelas e índices, modificadores,
// faturabilidade, pacotes, TISS e financeiro, com as colunas variáveis entre os convênios ativos (as
// constantes ficam ocultas e nunca são editadas; regra 6), os códigos "a confirmar" (regra 7) e, para quem
// tem a permissão, a edição das abas de cadastro, faturabilidade e financeiro (justificativa e a senha de
// novo), suspender e reativar com o impacto, e os planos e vigências do contrato registrados no sistema novo.
import type { AbaContratoDescrita, CampoContratoDescrito, ImpactoSituacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import ConfirmacaoCritica from '../componentes/ConfirmacaoCritica.vue';
import OpcoesCredenciamentoConvenio from '../componentes/OpcoesCredenciamentoConvenio.vue';
import {
  alterarContrato,
  alterarSituacao,
  buscarContrato,
  buscarImpactoSituacao,
  buscarModificadores,
  alterarPlano,
  gravarPlano,
} from '../api-precos.js';

const props = defineProps<{ cod: string }>();
const { t } = useI18n();
const rota = useRoute();
const codigo = computed(() => Number(props.cod));
const consulta = useQuery({
  queryKey: computed(() => ['contrato', codigo.value]),
  queryFn: () => buscarContrato(codigo.value),
});
const c = computed(() => consulta.data.value ?? null);

const pedida = typeof rota.query['aba'] === 'string' ? rota.query['aba'] : 'cadastro';
const abaAtiva = ref<AbaContratoDescrita['id']>(
  (pedida === 'indices' ? 'tabelas' : pedida) as AbaContratoDescrita['id'],
);
const aba = computed(() => c.value?.abas.find((a) => a.id === abaAtiva.value) ?? c.value?.abas[0] ?? null);
const botoesAba = ref<HTMLButtonElement[]>([]);
async function teclaAba(e: KeyboardEvent, i: number): Promise<void> {
  const abas = c.value?.abas ?? [];
  const n = abas.length;
  const j =
    e.key === 'ArrowRight'
      ? (i + 1) % n
      : e.key === 'ArrowLeft'
        ? (i - 1 + n) % n
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? n - 1
            : -1;
  if (j < 0) return;
  e.preventDefault();
  abaAtiva.value = abas[j]?.id ?? abaAtiva.value;
  await nextTick();
  botoesAba.value[j]?.focus();
}

const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 409].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
const fmt = (campo: CampoContratoDescrito) =>
  campo.valor === null || campo.valor === ''
    ? t('precos.contrato.vazio')
    : (campo.opcoes?.find((o) => o.valor === String(campo.valor))?.rotulo ??
      (typeof campo.valor === 'number'
        ? campo.valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
        : campo.valor));

// ── Edição de aba ──
const editando = ref(false);
const form = reactive<Record<string, string | number>>({});
const critica = reactive({ justificativa: '', senha: '' });
const opcoesCampo = (x: CampoContratoDescrito) => [
  { valor: '', rotulo: t('precos.contrato.vazio') },
  ...(x.opcoes ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
];
function editar(): void {
  if (!aba.value) return;
  for (const k of Object.keys(form)) delete form[k];
  for (const x of aba.value.campos.filter((y) => y.editavel))
    form[x.campo] = x.valor === null ? '' : String(x.valor);
  critica.justificativa = '';
  critica.senha = '';
  recusa.value = null;
  editando.value = true;
}
async function salvar(): Promise<void> {
  if (!aba.value || !c.value) return;
  recusa.value = null;
  erro.value = null;
  const valores: Record<string, string | number | null> = {};
  const lidos: Record<string, string | number | null> = {};
  for (const x of aba.value.campos.filter((y) => y.editavel)) {
    const antes = x.valor === null ? '' : String(x.valor);
    // v-model de input number entrega número: compara como texto.
    const agora = String(form[x.campo] ?? '').trim();
    if (agora === antes) continue;
    valores[x.campo] =
      x.tipo === 'inteiro' ? (agora === '' ? null : Number(agora)) : agora === '' ? null : agora;
    lidos[x.campo] = x.valor;
  }
  try {
    const r = await alterarContrato(c.value.codigo, {
      aba: aba.value.id as 'cadastro' | 'faturabilidade' | 'financeiro',
      valores,
      lidos,
      justificativa: critica.justificativa,
      senha: critica.senha,
    });
    mensagem.value = `${t('precos.contrato.salvo')} ${r.mensagem}`;
    editando.value = false;
    await consulta.refetch();
  } catch (e) {
    tratar(e);
  }
}

// ── Situação ──
const situacaoAberta = ref(false);
const impacto = ref<ImpactoSituacao | null>(null);
const sit = reactive({ justificativa: '', senha: '' });
const operacaoSituacao = computed(
  () => (c.value?.situacao === 'A' ? 'suspender' : 'reativar') as 'suspender' | 'reativar',
);
async function abrirSituacao(): Promise<void> {
  if (!c.value) return;
  recusa.value = null;
  sit.justificativa = '';
  sit.senha = '';
  impacto.value = await buscarImpactoSituacao(c.value.codigo, operacaoSituacao.value).catch((e) => {
    tratar(e);
    return null;
  });
  situacaoAberta.value = true;
}
async function confirmarSituacao(): Promise<void> {
  if (!c.value) return;
  recusa.value = null;
  try {
    const r = await alterarSituacao(c.value.codigo, operacaoSituacao.value, sit.justificativa, sit.senha);
    mensagem.value = r.mensagem;
    situacaoAberta.value = false;
    await consulta.refetch();
  } catch (e) {
    tratar(e);
  }
}

// ── Planos ──
const plano = reactive({ nome: '', planoLegado: '', inicio: '', fim: '', justificativa: '', senha: '' });
const planoAberto = ref(false);
async function salvarPlano(): Promise<void> {
  if (!c.value) return;
  recusa.value = null;
  try {
    await gravarPlano(c.value.codigo, {
      nome: plano.nome,
      planoLegado: plano.planoLegado ? Number(plano.planoLegado) : null,
      inicio: plano.inicio,
      fim: plano.fim || null,
      justificativa: plano.justificativa,
      senha: plano.senha,
    });
    mensagem.value = t('precos.contrato.planoGravado');
    planoAberto.value = false;
    await consulta.refetch();
  } catch (e) {
    tratar(e);
  }
}

// Corrigir, encerrar ou desativar um plano (nunca apagar): só o que mudou vai à API, com a versão lida.
const planoEditado = ref<number | null>(null);
const edicaoPlano = reactive({ nome: '', fim: '', ativo: true, justificativa: '', senha: '' });
function editarPlano(p: { id: number; nome: string; fim: string | null; ativo: boolean }): void {
  planoEditado.value = p.id;
  Object.assign(edicaoPlano, {
    nome: p.nome,
    fim: p.fim ?? '',
    ativo: p.ativo,
    justificativa: '',
    senha: '',
  });
}
async function salvarEdicaoPlano(): Promise<void> {
  const p = c.value?.planos.find((x) => x.id === planoEditado.value);
  if (!c.value || !p) return;
  recusa.value = null;
  try {
    await alterarPlano(c.value.codigo, p.id, {
      versao: p.versao,
      ...(edicaoPlano.nome !== p.nome ? { nome: edicaoPlano.nome } : {}),
      ...((edicaoPlano.fim || null) !== p.fim ? { fim: edicaoPlano.fim || null } : {}),
      ...(edicaoPlano.ativo !== p.ativo ? { ativo: edicaoPlano.ativo } : {}),
      justificativa: edicaoPlano.justificativa,
      senha: edicaoPlano.senha,
    });
    mensagem.value = t('precos.contrato.planoAlterado');
    planoEditado.value = null;
    await consulta.refetch();
  } catch (e) {
    tratar(e);
  }
}

// ── Modificadores ──
const tipoMod = ref('honorarios');
const paginaMod = ref(0);
const mods = useQuery({
  queryKey: computed(() => ['modificadores', codigo.value, tipoMod.value, paginaMod.value]),
  queryFn: () => buscarModificadores(codigo.value, tipoMod.value, paginaMod.value),
  enabled: computed(() => abaAtiva.value === 'modificadores'),
});
// Pacotes (composição) e o calendário de entrega e pagamento, nas abas de consulta.
const extra = useQuery({
  queryKey: computed(() => [
    'modificadores',
    codigo.value,
    abaAtiva.value === 'pacotes' ? 'pacotes' : 'entregas',
    0,
  ]),
  queryFn: () => buscarModificadores(codigo.value, abaAtiva.value === 'pacotes' ? 'pacotes' : 'entregas', 0),
  enabled: computed(() => abaAtiva.value === 'pacotes' || abaAtiva.value === 'financeiro'),
});
watch(tipoMod, () => (paginaMod.value = 0));
const TIPOS_MOD = [
  'honorarios',
  'matmed',
  'referencia',
  'planos',
  'formulas',
  'horarios',
  'subgrupos',
] as const;
const opcoesTipoMod = computed(() =>
  TIPOS_MOD.map((x) => ({ valor: x as string, rotulo: t(`precos.contrato.tiposModificador.${x}`) })),
);
</script>

<template>
  <section class="tela" aria-labelledby="contrato-titulo">
    <p>
      <router-link to="/cadastros/convenios">{{ t('precos.contrato.voltar') }}</router-link>
    </p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('precos.comum.carregando') }}</p>
    <template v-else-if="c">
      <h1 id="contrato-titulo">{{ t('precos.contrato.titulo', { codigo: c.codigo, nome: c.nome }) }}</h1>
      <p data-testid="contrato-aceite">
        {{
          c.aceitaAtendimento.aceita
            ? t('precos.contrato.aceita')
            : t('precos.contrato.naoAceita', { motivo: c.aceitaAtendimento.motivo ?? '' })
        }}
      </p>
      <p>{{ t('precos.contrato.constantes', { n: c.constantesOcultas }) }}</p>
      <SanteAlerta
        v-if="!c.gravacao.permitida && c.gravacao.motivo"
        :texto="t('precos.comum.gravacaoDesligada', { motivo: c.gravacao.motivo })"
        variante="info"
      />
      <p v-if="mensagem" role="status" data-testid="mensagem-contrato">{{ mensagem }}</p>
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-contrato" />
      <MensagemErro v-if="erro" :erro="erro" />
      <div v-if="c.permissoes.alterarSituacao" class="botoes">
        <SanteBotao
          :rotulo="c.situacao === 'A' ? t('precos.contrato.suspender') : t('precos.contrato.reativar')"
          variante="secundario"
          data-testid="botao-situacao"
          @acionar="abrirSituacao"
        />
      </div>
      <section
        v-if="situacaoAberta && impacto"
        class="painel"
        aria-labelledby="situacao-titulo"
        data-testid="painel-situacao"
      >
        <h2 id="situacao-titulo">{{ t('precos.contrato.impacto') }}</h2>
        <ul>
          <li v-for="a in impacto.alertas" :key="a">{{ a }}</li>
        </ul>
        <SanteAlerta v-if="impacto.recusa" :texto="impacto.recusa" variante="aviso" />
        <form class="form" @submit.prevent="confirmarSituacao">
          <ConfirmacaoCritica
            v-model:justificativa="sit.justificativa"
            v-model:senha="sit.senha"
            testid="situacao"
          />
          <div class="botoes">
            <SanteBotao
              :rotulo="t('precos.contrato.confirmarSituacao')"
              tipo="submit"
              data-testid="confirmar-situacao"
            />
            <SanteBotao
              :rotulo="t('precos.comum.cancelar')"
              variante="texto"
              @acionar="situacaoAberta = false"
            />
          </div>
        </form>
      </section>

      <div role="tablist" :aria-label="t('precos.contrato.abas')" class="abas">
        <button
          v-for="(a, i) in c.abas"
          :id="`aba-${a.id}`"
          :key="a.id"
          ref="botoesAba"
          type="button"
          role="tab"
          :aria-selected="abaAtiva === a.id"
          :aria-controls="`painel-${a.id}`"
          :tabindex="abaAtiva === a.id ? 0 : -1"
          :data-testid="`aba-${a.id}`"
          @click="
            abaAtiva = a.id;
            editando = false;
          "
          @keydown="teclaAba($event, i)"
        >
          {{ t(`precos.contrato.abasNomes.${a.id}`) }}
        </button>
      </div>
      <div
        v-if="aba"
        :id="`painel-${aba.id}`"
        role="tabpanel"
        :aria-labelledby="`aba-${aba.id}`"
        tabindex="0"
        class="painel"
        :data-testid="`painel-${aba.id}`"
      >
        <p v-if="!aba.editavel && ['tabelas', 'modificadores', 'pacotes', 'tiss'].includes(aba.id)">
          {{ t('precos.contrato.consulta') }}
        </p>
        <SanteBotao
          v-if="aba.editavel && !editando"
          :rotulo="t('precos.contrato.editar')"
          variante="secundario"
          data-testid="editar-aba"
          @acionar="editar"
        />
        <form v-if="editando" class="form" data-testid="form-aba" @submit.prevent="salvar">
          <p>{{ t('precos.contrato.editando') }}</p>
          <div v-for="x in aba.campos.filter((y) => y.editavel)" :key="x.campo" class="campo">
            <SanteSelecao
              v-if="x.tipo === 'opcao'"
              :id="`campo-${x.campo}`"
              :model-value="String(form[x.campo] ?? '')"
              :rotulo="x.rotulo"
              :opcoes="opcoesCampo(x)"
              :data-testid="`campo-${x.campo}`"
              @update:model-value="(v: string) => (form[x.campo] = v)"
            />
            <label v-if="x.tipo !== 'opcao'" :for="`campo-${x.campo}`">{{ x.rotulo }}</label>
            <input
              v-if="x.tipo !== 'opcao'"
              :id="`campo-${x.campo}`"
              v-model="form[x.campo]"
              :type="x.tipo === 'inteiro' ? 'number' : 'text'"
              :maxlength="x.maxBytes"
              :min="x.minimo"
              :max="x.maximo"
              :required="x.obrigatorio"
              :data-testid="`campo-${x.campo}`"
            />
          </div>
          <ConfirmacaoCritica
            v-model:justificativa="critica.justificativa"
            v-model:senha="critica.senha"
            testid="contrato"
          />
          <div class="botoes">
            <SanteBotao :rotulo="t('precos.comum.salvar')" tipo="submit" data-testid="salvar-aba" />
            <SanteBotao :rotulo="t('precos.comum.cancelar')" variante="texto" @acionar="editando = false" />
          </div>
        </form>
        <table v-if="aba.campos.length > 0 && !editando" :data-testid="`campos-${aba.id}`">
          <caption>
            {{
              t(`precos.contrato.abasNomes.${aba.id}`)
            }}
          </caption>
          <tbody>
            <tr v-for="x in aba.campos" :key="x.campo">
              <th scope="row">
                {{ x.rotulo }}
                <span v-if="x.codigoLegado && x.codigoLegado !== x.rotulo" class="codigo">{{
                  t('precos.comum.codigoLegado', { codigo: x.codigoLegado })
                }}</span>
              </th>
              <td>
                {{ fmt(x) }}
                <abbr
                  v-if="x.aConfirmar"
                  class="confirmar"
                  :title="t('precos.comum.aConfirmarTitulo')"
                  data-testid="a-confirmar"
                  >{{ t('precos.comum.aConfirmar') }}</abbr
                >
              </td>
            </tr>
          </tbody>
        </table>

        <template v-if="aba.id === 'cadastro'">
          <h2>{{ t('precos.contrato.planos') }}</h2>
          <p v-if="c.planos.length === 0">{{ t('precos.contrato.semPlanos') }}</p>
          <ul v-else data-testid="lista-planos">
            <li v-for="p in c.planos" :key="p.id" :data-testid="`plano-${p.id}`">
              {{ p.nome }} — {{ p.inicio }}{{ p.fim ? ` a ${p.fim}` : '' }}
              {{ p.ativo ? '' : `(${t('precos.contrato.planoInativo')})` }}
              <SanteBotao
                v-if="c.permissoes.editarContrato && planoEditado !== p.id"
                :rotulo="t('precos.contrato.editarPlano')"
                variante="texto"
                :data-testid="`editar-plano-${p.id}`"
                @acionar="editarPlano(p)"
              />
              <form
                v-if="planoEditado === p.id"
                class="form"
                data-testid="form-editar-plano"
                @submit.prevent="salvarEdicaoPlano"
              >
                <div class="campo">
                  <label :for="`plano-nome-${p.id}`">{{ t('precos.contrato.planoNome') }}</label>
                  <input :id="`plano-nome-${p.id}`" v-model="edicaoPlano.nome" maxlength="60" required />
                </div>
                <div class="campo">
                  <label :for="`plano-fim-${p.id}`">{{ t('precos.contrato.fimEncerrar') }}</label>
                  <input :id="`plano-fim-${p.id}`" v-model="edicaoPlano.fim" pattern="\d{4}-\d{2}-\d{2}" />
                </div>
                <div class="campo">
                  <label :for="`plano-ativo-${p.id}`">
                    <input :id="`plano-ativo-${p.id}`" v-model="edicaoPlano.ativo" type="checkbox" />
                    {{ t('precos.contrato.planoAtivo') }}
                  </label>
                </div>
                <ConfirmacaoCritica
                  v-model:justificativa="edicaoPlano.justificativa"
                  v-model:senha="edicaoPlano.senha"
                  testid="editar-plano"
                />
                <div class="botoes">
                  <SanteBotao :rotulo="t('precos.comum.salvar')" tipo="submit" />
                  <SanteBotao
                    :rotulo="t('precos.comum.cancelar')"
                    variante="texto"
                    @acionar="planoEditado = null"
                  />
                </div>
              </form>
            </li>
          </ul>
          <SanteBotao
            v-if="c.permissoes.editarContrato && !planoAberto"
            :rotulo="t('precos.contrato.novoPlano')"
            variante="texto"
            data-testid="novo-plano"
            @acionar="planoAberto = true"
          />
          <form v-if="planoAberto" class="form" data-testid="form-plano" @submit.prevent="salvarPlano">
            <div class="campo">
              <label for="plano-nome">{{ t('precos.contrato.planoNome') }}</label>
              <input id="plano-nome" v-model="plano.nome" maxlength="60" required />
            </div>
            <div class="campo">
              <label for="plano-legado">{{ t('precos.contrato.planoLegado') }}</label>
              <input id="plano-legado" v-model="plano.planoLegado" type="number" min="1" />
            </div>
            <div class="campo">
              <label for="plano-inicio">{{ t('precos.contrato.inicio') }}</label>
              <input id="plano-inicio" v-model="plano.inicio" pattern="\d{4}-\d{2}-\d{2}" required />
            </div>
            <div class="campo">
              <label for="plano-fim">{{ t('precos.contrato.fim') }}</label>
              <input id="plano-fim" v-model="plano.fim" pattern="\d{4}-\d{2}-\d{2}" />
            </div>
            <ConfirmacaoCritica
              v-model:justificativa="plano.justificativa"
              v-model:senha="plano.senha"
              testid="plano"
            />
            <div class="botoes">
              <SanteBotao :rotulo="t('precos.comum.salvar')" tipo="submit" />
              <SanteBotao
                :rotulo="t('precos.comum.cancelar')"
                variante="texto"
                @acionar="planoAberto = false"
              />
            </div>
          </form>
          <h2>{{ t('precos.contrato.historico') }}</h2>
          <ul>
            <li v-for="h in c.historicoNome" :key="h.quando + h.nome">{{ h.quando }} — {{ h.nome }}</li>
          </ul>
        </template>

        <template v-if="aba.id === 'tabelas'">
          <h2>{{ t('precos.contrato.vigencias') }}</h2>
          <table data-testid="vigencias-tabelas">
            <caption>
              {{
                t('precos.contrato.vigencias')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('precos.comum.tabela') }}</th>
                <th scope="col">{{ t('precos.comum.vigencia') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in c.vigencias" :key="v.tipo + v.inicio">
                <th scope="row">{{ t(`precos.contrato.tipoTabela.${v.tipo}`) }}: {{ v.tabela }}</th>
                <td>
                  {{ t('precos.contrato.inicioFim', { inicio: v.inicio, fim: v.fim }) }}
                  <strong v-if="v.vigente">{{ t('precos.contrato.vigente') }}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <h2 id="indices">{{ t('precos.contrato.indices') }}</h2>
          <table data-testid="indices">
            <caption>
              {{
                t('precos.contrato.indices')
              }}
            </caption>
            <tbody>
              <tr v-for="i in c.indices" :key="i.tipo + i.chave + i.data">
                <th scope="row">{{ i.rotulo }}</th>
                <td>
                  {{ i.data }} — {{ i.valor.toLocaleString('pt-BR', { maximumFractionDigits: 5 }) }}
                  <strong v-if="i.vigente">{{ t('precos.contrato.vigente') }}</strong>
                  <em v-if="i.dataInvalida">{{ t('precos.contrato.dataInvalida') }}</em>
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="aba.id === 'modificadores'">
          <div class="campo">
            <SanteSelecao
              id="tipo-mod"
              v-model="tipoMod"
              :rotulo="t('precos.contrato.tipoModificador')"
              :opcoes="opcoesTipoMod"
              data-testid="tipo-modificador"
            />
          </div>
          <MensagemErro v-if="mods.isError.value" :erro="mods.error.value" />
          <table v-else-if="mods.data.value" data-testid="tabela-modificadores">
            <caption>
              {{
                t(`precos.contrato.tiposModificador.${tipoMod}`)
              }}
            </caption>
            <thead>
              <tr>
                <th v-for="col in mods.data.value.colunas" :key="col.campo" scope="col">
                  {{ col.rotulo }}
                  <abbr v-if="col.aConfirmar" :title="t('precos.comum.aConfirmarTitulo')">{{
                    t('precos.comum.aConfirmar')
                  }}</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in mods.data.value.itens" :key="i">
                <td v-for="col in mods.data.value.colunas" :key="col.campo">{{ l[col.campo] ?? '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="mods.data.value && mods.data.value.itens.length === 0">{{ t('precos.comum.nenhum') }}</p>
          <div v-if="mods.data.value && mods.data.value.total > 25" class="botoes">
            <SanteBotao
              :rotulo="t('precos.comum.anterior')"
              variante="texto"
              :desabilitado="paginaMod === 0"
              @acionar="paginaMod--"
            />
            <SanteBotao
              :rotulo="t('precos.comum.proxima')"
              variante="texto"
              :desabilitado="(paginaMod + 1) * 25 >= mods.data.value.total"
              @acionar="paginaMod++"
            />
          </div>
        </template>

        <template v-if="(aba.id === 'pacotes' || aba.id === 'financeiro') && extra.data.value && !editando">
          <h2>
            {{ t(`precos.contrato.tiposModificador.${aba.id === 'pacotes' ? 'pacotes' : 'entregas'}`) }}
          </h2>
          <p v-if="extra.data.value.itens.length === 0">{{ t('precos.comum.nenhum') }}</p>
          <table v-else :data-testid="`extra-${aba.id}`">
            <caption>
              {{
                t(`precos.contrato.tiposModificador.${aba.id === 'pacotes' ? 'pacotes' : 'entregas'}`)
              }}
            </caption>
            <thead>
              <tr>
                <th v-for="col in extra.data.value.colunas" :key="col.campo" scope="col">{{ col.rotulo }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in extra.data.value.itens" :key="i">
                <td v-for="col in extra.data.value.colunas" :key="col.campo">{{ l[col.campo] ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="aba.id === 'tiss'">
          <h2>{{ t('precos.contrato.tiss') }}</h2>
          <p v-if="!c.tiss.configurado">{{ t('precos.contrato.tissNao') }}</p>
          <table v-else data-testid="tiss">
            <caption>
              {{
                t('precos.contrato.tiss')
              }}
            </caption>
            <tbody>
              <tr v-for="x in c.tiss.campos" :key="x.campo">
                <th scope="row">{{ x.rotulo }}</th>
                <td>{{ fmt(x) }}</td>
              </tr>
            </tbody>
          </table>
          <h3>{{ t('precos.contrato.parametros') }}</h3>
          <ul>
            <li v-for="p in c.tiss.parametros" :key="p.codigo">
              {{ p.codigo }} — {{ p.nome }}{{ p.padrao ? ` (${p.padrao})` : '' }}
            </li>
          </ul>
        </template>
      </div>
      <!-- ADR 0009: bloqueia sem credenciamento e credencia todos ao criar; profissionais credenciados. -->
      <OpcoesCredenciamentoConvenio :codigo="codigo" />
    </template>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  margin-top: var(--sgh-espaco-3);
}
.abas button {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-bottom: none;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  cursor: pointer;
}
.abas button[aria-selected='true'] {
  background: var(--sgh-fundo);
  font-weight: 700;
  border-color: var(--sgh-borda-forte);
}
.painel {
  padding: var(--sgh-espaco-2) 0;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: var(--sgh-espaco-2) 0;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.codigo {
  display: block;
  font-weight: 400;
  color: var(--sgh-texto-secundario);
  font-size: 0.875em;
}
.confirmar {
  margin-left: var(--sgh-espaco-1);
  font-style: italic;
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 40rem;
  margin: var(--sgh-espaco-2) 0;
}
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
