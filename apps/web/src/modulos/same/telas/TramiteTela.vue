<script setup lang="ts">
// SAME: protocolo em lote entre setores e empréstimo de prontuário (F3.9, 04-HOT L127 e L128): `/same/tramite`.
// Três abas numa tela só: receber (a fila do setor, item a item: marca o que chegou e recusa com motivo), enviar (monta
// o lote por volume, atendimento, conta ou documento avulso, emite e envia num clique; os enviados ainda não conferidos
// podem ser cancelados com motivo), solicitações (pede volumes ao arquivo; a fila trata item a item: entrega por
// empréstimo, não localizado com onde se procurou, cancelamento com motivo; o motivo que exige autorização deixa o pedido
// aguardando o responsável, que autoriza ou nega com a justificativa) e empréstimos (empresta com o prazo do motivo já mostrado, vê os atrasados com os
// dias, cobra e devolve). A montagem do lote e a conferência são validadas na hora pelas regras do domínio; as recusas
// do servidor (custódia do volume, versão) aparecem como vieram.
import {
  conferirAutorizacaoDaEntrega,
  conferirCancelamentoSolicitacao,
  conferirDecisaoAutorizacao,
  conferirNaoLocalizado,
  conferirProtocolo,
  conferirRecebimento,
  prazoDoEmprestimo,
  type SituacaoItemSolicitacao,
  type SituacaoProtocolo,
  type SituacaoSolicitacao,
  TIPOS_ITEM_PROTOCOLO,
  type TipoItemProtocolo,
} from '@sgh/dominio-hotelaria';
import { PERMISSOES_M21_CODIGOS } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  type ApoioTramite,
  cancelarProtocolo,
  cancelarSolicitacao,
  cobrar,
  cobrarSaidaGuarda,
  decidirAutorizacao,
  devolver,
  type EmprestimoTela,
  emitirProtocolo,
  emprestar,
  lerApoioTramite,
  lerEmprestimos,
  lerItensSolicitacao,
  lerProtocolos,
  lerSolicitacoes,
  naoLocalizado,
  type ProtocoloTela,
  receberProtocolo,
  solicitar,
  type SolicitacaoTela,
} from '../api-tramite.js';

const { t } = useI18n();
const k = (c: string, p: Record<string, unknown> = {}) => t(`sameTramite.${c}`, p);

type Aba = 'receber' | 'enviar' | 'solicitacoes' | 'emprestimos';
const abas: Aba[] = ['receber', 'enviar', 'solicitacoes', 'emprestimos'];
const aba = ref<Aba>('receber');
const apoio = ref<ApoioTramite | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);

async function tentar(fn: () => Promise<string | null>): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    aviso.value = await fn();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}
const quando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const opSetoresTramite = computed(() =>
  (apoio.value?.setoresTramite ?? []).map((s) => ({ valor: s.id as number | null, rotulo: s.descricao })),
);

// ---- Receber -------------------------------------------------------------------------------------------------------
const setor = ref<number | null>(null);
const opSetorRecebe = computed(() => [{ valor: null, rotulo: k('todos') }, ...opSetoresTramite.value]);
const fila = ref<ProtocoloTela[]>([]);
const conferencia = reactive<Record<number, { aceito: boolean | null; motivo: string }>>({});

async function carregarFila(): Promise<void> {
  fila.value = (await lerProtocolos(setor.value, 'entrada')).itens;
  for (const p of fila.value) for (const i of p.itens) conferencia[i.id] ??= { aceito: null, motivo: '' };
}
function marcados(p: ProtocoloTela) {
  return p.itens
    .filter((i) => !i.recebido && !i.recusado && conferencia[i.id]?.aceito != null)
    .map((i) => ({
      item: i.id,
      aceito: conferencia[i.id]!.aceito === true,
      motivo: conferencia[i.id]!.motivo.trim() || null,
    }));
}
const faltaConferencia = (p: ProtocoloTela) =>
  conferirRecebimento(p.situacao as SituacaoProtocolo, p.itens, marcados(p)).map((x) => x.mensagem);
const confirmar = (p: ProtocoloTela) =>
  tentar(async () => {
    await receberProtocolo(p.id, { itens: marcados(p), versao: p.versao });
    await carregarFila();
    return k('conferenciaGravada', { numero: p.numero });
  });
const descreverItem = (i: ProtocoloTela['itens'][number]) =>
  i.tipo === 'documento' ? (i.descricao ?? '') : `${k(`tipos.${i.tipo}`)} ${i.alvo ?? ''}`;

