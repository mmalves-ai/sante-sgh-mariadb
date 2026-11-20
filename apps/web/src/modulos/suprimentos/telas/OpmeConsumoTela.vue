<script setup lang="ts">
// OPME: consumo em sala com rastreio por lote ou série (M46, etapa 3; ficha, seção 7; regras 6, 7 e 13), para o tablet
// da circulante. Sem cirurgia escolhida, as cirurgias do dia com o OPME pedido e consumido. Com a cirurgia: o OPME
// solicitado (a situação e o autorizado), a leitura do código da embalagem (GS1: lote, série e validade), o registro do
// consumo (a saída do estoque ao paciente internado, com o rastreio na mesma transação) e a etiqueta em três vias
// (prontuário, paciente e faturamento, em ZPL); o consumo sem a autorização da operadora é do supervisor, com a
// justificativa; a devolução do não usado. O servidor confere tudo de novo.
import type { ConsumoOpmeRegistrado, EtiquetaOpme, ItemOpme, SolicitacaoOpme } from '@sgh/contratos';
import { consumoExigeExcecao, lerCodigoEmbalagem } from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  buscarItensOpme,
  consumirOpme,
  devolverOpme,
  lerCirurgiasOpme,
  lerConsumoOpme,
  lerEtiquetaOpme,
} from '../api-opme.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import './estilo-opme.css';

const props = defineProps<{ agenda: string }>();
const { t } = useI18n();
const router = useRouter();
const agenda = computed(() => Number(props.agenda) || null);
const hora = (x: string) => x.slice(11, 16);

const dia = ref('');
const lista = useQuery({
  queryKey: computed(() => ['opme', 'consumo', 'cirurgias', dia.value]),
  queryFn: () => lerCirurgiasOpme(dia.value || null),
  enabled: computed(() => !agenda.value),
});
const dados = useQuery({
  queryKey: computed(() => ['opme', 'consumo', agenda.value]),
  queryFn: () => lerConsumoOpme(agenda.value!),
  enabled: computed(() => !!agenda.value),
});
const ctx = computed(() => dados.data.value);
const podeConsumir = computed(() => ctx.value?.gravacao.operacoes['consumir']?.pode === true);

const solicitacao = ref<SolicitacaoOpme | null>(null);
const form = reactive({
  item: null as number | null,
  quantidade: 1,
  local: 0,
  lote: '',
  serie: '',
  fabricante: '',
  modelo: '',
  anvisa: '',
  validade: '',
  codigo: '',
  justificativa: '',
});
watch(
  ctx,
  (c) => {
    if (c && !form.local) form.local = c.localSugerido ?? c.locais[0]?.codigo ?? 10;
  },
  { immediate: true },
);
function usar(s: SolicitacaoOpme | null): void {
  solicitacao.value = s;
  if (s) {
    form.item = s.item;
    itensAchados.value = [
      ...(itensAchados.value ?? []).filter((i) => i.item !== s.item),
      { item: s.item, nome: s.itemNome ?? String(s.item) },
    ];
  }
}
// O item: o da solicitação, ou buscado no cadastro de OPME (nome ou código) com o saldo do local escolhido.
const termoItem = ref('');
const itensAchados = ref<Pick<ItemOpme, 'item' | 'nome'>[] | null>(null);
const itensDoLocal = ref<ItemOpme[]>([]);
async function buscarItem(): Promise<void> {
  erro.value = null;
  try {
    itensDoLocal.value = (await buscarItensOpme(termoItem.value.trim(), Number(form.local) || null)).itens;
    const s = solicitacao.value;
    itensAchados.value = [
      ...(s && !itensDoLocal.value.some((i) => i.item === s.item)
        ? [{ item: s.item, nome: s.itemNome ?? String(s.item) }]
        : []),
      ...itensDoLocal.value,
    ];
    if (form.item !== null && !itensAchados.value.some((i) => i.item === form.item)) form.item = null;
  } catch (e) {
    erro.value = e;
  }
}
const opcoesItem = computed(() => [
  { valor: null as number | null, rotulo: '—', desabilitada: true },
  ...(itensAchados.value ?? []).map((i) => {
    const d = itensDoLocal.value.find((x) => x.item === i.item);
    return {
      valor: i.item as number | null,
      rotulo: d
        ? `${i.item} · ${i.nome} (${t('opme.solicitacoes.saldo', { saldo: d.saldoLocal, unidade: d.unidade })})`
        : `${i.item} · ${i.nome}`,
    };
  }),
]);
const exigeExcecao = computed(() => consumoExigeExcecao(solicitacao.value));
const leitura = ref('');
function lerCodigo(): void {
  const c = lerCodigoEmbalagem(form.codigo);
  if (!c.lote && !c.serie) {
    leitura.value = t('opme.consumo.codigoNaoReconhecido');
    return;
  }
  if (c.lote) form.lote = c.lote;
  if (c.serie) form.serie = c.serie;
  if (c.validade) form.validade = c.validade;
  // O GTIN da embalagem fica à vista para a conferência com o item escolhido (o cadastro de itens não guarda o GTIN).
  leitura.value = t('opme.consumo.codigoLido', {
    lote: c.lote ?? '—',
    serie: c.serie ?? '—',
    validade: c.validade ?? '—',
    gtin: c.gtin ?? '—',
  });
}

