<script setup lang="ts">
// Equipe, kits e transferência da conta (F3.7, 06-FAT linhas 14, 15 e 16): `/faturamento/contas/:id/movimentos`.
// Uma tela só por conta: a lista de itens com a equipe de cada um (editada no lugar, com o valor previsto do ato), o
// kit lançado de uma vez e os itens marcados na lista transferidos para outra conta do paciente. A validação do domínio
// roda enquanto se escolhe; o servidor confere de novo e as recusas aparecem com o texto dele.
import { calcularEquipeItem, validarEquipeItem, type FuncaoEquipe } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarProfissionais,
  gravarEquipe,
  type ItemConta,
  lancarKit,
  lerMovimentos,
  type ParticipantePedido,
  transferirItens,
} from '../api-movimentos.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const conta = computed(() => Number(props.id));
const qc = useQueryClient();
const q = useQuery({
  queryKey: ['faturamento', 'movimentos', conta],
  queryFn: () => lerMovimentos(conta.value),
});
const erro = ref<unknown>(null);
const aviso = ref('');
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const chave = () => crypto.randomUUID();
async function rodar(fn: () => Promise<Record<string, unknown>>) {
  erro.value = null;
  aviso.value = '';
  try {
    const r = await fn();
    const semPreco = Number(r['semPreco'] ?? 0);
    aviso.value = semPreco > 0 ? t('movimentosConta.semPreco', { n: semPreco }) : t('movimentosConta.feito');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'movimentos'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── Equipe do item ──
const FORMAS = ['via_hospital', 'direto_fonte_pagadora', 'paciente', 'sem_cobranca'] as const;
const emEdicao = ref<ItemConta | null>(null);
const equipe = ref<ParticipantePedido[]>([]);
function editarEquipe(i: ItemConta) {
  emEdicao.value = i;
  // Recarrega o que está gravado (grau e percentual inclusive): salvar de novo não volta nada ao padrão em silêncio.
  equipe.value = i.equipe.map((p) => ({
    profissionalId: p.profissionalId,
    funcaoId: p.funcaoId,
    grauId: p.grauId,
    percentual: p.percentual,
    formaPagamento: p.formaPagamento,
  }));
  encontrados.value = i.equipe.map((p) => ({ id: p.profissionalId, nome: p.nome, inscricao: '' }));
}
// Profissional por nome ou número da inscrição no conselho (além dos sugeridos da conta).
const busca = ref('');
const encontrados = ref<{ id: number; nome: string; inscricao: string }[]>([]);
async function buscar() {
  if (busca.value.trim().length < 3) return;
  try {
    const r = await buscarProfissionais(busca.value.trim());
    const ja = new Set(encontrados.value.map((p) => p.id));
    encontrados.value = [...encontrados.value, ...r.filter((p) => !ja.has(p.id))];
    aviso.value = r.length ? '' : t('movimentosConta.nenhumProfissional');
  } catch (e) {
    erro.value = e;
  }
}
const opcoesProfissional = computed(() => {
  const m = new Map<number, string>();
  for (const p of q.data.value?.profissionais ?? []) m.set(p.id, p.nome);
  for (const p of encontrados.value) m.set(p.id, p.inscricao ? `${p.nome} · ${p.inscricao}` : p.nome);
  return [...m].map(([id, nome]) => ({ id, nome }));
});
const funcoesMapa = computed(
  () =>
    new Map<number, FuncaoEquipe>(
      (q.data.value?.funcoes ?? []).map((f) => [
        f.id,
        {
          id: f.id,
          tipo: f.tipo,
          ativo: f.ativo,
          percentual: f.percentual,
          grau: f.grau,
          ordemAuxiliar: f.ordemAuxiliar,
          ordemApresentacao: f.ordemApresentacao,
        },
      ]),
    ),
);
const informados = computed(() =>
  equipe.value
    .filter((p) => p.profissionalId > 0 && p.funcaoId > 0)
    .map((p) => ({
      profissional: p.profissionalId,
      funcao: p.funcaoId,
      grau: p.grauId ?? null,
      percentual: p.percentual ?? null,
      formaPagamento: (p.formaPagamento ?? 'via_hospital') as (typeof FORMAS)[number],
    })),
);
const errosEquipe = computed(() => validarEquipeItem(informados.value, funcoesMapa.value));
const previsto = computed(() =>
  emEdicao.value ? calcularEquipeItem(informados.value, funcoesMapa.value, emEdicao.value.honorario) : [],
);
const previstoDe = (p: ParticipantePedido) =>
  previsto.value.find((x) => x.profissional === p.profissionalId && x.funcao === p.funcaoId)?.valorAto ?? 0;
async function salvarEquipe() {
  const i = emEdicao.value;
  if (!i || Object.keys(errosEquipe.value).length) return;
  if (
    await rodar(() =>
      gravarEquipe(
        i.id,
        equipe.value.filter((p) => p.profissionalId > 0 && p.funcaoId > 0),
        chave(),
      ),
    )
  )
    emEdicao.value = null;
}

// ── Kit ──
const kit = reactive({ id: 0, vezes: 1 });
async function lancar() {
  if (
    kit.id > 0 &&
    kit.vezes > 0 &&
    (await rodar(() => lancarKit(conta.value, kit.id, kit.vezes, chave())))
  ) {
    kit.id = 0;
    kit.vezes = 1;
  }
}

// ── Transferência ──
const marcados = ref<number[]>([]);
const transf = reactive({ destino: 0, motivo: '' });
const transferivel = (i: ItemConta) => i.situacao === 'lancado' || i.situacao === 'conferido';
const podeTransferir = computed(
  () => transf.destino > 0 && marcados.value.length > 0 && transf.motivo.trim().length >= 5,
);
async function transferir() {
  if (!podeTransferir.value) return;
  const corpo = { contaDestinoId: transf.destino, itens: [...marcados.value], motivo: transf.motivo.trim() };
  if (await rodar(() => transferirItens(conta.value, corpo, chave()))) {
    marcados.value = [];
    transf.motivo = '';
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mov-titulo" data-testid="tela-movimentos-conta">
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('movimentosConta.carregando') }}</p>
    <template v-else>
      <h1 id="mov-titulo">{{ t('movimentosConta.titulo', { numero: q.data.value.numero }) }}</h1>
      <p v-if="!q.data.value.editavel" role="note">{{ t('movimentosConta.fechada') }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <p v-if="aviso" role="status" data-testid="mov-aviso">{{ aviso }}</p>

      <h2>{{ t('movimentosConta.itens') }}</h2>
      <table class="tabela" data-testid="mov-itens">
        <thead>
          <tr>
            <th scope="col">
              <span class="sr-only">{{ t('movimentosConta.transferir') }}</span>
            </th>
            <th scope="col">{{ t('movimentosConta.item') }}</th>
            <th scope="col">{{ t('movimentosConta.quantidade') }}</th>
            <th scope="col">{{ t('movimentosConta.valor') }}</th>
            <th scope="col">{{ t('movimentosConta.situacao') }}</th>
            <th scope="col">{{ t('movimentosConta.equipe') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in q.data.value.itens" :key="i.id" :data-testid="`mov-item-${i.sequencia}`">
            <td>
              <input
                v-if="q.data.value.editavel && transferivel(i)"
                v-model="marcados"
                type="checkbox"
                :value="i.id"
                :aria-label="`${t('movimentosConta.transferir')} ${i.codigo}`"
              />
            </td>
            <td>{{ i.codigo }} · {{ i.descricao }}</td>
            <td>{{ i.quantidade }}</td>
            <td>{{ moeda(i.valorTotal) }}</td>
            <td>{{ i.situacao }}</td>
            <td>
              <span v-if="!i.equipe.length" class="secundario">{{ t('movimentosConta.semEquipe') }}</span>
              <span v-for="p in i.equipe" :key="p.sequencia"
                >{{ p.sequencia }}. {{ p.nome }} ({{ moeda(p.valorAto) }})
              </span>
              <button
                v-if="q.data.value.editavel && transferivel(i)"
                type="button"
                :data-testid="`mov-equipe-${i.sequencia}`"
                @click="editarEquipe(i)"
              >
                {{ t('movimentosConta.editarEquipe') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="emEdicao" class="filtros" data-testid="mov-form-equipe" @submit.prevent="salvarEquipe">
        <h2>{{ t('movimentosConta.equipeDe', { item: emEdicao.codigo }) }}</h2>
        <label>
          {{ t('movimentosConta.buscarProfissional') }}
          <input
            v-model="busca"
            type="search"
            minlength="3"
            data-testid="mov-busca-profissional"
            @keydown.enter.prevent="buscar"
          />
        </label>
        <button type="button" data-testid="mov-buscar" @click="buscar">
          {{ t('movimentosConta.buscar') }}
        </button>
        <fieldset v-for="(p, k) in equipe" :key="k" :data-testid="`mov-participante-${k}`">
          <label>
            {{ t('movimentosConta.profissional') }}
            <select v-model.number="p.profissionalId" required :data-testid="`mov-profissional-${k}`">
              <option :value="0" disabled>{{ t('movimentosConta.escolhaProfissional') }}</option>
              <option v-for="o in opcoesProfissional" :key="o.id" :value="o.id">{{ o.nome }}</option>
            </select>
          </label>
          <label>
            {{ t('movimentosConta.funcao') }}
            <select v-model.number="p.funcaoId" required>
              <option v-for="f in q.data.value.funcoes" :key="f.id" :value="f.id">{{ f.descricao }}</option>
            </select>
          </label>
          <label>
            {{ t('movimentosConta.grau') }}
            <select v-model="p.grauId" :data-testid="`mov-grau-${k}`">
              <option :value="null">{{ t('movimentosConta.grauDaFuncao') }}</option>
              <option v-for="g in q.data.value.graus" :key="g.id" :value="g.id">
                {{ g.codigo }} · {{ g.descricao }}
              </option>
            </select>
          </label>
          <label>
            {{ t('movimentosConta.percentual') }}
            <input
              :value="p.percentual ?? ''"
              type="number"
              min="0"
              max="100"
              step="0.01"
              :placeholder="t('movimentosConta.percentualDaFuncao')"
              :data-testid="`mov-percentual-${k}`"
              @input="
                p.percentual =
                  ($event.target as HTMLInputElement).value === ''
                    ? null
                    : Number(($event.target as HTMLInputElement).value)
              "
            />
          </label>
          <label>
            {{ t('movimentosConta.formaPagamento') }}
            <select v-model="p.formaPagamento">
              <option v-for="f in FORMAS" :key="f" :value="f">{{ t(`movimentosConta.formas.${f}`) }}</option>
            </select>
          </label>
          <span class="secundario">{{ t('movimentosConta.valorAto', { valor: moeda(previstoDe(p)) }) }}</span>
          <span
            v-if="
              errosEquipe[`participantes.${k}.funcao`] ||
              errosEquipe[`participantes.${k}.profissional`] ||
              errosEquipe[`participantes.${k}.percentual`]
            "
            role="alert"
            :data-testid="`mov-erro-${k}`"
          >
            {{
              errosEquipe[`participantes.${k}.funcao`] ??
              errosEquipe[`participantes.${k}.profissional`] ??
              errosEquipe[`participantes.${k}.percentual`]
            }}
          </span>
          <button type="button" @click="equipe.splice(k, 1)">{{ t('movimentosConta.retirar') }}</button>
        </fieldset>
        <button
          type="button"
          data-testid="mov-incluir"
          @click="
            equipe.push({
              profissionalId: 0,
              funcaoId: 0,
              grauId: null,
              percentual: null,
              formaPagamento: 'via_hospital',
            })
          "
        >
          {{ t('movimentosConta.incluir') }}
        </button>
        <button type="submit" :disabled="Object.keys(errosEquipe).length > 0" data-testid="mov-salvar-equipe">
          {{ t('movimentosConta.salvarEquipe') }}
        </button>
      </form>

      <template v-if="q.data.value.editavel">
        <h2>{{ t('movimentosConta.kit') }}</h2>
        <p v-if="!q.data.value.kits.length" class="secundario">{{ t('movimentosConta.semKit') }}</p>
        <form v-else class="filtros" data-testid="mov-form-kit" @submit.prevent="lancar">
          <label>
            {{ t('movimentosConta.escolhaKit') }}
            <select v-model.number="kit.id" required data-testid="mov-kit">
              <option v-for="k in q.data.value.kits" :key="k.id" :value="k.id">
                {{ k.codigo }} · {{ k.descricao }} ({{ t(`movimentosConta.modo.${k.modo}`) }})
              </option>
            </select>
          </label>
          <label>
            {{ t('movimentosConta.vezes') }}
            <input v-model.number="kit.vezes" type="number" min="1" step="1" required />
          </label>
          <button type="submit" :disabled="kit.id === 0" data-testid="mov-lancar-kit">
            {{ t('movimentosConta.lancarKit') }}
          </button>
        </form>

        <h2>{{ t('movimentosConta.transferir') }}</h2>
        <form class="filtros" data-testid="mov-form-transferir" @submit.prevent="transferir">
          <label>
            {{ t('movimentosConta.destino') }}
            <select v-model.number="transf.destino" required data-testid="mov-destino">
              <option :value="0" disabled>{{ t('movimentosConta.escolhaDestino') }}</option>
              <option v-for="d in q.data.value.destinos" :key="d.id" :value="d.id" :disabled="!d.aberta">
                {{ d.numero }} · {{ d.fonte
                }}{{ d.outroEstabelecimento ? ` (${t('movimentosConta.outroEstab')})` : '' }}
              </option>
            </select>
          </label>
          <label>
            {{ t('movimentosConta.motivo') }}
            <input v-model="transf.motivo" minlength="5" maxlength="500" required data-testid="mov-motivo" />
          </label>
          <p v-if="!marcados.length" class="secundario">{{ t('movimentosConta.marcarItens') }}</p>
          <button type="submit" :disabled="!podeTransferir" data-testid="mov-transferir">
            {{ t('movimentosConta.transferirAgora', { n: marcados.length }) }}
          </button>
        </form>
      </template>

      <template v-if="q.data.value.transferencias.length">
        <h2>{{ t('movimentosConta.historico') }}</h2>
        <ul data-testid="mov-historico">
          <li v-for="x in q.data.value.transferencias" :key="x.id">
            {{ x.numero }} · {{ x.em.slice(0, 16).replace('T', ' ') }} ·
            {{
              x.saiu
                ? t('movimentosConta.saiu', { conta: x.outraConta })
                : t('movimentosConta.entrou', { conta: x.outraConta })
            }}
            ({{ t(`movimentosConta.tipos.${x.tipo}`) }}) · {{ x.itens }} · {{ moeda(x.valorOrigem) }}
            {{ t('movimentosConta.seta') }} {{ moeda(x.valorDestino) }} ·
            {{ x.motivo }}
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
