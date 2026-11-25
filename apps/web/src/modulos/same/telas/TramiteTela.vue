<script setup lang="ts">
// SAME: protocolo em lote entre setores e empréstimo de prontuário (F3.9, 04-HOT L127 e L128): `/same/tramite`.
// Três abas numa tela só: receber (a fila do setor, item a item: marca o que chegou e recusa com motivo), enviar (monta
// o lote por volume, atendimento, conta ou documento avulso, emite e envia num clique; os enviados ainda não conferidos
// podem ser cancelados com motivo) e empréstimos (empresta com o prazo do motivo já mostrado, vê os atrasados com os
// dias, cobra e devolve). A montagem do lote e a conferência são validadas na hora pelas regras do domínio; as recusas
// do servidor (custódia do volume, versão) aparecem como vieram.
import {
  conferirProtocolo,
  conferirRecebimento,
  prazoDoEmprestimo,
  type SituacaoProtocolo,
  TIPOS_ITEM_PROTOCOLO,
  type TipoItemProtocolo,
} from '@sgh/dominio-hotelaria';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type ApoioTramite,
  cancelarProtocolo,
  cobrar,
  cobrarSaidaGuarda,
  devolver,
  type EmprestimoTela,
  emitirProtocolo,
  emprestar,
  lerApoioTramite,
  lerEmprestimos,
  lerProtocolos,
  type ProtocoloTela,
  receberProtocolo,
} from '../api-tramite.js';

const { t } = useI18n();
const k = (c: string, p: Record<string, unknown> = {}) => t(`sameTramite.${c}`, p);

type Aba = 'receber' | 'enviar' | 'emprestimos';
const abas: Aba[] = ['receber', 'enviar', 'emprestimos'];
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
const podeEmprestar = computed(
  () =>
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
    await Promise.all([carregarFila(), carregarEmprestimos()]);
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
        <p v-if="devolverAte && novoEmp.motivo" data-testid="emp-devolver-ate">
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
