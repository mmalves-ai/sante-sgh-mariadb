<script setup lang="ts">
// Respostas e textos padrão na ficha do exame (F3.5, análise 05-SADT linha 3), dentro de `/sadt/catalogo`. Num lugar
// só, sem sair do exame: o grupo de respostas fechadas de cada analito do exame (escolhido por seletor), a manutenção
// do grupo com as respostas na mesma gravação (ordem, atalho, anormal, crítica, sugerida; sair é inativar) e os textos
// padrão do exame (observação pronta com atalho). Melhorias: a regra do domínio (validarGrupoResposta e
// validarTextoPadrao) confere tudo na hora, antes de enviar; a alteração vai com a versão vista; nada se apaga.
import {
  APLICACOES_TEXTO_PADRAO,
  TIPOS_GRUPO_RESPOSTA,
  validarGrupoResposta,
  validarTextoPadrao,
} from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { z } from 'zod';
import { enviar, ler } from '../../exames/api-exames.js';
import { novaChave } from '../api-sadt.js';

type Linha = Record<string, unknown>;
type ValorCombo = string | number | null;
const props = defineProps<{ exameId: number; analitos: readonly Linha[] }>();
const emit = defineEmits<{ gravado: [] }>();
const B = '/api/sadt/catalogo';
const qualquer = z.any();

const T = {
  titulo: 'Respostas e textos padrão',
  porAnalito: 'Respostas de cada analito do exame',
  semAnalito: 'O exame ainda não tem analito ativo.',
  grupoDe: 'Grupo de respostas de',
  semGrupo: 'Sem grupo (valor digitado)',
  grupos: 'Grupos de respostas',
  novoGrupo: 'Novo grupo',
  codigo: 'Código',
  descricao: 'Descrição',
  tipo: 'Tipo',
  textoLivre: 'Aceita texto digitado além das respostas',
  ativo: 'Ativo',
  ordem: 'Ordem',
  resposta: 'Resposta',
  atalho: 'Atalho',
  anormal: 'Anormal',
  critica: 'Crítica',
  sugerida: 'Sugerida',
  ativa: 'Ativa',
  maisResposta: 'Mais uma resposta',
  gravarGrupo: 'Gravar grupo',
  emUso: 'analito(s) de exame usam este grupo',
  textos: 'Textos padrão deste exame',
  tituloTexto: 'Título',
  texto: 'Texto',
  aplicacao: 'Aplicação',
  gravarTexto: 'Gravar texto',
  novoTexto: 'Novo texto',
  inativar: 'Inativar',
  editar: 'Alterar',
  grupoGravado: 'Grupo de respostas gravado.',
  textoGravado: 'Texto padrão gravado.',
  ligado: 'Grupo do analito gravado.',
} as const;

const erro = ref('');
const aviso = ref('');
const grupos = ref<Linha[]>([]);
const textos = ref<Linha[]>([]);
const g = reactive<Linha>({});
const respostas = ref<Linha[]>([]);
const t = reactive<Linha>({});
const grupoAberto = computed(() => g['codigo'] !== undefined);
const textoAberto = computed(() => t['codigo'] !== undefined);

const txt = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const ouNulo = (v: unknown) => (txt(v).trim() === '' ? null : txt(v).trim());
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const opFixas = (xs: readonly string[]) => xs.map((x) => ({ valor: x as ValorCombo, rotulo: x }));
const opGrupos = computed(() => [
  { valor: '' as ValorCombo, rotulo: T.semGrupo },
  ...grupos.value
    .filter((x) => x['ativo'])
    .map((x) => ({
      valor: Number(x['id']) as ValorCombo,
      rotulo: `${txt(x['descricao'])} (${txt(x['codigo'])})`,
    })),
]);
const analitosAtivos = computed(() => props.analitos.filter((a) => a['ativo'] && !a['calculado']));

async function carregar() {
  grupos.value = (await ler(`${B}/grupos-resposta?termo=`, qualquer)) as Linha[];
  textos.value = (await ler(`${B}/textos-padrao?exame=${props.exameId}`, qualquer)) as Linha[];
}
async function tentar(fn: () => Promise<void>, ok: string) {
  erro.value = '';
  aviso.value = '';
  try {
    await fn();
    aviso.value = ok;
    await carregar();
    emit('gravado');
  } catch (e) {
    erro.value = mensagem(e);
  }
}
onMounted(() => carregar().catch((e) => (erro.value = mensagem(e))));
watch(
  () => props.exameId,
  () => {
    fecharTexto();
    carregar().catch((e) => (erro.value = mensagem(e)));
  },
);

