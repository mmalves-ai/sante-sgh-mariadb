<script setup lang="ts">
// Inventário, balanço e estoque inicial (ficha do M28, seção 7; regra 14): `/suprimentos/inventarios`. Abre o
// inventário geral ou cíclico (por curva) do local; a contagem é cega (sem o saldo; serve no celular, sem modo
// offline); a divergência acima do limite do parâmetro pede recontagem; o supervisor vê o saldo e a divergência,
// aprova ou cancela; o ajuste aprovado vira o balanço (P2: desligado até a receita ser provada, POL-3). O estoque
// inicial e os lotes de abertura ficam em consulta.
import type { InventarioLido } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirInventario,
  decidirInventario,
  gravarBalanco,
  lerInventario,
  listarEstoqueInicial,
  listarInventarios,
  novaChave,
  registrarContagem,
} from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { chaveDoc, data, numero, qtd, quando, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { locaisDoTipo, nomeLocal, pode, motivo, motivoFuncionalidade } = usarSuprimentos();
const lista = useQuery({ queryKey: ['suprimentos', 'inventarios'], queryFn: () => listarInventarios() });
const inicial = useQuery({
  queryKey: ['suprimentos', 'estoque-inicial'],
  queryFn: () => listarEstoqueInicial(),
});
const local = ref('');
const tipo = ref<'geral' | 'ciclico'>('geral');
const curva = ref('');
const aberto = ref<InventarioLido | null>(null);
const contagens = ref<Record<number, string>>({});
const justificativa = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locaisDoTipo('I').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesTipo = computed(() => [
  { valor: 'geral', rotulo: t('suprimentos.inventarios.geral') },
  { valor: 'ciclico', rotulo: t('suprimentos.inventarios.ciclico') },
]);
const opcoesCurva = [
  { valor: '', rotulo: '—' },
  { valor: 'A', rotulo: 'A' },
  { valor: 'B', rotulo: 'B' },
  { valor: 'C', rotulo: 'C' },
];
async function acao(f: () => Promise<{ mensagem: string }>, depois?: () => Promise<void>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await f()).mensagem;
    if (depois) await depois();
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'inventarios'] });
  } catch (x) {
    erro.value = x;
  }
}
async function abrir(id: number): Promise<void> {
  erro.value = null;
  try {
    aberto.value = await lerInventario(id);
    contagens.value = {};
  } catch (x) {
    erro.value = x;
  }
}
const novo = () =>
  acao(() =>
    abrirInventario(
      {
        local: Number(local.value),
        tipo: tipo.value,
        ...(tipo.value === 'ciclico' && curva.value ? { curva: curva.value } : {}),
      },
      novaChave('inventario'),
    ),
  );
const contar = (item: number) =>
  acao(
    () =>
      registrarContagem(
        aberto.value!.id,
        { item, quantidade: numero(contagens.value[item] ?? '') },
        novaChave('contagem'),
      ),
    () => abrir(aberto.value!.id),
  );
const decidir = (decisao: 'aprovado' | 'cancelado') =>
  acao(
    () =>
      decidirInventario(
        aberto.value!.id,
        { decisao, justificativa: justificativa.value.trim() },
        novaChave('decisao'),
      ),
    () => abrir(aberto.value!.id),
  );
const balanco = () =>
  acao(
    () => gravarBalanco(aberto.value!.id, novaChave('balanco')),
    () => abrir(aberto.value!.id),
  );
