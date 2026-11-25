<script setup lang="ts">
// Rede credenciada da operadora própria (M56, etapa 4, F3; item `Faturamento > Operadora própria > Rede credenciada e
// prestadora`; `operadora.prestador.ler` / `.editar`): as contagens da rede, a lista dos prestadores por nome (busca
// pelo nome, CPF, CNPJ ou CNES; situação e tipo; paginada pela chave; CPF mascarado), a ficha do prestador com os
// movimentos do registro de prestadores da ANS, o credenciamento e a alteração (FormPrestador), o descredenciamento
// com o motivo, o aviso aos beneficiários, a data e o substituto equivalente ou a autorização da ANS, a reinclusão
// com o contrato novo, os movimentos a enviar e as tabelas da rede (CRUD genérico do grupo `operadora`). A fatia nasce
// desligada (POL-3): a tela diz o motivo e não mostra a rede.
import {
  type ApoioRede,
  type PrestadorDetalhe,
  type PrestadorResumo,
  type ResultadoRede,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import {
  descredenciarPrestador,
  lerApoioRede,
  lerMovimentosRps,
  lerPrestador,
  lerPrestadores,
  reincluirPrestador,
} from '../api-rede.js';
import { TIPOS_MOTIVO_DESCREDENCIAMENTO } from '../api-rede-cadastro.js';
import CadastroRedePrestador from '../componentes/CadastroRedePrestador.vue';
import FormPrestador from '../componentes/FormPrestador.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['operadora', 'rede', 'apoio'], queryFn: () => lerApoioRede() });
const ligada = computed(() => apoio.data.value?.ligada === true);
const podeEditar = computed(() => apoio.data.value?.podeEditar === true);

const rotulo = (dominio: keyof ApoioRede['dominios'], codigo: number | null) =>
  codigo === null
    ? '—'
    : (apoio.data.value?.dominios[dominio].find((x) => x.codigo === codigo)?.rotulo ?? String(codigo));
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string) => `${data(d.slice(0, 10))} ${d.slice(11, 16)}`;

// ── Lista (filtro aplicado + pilha de cursores para voltar) ──────────────────────────────────────────
const busca = ref('');
const situacao = ref<string | null>(null);
const tipo = ref<number | null>(null);
const aplicado = ref<{ busca: string; situacao: string | null; tipo: number | null }>({
  busca: '',
  situacao: null,
  tipo: null,
});
const cursores = ref<(string | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'rede', 'prestadores', aplicado.value, cursor.value]),
  queryFn: () =>
    lerPrestadores({
      busca: aplicado.value.busca || null,
      situacao: aplicado.value.situacao,
      tipo: aplicado.value.tipo,
      apos: cursor.value,
    }),
  enabled: ligada,
});
function filtrar(): void {
  aplicado.value = { busca: busca.value.trim(), situacao: situacao.value, tipo: tipo.value };
  cursores.value = [null];
}
function proxima(): void {
  const p = lista.data.value?.proxima;
  if (p) cursores.value = [...cursores.value, p];
}
function anterior(): void {
  if (cursores.value.length > 1) cursores.value = cursores.value.slice(0, -1);
}
const opcoesSituacao = computed(() => [
  { valor: null, rotulo: t('operadoraRede.filtro.todas') },
  { valor: 'credenciado', rotulo: t('operadoraRede.situacoes.credenciado') },
  { valor: 'descredenciado', rotulo: t('operadoraRede.situacoes.descredenciado') },
]);
const opcoesTipo = computed(() => [
  { valor: null, rotulo: t('operadoraRede.filtro.todos') },
  ...(apoio.data.value?.dominios.tipo ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
]);

// ── Movimentos a enviar ao registro de prestadores da ANS ─────────────────────────────────────────────
const pendentes = useQuery({
  queryKey: ['operadora', 'rede', 'movimentos', 'pendente'],
  queryFn: () => lerMovimentosRps('pendente', null),
  enabled: ligada,
});
const camposDoMovimento = (campos: readonly string[]) =>
  campos.length ? campos.map((c) => t(`operadoraRede.movimentos.camposRps.${c}`)).join(', ') : '—';

// ── Ficha, formulário e diálogos ──────────────────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'rede', 'prestador', aberto.value]),
  queryFn: () => lerPrestador(aberto.value as number),
  enabled: computed(() => aberto.value !== null && ligada.value),
});
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const formulario = ref<{ inicial: PrestadorDetalhe | null } | null>(null);
const dialogoForm = computed({
  get: () => formulario.value !== null,
  set: (v: boolean) => {
    if (!v) formulario.value = null;
  },
});

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['operadora', 'rede'] });
}
async function gravado(r: ResultadoRede): Promise<void> {
  formulario.value = null;
  descredenciando.value = null;
  reincluindo.value = null;
  mensagem.value = r.mensagem;
  avisos.value = r.avisos;
  aberto.value = r.id;
  await recarregar();
}
function abrir(p: PrestadorResumo): void {
  mensagem.value = null;
  avisos.value = [];
  aberto.value = p.id;
}

