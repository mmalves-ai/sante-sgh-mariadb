<script setup lang="ts">
// Cadastro complementar da operadora (F7, 08-SGO linha 93; C1-071): numa só aba, os responsáveis perante a ANS (com o
// histórico de quem exerceu cada papel), os setores internos com a hierarquia e os parâmetros gerais por vigência, de
// cada operadora da instalação (o combo "Operadora" da tela escolhe qual). Validação na hora com as mesmas regras do
// domínio que o servidor aplica: o papel único mostra antes de gravar qual período se encerra na véspera; o setor
// recusa ciclo na hierarquia; o parâmetro mostra a faixa. O responsável é escolhido pelo CPF ou CNPJ exato (nunca por
// número interno). Nada se apaga: o responsável trocado fica encerrado e o parâmetro antigo fica no histórico.
import {
  PARAMETROS_OPERADORA,
  planoResponsavel,
  problemasDoDepartamento,
  RESPONSAVEIS_UNICOS,
  TIPOS_DEPARTAMENTO_OPERADORA,
  TIPOS_RESPONSAVEL_OPERADORA,
  type TipoResponsavelOperadora,
  valorDoParametro,
} from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteChave, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import {
  buscarPessoaResponsavel,
  definirParametroOperadora,
  type DepartamentoOperadora,
  gravarDepartamentoOperadora,
  incluirResponsavelOperadora,
  lerDepartamentosOperadora,
  lerParametrosOperadora,
  lerResponsaveisOperadora,
  type ParametroOperadora,
  type PessoaResponsavelOperadora,
} from '../../api-cadastro-complementar.js';
import { mensagensComplementarOperadora } from '../../i18n-complementar.js';
import { dataBr } from './comum.js';

const props = defineProps<{ operadora: number; podeEditar: boolean; hoje: string }>();
const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensComplementarOperadora } });

const responsaveis = useQuery({
  queryKey: computed(() => ['operadora', 'complementar', props.operadora, 'responsaveis']),
  queryFn: () => lerResponsaveisOperadora(props.operadora),
});
const departamentos = useQuery({
  queryKey: computed(() => ['operadora', 'complementar', props.operadora, 'departamentos']),
  queryFn: () => lerDepartamentosOperadora(props.operadora),
});
const parametros = useQuery({
  queryKey: computed(() => ['operadora', 'complementar', props.operadora, 'parametros']),
  queryFn: () => lerParametrosOperadora(props.operadora),
});

const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function limpar(): void {
  mensagem.value = null;
  recusa.value = null;
  erro.value = null;
}
function falhou(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409, 422].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}

const papel = (tipo: string) =>
  (mensagensComplementarOperadora.tiposResponsavel as Record<string, string>)[tipo] ?? tipo;
const tipoSetor = (tipo: string) =>
  (mensagensComplementarOperadora.tiposDepartamento as Record<string, string>)[tipo] ?? tipo;

// ---- responsáveis ----
const papeisSemTitular = computed(() => {
  const vig = new Set((responsaveis.data.value ?? []).filter((r) => r.vigente).map((r) => r.tipo));
  return RESPONSAVEIS_UNICOS.filter((p) => !vig.has(p)).map(papel);
});
const opcoesPapel = TIPOS_RESPONSAVEL_OPERADORA.map((v) => ({ valor: v as string, rotulo: papel(v) }));
const nr = reactive({
  aberto: false,
  tipo: 'representante_legal' as string,
  documento: '',
  registro: '',
  inicio: props.hoje as string | null,
  fim: null as string | null,
});
const pessoa = ref<PessoaResponsavelOperadora | null>(null);
const pessoaNaoAchada = ref(false);
watch(
  () => nr.documento,
  () => {
    pessoa.value = null;
    pessoaNaoAchada.value = false;
  },
);
async function buscarPessoa(): Promise<void> {
  limpar();
  try {
    pessoa.value = await buscarPessoaResponsavel(nr.documento);
    pessoaNaoAchada.value = pessoa.value === null;
  } catch (e) {
    falhou(e);
  }
}
const planoNovo = computed(() =>
  planoResponsavel(
    {
      tipo: nr.tipo,
      natureza: pessoa.value?.natureza ?? 'fisica',
      inicio: nr.inicio ?? '',
      fim: nr.fim,
      numeroRegistro: nr.registro.trim() || null,
    },
    (responsaveis.data.value ?? []).map((r) => ({
      id: r.id,
      tipo: r.tipo as TipoResponsavelOperadora,
      inicio: r.inicio,
      fim: r.fim,
    })),
  ),
);
const encerramentos = computed(() =>
  planoNovo.value.encerrar.map((e) => {
    const r = responsaveis.data.value?.find((x) => x.id === e.id);
    return t('responsavel.encerraAnterior', { nome: r?.nome ?? '—', fim: dataBr(e.fim) });
  }),
);
const podeGravarResponsavel = computed(() => pessoa.value !== null && planoNovo.value.problemas.length === 0);
async function gravarResponsavel(): Promise<void> {
  const p = pessoa.value;
  if (!p || !podeGravarResponsavel.value || !nr.inicio) return;
  limpar();
  try {
    await incluirResponsavelOperadora(props.operadora, {
      tipo: nr.tipo,
      natureza: p.natureza,
      pessoa: p.id,
      numeroRegistro: nr.registro.trim() || null,
      inicio: nr.inicio,
      fim: nr.fim,
    });
    mensagem.value = t('responsavel.gravado');
    nr.aberto = false;
    nr.documento = '';
    nr.registro = '';
    await responsaveis.refetch();
  } catch (e) {
    falhou(e);
  }
}

