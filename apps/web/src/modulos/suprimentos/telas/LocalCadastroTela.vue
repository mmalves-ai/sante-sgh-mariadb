<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Cadastro dos locais de estoque (F3.6, 05-SUP linha 3): `/suprimentos/locais/cadastro`. Lista à esquerda, ficha
// ao lado: tipo, setor, centro de custo, quem abastece, o que atende, setores atendidos e os grupos que o local
// movimenta. Inativar pede motivo e é recusado com saldo ou requisição aberta (a recusa aparece no campo).
import type { LocalEstoqueEntrada } from '@sgh/contratos/regras-suprimentos';
import { TIPOS_LOCAL_ESTOQUE } from '@sgh/contratos/regras-suprimentos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarLocal,
  apoioCadastroEstoque,
  fichaLocalEdicao,
  incluirLocal,
  listarLocaisCadastro,
  situacaoLocal,
} from '../api-cadastro-estoque.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';

const { t } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['suprimentos', 'cadastro', 'apoio'], queryFn: apoioCadastroEstoque });
const locais = useQuery({ queryKey: ['suprimentos', 'cadastro', 'locais'], queryFn: listarLocaisCadastro });
const vazio = (): LocalEstoqueEntrada => ({
  codigo: '',
  nome: '',
  tipo: 'almoxarifado',
  setor: null,
  centroCusto: null,
  localOrigem: null,
  localDevolucao: null,
  atendeSetor: true,
  atendePaciente: false,
  atendeTransferencia: false,
  atendimentoParcial: true,
  verificaSaldo: true,
  usaCodigoBarras: false,
  apenasUrgente: false,
  tipoReposicao: null,
  horasAntecedencia: null,
  setores: [],
  classificacoes: [],
});
const f = ref<LocalEstoqueEntrada>(vazio());
const id = ref<number | null>(null);
const versao = ref(0);
const ativo = ref(true);
const motivo = ref('');
const erro = ref<unknown>(null);
const ok = ref(false);
const novoSetor = ref('');
const novoGrupo = ref('');
const BOOLS = [
  'atendeSetor',
  'atendePaciente',
  'atendeTransferencia',
  'atendimentoParcial',
  'usaCodigoBarras',
  'apenasUrgente',
] as const;

function novo() {
  f.value = vazio();
  id.value = null;
  erro.value = null;
  ok.value = false;
}
async function abrir(x: number) {
  erro.value = null;
  ok.value = false;
  const { id: i, versao: v, ativo: a, ...resto } = await fichaLocalEdicao(x);
  f.value = resto;
  id.value = i;
  versao.value = v;
  ativo.value = a;
}
async function salvar() {
  erro.value = null;
  try {
    const r = id.value ? await alterarLocal(id.value, versao.value, f.value) : await incluirLocal(f.value);
    await qc.invalidateQueries({ queryKey: ['suprimentos', 'cadastro'] });
    await abrir(r.id);
    ok.value = true;
  } catch (e) {
    erro.value = e;
  }
}
async function trocarSituacao() {
  if (!id.value) return;
  erro.value = null;
  try {
    await situacaoLocal(id.value, versao.value, !ativo.value, motivo.value);
    motivo.value = '';
    await qc.invalidateQueries({ queryKey: ['suprimentos', 'cadastro'] });
    await abrir(id.value);
  } catch (e) {
    erro.value = e;
  }
}
const nomeDe = (lista: { id: number; nome: string }[] | undefined, x: number | null | undefined) =>
  lista?.find((o) => o.id === x)?.nome ?? String(x);
