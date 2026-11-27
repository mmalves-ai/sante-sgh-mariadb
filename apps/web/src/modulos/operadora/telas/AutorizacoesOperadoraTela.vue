<script setup lang="ts">
// Autorização de guias e auditoria médica da operadora própria (M56, etapa 5, F4; item `Faturamento > Operadora própria >
// Atendimento, autorização e protocolos`; `operadora.autorizacao.ler` / `.registrar` / `.decidir` e
// `operadora.auditor.designar`): as contagens (em análise, aguardando complemento, em junta, vencidas, decididos hoje),
// a lista dos pedidos (busca pelo protocolo, pela senha, pela carteirinha ou pelo nome; situação; só vencidas; páginas),
// o registro do pedido com o protocolo e o prazo (FormAutorizacao), a ficha com as críticas de hoje, os itens, o
// histórico e o comunicado da negativa, o complemento pedido e recebido, a decisão do auditor designado
// (DecisaoAutorizacao), a junta da divergência técnica e a conclusão dela, o cancelamento e os domínios do item (CRUD
// genérico do grupo `operadora`). A fatia nasce desligada (POL-3): a tela diz o motivo e não mostra os pedidos.
// Correção da revisão: a rota e o menu pedem `operadora.dominio.ler` (todo perfil da operadora), para o gestor gravar os
// motivos de ligação e os vínculos com titular; as guias (conteúdo clínico) só aparecem a quem tem
// `operadora.autorizacao.ler`. A designação dos auditores fica na aba Auditores da tela dos beneficiários.
// M56.8 (F7): o atendimento ao beneficiário com protocolo (ProtocolosAtendimento) entra nesta tela, só a quem tem
// `operadora.protocolo.ler`.
import {
  type AutorizacaoDetalhe,
  type AutorizacaoResumo,
  CARATERES_ATENDIMENTO,
  type ResultadoAutorizacao,
  TABELAS_ITEM_GUIA,
  TIPO_GUIA,
  TIPOS_INTERNACAO,
  UFS,
} from '@sgh/contratos';
import { acaoPermitida } from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import {
  abrirJunta,
  cancelarAutorizacao,
  lerApoioAutorizacoes,
  lerAutorizacao,
  lerAutorizacoes,
  pedirComplemento,
  responderComplemento,
  urlAnexoComplemento,
} from '../api-autorizacao.js';
import DecisaoAutorizacao from '../componentes/DecisaoAutorizacao.vue';
import FormAutorizacao from '../componentes/FormAutorizacao.vue';
import ProtocolosAtendimento from '../componentes/f7/ProtocolosAtendimento.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const ITEM = 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.atendimento-autorizacao-e-protocolos';
const leGuias = computed(() => podeNaSessao('operadora.autorizacao.ler'));
const leProtocolos = computed(() => podeNaSessao('operadora.protocolo.ler'));
const apoio = useQuery({
  queryKey: ['operadora', 'autorizacoes', 'apoio'],
  queryFn: () => lerApoioAutorizacoes(),
  enabled: leGuias,
});
const ligada = computed(() => apoio.data.value?.ligada === true);
const podeRegistrar = computed(() => apoio.data.value?.podeRegistrar === true);
const auditor = computed(() => apoio.data.value?.auditor ?? null);
const podeDecidir = computed(() => apoio.data.value?.podeDecidir === true && auditor.value !== null);

const rotulo = (d: 'tipoGuia' | 'origem' | 'critica' | 'situacaoGuia', codigo: number | null) =>
  codigo === null
    ? '—'
    : (apoio.data.value?.dominios[d].find((x) => x.codigo === codigo)?.rotulo ?? String(codigo));
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string) => `${data(d.slice(0, 10))} ${d.slice(11, 16)}`;
// C2-122: as críticas gravadas no pedido e a negativa emitida (rótulos dos códigos do banco).
const traduzir = (grupo: string, codigo: string | null) => {
  if (!codigo) return '—';
  const chave = `operadoraAutorizacao.ficha.${grupo}.${codigo}`;
  const r = t(chave);
  return r === chave ? codigo : r;
};
const formaCritica = (f: string) =>
  ({
    automatica: t('operadoraAutorizacao.ficha.gravadaAutomatica'),
    manual: t('operadoraAutorizacao.ficha.gravadaManual'),
    intercambio: t('operadoraAutorizacao.ficha.gravadaIntercambio'),
  })[f] ?? f;
const fundamentoNegativa = (f: string) => traduzir('fundamentos', f);
const meioEntrega = (m: string | null) => traduzir('meiosEntrega', m);
const carater = (c: 'E' | 'U') => CARATERES_ATENDIMENTO[c];
const tabela = (n: number) => TABELAS_ITEM_GUIA[n as keyof typeof TABELAS_ITEM_GUIA] ?? String(n);
const internacaoTipo = (n: number) => TIPOS_INTERNACAO[n as keyof typeof TIPOS_INTERNACAO] ?? String(n);