// ---- Enviar --------------------------------------------------------------------------------------------------------
const lote = reactive({
  remetente: null as number | null,
  destinatario: null as number | null,
  urgente: false,
});
const novoItem = () => ({ tipo: 'volume_prontuario' as TipoItemProtocolo, alvo: '', descricao: '' });
const itensLote = ref([novoItem()]);
const opTipos = computed(() => TIPOS_ITEM_PROTOCOLO.map((x) => ({ valor: x, rotulo: k(`tipos.${x}`) })));
const itensPedido = computed(() =>
  itensLote.value
    .filter((i) => i.alvo.trim() || i.descricao.trim())
    .map((i) =>
      i.tipo === 'documento'
        ? { tipo: i.tipo, alvo: null, descricao: i.descricao.trim() }
        : {
            tipo: i.tipo,
            alvo: /^\d+$/.test(i.alvo.trim()) ? Number(i.alvo.trim()) : null,
            descricao: null,
          },
    ),
);
const faltaLote = computed(() =>
  lote.remetente && lote.destinatario
    ? conferirProtocolo({
        remetente: lote.remetente,
        destinatario: lote.destinatario,
        itens: itensPedido.value,
      }).map((x) => x.mensagem)
    : [],
);
const enviados = ref<ProtocoloTela[]>([]);
const motivoCancelar = reactive<Record<number, string>>({});
async function carregarEnviados(): Promise<void> {
  enviados.value = lote.remetente
    ? (await lerProtocolos(lote.remetente, 'saida')).itens.filter((p) => p.situacao === 'enviado')
    : [];
  for (const p of enviados.value) motivoCancelar[p.id] ??= '';
}
const enviarLote = () =>
  tentar(async () => {
    const r = await emitirProtocolo({
      remetente: lote.remetente,
      destinatario: lote.destinatario,
      prioridade: lote.urgente ? 'urgente' : 'normal',
      itens: itensPedido.value,
    });
    itensLote.value = [novoItem()];
    await carregarEnviados();
    return k('enviado', { numero: String(r['numero'] ?? r['id'] ?? '') });
  });
const cancelar = (p: ProtocoloTela) =>
  tentar(async () => {
    await cancelarProtocolo(p.id, { motivo: (motivoCancelar[p.id] ?? '').trim(), versao: p.versao });
    await carregarEnviados();
    return k('cancelado', { numero: p.numero });
  });

// ---- Solicitações --------------------------------------------------------------------------------------------------
const opArquivos = computed(() => [
  { valor: null as number | null, rotulo: k('escolha') },
  ...(apoio.value?.arquivos ?? []).map((a) => ({ valor: a.id as number | null, rotulo: a.caminho })),
]);
const exigeAutorizacao = (motivo: number | null) =>
  apoio.value?.motivos.find((m) => m.id === motivo)?.exigeAutorizacao ?? false;
const pedido = reactive({
  localArquivo: null as number | null,
  destino: null as number | null,
  motivo: null as number | null,
});
const novaLinha = () => ({ paciente: '', volume: '' });
const linhasPedido = ref([novaLinha()]);
const numero = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const itensSolicitados = computed(() =>
  linhasPedido.value
    .filter((l) => l.paciente.trim() || l.volume.trim())
    .map((l) => ({ paciente: numero(l.paciente), volume: l.volume.trim() ? numero(l.volume) : null })),
);
const faltaPedido = computed(() => {
  const r: string[] = [];
  if (!itensSolicitados.value.length) r.push(k('faltaPaciente'));
  if (itensSolicitados.value.some((i) => i.paciente === null)) r.push(k('pacienteNumero'));
  const vistos = new Set<string>();
  for (const [n, l] of linhasPedido.value.entries()) {
    if (l.volume.trim() && numero(l.volume) === null) r.push(k('volumeNumero', { n: n + 1 }));
    const c = `${l.paciente.trim()}:${l.volume.trim()}`;
    if (l.paciente.trim() && vistos.has(c)) r.push(k('linhaRepetida', { n: n + 1 }));
    vistos.add(c);
  }
  return r;
});
const podeSolicitar = computed(
  () =>
    pedido.localArquivo !== null &&
    pedido.destino !== null &&
    pedido.motivo !== null &&
    faltaPedido.value.length === 0,
);
const solicitacoes = ref<SolicitacaoTela[]>([]);
type ItemSol = Awaited<ReturnType<typeof lerItensSolicitacao>>['itens'][number];
const itensSol = reactive<Record<number, ItemSol[]>>({});
const acaoSol = reactive<
  Record<
    number,
    {
      motivo: string;
      justificativa: string;
      setor: number | null;
      ondeProcurou: Record<number, string>;
      // Item "todos os volumes": o volume do paciente que o arquivo entrega (o servidor confere que é do paciente).
      volumeEntrega: Record<number, string>;
    }
  >