// Descredenciamento.
const descredenciando = ref<PrestadorDetalhe | null>(null);
const dialogoDesc = computed({
  get: () => descredenciando.value !== null,
  set: (v: boolean) => {
    if (!v) descredenciando.value = null;
  },
});
const dMotivo = ref('');
const dAviso = ref<string | null>(null);
const dEfetivo = ref<string | null>(null);
const dSubstituto = ref<number | null>(null);
const dAutorizacao = ref('');
// C2-118: o tipo do motivo vai ao registro próprio do descredenciamento.
const dTipoMotivo = ref<keyof typeof TIPOS_MOTIVO_DESCREDENCIAMENTO | null>('iniciativa_operadora');
const opcoesTipoMotivo = Object.entries(TIPOS_MOTIVO_DESCREDENCIAMENTO).map(([valor, rotulo]) => ({
  valor: valor as keyof typeof TIPOS_MOTIVO_DESCREDENCIAMENTO | null,
  rotulo,
}));
const dBusca = ref('');
const dBuscaAplicada = ref('');
const recusaDialogo = ref<string | null>(null);
const erroDialogo = ref<unknown>(null);
const candidatos = useQuery({
  queryKey: computed(() => ['operadora', 'rede', 'candidatos', dBuscaAplicada.value]),
  queryFn: () => lerPrestadores({ busca: dBuscaAplicada.value || null, situacao: 'credenciado' }),
  enabled: computed(() => descredenciando.value !== null),
});
const opcoesSubstituto = computed(() => [
  { valor: null, rotulo: t('operadoraRede.descredenciar.semSubstituto') },
  ...(candidatos.data.value?.itens ?? [])
    // Quem já tem a saída agendada não serve de substituto (a regra recusa).
    .filter((p) => p.id !== descredenciando.value?.id && p.saidaEm === null)
    .map((p) => ({
      valor: p.id,
      rotulo: `${p.nome} · ${rotulo('tipo', p.tipo)} · ${p.municipioIbge}/${p.uf}`,
    })),
]);
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function abrirDescredenciar(p: PrestadorDetalhe): void {
  const hoje = apoio.data.value?.hoje ?? p.situacaoEm;
  dMotivo.value = '';
  dAviso.value = hoje;
  dEfetivo.value = somaDias(hoje, 30);
  dSubstituto.value = null;
  dAutorizacao.value = '';
  dTipoMotivo.value = 'iniciativa_operadora';
  dBusca.value = '';
  dBuscaAplicada.value = '';
  recusaDialogo.value = null;
  erroDialogo.value = null;
  descredenciando.value = p;
}
function falhou(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
    recusaDialogo.value = e.problema.detail;
  else erroDialogo.value = e;
}
async function confirmarDescredenciar(): Promise<void> {
  const p = descredenciando.value;
  if (!p || !dAviso.value || !dEfetivo.value) return;
  recusaDialogo.value = null;
  erroDialogo.value = null;
  try {
    await gravado(
      await descredenciarPrestador(p.id, {
        versao: p.versao,
        motivo: dMotivo.value,
        efetivoEm: dEfetivo.value,
        avisoBeneficiariosEm: dAviso.value,
        substituto: dSubstituto.value,
        autorizacaoAns: dAutorizacao.value.trim() || null,
        tipoMotivo: dTipoMotivo.value ?? 'iniciativa_operadora',
      }),
    );
  } catch (e) {
    falhou(e);
  }
}