// ── Lista (filtro aplicado + pilha de cursores para voltar) ──────────────────────────────────────
const busca = ref('');
const situacao = ref<string | null>(null);
const vencidas = ref(false);
const aplicado = ref<{ busca: string; situacao: string | null; vencidas: boolean }>({
  busca: '',
  situacao: null,
  vencidas: false,
});
const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'autorizacoes', 'lista', aplicado.value, cursor.value]),
  queryFn: () =>
    lerAutorizacoes({
      busca: aplicado.value.busca || null,
      situacao: aplicado.value.situacao,
      vencidas: aplicado.value.vencidas,
      apos: cursor.value,
    }),
  enabled: ligada,
});
function filtrar(): void {
  aplicado.value = { busca: busca.value.trim(), situacao: situacao.value, vencidas: vencidas.value };
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
  { valor: null, rotulo: t('operadoraAutorizacao.filtro.todas') },
  ...(['em-analise', 'pendente', 'em-junta', 'autorizada', 'parcial', 'negada', 'cancelada'] as const).map(
    (s) => ({
      valor: s,
      rotulo: t(`operadoraAutorizacao.situacoes.${s}`),
    }),
  ),
]);

// ── Ficha, formulários e diálogos ────────────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'autorizacoes', 'ficha', aberto.value]),
  queryFn: () => lerAutorizacao(aberto.value as number),
  enabled: computed(() => aberto.value !== null && ligada.value),
});
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const prazo = (p: AutorizacaoDetalhe) =>
  p.prazoTipo === 'imediato'
    ? t('operadoraAutorizacao.prazos.imediato')
    : t(`operadoraAutorizacao.prazos.${p.prazoTipo}`, {
        dias:
          p.prazoTipo === 'complexo'
            ? apoio.data.value?.parametros.diasUteisComplexo
            : apoio.data.value?.parametros.diasUteisPadrao,
      });
const pode = (p: AutorizacaoDetalhe, acao: Parameters<typeof acaoPermitida>[1]) =>
  acaoPermitida(p.situacao, acao);

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['operadora', 'autorizacoes'] });
}
async function gravado(r: ResultadoAutorizacao): Promise<void> {
  registrando.value = null;
  decidindo.value = null;
  dialogo.value = null;
  mensagem.value = r.mensagem;
  avisos.value = r.avisos;
  aberto.value = r.id;
  await recarregar();
}
function abrir(p: AutorizacaoResumo): void {
  mensagem.value = null;
  avisos.value = [];
  aberto.value = p.id;
}

// Registro (do zero ou ligado a uma internação autorizada).
const registrando = ref<{
  principal: { id: number; protocolo: string; carteirinha: string; prestador: number } | null;
} | null>(null);
const dialogoRegistro = computed({
  get: () => registrando.value !== null,
  set: (v: boolean) => {
    if (!v) registrando.value = null;
  },
});

// Decisão e conclusão da junta.
const decidindo = ref<{ pedido: AutorizacaoDetalhe; junta: boolean } | null>(null);
const dialogoDecisao = computed({
  get: () => decidindo.value !== null,
  set: (v: boolean) => {
    if (!v) decidindo.value = null;
  },
});

