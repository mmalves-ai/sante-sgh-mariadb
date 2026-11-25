<script setup lang="ts">
// Os itens de um documento de saída ou de transferência: o item (busca), a quantidade e, no item rastreável, os lotes
// do local (a sugestão do que vence primeiro; o lote vencido não sai) com a quantidade de cada um. No item controlado,
// o prescritor (vínculo). A soma por lote tem de ser a quantidade (o servidor confere de novo).
import type { ItemBusca } from '@sgh/contratos';
import { sugerirLotes } from '@sgh/dominio-suprimentos';
import { SanteBotao } from '@sgh/ui';
import { useI18n } from 'vue-i18n';
import { lotesDoLocal } from '../api-suprimentos.js';
import { data, numero } from '../usar-suprimentos.js';
import type { LeituraCodigo as Leitura } from '../api-etiqueta.js';
import BuscaItem from './BuscaItem.vue';
import LeituraCodigo from './LeituraCodigo.vue';
import type { LinhaItem } from './linhas.js';

const props = defineProps<{ local: number | null; controlado?: boolean; testid?: string }>();
const linhas = defineModel<LinhaItem[]>({ required: true });
const { t } = useI18n();
const tid = (s: string) => `${props.testid ?? 'itens'}-${s}`;

async function incluir(i: ItemBusca): Promise<void> {
  if (linhas.value.some((l) => l.item === i.codigo)) return;
  const disponiveis = i.rastreavel && props.local ? await lotesDoLocal(i.codigo, props.local) : [];
  linhas.value = [
    ...linhas.value,
    {
      item: i.codigo,
      nome: i.nome,
      rastreavel: i.rastreavel,
      controlado: i.controlado,
      quantidade: '',
      disponiveis,
      lotes: {},
      prescritor: '',
    },
  ];
}
/** A leitura do código: inclui o item, soma a quantidade lida e, com lote, a põe no lote; guarda a etiqueta lida. */
async function lido(r: Leitura): Promise<void> {
  await incluir({ ...r.item } as ItemBusca);
  const l = linhas.value.find((x) => x.item === r.item.codigo);
  if (!l) return;
  if (r.identificador) {
    if (l.etiquetas?.includes(r.identificador)) return;
    l.etiquetas = [...(l.etiquetas ?? []), r.identificador];
  }
  l.quantidade = String((numero(l.quantidade) || 0) + r.quantidade);
  const d = l.disponiveis.find((x) => x.lote === r.lote && (!r.validade || x.validade === r.validade));
  if (d) l.lotes = { ...l.lotes, [d.id]: String((numero(l.lotes[d.id] ?? '') || 0) + r.quantidade) };
}
function retirar(item: number): void {
  linhas.value = linhas.value.filter((l) => l.item !== item);
}
function sugerir(l: LinhaItem): void {
  const hoje = new Date().toISOString().slice(0, 10);
  const s = sugerirLotes(
    l.disponiveis.map((d) => ({ id: d.id, lote: d.lote, validade: d.validade, saldo: d.quantidade })),
    numero(l.quantidade) || 0,
    hoje,
  );
  l.lotes = Object.fromEntries(
    l.disponiveis.map((d) => [
      d.id,
      String(s.find((x) => x.lote === d.lote && x.validade === d.validade)?.quantidade ?? ''),
    ]),
  );
}
</script>

<template>
  <LeituraCodigo :testid="tid('leitura')" @lido="lido" />
  <BuscaItem :testid="tid('busca')" @escolher="incluir" />
  <table v-if="linhas.length" class="tabela" :data-testid="tid('tabela')">
    <caption>
      {{
        t('suprimentos.itens')
      }}
    </caption>
    <thead>
      <tr>
        <th scope="col">{{ t('suprimentos.item') }}</th>
        <th scope="col">{{ t('suprimentos.quantidade') }}</th>
        <th scope="col">{{ t('suprimentos.lotes') }}</th>
        <th scope="col">{{ t('suprimentos.acoes') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="l in linhas" :key="l.item" :data-testid="tid(`linha-${l.item}`)">
        <td>
          {{ l.item }} · {{ l.nome }}
          <span v-if="l.controlado" class="secundario"> · {{ t('suprimentos.controlado') }}</span>
        </td>
        <td>
          <span class="campo">
            <label :for="`${tid('qtde')}-${l.item}`" class="sgh-visualmente-oculto">{{
              t('suprimentos.quantidade')
            }}</label>
            <input
              :id="`${tid('qtde')}-${l.item}`"
              v-model="l.quantidade"
              inputmode="decimal"
              :data-testid="tid(`qtde-${l.item}`)"
            />
          </span>
          <span v-if="l.controlado" class="campo">
            <label :for="`${tid('presc')}-${l.item}`">{{ t('suprimentos.prescritor') }}</label>
            <input
              :id="`${tid('presc')}-${l.item}`"
              v-model="l.prescritor"
              inputmode="numeric"
              :data-testid="tid(`prescritor-${l.item}`)"
            />
          </span>
        </td>
        <td>
          <template v-if="l.rastreavel">
            <p v-if="l.disponiveis.length === 0">{{ t('suprimentos.semLote') }}</p>
            <div v-for="d in l.disponiveis" :key="d.id" class="campo">
              <label :for="`${tid('lote')}-${d.id}`">
                {{ d.lote }} · {{ data(d.validade) }} · {{ t('suprimentos.saldo') }} {{ d.quantidade }}
                <strong v-if="d.alerta === 'vencido'"> · {{ t('suprimentos.alertas.vencido') }}</strong>
                <span v-else-if="d.alerta === 'vence'"> · {{ t('suprimentos.alertas.vence') }}</span>
              </label>
              <input
                :id="`${tid('lote')}-${d.id}`"
                v-model="l.lotes[d.id]"
                inputmode="decimal"
                :disabled="d.alerta === 'vencido'"
                :data-testid="tid(`lote-${l.item}-${d.lote}`)"
              />
            </div>
            <SanteBotao
              v-if="l.disponiveis.length"
              variante="texto"
              :rotulo="t('suprimentos.sugerirLotes')"
              :data-testid="tid(`sugerir-${l.item}`)"
              @acionar="sugerir(l)"
            />
          </template>
          <span v-else>—</span>
        </td>
        <td>
          <SanteBotao variante="texto" :rotulo="t('suprimentos.retirar')" @acionar="retirar(l.item)" />
        </td>
      </tr>
    </tbody>
  </table>
</template>
