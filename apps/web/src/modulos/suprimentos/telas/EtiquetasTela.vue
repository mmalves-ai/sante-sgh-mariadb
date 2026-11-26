<script setup lang="ts">
// Etiquetas de identificação do estoque (F3.6, 05-SUP linha 14): `/suprimentos/etiquetas`. O almoxarife escolhe o
// item (busca ou leitura do código da embalagem), o local e o lote (o que vence primeiro vem antes; o vencido não
// aparece), a quantidade que cada etiqueta representa e quantas etiquetas; a tela confere na hora e emite: cada
// etiqueta sai com o identificador próprio, o DataMatrix GS1 e o código de barras, e o arquivo da impressora de
// etiquetas vem pronto para copiar. A reimpressão é registrada com motivo pela impressão padrão.
import type { ItemBusca, LoteSaldo } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  emitirEtiquetas,
  type LeituraCodigo as Leitura,
  type MotivoReimpressao,
  motivosReimpressao,
  reimprimirEtiqueta,
  type ResultadoReimpressao,
  type ResultadoEmissao,
  type TipoEtiqueta,
} from '../api-etiqueta.js';
import { lotesDoLocal } from '../api-suprimentos.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import LeituraCodigo from '../componentes/LeituraCodigo.vue';
import { mensagensEtiqueta as M } from '../i18n-etiqueta.js';
import { numero, usarSuprimentos } from '../usar-suprimentos.js';

const { locais } = usarSuprimentos();
const item = ref<{ codigo: number; nome: string; rastreavel: boolean } | null>(null);
const local = ref('');
const lote = ref('');
const { t } = useI18n();
const lotes = ref<LoteSaldo[]>([]);
const quantidade = ref('1');
const etiquetas = ref('1');
const tipo = ref<TipoEtiqueta>('unidade');
const resultado = ref<ResultadoEmissao | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const copiado = ref(false);

