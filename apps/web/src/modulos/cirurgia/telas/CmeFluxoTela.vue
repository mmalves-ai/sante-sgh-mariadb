<script setup lang="ts">
// Fluxo do material esterilizado entre a CME e os setores (F7, 04-CME linha 117; RDC 15/2012): a fila de
// solicitações (receber, cancelar com motivo), a entrega ao setor pelos pacotes estéreis do arsenal, o recolhimento
// (íntegro volta ao arsenal; usado e sem integridade, expurgo), a conferência do movimento pelo setor e as permissões de
// cada colaborador da CME por setor. A regra mora no domínio; a tela só mostra e envia.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarUsuariosCme,
  cancelarSolicitacaoCme,
  conferirMovimentoCme,
  entregarAoSetorCme,
  gravarPermissaoCme,
  lerFluxoCme,
  MARCAS_PERMISSAO,
  type MarcaPermissao,
  receberSolicitacaoCme,
  recolherDoSetorCme,
} from '../api-cme-fluxo.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const k = (c: string, p?: Record<string, unknown>) => t(`cirurgia.cmeFluxo.${c}`, p ?? {});
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['cirurgia', 'cme', 'fluxo'], queryFn: lerFluxoCme });
const p = computed(() => painel.data.value);
const erro = ref<unknown>(null);
const aviso = ref('');
const sit = (s: string) => k(`situacoes.${s}`);
const escolha = { valor: '', rotulo: k('escolha') };
const opcoesSetor = computed(() => [
  escolha,
  ...(p.value?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);
const opcoesSolicitacao = computed(() => [
  escolha,
  ...(p.value?.solicitacoes ?? [])
    .filter((s) => s.situacao !== 'aberta')
    .map((s) => ({ valor: String(s.id), rotulo: `${s.numero} · ${s.setor ?? '—'} · ${sit(s.situacao)}` })),
]);

const acao = useMutation({
  mutationFn: async (f: () => Promise<string>) => f(),
  onMutate: () => {
    erro.value = null;
    aviso.value = '';
  },
  onSuccess: async (texto) => {
    aviso.value = texto;
    await cliente.invalidateQueries({ queryKey: ['cirurgia', 'cme'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const fazer = (f: () => Promise<string>) => acao.mutate(f);

// ── Fila ───────────────────────────────────────────────────────────────────────────────────────────────────────
const motivos = reactive<Record<number, string>>({});
const receber = (id: number, numero: string) =>
  fazer(async () => {
    await receberSolicitacaoCme(id);
    return k('recebida', { numero });
  });
const cancelar = (id: number, numero: string) =>
  fazer(async () => {
    await cancelarSolicitacaoCme(id, motivos[id] ?? '');
    return k('cancelada', { numero });
  });

// ── Entrega ao setor ───────────────────────────────────────────────────────────────────────────────────────────
const entrega = reactive({ solicitacao: '', cme: '', setor: '', pacotes: [] as number[] });
const entregar = () =>
  fazer(async () => {
    const r = await entregarAoSetorCme({
      solicitacao: Number(entrega.solicitacao),
      cme: Number(entrega.cme),
      setor: Number(entrega.setor),
      pacotes: entrega.pacotes,
    });
    entrega.pacotes = [];
    return k('entregue', { movimento: r.movimento, situacao: sit(r.solicitacao) });
  });

// ── Recolhimento ───────────────────────────────────────────────────────────────────────────────────────────────
const recolhimento = reactive({ cme: '', setor: '', observacao: '', pacotes: [] as number[] });
const integros = reactive<Record<number, boolean>>({});
const foraDoSetor = computed(() =>
  (p.value?.foraDaCme ?? []).filter((x) => !recolhimento.setor || x.setor === Number(recolhimento.setor)),
);
const recolher = () =>
  fazer(async () => {
    const r = await recolherDoSetorCme({
      cme: Number(recolhimento.cme),
      setor: Number(recolhimento.setor),
      observacao: recolhimento.observacao.trim() || null,
      pacotes: recolhimento.pacotes.map((pacote) => ({ pacote, integro: integros[pacote] ?? false })),
    });
    recolhimento.pacotes = [];
    return k('recolhido', r);
  });

// ── Movimentos ─────────────────────────────────────────────────────────────────────────────────────────────────
const conferir = (id: number, numero: number) =>
  fazer(async () => {
    await conferirMovimentoCme(id);
    return k('conferido', { movimento: numero });
  });

// ── Permissões por setor ───────────────────────────────────────────────────────────────────────────────────────
const permissao = reactive({
  usuario: '',
  setor: '',
  marcas: Object.fromEntries(MARCAS_PERMISSAO.map((m) => [m, false])) as Record<MarcaPermissao, boolean>,
});
const opcoesUsuario = ref([escolha]);
const buscarUsuario = (q: string) => {
  void buscarUsuariosCme(q).then((xs) => {
    opcoesUsuario.value = [escolha, ...xs.map((u) => ({ valor: String(u.id), rotulo: u.nome }))];
  });
};
const gravarPermissao = () =>
  fazer(async () => {
    await gravarPermissaoCme({
      usuario: Number(permissao.usuario),
      setor: Number(permissao.setor),
      ...permissao.marcas,
    });
    return k('permissaoGravada');
  });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cme-fluxo-titulo" data-testid="tela-cme-fluxo">
    <h1 id="cme-fluxo-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cme-fluxo-aviso">{{ aviso }}</p>
    <p v-if="painel.isPending.value">{{ k('carregando') }}</p>

    <template v-if="p">
      <h2>{{ k('fila') }}</h2>
      <p v-if="!p.solicitacoes.length">{{ k('semFila') }}</p>
      <table v-else class="tabela" data-testid="cme-fluxo-fila">
        <thead>
          <tr>
            <th scope="col">{{ k('numero') }}</th>
            <th scope="col">{{ k('setorSolicitante') }}</th>
            <th scope="col">{{ k('itens') }}</th>
            <th scope="col">{{ k('situacao') }}</th>
            <th scope="col">{{ k('prazo') }}</th>
            <th scope="col">{{ k('motivo') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in p.solicitacoes" :key="s.id" :data-testid="`cme-fluxo-sol-${s.id}`">
            <td>
              {{ s.numero }}
              <strong v-if="s.urgente">· {{ k('urgente') }}</strong>
            </td>
            <td>{{ s.setor ?? '—' }}</td>
            <td>
              <span v-for="i in s.itens" :key="i.id">
                {{ i.caixa ?? '—' }} {{ i.atendida }}/{{ i.quantidade }} ({{ sit(i.situacao) }})
              </span>
            </td>
            <td>{{ sit(s.situacao) }}</td>
            <td>{{ s.necessarioAte?.slice(0, 16).replace('T', ' ') ?? '—' }}</td>
            <td>
              <input
                v-if="s.situacao === 'aberta' || s.situacao === 'recebida_cme'"
                v-model="motivos[s.id]"
                :aria-label="`${k('motivo')} ${s.numero}`"
                maxlength="500"
                :data-testid="`cme-fluxo-motivo-${s.id}`"
              />
            </td>
            <td>
              <button
                v-if="s.situacao === 'aberta'"
                type="button"
                :data-testid="`cme-fluxo-receber-${s.id}`"
                @click="receber(s.id, s.numero)"
              >
                {{ k('receber') }}
              </button>
              <button
                v-if="s.situacao === 'aberta' || s.situacao === 'recebida_cme'"
                type="button"
                :disabled="!(motivos[s.id] ?? '').trim()"
                :data-testid="`cme-fluxo-cancelar-${s.id}`"
                @click="cancelar(s.id, s.numero)"
              >
                {{ k('cancelar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ k('entregaTitulo') }}</h2>
      <form class="filtros" data-testid="cme-fluxo-entrega" @submit.prevent="entregar">
        <SanteSelecao
          v-model="entrega.solicitacao"
          :rotulo="k('solicitacao')"
          :opcoes="opcoesSolicitacao"
          data-testid="cme-fluxo-entrega-solicitacao"
        />
        <SanteSelecao
          v-model="entrega.cme"
          :rotulo="k('setorCme')"
          :opcoes="opcoesSetor"
          data-testid="cme-fluxo-entrega-cme"
        />
        <SanteSelecao
          v-model="entrega.setor"
          :rotulo="k('setorDestino')"
          :opcoes="opcoesSetor"
          data-testid="cme-fluxo-entrega-setor"
        />
        <fieldset>
          <legend>{{ k('pacotesArsenal') }}</legend>
          <p v-if="!p.arsenal.length">{{ k('semArsenal') }}</p>
          <label v-for="x in p.arsenal" :key="x.id">
            <input
              v-model="entrega.pacotes"
              type="checkbox"
              :value="x.id"
              :data-testid="`cme-fluxo-entrega-pacote-${x.id}`"
            />
            {{ x.etiqueta ?? x.id }} · {{ x.caixa ?? '—' }} · {{ k('validade') }} {{ x.validade ?? '—' }}
          </label>
        </fieldset>
        <button
          type="submit"
          :disabled="!entrega.solicitacao || !entrega.cme || !entrega.setor || !entrega.pacotes.length"
          data-testid="cme-fluxo-entregar"
        >
          {{ k('entregar') }}
        </button>
      </form>

      <h2>{{ k('recolhimentoTitulo') }}</h2>
      <form class="filtros" data-testid="cme-fluxo-recolhimento" @submit.prevent="recolher">
        <SanteSelecao
          v-model="recolhimento.cme"
          :rotulo="k('setorCme')"
          :opcoes="opcoesSetor"
          data-testid="cme-fluxo-recolhimento-cme"
        />
        <SanteSelecao
          v-model="recolhimento.setor"
          :rotulo="k('setorOrigem')"
          :opcoes="opcoesSetor"
          data-testid="cme-fluxo-recolhimento-setor"
        />
        <fieldset>
          <legend>{{ k('pacotesFora') }}</legend>
          <p v-if="!foraDoSetor.length">{{ k('semFora') }}</p>
          <div v-for="x in foraDoSetor" :key="x.id">
            <label>
              <input
                v-model="recolhimento.pacotes"
                type="checkbox"
                :value="x.id"
                :data-testid="`cme-fluxo-recolher-pacote-${x.id}`"
              />
              {{ x.etiqueta ?? x.id }} · {{ x.caixa ?? '—' }} · {{ sit(x.situacao) }}
            </label>
            <label v-if="x.situacao === 'distribuido'">
              <input v-model="integros[x.id]" type="checkbox" :data-testid="`cme-fluxo-integro-${x.id}`" />
              {{ k('integro') }}
            </label>
          </div>
        </fieldset>
        <label>
          {{ k('observacao') }}
          <input v-model="recolhimento.observacao" maxlength="500" data-testid="cme-fluxo-recolhimento-obs" />
        </label>
        <button
          type="submit"
          :disabled="!recolhimento.cme || !recolhimento.setor || !recolhimento.pacotes.length"
          data-testid="cme-fluxo-recolher"
        >
          {{ k('recolher') }}
        </button>
      </form>

      <h2>{{ k('movimentos') }}</h2>
      <p v-if="!p.movimentos.length">{{ k('semMovimentos') }}</p>
      <table v-else class="tabela" data-testid="cme-fluxo-movimentos">
        <thead>
          <tr>
            <th scope="col">{{ k('numero') }}</th>
            <th scope="col">{{ k('tipo') }}</th>
            <th scope="col">{{ k('setor') }}</th>
            <th scope="col">{{ k('ocorridoEm') }}</th>
            <th scope="col">{{ k('itens') }}</th>
            <th scope="col">{{ k('situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="mv in p.movimentos" :key="mv.id" :data-testid="`cme-fluxo-mov-${mv.id}`">
            <td>{{ mv.numero }}</td>
            <td>{{ k(`tipos.${mv.tipo}`) }}</td>
            <td>{{ mv.setor ?? '—' }}</td>
            <td>{{ mv.ocorridoEm?.slice(0, 16).replace('T', ' ') ?? '—' }}</td>
            <td>{{ mv.itens }}</td>
            <td>{{ sit(mv.situacao) }}</td>
            <td>
              <button
                v-if="mv.situacao === 'aberto'"
                type="button"
                :data-testid="`cme-fluxo-conferir-${mv.id}`"
                @click="conferir(mv.id, mv.numero)"
              >
                {{ k('conferir') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ k('permissoes') }}</h2>
      <p v-if="!p.permissoes.length">{{ k('semPermissoes') }}</p>
      <table v-else class="tabela" data-testid="cme-fluxo-permissoes">
        <thead>
          <tr>
            <th scope="col">{{ k('usuario') }}</th>
            <th scope="col">{{ k('setor') }}</th>
            <th v-for="mk in MARCAS_PERMISSAO" :key="mk" scope="col">{{ k(`marcas.${mk}`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.permissoes" :key="x.id">
            <td>{{ x.usuarioNome ?? x.usuario }}</td>
            <td>{{ x.setorNome ?? x.setor }}</td>
            <td v-for="mk in MARCAS_PERMISSAO" :key="mk">{{ x[mk] ? '✓' : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <form class="filtros" data-testid="cme-fluxo-permissao" @submit.prevent="gravarPermissao">
        <SanteSelecao
          v-model="permissao.usuario"
          :rotulo="k('usuario')"
          :opcoes="opcoesUsuario"
          :buscar="buscarUsuario"
          data-testid="cme-fluxo-permissao-usuario"
        />
        <SanteSelecao
          v-model="permissao.setor"
          :rotulo="k('setor')"
          :opcoes="opcoesSetor"
          data-testid="cme-fluxo-permissao-setor"
        />
        <label v-for="mk in MARCAS_PERMISSAO" :key="mk">
          <input v-model="permissao.marcas[mk]" type="checkbox" :data-testid="`cme-fluxo-marca-${mk}`" />
          {{ k(`marcas.${mk}`) }}
        </label>
        <button
          type="submit"
          :disabled="!permissao.usuario || !permissao.setor"
          data-testid="cme-fluxo-gravar-permissao"
        >
          {{ k('gravarPermissao') }}
        </button>
      </form>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
