<script setup lang="ts">
// Governança do cadastro de itens (C2-082, 05-SUP linha 2). Três abas numa tela só:
// - solicitações: o pedido de item novo, alteração ou inativação vai direto à comissão (sem rascunho), com a
//   duplicidade e a justificativa conferidas enquanto digita; a comissão aprova (o item novo nasce na aprovação),
//   reprova com motivo ou quem pediu cancela;
// - unificação: o item que permanece, os duplicados com o fator, a aprovação por outra pessoa e a execução que
//   transfere saldo e referências (o absorvido fica inativo, nunca apagado);
// - substituição: o de-para entre itens (genérico, terapêutico, apresentação ou marca), desativado sem apagar.
import {
  conferirSolicitacaoCadastro,
  conferirSubstituicao,
  conferirUnificacao,
  MINIMO_JUSTIFICATIVA_CADASTRO,
  TIPOS_SUBSTITUICAO,
  type TipoSubstituicao,
} from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarItensCadastro,
  decidirSolicitacaoCadastro,
  decidirUnificacao,
  gravarSubstituicao,
  type ItemCadastroTela,
  listarSolicitacoesCadastro,
  listarSubstituicoes,
  listarUnificacoes,
  novaChaveGovernanca,
  pedirUnificacao,
  type SolicitacaoTela,
  solicitarCadastro,
  type UnificacaoTela,
} from '../api-governanca-cadastro.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensGovernancaCadastro as M } from '../i18n-governanca-cadastro.js';

type Aba = 'solicitacoes' | 'unificacao' | 'substituicao';
const abas: readonly Aba[] = ['solicitacoes', 'unificacao', 'substituicao'];
const aba = ref<Aba>('solicitacoes');
const qc = useQueryClient();
const erro = ref<unknown>(null);
const aviso = ref('');
const podeEditar = computed(() => pode('suprimentos.item.editar'));
const podeDecidir = computed(() => pode('suprimentos.padronizacao.aprovar'));
const formatar = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_x, k: string) => String(v[k] ?? ''));

/** Um seletor de item do cadastro: digita parte do nome ou o código e escolhe no combo. */
function seletorItem() {
  const s = reactive({ termo: '', itens: [] as ItemCadastroTela[], valor: null as number | null });
  const buscar = async () => {
    s.itens = s.termo.trim().length >= 2 ? await buscarItensCadastro(s.termo.trim()) : [];
  };
  const opcoes = computed(() => [
    { valor: null as number | null, rotulo: M.escolha },
    ...s.itens.map((i) => ({
      valor: i.id as number | null,
      rotulo: `${i.codigo} · ${i.nome}${i.ativo ? '' : ' (inativo)'}`,
    })),
  ]);
  return { s, buscar, opcoes };
}

