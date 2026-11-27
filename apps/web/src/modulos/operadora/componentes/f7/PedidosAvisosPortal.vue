<script setup lang="ts">
// C2-074 (08-SGO L113, F7): o lado interno da operadora no portal do prestador credenciado (rede credenciada:
// `operadora.prestador.ler` / `.editar`). Três blocos: a fila dos pedidos web do prestador (alteração do cadastro e
// credenciamento) com a decisão — analisar, aprovar ou recusar com o motivo (a máquina de situações é a do domínio);
// os avisos à rede (publicar e retirar; o aviso retirado fica inativo, nunca apagado); e as regras de documento por
// tipo de prestador e natureza (incluir e inativar). O servidor confere tudo de novo.
import { proximaSituacaoPedidoWeb, TIPOS_AVISO_PORTAL } from '@sgh/dominio-operadora';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { pode as podeNaSessao } from '../../../../casca/sessao/pode.js';
import { lerAcessosPortal } from '../../api-atendimento.js';
import {
  type AcaoDecisao,
  decidirPedidoPortal,
  inativarRegraArquivo,
  incluirRegraArquivo,
  lerAvisosPortal,
  lerPedidosPortal,
  lerRegrasArquivo,
  type PedidoWebPrestador,
  publicarAvisoPortal,
  retirarAvisoPortal,
  type TipoAviso,
} from '../../api-portal-pedidos.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      fila: 'Pedidos dos prestadores pela web',
      filtro: 'Situação',
      todas: 'Todas',
      nenhumPedido: 'Nenhum pedido nesta situação.',
      numero: 'Número',
      tipo: 'Tipo',
      prestador: 'Prestador',
      situacao: 'Situação',
      recebido: 'Recebido em',
      acoes: 'Ações',
      analisar: 'Analisar',
      aprovar: 'Aprovar',
      recusar: 'Recusar',
      motivo: 'Motivo da recusa',
      confirmarRecusa: 'Confirmar a recusa',
      novoCredenciamento: 'Novo credenciamento',
      decidido: 'Pedido {numero}: {situacao}.',
      situacoes: {
        recebido: 'Recebido',
        em_analise: 'Em análise',
        aprovado: 'Aprovado',
        recusado: 'Recusado',
        cancelado: 'Cancelado',
      },
      tipos: {
        credenciamento: 'Credenciamento',
        alteracao_cadastral: 'Alteração cadastral',
        endereco: 'Endereço',
        especialidade: 'Especialidade',
        qualificacao: 'Qualificação',
      },
      avisos: 'Avisos à rede credenciada',
      nenhumAviso: 'Nenhum aviso publicado.',
      tipoAviso: 'Tipo do aviso',
      tiposAviso: { noticia: 'Notícia', comunicado: 'Comunicado', documento: 'Documento', link: 'Link' },
      titulo: 'Título',
      conteudo: 'Conteúdo',
      link: 'Link (https)',
      exibirDe: 'Exibir a partir de',
      exibirAte: 'Exibir até',
      destaque: 'Em destaque',
      publicar: 'Publicar o aviso',
      publicado: 'Aviso publicado.',
      retirar: 'Retirar',
      retirado: 'Aviso retirado (fica inativo no histórico).',
      ativo: 'Ativo',
      inativo: 'Retirado',
      regras: 'Documentos exigidos dos prestadores',
      operadora: 'Operadora',
      escolha: 'Escolha',
      nenhumaRegra: 'Nenhuma regra de documento.',
      descricao: 'Documento',
      natureza: 'Natureza',
      naturezas: { fisica: 'Pessoa física', juridica: 'Pessoa jurídica', todas: 'Todas' },
      obrigatorio: 'Obrigatório',
      extensoes: 'Extensões (ex.: pdf, jpg)',
      tamanho: 'Tamanho máximo (KB)',
      incluir: 'Incluir a regra',
      incluida: 'Regra incluída.',
      inativar: 'Inativar',
      inativada: 'Regra inativada.',
      ateData: 'a {data}',
      sim: 'Sim',
      nao: 'Não',
    },
  },
});

const cliente = useQueryClient();
const podeEditar = computed(() => podeNaSessao('operadora.prestador.editar'));
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

