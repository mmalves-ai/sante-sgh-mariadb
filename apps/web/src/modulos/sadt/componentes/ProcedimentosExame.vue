<script setup lang="ts">
// Procedimento operacional do exame (F3.5, análise 05-SADT linha 1), dentro da ficha do exame em `/sadt/catalogo`.
// O documento da qualidade nasce em rascunho, passa à revisão e é aprovado; quem aprova é o profissional da conta da
// sessão (nunca escolhido na tela) e a aprovação de uma versão nova torna a anterior obsoleta, com a vigência
// encerrada na véspera. Nada se apaga: o aprovado não muda de conteúdo, muda-se criando a versão seguinte (que já vem
// com o conteúdo da anterior, para não redigitar). Os passos aparecem como botões só quando cabem na situação.
import { SanteBotao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { z } from 'zod';
import { enviar } from '../../exames/api-exames.js';
import { novaChave } from '../api-sadt.js';

type Linha = Record<string, unknown>;
const props = defineProps<{ exameId: number; procedimentos: readonly Linha[] }>();
const emit = defineEmits<{ gravado: [] }>();
const qualquer = z.any();

const T = {
  titulo: 'Procedimento operacional',
  codigo: 'Código do documento',
  tituloDoc: 'Título',
  versao: 'Versão',
  situacao: 'Situação',
  vigencia: 'Vigência a partir de',
  revisao: 'Próxima revisão',
  novo: 'Novo procedimento',
  editar: 'Abrir',
  novaVersao: 'Nova versão',
  paraRevisao: 'Enviar para revisão',
  aprovar: 'Aprovar',
  devolver: 'Devolver ao rascunho',
  gravar: 'Gravar procedimento',
  gravado: 'Procedimento gravado.',
  aprovadoPor: 'aprovado em',
} as const;
const SITUACAO: Record<string, string> = {
  rascunho: 'rascunho',
  em_revisao: 'em revisão',
  aprovado: 'aprovado',
  obsoleto: 'obsoleto',
};
const CONTEUDO: readonly (readonly [string, string])[] = [
  ['metodologia', 'Metodologia'],
  ['principioTeste', 'Princípio do teste'],
  ['preparoPaciente', 'Preparo do paciente'],
  ['coletaAmostra', 'Coleta da amostra'],
  ['reagentes', 'Reagentes'],
  ['procedimentoTecnico', 'Procedimento técnico'],
  ['controleInterno', 'Controle interno'],
  ['valorReferencia', 'Valor de referência'],
  ['interferentes', 'Interferentes'],
  ['limitacoesMetodo', 'Limitações do método'],
  ['interpretacaoResultado', 'Interpretação do resultado'],
];

const erro = ref('');
const aviso = ref('');
const doc = reactive<Linha>({});
const aberto = computed(() => doc['codigoDocumento'] !== undefined);
const editavel = computed(
  () => !doc['id'] || doc['situacao'] === 'rascunho' || doc['situacao'] === 'em_revisao',
);
const dia = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Na tela, só os documentos vigentes ou em preparo em primeiro; os obsoletos ficam riscados no fim. */
const lista = computed(() =>
  [...props.procedimentos].sort(
    (a, b) => Number(a['situacao'] === 'obsoleto') - Number(b['situacao'] === 'obsoleto'),
  ),
);

function preencher(l: Linha) {
  for (const k of Object.keys(doc)) delete doc[k];
  Object.assign(doc, l, {
    vigenciaInicio: dia(l['vigenciaInicio']),
    proximaRevisaoEm: dia(l['proximaRevisaoEm']),
  });
}
const novo = () => preencher({ codigoDocumento: '', titulo: '', situacao: 'rascunho' });
/** A versão seguinte nasce em rascunho com o conteúdo da escolhida. */
function novaVersao(l: Linha) {
  const copia: Linha = { codigoDocumento: l['codigoDocumento'], titulo: l['titulo'], situacao: 'rascunho' };
  for (const [k] of CONTEUDO) copia[k] = l[k] ?? null;
  preencher(copia);
}

const texto = (v: unknown) => (String(v ?? '').trim() === '' ? null : String(v));
function corpo(situacao?: string): Linha {
  if (doc['id'] && situacao)
    return {
      id: Number(doc['id']),
      versao: Number(doc['versao']),
      situacao,
      ...(situacao === 'aprovado' ? { vigenciaInicio: texto(doc['vigenciaInicio']) ?? hoje() } : {}),
    };
  const r: Linha = {
    ...(doc['id'] ? { id: Number(doc['id']), versao: Number(doc['versao']) } : {}),
    codigoDocumento: String(doc['codigoDocumento'] ?? '').trim(),
    titulo: String(doc['titulo'] ?? '').trim(),
    vigenciaInicio: texto(doc['vigenciaInicio']),
    proximaRevisaoEm: texto(doc['proximaRevisaoEm']),
  };
  for (const [k] of CONTEUDO) r[k] = texto(doc[k]);
  return r;
}
/** Conferência na hora, a mesma do servidor para o código e o título. */
const falhas = computed(() => {
  const r: Record<string, string> = {};
  const codigo = String(doc['codigoDocumento'] ?? '').trim();
  if (!codigo || codigo.length > 60 || /\s/.test(codigo))
    r['codigoDocumento'] = 'Código do documento de 1 a 60 caracteres, sem espaço.';
  const t = String(doc['titulo'] ?? '').trim();
  if (t.length < 3 || t.length > 200) r['titulo'] = 'Título de 3 a 200 caracteres.';
  return r;
});

async function gravar(situacao?: string) {
  erro.value = '';
  aviso.value = '';
  try {
    await enviar(
      `/api/sadt/catalogo/exames/${props.exameId}/procedimentos`,
      corpo(situacao),
      qualquer,
      novaChave('catalogo.procedimento'),
    );
    for (const k of Object.keys(doc)) delete doc[k];
    aviso.value = T.gravado;
    emit('gravado');
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <section data-testid="secao-procedimento">
    <h2>{{ T.titulo }}</h2>
    <p v-if="erro" role="alert" class="erro">{{ erro }}</p>
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <ul>
      <li
        v-for="p in lista"
        :key="String(p['id'])"
        :class="{ inativo: p['situacao'] === 'obsoleto' }"
        :data-testid="`procedimento-${p['codigoDocumento']}-v${p['versaoDocumento']}`"
      >
        {{ p['codigoDocumento'] }} · {{ p['titulo'] }} · {{ T.versao }} {{ p['versaoDocumento'] }} ·
        <strong>{{ SITUACAO[String(p['situacao'])] }}</strong>
        <span v-if="p['aprovadoEm']"> · {{ T.aprovadoPor }} {{ dia(p['aprovadoEm']) }}</span>
        <SanteBotao :rotulo="T.editar" @acionar="preencher(p)" />
        <template v-if="p['situacao'] === 'aprovado'">
          <SanteBotao
            :rotulo="T.novaVersao"
            data-testid="nova-versao-procedimento"
            @acionar="novaVersao(p)"
          />
        </template>
      </li>
    </ul>
    <SanteBotao :rotulo="T.novo" data-testid="novo-procedimento" @acionar="novo" />
    <form v-if="aberto" data-testid="form-procedimento" @submit.prevent="gravar()">
      <label
        >{{ T.codigo }}
        <input
          v-model="doc['codigoDocumento']"
          maxlength="60"
          name="codigo-documento"
          :disabled="!editavel"
        />
        <small v-if="falhas['codigoDocumento']" class="erro">{{ falhas['codigoDocumento'] }}</small></label
      >
      <label
        >{{ T.tituloDoc }}
        <input v-model="doc['titulo']" maxlength="200" name="titulo-documento" :disabled="!editavel" />
        <small v-if="falhas['titulo']" class="erro">{{ falhas['titulo'] }}</small></label
      >
      <label
        >{{ T.vigencia }} <input v-model="doc['vigenciaInicio']" type="date" :disabled="!editavel"
      /></label>
      <label
        >{{ T.revisao }} <input v-model="doc['proximaRevisaoEm']" type="date" :disabled="!editavel"
      /></label>
      <label v-for="[k, r] in CONTEUDO" :key="k" class="texto"
        >{{ r }}
        <textarea
          :value="String(doc[k] ?? '')"
          @input="doc[k] = ($event.target as HTMLTextAreaElement).value"
          rows="2"
          maxlength="20000"
          :name="k"
          :disabled="!editavel"
        />
      </label>
      <template v-if="editavel">
        <SanteBotao
          :rotulo="T.gravar"
          tipo="submit"
          data-testid="salvar-procedimento"
          :desabilitado="Object.keys(falhas).length > 0"
        />
        <SanteBotao
          v-if="doc['situacao'] === 'rascunho' && doc['id']"
          :rotulo="T.paraRevisao"
          data-testid="revisao-procedimento"
          @acionar="gravar('em_revisao')"
        />
        <SanteBotao
          v-if="doc['situacao'] === 'em_revisao'"
          :rotulo="T.devolver"
          @acionar="gravar('rascunho')"
        />
        <SanteBotao
          v-if="doc['situacao'] === 'em_revisao'"
          :rotulo="T.aprovar"
          data-testid="aprovar-procedimento"
          @acionar="gravar('aprovado')"
        />
      </template>
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
form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin: 0.5rem 0;
}
.texto {
  flex: 1 1 100%;
}
.texto textarea {
  width: 100%;
}
</style>