// ---- setores ----
const vazioSetor = () => ({
  id: null as number | null,
  versao: null as number | null,
  codigo: '',
  descricao: '',
  tipo: 'atendimento' as string,
  email: '',
  copia: '',
  superior: null as number | null,
  visivelPortal: false,
  ativo: true,
});
const ns = reactive({ aberto: false, ...vazioSetor() });
function abrirSetor(d: DepartamentoOperadora | null): void {
  limpar();
  Object.assign(ns, vazioSetor(), { aberto: true });
  if (d)
    Object.assign(ns, {
      id: d.id,
      versao: d.versao,
      codigo: d.codigo,
      descricao: d.descricao,
      tipo: d.tipo,
      email: d.email ?? '',
      copia: d.emailsCopia.join(', '),
      superior: d.superior,
      visivelPortal: d.visivelPortal,
      ativo: d.ativo,
    });
}
const opcoesTipoSetor = TIPOS_DEPARTAMENTO_OPERADORA.map((v) => ({
  valor: v as string,
  rotulo: tipoSetor(v),
}));
const opcoesSuperior = computed(() => [
  { valor: null as number | null, rotulo: t('departamento.semSuperior') },
  ...(departamentos.data.value ?? [])
    .filter((d) => d.id !== ns.id)
    .map((d) => ({ valor: d.id as number | null, rotulo: `${d.descricao} (${d.codigo})` })),
]);
const nomeSetor = (id: number | null) =>
  id === null ? '—' : (departamentos.data.value?.find((d) => d.id === id)?.descricao ?? String(id));
const copias = computed(() =>
  ns.copia
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);
const problemasSetor = computed(() =>
  problemasDoDepartamento(
    {
      id: ns.id,
      codigo: ns.codigo.trim(),
      descricao: ns.descricao,
      tipo: ns.tipo,
      email: ns.email.trim() || null,
      emailsCopia: copias.value,
      superior: ns.superior,
    },
    new Map((departamentos.data.value ?? []).map((d) => [d.id, d.superior])),
  ),
);
async function gravarSetor(): Promise<void> {
  if (problemasSetor.value.length) return;
  limpar();
  try {
    await gravarDepartamentoOperadora(props.operadora, {
      id: ns.id,
      versao: ns.versao,
      codigo: ns.codigo.trim(),
      descricao: ns.descricao.trim(),
      tipo: ns.tipo,
      email: ns.email.trim() || null,
      emailsCopia: copias.value,
      superior: ns.superior,
      visivelPortal: ns.visivelPortal,
      ativo: ns.ativo,
    });
    mensagem.value = t('departamento.gravado');
    ns.aberto = false;
    await departamentos.refetch();
  } catch (e) {
    falhou(e);
  }
}

// ---- parâmetros ----
const np = reactive({
  chave: null as string | null,
  valor: '',
  ligado: false,
  inicio: null as string | null,
  justificativa: '',
});
const booleano = (chave: string | null) =>
  chave !== null && (PARAMETROS_OPERADORA as Record<string, { tipo: string }>)[chave]?.tipo === 'booleano';