// ── Grupo do analito no exame ────────────────────────────────────────────────────────────────────────────────────
const ligar = (a: Linha, grupo: ValorCombo) =>
  tentar(async () => {
    await enviar(
      `${B}/exames/${props.exameId}/analito`,
      {
        id: Number(a['id']),
        versao: Number(a['versao']),
        grupoRespostaId: grupo === '' ? null : Number(grupo),
      },
      qualquer,
      novaChave('catalogo.analito.grupo'),
    );
  }, T.ligado);
const grupoDoAnalito = (a: Linha): ValorCombo =>
  a['grupoRespostaId'] === null || a['grupoRespostaId'] === undefined ? '' : Number(a['grupoRespostaId']);

// ── Grupo de respostas ───────────────────────────────────────────────────────────────────────────────────────────
const respostaVazia = (): Linha => ({
  sequencia: respostas.value.reduce((m, r) => Math.max(m, Number(r['sequencia']) || 0), 0) + 1,
  codigo: '',
  descricao: '',
  mnemonico: '',
  anormal: false,
  critico: false,
  padrao: false,
  ativo: true,
});
function abrirGrupo(l: Linha | null) {
  for (const k of Object.keys(g)) delete g[k];
  Object.assign(
    g,
    l
      ? { ...l, respostas: undefined, emUso: Number(l['emUso'] ?? 0) }
      : { codigo: '', descricao: '', tipo: 'qualitativo', permiteTextoLivre: false, ativo: true, emUso: 0 },
  );
  respostas.value = l
    ? (l['respostas'] as Linha[]).map((r) => ({ ...r, mnemonico: txt(r['mnemonico']) }))
    : [];
  if (!l) respostas.value.push(respostaVazia());
}
const corpoRespostas = () =>
  respostas.value.map((r) => ({
    ...(r['id'] ? { id: Number(r['id']) } : {}),
    sequencia: Number(r['sequencia']),
    codigo: txt(r['codigo']).trim(),
    descricao: txt(r['descricao']).trim(),
    mnemonico: ouNulo(r['mnemonico']),
    anormal: Boolean(r['anormal']),
    critico: Boolean(r['critico']),
    padrao: Boolean(r['padrao']),
    ativo: Boolean(r['ativo']),
  }));
const falhasGrupo = computed(() =>
  grupoAberto.value
    ? validarGrupoResposta({
        codigo: txt(g['codigo']),
        descricao: txt(g['descricao']),
        tipo: txt(g['tipo']),
        ativo: Boolean(g['ativo']),
        respostas: corpoRespostas(),
      })
    : [],
);
const salvarGrupo = () =>
  tentar(async () => {
    const corpo = {
      ...(g['id'] ? { versao: Number(g['versao']) } : {}),
      codigo: txt(g['codigo']).trim(),
      descricao: txt(g['descricao']).trim(),
      tipo: txt(g['tipo']),
      permiteTextoLivre: Boolean(g['permiteTextoLivre']),
      ativo: Boolean(g['ativo']),
      respostas: corpoRespostas(),
    };
    await enviar(
      g['id'] ? `${B}/grupos-resposta/${Number(g['id'])}` : `${B}/grupos-resposta`,
      corpo,
      qualquer,
      novaChave('catalogo.grupo-resposta'),
    );
    for (const k of Object.keys(g)) delete g[k];
  }, T.grupoGravado);

// ── Texto padrão do exame ────────────────────────────────────────────────────────────────────────────────────────
function fecharTexto() {
  for (const k of Object.keys(t)) delete t[k];
}
function abrirTexto(l: Linha | null) {
  fecharTexto();
  Object.assign(
    t,
    l
      ? { ...l, mnemonico: txt(l['mnemonico']) }
      : { codigo: '', descricao: '', texto: '', mnemonico: '', aplicacao: 'resultado', ativo: true },
  );
}
const falhasTexto = computed(() =>
  textoAberto.value
    ? validarTextoPadrao({
        codigo: txt(t['codigo']),
        descricao: txt(t['descricao']),
        texto: txt(t['texto']),
        mnemonico: ouNulo(t['mnemonico']),
        aplicacao: txt(t['aplicacao']),
      })
    : [],
);
const salvarTexto = () =>
  tentar(async () => {
    await enviar(
      `${B}/textos-padrao`,
      {
        ...(t['id'] ? { id: Number(t['id']), versao: Number(t['versao']) } : {}),
        exameId: props.exameId,
        codigo: txt(t['codigo']).trim(),
        descricao: txt(t['descricao']).trim(),
        texto: txt(t['texto']).trim(),
        mnemonico: ouNulo(t['mnemonico']),
        aplicacao: txt(t['aplicacao']),
        ativo: Boolean(t['ativo']),
      },
      qualquer,
      novaChave('catalogo.texto-padrao'),
    );
    fecharTexto();
  }, T.textoGravado);