async function acao(f: () => Promise<{ situacao: string }>, chaves: readonly string[], ok: string) {
  erro.value = null;
  aviso.value = '';
  try {
    const r = await f();
    aviso.value = formatar(ok, { situacao: r.situacao });
    for (const k of chaves) await qc.invalidateQueries({ queryKey: ['governanca-cadastro', k] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ---------------------------------------------------------------- solicitações
const solicitacoes = useQuery({
  queryKey: ['governanca-cadastro', 'solicitacoes'],
  queryFn: listarSolicitacoesCadastro,
});
const pedido = reactive({
  tipo: 'inclusao' as 'inclusao' | 'alteracao' | 'inativacao',
  descricao: '',
  unidade: '',
  justificativa: '',
});
const itemPedido = seletorItem();
const opcoesTipo = (['inclusao', 'alteracao', 'inativacao'] as const).map((v) => ({
  valor: v,
  rotulo: M.tipos[v],
}));
const recusasPedido = computed(() =>
  conferirSolicitacaoCadastro({
    tipo: pedido.tipo,
    item: pedido.tipo === 'inclusao' ? null : itemPedido.s.valor,
    descricao: pedido.descricao,
    justificativa: pedido.justificativa,
  }),
);
const faltaJustificativa = computed(() =>
  Math.max(0, MINIMO_JUSTIFICATIVA_CADASTRO - pedido.justificativa.trim().length),
);
let chavePedido = novaChaveGovernanca();
async function enviarPedido() {
  const ok = await acao(
    () =>
      solicitarCadastro(
        {
          tipo: pedido.tipo,
          item: pedido.tipo === 'inclusao' ? null : itemPedido.s.valor,
          descricao: pedido.descricao.trim(),
          unidade: pedido.unidade.trim() || null,
          justificativa: pedido.justificativa.trim(),
        },
        chavePedido,
      ),
    ['solicitacoes'],
    M.enviado.replace('nº {numero} ', ''),
  );
  if (ok) {
    chavePedido = novaChaveGovernanca();
    pedido.descricao = pedido.unidade = pedido.justificativa = '';
  }
}

const decisao = reactive({
  alvo: null as number | null,
  parecer: '',
  motivo: '',
  codigo: '',
  tipoItem: 'material',
  grupo: '',
  unidadeEstoque: '',
});
function abrirDecisao(s: SolicitacaoTela) {
  decisao.alvo = decisao.alvo === s.id ? null : s.id;
  decisao.parecer = decisao.motivo = decisao.codigo = decisao.grupo = decisao.unidadeEstoque = '';
}
async function decidir(s: SolicitacaoTela, acaoSol: 'aprovar' | 'reprovar' | 'cancelar') {
  const inclusao = acaoSol === 'aprovar' && s.tipo === 'inclusao';
  const ok = await acao(
    () =>
      decidirSolicitacaoCadastro(
        s.id,
        {
          versao: s.versao,
          acao: acaoSol,
          parecer: decisao.parecer.trim() || null,
          motivo: decisao.motivo.trim() || null,
          ...(inclusao
            ? {
                codigo: decisao.codigo.trim(),
                tipoItem: decisao.tipoItem.trim(),
                grupo: Number(decisao.grupo),
                unidadeEstoque: Number(decisao.unidadeEstoque),
              }
            : {}),
        },
        novaChaveGovernanca(),
      ),
    ['solicitacoes'],
    M.decidido,
  );
  if (ok) decisao.alvo = null;
}

// ---------------------------------------------------------------- unificação
const unificacoes = useQuery({
  queryKey: ['governanca-cadastro', 'unificacoes'],
  queryFn: listarUnificacoes,
  enabled: computed(() => aba.value === 'unificacao'),
});
const itemPermanece = seletorItem();
const itemAbsorvido = seletorItem();
const fatorNovo = ref(1);
const absorvidos = ref<{ item: number; nome: string; fator: number }[]>([]);
const motivoUni = ref('');
function adicionarAbsorvido() {
  const id = itemAbsorvido.s.valor;
  const it = itemAbsorvido.s.itens.find((i) => i.id === id);
  if (!it) return;
  absorvidos.value = [
    ...absorvidos.value.filter((a) => a.item !== it.id),
    { item: it.id, nome: it.nome, fator: Number(fatorNovo.value) },
  ];
  itemAbsorvido.s.valor = null;
}
const recusasUni = computed(() =>
  conferirUnificacao({
    permanece: itemPermanece.s.valor ?? 0,
    absorvidos: absorvidos.value.map((a) => ({ item: a.item, fator: a.fator })),
    motivo: motivoUni.value,
  }),
);
let chaveUni = novaChaveGovernanca();
async function enviarUnificacao() {
  const ok = await acao(
    () =>
      pedirUnificacao(
        {
          permanece: itemPermanece.s.valor ?? 0,
          absorvidos: absorvidos.value.map((a) => ({ item: a.item, fator: a.fator })),
          motivo: motivoUni.value.trim(),
        },
        chaveUni,
      ),
    ['unificacoes'],
    M.decidido,
  );
  if (ok) {
    chaveUni = novaChaveGovernanca();
    absorvidos.value = [];
    motivoUni.value = '';
  }
}
const motivoCancelUni = ref('');
const decidirUni = (u: UnificacaoTela, a: 'aprovar' | 'executar' | 'cancelar') =>
  acao(
    () =>
      decidirUnificacao(
        u.id,
        { versao: u.versao, acao: a, motivo: a === 'cancelar' ? motivoCancelUni.value.trim() : null },
        novaChaveGovernanca(),
      ),
    ['unificacoes'],
    M.decidido,
  );

// ---------------------------------------------------------------- substituição
const itemSub = seletorItem();
const itemSubstituto = seletorItem();
const sub = reactive({ tipo: 'generico' as TipoSubstituicao, fator: 1, aviso: true });
const substituicoes = useQuery({
  queryKey: ['governanca-cadastro', 'substituicoes', computed(() => itemSub.s.valor)],
  queryFn: () => listarSubstituicoes(itemSub.s.valor),
  enabled: computed(() => aba.value === 'substituicao'),
});
const opcoesTipoSub = TIPOS_SUBSTITUICAO.map((v) => ({ valor: v, rotulo: M.tiposSubstituicao[v] }));
const recusasSub = computed(() =>
  itemSub.s.valor && itemSubstituto.s.valor
    ? conferirSubstituicao({
        item: itemSub.s.valor,
        substituto: itemSubstituto.s.valor,
        tipo: sub.tipo,
        fator: Number(sub.fator),
        vigenciaInicio: null,
        vigenciaFim: null,
      })
    : [],
);
const gravarSub = (ativo: boolean, item = itemSub.s.valor, substituto = itemSubstituto.s.valor) =>
  item && substituto
    ? acao(
        () =>
          gravarSubstituicao(
            {
              item,
              substituto,
              tipo: sub.tipo,
              fator: Number(sub.fator),
              exigeAvisoPrescritor: sub.aviso,
              ativo,
            },
            novaChaveGovernanca(),
          ),
        ['substituicoes'],
        M.gravado,
      )
    : Promise.resolve(false);
</script>

<template>
  <section class="pagina" data-testid="gov-tela">
    <h1>{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>

    <div class="abas" role="tablist">
      <SanteBotao
        v-for="a in abas"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="M.abas[a]"
        :data-testid="`gov-aba-${a}`"
        @click="aba = a"
      />
    </div>

    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="gov-aviso">{{ aviso }}</p>

    <!-- Solicitações -->
    <div v-if="aba === 'solicitacoes'">
      <form v-if="podeEditar" class="filtros" data-testid="gov-pedido" @submit.prevent="enviarPedido">
        <SanteSelecao
          v-model="pedido.tipo"
          :rotulo="M.tipo"
          :opcoes="opcoesTipo"
          class="campo"
          data-testid="gov-tipo"
        />
        <template v-if="pedido.tipo !== 'inclusao'">
          <label class="campo">
            <span>{{ M.buscarItem }}</span>
            <input v-model="itemPedido.s.termo" data-testid="gov-item-busca" @input="itemPedido.buscar" />
          </label>
          <SanteSelecao
            v-model="itemPedido.s.valor"
            :rotulo="M.item"
            :opcoes="itemPedido.opcoes.value"
            class="campo"
            data-testid="gov-item"
          />
        </template>
        <label class="campo">
          <span>{{ M.descricao }}</span>
          <input v-model="pedido.descricao" maxlength="150" data-testid="gov-descricao" />
        </label>
        <label class="campo">
          <span>{{ M.unidade }}</span>
          <input v-model="pedido.unidade" maxlength="30" data-testid="gov-unidade" />
        </label>
        <label class="campo">
          <span>{{ M.justificativa }}</span>
          <textarea
            v-model="pedido.justificativa"
            maxlength="2000"
            rows="2"
            data-testid="gov-justificativa"
          />
          <small v-if="faltaJustificativa > 0" data-testid="gov-falta">{{
            formatar(M.faltamCaracteres, { n: faltaJustificativa })
          }}</small>
        </label>
        <ul v-if="recusasPedido.length && pedido.descricao" role="alert" data-testid="gov-pedido-recusas">
          <li v-for="r in recusasPedido" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
        <SanteBotao
          type="submit"
          :rotulo="M.pedir"
          :desabilitado="recusasPedido.length > 0"
          data-testid="gov-enviar"
        />
      </form>

      <table class="tabela" data-testid="gov-solicitacoes">
        <thead>
          <tr>
            <th>{{ M.numero }}</th>
            <th>{{ M.tipo }}</th>
            <th>{{ M.descricao }}</th>
            <th>{{ M.situacao }}</th>
            <th>{{ M.acoes }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!(solicitacoes.data.value ?? []).length">
            <td colspan="5">{{ M.nenhum }}</td>
          </tr>
          <template v-for="s in solicitacoes.data.value ?? []" :key="s.id">
            <tr :data-testid="`gov-sol-${s.id}`">
              <td>{{ s.numero }}</td>
              <td>{{ M.tipos[s.tipo] }}{{ s.item ? ` · ${s.item}` : '' }}</td>
              <td>{{ s.descricao }}</td>
              <td>{{ s.situacao.replace('_', ' ') }}</td>
              <td>
                <SanteBotao
                  v-if="['enviada', 'em_analise'].includes(s.situacao)"
                  variante="secundario"
                  :rotulo="M.acoes"
                  :data-testid="`gov-sol-abrir-${s.id}`"
                  @click="abrirDecisao(s)"
                />
              </td>
            </tr>
            <tr v-if="decisao.alvo === s.id">
              <td colspan="5">
                <div class="filtros" :data-testid="`gov-decisao-${s.id}`">
                  <label class="campo">
                    <span>{{ M.parecer }}</span>
                    <input v-model="decisao.parecer" maxlength="2000" data-testid="gov-parecer" />
                  </label>
                  <label class="campo">
                    <span>{{ M.motivo }}</span>
                    <input v-model="decisao.motivo" maxlength="500" data-testid="gov-motivo" />
                  </label>
                  <template v-if="s.tipo === 'inclusao'">
                    <label class="campo">
                      <span>{{ M.codigo }}</span>
                      <input v-model="decisao.codigo" maxlength="30" data-testid="gov-codigo" />
                    </label>
                    <label class="campo">
                      <span>{{ M.tipoItem }}</span>
                      <input v-model="decisao.tipoItem" maxlength="20" data-testid="gov-tipo-item" />
                    </label>
                    <label class="campo">
                      <span>{{ M.grupo }}</span>
                      <input v-model="decisao.grupo" inputmode="numeric" data-testid="gov-grupo" />
                    </label>
                    <label class="campo">
                      <span>{{ M.unidadeEstoque }}</span>
                      <input
                        v-model="decisao.unidadeEstoque"
                        inputmode="numeric"
                        data-testid="gov-unidade-estoque"
                      />
                    </label>
                  </template>
                  <SanteBotao
                    v-if="podeDecidir"
                    :rotulo="M.aprovar"
                    data-testid="gov-aprovar"
                    @click="decidir(s, 'aprovar')"
                  />
                  <SanteBotao
                    v-if="podeDecidir"
                    variante="secundario"
                    :rotulo="M.reprovar"
                    data-testid="gov-reprovar"
                    @click="decidir(s, 'reprovar')"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="M.cancelar"
                    data-testid="gov-cancelar"
                    @click="decidir(s, 'cancelar')"
                  />
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Unificação -->
    <div v-if="aba === 'unificacao'">
      <form v-if="podeEditar" class="filtros" data-testid="gov-unificacao" @submit.prevent="enviarUnificacao">
        <label class="campo">
          <span>{{ M.buscarItem }}</span>
          <input
            v-model="itemPermanece.s.termo"
            data-testid="gov-permanece-busca"
            @input="itemPermanece.buscar"
          />
        </label>
        <SanteSelecao
          v-model="itemPermanece.s.valor"
          :rotulo="M.permanece"
          :opcoes="itemPermanece.opcoes.value"
          class="campo"
          data-testid="gov-permanece"
        />
        <label class="campo">
          <span>{{ M.buscarItem }}</span>
          <input
            v-model="itemAbsorvido.s.termo"
            data-testid="gov-absorvido-busca"
            @input="itemAbsorvido.buscar"
          />
        </label>
        <SanteSelecao
          v-model="itemAbsorvido.s.valor"
          :rotulo="M.absorvido"
          :opcoes="itemAbsorvido.opcoes.value"
          class="campo"
          data-testid="gov-absorvido"
        />
        <label class="campo">
          <span>{{ M.fator }}</span>
          <input v-model.number="fatorNovo" type="number" min="0" step="any" data-testid="gov-fator" />
        </label>
        <SanteBotao
          variante="secundario"
          :rotulo="M.adicionar"
          :desabilitado="!itemAbsorvido.s.valor"
          data-testid="gov-adicionar"
          @click="adicionarAbsorvido"
        />
        <ul data-testid="gov-absorvidos">
          <li v-for="a in absorvidos" :key="a.item">
            {{ `${a.nome} × ${a.fator}` }}
            <SanteBotao
              variante="secundario"
              :rotulo="M.remover"
              @click="absorvidos = absorvidos.filter((x) => x.item !== a.item)"
            />
          </li>
        </ul>
        <label class="campo">
          <span>{{ M.motivo }}</span>
          <input v-model="motivoUni" maxlength="500" data-testid="gov-motivo-unificacao" />
        </label>
        <ul v-if="recusasUni.length && absorvidos.length" role="alert" data-testid="gov-uni-recusas">
          <li v-for="r in recusasUni" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
        <SanteBotao
          type="submit"
          :rotulo="M.pedirUnificacao"
          :desabilitado="!itemPermanece.s.valor || recusasUni.length > 0"
          data-testid="gov-pedir-unificacao"
        />
      </form>

      <label class="campo">
        <span>{{ M.motivo }} ({{ M.cancelar }})</span>
        <input v-model="motivoCancelUni" maxlength="500" data-testid="gov-motivo-cancelar-uni" />
      </label>
      <table class="tabela" data-testid="gov-unificacoes">
        <thead>
          <tr>
            <th>{{ M.numero }}</th>
            <th>{{ M.permanece }}</th>
            <th>{{ M.absorvidos }}</th>
            <th>{{ M.situacao }}</th>
            <th>{{ M.referencias }}</th>
            <th>{{ M.acoes }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!(unificacoes.data.value ?? []).length">
            <td colspan="6">{{ M.nenhum }}</td>
          </tr>
          <tr v-for="u in unificacoes.data.value ?? []" :key="u.id" :data-testid="`gov-uni-${u.id}`">
            <td>{{ u.numero }}</td>
            <td>{{ u.permanece }}</td>
            <td>{{ u.absorvidos }}</td>
            <td>{{ u.situacao.replace('_', ' ') }}</td>
            <td>{{ u.referenciasTransferidas }}</td>
            <td>
              <SanteBotao
                v-if="podeDecidir && u.situacao === 'aguardando_aprovacao'"
                :rotulo="M.aprovar"
                :data-testid="`gov-uni-aprovar-${u.id}`"
                @click="decidirUni(u, 'aprovar')"
              />
              <SanteBotao
                v-if="podeDecidir && u.situacao === 'aprovada'"
                :rotulo="M.executar"
                :data-testid="`gov-uni-executar-${u.id}`"
                @click="decidirUni(u, 'executar')"
              />
              <SanteBotao
                v-if="['rascunho', 'aguardando_aprovacao', 'aprovada'].includes(u.situacao)"
                variante="secundario"
                :rotulo="M.cancelar"
                :data-testid="`gov-uni-cancelar-${u.id}`"
                @click="decidirUni(u, 'cancelar')"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Substituição -->
    <div v-if="aba === 'substituicao'">
      <form class="filtros" data-testid="gov-substituicao" @submit.prevent="gravarSub(true)">
        <label class="campo">
          <span>{{ M.buscarItem }}</span>
          <input v-model="itemSub.s.termo" data-testid="gov-sub-item-busca" @input="itemSub.buscar" />
        </label>
        <SanteSelecao
          v-model="itemSub.s.valor"
          :rotulo="M.item"
          :opcoes="itemSub.opcoes.value"
          class="campo"
          data-testid="gov-sub-item"
        />
        <label class="campo">
          <span>{{ M.buscarItem }}</span>
          <input
            v-model="itemSubstituto.s.termo"
            data-testid="gov-substituto-busca"
            @input="itemSubstituto.buscar"
          />
        </label>
        <SanteSelecao
          v-model="itemSubstituto.s.valor"
          :rotulo="M.substituto"
          :opcoes="itemSubstituto.opcoes.value"
          class="campo"
          data-testid="gov-substituto"
        />
        <SanteSelecao
          v-model="sub.tipo"
          :rotulo="M.tipoSubstituicao"
          :opcoes="opcoesTipoSub"
          class="campo"
          data-testid="gov-sub-tipo"
        />
        <label class="campo">
          <span>{{ M.fator }}</span>
          <input v-model.number="sub.fator" type="number" min="0" step="any" data-testid="gov-sub-fator" />
        </label>
        <label class="campo">
          <input v-model="sub.aviso" type="checkbox" data-testid="gov-sub-aviso" />
          <span>{{ M.avisoPrescritor }}</span>
        </label>
        <ul v-if="recusasSub.length" role="alert" data-testid="gov-sub-recusas">
          <li v-for="r in recusasSub" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
        <SanteBotao
          v-if="podeEditar"
          type="submit"
          :rotulo="M.gravar"
          :desabilitado="!itemSub.s.valor || !itemSubstituto.s.valor || recusasSub.length > 0"
          data-testid="gov-sub-gravar"
        />
      </form>
      <table class="tabela" data-testid="gov-substituicoes">
        <thead>
          <tr>
            <th>{{ M.item }}</th>
            <th>{{ M.substituto }}</th>
            <th>{{ M.tipoSubstituicao }}</th>
            <th>{{ M.fator }}</th>
            <th>{{ M.situacao }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!(substituicoes.data.value ?? []).length">
            <td colspan="5">{{ M.nenhum }}</td>
          </tr>
          <tr v-for="x in substituicoes.data.value ?? []" :key="x.id" :data-testid="`gov-sub-${x.id}`">
            <td>{{ x.item }}</td>
            <td>{{ x.substituto }}</td>
            <td>{{ M.tiposSubstituicao[x.tipo as TipoSubstituicao] ?? x.tipo }}</td>
            <td>{{ x.fator }}</td>
            <td>{{ x.ativo ? M.ativa : M.inativa }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