async function gravar(f: () => Promise<unknown>, ok: string, chave: string): Promise<boolean> {
  gravando.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await f();
    mensagem.value = ok;
    await cliente.invalidateQueries({ queryKey: ['operadora', 'portal-prestador', chave] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Fila de pedidos ──────────────────────────────────────────────────────────────────────────
const filtro = ref<string | null>('recebido');
const pedidos = useQuery({
  queryKey: computed(() => ['operadora', 'portal-prestador', 'pedidos', filtro.value]),
  queryFn: () => lerPedidosPortal(filtro.value),
});
const opcoesFiltro = computed(() => [
  { valor: null, rotulo: t('todas') },
  ...(['recebido', 'em_analise', 'aprovado', 'recusado', 'cancelado'] as const).map((s) => ({
    valor: s,
    rotulo: t(`situacoes.${s}`),
  })),
]);
const vale = (p: PedidoWebPrestador, a: AcaoDecisao) =>
  'situacao' in proximaSituacaoPedidoWeb(p.situacao, a, a === 'recusar' ? 'x' : null);
const recusando = ref<PedidoWebPrestador | null>(null);
const motivo = ref('');
async function decidir(p: PedidoWebPrestador, acao: AcaoDecisao) {
  const m = acao === 'recusar' ? motivo.value.trim() : null;
  const situacao = acao === 'analisar' ? 'em_analise' : acao === 'aprovar' ? 'aprovado' : 'recusado';
  const ok = await gravar(
    () => decidirPedidoPortal(p.id, p.versao, acao, m),
    t('decidido', { numero: p.numero, situacao: t(`situacoes.${situacao}`) }),
    'pedidos',
  );
  if (ok) {
    recusando.value = null;
    motivo.value = '';
  }
}

// ── Avisos ───────────────────────────────────────────────────────────────────────────────────
const avisos = useQuery({ queryKey: ['operadora', 'portal-prestador', 'avisos'], queryFn: lerAvisosPortal });
const hoje = () => new Date().toISOString().slice(0, 10);
const av = reactive({
  tipo: 'comunicado' as TipoAviso | null,
  titulo: '',
  conteudo: '',
  link: '',
  exibirDe: hoje(),
  exibirAte: '',
  destaque: false,
});
const opcoesTipoAviso = computed(() =>
  TIPOS_AVISO_PORTAL.map((x) => ({ valor: x, rotulo: t(`tiposAviso.${x}`) })),
);
const avisoPronto = computed(
  () => av.tipo !== null && av.titulo.trim() !== '' && av.conteudo.trim() !== '' && av.exibirDe !== '',
);
async function publicar() {
  if (!avisoPronto.value || av.tipo === null) return;
  const tipo = av.tipo;
  const ok = await gravar(
    () =>
      publicarAvisoPortal({
        tipo,
        titulo: av.titulo.trim(),
        conteudo: av.conteudo.trim(),
        link: av.link.trim() || null,
        exibirDe: `${av.exibirDe}T00:00`,
        exibirAte: av.exibirAte ? `${av.exibirAte}T23:59` : null,
        tipoPrestador: null,
        prestador: null,
        destaque: av.destaque,
      }),
    t('publicado'),
    'avisos',
  );
  if (ok) Object.assign(av, { titulo: '', conteudo: '', link: '', exibirAte: '', destaque: false });
}

// ── Regras de documento ──────────────────────────────────────────────────────────────────────
const acessos = useQuery({ queryKey: ['operadora', 'portal', 'acessos'], queryFn: () => lerAcessosPortal() });
const operadoras = computed(() => acessos.data.value?.operadoras ?? []);
const operadora = ref<number | null>(null);
watch(
  operadoras,
  (ops) => {
    if (operadora.value === null && ops.length > 0) operadora.value = ops[0]!.id;
  },
  { immediate: true },
);
const opcoesOperadora = computed(() =>
  operadoras.value.map((o) => ({ valor: o.id, rotulo: `${o.nome} — ANS ${o.registroAns}` })),
);
const regras = useQuery({
  queryKey: computed(() => ['operadora', 'portal-prestador', 'regras', operadora.value]),
  queryFn: () => lerRegrasArquivo(operadora.value!),
  enabled: computed(() => operadora.value !== null),
});
const rg = reactive({
  descricao: '',
  natureza: null as 'fisica' | 'juridica' | null,
  obrigatorio: true,
  extensoes: '',
  tamanho: '',
});
const opcoesNatureza = computed(() => [
  { valor: null, rotulo: t('naturezas.todas') },
  { valor: 'fisica' as const, rotulo: t('naturezas.fisica') },
  { valor: 'juridica' as const, rotulo: t('naturezas.juridica') },
]);
const regraPronta = computed(() => operadora.value !== null && rg.descricao.trim() !== '');
async function incluir() {
  if (!regraPronta.value || operadora.value === null) return;
  const op = operadora.value;
  const kb = Number(rg.tamanho);
  const ok = await gravar(
    () =>
      incluirRegraArquivo({
        operadora: op,
        tipoPrestador: null,
        natureza: rg.natureza,
        descricao: rg.descricao.trim(),
        obrigatorio: rg.obrigatorio,
        extensoes: rg.extensoes.trim() || null,
        tamanhoMaximoKb: rg.tamanho && Number.isInteger(kb) && kb > 0 ? kb : null,
      }),
    t('incluida'),
    'regras',
  );
  if (ok) Object.assign(rg, { descricao: '', extensoes: '', tamanho: '' });
}
</script>

<template>
  <div class="portal-pedidos" data-testid="operadora-portal-pedidos">
    <p v-if="mensagem" role="status" data-testid="pp-op-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <section class="bloco" aria-labelledby="pp-op-fila-titulo" data-testid="pp-op-fila">
      <h2 id="pp-op-fila-titulo">{{ t('fila') }}</h2>
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('filtro')"
        :opcoes="opcoesFiltro"
        data-testid="pp-op-filtro"
      />
      <MensagemErro v-if="pedidos.error.value" :erro="pedidos.error.value" />
      <p v-else-if="pedidos.data.value && pedidos.data.value.length === 0" class="secundario">
        {{ t('nenhumPedido') }}
      </p>
      <table v-else-if="pedidos.data.value" data-testid="pp-op-pedidos">
        <thead>
          <tr>
            <th scope="col">{{ t('numero') }}</th>
            <th scope="col">{{ t('tipo') }}</th>
            <th scope="col">{{ t('prestador') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('recebido') }}</th>
            <th scope="col">{{ t('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pedidos.data.value" :key="p.id" :data-testid="`pp-op-pedido-${p.id}`">
            <td>{{ p.numero }}</td>
            <td>{{ t(`tipos.${p.tipo}`) }}</td>
            <td>
              {{ p.prestadorNome ?? p.nome }}
              <span v-if="p.prestador === null" class="secundario"> ({{ t('novoCredenciamento') }})</span>
            </td>
            <td>
              {{ t(`situacoes.${p.situacao}`) }}
              <span v-if="p.motivoRecusa" class="secundario"> — {{ p.motivoRecusa }}</span>
            </td>
            <td>{{ data(p.recebidoEm) }}</td>
            <td>
              <div v-if="podeEditar" class="acoes">
                <SanteBotao
                  v-for="a in (['analisar', 'aprovar', 'recusar'] as const).filter((x) => vale(p, x))"
                  :key="a"
                  variante="texto"
                  :rotulo="t(a)"
                  :desabilitado="gravando"
                  :data-testid="`pp-op-${a}-${p.id}`"
                  @acionar="a === 'recusar' ? (recusando = p) : decidir(p, a)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="recusando" class="recusa" data-testid="pp-op-recusa">
        <SanteCampoTexto
          id="pp-op-motivo"
          v-model="motivo"
          :rotulo="`${t('motivo')} · ${recusando.numero}`"
          :max-bytes="500"
          obrigatorio
        />
        <SanteBotao
          :rotulo="t('confirmarRecusa')"
          :desabilitado="gravando || motivo.trim() === ''"
          data-testid="pp-op-confirmar-recusa"
          @acionar="decidir(recusando, 'recusar')"
        />
      </div>
    </section>

    <section class="bloco" aria-labelledby="pp-op-avisos-titulo" data-testid="pp-op-avisos">
      <h2 id="pp-op-avisos-titulo">{{ t('avisos') }}</h2>
      <MensagemErro v-if="avisos.error.value" :erro="avisos.error.value" />
      <p v-else-if="avisos.data.value && avisos.data.value.length === 0" class="secundario">
        {{ t('nenhumAviso') }}
      </p>
      <ul v-else-if="avisos.data.value" data-testid="pp-op-lista-avisos">
        <li v-for="a in avisos.data.value" :key="a.id" :data-testid="`pp-op-aviso-${a.id}`">
          <strong>{{ a.titulo }}</strong> · {{ t(`tiposAviso.${a.tipo}`) }} · {{ data(a.exibirDe) }}
          <template v-if="a.exibirAte"> {{ t('ateData', { data: data(a.exibirAte) }) }}</template>
          · {{ a.ativo ? t('ativo') : t('inativo') }}
          <SanteBotao
            v-if="podeEditar && a.ativo"
            variante="texto"
            :rotulo="t('retirar')"
            :desabilitado="gravando"
            :data-testid="`pp-op-retirar-${a.id}`"
            @acionar="gravar(() => retirarAvisoPortal(a.id, a.versao), t('retirado'), 'avisos')"
          />
        </li>
      </ul>
      <form v-if="podeEditar" class="formulario" data-testid="pp-op-form-aviso" @submit.prevent="publicar">
        <SanteSelecao
          v-model="av.tipo"
          :rotulo="t('tipoAviso')"
          :opcoes="opcoesTipoAviso"
          obrigatorio
          data-testid="pp-op-aviso-tipo"
        />
        <SanteCampoTexto
          id="pp-op-aviso-titulo"
          v-model="av.titulo"
          :rotulo="t('titulo')"
          :max-bytes="200"
          obrigatorio
        />
        <label for="pp-op-aviso-conteudo">{{ t('conteudo') }}</label>
        <textarea id="pp-op-aviso-conteudo" v-model="av.conteudo" rows="3" maxlength="10000" required />
        <SanteCampoTexto id="pp-op-aviso-link" v-model="av.link" :rotulo="t('link')" :max-bytes="500" />
        <label for="pp-op-aviso-de">{{ t('exibirDe') }}</label>
        <input id="pp-op-aviso-de" v-model="av.exibirDe" type="date" required />
        <label for="pp-op-aviso-ate">{{ t('exibirAte') }}</label>
        <input id="pp-op-aviso-ate" v-model="av.exibirAte" type="date" />
        <label
          ><input v-model="av.destaque" type="checkbox" data-testid="pp-op-aviso-destaque" />
          {{ t('destaque') }}</label
        >
        <SanteBotao
          tipo="submit"
          :rotulo="t('publicar')"
          :desabilitado="gravando || !avisoPronto"
          data-testid="pp-op-publicar"
        />
      </form>
    </section>

    <section class="bloco" aria-labelledby="pp-op-regras-titulo" data-testid="pp-op-regras">
      <h2 id="pp-op-regras-titulo">{{ t('regras') }}</h2>
      <SanteSelecao
        v-if="operadoras.length > 1"
        v-model="operadora"
        :rotulo="t('operadora')"
        :opcoes="opcoesOperadora"
        data-testid="pp-op-operadora"
      />
      <MensagemErro v-if="regras.error.value" :erro="regras.error.value" />
      <p v-else-if="regras.data.value && regras.data.value.length === 0" class="secundario">
        {{ t('nenhumaRegra') }}
      </p>
      <table v-else-if="regras.data.value" data-testid="pp-op-lista-regras">
        <thead>
          <tr>
            <th scope="col">{{ t('descricao') }}</th>
            <th scope="col">{{ t('natureza') }}</th>
            <th scope="col">{{ t('obrigatorio') }}</th>
            <th scope="col">{{ t('extensoes') }}</th>
            <th scope="col">{{ t('tamanho') }}</th>
            <th scope="col">{{ t('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras.data.value" :key="r.id" :data-testid="`pp-op-regra-${r.id}`">
            <td>{{ r.descricao }}</td>
            <td>{{ t(`naturezas.${r.natureza ?? 'todas'}`) }}</td>
            <td>{{ r.obrigatorio ? t('sim') : t('nao') }}</td>
            <td>{{ r.extensoes ?? '—' }}</td>
            <td>{{ r.tamanhoMaximoKb ?? '—' }}</td>
            <td>
              <SanteBotao
                v-if="podeEditar && r.ativo"
                variante="texto"
                :rotulo="t('inativar')"
                :desabilitado="gravando"
                :data-testid="`pp-op-inativar-${r.id}`"
                @acionar="gravar(() => inativarRegraArquivo(r.id, r.versao), t('inativada'), 'regras')"
              />
              <span v-else-if="!r.ativo">{{ t('inativo') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="podeEditar && operadora !== null"
        class="formulario"
        data-testid="pp-op-form-regra"
        @submit.prevent="incluir"
      >
        <SanteCampoTexto
          id="pp-op-regra-descricao"
          v-model="rg.descricao"
          :rotulo="t('descricao')"
          :max-bytes="150"
          obrigatorio
        />
        <SanteSelecao
          v-model="rg.natureza"
          :rotulo="t('natureza')"
          :opcoes="opcoesNatureza"
          data-testid="pp-op-regra-natureza"
        />
        <SanteCampoTexto
          id="pp-op-regra-extensoes"
          v-model="rg.extensoes"
          :rotulo="t('extensoes')"
          :max-bytes="60"
        />
        <SanteCampoTexto
          id="pp-op-regra-tamanho"
          v-model="rg.tamanho"
          :rotulo="t('tamanho')"
          :max-bytes="7"
        />
        <label
          ><input v-model="rg.obrigatorio" type="checkbox" data-testid="pp-op-regra-obrigatorio" />
          {{ t('obrigatorio') }}</label
        >
        <SanteBotao
          tipo="submit"
          :rotulo="t('incluir')"
          :desabilitado="gravando || !regraPronta"
          data-testid="pp-op-incluir"
        />
      </form>
    </section>
  </div>
</template>

<style scoped src="../../estilo-operadora.css"></style>
