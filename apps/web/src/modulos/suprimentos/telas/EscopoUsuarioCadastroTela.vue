<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Escopo do usuário no estoque (F3.6, 05-SUP linha 3): `/suprimentos/usuarios-estoque/escopo`. Busca o usuário e mostra
// uma grade local × ação (marca e grava a linha); grupos de itens e centros de custo com vigência. Retirar o local
// deixa a linha marcada sem ação; retirar a concessão fecha a vigência (o histórico fica na lista como encerrada).
import type { PermissaoLocalUsuario } from '@sgh/contratos/regras-suprimentos';
import { PERMISSOES_LOCAL_USUARIO } from '@sgh/contratos/regras-suprimentos';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apoioCadastroEstoque,
  buscarCadastro,
  concederCentroCusto,
  concederClassificacao,
  type EscopoCompletoUsuario,
  escopoDoUsuario,
  gravarEscopoLocal,
  type Opcao,
  retirarConcessao,
  retirarEscopoLocal,
} from '../api-cadastro-estoque.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';

const { t } = useI18n();
const apoio = useQuery({ queryKey: ['suprimentos', 'cadastro', 'apoio'], queryFn: apoioCadastroEstoque });
const termo = ref('');
const achados = ref<Opcao[]>([]);
const escopo = ref<EscopoCompletoUsuario | null>(null);
const grade = ref<Record<number, PermissaoLocalUsuario[]>>({});
const erro = ref<unknown>(null);
/** O motivo da retirada (vai à trilha); a concessão futura ou de hoje é cancelada, a que já valia é encerrada. */
const motivoRetirada = ref('');
const hoje = new Date().toISOString().slice(0, 10);
const podeRetirar = (x: { fim: string | null }) => !x.fim || x.fim >= hoje;
const novoLocal = ref('');
const cl = ref({
  por: 'grupo' as 'grupo' | 'despesa',
  grupo: '',
  despesa: '',
  inicio: '',
  fim: '',
  requisitar: true,
  movimentar: false,
  comprar: false,
});
/** O alvo da concessão: o grupo ou só a classificação de despesa (a que cobre todos os grupos ligados a ela). */
const alvoClassificacao = () =>
  cl.value.por === 'grupo'
    ? { grupo: Number(cl.value.grupo) }
    : { classificacaoDespesa: Number(cl.value.despesa) };
const cc = ref({ centro: '', inicio: '', fim: '', requisitar: true, movimentar: false });