// Reinclusão.
const reincluindo = ref<PrestadorDetalhe | null>(null);
const dialogoReinc = computed({
  get: () => reincluindo.value !== null,
  set: (v: boolean) => {
    if (!v) reincluindo.value = null;
  },
});
const rMotivo = ref('');
const rNumero = ref('');
const rInicio = ref<string | null>(null);
const rFim = ref<string | null>(null);
const rForma = ref<number | null>(1);
const rMes = ref<number | null>(1);
function abrirReincluir(p: PrestadorDetalhe): void {
  // Saída agendada: cancelar a saída mantém o contrato em vigor (os campos vêm preenchidos com ele).
  const cancelar = p.saidaEm !== null;
  rMotivo.value = '';
  rNumero.value = cancelar ? p.contrato.numero : '';
  rInicio.value = cancelar ? p.contrato.inicio : (apoio.data.value?.hoje ?? null);
  rFim.value = cancelar ? p.contrato.fim : null;
  rForma.value = p.contrato.formaReajuste;
  rMes.value = p.contrato.mesReajuste;
  recusaDialogo.value = null;
  erroDialogo.value = null;
  reincluindo.value = p;
}
async function confirmarReincluir(): Promise<void> {
  const p = reincluindo.value;
  if (!p || !rInicio.value) return;
  recusaDialogo.value = null;
  erroDialogo.value = null;
  try {
    await gravado(
      await reincluirPrestador(p.id, {
        versao: p.versao,
        motivo: rMotivo.value,
        contrato: {
          numero: rNumero.value,
          inicio: rInicio.value,
          fim: rFim.value,
          formaReajuste: rForma.value,
          mesReajuste: rMes.value,
        },
      }),
    );
  } catch (e) {
    falhou(e);
  }
}
const opcoesForma = computed(() =>
  (apoio.data.value?.dominios.formaReajuste ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
);
const opcoesMes = computed(() =>
  Array.from({ length: 12 }, (_, k) => ({ valor: k + 1, rotulo: t(`operadoraRede.meses.${k + 1}`) })),
);
watch(ligada, (v) => {
  if (!v) aberto.value = null;
});
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-rede-titulo" data-testid="tela-operadora-rede">
    <h1 id="ope-rede-titulo">{{ t('operadoraRede.titulo') }}</h1>
    <p>{{ t('operadoraRede.texto') }}</p>
    <p>
      <RouterLink to="/operadora/contas" data-testid="link-contas-medicas">{{
        t('operadoraContas.atalho')
      }}</RouterLink>
    </p>

    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!apoio.data.value" role="status">{{ t('operadoraRede.carregando') }}</p>
    <div v-else-if="!ligada" data-testid="rede-desligada">
      <SanteAlerta :texto="apoio.data.value.motivo ?? t('operadoraRede.desligada')" variante="info" />
    </div>

    <template v-if="apoio.data.value && ligada">
      <p v-if="mensagem" role="status" data-testid="rede-mensagem">{{ mensagem }}</p>
      <ul v-if="avisos.length" class="secundario" data-testid="rede-avisos">
        <li v-for="a in avisos" :key="a">{{ a }}</li>
      </ul>

      <dl v-if="lista.data.value" class="totais" data-testid="rede-totais">
        <div v-for="(v, k) in lista.data.value.totais" :key="k" :data-testid="`rede-total-${k}`">
          <dt>{{ t(`operadoraRede.totais.${k}`) }}</dt>
          <dd>{{ v }}</dd>
        </div>
      </dl>

      <section class="bloco" aria-labelledby="ope-rede-lista">
        <h2 id="ope-rede-lista">{{ t('operadoraRede.colunas.nome') }}</h2>
        <form class="campos" data-testid="rede-filtro" @submit.prevent="filtrar">
          <SanteCampoTexto
            id="rede-busca"
            v-model="busca"
            :rotulo="t('operadoraRede.filtro.busca')"
            :max-bytes="60"
          />
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('operadoraRede.filtro.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="rede-filtro-situacao"
          />
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('operadoraRede.filtro.tipo')"
            :opcoes="opcoesTipo"
            data-testid="rede-filtro-tipo"
          />
          <div class="acoes">
            <SanteBotao tipo="submit" :rotulo="t('operadoraRede.filtro.buscar')" data-testid="rede-buscar" />
            <SanteBotao
              v-if="podeEditar"
              variante="secundario"
              :rotulo="t('operadoraRede.acoes.credenciar')"
              data-testid="rede-credenciar"
              @acionar="formulario = { inicial: null }"
            />
          </div>
        </form>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value" role="status">{{ t('operadoraRede.carregando') }}</p>
        <p v-else-if="lista.data.value.itens.length === 0" data-testid="rede-vazia">
          {{ t('operadoraRede.nenhum') }}
        </p>
        <table v-else class="tabela" data-testid="rede-prestadores">
          <caption class="visualmente-oculto">
            {{
              t('operadoraRede.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('operadoraRede.colunas.nome') }}</th>
              <th scope="col">{{ t('operadoraRede.colunas.documento') }}</th>
              <th scope="col">{{ t('operadoraRede.colunas.tipo') }}</th>
              <th scope="col">{{ t('operadoraRede.colunas.cnes') }}</th>
              <th scope="col">{{ t('operadoraRede.colunas.local') }}</th>
              <th scope="col">{{ t('operadoraRede.colunas.situacao') }}</th>
              <th scope="col">{{ t('operadoraRede.colunas.contratoFim') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('operadoraRede.colunas.acoes') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`rede-prestador-${p.id}`">
              <td>
                {{ p.nome }}
                <template v-if="p.ehOHospital"> · {{ t('operadoraRede.ficha.ehOHospital') }}</template>
              </td>
              <td>{{ p.documento }}</td>
              <td>{{ rotulo('tipo', p.tipo) }}</td>
              <td>{{ p.cnes ?? '—' }}</td>
              <td>{{ p.municipioIbge }}/{{ p.uf }}</td>
              <td :data-situacao="p.saidaEm ? 'saida-agendada' : p.situacao">
                {{ t(`operadoraRede.situacoes.${p.situacao}`) }} ·
                <template v-if="p.saidaEm">{{
                  t('operadoraRede.ficha.saidaEm', { data: data(p.saidaEm) })
                }}</template>
                <template v-else>{{ data(p.situacaoEm) }}</template>
              </td>
              <td>{{ p.contratoFim ? data(p.contratoFim) : t('operadoraRede.ficha.semFim') }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('operadoraRede.acoes.abrir', { nome: p.nome })"
                  :data-testid="`rede-abrir-${p.id}`"
                  @acionar="abrir(p)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="lista.data.value" class="acoes">
          <SanteBotao
            v-if="cursores.length > 1"
            variante="secundario"
            :rotulo="t('operadoraRede.paginas.anterior')"
            data-testid="rede-anterior"
            @acionar="anterior"
          />
          <SanteBotao
            v-if="lista.data.value.proxima"
            variante="secundario"
            :rotulo="t('operadoraRede.paginas.proxima')"
            data-testid="rede-proxima"
            @acionar="proxima"
          />
          <span v-else-if="cursores.length > 1" class="secundario">{{ t('operadoraRede.paginas.fim') }}</span>
        </div>
      </section>

      <section v-if="aberto !== null" class="bloco" aria-labelledby="ope-rede-ficha" data-testid="rede-ficha">
        <h2 id="ope-rede-ficha">{{ t('operadoraRede.ficha.titulo') }}</h2>
        <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
        <p v-else-if="!ficha.data.value" role="status">{{ t('operadoraRede.carregando') }}</p>
        <template v-else>
          <h3>{{ ficha.data.value.nome }}</h3>
          <dl class="ficha">
            <div>
              <dt>{{ t('operadoraRede.ficha.pessoa') }}</dt>
              <dd>{{ t(`operadoraRede.ficha.pessoas.${ficha.data.value.pessoa}`) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.colunas.documento') }}</dt>
              <dd data-testid="rede-ficha-documento">{{ ficha.data.value.documento }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.colunas.cnes') }}</dt>
              <dd>{{ ficha.data.value.cnes ?? '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.colunas.local') }}</dt>
              <dd>{{ ficha.data.value.municipioIbge }}/{{ ficha.data.value.uf }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.colunas.tipo') }}</dt>
              <dd>{{ rotulo('tipo', ficha.data.value.tipo) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.natureza') }}</dt>
              <dd>{{ rotulo('natureza', ficha.data.value.natureza) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.classificacao') }}</dt>
              <dd>{{ rotulo('classificacao', ficha.data.value.classificacao) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.contratacao') }}</dt>
              <dd>
                {{ rotulo('contratacao', ficha.data.value.contratacao) }}
                <template v-if="ficha.data.value.operadoraIntermediaria">
                  · {{ ficha.data.value.operadoraIntermediaria }}</template
                >
              </dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.disponibilidade') }}</dt>
              <dd>{{ rotulo('disponibilidade', ficha.data.value.disponibilidade) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.isencaoOnus') }}</dt>
              <dd>{{ rotulo('isencaoOnus', ficha.data.value.isencaoOnus) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.urgencia') }}</dt>
              <dd>
                {{ ficha.data.value.urgencia ? t('operadoraRede.ficha.sim') : t('operadoraRede.ficha.nao') }}
              </dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.regime') }}</dt>
              <dd>{{ rotulo('regime', ficha.data.value.regime) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.remuneracao') }}</dt>
              <dd>{{ rotulo('remuneracao', ficha.data.value.remuneracao) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.contrato') }}</dt>
              <dd data-testid="rede-ficha-contrato">
                {{ ficha.data.value.contrato.numero }} ·
                {{
                  t('operadoraRede.ficha.vigencia', {
                    inicio: data(ficha.data.value.contrato.inicio),
                    fim: ficha.data.value.contrato.fim
                      ? data(ficha.data.value.contrato.fim)
                      : t('operadoraRede.ficha.semFim'),
                  })
                }}
                · {{ rotulo('formaReajuste', ficha.data.value.contrato.formaReajuste) }} ·
                {{ t(`operadoraRede.meses.${ficha.data.value.contrato.mesReajuste}`) }}
              </dd>
            </div>
            <div v-if="ficha.data.value.ehOHospital">
              <dt>{{ t('operadoraRede.ficha.estabelecimento') }}</dt>
              <dd>{{ ficha.data.value.estabelecimento }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.convenio') }}</dt>
              <dd>{{ ficha.data.value.convenio ?? t('operadoraRede.ficha.semConvenio') }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.colunas.situacao') }}</dt>
              <dd data-testid="rede-ficha-situacao">
                {{ t(`operadoraRede.situacoes.${ficha.data.value.situacao}`) }} ·
                <template v-if="ficha.data.value.saidaEm">
                  {{ t('operadoraRede.ficha.saidaEm', { data: data(ficha.data.value.saidaEm) }) }}
                </template>
                <template v-else>{{ data(ficha.data.value.situacaoEm) }}</template>
                <template v-if="ficha.data.value.hospitalar">
                  · {{ t('operadoraRede.ficha.hospitalar') }}</template
                >
              </dd>
            </div>
            <div v-if="ficha.data.value.motivoSituacao">
              <dt>{{ t('operadoraRede.ficha.motivo') }}</dt>
              <dd>{{ ficha.data.value.motivoSituacao }}</dd>
            </div>
            <div v-if="ficha.data.value.substituto">
              <dt>{{ t('operadoraRede.ficha.substituto') }}</dt>
              <dd>{{ ficha.data.value.substituto }}</dd>
            </div>
            <div v-if="ficha.data.value.avisoBeneficiariosEm">
              <dt>{{ t('operadoraRede.ficha.aviso') }}</dt>
              <dd>{{ data(ficha.data.value.avisoBeneficiariosEm) }}</dd>
            </div>
            <div v-if="ficha.data.value.autorizacaoAns">
              <dt>{{ t('operadoraRede.ficha.autorizacaoAns') }}</dt>
              <dd>{{ ficha.data.value.autorizacaoAns }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraRede.ficha.alteradoPor') }}</dt>
              <dd>{{ ficha.data.value.alteradoPor }} · {{ quando(ficha.data.value.alteradoEm) }}</dd>
            </div>
          </dl>
          <div v-if="podeEditar" class="acoes">
            <SanteBotao
              v-if="ficha.data.value.situacao === 'credenciado' && !ficha.data.value.saidaEm"
              variante="secundario"
              :rotulo="t('operadoraRede.acoes.alterar')"
              data-testid="rede-alterar"
              @acionar="formulario = { inicial: ficha.data.value }"
            />
            <SanteBotao
              v-if="ficha.data.value.situacao === 'credenciado' && !ficha.data.value.saidaEm"
              variante="secundario"
              :rotulo="t('operadoraRede.acoes.descredenciar')"
              data-testid="rede-descredenciar"
              @acionar="abrirDescredenciar(ficha.data.value)"
            />
            <SanteBotao
              v-if="ficha.data.value.situacao === 'descredenciado' || ficha.data.value.saidaEm"
              variante="secundario"
              :rotulo="
                ficha.data.value.saidaEm
                  ? t('operadoraRede.acoes.cancelarSaida')
                  : t('operadoraRede.acoes.reincluir')
              "
              data-testid="rede-reincluir"
              @acionar="abrirReincluir(ficha.data.value)"
            />
            <SanteBotao variante="texto" :rotulo="t('operadoraRede.acoes.fechar')" @acionar="aberto = null" />
          </div>
          <h3>{{ t('operadoraRede.movimentos.titulo') }}</h3>
          <table class="tabela" data-testid="rede-ficha-movimentos">
            <caption class="visualmente-oculto">
              {{
                t('operadoraRede.movimentos.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('operadoraRede.movimentos.movimento') }}</th>
                <th scope="col">{{ t('operadoraRede.movimentos.campos') }}</th>
                <th scope="col">{{ t('operadoraRede.movimentos.quando') }}</th>
                <th scope="col">{{ t('operadoraRede.movimentos.situacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in ficha.data.value.movimentos" :key="m.id">
                <td>{{ rotulo('movimento', m.movimento) }}</td>
                <td>{{ camposDoMovimento(m.campos) }}</td>
                <td>{{ quando(m.registradoEm) }}</td>
                <td>{{ t(`operadoraRede.movimentos.${m.situacao}`) }}</td>
              </tr>
            </tbody>
          </table>
          <CadastroRedePrestador :prestador="ficha.data.value.id" :pode-editar="podeEditar" />
        </template>
      </section>

      <section class="bloco" aria-labelledby="ope-rede-rps" data-testid="rede-rps">
        <h2 id="ope-rede-rps">{{ t('operadoraRede.movimentos.titulo') }}</h2>
        <p class="secundario">{{ t('operadoraRede.movimentos.texto') }}</p>
        <MensagemErro v-if="pendentes.isError.value" :erro="pendentes.error.value" />
        <p v-else-if="!pendentes.data.value" role="status">{{ t('operadoraRede.carregando') }}</p>
        <p v-else-if="pendentes.data.value.itens.length === 0">{{ t('operadoraRede.movimentos.nenhum') }}</p>
        <table v-else class="tabela" data-testid="rede-rps-pendentes">
          <caption class="visualmente-oculto">
            {{
              t('operadoraRede.movimentos.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('operadoraRede.colunas.nome') }}</th>
              <th scope="col">{{ t('operadoraRede.movimentos.movimento') }}</th>
              <th scope="col">{{ t('operadoraRede.movimentos.campos') }}</th>
              <th scope="col">{{ t('operadoraRede.movimentos.quando') }}</th>
              <th scope="col">{{ t('operadoraRede.movimentos.por') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in pendentes.data.value.itens" :key="m.id">
              <td>{{ m.prestadorNome }}</td>
              <td>{{ rotulo('movimento', m.movimento) }}</td>
              <td>{{ camposDoMovimento(m.campos) }}</td>
              <td>{{ quando(m.registradoEm) }}</td>
              <td>{{ m.registradoPor }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <GrupoDominiosTela subitem="operadoraRede" embutida />

    <SanteDialogo
      v-model:visivel="dialogoForm"
      :titulo="
        formulario?.inicial
          ? t('operadoraRede.form.tituloAlterar', { nome: formulario.inicial.nome })
          : t('operadoraRede.form.tituloNovo')
      "
      largura="56rem"
    >
      <FormPrestador
        v-if="formulario && apoio.data.value"
        :key="formulario.inicial?.id ?? 'novo'"
        :apoio="apoio.data.value"
        :inicial="formulario.inicial"
        @gravado="gravado"
        @cancelar="formulario = null"
      />
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoDesc"
      :titulo="t('operadoraRede.descredenciar.titulo', { nome: descredenciando?.nome ?? '' })"
      largura="44rem"
    >
      <div class="formulario" data-testid="form-descredenciar">
        <p class="secundario">{{ t('operadoraRede.descredenciar.texto') }}</p>
        <SanteSelecao
          v-model="dTipoMotivo"
          :rotulo="t('operadoraRede.descredenciar.tipoMotivo')"
          :opcoes="opcoesTipoMotivo"
          data-testid="rede-desc-tipo-motivo"
        />
        <SanteCampoTexto
          id="rede-desc-motivo"
          v-model="dMotivo"
          :rotulo="t('operadoraRede.descredenciar.motivo')"
          :max-bytes="200"
          multilinha
          obrigatorio
        />
        <SanteData
          v-model="dAviso"
          :rotulo="t('operadoraRede.descredenciar.avisoEm')"
          editavel
          data-testid="rede-desc-aviso"
        />
        <SanteData
          v-model="dEfetivo"
          :rotulo="t('operadoraRede.descredenciar.efetivoEm')"
          editavel
          data-testid="rede-desc-efetivo"
        />
        <form class="campos" @submit.prevent="dBuscaAplicada = dBusca.trim()">
          <SanteCampoTexto
            id="rede-desc-busca"
            v-model="dBusca"
            :rotulo="t('operadoraRede.descredenciar.buscarSubstituto')"
            :max-bytes="60"
          />
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('operadoraRede.filtro.buscar')" />
        </form>
        <SanteSelecao
          v-model="dSubstituto"
          :rotulo="t('operadoraRede.descredenciar.substituto')"
          :opcoes="opcoesSubstituto"
          :busca="true"
          data-testid="rede-desc-substituto"
        />
        <SanteCampoTexto
          v-if="descredenciando?.hospitalar"
          id="rede-desc-autorizacao"
          v-model="dAutorizacao"
          :rotulo="t('operadoraRede.descredenciar.autorizacaoAns')"
          :max-bytes="40"
        />
        <SanteAlerta
          v-if="recusaDialogo"
          :texto="recusaDialogo"
          variante="alerta"
          data-testid="rede-desc-recusa"
        />
        <MensagemErro v-if="erroDialogo" :erro="erroDialogo" />
      </div>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraRede.acoes.cancelar')"
          @acionar="descredenciando = null"
        />
        <SanteBotao
          variante="destrutivo"
          :confirmacao="t('operadoraRede.acoes.confirmarDescredenciar')"
          :rotulo="t('operadoraRede.acoes.descredenciar')"
          :desabilitado="dMotivo.trim().length < 10 || !dAviso || !dEfetivo"
          data-testid="rede-desc-confirmar"
          @acionar="confirmarDescredenciar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoReinc"
      :titulo="
        reincluindo?.saidaEm
          ? t('operadoraRede.reincluir.tituloCancelar', { nome: reincluindo.nome })
          : t('operadoraRede.reincluir.titulo', { nome: reincluindo?.nome ?? '' })
      "
      largura="44rem"
    >
      <div class="formulario" data-testid="form-reincluir">
        <p class="secundario">
          {{
            reincluindo?.saidaEm
              ? t('operadoraRede.reincluir.textoCancelar', { data: data(reincluindo.saidaEm) })
              : t('operadoraRede.reincluir.texto')
          }}
        </p>
        <SanteCampoTexto
          id="rede-reinc-motivo"
          v-model="rMotivo"
          :rotulo="t('operadoraRede.reincluir.motivo')"
          :max-bytes="200"
          multilinha
          obrigatorio
        />
        <SanteCampoTexto
          id="rede-reinc-numero"
          v-model="rNumero"
          :rotulo="t('operadoraRede.ficha.contratoNumero')"
          :max-bytes="30"
          obrigatorio
        />
        <SanteData v-model="rInicio" :rotulo="t('operadoraRede.ficha.inicio')" editavel />
        <SanteData v-model="rFim" :rotulo="t('operadoraRede.ficha.fim')" editavel />
        <SanteSelecao
          v-model="rForma"
          :rotulo="t('operadoraRede.ficha.formaReajuste')"
          :opcoes="opcoesForma"
          data-testid="rede-reinc-forma"
        />
        <SanteSelecao
          v-model="rMes"
          :rotulo="t('operadoraRede.ficha.mesReajuste')"
          :opcoes="opcoesMes"
          data-testid="rede-reinc-mes"
        />
        <SanteAlerta
          v-if="recusaDialogo"
          :texto="recusaDialogo"
          variante="alerta"
          data-testid="rede-reinc-recusa"
        />
        <MensagemErro v-if="erroDialogo" :erro="erroDialogo" />
      </div>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraRede.acoes.cancelar')"
          @acionar="reincluindo = null"
        />
        <SanteBotao
          :rotulo="t('operadoraRede.acoes.reincluir')"
          :desabilitado="rMotivo.trim().length < 10 || !rNumero.trim() || !rInicio"
          data-testid="rede-reinc-confirmar"
          @acionar="confirmarReincluir"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.totais div,
.ficha div {
  display: grid;
  gap: 0.125rem;
}
.totais dd {
  font-size: 1.5rem;
  margin: 0;
}
.ficha {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}
.ficha dt {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
}
.ficha dd {
  margin: 0;
}
.formulario {
  display: grid;
  gap: 0.75rem;
}
</style>
