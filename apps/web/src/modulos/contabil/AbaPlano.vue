<script setup lang="ts">
// Aba Plano (M54.1): a árvore do plano de contas com a busca por código ou nome (a conta achada traz as de nível acima),
// o detalhe da conta (vínculo referencial, conta no arquivo do escritório contábil, versão e quem alterou) e o
// formulário da inclusão e da alteração. O código, o grupo, o tipo e a natureza não mudam depois de incluída a conta;
// a alteração leva a versão lida (o servidor recusa se outro gravou antes). Só com `contabil.plano.editar`.
import type { ApoioContabil, ContaDoPlano, GrupoConta, PlanoContabil } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteMarcadores, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { alterarConta, incluirConta } from './api-contabil.js';
import { filtrarContas, instante, opcoesContasSinteticas, proximoCodigoFilho } from './comum-contabil.js';

const props = defineProps<{ apoio: ApoioContabil; plano: PlanoContabil }>();
const { t } = useI18n();
const cliente = useQueryClient();

const termo = ref('');
const visiveis = computed(() => filtrarContas(props.plano.contas, termo.value));
const analiticas = computed(() => props.plano.contas.filter((c) => c.tipo === 'analitica').length);
const aberta = ref<string | null>(null);
const detalhe = computed(() => props.plano.contas.find((c) => c.codigo === aberta.value) ?? null);
const comProblema = computed(() => new Set(props.plano.problemas.map((p) => p.codigo)));
const rotuloReferencial = (id: number | null) => {
  if (id === null) return t('contabil.plano.semReferencialTipo');
  const r = props.apoio.tiposPlanoReferencial.find((x) => x.id === id);
  return r ? `${r.codigo} ${r.descricao}` : String(id);
};

// ── Formulário ────────────────────────────────────────────────────────────────────────────────────
type Modo = 'incluir' | 'alterar';
interface Formulario {
  modo: Modo;
  versao: number;
  pai: string | null;
  codigo: string;
  nome: string;
  grupo: GrupoConta;
  tipo: 'sintetica' | 'analitica';
  natureza: 'devedora' | 'credora';
  referencialTipo: number | null;
  referencialConta: string;
  contaExportacao: string;
  marcas: ('exigeCentroCusto' | 'ativa')[];
}
const form = ref<Formulario | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const gravando = ref(false);

const opcoesPai = computed(() => [
  { valor: null as string | null, rotulo: t('contabil.plano.semPai') },
  ...opcoesContasSinteticas(props.plano.contas),
]);
const opcoesGrupo = computed(() => props.apoio.grupos.map((g) => ({ valor: g.codigo, rotulo: g.rotulo })));
const opcoesTipo = computed(() =>
  (['sintetica', 'analitica'] as const).map((v) => ({ valor: v, rotulo: t(`contabil.tiposConta.${v}`) })),
);
const opcoesNatureza = computed(() =>
  (['devedora', 'credora'] as const).map((v) => ({ valor: v, rotulo: t(`contabil.naturezas.${v}`) })),
);
const opcoesReferencial = computed(() => [
  { valor: null as number | null, rotulo: t('contabil.plano.semReferencialTipo') },
  ...props.apoio.tiposPlanoReferencial.map((r) => ({
    valor: r.id as number | null,
    rotulo: `${r.codigo} ${r.descricao}`,
  })),
]);
const opcoesMarcas = computed(() => [
  { valor: 'exigeCentroCusto' as const, rotulo: t('contabil.plano.exigeCentroCusto') },
  { valor: 'ativa' as const, rotulo: t('contabil.plano.ativa') },
]);

const naturezaDoGrupo = (g: GrupoConta) =>
  (props.apoio.grupos.find((x) => x.codigo === g)?.natureza ?? 'devedora') as 'devedora' | 'credora';