const opcoesLocais = computed(() => [
  { valor: '', rotulo: M.escolha },
  ...(locais.value ?? []).map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesLotes = computed(() => [
  { valor: '', rotulo: item.value?.rastreavel ? M.escolha : M.semLote },
  ...lotes.value
    .filter((l) => l.alerta !== 'vencido' && l.alerta !== 'sem-validade')
    .map((l) => ({
      valor: String(l.id),
      rotulo: `${l.lote} · ${l.validade.split('-').reverse().join('/')}`,
    })),
]);
// O lote migrado sem validade não recebe etiqueta (o DataMatrix leva a validade): a tela diz quais ficaram de fora.
const lotesSemValidade = computed(() =>
  lotes.value.filter((l) => l.alerta === 'sem-validade').map((l) => l.lote),
);
const opcoesTipos = (Object.keys(M.tipos) as TipoEtiqueta[]).map((k) => ({ valor: k, rotulo: M.tipos[k] }));

async function carregarLotes(): Promise<void> {
  lotes.value = item.value && local.value ? await lotesDoLocal(item.value.codigo, Number(local.value)) : [];
}
watch([item, local], async () => {
  lote.value = '';
  await carregarLotes().catch((x) => (erro.value = x));
});

function escolher(i: ItemBusca): void {
  item.value = { codigo: i.codigo, nome: i.nome, rastreavel: i.rastreavel };
  resultado.value = null;
}
async function lido(l: Leitura): Promise<void> {
  escolher({ ...l.item } as ItemBusca);
  await carregarLotes().catch(() => undefined);
  if (l.loteId) lote.value = String(l.loteId);
}

const problemas = computed(() => {
  const p: string[] = [];
  if (!(numero(quantidade.value) > 0)) p.push(M.quantidadeInvalida);
  const n = Number(etiquetas.value);
  if (!Number.isInteger(n) || n < 1 || n > 200) p.push(M.etiquetasInvalidas);
  if (item.value?.rastreavel && !lote.value) p.push(M.loteObrigatorio);
  return p;
});

async function emitir(): Promise<void> {
  if (!item.value || problemas.value.length) return;
  erro.value = null;
  copiado.value = false;
  ocupado.value = true;
  try {
    resultado.value = await emitirEtiquetas({
      insumo: item.value.codigo,
      lote: lote.value ? Number(lote.value) : null,
      local: local.value ? Number(local.value) : null,
      quantidade: numero(quantidade.value),
      etiquetas: Number(etiquetas.value),
      tipo: tipo.value,
    });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function copiar(): Promise<void> {
  if (!resultado.value) return;
  await globalThis.navigator?.clipboard?.writeText(resultado.value.zpl).catch(() => undefined);
  copiado.value = true;
}

// Reimpressão de uma etiqueta emitida: só pelo registro com motivo (e o complemento quando o motivo exige); a via
// seguinte e o arquivo da impressora voltam do servidor.
const motivos = ref<MotivoReimpressao[]>([]);
const reimprimindo = ref<{ id: number; identificador: string } | null>(null);
const motivo = ref('');
const complemento = ref('');
const reimpressa = ref<ResultadoReimpressao | null>(null);
const opcoesMotivos = computed(() => [
  { valor: '', rotulo: M.escolha },
  ...motivos.value.map((m) => ({ valor: String(m.codigo), rotulo: m.descricao })),
]);
const exigeComplemento = computed(
  () => motivos.value.find((m) => String(m.codigo) === motivo.value)?.exigeComplemento ?? false,
);
const complementoCurto = computed(
  () => exigeComplemento.value && complemento.value.replace(/[^\p{L}]/gu, '').length < 5,
);
async function abrirReimpressao(e: { id: number; identificador: string }): Promise<void> {
  erro.value = null;
  reimpressa.value = null;
  motivo.value = '';
  complemento.value = '';
  reimprimindo.value = e;
  if (!motivos.value.length) motivos.value = await motivosReimpressao().catch((x) => ((erro.value = x), []));
}
async function reimprimir(): Promise<void> {
  if (!reimprimindo.value || !motivo.value || complementoCurto.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    reimpressa.value = await reimprimirEtiqueta(reimprimindo.value.id, {
      motivo: Number(motivo.value),
      complemento: complemento.value.trim() || null,
    });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="etiquetas-titulo" data-testid="tela-suprimentos-etiquetas">
    <h1 id="etiquetas-titulo">{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <form class="painel" @submit.prevent="emitir">
      <LeituraCodigo testid="etq-leitura" @lido="lido" />
      <BuscaItem :rotulo="M.item" testid="etq-busca" @escolher="escolher" />
      <p v-if="item" data-testid="etq-item">{{ M.item }}: {{ item.codigo }} · {{ item.nome }}</p>
      <div class="filtros">
        <SanteSelecao v-model="local" :rotulo="M.local" :opcoes="opcoesLocais" data-testid="etq-local" />
        <SanteSelecao v-model="lote" :rotulo="M.lote" :opcoes="opcoesLotes" data-testid="etq-lote" />
        <p v-if="lotesSemValidade.length" class="secundario" data-testid="etq-sem-validade">
          {{ lotesSemValidade.join(', ') }}: {{ t('suprimentos.alertas.semValidade') }}
        </p>
        <SanteSelecao v-model="tipo" :rotulo="M.tipo" :opcoes="opcoesTipos" data-testid="etq-tipo" />
        <span class="campo">
          <label for="etq-quantidade">{{ M.quantidade }}</label>
          <input id="etq-quantidade" v-model="quantidade" inputmode="decimal" data-testid="etq-quantidade" />
        </span>
        <span class="campo">
          <label for="etq-etiquetas">{{ M.etiquetas }}</label>
          <input id="etq-etiquetas" v-model="etiquetas" inputmode="numeric" data-testid="etq-etiquetas" />
        </span>
      </div>
      <p v-for="p in item ? problemas : []" :key="p" role="alert" data-testid="etq-problema">{{ p }}</p>
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="M.emitir"
          :desabilitado="ocupado || !item || problemas.length > 0"
          data-testid="etq-emitir"
        />
      </div>
    </form>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <template v-if="resultado">
      <table class="tabela" data-testid="etq-emitidas">
        <caption>
          {{
            M.emitidas
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ M.identificador }}</th>
            <th scope="col">{{ M.conteudo }}</th>
            <th scope="col">{{ M.reimprimir }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in resultado.etiquetas" :key="e.id" :data-testid="`etq-${e.identificador}`">
            <td>{{ e.identificador }}</td>
            <td>{{ e.legivel }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="M.reimprimir"
                :data-testid="`etq-reimprimir-${e.identificador}`"
                @acionar="abrirReimpressao(e)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p class="secundario">{{ M.reimpressao }}</p>
      <div class="acoes">
        <SanteBotao variante="secundario" :rotulo="M.copiar" data-testid="etq-copiar" @acionar="copiar" />
      </div>
      <p v-if="copiado" role="status">{{ M.copiado }}</p>
      <pre class="zpl" tabindex="0" :aria-label="M.zpl" data-testid="etq-zpl">{{ resultado.zpl }}</pre>
      <form v-if="reimprimindo" class="painel" data-testid="etq-reimpressao" @submit.prevent="reimprimir">
        <h2>{{ M.reimpressaoTitulo }}: {{ reimprimindo.identificador }}</h2>
        <SanteSelecao v-model="motivo" :rotulo="M.motivo" :opcoes="opcoesMotivos" data-testid="etq-motivo" />
        <span v-if="exigeComplemento" class="campo">
          <label for="etq-complemento">{{ M.complemento }}</label>
          <input id="etq-complemento" v-model="complemento" maxlength="500" data-testid="etq-complemento" />
        </span>
        <p v-if="complementoCurto" role="alert" data-testid="etq-complemento-curto">
          {{ M.complementoCurto }}
        </p>
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="M.confirmarReimpressao"
            :desabilitado="ocupado || !motivo || complementoCurto"
            data-testid="etq-confirmar-reimpressao"
          />
        </div>
        <template v-if="reimpressa">
          <p role="status" data-testid="etq-reimpressa">{{ M.reimpressa }} {{ reimpressa.via }}</p>
          <pre class="zpl" tabindex="0" :aria-label="M.zpl" data-testid="etq-zpl-reimpressao">{{
            reimpressa.zpl
          }}</pre>
        </template>
      </form>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
