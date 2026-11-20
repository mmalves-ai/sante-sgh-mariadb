<script setup lang="ts">
// Registro do pedido de autorização que o prestador faz à operadora (M56, etapa 5, F4): a carteirinha do beneficiário,
// o prestador que pede e o que executa (combos com busca da rede credenciada, ADR 0027), o tipo de guia, o caráter, a
// origem do pedido, a alta complexidade, a guia principal (quando o pedido nasce da ficha de uma internação
// autorizada), o CID-10, a indicação clínica, o profissional solicitante, a internação (tipo, diárias e admissão) e os
// itens (procedimentos da terminologia TUSS pela busca, materiais, medicamentos e diárias). As regras moram no
// servidor (@sgh/dominio-operadora): a recusa volta com o texto e a tela mostra; o protocolo sai na hora.
// M56.8 (F7): o mesmo formulário serve ao portal do prestador (`portal`): sem o prestador, o executante e a origem (o
// servidor tira o prestador da conta e a origem é o portal), com os tipos de guia e a data do apoio do portal e com a
// gravação e a busca TUSS do portal (`registrar` e `buscarTuss`).
import {
  type ApoioAutorizacoes,
  type ApoioPortalPrestador,
  CARATERES_ATENDIMENTO,
  CONSELHOS_PROFISSIONAIS,
  type ProcedimentoTuss,
  type ResultadoAutorizacao,
  TABELAS_ITEM_GUIA,
  TIPO_GUIA,
  TIPOS_INTERNACAO,
  UFS,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { buscarProcedimentos, registrarAutorizacao } from '../api-autorizacao.js';

const props = defineProps<{
  apoio: ApoioAutorizacoes | null;
  /** O pedido de SP/SADT ou de prorrogação que nasce da ficha de uma internação autorizada. */
  principal: { id: number; protocolo: string; carteirinha: string; prestador: number } | null;
  /** O pedido pelo portal do prestador (sem prestador, executante e origem na tela). */
  portal?: ApoioPortalPrestador | null;
  registrar?: (corpo: unknown) => Promise<ResultadoAutorizacao>;
  buscarTuss?: (termo: string) => Promise<ProcedimentoTuss[]>;
}>();
const noPortal = computed(() => !!props.portal);
const tiposGuia = computed(() => props.portal?.tiposGuia ?? props.apoio?.dominios.tipoGuia ?? []);
const origens = computed(() => props.apoio?.dominios.origem ?? []);
const prestadores = computed(() => props.apoio?.prestadores ?? []);
const emit = defineEmits<{ gravado: [r: ResultadoAutorizacao]; cancelar: [] }>();
const { t } = useI18n();

interface Item {
  tabela: number | null;
  codigo: string;
  descricao: string;
  quantidade: string;
}
const novoItem = (): Item => ({ tabela: 22, codigo: '', descricao: '', quantidade: '1' });
const f = reactive({
  carteirinha: props.principal?.carteirinha ?? '',
  prestador: (props.principal?.prestador ?? null) as number | null,
  executante: null as number | null,
  tipoGuia: (props.principal ? TIPO_GUIA.sadt : null) as number | null,
  carater: 'E' as string | null,
  origem: (props.apoio?.dominios.origem[0]?.codigo ?? null) as number | null,
  altaComplexidade: false,
  cid: '',
  indicacao: '',
  profNome: '',
  profConselho: 'CRM' as string | null,
  profNumero: '',
  profUf: 'SC' as string | null,
  internacaoTipo: 1 as number | null,
  diarias: '1',
  admissao: (props.portal?.hoje ?? props.apoio?.hoje ?? null) as string | null,
  itens: [novoItem()] as Item[],
});

const opcoes = (lista: readonly { codigo: number; rotulo: string }[]) => [
  { valor: null, rotulo: t('operadoraAutorizacao.form.escolha') },
  ...lista.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
];
const opcoesPrestador = computed(() => [
  { valor: null, rotulo: t('operadoraAutorizacao.form.escolha') },
  ...prestadores.value.map((p) => ({ valor: p.id, rotulo: `${p.nome} · ${p.municipioIbge}/${p.uf}` })),
]);
const opcoesExecutante = computed(() => [
  { valor: null, rotulo: t('operadoraAutorizacao.form.mesmoPrestador') },
  ...prestadores.value.map((p) => ({ valor: p.id, rotulo: `${p.nome} · ${p.municipioIbge}/${p.uf}` })),
]);
const opcoesCarater = Object.entries(CARATERES_ATENDIMENTO).map(([valor, rotulo]) => ({ valor, rotulo }));
const opcoesConselho = CONSELHOS_PROFISSIONAIS.map((c) => ({ valor: c as string, rotulo: c }));
const opcoesUf = UFS.map((u) => ({ valor: u as string, rotulo: u }));
const opcoesTabela = Object.entries(TABELAS_ITEM_GUIA).map(([k, v]) => ({ valor: Number(k), rotulo: v }));
const opcoesInternacao = Object.entries(TIPOS_INTERNACAO).map(([k, v]) => ({ valor: Number(k), rotulo: v }));
const internacao = computed(() => f.tipoGuia === TIPO_GUIA.internacao);

// Busca na terminologia TUSS (código ou nome; só vigentes).
const termo = ref('');
const achados = ref<ProcedimentoTuss[] | null>(null);
async function buscar(): Promise<void> {
  const b = termo.value.trim();
  if (b.length < 2) return;
  try {
    achados.value = await (props.buscarTuss ?? buscarProcedimentos)(b);
  } catch (e) {
    erro.value = e;
  }
}
function usar(p: ProcedimentoTuss): void {
  const vazio = f.itens.find((i) => i.tabela === 22 && !i.codigo.trim());
  if (vazio) vazio.codigo = p.codigo;
  else f.itens.push({ ...novoItem(), codigo: p.codigo });
}

const completo = computed(
  () =>
    f.carteirinha.replace(/\D/g, '').length === 16 &&
    (noPortal.value || f.prestador !== null) &&
    f.tipoGuia !== null &&
    f.carater !== null &&
    (noPortal.value || f.origem !== null) &&
    f.indicacao.trim().length >= 10 &&
    f.profNome.trim().length >= 3 &&
    /^\d{1,15}$/.test(f.profNumero.trim()) &&
    f.profConselho !== null &&
    f.profUf !== null &&
    f.itens.length > 0 &&
    f.itens.every((i) => i.tabela !== null && i.codigo.trim() && Number(i.quantidade) >= 1) &&
    (!internacao.value || (f.internacaoTipo !== null && Number(f.diarias) >= 1 && f.admissao !== null)),
);

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

function corpo() {
  return {
    carteirinha: f.carteirinha,
    ...(noPortal.value ? {} : { prestador: f.prestador, origem: f.origem }),
    executante: noPortal.value ? null : f.executante,
    tipoGuia: f.tipoGuia,
    carater: f.carater,
    altaComplexidade: f.altaComplexidade,
    guiaPrincipal: props.principal?.id ?? null,
    cid: f.cid.trim() || null,
    indicacaoClinica: f.indicacao,
    profissional: { nome: f.profNome, conselho: f.profConselho, numero: f.profNumero.trim(), uf: f.profUf },
    internacao: internacao.value
      ? { tipo: f.internacaoTipo, diarias: Number(f.diarias), admissaoPrevista: f.admissao }
      : null,
    itens: f.itens.map((i) => ({
      tabela: i.tabela,
      codigo: i.codigo.trim(),
      descricao: i.tabela === 22 ? null : i.descricao.trim() || null,
      quantidade: Number(i.quantidade),
    })),
  };
}

async function gravar(): Promise<void> {
  if (!completo.value || gravando.value) return;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  try {
    emit('gravado', await (props.registrar ?? registrarAutorizacao)(corpo()));
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="formulario-aut" data-testid="form-autorizacao" @submit.prevent="gravar">
    <p v-if="principal" class="secundario" data-testid="aut-form-principal">
      {{ t('operadoraAutorizacao.ficha.guiaPrincipal') }}: {{ principal.protocolo }}
    </p>
    <div class="campos">
      <SanteCampoTexto
        id="aut-carteirinha"
        v-model="f.carteirinha"
        :rotulo="t('operadoraAutorizacao.form.carteirinha')"
        :max-bytes="20"
        obrigatorio
      />
      <template v-if="!noPortal">
        <SanteSelecao
          v-model="f.prestador"
          :rotulo="t('operadoraAutorizacao.form.prestador')"
          :opcoes="opcoesPrestador"
          :busca="true"
          obrigatorio
          data-testid="aut-prestador"
        />
        <SanteSelecao
          v-model="f.executante"
          :rotulo="t('operadoraAutorizacao.form.executante')"
          :opcoes="opcoesExecutante"
          :busca="true"
          data-testid="aut-executante"
        />
      </template>
      <SanteSelecao
        v-model="f.tipoGuia"
        :rotulo="t('operadoraAutorizacao.form.tipo')"
        :opcoes="opcoes(tiposGuia)"
        obrigatorio
        data-testid="aut-tipo"
      />
      <SanteSelecao
        v-model="f.carater"
        :rotulo="t('operadoraAutorizacao.form.carater')"
        :opcoes="opcoesCarater"
        obrigatorio
        data-testid="aut-carater"
      />
      <SanteSelecao
        v-if="!noPortal"
        v-model="f.origem"
        :rotulo="t('operadoraAutorizacao.form.origem')"
        :opcoes="opcoes(origens)"
        obrigatorio
        data-testid="aut-origem"
      />
      <label class="marcar"
        ><input v-model="f.altaComplexidade" type="checkbox" data-testid="aut-alta" />
        {{ t('operadoraAutorizacao.form.altaComplexidade') }}</label
      >
      <SanteCampoTexto
        id="aut-cid"
        v-model="f.cid"
        :rotulo="t('operadoraAutorizacao.form.cid')"
        :max-bytes="6"
      />
    </div>
    <SanteCampoTexto
      id="aut-indicacao"
      v-model="f.indicacao"
      :rotulo="t('operadoraAutorizacao.form.indicacao')"
      :max-bytes="1000"
      multilinha
      obrigatorio
    />

    <fieldset class="campos">
      <legend>{{ t('operadoraAutorizacao.form.profissional') }}</legend>
      <SanteCampoTexto
        id="aut-prof-nome"
        v-model="f.profNome"
        :rotulo="t('operadoraAutorizacao.form.profissionalNome')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteSelecao
        v-model="f.profConselho"
        :rotulo="t('operadoraAutorizacao.form.conselho')"
        :opcoes="opcoesConselho"
        obrigatorio
        data-testid="aut-prof-conselho"
      />
      <SanteCampoTexto
        id="aut-prof-numero"
        v-model="f.profNumero"
        :rotulo="t('operadoraAutorizacao.form.numeroConselho')"
        :max-bytes="15"
        obrigatorio
      />
      <SanteSelecao
        v-model="f.profUf"
        :rotulo="t('operadoraAutorizacao.form.ufConselho')"
        :opcoes="opcoesUf"
        obrigatorio
        data-testid="aut-prof-uf"
      />
    </fieldset>

    <fieldset v-if="internacao" class="campos" data-testid="aut-internacao">
      <legend>{{ t('operadoraAutorizacao.form.internacao') }}</legend>
      <SanteSelecao
        v-model="f.internacaoTipo"
        :rotulo="t('operadoraAutorizacao.form.tipoInternacao')"
        :opcoes="opcoesInternacao"
        obrigatorio
        data-testid="aut-internacao-tipo"
      />
      <SanteCampoTexto
        id="aut-diarias"
        v-model="f.diarias"
        :rotulo="t('operadoraAutorizacao.form.diarias')"
        :max-bytes="3"
        obrigatorio
      />
      <SanteData
        v-model="f.admissao"
        :rotulo="t('operadoraAutorizacao.form.admissao')"
        editavel
        data-testid="aut-admissao"
      />
    </fieldset>

    <fieldset class="itens" data-testid="aut-itens">
      <legend>{{ t('operadoraAutorizacao.form.itens') }}</legend>
      <div v-for="(item, k) in f.itens" :key="k" class="campos" :data-testid="`aut-item-${k + 1}`">
        <SanteSelecao
          v-model="item.tabela"
          :rotulo="t('operadoraAutorizacao.form.tabela')"
          :opcoes="opcoesTabela"
          obrigatorio
          :data-testid="`aut-item-tabela-${k + 1}`"
        />
        <SanteCampoTexto
          :id="`aut-item-codigo-${k + 1}`"
          v-model="item.codigo"
          :rotulo="t('operadoraAutorizacao.form.codigo')"
          :max-bytes="12"
          obrigatorio
        />
        <SanteCampoTexto
          v-if="item.tabela !== 22"
          :id="`aut-item-descricao-${k + 1}`"
          v-model="item.descricao"
          :rotulo="t('operadoraAutorizacao.form.descricao')"
          :max-bytes="150"
        />
        <SanteCampoTexto
          :id="`aut-item-qtd-${k + 1}`"
          v-model="item.quantidade"
          :rotulo="t('operadoraAutorizacao.form.quantidade')"
          :max-bytes="3"
          obrigatorio
        />
        <SanteBotao
          v-if="f.itens.length > 1"
          variante="texto"
          :rotulo="t('operadoraAutorizacao.form.retirarItem', { n: k + 1 })"
          @acionar="f.itens.splice(k, 1)"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAutorizacao.form.incluirItem')"
          data-testid="aut-incluir-item"
          @acionar="f.itens.push(novoItem())"
        />
      </div>
      <div class="campos">
        <SanteCampoTexto
          id="aut-busca-tuss"
          v-model="termo"
          :rotulo="t('operadoraAutorizacao.form.buscarProcedimento')"
          :max-bytes="60"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAutorizacao.form.buscar')"
          data-testid="aut-buscar-tuss"
          @acionar="buscar"
        />
      </div>
      <p v-if="achados && achados.length === 0" class="secundario">
        {{ t('operadoraAutorizacao.form.semResultado') }}
      </p>
      <ul v-else-if="achados" class="achados" data-testid="aut-tuss-achados">
        <li v-for="p in achados" :key="p.codigo">
          <span>{{ p.codigo }} · {{ p.nome }}</span>
          <SanteBotao
            variante="texto"
            :rotulo="t('operadoraAutorizacao.form.usar', { codigo: p.codigo })"
            :data-testid="`aut-usar-${p.codigo}`"
            @acionar="usar(p)"
          />
        </li>
      </ul>
    </fieldset>

    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="aut-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="!completo" class="secundario">{{ t('operadoraAutorizacao.form.obrigatorios') }}</p>
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('operadoraAutorizacao.acoes.voltar')"
        @acionar="emit('cancelar')"
      />
      <SanteBotao
        tipo="submit"
        :rotulo="t('operadoraAutorizacao.acoes.gravar')"
        :desabilitado="!completo || gravando"
        data-testid="aut-gravar"
      />
    </div>
  </form>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.formulario-aut {
  display: grid;
  gap: 0.75rem;
}
fieldset {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.itens {
  display: grid;
  gap: 0.75rem;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
.achados {
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 0.25rem;
}
.achados li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
</style>
