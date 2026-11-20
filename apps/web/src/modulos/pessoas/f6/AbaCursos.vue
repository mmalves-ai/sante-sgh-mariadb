<script setup lang="ts">
// Catálogo de cursos (M52.6; regra 20): conteúdo programático, carga mínima, validade em meses e o público
// obrigatório (todos, por unidade ou por função). O curso inativado não some (o histórico continua).
import {
  type AlvoCursoEntrada,
  type ApoioTreinamento,
  CATEGORIAS_CURSO,
  type CategoriaCurso,
  CODIGOS_CATEGORIA_CURSO,
  type CursoResposta,
  esquemaAlterarCurso,
  esquemaCurso,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { alterarCurso, incluirCurso, lerCursos } from './api-f6.js';

const props = defineProps<{ apoio: ApoioTreinamento }>();
const { t } = useI18n();
const cliente = useQueryClient();
const cursos = useQuery({ queryKey: ['f6', 'cursos'], queryFn: lerCursos });
const lista = computed(() => cursos.data.value?.itens ?? null);

const editando = ref(false);
const id = ref<number | null>(null);
const versao = ref(0);
const codigo = ref('');
const titulo = ref('');
const conteudo = ref('');
const categoria = ref<CategoriaCurso>('nr32');
const carga = ref('240');
const validade = ref('12');
const obrigatorio = ref<'sim' | 'nao'>('sim');
const ativo = ref<'sim' | 'nao'>('sim');
const alvos = ref<AlvoCursoEntrada[]>([]);
const novaUnidade = ref<number | null>(null);
const novaFuncao = ref('');
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);

const opcoesCategoria = CODIGOS_CATEGORIA_CURSO.map((c) => ({ valor: c, rotulo: CATEGORIAS_CURSO[c] }));
const opcoesUnidade = computed(() =>
  props.apoio.unidades.map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
);
const opcoesSimNao = (sim: string, nao: string) => [
  { valor: 'sim' as const, rotulo: sim },
  { valor: 'nao' as const, rotulo: nao },
];

function abrir(c: CursoResposta | null): void {
  editando.value = true;
  erro.value = null;
  id.value = c?.id ?? null;
  versao.value = c?.versao ?? 0;
  codigo.value = c?.codigo ?? '';
  titulo.value = c?.titulo ?? '';
  conteudo.value = c?.conteudo ?? '';
  categoria.value = c?.categoria ?? 'nr32';
  carga.value = String(c?.cargaMinimaMin ?? 240);
  validade.value = String(c?.validadeMeses ?? 12);
  obrigatorio.value = c && !c.obrigatorio ? 'nao' : 'sim';
  ativo.value = c && !c.ativo ? 'nao' : 'sim';
  alvos.value = (c?.alvos ?? []).map((a) => ({ tipo: a.tipo, valor: a.valor }));
}
function incluirUnidade(): void {
  if (novaUnidade.value === null) return;
  const v = String(novaUnidade.value);
  if (!alvos.value.some((a) => a.tipo === 'unidade' && a.valor === v))
    alvos.value.push({ tipo: 'unidade', valor: v });
  novaUnidade.value = null;
}
function incluirFuncao(): void {
  const v = novaFuncao.value.trim();
  if (v && !alvos.value.some((a) => a.tipo === 'funcao' && a.valor.toUpperCase() === v.toUpperCase()))
    alvos.value.push({ tipo: 'funcao', valor: v });
  novaFuncao.value = '';
}
const rotuloAlvo = (a: AlvoCursoEntrada) =>
  a.tipo === 'unidade'
    ? `${t('f6.treinamentos.cursos.unidade')}: ${props.apoio.unidades.find((u) => String(u.codigo) === a.valor)?.rotulo ?? a.valor}`
    : `${t('f6.treinamentos.cursos.funcao')}: ${a.valor}`;
