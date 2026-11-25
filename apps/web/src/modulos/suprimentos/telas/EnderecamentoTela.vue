<script setup lang="ts">
// Endereçamento do armazém (F8, 05-SUP linha 4): `/suprimentos/enderecamento`. Escolhe o local e vê a árvore de
// endereços na ordem do caminho, com os itens de cada um. Criar endereço numa linha só (dentro de, tipo, código com o
// endereço completo mostrado enquanto digita); no endereço escolhido: bloquear, inativar, ligar item (busca por código
// ou nome, preferencial já marcado quando o item ainda não tem endereço no local), tornar preferencial e retirar.
import {
  CODIGO_NIVEL_ENDERECO,
  TIPOS_NIVEL_ENDERECO,
  type TipoNivelEndereco,
} from '@sgh/contratos/regras-suprimentos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarEndereco,
  buscarItensEnderecamento,
  criarEndereco,
  type EnderecoArmazem,
  fichaEnderecamento,
  locaisEnderecamento,
  type OpcaoEnderecamento,
  retirarVinculo,
  tornarPreferencial,
  vincularItemEndereco,
} from '../api-enderecamento.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensEnderecamento as M } from '../i18n-enderecamento.js';

const fmt = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_x, k: string) => String(v[k] ?? ''));
const podeEditar = computed(() => pode('suprimentos.local.editar'));
const cliente = useQueryClient();
const local = ref<number | null>(null);
const locais = useQuery({
  queryKey: ['suprimentos', 'enderecamento', 'locais'],
  queryFn: locaisEnderecamento,
});
const ficha = useQuery({
  queryKey: computed(() => ['suprimentos', 'enderecamento', 'ficha', local.value]),
  queryFn: () => fichaEnderecamento(local.value as number),
  enabled: computed(() => (local.value ?? 0) > 0),
});
const enderecos = computed<readonly EnderecoArmazem[]>(() => ficha.data.value?.enderecos ?? []);
const escolhidoId = ref<number | null>(null);
const escolhido = computed(() => enderecos.value.find((e) => e.id === escolhidoId.value) ?? null);
const aviso = ref('');

// ------------------------------------------------ novo endereço
const novo = ref<{
  superior: number | null;
  tipoNivel: TipoNivelEndereco;
  codigo: string;
  descricao: string;
  capacidade: number | null;
}>({ superior: null, tipoNivel: 'area', codigo: '', descricao: '', capacidade: null });
const codigoNovo = computed(() => novo.value.codigo.trim().toUpperCase());
const codigoValido = computed(() => CODIGO_NIVEL_ENDERECO.test(codigoNovo.value));
const completoNovo = computed(() => {
  const s = enderecos.value.find((e) => e.id === novo.value.superior);
  return s ? `${s.codigoCompleto}-${codigoNovo.value}` : codigoNovo.value;
});
const opcoesSuperior = computed(() => [
  { valor: null as number | null, rotulo: M.primeiroNivel },
  ...enderecos.value
    .filter((e) => e.ativo && e.nivel < 8)
    .map((e) => ({ valor: e.id as number | null, rotulo: e.codigoCompleto })),
]);
const opcoesTipo = TIPOS_NIVEL_ENDERECO.map((x) => ({ valor: x, rotulo: M.tipos[x] }));
const recarregar = () =>
  cliente.invalidateQueries({ queryKey: ['suprimentos', 'enderecamento', 'ficha', local.value] });

const criacao = useMutation({
  mutationFn: () =>
    criarEndereco({
      local: local.value as number,
      superior: novo.value.superior,
      tipoNivel: novo.value.tipoNivel,
      codigo: codigoNovo.value,
      descricao: novo.value.descricao.trim() || null,
      capacidade: novo.value.capacidade || null,
    }),
  onSuccess: async (r) => {
    aviso.value = fmt(M.criado, { completo: completoNovo.value });
    novo.value = { ...novo.value, codigo: '', descricao: '', capacidade: null };
    await recarregar();
    escolhidoId.value = r.id;
  },
});

// ------------------------------------------------ endereço escolhido
const alteracao = useMutation({
  mutationFn: (mudar: { bloqueado?: boolean; ativo?: boolean }) => {
    const e = escolhido.value as EnderecoArmazem;
    return alterarEndereco(e.id, {
      versao: e.versao,
      descricao: e.descricao,
      capacidade: e.capacidade,
      bloqueado: mudar.bloqueado ?? e.bloqueado,
      ativo: mudar.ativo ?? e.ativo,
    });
  },
  onSuccess: async () => {
    aviso.value = M.salvo;
    await recarregar();
  },
});