>({});
function guardarItens(id: number, itens: ItemSol[]): void {
  itensSol[id] = itens;
  for (const i of itens) {
    acaoSol[id]!.ondeProcurou[i.id] ??= '';
    acaoSol[id]!.volumeEntrega[i.id] ??= '';
  }
}
async function carregarSolicitacoes(): Promise<void> {
  solicitacoes.value = (await lerSolicitacoes()).itens;
  for (const s of solicitacoes.value) {
    acaoSol[s.id] ??= { motivo: '', justificativa: '', setor: null, ondeProcurou: {}, volumeEntrega: {} };
    if (itensSol[s.id]) guardarItens(s.id, (await lerItensSolicitacao(s.id)).itens);
  }
}
const enviarPedido = () =>
  tentar(async () => {
    const r = await solicitar({
      localArquivo: pedido.localArquivo,
      destino: pedido.destino,
      motivo: pedido.motivo,
      itens: itensSolicitados.value,
    });
    linhasPedido.value = [novaLinha()];
    await carregarSolicitacoes();
    return k('solicitado', { numero: String(r['numero'] ?? r['id'] ?? '') });
  });
const verItens = (s: SolicitacaoTela) =>
  tentar(async () => {
    if (itensSol[s.id]) delete itensSol[s.id];
    else guardarItens(s.id, (await lerItensSolicitacao(s.id)).itens);
    return null;
  });
// A decisão é de quem tem a permissão (por perfil) e nunca de quem pediu: sem a permissão, a tela só mostra que o pedido
// aguarda; com ela, a regra do domínio confere na hora o solicitante contra o usuário da sessão (o servidor confere de novo).
const { sessao, permissoes } = usarSessao();
const podeDecidir = computed(() => permissoes.value.has(PERMISSOES_M21_CODIGOS.sameAutorizarSolicitacao));
const usuarioSessao = computed(() => {
  const id = sessao.value?.usuario.id ?? '';
  return /^\d+$/.test(id) ? Number(id) : -1;
});
const faltaDecisao = (s: SolicitacaoTela, decisao: 'autorizar' | 'negar') =>
  conferirDecisaoAutorizacao({
    situacao: s.situacao as SituacaoSolicitacao,
    autorizacao: s.autorizacao,
    decisao,
    justificativa: acaoSol[s.id]?.justificativa ?? null,
    solicitante: s.solicitante,
    responsavel: usuarioSessao.value,
  }).map((x) => x.mensagem);
const proprioPedido = (s: SolicitacaoTela) => s.solicitante === usuarioSessao.value;
const decidir = (s: SolicitacaoTela, decisao: 'autorizar' | 'negar') =>
  tentar(async () => {
    await decidirAutorizacao(s.id, decisao, acaoSol[s.id]!.justificativa.trim() || null, s.versao);
    acaoSol[s.id]!.justificativa = '';
    await carregarSolicitacoes();
    return k(decisao === 'autorizar' ? 'autorizada' : 'negada', { numero: s.numero });
  });
const faltaCancelarSol = (s: SolicitacaoTela) =>
  conferirCancelamentoSolicitacao(s.situacao as SituacaoSolicitacao, acaoSol[s.id]?.motivo ?? null).map(
    (x) => x.mensagem,
  );
const cancelarSol = (s: SolicitacaoTela) =>
  tentar(async () => {
    await cancelarSolicitacao(s.id, acaoSol[s.id]!.motivo.trim(), s.versao);
    delete itensSol[s.id];
    await carregarSolicitacoes();
    return k('solicitacaoCancelada', { numero: s.numero });
  });
const faltaNaoLocalizado = (s: SolicitacaoTela, i: ItemSol) =>
  conferirNaoLocalizado(
    s.situacao as SituacaoSolicitacao,
    i.situacao as SituacaoItemSolicitacao,
    acaoSol[s.id]?.ondeProcurou[i.id] ?? null,
  ).map((x) => x.mensagem);
const marcarNaoLocalizado = (s: SolicitacaoTela, i: ItemSol) =>
  tentar(async () => {
    await naoLocalizado(s.id, i.id, acaoSol[s.id]!.ondeProcurou[i.id]!.trim(), s.versao);
    await carregarSolicitacoes();
    return k('naoLocalizadoGravado');
  });