const SIT: Record<string, string> = {
  pendente: 'Pendente',
  ok: 'Conferido',
  recontar: 'Recontar',
  'divergente-confirmado': 'Divergência confirmada',
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="inv-titulo" data-testid="tela-suprimentos-inventarios">
    <h1 id="inv-titulo">{{ t('suprimentos.inventarios.titulo') }}</h1>
    <p>{{ t('suprimentos.inventarios.texto') }}</p>
    <AvisoSuprimentos :motivo="motivoFuncionalidade('suprimentos.inventario')" />
    <form class="painel filtros" data-testid="inv-novo" @submit.prevent="novo">
      <SanteSelecao
        v-model="local"
        :rotulo="t('suprimentos.local')"
        :opcoes="opcoesLocais"
        data-testid="inv-local"
      />
      <SanteSelecao v-model="tipo" :rotulo="t('suprimentos.inventarios.tipo')" :opcoes="opcoesTipo" />
      <SanteSelecao
        v-if="tipo === 'ciclico'"
        v-model="curva"
        :rotulo="t('suprimentos.inventarios.curva')"
        :opcoes="opcoesCurva"
      />
      <SanteBotao
        tipo="submit"
        :rotulo="t('suprimentos.inventarios.abrir')"
        :desabilitado="!local"
        data-testid="inv-abrir"
      />
    </form>
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <ul v-else-if="lista.data.value" data-testid="inv-lista">
      <li v-for="i in lista.data.value" :key="i.id">
        <SanteBotao
          variante="texto"
          :rotulo="`${t('suprimentos.inventarios.numero', { n: i.id })} · ${nomeLocal(i.local)} · ${i.tipo} · ${i.situacao} · ${quando(i.abertoEm)}`"
          :data-testid="`inv-${i.id}`"
          @acionar="abrir(i.id)"
        />
      </li>
    </ul>
    <div v-if="aberto" class="painel" data-testid="inv-aberto">
      <h2>
        {{ t('suprimentos.inventarios.numero', { n: aberto.id }) }} · {{ aberto.localNome }} ·
        {{ aberto.situacao }}
      </h2>
      <p class="secundario">
        {{ t('suprimentos.inventarios.limite', { n: aberto.limitePct }) }} · {{ aberto.abertoPor }} ·
        {{ quando(aberto.abertoEm) }}
      </p>
      <table class="tabela">
        <caption>
          {{
            t('suprimentos.inventarios.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.inventarios.contado') }}</th>
            <th v-if="aberto.itens.some((i) => i.saldo !== null)" scope="col">
              {{ t('suprimentos.saldo') }}
            </th>
            <th v-if="aberto.itens.some((i) => i.saldo !== null)" scope="col">
              {{ t('suprimentos.inventarios.diferenca') }}
            </th>
            <th scope="col">{{ t('suprimentos.inventarios.situacao') }}</th>
            <th scope="col">{{ t('suprimentos.inventarios.contar') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in aberto.itens" :key="i.item" :data-testid="`inv-item-${i.item}`">
            <td>{{ i.item }} · {{ i.nome }}</td>
            <td>{{ i.contado === null ? '—' : qtd(i.contado) }} ({{ i.contagens }})</td>
            <td v-if="aberto.itens.some((x) => x.saldo !== null)">
              {{ i.saldo === null ? '—' : qtd(i.saldo) }}
            </td>
            <td v-if="aberto.itens.some((x) => x.saldo !== null)">
              {{ i.diferenca === null ? '—' : qtd(i.diferenca)
              }}<template v-if="i.divergenciaPct !== null"> ({{ i.divergenciaPct }}%)</template>
            </td>
            <td>{{ SIT[i.situacao] ?? i.situacao }}</td>
            <td>
              <template
                v-if="
                  aberto.situacao === 'aberto' ||
                  aberto.situacao === 'contagem' ||
                  aberto.situacao === 'recontagem'
                "
              >
                <label :for="`inv-c-${i.item}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.inventarios.contado')
                }}</label>
                <input
                  :id="`inv-c-${i.item}`"
                  v-model="contagens[i.item]"
                  inputmode="decimal"
                  size="6"
                  :data-testid="`inv-contagem-${i.item}`"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('suprimentos.gravar')"
                  :data-testid="`inv-gravar-${i.item}`"
                  @acionar="contar(i.item)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="aberto.situacao !== 'aprovado' && aberto.situacao !== 'cancelado'">
        <span class="campo">
          <label for="inv-just">{{ t('suprimentos.cotacao.justificativa') }}</label>
          <input id="inv-just" v-model="justificativa" />
        </span>
        <div class="filtros">
          <SanteBotao
            :rotulo="t('suprimentos.inventarios.aprovar')"
            data-testid="inv-aprovar"
            @acionar="decidir('aprovado')"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('suprimentos.cancelar')"
            @acionar="decidir('cancelado')"
          />
        </div>
      </template>
      <template v-if="aberto.situacao === 'aprovado' && !aberto.balanco">
        <AvisoSuprimentos
          :motivo="pode('suprimentos.registrarBalanco') ? null : motivo('suprimentos.registrarBalanco')"
        />
        <SanteBotao
          v-if="pode('suprimentos.registrarBalanco')"
          :rotulo="t('suprimentos.inventarios.balanco')"
          @acionar="balanco"
        />
      </template>
      <p v-if="aberto.balanco">
        {{ t('suprimentos.inventarios.balancoGravado') }} {{ chaveDoc(aberto.balanco) }}
      </p>
    </div>
    <p v-if="mensagem" role="status" data-testid="inv-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <h2>{{ t('suprimentos.inventarios.inicial') }}</h2>
    <ul v-if="inicial.data.value">
      <li v-for="e in inicial.data.value" :key="`${e.doc}-${e.local}`">
        {{ t('suprimentos.documento') }} {{ e.doc }} · {{ data(e.data) }} · {{ nomeLocal(e.local) }} ·
        {{ t('suprimentos.inventarios.nItens', { n: e.itens }) }}
      </li>
    </ul>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