const termo = ref('');
const achados = ref<OpcaoEnderecamento[]>([]);
const itemEscolhido = ref<OpcaoEnderecamento | null>(null);
const preferencial = ref(true);
const quantidadeMaxima = ref<number | null>(null);
let espera: ReturnType<typeof setTimeout> | undefined;
watch(termo, (v) => {
  clearTimeout(espera);
  if (v.trim().length < 2) {
    achados.value = [];
    return;
  }
  espera = setTimeout(async () => {
    achados.value = await buscarItensEnderecamento(v.trim()).catch(() => []);
  }, 250);
});
const escolherItem = (i: OpcaoEnderecamento) => {
  itemEscolhido.value = i;
  termo.value = `${i.codigo} · ${i.nome}`;
  achados.value = [];
  // Preferencial já marcado quando o item ainda não tem endereço neste local.
  preferencial.value = !enderecos.value.some((e) => e.itens.some((x) => x.insumo === i.id));
};
const vinculo = useMutation({
  mutationFn: () =>
    vincularItemEndereco((escolhido.value as EnderecoArmazem).id, {
      insumo: (itemEscolhido.value as OpcaoEnderecamento).id,
      preferencial: preferencial.value,
      quantidadeMaxima: quantidadeMaxima.value || null,
    }),
  onSuccess: async () => {
    aviso.value = M.salvo;
    itemEscolhido.value = null;
    termo.value = '';
    quantidadeMaxima.value = null;
    await recarregar();
  },
});
const acaoVinculo = useMutation({
  mutationFn: (x: { vinculo: number; acao: 'preferencial' | 'retirar' }) =>
    x.acao === 'preferencial' ? tornarPreferencial(x.vinculo) : retirarVinculo(x.vinculo),
  onSuccess: async () => {
    aviso.value = M.salvo;
    await recarregar();
  },
});
const erro = computed(
  () =>
    criacao.error.value ??
    alteracao.error.value ??
    vinculo.error.value ??
    acaoVinculo.error.value ??
    ficha.error.value ??
    locais.error.value,
);
watch(local, () => {
  escolhidoId.value = null;
  novo.value = { superior: null, tipoNivel: 'area', codigo: '', descricao: '', capacidade: null };
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="end-titulo" data-testid="tela-suprimentos-enderecamento">
    <h1 id="end-titulo">{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="end-aviso">{{ aviso }}</p>
    <SanteSelecao
      v-model="local"
      :rotulo="M.local"
      :opcoes="[
        { valor: null, rotulo: M.escolha },
        ...(locais.data.value ?? []).map((l) => ({
          valor: l.id as number | null,
          rotulo: `${l.codigo} · ${l.nome}`,
        })),
      ]"
      class="campo"
      data-testid="end-local"
    />

    <template v-if="local">
      <p v-if="!ficha.data.value">{{ M.carregando }}</p>
      <template v-else>
        <form
          v-if="podeEditar"
          class="painel"
          data-testid="end-novo"
          :aria-label="M.novo"
          @submit.prevent="codigoValido && criacao.mutate()"
        >
          <h2>{{ M.novo }}</h2>
          <SanteSelecao
            v-model="novo.superior"
            :rotulo="M.superior"
            :opcoes="opcoesSuperior"
            class="campo"
            data-testid="end-superior"
          />
          <SanteSelecao
            v-model="novo.tipoNivel"
            :rotulo="M.tipo"
            :opcoes="opcoesTipo"
            class="campo"
            data-testid="end-tipo"
          />
          <label class="campo"
            >{{ M.codigo }}
            <input
              v-model="novo.codigo"
              maxlength="30"
              required
              :aria-invalid="novo.codigo !== '' && !codigoValido"
              aria-describedby="end-codigo-ajuda"
              data-testid="end-codigo"
            />
          </label>
          <small id="end-codigo-ajuda" data-testid="end-completo">{{
            novo.codigo !== '' && !codigoValido
              ? M.codigoInvalido
              : fmt(M.codigoAjuda, { completo: completoNovo })
          }}</small>
          <label class="campo"
            >{{ M.descricao }} <input v-model="novo.descricao" maxlength="200" data-testid="end-descricao"
          /></label>
          <label class="campo"
            >{{ M.capacidade }}
            <input
              v-model.number="novo.capacidade"
              type="number"
              min="0"
              step="any"
              data-testid="end-capacidade"
          /></label>
          <button
            type="submit"
            class="botao"
            :disabled="!codigoValido || criacao.isPending.value"
            data-testid="end-criar"
          >
            {{ M.criar }}
          </button>
        </form>

        <p v-if="enderecos.length === 0">{{ M.vazio }}</p>
        <table v-else class="tabela" data-testid="end-arvore">
          <caption>
            {{
              M.arvore
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ M.endereco }}</th>
              <th scope="col">{{ M.tipo }}</th>
              <th scope="col">{{ M.capacidade }}</th>
              <th scope="col">{{ M.situacao }}</th>
              <th scope="col">{{ M.itens }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in enderecos"
              :key="e.id"
              :class="{ escolhido: e.id === escolhidoId, inativo: !e.ativo }"
              :data-testid="`end-linha-${e.codigoCompleto}`"
            >
              <td :style="{ paddingInlineStart: `${(e.nivel - 1) * 1.25 + 0.5}rem` }">
                <button type="button" class="link" @click="escolhidoId = e.id">{{ e.codigoCompleto }}</button>
                <small v-if="e.descricao"> · {{ e.descricao }}</small>
              </td>
              <td>{{ M.tipos[e.tipoNivel] }}</td>
              <td>{{ e.capacidade ?? '' }}</td>
              <td>
                {{ e.ativo ? M.ativo : M.inativo }}<strong v-if="e.bloqueado"> · {{ M.bloqueado }}</strong>
              </td>
              <td>
                <span v-for="i in e.itens" :key="i.vinculo">{{
                  `${i.codigo} · ${i.nome}${i.preferencial ? ` (${M.preferencial})` : ''}; `
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <section
          v-if="escolhido"
          class="painel"
          data-testid="end-escolhido"
          :aria-label="fmt(M.escolhido, { completo: escolhido.codigoCompleto })"
        >
          <h2>{{ fmt(M.escolhido, { completo: escolhido.codigoCompleto }) }}</h2>
          <p v-if="podeEditar">
            <button
              type="button"
              class="botao"
              data-testid="end-bloquear"
              @click="alteracao.mutate({ bloqueado: !escolhido.bloqueado })"
            >
              {{ escolhido.bloqueado ? M.desbloquear : M.bloquear }}
            </button>
            <button
              type="button"
              class="botao"
              data-testid="end-situacao"
              @click="alteracao.mutate({ ativo: !escolhido.ativo })"
            >
              {{ escolhido.ativo ? M.inativar : M.reativar }}
            </button>
          </p>
          <p v-if="escolhido.itens.length === 0">{{ M.semItens }}</p>
          <ul v-else data-testid="end-itens">
            <li v-for="i in escolhido.itens" :key="i.vinculo" :data-testid="`end-item-${i.insumo}`">
              {{ i.codigo }} · {{ i.nome }}
              <strong v-if="i.preferencial">{{ `(${M.preferencial})` }}</strong>
              <small v-if="i.quantidadeMaxima !== null">
                · {{ M.quantidadeMaxima }}: {{ i.quantidadeMaxima }}</small
              >
              <template v-if="podeEditar">
                <button
                  v-if="!i.preferencial"
                  type="button"
                  class="botao"
                  :data-testid="`end-preferencial-${i.insumo}`"
                  @click="acaoVinculo.mutate({ vinculo: i.vinculo, acao: 'preferencial' })"
                >
                  {{ M.tornarPreferencial }}
                </button>
                <button
                  type="button"
                  class="botao"
                  :data-testid="`end-retirar-${i.insumo}`"
                  @click="acaoVinculo.mutate({ vinculo: i.vinculo, acao: 'retirar' })"
                >
                  {{ M.retirar }}
                </button>
              </template>
            </li>
          </ul>
          <form
            v-if="podeEditar && escolhido.ativo && !escolhido.bloqueado"
            data-testid="end-ligar"
            @submit.prevent="itemEscolhido && vinculo.mutate()"
          >
            <h3>{{ M.ligarItem }}</h3>
            <label class="campo"
              >{{ M.buscarItem }}
              <input v-model="termo" autocomplete="off" data-testid="end-busca-item" />
            </label>
            <ul v-if="achados.length" class="lista-opcoes" data-testid="end-achados">
              <li v-for="a in achados" :key="a.id">
                <button
                  type="button"
                  class="link"
                  :data-testid="`end-achado-${a.id}`"
                  @click="escolherItem(a)"
                >
                  {{ a.codigo }} · {{ a.nome }}
                </button>
              </li>
            </ul>
            <label class="campo"
              ><input v-model="preferencial" type="checkbox" data-testid="end-preferencial" />
              {{ M.preferencial }}</label
            >
            <label class="campo"
              >{{ M.quantidadeMaxima }}
              <input
                v-model.number="quantidadeMaxima"
                type="number"
                min="0"
                step="any"
                data-testid="end-qmax"
            /></label>
            <button
              type="submit"
              class="botao"
              :disabled="!itemEscolhido || vinculo.isPending.value"
              data-testid="end-ligar-botao"
            >
              {{ M.ligar }}
            </button>
          </form>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.escolhido td {
  font-weight: 600;
}
.inativo td {
  opacity: 0.6;
}
</style>
