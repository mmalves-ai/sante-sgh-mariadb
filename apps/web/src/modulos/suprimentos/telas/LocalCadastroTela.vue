<script setup lang="ts">
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
  'verificaSaldo',
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
        <label class="campo"
          >{{ t('cadastroEstoque.tipo') }}
          <select v-model="f.tipo" data-testid="local-tipo">
            <option v-for="x in TIPOS_LOCAL_ESTOQUE" :key="x" :value="x">
              {{ t(`cadastroEstoque.local.tipos.${x}`) }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.local.centroCusto') }}
          <select v-model="f.centroCusto" data-testid="local-centro">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="o in apoio.data.value?.centrosCusto ?? []" :key="o.id" :value="o.id">
              {{ o.codigo }} · {{ o.nome }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.local.setor') }}
          <select v-model="f.setor">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="o in apoio.data.value?.setores ?? []" :key="o.id" :value="o.id">
              {{ o.nome }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.local.localOrigem') }}
          <select v-model="f.localOrigem">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="o in apoio.data.value?.locais ?? []" :key="o.id" :value="o.id">
              {{ o.nome }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.local.localDevolucao') }}
          <select v-model="f.localDevolucao">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="o in apoio.data.value?.locais ?? []" :key="o.id" :value="o.id">
              {{ o.nome }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.local.tipoReposicao') }}
          <select v-model="f.tipoReposicao">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="x in ['manual', 'ponto_pedido', 'cota'] as const" :key="x" :value="x">
              {{ t(`cadastroEstoque.local.reposicoes.${x}`) }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.local.horasAntecedencia') }}
          <input v-model.number="f.horasAntecedencia" type="number" min="0" max="720"
        /></label>
        <fieldset>
          <label v-for="k in BOOLS" :key="k"
            ><input v-model="f[k]" type="checkbox" /> {{ t(`cadastroEstoque.local.${k}`) }}</label
          >
        </fieldset>
        <fieldset>
          <legend>{{ t('cadastroEstoque.local.setores') }}</legend>
          <ul>
            <li v-for="(s, i) in f.setores" :key="s.setor">
              {{ nomeDe(apoio.data.value?.setores, s.setor) }}
              <select v-model="s.tipo" :aria-label="t('cadastroEstoque.tipo')">
                <option v-for="x in ['requisicao', 'dispensacao', 'ambos'] as const" :key="x" :value="x">
                  {{ t(`cadastroEstoque.local.atendimento.${x}`) }}
                </option>
              </select>
              <button type="button" class="link" @click="f.setores.splice(i, 1)">
                {{ t('cadastroEstoque.remover') }}
              </button>
            </li>
          </ul>
          <select v-model="novoSetor" :aria-label="t('cadastroEstoque.local.setores')" @change="incluirSetor">
            <option value="">{{ t('cadastroEstoque.escolha') }}</option>
            <option v-for="o in apoio.data.value?.setores ?? []" :key="o.id" :value="String(o.id)">
              {{ o.nome }}
            </option>
          </select>
        </fieldset>
        <fieldset>
          <legend>{{ t('cadastroEstoque.local.classificacoes') }}</legend>
          <ul>
            <li v-for="(c, i) in f.classificacoes" :key="`${c.grupo}`">
              {{ nomeDe(apoio.data.value?.grupos, c.grupo) }}
              <button type="button" class="link" @click="f.classificacoes.splice(i, 1)">
                {{ t('cadastroEstoque.remover') }}
              </button>
            </li>
          </ul>
          <select
            v-model="novoGrupo"
            :aria-label="t('cadastroEstoque.local.classificacoes')"
            data-testid="local-grupo"
            @change="incluirGrupo"
          >
            <option value="">{{ t('cadastroEstoque.escolha') }}</option>
            <option v-for="o in apoio.data.value?.grupos ?? []" :key="o.id" :value="String(o.id)">
              {{ o.nome }}
            </option>
          </select>
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