const base = computed(() => ({
  codigo: codigo.value.trim().toUpperCase(),
  titulo: titulo.value.trim(),
  conteudo: conteudo.value.trim(),
  categoria: categoria.value,
  cargaMinimaMin: Number(carga.value),
  validadeMeses: Number(validade.value),
  obrigatorio: obrigatorio.value === 'sim',
  alvos: alvos.value,
}));
const entrada = computed(() =>
  id.value === null
    ? esquemaCurso.safeParse(base.value)
    : esquemaAlterarCurso.safeParse({
        ...base.value,
        curso: id.value,
        ativo: ativo.value === 'sim',
        versao: versao.value,
      }),
);
async function gravar(): Promise<void> {
  const e = entrada.value;
  if (!e.success) return;
  erro.value = null;
  try {
    const r =
      id.value === null
        ? await incluirCurso(esquemaCurso.parse(base.value))
        : await alterarCurso(esquemaAlterarCurso.parse(e.data));
    aviso.value = r.mensagem;
    editando.value = false;
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="treino-cursos" data-testid="treino-cursos">
    <h2 id="treino-cursos">{{ t('f6.treinamentos.abas.cursos') }}</h2>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="cursos-aviso" />
    <ErroPessoas v-if="cursos.isError.value" :erro="cursos.error.value" />
    <p v-else-if="!lista" role="status">{{ t('f6.carregando') }}</p>
    <p v-else-if="lista.length === 0">{{ t('f6.treinamentos.cursos.semCursos') }}</p>
    <table v-else class="tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('f6.treinamentos.cursos.codigo') }}</th>
          <th scope="col">{{ t('f6.treinamentos.cursos.tituloCurso') }}</th>
          <th scope="col">{{ t('f6.treinamentos.cursos.carga') }}</th>
          <th scope="col">{{ t('f6.treinamentos.cursos.validade') }}</th>
          <th scope="col">{{ t('f6.treinamentos.cursos.publico') }}</th>
          <th scope="col"><span class="secundario">—</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in lista" :key="c.id" :class="{ inativo: !c.ativo }" :data-testid="`curso-${c.codigo}`">
          <th scope="row">{{ c.codigo }}</th>
          <td>
            {{ c.titulo }}
            <div class="secundario">
              {{ CATEGORIAS_CURSO[c.categoria] }} ·
              {{
                c.obrigatorio
                  ? t('f6.treinamentos.cursos.obrigatorioSim')
                  : t('f6.treinamentos.cursos.obrigatorioNao')
              }}
              <template v-if="!c.ativo"> · {{ t('f6.treinamentos.cursos.ativoNao') }}</template>
            </div>
          </td>
          <td>{{ c.cargaMinimaMin }}</td>
          <td>{{ c.validadeMeses }}</td>
          <td>
            {{
              c.alvos.length === 0
                ? t('f6.treinamentos.cursos.publicoTodos')
                : c.alvos.map((a) => a.rotulo).join('; ')
            }}
          </td>
          <td>
            <SanteBotao
              v-if="apoio.acoes.registrar"
              :rotulo="t('f6.treinamentos.cursos.alterar')"
              variante="texto"
              :data-testid="`alterar-curso-${c.codigo}`"
              @acionar="abrir(c)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div class="acoes">
      <SanteBotao
        v-if="apoio.acoes.registrar && !editando"
        :rotulo="t('f6.treinamentos.cursos.novo')"
        data-testid="novo-curso"
        @acionar="abrir(null)"
      />
    </div>
  </section>
  <form
    v-if="editando"
    class="bloco"
    :aria-label="t('f6.treinamentos.cursos.novo')"
    data-testid="form-curso"
    @submit.prevent="gravar"
  >
    <h2>
      {{
        id === null ? t('f6.treinamentos.cursos.novo') : `${t('f6.treinamentos.cursos.alterar')} ${codigo}`
      }}
    </h2>
    <div class="campos">
      <SanteCampoTexto
        v-model="codigo"
        :rotulo="t('f6.treinamentos.cursos.codigo')"
        :max-bytes="20"
        data-testid="curso-codigo"
      />
      <SanteCampoTexto
        v-model="titulo"
        :rotulo="t('f6.treinamentos.cursos.tituloCurso')"
        :max-bytes="120"
        data-testid="curso-titulo"
      />
      <SanteSelecao
        v-model="categoria"
        :rotulo="t('f6.treinamentos.cursos.categoria')"
        :opcoes="opcoesCategoria"
        data-testid="curso-categoria"
      />
      <SanteCampoTexto
        v-model="carga"
        :rotulo="t('f6.treinamentos.cursos.carga')"
        :max-bytes="5"
        data-testid="curso-carga"
      />
      <SanteCampoTexto
        v-model="validade"
        :rotulo="t('f6.treinamentos.cursos.validade')"
        :max-bytes="3"
        data-testid="curso-validade"
      />
    </div>
    <SanteCampoTexto
      v-model="conteudo"
      :rotulo="t('f6.treinamentos.cursos.conteudo')"
      :max-bytes="2000"
      data-testid="curso-conteudo"
    />
    <SanteOpcoes
      v-model="obrigatorio"
      :legenda="t('f6.treinamentos.cursos.obrigatorio')"
      :opcoes="
        opcoesSimNao(t('f6.treinamentos.cursos.obrigatorioSim'), t('f6.treinamentos.cursos.obrigatorioNao'))
      "
      data-testid="curso-obrigatorio"
    />
    <SanteOpcoes
      v-if="id !== null"
      v-model="ativo"
      :legenda="t('f6.treinamentos.cursos.ativo')"
      :opcoes="opcoesSimNao(t('f6.treinamentos.cursos.ativoSim'), t('f6.treinamentos.cursos.ativoNao'))"
      data-testid="curso-ativo"
    />
    <fieldset class="bloco">
      <legend>{{ t('f6.treinamentos.cursos.publico') }}</legend>
      <p v-if="alvos.length === 0">{{ t('f6.treinamentos.cursos.publicoTodos') }}</p>
      <ul v-else>
        <li v-for="(a, i) in alvos" :key="`${a.tipo}-${a.valor}`" :data-testid="`alvo-${i}`">
          {{ rotuloAlvo(a) }}
          <SanteBotao
            :rotulo="t('f6.treinamentos.cursos.remover')"
            variante="texto"
            @acionar="alvos.splice(i, 1)"
          />
        </li>
      </ul>
      <div class="campos">
        <SanteSelecao
          v-model="novaUnidade"
          :rotulo="t('f6.treinamentos.cursos.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="curso-alvo-unidade"
        />
        <SanteBotao
          :rotulo="t('f6.treinamentos.cursos.incluirUnidade')"
          variante="secundario"
          data-testid="incluir-alvo-unidade"
          @acionar="incluirUnidade"
        />
        <SanteCampoTexto
          v-model="novaFuncao"
          :rotulo="t('f6.treinamentos.cursos.funcao')"
          :max-bytes="60"
          data-testid="curso-alvo-funcao"
        />
        <SanteBotao
          :rotulo="t('f6.treinamentos.cursos.incluirFuncao')"
          variante="secundario"
          data-testid="incluir-alvo-funcao"
          @acionar="incluirFuncao"
        />
      </div>
    </fieldset>
    <ErroPessoas v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="editando = false" />
      <SanteBotao
        :rotulo="t('f6.gravar')"
        tipo="submit"
        :desabilitado="!entrada.success"
        data-testid="curso-gravar"
      />
    </div>
  </form>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.inativo td,
.inativo th {
  color: var(--p-text-muted-color);
}
</style>