const faltaEntrega = (s: SolicitacaoTela) =>
  conferirAutorizacaoDaEntrega({
    exigeAutorizacao: false,
    autorizacao: s.autorizacao,
    comSolicitacao: true,
  }).map((x) => x.mensagem);
// O item "todos os volumes" pede o número do volume que sai, conferido na hora.
const faltaVolumeEntrega = (s: SolicitacaoTela, i: ItemSol): string | null => {
  if (i.volume !== null) return null;
  const v = (acaoSol[s.id]?.volumeEntrega[i.id] ?? '').trim();
  if (!v) return k('volumeEntregaFalta');
  return /^\d{1,9}$/.test(v) && Number(v) > 0 ? null : k('volumeEntregaNumero');
};
const entregar = (s: SolicitacaoTela, i: ItemSol) =>
  tentar(async () => {
    const volume = i.volume ?? Number(acaoSol[s.id]!.volumeEntrega[i.id]!.trim());
    await emprestar({ volume, destinoSetor: acaoSol[s.id]!.setor, solicitacao: s.id });
    await Promise.all([carregarSolicitacoes(), carregarEmprestimos()]);
    return k('emprestado');
  });

// ---- Empréstimos ---------------------------------------------------------------------------------------------------
const emprestimos = ref<EmprestimoTela[]>([]);
const soAtrasados = ref(false);
const novoEmp = reactive({
  volume: '',
  destinoSetor: null as number | null,
  motivo: null as number | null,
  prazo: '',
});
const opSetores = computed(() => [
  { valor: null as number | null, rotulo: k('escolha') },
  ...(apoio.value?.setores ?? []).map((s) => ({ valor: s.id as number | null, rotulo: s.nome })),
]);
const opMotivos = computed(() => [
  { valor: null as number | null, rotulo: k('escolha') },
  ...(apoio.value?.motivos ?? []).map((m) => ({ valor: m.id as number | null, rotulo: m.descricao })),
]);
const prazoInformado = computed(() =>
  /^\d+$/.test(novoEmp.prazo.trim()) ? Number(novoEmp.prazo.trim()) : null,
);
const devolverAte = computed(() =>
  apoio.value
    ? prazoDoEmprestimo(new Date(), {
        informado: prazoInformado.value,
        doMotivo: apoio.value.motivos.find((m) => m.id === novoEmp.motivo)?.prazoDias ?? null,
        padrao: apoio.value.prazoPadraoDias,
      }).toISOString()
    : null,
);
const faltaAutorizacaoEmp = computed(() =>
  conferirAutorizacaoDaEntrega({
    exigeAutorizacao: exigeAutorizacao(novoEmp.motivo),
    autorizacao: null,
    comSolicitacao: false,
  }).map((x) => x.mensagem),
);
const podeEmprestar = computed(
  () =>
    faltaAutorizacaoEmp.value.length === 0 &&
    /^\d+$/.test(novoEmp.volume.trim()) &&
    novoEmp.destinoSetor !== null &&
    novoEmp.motivo !== null &&
    (novoEmp.prazo.trim() === '' || (prazoInformado.value! >= 1 && prazoInformado.value! <= 365)),
);
async function carregarEmprestimos(): Promise<void> {
  emprestimos.value = (await lerEmprestimos(null, soAtrasados.value)).itens;
}
const novoEmprestimo = () =>
  tentar(async () => {
    await emprestar({
      volume: Number(novoEmp.volume),
      destinoSetor: novoEmp.destinoSetor,
      motivo: novoEmp.motivo,
      prazoDias: prazoInformado.value,
    });
    Object.assign(novoEmp, { volume: '', prazo: '' });
    await carregarEmprestimos();
    return k('emprestado');
  });
const cobrarEmp = (e: EmprestimoTela) =>
  tentar(async () => {
    if (e.id !== null) await cobrar(e.id, e.versao);
    else if (e.movimento !== null) await cobrarSaidaGuarda(e.movimento);
    await carregarEmprestimos();
    return k('cobrado');
  });
const devolverEmp = (e: EmprestimoTela) =>
  tentar(async () => {
    await devolver(e.id!, e.versao);
    await carregarEmprestimos();
    return k('devolvido');
  });

onMounted(() =>
  tentar(async () => {
    apoio.value = await lerApoioTramite();
    await Promise.all([carregarFila(), carregarSolicitacoes(), carregarEmprestimos()]);
    return null;
  }),
);
</script>