function novaConta(pai: ContaDoPlano | null = null) {
  const grupo = pai?.grupo ?? props.apoio.grupos[0]?.codigo ?? 'ativo';
  form.value = {
    modo: 'incluir',
    versao: 0,
    pai: pai?.codigo ?? null,
    codigo: proximoCodigoFilho(props.plano.contas, pai?.codigo ?? null, props.apoio.mascara),
    nome: '',
    grupo,
    tipo: 'analitica',
    natureza: naturezaDoGrupo(grupo),
    referencialTipo: null,
    referencialConta: '',
    contaExportacao: '',
    marcas: ['ativa'],
  };
  erro.value = null;
  aviso.value = null;
}
function editar(c: ContaDoPlano) {
  form.value = {
    modo: 'alterar',
    versao: c.versao,
    pai: c.pai,
    codigo: c.codigo,
    nome: c.nome,
    grupo: c.grupo,
    tipo: c.tipo,
    natureza: c.natureza,
    referencialTipo: c.referencialTipo,
    referencialConta: c.referencialConta ?? '',
    contaExportacao: c.contaExportacao === null ? '' : String(c.contaExportacao),
    marcas: [
      ...(c.exigeCentroCusto ? (['exigeCentroCusto'] as const) : []),
      ...(c.ativa ? (['ativa'] as const) : []),
    ],
  };
  erro.value = null;
  aviso.value = null;
}
// Trocou a conta de nível acima na inclusão: o código sugerido e o grupo seguem a nova.
function trocarPai(pai: string | null) {
  const f = form.value;
  if (!f || f.modo !== 'incluir') return;
  f.pai = pai;
  f.codigo = proximoCodigoFilho(props.plano.contas, pai, props.apoio.mascara);
  const g = props.plano.contas.find((c) => c.codigo === pai)?.grupo;
  if (g) {
    f.grupo = g;
    f.natureza = naturezaDoGrupo(g);
  }
}
const contaExportacaoValida = computed(
  () => !form.value || form.value.contaExportacao === '' || /^[1-9]\d{0,9}$/.test(form.value.contaExportacao),
);
const podeGravar = computed(
  () =>
    !!form.value &&
    props.apoio.podeEditar &&
    form.value.nome.trim().length > 0 &&
    form.value.codigo.trim().length > 0 &&
    contaExportacaoValida.value &&
    !gravando.value,
);