function abrirParametro(p: ParametroOperadora): void {
  limpar();
  np.chave = p.chave;
  np.valor = typeof p.valor === 'number' ? String(p.valor) : '';
  np.ligado = p.valor === true;
  np.inicio = null;
  np.justificativa = '';
}
const conferidoParametro = computed(() =>
  np.chave === null
    ? null
    : valorDoParametro(np.chave, booleano(np.chave) ? np.ligado : np.valor.replace(',', '.')),
);
const problemaParametro = computed(() => {
  const c = conferidoParametro.value;
  return c && 'problema' in c ? c.problema.detalhe : null;
});
async function gravarParametro(): Promise<void> {
  const c = conferidoParametro.value;
  if (!np.chave || !c || 'problema' in c) return;
  limpar();
  try {
    await definirParametroOperadora(props.operadora, {
      chave: np.chave,
      valor: booleano(np.chave) ? np.ligado : Number(c.valor),
      inicio: np.inicio,
      justificativa: np.justificativa.trim() || null,
    });
    mensagem.value = t('parametro.gravado');
    np.chave = null;
    await parametros.refetch();
  } catch (e) {
    falhou(e);
  }
}
const valorParametro = (p: ParametroOperadora) =>
  typeof p.valor === 'boolean' ? (p.valor ? t('parametro.sim') : t('parametro.nao')) : String(p.valor);

watch(
  () => props.operadora,
  () => {
    nr.aberto = false;
    ns.aberto = false;
    np.chave = null;
    limpar();
  },
);
</script>