const erro = ref<unknown>(null);
const mensagem = ref('');
const enviando = ref(false);
const etiqueta = ref<EtiquetaOpme | null>(null);

async function registrar(): Promise<void> {
  if (!agenda.value) return;
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    const r: ConsumoOpmeRegistrado = await consumirOpme(agenda.value, {
      solicitacao: solicitacao.value?.id ?? null,
      item: Number(form.item ?? 0),
      quantidade: Number(form.quantidade),
      local: Number(form.local),
      lote: form.lote.trim() || null,
      serie: form.serie.trim() || null,
      fabricante: form.fabricante.trim(),
      modelo: form.modelo.trim() || null,
      registroAnvisa: form.anvisa.trim(),
      validade: form.validade || null,
      codigoLido: form.codigo.trim() || null,
      justificativa: exigeExcecao.value ? form.justificativa.trim() || null : null,
    });
    etiqueta.value = r.etiqueta;
    mensagem.value = t('opme.consumo.etiquetaPronta', { sha: r.etiqueta.sha256.slice(0, 12) });
    Object.assign(form, { lote: '', serie: '', codigo: '', justificativa: '', validade: '' });
    leitura.value = '';
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
    await dados.refetch();
  }
}

async function reimprimir(consumo: number): Promise<void> {
  erro.value = null;
  try {
    etiqueta.value = await lerEtiquetaOpme(consumo);
    mensagem.value = t('opme.consumo.etiquetaPronta', { sha: etiqueta.value.sha256.slice(0, 12) });
  } catch (e) {
    erro.value = e;
  }
}

async function copiar(): Promise<void> {
  if (etiqueta.value)
    await globalThis.navigator?.clipboard?.writeText(etiqueta.value.zpl).catch(() => undefined);
}

const devolucao = reactive<{ consumo: number | null; quantidade: number; motivo: string }>({
  consumo: null,
  quantidade: 1,
  motivo: '',
});
async function devolver(): Promise<void> {
  if (!agenda.value || devolucao.consumo === null) return;
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    const r = await devolverOpme(agenda.value, {
      consumo: devolucao.consumo,
      quantidade: Number(devolucao.quantidade),
      motivo: devolucao.motivo.trim(),
    });
    mensagem.value = r.mensagem;
    Object.assign(devolucao, { consumo: null, quantidade: 1, motivo: '' });
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
    await dados.refetch();
  }
}

function abrir(a: number): void {
  void router.push({ name: 'bloco.opme', params: { agenda: String(a) } });
}
</script>