function incluirSetor() {
  const s = Number(novoSetor.value);
  if (s && !f.value.setores.some((x) => x.setor === s))
    f.value = {
      ...f.value,
      setores: [...f.value.setores, { setor: s, tipo: 'ambos', padrao: !f.value.setores.length }],
    };
  novoSetor.value = '';
}
/** Troca o tipo de atendimento de um setor já incluído. */
function mudarTipoSetor(i: number, tipo: 'requisicao' | 'dispensacao' | 'ambos') {
  f.value = { ...f.value, setores: f.value.setores.map((s, k) => (k === i ? { ...s, tipo } : s)) };
}
function removerSetor(i: number) {
  f.value = { ...f.value, setores: f.value.setores.filter((_, k) => k !== i) };
}
function removerGrupo(i: number) {
  f.value = { ...f.value, classificacoes: f.value.classificacoes.filter((_, k) => k !== i) };
}
function incluirGrupo() {
  const g = Number(novoGrupo.value);
  if (g && !f.value.classificacoes.some((x) => x.grupo === g))
    f.value = { ...f.value, classificacoes: [...f.value.classificacoes, { grupo: g }] };
  novoGrupo.value = '';
}
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="loc-cad-titulo"
    data-testid="tela-suprimentos-locais-cadastro"
  >
    <h1 id="loc-cad-titulo">{{ t('cadastroEstoque.local.titulo') }}</h1>
    <p>{{ t('cadastroEstoque.local.texto') }}</p>
    <div class="filtros">
      <table class="tabela" data-testid="locais-cadastro-lista">
        <caption>
          {{
            t('cadastroEstoque.local.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastroEstoque.codigo') }}</th>
            <th scope="col">{{ t('cadastroEstoque.nome') }}</th>
            <th scope="col">{{ t('cadastroEstoque.local.usuarios') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in locais.data.value ?? []" :key="l.id">
            <td>{{ l.codigo }}</td>
            <td>
              <button
                type="button"
                class="link"
                :data-testid="`local-abrir-${l.codigo}`"
                @click="abrir(l.id)"
              >
                {{ l.nome }}
              </button>
              <small v-if="!l.ativo"> · {{ t('cadastroEstoque.inativo') }}</small>
            </td>
            <td>{{ l.usuarios }}</td>
          </tr>
        </tbody>
      </table>
      <form class="painel" data-testid="local-form" @submit.prevent="salvar">
        <p>
          <button type="button" class="botao" @click="novo">{{ t('cadastroEstoque.novo') }}</button>
        </p>
        <label class="campo"
          >{{ t('cadastroEstoque.codigo') }}
          <input v-model="f.codigo" maxlength="30" required data-testid="local-codigo"
        /></label>
        <label class="campo"
          >{{ t('cadastroEstoque.nome') }}
          <input v-model="f.nome" maxlength="150" required data-testid="local-nome"
        /></label>
        <SanteSelecao
          v-model="f.tipo"
          :rotulo="t('cadastroEstoque.tipo')"
          :opcoes="[
            ...TIPOS_LOCAL_ESTOQUE.map((x) => ({ valor: x, rotulo: t(`cadastroEstoque.local.tipos.${x}`) })),
          ]"
          class="campo"
          data-testid="local-tipo"
        />
        <SanteSelecao
          :model-value="f.centroCusto ?? null"
          @update:model-value="(v) => (f = { ...f, centroCusto: v })"
          :rotulo="t('cadastroEstoque.local.centroCusto')"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...(apoio.data.value?.centrosCusto ?? []).map((o) => ({
              valor: o.id,
              rotulo: `${o.codigo} · ${o.nome}`,
            })),
          ]"
          class="campo"
          data-testid="local-centro"
        />
        <SanteSelecao
          :model-value="f.setor ?? null"
          @update:model-value="(v) => (f = { ...f, setor: v })"
          :rotulo="t('cadastroEstoque.local.setor')"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...(apoio.data.value?.setores ?? []).map((o) => ({ valor: o.id, rotulo: o.nome })),
          ]"
          class="campo"
        />
        <SanteSelecao
          :model-value="f.localOrigem ?? null"
          @update:model-value="(v) => (f = { ...f, localOrigem: v })"
          :rotulo="t('cadastroEstoque.local.localOrigem')"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...(apoio.data.value?.locais ?? []).map((o) => ({ valor: o.id, rotulo: o.nome })),
          ]"
          class="campo"
        />
        <SanteSelecao
          :model-value="f.localDevolucao ?? null"
          @update:model-value="(v) => (f = { ...f, localDevolucao: v })"
          :rotulo="t('cadastroEstoque.local.localDevolucao')"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...(apoio.data.value?.locais ?? []).map((o) => ({ valor: o.id, rotulo: o.nome })),
          ]"
          class="campo"
        />
        <SanteSelecao
          :model-value="f.tipoReposicao ?? null"
          @update:model-value="(v) => (f = { ...f, tipoReposicao: v })"
          :rotulo="t('cadastroEstoque.local.tipoReposicao')"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...(['manual', 'ponto_pedido', 'cota'] as const).map((x) => ({
              valor: x,
              rotulo: t(`cadastroEstoque.local.reposicoes.${x}`),
            })),
          ]"
          class="campo"
        />
        <label class="campo"
          >{{ t('cadastroEstoque.local.horasAntecedencia') }}
          <input v-model.number="f.horasAntecedencia" type="number" min="0" max="720"
        /></label>
        <fieldset>
          <label v-for="k in BOOLS" :key="k"
            ><input v-model="f[k]" type="checkbox" /> {{ t(`cadastroEstoque.local.${k}`) }}</label
          >
          <p>{{ t('cadastroEstoque.local.saldoSempreConferido') }}</p>
        </fieldset>
        <fieldset>
          <legend>{{ t('cadastroEstoque.local.setores') }}</legend>
          <ul>
            <li v-for="(s, i) in f.setores" :key="s.setor">
              {{ nomeDe(apoio.data.value?.setores, s.setor) }}
              <SanteSelecao
                :model-value="s.tipo"
                @update:model-value="(v) => mudarTipoSetor(i, v)"
                :rotulo="t('cadastroEstoque.tipo')"
                ocultar-rotulo
                :opcoes="[
                  ...(['requisicao', 'dispensacao', 'ambos'] as const).map((x) => ({
                    valor: x,
                    rotulo: t(`cadastroEstoque.local.atendimento.${x}`),
                  })),
                ]"
              />
              <button type="button" class="link" @click="removerSetor(i)">
                {{ t('cadastroEstoque.remover') }}
              </button>
            </li>
          </ul>
          <SanteSelecao
            v-model="novoSetor"
            :rotulo="t('cadastroEstoque.local.setores')"
            ocultar-rotulo
            :opcoes="[
              { valor: '', rotulo: t('cadastroEstoque.escolha') },
              ...(apoio.data.value?.setores ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
            ]"
            @update:model-value="incluirSetor"
          />
        </fieldset>
        <fieldset>
          <legend>{{ t('cadastroEstoque.local.classificacoes') }}</legend>
          <ul>
            <li v-for="(c, i) in f.classificacoes" :key="`${c.grupo}`">
              {{ nomeDe(apoio.data.value?.grupos, c.grupo) }}
              <button type="button" class="link" @click="removerGrupo(i)">
                {{ t('cadastroEstoque.remover') }}
              </button>
            </li>
          </ul>
          <SanteSelecao
            v-model="novoGrupo"
            :rotulo="t('cadastroEstoque.local.classificacoes')"
            ocultar-rotulo
            :opcoes="[
              { valor: '', rotulo: t('cadastroEstoque.escolha') },
              ...(apoio.data.value?.grupos ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
            ]"
            data-testid="local-grupo"
            @update:model-value="incluirGrupo"
          />
        </fieldset>
        <ErroSuprimentos v-if="erro" :erro="erro" />
        <p v-if="ok" role="status" data-testid="local-ok">{{ t('cadastroEstoque.salvo') }}</p>
        <button type="submit" class="botao primario" data-testid="local-salvar">
          {{ t('cadastroEstoque.salvar') }}
        </button>
        <template v-if="id">
          <label class="campo"
            >{{ t('cadastroEstoque.motivo') }}
            <input v-model="motivo" maxlength="500" data-testid="local-motivo"
          /></label>
          <button type="button" class="botao" data-testid="local-situacao" @click="trocarSituacao">
            {{ ativo ? t('cadastroEstoque.inativar') : t('cadastroEstoque.reativar') }}
          </button>
        </template>
      </form>
    </div>
  </section>
</template>