<template>
  <section class="tramite" data-testid="same-tramite" aria-labelledby="tramite-titulo">
    <h1 id="tramite-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <div class="abas" role="tablist">
      <button
        v-for="a in abas"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`tramite-aba-${a}`"
        @click="aba = a"
      >
        {{ k(`abas.${a}`) }}
      </button>
    </div>
    <p v-if="erro" class="erro" role="alert" data-testid="tramite-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="tramite-aviso">{{ aviso }}</p>

    <div v-if="aba === 'receber'" role="tabpanel" class="painel">
      <SanteSelecao
        v-model="setor"
        :rotulo="k('setorRecebe')"
        :opcoes="opSetorRecebe"
        data-testid="tramite-setor-recebe"
        @update:model-value="tentar(async () => (await carregarFila(), null))"
      />
      <p v-if="!fila.length" data-testid="tramite-fila-vazia">{{ k('nenhumProtocolo') }}</p>
      <article v-for="p in fila" :key="p.id" class="caixa" :data-testid="`tramite-protocolo-${p.numero}`">
        <h2>
          {{
            k('protocolo', { numero: p.numero, de: p.remetente.descricao, para: p.destinatario.descricao })
          }}
          · <span data-testid="tramite-situacao">{{ k(`situacoes.${p.situacao}`) }}</span>
          <span v-if="p.prioridade === 'urgente'" class="urgente"> · {{ k('urgente') }}</span>
        </h2>
        <ul class="itens">
          <li v-for="i in p.itens" :key="i.id" :data-testid="`tramite-item-${i.sequencia}`">
            <span>{{ i.sequencia }}. {{ descreverItem(i) }}</span>
            <span v-if="i.recebido">{{ k('itemRecebido') }}</span>
            <span v-else-if="i.recusado">{{ k('itemRecusado', { motivo: i.motivoRecusa ?? '' }) }}</span>
            <template v-else-if="conferencia[i.id]">
              <label
                ><input
                  v-model="conferencia[i.id]!.aceito"
                  type="radio"
                  :name="`conf-${i.id}`"
                  :value="true"
                  data-testid="chegou"
                />
                {{ k('chegou') }}</label
              >
              <label
                ><input
                  v-model="conferencia[i.id]!.aceito"
                  type="radio"
                  :name="`conf-${i.id}`"
                  :value="false"
                  data-testid="recusar"
                />
                {{ k('recusar') }}</label
              >
              <SanteCampoTexto
                v-if="conferencia[i.id]!.aceito === false"
                v-model="conferencia[i.id]!.motivo"
                :rotulo="k('motivoRecusa')"
                :max-bytes="500"
                data-testid="motivo-recusa"
              />
            </template>
          </li>
        </ul>
        <ul
          v-if="marcados(p).length && faltaConferencia(p).length"
          class="erro"
          data-testid="tramite-falta-conferencia"
        >
          <li v-for="m in faltaConferencia(p)" :key="m">{{ m }}</li>
        </ul>
        <SanteBotao
          :rotulo="k('gravarConferencia')"
          :desabilitado="faltaConferencia(p).length > 0"
          data-testid="tramite-gravar-conferencia"
          @acionar="confirmar(p)"
        />
      </article>
    </div>

    <div v-else-if="aba === 'enviar'" role="tabpanel" class="painel">
      <div class="linha">
        <SanteSelecao
          v-model="lote.remetente"
          :rotulo="k('de')"
          :opcoes="[{ valor: null, rotulo: k('escolha') }, ...opSetoresTramite]"
          data-testid="tramite-remetente"
          @update:model-value="tentar(async () => (await carregarEnviados(), null))"
        />
        <SanteSelecao
          v-model="lote.destinatario"
          :rotulo="k('para')"
          :opcoes="[{ valor: null, rotulo: k('escolha') }, ...opSetoresTramite]"
          data-testid="tramite-destinatario"
        />
        <label
          ><input v-model="lote.urgente" type="checkbox" data-testid="tramite-urgente" />
          {{ k('urgente') }}</label
        >
      </div>
      <div v-for="(i, n) in itensLote" :key="n" class="linha" :data-testid="`tramite-novo-item-${n + 1}`">
        <SanteSelecao v-model="i.tipo" :rotulo="k('tipoItem')" :opcoes="opTipos" data-testid="tipo" />
        <SanteCampoTexto
          v-if="i.tipo !== 'documento'"
          v-model="i.alvo"
          :rotulo="k('numeroItem')"
          :max-bytes="12"
          data-testid="alvo"
        />
        <SanteCampoTexto
          v-else
          v-model="i.descricao"
          :rotulo="k('descricaoItem')"
          :max-bytes="200"
          data-testid="descricao"
        />
        <SanteBotao
          v-if="itensLote.length > 1"
          variante="texto"
          :rotulo="k('tirarItem', { n: n + 1 })"
          @acionar="itensLote.splice(n, 1)"
        />
      </div>
      <div class="linha">
        <SanteBotao
          variante="secundario"
          :rotulo="k('maisItem')"
          data-testid="tramite-mais-item"
          @acionar="itensLote.push({ ...novoItem(), tipo: itensLote.at(-1)?.tipo ?? 'volume_prontuario' })"
        />
        <SanteBotao
          :rotulo="k('emitir')"
          :desabilitado="!lote.remetente || !lote.destinatario || faltaLote.length > 0"
          data-testid="tramite-emitir"
          @acionar="enviarLote"
        />
      </div>
      <ul v-if="faltaLote.length" class="erro" data-testid="tramite-falta-lote">
        <li v-for="m in faltaLote" :key="m">{{ m }}</li>
      </ul>
      <template v-if="lote.remetente">
        <h2>{{ k('enviadosTitulo') }}</h2>
        <p v-if="!enviados.length">{{ k('nenhumEnviado') }}</p>
        <article v-for="p in enviados" :key="p.id" class="caixa" :data-testid="`tramite-enviado-${p.numero}`">
          <p>
            {{
              k('protocolo', { numero: p.numero, de: p.remetente.descricao, para: p.destinatario.descricao })
            }}
          </p>
          <div class="linha">
            <SanteCampoTexto
              v-model="motivoCancelar[p.id]!"
              :rotulo="k('motivoCancelamento')"
              :max-bytes="500"
              data-testid="tramite-motivo-cancelar"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="k('cancelar')"
              :desabilitado="!(motivoCancelar[p.id] ?? '').trim()"
              data-testid="tramite-cancelar"
              @acionar="cancelar(p)"
            />
          </div>
        </article>
      </template>
    </div>

    <div v-else-if="aba === 'solicitacoes'" role="tabpanel" class="painel">
      <fieldset class="caixa">
        <legend>{{ k('pedirTitulo') }}</legend>
        <div class="linha">
          <SanteSelecao
            v-model="pedido.localArquivo"
            :rotulo="k('arquivo')"
            :opcoes="opArquivos"
            data-testid="sol-arquivo"
          />
          <SanteSelecao
            v-model="pedido.destino"
            :rotulo="k('para')"
            :opcoes="[{ valor: null, rotulo: k('escolha') }, ...opSetoresTramite]"
            data-testid="sol-destino"
          />
          <SanteSelecao
            v-model="pedido.motivo"
            :rotulo="k('motivo')"
            :opcoes="opMotivos"
            data-testid="sol-motivo"
          />
        </div>
        <p v-if="exigeAutorizacao(pedido.motivo)" role="note" data-testid="sol-exige-autorizacao">
          {{ k('exigeAutorizacao') }}
        </p>
        <div v-for="(l, n) in linhasPedido" :key="n" class="linha" :data-testid="`sol-linha-${n + 1}`">
          <SanteCampoTexto
            v-model="l.paciente"
            :rotulo="k('paciente')"
            :max-bytes="12"
            data-testid="paciente"
          />
          <SanteCampoTexto
            v-model="l.volume"
            :rotulo="k('volumeOpcional')"
            :max-bytes="12"
            data-testid="volume"
          />
          <SanteBotao
            v-if="linhasPedido.length > 1"
            variante="texto"
            :rotulo="k('tirarItem', { n: n + 1 })"
            @acionar="linhasPedido.splice(n, 1)"
          />
        </div>
        <div class="linha">
          <SanteBotao
            variante="secundario"
            :rotulo="k('maisItem')"
            data-testid="sol-mais"
            @acionar="linhasPedido.push(novaLinha())"
          />
          <SanteBotao
            :rotulo="k('solicitar')"
            :desabilitado="!podeSolicitar"
            data-testid="sol-solicitar"
            @acionar="enviarPedido"
          />
        </div>
        <ul v-if="itensSolicitados.length && faltaPedido.length" class="erro" data-testid="sol-falta">
          <li v-for="m in faltaPedido" :key="m">{{ m }}</li>
        </ul>
      </fieldset>
      <h2>{{ k('filaSolicitacoes') }}</h2>
      <p v-if="!solicitacoes.length" data-testid="sol-fila-vazia">{{ k('nenhumaSolicitacao') }}</p>
      <article v-for="s in solicitacoes" :key="s.id" class="caixa" :data-testid="`sol-${s.numero}`">
        <h3>
          {{ k('solicitacao', { numero: s.numero, motivo: s.motivo, destino: s.destino ?? '' }) }}
          · <span data-testid="sol-situacao">{{ k(`situacoesSolicitacao.${s.situacao}`) }}</span>
          <span v-if="s.urgente" class="urgente"> · {{ k('urgente') }}</span>
          <span v-if="s.autorizacao" data-testid="sol-autorizacao">
            · {{ k(`autorizacoes.${s.autorizacao}`) }}</span
          >
        </h3>
        <p v-if="s.autorizacao === 'aguardando' && !podeDecidir" data-testid="sol-aguarda-decisor">
          {{ k('aguardaDecisor') }}
        </p>
        <p v-else-if="s.autorizacao === 'aguardando' && proprioPedido(s)" data-testid="sol-proprio-pedido">
          {{ k('proprioPedido') }}
        </p>
        <div v-else-if="s.autorizacao === 'aguardando'" class="linha" data-testid="sol-decisao">
          <SanteCampoTexto
            v-model="acaoSol[s.id]!.justificativa"
            :rotulo="k('justificativa')"
            :max-bytes="500"
            data-testid="sol-justificativa"
          />
          <SanteBotao
            :rotulo="k('autorizar')"
            :desabilitado="faltaDecisao(s, 'autorizar').length > 0"
            data-testid="sol-autorizar"
            @acionar="decidir(s, 'autorizar')"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('negar')"
            :desabilitado="faltaDecisao(s, 'negar').length > 0"
            data-testid="sol-negar"
            @acionar="decidir(s, 'negar')"
          />
        </div>
        <SanteBotao
          variante="texto"
          :rotulo="k(itensSol[s.id] ? 'esconderItens' : 'verItens', { n: s.itens })"
          data-testid="sol-ver-itens"
          @acionar="verItens(s)"
        />
        <template v-if="itensSol[s.id]">
          <p v-if="faltaEntrega(s).length" data-testid="sol-falta-entrega">{{ faltaEntrega(s)[0] }}</p>
          <SanteSelecao
            v-else
            v-model="acaoSol[s.id]!.setor"
            :rotulo="k('destino')"
            :opcoes="opSetores"
            data-testid="sol-setor-entrega"
          />
          <ul class="itens">
            <li v-for="i in itensSol[s.id]" :key="i.id" :data-testid="`sol-item-${i.sequencia}`">
              <span>
                {{ i.sequencia }}.
                {{
                  k('itemSolicitado', {
                    paciente: i.paciente,
                    volume: i.matricula ?? i.volume ?? k('todosVolumes'),
                  })
                }}
                · {{ k(`situacoesItem.${i.situacao}`) }}
                <template v-if="i.observacao"> · {{ i.observacao }}</template>
              </span>
              <template v-if="i.situacao === 'pendente'">
                <SanteCampoTexto
                  v-if="i.volume === null"
                  v-model="acaoSol[s.id]!.volumeEntrega[i.id]!"
                  :rotulo="k('volumeEntrega')"
                  :max-bytes="9"
                  data-testid="sol-volume-entrega"
                />
                <span
                  v-if="acaoSol[s.id]!.volumeEntrega[i.id] && faltaVolumeEntrega(s, i)"
                  class="erro"
                  data-testid="sol-volume-entrega-erro"
                  >{{ faltaVolumeEntrega(s, i) }}</span
                >
                <SanteBotao
                  :rotulo="k('entregar')"
                  :desabilitado="
                    faltaEntrega(s).length > 0 ||
                    acaoSol[s.id]!.setor === null ||
                    faltaVolumeEntrega(s, i) !== null
                  "
                  data-testid="sol-entregar"
                  @acionar="entregar(s, i)"
                />
                <SanteCampoTexto
                  v-model="acaoSol[s.id]!.ondeProcurou[i.id]!"
                  :rotulo="k('ondeProcurou')"
                  :max-bytes="500"
                  data-testid="sol-onde-procurou"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="k('naoLocalizado')"
                  :desabilitado="faltaNaoLocalizado(s, i).length > 0"
                  data-testid="sol-nao-localizado"
                  @acionar="marcarNaoLocalizado(s, i)"
                />
              </template>
            </li>
          </ul>
        </template>
        <div class="linha">
          <SanteCampoTexto
            v-model="acaoSol[s.id]!.motivo"
            :rotulo="k('motivoCancelamento')"
            :max-bytes="500"
            data-testid="sol-motivo-cancelar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('cancelarSolicitacao')"
            :desabilitado="faltaCancelarSol(s).length > 0"
            data-testid="sol-cancelar"
            @acionar="cancelarSol(s)"
          />
        </div>
      </article>
    </div>

    <div v-else role="tabpanel" class="painel">
      <fieldset class="caixa">
        <legend>{{ k('emprestarTitulo') }}</legend>
        <div class="linha">
          <SanteCampoTexto
            v-model="novoEmp.volume"
            :rotulo="k('volume')"
            :max-bytes="12"
            data-testid="emp-volume"
          />
          <SanteSelecao
            v-model="novoEmp.destinoSetor"
            :rotulo="k('destino')"
            :opcoes="opSetores"
            data-testid="emp-setor"
          />
          <SanteSelecao
            v-model="novoEmp.motivo"
            :rotulo="k('motivo')"
            :opcoes="opMotivos"
            data-testid="emp-motivo"
          />
          <SanteCampoTexto
            v-model="novoEmp.prazo"
            :rotulo="k('prazoDias')"
            :max-bytes="3"
            data-testid="emp-prazo"
          />
          <SanteBotao
            :rotulo="k('emprestar')"
            :desabilitado="!podeEmprestar"
            data-testid="emp-emprestar"
            @acionar="novoEmprestimo"
          />
        </div>
        <p v-if="faltaAutorizacaoEmp.length" class="erro" data-testid="emp-exige-autorizacao">
          {{ faltaAutorizacaoEmp[0] }}
        </p>
        <p v-else-if="devolverAte && novoEmp.motivo" data-testid="emp-devolver-ate">
          {{ k('prazoPrevisto', { data: quando(devolverAte) }) }}
        </p>
      </fieldset>
      <label
        ><input
          v-model="soAtrasados"
          type="checkbox"
          data-testid="emp-so-atrasados"
          @change="tentar(async () => (await carregarEmprestimos(), null))"
        />
        {{ k('soAtrasados') }}</label
      >
      <p v-if="!emprestimos.length">{{ k('nenhumEmprestimo') }}</p>
      <table v-else data-testid="emp-lista">
        <caption>
          {{
            k('legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th
              v-for="c in ['volume', 'destino', 'motivo', 'prazo', 'atraso', 'cobrancas', 'acoes']"
              :key="c"
              scope="col"
            >
              {{ k(`colunas.${c}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in emprestimos"
            :key="`${e.origem}-${e.id ?? e.movimento}`"
            :class="{ atrasado: e.diasAtraso > 0 }"
            :data-testid="`emp-${e.volume.id}`"
          >
            <td>
              {{ e.volume.matricula ?? e.volume.id }}
              <span v-if="e.origem === 'guarda'">{{ k('pelaGuarda') }}</span>
            </td>
            <td>{{ e.destino }}</td>
            <td>{{ e.motivo }}</td>
            <td>{{ quando(e.prazo) }}</td>
            <td data-testid="emp-atraso">
              {{ e.diasAtraso > 0 ? k('diasAtraso', { n: e.diasAtraso }) : k('noPrazo') }}
            </td>
            <td>{{ e.cobrancas }}</td>
            <td class="linha">
              <SanteBotao
                v-if="e.diasAtraso > 0"
                variante="secundario"
                :rotulo="k('cobrar')"
                data-testid="emp-cobrar"
                @acionar="cobrarEmp(e)"
              />
              <SanteBotao
                v-if="e.id !== null"
                :rotulo="k('devolver')"
                data-testid="emp-devolver"
                @acionar="devolverEmp(e)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.tramite,
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.abas {
  display: flex;
  gap: var(--sgh-espaco-1);
}
.abas button {
  min-height: var(--sgh-alvo-minimo);
}
.abas [aria-selected='true'] {
  font-weight: 600;
  border-bottom: 2px solid var(--sgh-primaria);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.caixa {
  border: 1px solid var(--sgh-borda);
  border-radius: 0.5rem;
  padding: var(--sgh-espaco-2);
}
.itens li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.erro {
  color: var(--sgh-alerta);
}
.urgente,
.atrasado td:first-child {
  color: var(--sgh-aviso);
  font-weight: 600;
}
</style>