<template>
  <section class="tela-opme" aria-labelledby="opmec-titulo" data-testid="tela-opme-consumo">
    <h1 id="opmec-titulo">{{ t('opme.consumo.titulo') }}</h1>
    <template v-if="!agenda">
      <p class="secundario">{{ t('opme.consumo.escolha') }}</p>
      <div class="barra">
        <span class="campo">
          <label for="opmec-dia">{{ t('opme.solicitacoes.data') }}</label>
          <input id="opmec-dia" v-model="dia" type="date" data-testid="opmec-dia" />
        </span>
      </div>
      <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('opme.carregando') }}</p>
      <p v-else-if="lista.data.value.cirurgias.length === 0">{{ t('opme.solicitacoes.semCirurgias') }}</p>
      <div v-else class="rolagem">
        <table class="grade">
          <caption class="secundario">
            {{
              t('opme.solicitacoes.cirurgiasDoDia')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('opme.solicitacoes.colCirurgia') }}</th>
              <th scope="col">{{ t('opme.consumo.paciente') }}</th>
              <th scope="col">{{ t('opme.solicitacoes.colItem') }}</th>
              <th scope="col">{{ t('opme.solicitacoes.colAcao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in lista.data.value.cirurgias"
              :key="c.agendamento"
              :data-testid="`opmec-cirurgia-${c.agendamento}`"
            >
              <td>{{ c.sala }} · {{ hora(c.inicio) }} · {{ c.procedimento ?? '—' }}</td>
              <td>{{ c.paciente }}</td>
              <td>
                {{ t('opme.consumo.pedidas', { n: c.solicitacoes }) }} ·
                {{ t('opme.consumo.consumidas', { n: c.consumos }) }}
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('opme.consumo.abrir')"
                  :data-testid="`opmec-abrir-${c.agendamento}`"
                  @acionar="abrir(c.agendamento)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="secundario">{{ t('opme.consumo.remissao') }}</p>
    </template>
    <template v-else>
      <ErroSuprimentos v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!ctx" role="status">{{ t('opme.carregando') }}</p>
      <template v-else>
        <div class="cartao" data-testid="opmec-cabecalho">
          <h2>{{ ctx.agendamento.paciente ?? '—' }}</h2>
          <p class="secundario">
            {{ t('opme.consumo.atendimento', { n: ctx.agendamento.atendimento }) }} ·
            {{ ctx.agendamento.salaNome ?? ctx.agendamento.sala }} · {{ hora(ctx.agendamento.dataHora) }} ·
            {{ ctx.agendamento.procedimento ?? '—' }}
            <span v-if="ctx.agendamento.cirurgiao">
              · {{ t('opme.consumo.cirurgiao', { nome: ctx.agendamento.cirurgiao }) }}</span
            >
          </p>
        </div>
        <SanteAlerta
          v-if="!ctx.gravacao.ligada"
          variante="aviso"
          :texto="ctx.gravacao.motivo ?? t('opme.emConsulta')"
          data-testid="opmec-desligado"
        />
        <ErroSuprimentos v-if="erro" :erro="erro" />
        <p v-if="mensagem" role="status" data-testid="opmec-mensagem">{{ mensagem }}</p>

        <section class="cartao" aria-labelledby="opmec-sol">
          <h2 id="opmec-sol">{{ t('opme.consumo.solicitadas') }}</h2>
          <p v-if="ctx.solicitacoes.length === 0" class="secundario">
            {{ t('opme.consumo.nenhumaSolicitada') }}
          </p>
          <ul v-else>
            <li v-for="s in ctx.solicitacoes" :key="s.id" :data-testid="`opmec-sol-${s.id}`">
              {{ s.item }} · {{ s.itemNome ?? '—' }} · {{ t(`opme.situacoes.${s.situacao}`) }} ({{
                s.autorizada
              }}/{{ s.consumida }}/{{ s.devolvida }})
              <SanteBotao
                variante="secundario"
                :rotulo="t('opme.consumo.usarSolicitacao')"
                :data-testid="`opmec-usar-${s.id}`"
                @acionar="usar(s)"
              />
            </li>
          </ul>
          <SanteBotao
            variante="secundario"
            :rotulo="t('opme.consumo.semSolicitacao')"
            data-testid="opmec-sem-solicitacao"
            @acionar="usar(null)"
          />
        </section>

        <section class="cartao" aria-labelledby="opmec-form" data-testid="opmec-form">
          <h2 id="opmec-form">{{ t('opme.consumo.registrar') }}</h2>
          <div class="barra">
            <span class="campo">
              <label for="opmec-cod">{{ t('opme.consumo.leitor') }}</label>
              <input
                id="opmec-cod"
                v-model="form.codigo"
                maxlength="120"
                autocomplete="off"
                data-testid="opmec-codigo"
                @keydown.enter.prevent="lerCodigo"
              />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('opme.consumo.lerCodigo')"
              data-testid="opmec-ler"
              @acionar="lerCodigo"
            />
          </div>
          <p v-if="leitura" role="status" data-testid="opmec-leitura">{{ leitura }}</p>
          <div class="barra">
            <span class="campo">
              <label for="opmec-termo">{{ t('opme.consumo.buscarItem') }}</label>
              <input
                id="opmec-termo"
                v-model="termoItem"
                type="search"
                maxlength="60"
                data-testid="opmec-termo"
                @keydown.enter.prevent="buscarItem"
              />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('opme.solicitacoes.buscar')"
              data-testid="opmec-buscar-item"
              @acionar="buscarItem"
            />
            <SanteSelecao
              v-model="form.item"
              :rotulo="t('opme.consumo.item')"
              :opcoes="opcoesItem"
              :busca="true"
              data-testid="opmec-item"
            />
            <span class="campo">
              <label for="opmec-qtd">{{ t('opme.consumo.quantidade') }}</label>
              <input
                id="opmec-qtd"
                v-model.number="form.quantidade"
                type="number"
                min="1"
                data-testid="opmec-qtd"
              />
            </span>
            <SanteSelecao
              v-model="form.local"
              :rotulo="t('opme.consumo.local')"
              :opcoes="ctx.locais.map((l) => ({ valor: l.codigo, rotulo: l.nome }))"
              data-testid="opmec-local"
            />
          </div>
          <div class="barra">
            <span class="campo">
              <label for="opmec-lote">{{ t('opme.consumo.lote') }}</label>
              <input id="opmec-lote" v-model="form.lote" maxlength="30" data-testid="opmec-lote" />
            </span>
            <span class="campo">
              <label for="opmec-serie">{{ t('opme.consumo.serie') }}</label>
              <input id="opmec-serie" v-model="form.serie" maxlength="40" data-testid="opmec-serie" />
            </span>
            <span class="campo">
              <label for="opmec-val">{{ t('opme.consumo.validade') }}</label>
              <input id="opmec-val" v-model="form.validade" type="date" data-testid="opmec-validade" />
            </span>
          </div>
          <div class="barra">
            <span class="campo">
              <label for="opmec-fab">{{ t('opme.consumo.fabricante') }}</label>
              <input id="opmec-fab" v-model="form.fabricante" maxlength="80" data-testid="opmec-fabricante" />
            </span>
            <span class="campo">
              <label for="opmec-mod">{{ t('opme.consumo.modelo') }}</label>
              <input id="opmec-mod" v-model="form.modelo" maxlength="80" data-testid="opmec-modelo" />
            </span>
            <span class="campo">
              <label for="opmec-anvisa">{{ t('opme.consumo.anvisa') }}</label>
              <input
                id="opmec-anvisa"
                v-model="form.anvisa"
                maxlength="20"
                inputmode="numeric"
                data-testid="opmec-anvisa"
              />
            </span>
          </div>
          <template v-if="exigeExcecao">
            <SanteAlerta
              :variante="ctx.podeExcecao ? 'aviso' : 'alerta'"
              :texto="t('opme.consumo.soSupervisor')"
              data-testid="opmec-excecao"
            />
            <span v-if="ctx.podeExcecao" class="campo">
              <label for="opmec-just">{{ t('opme.consumo.justificativa') }}</label>
              <textarea
                id="opmec-just"
                v-model="form.justificativa"
                rows="2"
                maxlength="400"
                data-testid="opmec-justificativa"
              />
            </span>
          </template>
          <SanteBotao
            :rotulo="t('opme.consumo.registrar')"
            :desabilitado="!podeConsumir || enviando || !form.item || (exigeExcecao && !ctx.podeExcecao)"
            data-testid="opmec-registrar"
            @acionar="registrar"
          />
        </section>

        <section v-if="etiqueta" class="cartao" aria-labelledby="opmec-etq" data-testid="opmec-etiqueta">
          <h2 id="opmec-etq">{{ t('opme.consumo.etiqueta') }}</h2>
          <pre class="zpl" tabindex="0" :aria-label="t('opme.consumo.etiqueta')" data-testid="opmec-zpl">{{
            etiqueta.zpl
          }}</pre>
          <SanteBotao variante="secundario" :rotulo="t('opme.consumo.copiar')" @acionar="copiar" />
        </section>

        <section class="cartao" aria-labelledby="opmec-cons">
          <h2 id="opmec-cons">{{ t('opme.consumo.consumos') }}</h2>
          <p v-if="ctx.consumos.length === 0" class="secundario">{{ t('opme.consumo.nenhumConsumo') }}</p>
          <ul v-else>
            <li v-for="c in ctx.consumos" :key="c.id" :data-testid="`opmec-consumo-${c.id}`">
              {{ c.item }} · {{ c.itemNome ?? '—' }} · {{ c.quantidade }} · {{ c.lote ?? c.serie }} ·
              {{ t('opme.consumo.devolvida', { n: c.devolvida }) }}
              <span v-if="c.semAutorizacao" class="alerta">
                · {{ t('opme.consumo.excecao', { por: c.semAutorizacao.por }) }}</span
              >
              <SanteBotao
                variante="secundario"
                :rotulo="t('opme.consumo.reimprimir')"
                @acionar="reimprimir(c.id)"
              />
              <SanteBotao
                v-if="c.devolvida < c.quantidade"
                variante="secundario"
                :rotulo="t('opme.consumo.devolver')"
                :data-testid="`opmec-devolver-${c.id}`"
                @acionar="devolucao.consumo = c.id"
              />
            </li>
          </ul>
          <div v-if="devolucao.consumo !== null" class="barra" data-testid="opmec-devolucao">
            <span class="campo">
              <label for="opmec-qdev">{{ t('opme.consumo.qtdDevolver') }}</label>
              <input
                id="opmec-qdev"
                v-model.number="devolucao.quantidade"
                type="number"
                min="1"
                data-testid="opmec-qtd-dev"
              />
            </span>
            <span class="campo">
              <label for="opmec-mdev">{{ t('opme.consumo.motivoDevolucao') }}</label>
              <input
                id="opmec-mdev"
                v-model="devolucao.motivo"
                maxlength="500"
                data-testid="opmec-motivo-dev"
              />
            </span>
            <SanteBotao
              :rotulo="t('opme.consumo.devolver')"
              :desabilitado="!podeConsumir || enviando"
              data-testid="opmec-confirmar-devolucao"
              @acionar="devolver"
            />
          </div>
        </section>
        <SanteBotao
          variante="secundario"
          :rotulo="t('opme.voltar')"
          @acionar="router.push({ name: 'bloco.opme' })"
        />
      </template>
    </template>
  </section>
</template>