// Complemento (pedir e responder), junta e cancelamento: um diálogo por vez.
type Dialogo = 'pedir' | 'responder' | 'junta' | 'cancelar';
const dialogo = ref<Dialogo | null>(null);
const alvo = ref<AutorizacaoDetalhe | null>(null);
const visivel = computed({
  get: () => dialogo.value !== null,
  set: (v: boolean) => {
    if (!v) dialogo.value = null;
  },
});
const texto = ref('');
const jNome = ref('');
const jCrm = ref('');
const jUf = ref<string | null>('SC');
const jNotificados = ref<string | null>(null);
const recusaDialogo = ref<string | null>(null);
const erroDialogo = ref<unknown>(null);
const opcoesUf = UFS.map((u) => ({ valor: u as string, rotulo: u }));
function abrirDialogo(d: Dialogo, p: AutorizacaoDetalhe): void {
  texto.value = '';
  jNome.value = '';
  jCrm.value = '';
  jUf.value = 'SC';
  jNotificados.value = apoio.data.value?.hoje ?? null;
  recusaDialogo.value = null;
  erroDialogo.value = null;
  alvo.value = p;
  dialogo.value = d;
}
const tituloDialogo = computed(() => {
  const p = alvo.value?.protocolo ?? '';
  if (dialogo.value === 'pedir') return t('operadoraAutorizacao.complemento.tituloPedir');
  if (dialogo.value === 'responder') return t('operadoraAutorizacao.complemento.tituloResponder');
  if (dialogo.value === 'junta') return t('operadoraAutorizacao.junta.titulo');
  return t('operadoraAutorizacao.cancelar.titulo', { protocolo: p });
});
const dialogoCompleto = computed(
  () =>
    texto.value.trim().length >= 10 &&
    (dialogo.value !== 'junta' ||
      (jNome.value.trim().length >= 3 && /^\d{1,15}$/.test(jCrm.value.trim()) && !!jNotificados.value)),
);
async function confirmarDialogo(): Promise<void> {
  const p = alvo.value;
  if (!p || !dialogoCompleto.value) return;
  recusaDialogo.value = null;
  erroDialogo.value = null;
  try {
    const v = { versao: p.versao };
    const r =
      dialogo.value === 'pedir'
        ? await pedirComplemento(p.id, { ...v, pedido: texto.value })
        : dialogo.value === 'responder'
          ? await responderComplemento(p.id, { ...v, resposta: texto.value })
          : dialogo.value === 'junta'
            ? await abrirJunta(p.id, {
                ...v,
                divergencia: texto.value,
                desempatador: { nome: jNome.value, crm: jCrm.value.trim(), uf: jUf.value },
                notificadosEm: jNotificados.value,
              })
            : await cancelarAutorizacao(p.id, { ...v, motivo: texto.value });
    await gravado(r);
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusaDialogo.value = e.problema.detail;
    else erroDialogo.value = e;
  }
}
const rotuloTexto = computed(() =>
  dialogo.value === 'pedir'
    ? t('operadoraAutorizacao.complemento.pedido')
    : dialogo.value === 'responder'
      ? t('operadoraAutorizacao.complemento.resposta')
      : dialogo.value === 'junta'
        ? t('operadoraAutorizacao.junta.divergencia')
        : t('operadoraAutorizacao.cancelar.motivo'),
);
const imprimir = () => window.print();