async function gravar() {
  const f = form.value;
  if (!f || !podeGravar.value) return;
  gravando.value = true;
  erro.value = null;
  const comum = {
    nome: f.nome.trim(),
    referencialTipo: f.referencialTipo,
    referencialConta: f.referencialConta.trim() || null,
    contaExportacao: f.contaExportacao ? Number(f.contaExportacao) : null,
    exigeCentroCusto: f.marcas.includes('exigeCentroCusto'),
    ativa: f.marcas.includes('ativa'),
  };
  try {
    const r =
      f.modo === 'incluir'
        ? await incluirConta({
            empresa: props.plano.empresa,
            codigo: f.codigo.trim(),
            grupo: f.grupo,
            tipo: f.tipo,
            natureza: f.natureza,
            ...comum,
          })
        : await alterarConta({ empresa: props.plano.empresa, codigo: f.codigo, versao: f.versao, ...comum });
    aviso.value =
      `${r.mensagem} ${r.problemas ? t('contabil.plano.problemasDepois', { n: r.problemas }) : ''}`.trim();
    aberta.value = r.codigo;
    form.value = null;
    await cliente.invalidateQueries({ queryKey: ['contabil', 'plano'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="aba-plano-titulo" data-testid="aba-plano">
    <h2 id="aba-plano-titulo">{{ t('contabil.plano.arvore') }}</h2>
    <p class="secundario">
      {{ t('contabil.plano.mascara', { mascara: apoio.mascara }) }} {{ t('contabil.plano.soAnaliticaLanca') }}
    </p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="plano-aviso" />
    <div class="campos">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('contabil.plano.buscar')"
        :max-bytes="80"
        data-testid="plano-busca"
      />
      <div class="acoes">
        <SanteBotao
          v-if="apoio.podeEditar"
          :rotulo="t('contabil.plano.novaConta')"
          data-testid="plano-nova-conta"
          @acionar="novaConta(null)"
        />
      </div>
    </div>
    <p data-testid="plano-contagem">
      {{ t('contabil.plano.contagem', { n: plano.contas.length, analiticas }) }}
    </p>
    <p v-if="visiveis.length === 0" data-testid="plano-vazio">{{ t('contabil.nenhum') }}</p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-plano">
        <thead>
          <tr>
            <th scope="col">{{ t('contabil.plano.codigo') }}</th>
            <th scope="col">{{ t('contabil.plano.nome') }}</th>
            <th scope="col">{{ t('contabil.plano.grupo') }}</th>
            <th scope="col">{{ t('contabil.plano.tipo') }}</th>
            <th scope="col">{{ t('contabil.plano.natureza') }}</th>
            <th scope="col">{{ t('contabil.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in visiveis" :key="c.codigo" :data-testid="`conta-${c.codigo}`">
            <td :style="{ paddingLeft: `${0.5 + (c.nivel - 1) * 1}rem` }">
              {{ c.codigo }}
              <span v-if="comProblema.has(c.codigo)" class="erro" data-testid="conta-com-problema">
                ({{ t('contabil.plano.comProblema') }})
              </span>
            </td>
            <td>
              <strong v-if="c.tipo === 'sintetica'">{{ c.nome }}</strong>
              <template v-else>{{ c.nome }}</template>
              <span v-if="!c.ativa" class="secundario"> ({{ t('contabil.plano.inativa') }})</span>
            </td>
            <td>{{ t(`contabil.grupos.${c.grupo}`) }}</td>
            <td>{{ t(`contabil.tiposConta.${c.tipo}`) }}</td>
            <td>{{ t(`contabil.naturezas.${c.natureza}`) }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('contabil.plano.detalhe')"
                :data-testid="`conta-detalhe-${c.codigo}`"
                @acionar="aberta = c.codigo"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="detalhe" class="bloco" aria-labelledby="conta-detalhe-titulo" data-testid="conta-detalhe">
      <h3 id="conta-detalhe-titulo">{{ detalhe.codigo }} {{ detalhe.nome }}</h3>
      <dl class="dados">
        <dt>{{ t('contabil.plano.grupo') }}</dt>
        <dd>{{ t(`contabil.grupos.${detalhe.grupo}`) }}</dd>
        <dt>{{ t('contabil.plano.tipo') }}</dt>
        <dd>{{ t(`contabil.tiposConta.${detalhe.tipo}`) }}</dd>
        <dt>{{ t('contabil.plano.natureza') }}</dt>
        <dd>{{ t(`contabil.naturezas.${detalhe.natureza}`) }}</dd>
        <dt>{{ t('contabil.plano.referencialTipo') }}</dt>
        <dd data-testid="conta-referencial">{{ rotuloReferencial(detalhe.referencialTipo) }}</dd>
        <dt>{{ t('contabil.plano.referencialConta') }}</dt>
        <dd>{{ detalhe.referencialConta ?? '—' }}</dd>
        <dt>{{ t('contabil.plano.contaExportacao') }}</dt>
        <dd>{{ detalhe.contaExportacao ?? '—' }}</dd>
        <dt>{{ t('contabil.plano.exigeCentroCusto') }}</dt>
        <dd>{{ detalhe.exigeCentroCusto ? t('contabil.sim') : t('contabil.nao') }}</dd>
        <dt>{{ t('contabil.plano.ativa') }}</dt>
        <dd>{{ detalhe.ativa ? t('contabil.sim') : t('contabil.nao') }}</dd>
      </dl>
      <p class="secundario" data-testid="conta-versao">
        {{
          t('contabil.plano.versao', {
            versao: detalhe.versao,
            por: detalhe.alteradoPor,
            em: instante(detalhe.alteradoEm),
          })
        }}
      </p>
      <div class="acoes">
        <SanteBotao
          v-if="apoio.podeEditar"
          :rotulo="t('contabil.plano.editarConta')"
          data-testid="conta-alterar"
          @acionar="editar(detalhe)"
        />
        <SanteBotao
          v-if="apoio.podeEditar && detalhe.tipo === 'sintetica'"
          variante="secundario"
          :rotulo="t('contabil.plano.novaFilha')"
          data-testid="conta-nova-filha"
          @acionar="novaConta(detalhe)"
        />
        <SanteBotao variante="secundario" :rotulo="t('contabil.fechar')" @acionar="aberta = null" />
      </div>
    </section>

    <section v-if="form" class="bloco" aria-labelledby="conta-form-titulo" data-testid="conta-formulario">
      <h3 id="conta-form-titulo">
        {{ form.modo === 'incluir' ? t('contabil.plano.novaConta') : t('contabil.plano.editarConta') }}
      </h3>
      <p class="secundario">{{ t('contabil.plano.codigoNaoMuda') }}</p>
      <div class="campos">
        <SanteSelecao
          v-if="form.modo === 'incluir'"
          :model-value="form.pai"
          :rotulo="t('contabil.plano.pai')"
          :opcoes="opcoesPai"
          busca
          data-testid="conta-pai"
          @update:model-value="trocarPai"
        />
        <SanteCampoTexto
          v-if="form.modo === 'incluir'"
          v-model="form.codigo"
          :rotulo="t('contabil.plano.codigo')"
          :max-bytes="30"
          obrigatorio
          data-testid="conta-codigo"
        />
        <p v-else data-testid="conta-codigo-fixo">{{ t('contabil.plano.codigo') }}: {{ form.codigo }}</p>
        <SanteCampoTexto
          v-model="form.nome"
          :rotulo="t('contabil.plano.nome')"
          :max-bytes="80"
          obrigatorio
          data-testid="conta-nome"
        />
        <SanteSelecao
          v-model="form.grupo"
          :rotulo="t('contabil.plano.grupo')"
          :opcoes="opcoesGrupo"
          :desabilitado="form.modo === 'alterar' || form.pai !== null"
          busca
          data-testid="conta-grupo"
        />
        <SanteSelecao
          v-model="form.tipo"
          :rotulo="t('contabil.plano.tipo')"
          :opcoes="opcoesTipo"
          :desabilitado="form.modo === 'alterar'"
          busca
          data-testid="conta-tipo"
        />
        <SanteSelecao
          v-model="form.natureza"
          :rotulo="t('contabil.plano.natureza')"
          :opcoes="opcoesNatureza"
          :desabilitado="form.modo === 'alterar'"
          busca
          data-testid="conta-natureza"
        />
        <SanteSelecao
          v-model="form.referencialTipo"
          :rotulo="t('contabil.plano.referencialTipo')"
          :opcoes="opcoesReferencial"
          busca
          data-testid="conta-referencial-tipo"
        />
        <SanteCampoTexto
          v-model="form.referencialConta"
          :rotulo="t('contabil.plano.referencialConta')"
          :max-bytes="30"
          data-testid="conta-referencial-conta"
        />
        <SanteCampoTexto
          v-model="form.contaExportacao"
          :rotulo="t('contabil.plano.contaExportacao')"
          :max-bytes="10"
          data-testid="conta-exportacao"
        />
        <SanteMarcadores
          v-model="form.marcas"
          :legenda="t('contabil.plano.marcas')"
          :opcoes="opcoesMarcas"
          data-testid="conta-marcas"
        />
      </div>
      <p v-if="!contaExportacaoValida" class="erro" data-testid="conta-exportacao-invalida">
        {{ t('contabil.plano.contaExportacaoInvalida') }}
      </p>
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.gravar')"
          :desabilitado="!podeGravar"
          data-testid="conta-gravar"
          @acionar="gravar"
        />
        <SanteBotao variante="secundario" :rotulo="t('contabil.cancelar')" @acionar="form = null" />
      </div>
    </section>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