async function buscar() {
  achados.value = termo.value.trim().length >= 2 ? await buscarCadastro('usuarios', termo.value.trim()) : [];
}
async function abrir(u: number) {
  erro.value = null;
  escopo.value = await escopoDoUsuario(u);
  grade.value = Object.fromEntries(escopo.value.locais.map((l) => [l.local, [...l.permissoes]]));
  achados.value = [];
  const hoje = apoio.data.value?.hoje ?? '';
  cl.value.inicio ||= hoje;
  cc.value.inicio ||= hoje;
}
async function tentar(fn: () => Promise<unknown>) {
  if (!escopo.value) return;
  erro.value = null;
  try {
    await fn();
    await abrir(escopo.value.usuario);
  } catch (e) {
    erro.value = e;
  }
}
const u = () => escopo.value!.usuario;
function alternar(local: number, p: PermissaoLocalUsuario) {
  const atual = grade.value[local] ?? [];
  grade.value = { ...grade.value, [local]: atual.includes(p) ? atual.filter((x) => x !== p) : [...atual, p] };
}
function incluirLocal() {
  const l = Number(novoLocal.value);
  if (l && !(l in grade.value)) grade.value = { ...grade.value, [l]: ['requisitar'] };
  novoLocal.value = '';
}
const nomeLocal = (l: number) =>
  escopo.value?.locais.find((x) => x.local === l)?.nome ??
  apoio.data.value?.locais.find((x) => x.id === l)?.nome ??
  String(l);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="esc-titulo" data-testid="tela-suprimentos-escopo-cadastro">
    <h1 id="esc-titulo">{{ t('cadastroEstoque.escopo.titulo') }}</h1>
    <p>{{ t('cadastroEstoque.escopo.texto') }}</p>
    <form class="filtros" @submit.prevent="buscar">
      <label class="campo"
        >{{ t('cadastroEstoque.escopo.buscarUsuario') }}
        <input v-model="termo" maxlength="60" data-testid="escopo-termo"
      /></label>
      <button type="submit" class="botao">{{ t('cadastroEstoque.escopo.buscarUsuario') }}</button>
    </form>
    <ul v-if="achados.length">
      <li v-for="a in achados" :key="a.id">
        <button type="button" class="link" :data-testid="`escopo-usuario-${a.codigo}`" @click="abrir(a.id)">
          {{ a.codigo }} · {{ a.nome }}
        </button>
      </li>
    </ul>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <template v-if="escopo">
      <h2>{{ escopo.login }} · {{ escopo.nome }}</h2>
      <table class="tabela" data-testid="escopo-grade">
        <caption>
          {{
            t('cadastroEstoque.escopo.locais')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastroEstoque.escopo.local') }}</th>
            <th v-for="p in PERMISSOES_LOCAL_USUARIO" :key="p" scope="col">
              {{ t(`cadastroEstoque.escopo.acoes.${p}`) }}
            </th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(perms, local) in grade" :key="local" :data-testid="`escopo-local-${local}`">
            <th scope="row">{{ nomeLocal(Number(local)) }}</th>
            <td v-for="p in PERMISSOES_LOCAL_USUARIO" :key="p">
              <input
                type="checkbox"
                :checked="perms.includes(p)"
                :aria-label="`${nomeLocal(Number(local))} ${t(`cadastroEstoque.escopo.acoes.${p}`)}`"
                @change="alternar(Number(local), p)"
              />
            </td>
            <td>
              <button
                type="button"
                class="botao"
                :data-testid="`escopo-gravar-${local}`"
                @click="tentar(() => gravarEscopoLocal(u(), Number(local), perms))"
              >
                {{ t('cadastroEstoque.salvar') }}
              </button>
              <button
                v-if="escopo.locais.some((x) => x.local === Number(local))"
                type="button"
                class="link"
                @click="tentar(() => retirarEscopoLocal(u(), Number(local)))"
              >
                {{ t('cadastroEstoque.escopo.retirar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <SanteSelecao
        v-model="novoLocal"
        :rotulo="t('cadastroEstoque.escopo.local')"
        ocultar-rotulo
        :opcoes="[
          { valor: '', rotulo: t('cadastroEstoque.escopo.conceder') },
          ...(apoio.data.value?.locais ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
        ]"
        data-testid="escopo-novo-local"
        @update:model-value="incluirLocal"
      />

      <label
        >{{ t('cadastroEstoque.escopo.motivoRetirada') }}
        <input v-model="motivoRetirada" maxlength="500" data-testid="escopo-motivo-retirada"
      /></label>
      <h3>{{ t('cadastroEstoque.escopo.classificacoes') }}</h3>
      <ul>
        <li v-for="x in escopo.classificacoes" :key="x.id" :data-testid="`escopo-classificacao-${x.id}`">
          <template v-if="x.despesa">{{ t('cadastroEstoque.escopo.despesa') }}: </template>{{ x.nome }} ·
          {{ `${x.inicio} – ${x.fim ?? '…'}` }} · {{ x.permissoes.join(', ') }} ·
          {{ x.vigente ? t('cadastroEstoque.escopo.vigente') : t('cadastroEstoque.escopo.encerrada') }}
          <button
            v-if="podeRetirar(x)"
            type="button"
            class="link"
            :disabled="motivoRetirada.trim().length < 5"
            :title="t('cadastroEstoque.escopo.motivoRetirada')"
            @click="tentar(() => retirarConcessao('classificacao', x.id, motivoRetirada))"
          >
            {{ t('cadastroEstoque.escopo.retirar') }}
          </button>
        </li>
      </ul>
      <form
        class="filtros"
        @submit.prevent="
          tentar(() =>
            concederClassificacao(u(), {
              ...alvoClassificacao(),
              inicio: cl.inicio,
              fim: cl.fim || null,
              requisitar: cl.requisitar,
              movimentar: cl.movimentar,
              comprar: cl.comprar,
            }),
          )
        "
      >
        <SanteSelecao
          v-model="cl.por"
          :rotulo="t('cadastroEstoque.escopo.concederPor')"
          ocultar-rotulo
          :opcoes="[
            { valor: 'grupo', rotulo: t('cadastroEstoque.escopo.porGrupo') },
            { valor: 'despesa', rotulo: t('cadastroEstoque.escopo.porDespesa') },
          ]"
          data-testid="escopo-conceder-por"
        />
        <SanteSelecao
          v-if="cl.por === 'grupo'"
          v-model="cl.grupo"
          :rotulo="t('cadastroEstoque.item.grupo')"
          ocultar-rotulo
          :opcoes="[
            { valor: '', rotulo: t('cadastroEstoque.escolha') },
            ...(apoio.data.value?.grupos ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
          ]"
          obrigatorio
        />
        <SanteSelecao
          v-else
          v-model="cl.despesa"
          :rotulo="t('cadastroEstoque.escopo.despesa')"
          ocultar-rotulo
          :opcoes="[
            { valor: '', rotulo: t('cadastroEstoque.escolha') },
            ...(apoio.data.value?.despesas ?? []).map((o) => ({
              valor: String(o.id),
              rotulo: `${o.codigo} · ${o.nome}`,
            })),
          ]"
          obrigatorio
          data-testid="escopo-despesa"
        />
        <label
          >{{ t('cadastroEstoque.escopo.inicio') }} <input v-model="cl.inicio" type="date" required
        /></label>
        <label>{{ t('cadastroEstoque.escopo.fim') }} <input v-model="cl.fim" type="date" /></label>
        <label
          ><input v-model="cl.requisitar" type="checkbox" />
          {{ t('cadastroEstoque.escopo.requisitar') }}</label
        >
        <label
          ><input v-model="cl.movimentar" type="checkbox" />
          {{ t('cadastroEstoque.escopo.movimentar') }}</label
        >
        <label
          ><input v-model="cl.comprar" type="checkbox" /> {{ t('cadastroEstoque.escopo.comprar') }}</label
        >
        <button type="submit" class="botao">{{ t('cadastroEstoque.escopo.conceder') }}</button>
      </form>

      <h3>{{ t('cadastroEstoque.escopo.centros') }}</h3>
      <ul>
        <li v-for="x in escopo.centrosCusto" :key="x.id">
          {{ x.nome }} · {{ `${x.inicio} – ${x.fim ?? '…'}` }} · {{ x.permissoes.join(', ') }} ·
          {{ x.vigente ? t('cadastroEstoque.escopo.vigente') : t('cadastroEstoque.escopo.encerrada') }}
          <button
            v-if="podeRetirar(x)"
            type="button"
            class="link"
            :disabled="motivoRetirada.trim().length < 5"
            :title="t('cadastroEstoque.escopo.motivoRetirada')"
            @click="tentar(() => retirarConcessao('centro-custo', x.id, motivoRetirada))"
          >
            {{ t('cadastroEstoque.escopo.retirar') }}
          </button>
        </li>
      </ul>
      <form
        class="filtros"
        @submit.prevent="
          tentar(() =>
            concederCentroCusto(u(), {
              centroCusto: Number(cc.centro),
              inicio: cc.inicio,
              fim: cc.fim || null,
              requisitar: cc.requisitar,
              movimentar: cc.movimentar,
            }),
          )
        "
      >
        <SanteSelecao
          v-model="cc.centro"
          :rotulo="t('cadastroEstoque.local.centroCusto')"
          ocultar-rotulo
          :opcoes="[
            { valor: '', rotulo: t('cadastroEstoque.escolha') },
            ...(apoio.data.value?.centrosCusto ?? []).map((o) => ({
              valor: String(o.id),
              rotulo: `${o.codigo} · ${o.nome}`,
            })),
          ]"
          obrigatorio
        />
        <label
          >{{ t('cadastroEstoque.escopo.inicio') }} <input v-model="cc.inicio" type="date" required
        /></label>
        <label>{{ t('cadastroEstoque.escopo.fim') }} <input v-model="cc.fim" type="date" /></label>
        <label
          ><input v-model="cc.requisitar" type="checkbox" />
          {{ t('cadastroEstoque.escopo.requisitar') }}</label
        >
        <label
          ><input v-model="cc.movimentar" type="checkbox" />
          {{ t('cadastroEstoque.escopo.movimentar') }}</label
        >
        <button type="submit" class="botao">{{ t('cadastroEstoque.escopo.conceder') }}</button>
      </form>
    </template>
  </section>
</template>