const inativarTexto = (l: Linha) =>
  tentar(async () => {
    await enviar(
      `${B}/textos-padrao`,
      { id: Number(l['id']), versao: Number(l['versao']), exameId: props.exameId, ativo: false },
      qualquer,
      novaChave('catalogo.texto-padrao.inativar'),
    );
  }, T.textoGravado);
</script>

<template>
  <section class="respostas-textos" data-testid="respostas-textos">
    <h2>{{ T.titulo }}</h2>
    <p v-if="erro" role="alert" class="erro" data-testid="respostas-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="respostas-aviso">{{ aviso }}</p>

    <h3>{{ T.porAnalito }}</h3>
    <p v-if="!analitosAtivos.length">{{ T.semAnalito }}</p>
    <ul v-else data-testid="grupo-por-analito">
      <li v-for="a in analitosAtivos" :key="String(a['id'])" class="linha">
        <span>{{ a['nomeAnalito'] ?? a['analitoId'] }}</span>
        <SanteSelecao
          :model-value="grupoDoAnalito(a)"
          :rotulo="`${T.grupoDe} ${a['nomeAnalito'] ?? a['analitoId']}`"
          ocultar-rotulo
          :opcoes="opGrupos"
          :data-testid="`grupo-analito-${a['id']}`"
          @update:model-value="(v: ValorCombo) => ligar(a, v)"
        />
      </li>
    </ul>

    <h3>{{ T.grupos }}</h3>
    <ul class="lista" data-testid="lista-grupos">
      <li v-for="x in grupos" :key="String(x['id'])">
        <button type="button" :class="{ inativo: !x['ativo'] }" @click="abrirGrupo(x)">
          {{ x['descricao'] }} ({{ x['codigo'] }})
        </button>
      </li>
    </ul>
    <SanteBotao :rotulo="T.novoGrupo" data-testid="novo-grupo" @acionar="abrirGrupo(null)" />
    <form v-if="grupoAberto" class="grupo" data-testid="form-grupo" @submit.prevent="salvarGrupo">
      <label>{{ T.codigo }} <input v-model="g['codigo']" name="codigo" maxlength="30" required /></label>
      <label
        >{{ T.descricao }} <input v-model="g['descricao']" name="descricao" maxlength="150" required
      /></label>
      <SanteSelecao
        :model-value="txt(g['tipo'])"
        :rotulo="T.tipo"
        :opcoes="opFixas(TIPOS_GRUPO_RESPOSTA)"
        data-testid="grupo-tipo"
        @update:model-value="(v: ValorCombo) => (g['tipo'] = v)"
      />
      <label
        ><input v-model="g['permiteTextoLivre']" type="checkbox" name="permiteTextoLivre" />
        {{ T.textoLivre }}</label
      >
      <label><input v-model="g['ativo']" type="checkbox" name="ativo" /> {{ T.ativo }}</label>
      <small v-if="Number(g['emUso']) > 0">{{ g['emUso'] }} {{ T.emUso }}</small>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ T.ordem }}</th>
            <th scope="col">{{ T.codigo }}</th>
            <th scope="col">{{ T.resposta }}</th>
            <th scope="col">{{ T.atalho }}</th>
            <th scope="col">{{ T.anormal }}</th>
            <th scope="col">{{ T.critica }}</th>
            <th scope="col">{{ T.sugerida }}</th>
            <th scope="col">{{ T.ativa }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in respostas" :key="i" :data-testid="`resposta-${i}`">
            <td>
              <input
                v-model.number="r['sequencia']"
                type="number"
                min="1"
                max="9999"
                :aria-label="`${T.ordem} ${i + 1}`"
                name="sequencia"
              />
            </td>
            <td>
              <input
                v-model="r['codigo']"
                maxlength="30"
                :aria-label="`${T.codigo} ${i + 1}`"
                name="codigo"
              />
            </td>
            <td>
              <input
                v-model="r['descricao']"
                maxlength="300"
                :aria-label="`${T.resposta} ${i + 1}`"
                name="descricao"
              />
            </td>
            <td>
              <input
                v-model="r['mnemonico']"
                maxlength="10"
                :aria-label="`${T.atalho} ${i + 1}`"
                name="mnemonico"
              />
            </td>
            <td>
              <input
                v-model="r['anormal']"
                type="checkbox"
                :aria-label="`${T.anormal} ${i + 1}`"
                name="anormal"
              />
            </td>
            <td>
              <input
                v-model="r['critico']"
                type="checkbox"
                :aria-label="`${T.critica} ${i + 1}`"
                name="critico"
              />
            </td>
            <td>
              <input
                v-model="r['padrao']"
                type="checkbox"
                :aria-label="`${T.sugerida} ${i + 1}`"
                name="padrao"
              />
            </td>
            <td>
              <input v-model="r['ativo']" type="checkbox" :aria-label="`${T.ativa} ${i + 1}`" name="ativo" />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        :rotulo="T.maisResposta"
        data-testid="mais-resposta"
        @acionar="respostas.push(respostaVazia())"
      />
      <ul v-if="falhasGrupo.length" class="erro" data-testid="falhas-grupo">
        <li v-for="(f, i) in falhasGrupo" :key="i">{{ f.mensagem }}</li>
      </ul>
      <SanteBotao
        :rotulo="T.gravarGrupo"
        tipo="submit"
        :desabilitado="falhasGrupo.length > 0"
        data-testid="gravar-grupo"
      />
    </form>

    <h3>{{ T.textos }}</h3>
    <ul class="lista" data-testid="lista-textos">
      <li v-for="x in textos" :key="String(x['id'])" :class="{ inativo: !x['ativo'] }">
        <span
          >{{ x['descricao'] }}<template v-if="x['mnemonico']"> · {{ x['mnemonico'] }}</template></span
        >
        <SanteBotao :rotulo="T.editar" :data-testid="`alterar-texto-${x['id']}`" @acionar="abrirTexto(x)" />
        <SanteBotao
          v-if="x['ativo']"
          :rotulo="T.inativar"
          :data-testid="`inativar-texto-${x['id']}`"
          @acionar="inativarTexto(x)"
        />
      </li>
    </ul>
    <SanteBotao :rotulo="T.novoTexto" data-testid="novo-texto" @acionar="abrirTexto(null)" />
    <form v-if="textoAberto" class="texto" data-testid="form-texto" @submit.prevent="salvarTexto">
      <label>{{ T.codigo }} <input v-model="t['codigo']" name="codigo" maxlength="30" required /></label>
      <label
        >{{ T.tituloTexto }} <input v-model="t['descricao']" name="descricao" maxlength="150" required
      /></label>
      <label>{{ T.atalho }} <input v-model="t['mnemonico']" name="mnemonico" maxlength="10" /></label>
      <SanteSelecao
        :model-value="txt(t['aplicacao'])"
        :rotulo="T.aplicacao"
        :opcoes="opFixas(APLICACOES_TEXTO_PADRAO)"
        data-testid="texto-aplicacao"
        @update:model-value="(v: ValorCombo) => (t['aplicacao'] = v)"
      />
      <label class="largo"
        >{{ T.texto }}
        <textarea
          :value="txt(t['texto'])"
          @input="t['texto'] = ($event.target as HTMLTextAreaElement).value"
          name="texto"
          rows="3"
          required
        />
      </label>
      <ul v-if="falhasTexto.length" class="erro" data-testid="falhas-texto">
        <li v-for="(f, i) in falhasTexto" :key="i">{{ f.mensagem }}</li>
      </ul>
      <SanteBotao
        :rotulo="T.gravarTexto"
        tipo="submit"
        :desabilitado="falhasTexto.length > 0"
        data-testid="gravar-texto"
      />
    </form>
  </section>
</template>

<style scoped>
.inativo {
  opacity: 0.55;
  text-decoration: line-through;
}
.erro {
  color: var(--sgh-alerta);
}
form,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin: 0.5rem 0;
}
.lista {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
}
.largo,
.largo textarea,
table {
  width: 100%;
}
</style>
