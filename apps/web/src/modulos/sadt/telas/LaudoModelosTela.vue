<script setup lang="ts">
// Manutenção dos modelos de laudo de imagem e de métodos gráficos (F3.5, 05-SADT linha 16). Numa tela só: a lista dos
// modelos do estabelecimento e dos pessoais de quem está na sessão (os pessoais de outro médico não aparecem), e o
// formulário ao lado. O alcance do modelo é o exame, o setor ou todos; os campos variáveis ({{campo}}) aparecem na
// hora, enquanto o texto é escrito. O modelo se desativa, nunca se apaga.
import { camposDoModelo } from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  type CorpoModelo,
  lerModelosDeLaudo,
  type ModeloDeLaudo,
  type ModelosDeLaudo,
  salvarModeloDeLaudo,
} from '../api-laudo-redacao.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const M = {
  titulo: 'Modelos de laudo',
  texto:
    'Os modelos do estabelecimento e os seus modelos pessoais. Na redação do laudo, o seu modelo pessoal do exame é sugerido primeiro.',
  voltar: 'Voltar aos laudos',
  novo: 'Novo modelo',
  vazio: 'Ainda não há modelo de laudo.',
  colNome: 'Nome',
  colAlcance: 'Alcance',
  colTipo: 'Tipo',
  colDono: 'De quem',
  colSituacao: 'Situação',
  pessoalRotulo: 'Pessoal',
  doEstabelecimento: 'Do estabelecimento',
  ativo: 'Ativo',
  inativo: 'Inativo',
  editar: 'Editar',
  todosExames: 'Todos os exames',
  todosSetores: 'Todos os setores',
  codigo: 'Código',
  nome: 'Nome',
  tipo: 'Tipo',
  exame: 'Exame',
  setor: 'Setor',
  atalho: 'Atalho (opcional)',
  pessoal: 'Modelo pessoal (só eu uso)',
  semProfissional: 'Sua conta não tem profissional ligado: o modelo pessoal não está disponível.',
  donoFixo: 'O dono do modelo não muda depois de criado.',
  textoModelo: 'Texto do modelo',
  dica: 'Use {{campo}} para o que muda a cada laudo: a sigla da medida, exame, peso, altura ou superficie_corporal.',
  campos: 'Campos variáveis: {c}',
  semCampos: 'Sem campos variáveis.',
  modeloAtivo: 'Ativo (aparece na redação do laudo)',
  salvar: 'Salvar modelo',
  salvo: 'Modelo gravado.',
  faltaCodigo: 'Informe o código.',
  faltaNome: 'Informe o nome (ao menos 2 letras).',
  faltaTexto: 'Escreva o texto do modelo.',
  tipos: {
    texto: 'Texto completo',
    normal: 'Laudo normal',
    alterado: 'Laudo alterado',
    conclusao: 'Conclusão',
    frase: 'Frase pronta',
  } as Record<CorpoModelo['tipo'], string>,
};