<template>
  <section class="bloco" aria-labelledby="ope-compl-titulo" data-testid="operadora-complementar">
    <h2 id="ope-compl-titulo">{{ t('titulo') }}</h2>
    <p class="secundario">{{ t('texto') }}</p>
    <SanteAlerta
      v-if="!podeEditar"
      :texto="t('soConsulta')"
      variante="info"
      data-testid="compl-so-consulta"
    />
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="compl-mensagem" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="compl-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />

    <!-- Responsáveis perante a ANS -->
    <section class="bloco" aria-labelledby="ope-compl-resp" data-testid="compl-responsaveis">
      <h3 id="ope-compl-resp">{{ t('secoes.responsaveis') }}</h3>
      <MensagemErro v-if="responsaveis.isError.value" :erro="responsaveis.error.value" />
      <p v-else-if="!responsaveis.data.value" role="status">{{ t('carregando') }}</p>
      <template v-else>
        <SanteAlerta
          v-if="papeisSemTitular.length"
          :texto="t('responsavel.faltamUnicos', { papeis: papeisSemTitular.join(', ') })"
          variante="aviso"
          data-testid="compl-papeis-sem-titular"
        />
        <table v-if="responsaveis.data.value.length" class="tabela" data-testid="tabela-responsaveis">
          <thead>
            <tr>
              <th scope="col">{{ t('responsavel.colunas.papel') }}</th>
              <th scope="col">{{ t('responsavel.colunas.pessoa') }}</th>
              <th scope="col">{{ t('responsavel.colunas.registro') }}</th>
              <th scope="col">{{ t('responsavel.colunas.inicio') }}</th>
              <th scope="col">{{ t('responsavel.colunas.fim') }}</th>
              <th scope="col">{{ t('responsavel.colunas.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in responsaveis.data.value" :key="r.id" :data-testid="`responsavel-${r.id}`">
              <td>{{ papel(r.tipo) }}</td>
              <td>{{ r.nome ?? '—' }}</td>
              <td>{{ r.numeroRegistro ?? '—' }}</td>
              <td>{{ dataBr(r.inicio) }}</td>
              <td>{{ dataBr(r.fim) || '—' }}</td>
              <td>{{ r.vigente ? t('responsavel.vigente') : t('responsavel.encerrado') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('responsavel.nenhum') }}</p>
        <div v-if="podeEditar && !nr.aberto" class="acoes">
          <SanteBotao
            :rotulo="t('responsavel.novo')"
            data-testid="compl-resp-novo"
            @acionar="
              limpar();
              nr.aberto = true;
            "
          />
        </div>
        <form v-if="nr.aberto" data-testid="form-responsavel" @submit.prevent="gravarResponsavel">
          <div class="campos">
            <SanteSelecao
              v-model="nr.tipo"
              :rotulo="t('responsavel.papel')"
              :opcoes="opcoesPapel"
              obrigatorio
              data-testid="compl-resp-papel"
            />
            <SanteCampoTexto
              id="compl-resp-documento"
              v-model="nr.documento"
              :rotulo="t('responsavel.documento')"
              :max-bytes="18"
            />
            <SanteBotao
              :rotulo="t('responsavel.buscar')"
              variante="secundario"
              :desabilitado="nr.documento.replace(/\D/g, '').length < 11"
              data-testid="compl-resp-buscar"
              @acionar="buscarPessoa"
            />
          </div>
          <p v-if="pessoa" role="status" data-testid="compl-resp-pessoa">
            {{ t('responsavel.achada', { nome: pessoa.nome, natureza: t(`natureza.${pessoa.natureza}`) }) }}
          </p>
          <SanteAlerta v-if="pessoaNaoAchada" :texto="t('responsavel.naoAchada')" variante="aviso" />
          <div class="campos">
            <SanteCampoTexto
              v-if="nr.tipo === 'responsavel_tecnico'"
              id="compl-resp-registro"
              v-model="nr.registro"
              :rotulo="t('responsavel.registro')"
              :max-bytes="30"
              obrigatorio
            />
            <SanteData v-model="nr.inicio" :rotulo="t('responsavel.inicio')" editavel />
            <SanteData v-model="nr.fim" :rotulo="t('responsavel.fim')" editavel />
          </div>
          <ul
            v-if="pessoa && planoNovo.problemas.length"
            class="problemas"
            data-testid="compl-resp-problemas"
          >
            <li v-for="p in planoNovo.problemas" :key="p.codigo">{{ p.detalhe }}</li>
          </ul>
          <SanteAlerta
            v-for="(e, i) in encerramentos"
            :key="i"
            :texto="e"
            variante="info"
            data-testid="compl-resp-encerra"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('responsavel.gravar')"
              :desabilitado="!podeGravarResponsavel"
              data-testid="compl-resp-gravar"
              @acionar="gravarResponsavel"
            />
            <SanteBotao :rotulo="t('departamento.cancelar')" variante="texto" @acionar="nr.aberto = false" />
          </div>
        </form>
      </template>
    </section>

    <!-- Setores -->
    <section class="bloco" aria-labelledby="ope-compl-dep" data-testid="compl-departamentos">
      <h3 id="ope-compl-dep">{{ t('secoes.departamentos') }}</h3>
      <MensagemErro v-if="departamentos.isError.value" :erro="departamentos.error.value" />
      <p v-else-if="!departamentos.data.value" role="status">{{ t('carregando') }}</p>
      <template v-else>
        <table v-if="departamentos.data.value.length" class="tabela" data-testid="tabela-departamentos">
          <thead>
            <tr>
              <th scope="col">{{ t('departamento.colunas.codigo') }}</th>
              <th scope="col">{{ t('departamento.colunas.descricao') }}</th>
              <th scope="col">{{ t('departamento.colunas.tipo') }}</th>
              <th scope="col">{{ t('departamento.colunas.superior') }}</th>
              <th scope="col">{{ t('departamento.colunas.email') }}</th>
              <th scope="col">{{ t('departamento.colunas.situacao') }}</th>
              <th v-if="podeEditar" scope="col"><span class="secundario">—</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in departamentos.data.value" :key="d.id" :data-testid="`departamento-${d.codigo}`">
              <td>{{ d.codigo }}</td>
              <td>{{ d.descricao }}</td>
              <td>{{ tipoSetor(d.tipo) }}</td>
              <td>{{ nomeSetor(d.superior) }}</td>
              <td>{{ d.email ?? '—' }}</td>
              <td>{{ d.ativo ? t('departamento.ativo') : t('departamento.inativo') }}</td>
              <td v-if="podeEditar">
                <SanteBotao
                  :rotulo="t('departamento.editar')"
                  variante="texto"
                  :data-testid="`compl-dep-editar-${d.codigo}`"
                  @acionar="abrirSetor(d)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('departamento.nenhum') }}</p>
        <div v-if="podeEditar && !ns.aberto" class="acoes">
          <SanteBotao
            :rotulo="t('departamento.novo')"
            data-testid="compl-dep-novo"
            @acionar="abrirSetor(null)"
          />
        </div>
        <form v-if="ns.aberto" data-testid="form-departamento" @submit.prevent="gravarSetor">
          <div class="campos">
            <SanteCampoTexto
              id="compl-dep-codigo"
              v-model="ns.codigo"
              :rotulo="t('departamento.codigo')"
              :max-bytes="30"
              obrigatorio
            />
            <SanteCampoTexto
              id="compl-dep-descricao"
              v-model="ns.descricao"
              :rotulo="t('departamento.descricao')"
              :max-bytes="150"
              obrigatorio
            />
            <SanteSelecao
              v-model="ns.tipo"
              :rotulo="t('departamento.tipo')"
              :opcoes="opcoesTipoSetor"
              obrigatorio
              data-testid="compl-dep-tipo"
            />
            <SanteSelecao
              v-model="ns.superior"
              :rotulo="t('departamento.superior')"
              :opcoes="opcoesSuperior"
              data-testid="compl-dep-superior"
            />
            <SanteCampoTexto
              id="compl-dep-email"
              v-model="ns.email"
              :rotulo="t('departamento.email')"
              :max-bytes="254"
            />
            <SanteCampoTexto
              id="compl-dep-copia"
              v-model="ns.copia"
              :rotulo="t('departamento.copia')"
              :max-bytes="2000"
            />
          </div>
          <div class="campos">
            <SanteChave
              :ligada="ns.visivelPortal"
              :rotulo="t('departamento.portal')"
              @alternar="(v: boolean) => (ns.visivelPortal = v)"
            />
            <SanteChave
              :ligada="ns.ativo"
              :rotulo="t('departamento.ativoRotulo')"
              @alternar="(v: boolean) => (ns.ativo = v)"
            />
          </div>
          <ul v-if="problemasSetor.length" class="problemas" data-testid="compl-dep-problemas">
            <li v-for="p in problemasSetor" :key="`${p.codigo}-${p.campo}`">{{ p.detalhe }}</li>
          </ul>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('departamento.gravar')"
              :desabilitado="problemasSetor.length > 0"
              data-testid="compl-dep-gravar"
              @acionar="gravarSetor"
            />
            <SanteBotao :rotulo="t('departamento.cancelar')" variante="texto" @acionar="ns.aberto = false" />
          </div>
        </form>
      </template>
    </section>

    <!-- Parâmetros -->
    <section class="bloco" aria-labelledby="ope-compl-par" data-testid="compl-parametros">
      <h3 id="ope-compl-par">{{ t('secoes.parametros') }}</h3>
      <MensagemErro v-if="parametros.isError.value" :erro="parametros.error.value" />
      <p v-else-if="!parametros.data.value" role="status">{{ t('carregando') }}</p>
      <table v-else class="tabela" data-testid="tabela-parametros">
        <thead>
          <tr>
            <th scope="col">{{ t('parametro.colunas.descricao') }}</th>
            <th scope="col">{{ t('parametro.colunas.valor') }}</th>
            <th scope="col">{{ t('parametro.colunas.desde') }}</th>
            <th v-if="podeEditar" scope="col"><span class="secundario">—</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in parametros.data.value" :key="p.chave" :data-testid="`parametro-${p.chave}`">
            <td>{{ p.descricao }}</td>
            <td>
              {{ valorParametro(p) }}
              <span v-if="p.padrao" class="secundario">({{ t('parametro.padrao') }})</span>
            </td>
            <td>{{ dataBr(p.desde) || '—' }}</td>
            <td v-if="podeEditar">
              <SanteBotao
                :rotulo="t('parametro.alterar')"
                variante="texto"
                :data-testid="`compl-par-alterar-${p.chave}`"
                @acionar="abrirParametro(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="np.chave" data-testid="form-parametro" @submit.prevent="gravarParametro">
        <div class="campos">
          <SanteChave
            v-if="booleano(np.chave)"
            :ligada="np.ligado"
            :rotulo="t('parametro.novoValor')"
            @alternar="(v: boolean) => (np.ligado = v)"
          />
          <SanteCampoTexto
            v-else
            id="compl-par-valor"
            v-model="np.valor"
            :rotulo="t('parametro.novoValor')"
            :max-bytes="20"
          />
          <SanteData v-model="np.inicio" :rotulo="t('parametro.inicio')" editavel />
          <SanteCampoTexto
            id="compl-par-justificativa"
            v-model="np.justificativa"
            :rotulo="t('parametro.justificativa')"
            :max-bytes="500"
            multilinha
          />
        </div>
        <p v-if="problemaParametro" class="problemas" role="alert" data-testid="compl-par-problema">
          {{ problemaParametro }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('parametro.gravar')"
            :desabilitado="problemaParametro !== null"
            data-testid="compl-par-gravar"
            @acionar="gravarParametro"
          />
          <SanteBotao :rotulo="t('parametro.cancelar')" variante="texto" @acionar="np.chave = null" />
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.problemas {
  color: var(--sgh-alerta);
}
</style>