watch(ligada, (v) => {
  if (!v) aberto.value = null;
});
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-aut-titulo" data-testid="tela-operadora-autorizacoes">
    <h1 id="ope-aut-titulo">{{ t('operadoraAutorizacao.titulo') }}</h1>
    <p>{{ t('operadoraAutorizacao.texto') }}</p>
    <p>
      <RouterLink to="/operadora/contas" data-testid="link-contas-medicas">{{
        t('operadoraContas.atalho')
      }}</RouterLink>
    </p>

    <p v-if="!leGuias" class="secundario" data-testid="aut-sem-guias">
      {{ t('operadoraAutorizacao.semGuias') }}
    </p>
    <MensagemErro v-else-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!apoio.data.value" role="status">{{ t('operadoraAutorizacao.carregando') }}</p>
    <div v-else-if="!ligada" data-testid="aut-desligada">
      <SanteAlerta :texto="apoio.data.value.motivo ?? t('operadoraAutorizacao.desligada')" variante="info" />
    </div>

    <template v-if="leGuias && apoio.data.value && ligada">
      <p v-if="mensagem" role="status" data-testid="aut-mensagem">{{ mensagem }}</p>
      <ul v-if="avisos.length" class="secundario" data-testid="aut-avisos">
        <li v-for="a in avisos" :key="a">{{ a }}</li>
      </ul>
      <p v-if="auditor" class="secundario" data-testid="aut-designacao">
        {{
          t('operadoraAutorizacao.auditores.voce', {
            categoria: t(`operadoraAutorizacao.auditores.categorias.${auditor.categoria}`),
            conselho: auditor.conselho,
            numero: auditor.numero,
            uf: auditor.uf,
          })
        }}
      </p>
      <SanteAlerta
        v-else-if="apoio.data.value.podeDecidir"
        :texto="t('operadoraAutorizacao.decisao.semDesignacao')"
        variante="aviso"
      />

      <dl v-if="lista.data.value" class="totais" data-testid="aut-totais">
        <div v-for="(v, k) in lista.data.value.totais" :key="k" :data-testid="`aut-total-${k}`">
          <dt>{{ t(`operadoraAutorizacao.totais.${k}`) }}</dt>
          <dd>{{ v }}</dd>
        </div>
      </dl>

      <section class="bloco" aria-labelledby="ope-aut-lista">
        <h2 id="ope-aut-lista">{{ t('operadoraAutorizacao.titulo') }}</h2>
        <form class="campos" data-testid="aut-filtro" @submit.prevent="filtrar">
          <SanteCampoTexto
            id="aut-busca"
            v-model="busca"
            :rotulo="t('operadoraAutorizacao.filtro.busca')"
            :max-bytes="60"
          />
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('operadoraAutorizacao.filtro.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="aut-filtro-situacao"
          />
          <label class="marcar"
            ><input v-model="vencidas" type="checkbox" data-testid="aut-filtro-vencidas" />
            {{ t('operadoraAutorizacao.filtro.vencidas') }}</label
          >
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="t('operadoraAutorizacao.filtro.buscar')"
              data-testid="aut-buscar"
            />
            <SanteBotao
              v-if="podeRegistrar"
              variante="secundario"
              :rotulo="t('operadoraAutorizacao.acoes.registrar')"
              data-testid="aut-registrar"
              @acionar="registrando = { principal: null }"
            />
          </div>
        </form>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value" role="status">{{ t('operadoraAutorizacao.carregando') }}</p>
        <p v-else-if="lista.data.value.itens.length === 0" data-testid="aut-vazia">
          {{ t('operadoraAutorizacao.nenhum') }}
        </p>
        <table v-else class="tabela" data-testid="aut-lista">
          <caption class="visualmente-oculto">
            {{
              t('operadoraAutorizacao.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.protocolo') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.beneficiario') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.prestador') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.tipo') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.carater') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.situacao') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.prazo') }}</th>
              <th scope="col">{{ t('operadoraAutorizacao.colunas.senha') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('operadoraAutorizacao.colunas.acoes') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`aut-pedido-${p.id}`">
              <td>{{ p.protocolo }}</td>
              <td>{{ p.beneficiarioNome }}</td>
              <td>{{ p.prestadorNome }}</td>
              <td>{{ rotulo('tipoGuia', p.tipoGuia) }}</td>
              <td>{{ carater(p.carater) }}</td>
              <td :data-situacao="p.situacao">{{ t(`operadoraAutorizacao.situacoes.${p.situacao}`) }}</td>
              <td>
                {{ quando(p.prazoEm) }}
                <strong v-if="p.vencida"> · {{ t('operadoraAutorizacao.prazos.vencido') }}</strong>
              </td>
              <td>{{ p.senha ?? '—' }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('operadoraAutorizacao.acoes.abrir', { protocolo: p.protocolo })"
                  :data-testid="`aut-abrir-${p.id}`"
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
            :rotulo="t('operadoraAutorizacao.paginas.anterior')"
            @acionar="anterior"
          />
          <SanteBotao
            v-if="lista.data.value.proxima"
            variante="secundario"
            :rotulo="t('operadoraAutorizacao.paginas.proxima')"
            @acionar="proxima"
          />
          <span v-else-if="cursores.length > 1" class="secundario">{{
            t('operadoraAutorizacao.paginas.fim')
          }}</span>
        </div>
      </section>

      <section v-if="aberto !== null" class="bloco" aria-labelledby="ope-aut-ficha" data-testid="aut-ficha">
        <h2 id="ope-aut-ficha">{{ t('operadoraAutorizacao.ficha.titulo') }}</h2>
        <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
        <p v-else-if="!ficha.data.value" role="status">{{ t('operadoraAutorizacao.carregando') }}</p>
        <template v-else>
          <h3 data-testid="aut-ficha-protocolo">{{ ficha.data.value.protocolo }}</h3>
          <dl class="ficha">
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.situacao') }}</dt>
              <dd data-testid="aut-ficha-situacao">
                {{ t(`operadoraAutorizacao.situacoes.${ficha.data.value.situacao}`) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.beneficiario') }}</dt>
              <dd>
                {{ ficha.data.value.beneficiario.nome }} · {{ t('operadoraAutorizacao.ficha.nascimento') }}
                {{ data(ficha.data.value.beneficiario.nascimento) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.carteirinha') }}</dt>
              <dd>{{ ficha.data.value.beneficiario.carteirinha }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.plano') }}</dt>
              <dd>{{ ficha.data.value.beneficiario.plano }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.prestador') }}</dt>
              <dd>{{ ficha.data.value.prestador.nome }}</dd>
            </div>
            <div v-if="ficha.data.value.executante">
              <dt>{{ t('operadoraAutorizacao.ficha.executante') }}</dt>
              <dd>{{ ficha.data.value.executante.nome }}</dd>
            </div>
            <div v-if="ficha.data.value.guiaPrincipal">
              <dt>{{ t('operadoraAutorizacao.ficha.guiaPrincipal') }}</dt>
              <dd>{{ ficha.data.value.guiaPrincipal.protocolo }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.tipo') }}</dt>
              <dd>{{ rotulo('tipoGuia', ficha.data.value.tipoGuia) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.carater') }}</dt>
              <dd>
                {{ carater(ficha.data.value.carater) }}
                <template v-if="ficha.data.value.altaComplexidade">
                  · {{ t('operadoraAutorizacao.ficha.altaComplexidade') }}</template
                >
              </dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.origem') }}</dt>
              <dd>{{ rotulo('origem', ficha.data.value.origem) }}</dd>
            </div>
            <div v-if="ficha.data.value.cid">
              <dt>{{ t('operadoraAutorizacao.ficha.cid') }}</dt>
              <dd>{{ ficha.data.value.cid }} · {{ ficha.data.value.cidNome ?? '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.profissional') }}</dt>
              <dd>
                {{ ficha.data.value.profissional.nome }} · {{ ficha.data.value.profissional.conselho }}
                {{ ficha.data.value.profissional.numero }}/{{ ficha.data.value.profissional.uf }}
              </dd>
            </div>
            <div v-if="ficha.data.value.internacao">
              <dt>{{ t('operadoraAutorizacao.ficha.internacao') }}</dt>
              <dd data-testid="aut-ficha-internacao">
                {{
                  t('operadoraAutorizacao.ficha.internacaoTexto', {
                    tipo: internacaoTipo(ficha.data.value.internacao.tipo),
                    diarias: ficha.data.value.internacao.diarias,
                    data: data(ficha.data.value.internacao.admissaoPrevista),
                  })
                }}
                <template v-if="ficha.data.value.internacao.diariasAutorizadas !== null">
                  ·
                  {{
                    t('operadoraAutorizacao.ficha.diariasAutorizadas', {
                      n: ficha.data.value.internacao.diariasAutorizadas,
                    })
                  }}</template
                >
              </dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.solicitada') }}</dt>
              <dd>{{ quando(ficha.data.value.solicitadaEm) }}</dd>
            </div>
            <div>
              <dt>{{ t('operadoraAutorizacao.ficha.prazo') }}</dt>
              <dd data-testid="aut-ficha-prazo">
                {{ prazo(ficha.data.value) }} · {{ quando(ficha.data.value.prazoEm) }}
                <strong v-if="ficha.data.value.vencida">
                  · {{ t('operadoraAutorizacao.prazos.vencido') }}</strong
                >
              </dd>
            </div>
            <div v-if="ficha.data.value.situacaoGuia !== null">
              <dt>{{ t('operadoraAutorizacao.ficha.situacaoGuia') }}</dt>
              <dd>{{ rotulo('situacaoGuia', ficha.data.value.situacaoGuia) }}</dd>
            </div>
            <div v-if="ficha.data.value.senha">
              <dt>{{ t('operadoraAutorizacao.ficha.senha') }}</dt>
              <dd data-testid="aut-ficha-senha">
                {{
                  t('operadoraAutorizacao.ficha.senhaTexto', {
                    senha: ficha.data.value.senha,
                    data: data(ficha.data.value.senhaValidade),
                  })
                }}
              </dd>
            </div>
            <div v-if="ficha.data.value.complementoPedido">
              <dt>{{ t('operadoraAutorizacao.ficha.complementoPedido') }}</dt>
              <dd>{{ ficha.data.value.complementoPedido }}</dd>
            </div>
            <div v-if="ficha.data.value.complementoResposta">
              <dt>{{ t('operadoraAutorizacao.ficha.complementoResposta') }}</dt>
              <dd>{{ ficha.data.value.complementoResposta }}</dd>
            </div>
            <div v-if="ficha.data.value.anexos.length" data-testid="aut-ficha-anexos">
              <dt>{{ t('operadoraAutorizacao.ficha.anexos') }}</dt>
              <dd>
                <a
                  v-for="x in ficha.data.value.anexos"
                  :key="x.id"
                  class="anexo"
                  :href="urlAnexoComplemento(ficha.data.value.id, x.id)"
                  :download="x.nome"
                  :data-testid="`aut-ficha-anexo-${x.id}`"
                  >{{ t('operadoraAutorizacao.ficha.baixar', { nome: x.nome }) }}</a
                >
              </dd>
            </div>
            <div v-if="ficha.data.value.junta">
              <dt>{{ t('operadoraAutorizacao.ficha.junta') }}</dt>
              <dd data-testid="aut-ficha-junta">
                {{ ficha.data.value.junta.divergencia }} ·
                {{
                  t('operadoraAutorizacao.ficha.juntaTexto', {
                    nome: ficha.data.value.junta.desempatador,
                    crm: ficha.data.value.junta.crm,
                    uf: ficha.data.value.junta.uf,
                    data: data(ficha.data.value.junta.notificadosEm),
                  })
                }}
                <template v-if="ficha.data.value.junta.parecer">
                  · {{ t('operadoraAutorizacao.ficha.juntaParecer') }}:
                  {{ ficha.data.value.junta.parecer }}</template
                >
              </dd>
            </div>
            <div v-if="ficha.data.value.decisao">
              <dt>{{ t('operadoraAutorizacao.ficha.decisao') }}</dt>
              <dd data-testid="aut-ficha-decisao">
                {{
                  t('operadoraAutorizacao.ficha.decisaoTexto', {
                    auditor: ficha.data.value.decisao.auditor,
                    quando: quando(ficha.data.value.decisao.em),
                  })
                }}
                <template v-if="ficha.data.value.decisao.critica !== null">
                  · {{ t('operadoraAutorizacao.ficha.critica') }}:
                  {{ rotulo('critica', ficha.data.value.decisao.critica) }}</template
                >
                <template v-if="ficha.data.value.decisao.fundamento">
                  · {{ t('operadoraAutorizacao.ficha.fundamento') }}:
                  {{ ficha.data.value.decisao.fundamento }}</template
                >
                · {{ t('operadoraAutorizacao.ficha.parecer') }}: {{ ficha.data.value.decisao.parecer }}
              </dd>
            </div>
            <div v-if="ficha.data.value.motivoCancelamento">
              <dt>{{ t('operadoraAutorizacao.ficha.cancelamento') }}</dt>
              <dd>{{ ficha.data.value.motivoCancelamento }}</dd>
            </div>
          </dl>
          <p>
            <strong>{{ t('operadoraAutorizacao.ficha.indicacao') }}:</strong>
            {{ ficha.data.value.indicacaoClinica }}
          </p>

          <div class="acoes" data-testid="aut-ficha-acoes">
            <SanteBotao
              v-if="podeDecidir && pode(ficha.data.value, 'decidir')"
              :rotulo="t('operadoraAutorizacao.acoes.decidir')"
              data-testid="aut-decidir"
              @acionar="decidindo = { pedido: ficha.data.value, junta: false }"
            />
            <SanteBotao
              v-if="podeDecidir && pode(ficha.data.value, 'pedirComplemento')"
              variante="secundario"
              :rotulo="t('operadoraAutorizacao.acoes.pedirComplemento')"
              data-testid="aut-pedir-complemento"
              @acionar="abrirDialogo('pedir', ficha.data.value)"
            />
            <SanteBotao
              v-if="podeDecidir && auditor?.categoria === 'medico' && pode(ficha.data.value, 'abrirJunta')"
              variante="secundario"
              :rotulo="t('operadoraAutorizacao.acoes.abrirJunta')"
              data-testid="aut-abrir-junta"
              @acionar="abrirDialogo('junta', ficha.data.value)"
            />
            <SanteBotao
              v-if="podeDecidir && pode(ficha.data.value, 'concluirJunta')"
              :rotulo="t('operadoraAutorizacao.acoes.concluirJunta')"
              data-testid="aut-concluir-junta"
              @acionar="decidindo = { pedido: ficha.data.value, junta: true }"
            />
            <SanteBotao
              v-if="podeRegistrar && pode(ficha.data.value, 'responderComplemento')"
              variante="secundario"
              :rotulo="t('operadoraAutorizacao.acoes.responderComplemento')"
              data-testid="aut-responder-complemento"
              @acionar="abrirDialogo('responder', ficha.data.value)"
            />
            <SanteBotao
              v-if="
                podeRegistrar &&
                ficha.data.value.tipoGuia === TIPO_GUIA.internacao &&
                (ficha.data.value.situacao === 'autorizada' || ficha.data.value.situacao === 'parcial')
              "
              variante="secundario"
              :rotulo="t('operadoraAutorizacao.acoes.registrar')"
              data-testid="aut-registrar-ligado"
              @acionar="
                registrando = {
                  principal: {
                    id: ficha.data.value.id,
                    protocolo: ficha.data.value.protocolo,
                    carteirinha: ficha.data.value.beneficiario.carteirinha,
                    prestador: ficha.data.value.prestador.id,
                  },
                }
              "
            />
            <SanteBotao
              v-if="podeRegistrar && pode(ficha.data.value, 'cancelar')"
              variante="secundario"
              :rotulo="t('operadoraAutorizacao.acoes.cancelar')"
              data-testid="aut-cancelar"
              @acionar="abrirDialogo('cancelar', ficha.data.value)"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('operadoraAutorizacao.acoes.fechar')"
              @acionar="aberto = null"
            />
          </div>

          <h3>{{ t('operadoraAutorizacao.ficha.criticas') }}</h3>
          <p v-if="ficha.data.value.criticas.length === 0" class="secundario">
            {{ t('operadoraAutorizacao.ficha.semCriticas') }}
          </p>
          <ul v-else data-testid="aut-ficha-criticas">
            <li v-for="c in ficha.data.value.criticas" :key="c.codigo" :data-bloqueia="c.bloqueia">
              <strong
                >{{
                  c.bloqueia
                    ? t('operadoraAutorizacao.ficha.bloqueia')
                    : t('operadoraAutorizacao.ficha.aviso')
                }}:</strong
              >
              {{ c.texto }}
            </li>
          </ul>

          <template v-if="ficha.data.value.criticasGravadas.length">
            <h3>{{ t('operadoraAutorizacao.ficha.criticasGravadas') }}</h3>
            <ul data-testid="aut-ficha-criticas-gravadas">
              <li
                v-for="c in ficha.data.value.criticasGravadas"
                :key="c.sequencia"
                :data-liberada="c.liberada"
              >
                {{ c.descricao }} ({{ formaCritica(c.forma) }}, {{ quando(c.em) }}) ·
                <template v-if="c.liberada">
                  {{
                    t('operadoraAutorizacao.ficha.liberada', {
                      em: c.liberadaEm ? quando(c.liberadaEm) : '—',
                      por: c.liberadaPor ?? '—',
                      justificativa: c.justificativa ?? '—',
                    })
                  }}
                </template>
                <template v-else>{{ t('operadoraAutorizacao.ficha.pendenteLiberacao') }}</template>
              </li>
            </ul>
          </template>

          <h3>{{ t('operadoraAutorizacao.ficha.itens') }}</h3>
          <table class="tabela" data-testid="aut-ficha-itens">
            <caption class="visualmente-oculto">
              {{
                t('operadoraAutorizacao.ficha.itens')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('operadoraAutorizacao.itens.tabela') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.itens.codigo') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.itens.descricao') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.itens.pedida') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.itens.autorizada') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.itens.situacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in ficha.data.value.itens" :key="i.id">
                <td>{{ tabela(i.tabela) }}</td>
                <td>{{ i.codigo }}</td>
                <td>{{ i.descricao }}</td>
                <td>{{ i.quantidadeSolicitada }}</td>
                <td>{{ i.quantidadeAutorizada ?? '—' }}</td>
                <td>{{ t(`operadoraAutorizacao.itemSituacoes.${i.situacao}`) }}</td>
              </tr>
            </tbody>
          </table>

          <template v-if="ficha.data.value.negativa">
            <h3>{{ t('operadoraAutorizacao.ficha.negativa') }}</h3>
            <dl class="ficha" data-testid="aut-ficha-negativa">
              <div>
                <dt>{{ t('operadoraAutorizacao.ficha.negativaNumero') }}</dt>
                <dd data-testid="aut-ficha-negativa-numero">{{ ficha.data.value.negativa.numero }}</dd>
              </div>
              <div>
                <dt>{{ t('operadoraAutorizacao.ficha.negativaFundamento') }}</dt>
                <dd>{{ fundamentoNegativa(ficha.data.value.negativa.fundamento) }}</dd>
              </div>
              <div v-if="ficha.data.value.negativa.clausula">
                <dt>{{ t('operadoraAutorizacao.ficha.negativaClausula') }}</dt>
                <dd>{{ ficha.data.value.negativa.clausula }}</dd>
              </div>
              <div>
                <dt>{{ t('operadoraAutorizacao.ficha.negativaEmitida') }}</dt>
                <dd>{{ quando(ficha.data.value.negativa.emitidaEm) }}</dd>
              </div>
              <div>
                <dt>{{ t('operadoraAutorizacao.ficha.negativaEntrega') }}</dt>
                <dd data-testid="aut-ficha-negativa-entrega">
                  <template v-if="ficha.data.value.negativa.entregueEm">
                    {{
                      t('operadoraAutorizacao.ficha.negativaEntregue', {
                        meio: meioEntrega(ficha.data.value.negativa.meioEntrega),
                        em: quando(ficha.data.value.negativa.entregueEm),
                      })
                    }}
                  </template>
                  <template v-else>{{ t('operadoraAutorizacao.ficha.negativaNaoEntregue') }}</template>
                  <template v-if="ficha.data.value.negativa.prazoEntregaEm">
                    ·
                    {{
                      t('operadoraAutorizacao.ficha.negativaPrazoEntrega', {
                        em: quando(ficha.data.value.negativa.prazoEntregaEm),
                      })
                    }}
                  </template>
                </dd>
              </div>
            </dl>
          </template>

          <template v-if="ficha.data.value.comunicado">
            <h3>{{ t('operadoraAutorizacao.ficha.comunicado') }}</h3>
            <pre class="comunicado" data-testid="aut-ficha-comunicado">{{ ficha.data.value.comunicado }}</pre>
            <div class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('operadoraAutorizacao.acoes.imprimir')"
                @acionar="imprimir"
              />
            </div>
          </template>

          <h3>{{ t('operadoraAutorizacao.ficha.eventos') }}</h3>
          <table class="tabela" data-testid="aut-ficha-eventos">
            <caption class="visualmente-oculto">
              {{
                t('operadoraAutorizacao.ficha.eventos')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('operadoraAutorizacao.ficha.solicitada') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.ficha.situacao') }}</th>
                <th scope="col">{{ t('operadoraAutorizacao.ficha.parecer') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in ficha.data.value.eventos" :key="e.id">
                <td>{{ quando(e.em) }} · {{ e.por }}</td>
                <td>
                  {{ t(`operadoraAutorizacao.eventos.${e.evento}`) }} ·
                  {{ t(`operadoraAutorizacao.situacoes.${e.situacao}`) }}
                </td>
                <td>{{ e.texto ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </template>

    <ProtocolosAtendimento v-if="leProtocolos" />

    <GrupoDominiosTela subitem="operadoraAtendimento" embutida />
    <!-- As origens do atendimento (consulta do item) e as demais tabelas de apoio. -->
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="operadora-outras-tabelas">{{
        t('operadora.telas.ans.outrasTabelas')
      }}</RouterLink>
    </p>

    <SanteDialogo
      v-model:visivel="dialogoRegistro"
      :titulo="t('operadoraAutorizacao.form.tituloNovo')"
      largura="60rem"
    >
      <FormAutorizacao
        v-if="registrando && apoio.data.value"
        :key="registrando.principal?.id ?? 'novo'"
        :apoio="apoio.data.value"
        :principal="registrando.principal"
        @gravado="gravado"
        @cancelar="registrando = null"
      />
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoDecisao"
      :titulo="
        decidindo?.junta
          ? t('operadoraAutorizacao.decisao.tituloJunta', { protocolo: decidindo.pedido.protocolo })
          : t('operadoraAutorizacao.decisao.titulo', { protocolo: decidindo?.pedido.protocolo ?? '' })
      "
      largura="48rem"
    >
      <DecisaoAutorizacao
        v-if="decidindo && apoio.data.value"
        :key="`${decidindo.pedido.id}-${decidindo.pedido.versao}-${decidindo.junta}`"
        :apoio="apoio.data.value"
        :pedido="decidindo.pedido"
        :junta="decidindo.junta"
        @gravado="gravado"
        @cancelar="decidindo = null"
      />
    </SanteDialogo>

    <SanteDialogo v-model:visivel="visivel" :titulo="tituloDialogo" largura="44rem">
      <div class="formulario" data-testid="form-dialogo-autorizacao">
        <p v-if="dialogo === 'pedir' || dialogo === 'responder'" class="secundario">
          {{ t('operadoraAutorizacao.complemento.texto') }}
        </p>
        <p v-if="dialogo === 'junta'" class="secundario">{{ t('operadoraAutorizacao.junta.texto') }}</p>
        <SanteCampoTexto
          id="aut-dialogo-texto"
          v-model="texto"
          :rotulo="rotuloTexto"
          :max-bytes="dialogo === 'cancelar' ? 200 : 1000"
          multilinha
          obrigatorio
        />
        <template v-if="dialogo === 'junta'">
          <SanteCampoTexto
            id="aut-junta-nome"
            v-model="jNome"
            :rotulo="t('operadoraAutorizacao.junta.desempatador')"
            :max-bytes="120"
            obrigatorio
          />
          <SanteCampoTexto
            id="aut-junta-crm"
            v-model="jCrm"
            :rotulo="t('operadoraAutorizacao.junta.crm')"
            :max-bytes="15"
            obrigatorio
          />
          <SanteSelecao
            v-model="jUf"
            :rotulo="t('operadoraAutorizacao.junta.uf')"
            :opcoes="opcoesUf"
            obrigatorio
            data-testid="aut-junta-uf"
          />
          <SanteData
            v-model="jNotificados"
            :rotulo="t('operadoraAutorizacao.junta.notificados')"
            editavel
            data-testid="aut-junta-notificados"
          />
        </template>
        <SanteAlerta
          v-if="recusaDialogo"
          :texto="recusaDialogo"
          variante="alerta"
          data-testid="aut-dialogo-recusa"
        />
        <MensagemErro v-if="erroDialogo" :erro="erroDialogo" />
      </div>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAutorizacao.acoes.voltar')"
          @acionar="dialogo = null"
        />
        <SanteBotao
          v-if="dialogo === 'cancelar'"
          variante="destrutivo"
          :confirmacao="t('operadoraAutorizacao.acoes.confirmarCancelar')"
          :rotulo="t('operadoraAutorizacao.acoes.cancelar')"
          :desabilitado="!dialogoCompleto"
          data-testid="aut-dialogo-confirmar"
          @acionar="confirmarDialogo"
        />
        <SanteBotao
          v-else
          :rotulo="t('operadoraAutorizacao.acoes.gravar')"
          :desabilitado="!dialogoCompleto"
          data-testid="aut-dialogo-confirmar"
          @acionar="confirmarDialogo"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.anexo {
  display: block;
}
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
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
.comunicado {
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
}
</style>