const dados = ref<ModelosDeLaudo | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
const f = reactive({
  id: null as number | null,
  codigo: '',
  nome: '',
  tipo: 'texto' as string,
  exame: '',
  setor: '',
  atalho: '',
  pessoal: false,
  texto: '',
  ativo: true,
});
const opTipos = (Object.keys(M.tipos) as CorpoModelo['tipo'][]).map((valor) => ({
  valor,
  rotulo: M.tipos[valor],
}));
const opExames = computed(() => [
  { valor: '', rotulo: M.todosExames },
  ...(dados.value?.exames ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
]);
const opSetores = computed(() => [
  { valor: '', rotulo: M.todosSetores },
  ...(dados.value?.setores ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
]);
// Validação na hora: o que falta aparece ao lado do botão e os campos variáveis saem do texto pela regra do domínio.
const campos = computed(() => camposDoModelo(f.texto));
const falta = computed(() =>
  f.codigo.trim().length === 0
    ? M.faltaCodigo
    : f.nome.trim().length < 2
      ? M.faltaNome
      : f.texto.trim().length === 0
        ? M.faltaTexto
        : null,
);
const alcance = (m: ModeloDeLaudo) => m.exameNome ?? m.setorNome ?? M.todosExames;

async function carregar(): Promise<void> {
  erro.value = null;
  try {
    dados.value = await lerModelosDeLaudo();
  } catch (x) {
    erro.value = x;
  }
}
function novo(): void {
  Object.assign(f, {
    id: null,
    codigo: '',
    nome: '',
    tipo: 'texto',
    exame: '',
    setor: '',
    atalho: '',
    pessoal: false,
    texto: '',
    ativo: true,
  });
  mensagem.value = null;
}
function editar(m: ModeloDeLaudo): void {
  Object.assign(f, {
    id: m.id,
    codigo: m.codigo,
    nome: m.nome,
    tipo: m.tipo,
    exame: m.exame ? String(m.exame) : '',
    setor: m.setor ? String(m.setor) : '',
    atalho: m.atalho ?? '',
    pessoal: m.pessoal,
    texto: m.texto,
    ativo: m.ativo,
  });
  mensagem.value = null;
}
async function salvar(): Promise<void> {
  if (falta.value) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await salvarModeloDeLaudo(
      {
        id: f.id,
        codigo: f.codigo.trim(),
        nome: f.nome.trim(),
        exame: f.exame ? Number(f.exame) : null,
        setor: f.setor ? Number(f.setor) : null,
        pessoal: f.pessoal,
        tipo: f.tipo as CorpoModelo['tipo'],
        atalho: f.atalho.trim() || null,
        texto: f.texto,
        ativo: f.ativo,
      },
      novaChave('laudo.modelo'),
    );
    f.id = r.id;
    mensagem.value = M.salvo;
    await carregar();
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}
void carregar();
</script>

<template>
  <section class="modelos" data-testid="laudo-modelos">
    <h1>{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <div class="linha">
      <RouterLink :to="{ name: 'sadt.laudos' }" data-testid="modelos-voltar">{{ M.voltar }}</RouterLink>
      <SanteBotao :rotulo="M.novo" data-testid="modelo-novo" @acionar="novo" />
    </div>
    <ErroSadt v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="modelo-mensagem">{{ mensagem }}</p>
    <div v-if="dados" class="colunas">
      <div>
        <p v-if="dados.itens.length === 0" data-testid="modelos-vazio">{{ M.vazio }}</p>
        <table v-else data-testid="modelos-lista">
          <thead>
            <tr>
              <th scope="col">{{ M.colNome }}</th>
              <th scope="col">{{ M.colAlcance }}</th>
              <th scope="col">{{ M.colTipo }}</th>
              <th scope="col">{{ M.colDono }}</th>
              <th scope="col">{{ M.colSituacao }}</th>
              <th scope="col">
                <span class="so-leitor">{{ M.editar }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in dados.itens" :key="m.id" :data-testid="`modelo-linha-${m.id}`">
              <td>{{ m.nome }}</td>
              <td>{{ alcance(m) }}</td>
              <td>{{ M.tipos[m.tipo as CorpoModelo['tipo']] ?? m.tipo }}</td>
              <td>{{ m.pessoal ? M.pessoalRotulo : M.doEstabelecimento }}</td>
              <td>{{ m.ativo ? M.ativo : M.inativo }}</td>
              <td>
                <SanteBotao :rotulo="M.editar" :data-testid="`modelo-editar-${m.id}`" @acionar="editar(m)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="ficha" data-testid="modelo-ficha" @submit.prevent="salvar">
        <div class="linha">
          <label
            >{{ M.codigo }} <input v-model="f.codigo" maxlength="30" data-testid="modelo-codigo"
          /></label>
          <label>{{ M.nome }} <input v-model="f.nome" maxlength="150" data-testid="modelo-nome" /></label>
        </div>
        <div class="linha">
          <SanteSelecao v-model="f.tipo" :rotulo="M.tipo" :opcoes="opTipos" data-testid="modelo-tipo" />
          <SanteSelecao v-model="f.exame" :rotulo="M.exame" :opcoes="opExames" data-testid="modelo-exame" />
          <SanteSelecao v-model="f.setor" :rotulo="M.setor" :opcoes="opSetores" data-testid="modelo-setor" />
          <label
            >{{ M.atalho }} <input v-model="f.atalho" maxlength="30" data-testid="modelo-atalho"
          /></label>
        </div>
        <label>
          <input
            v-model="f.pessoal"
            type="checkbox"
            :disabled="f.id !== null || !dados.temProfissional"
            data-testid="modelo-pessoal"
          />
          {{ M.pessoal }}
        </label>
        <small v-if="f.id !== null">{{ M.donoFixo }}</small>
        <small v-else-if="!dados.temProfissional">{{ M.semProfissional }}</small>
        <label
          >{{ M.textoModelo }}
          <textarea v-model="f.texto" rows="12" data-testid="modelo-texto" />
        </label>
        <small>{{ M.dica }}</small>
        <p role="note" data-testid="modelo-campos">
          {{ campos.length ? M.campos.replace('{c}', campos.join(', ')) : M.semCampos }}
        </p>
        <label
          ><input v-model="f.ativo" type="checkbox" data-testid="modelo-ativo" /> {{ M.modeloAtivo }}</label
        >
        <div class="linha">
          <SanteBotao
            :rotulo="M.salvar"
            tipo="submit"
            :desabilitado="gravando || falta !== null"
            data-testid="modelo-salvar"
          />
          <span v-if="falta" role="note" data-testid="modelo-falta">{{ falta }}</span>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.modelos,
.ficha {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.colunas {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
textarea {
  width: 100%;
}
.so-leitor {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (max-width: 900px) {
  .colunas {
    grid-template-columns: 1fr;
  }
}
</style>
