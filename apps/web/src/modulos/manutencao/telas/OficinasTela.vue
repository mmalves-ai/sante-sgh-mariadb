<script setup lang="ts">
// Oficinas de manutenção (C2-089, 04-HOT L135; `manutencao.equipamento.ler`, gravação com `.editar`): a lista com busca
// e as inativas, o cadastro da oficina (terceirizada com a empresa fornecedora, especialidade, avisos), as pessoas com
// função, alçada de aprovação de orçamento (só o aprovador) e vigência, e os serviços com o tempo padrão. A conferência
// da oficina e de cada pessoa é a mesma regra do domínio que o servidor usa, mostrada na hora. Embaixo, os equipamentos
// que estão fora para conserto, os atrasados primeiro.
import { conferirMembro, conferirOficina } from '@sgh/dominio-manutencao';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarFornecedores, lerApoioManutencao } from '../api-manutencao.js';
import {
  alterarOficina,
  FUNCOES_MEMBRO,
  incluirOficina,
  lerOficina,
  lerOpcoesOficina,
  lerRemessasAbertas,
  listarOficinas,
  type FuncaoMembro,
  type OficinaParaGravar,
} from '../api-manutencao-corretiva.js';
import { comTodos, dataBr, instanteBr, reaisDigitados } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const { t } = useI18n();
const k = (c: string) => t(`manutencao.oficinas.${c}`);
const cliente = useQueryClient();

const apoio = useQuery({ queryKey: ['manutencao', 'apoio'], queryFn: lerApoioManutencao });
const podeEditar = computed(() => !!apoio.data.value?.pode.editar && !!apoio.data.value?.gravacao.ligada);
const hoje = computed(() => apoio.data.value?.hoje ?? new Date().toISOString().slice(0, 10));

const termo = ref('');
const buscado = ref('');
const inativas = ref(false);
const lista = useQuery({
  queryKey: computed(() => ['manutencao', 'oficinas', buscado.value, inativas.value]),
  queryFn: () => listarOficinas(buscado.value || null, inativas.value),
});
const opcoes = useQuery({ queryKey: ['manutencao', 'oficinas', 'opcoes'], queryFn: lerOpcoesOficina });
const fora = useQuery({ queryKey: ['manutencao', 'remessas', 'abertas'], queryFn: lerRemessasAbertas });

// ── Formulário ─────────────────────────────────────────────────────────────────────────────────────────────────────
interface MembroRascunho {
  login: string;
  funcao: FuncaoMembro;
  alcada: string;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
}
interface ServicoRascunho {
  servico: number | null;
  tempo: string;
}
const editando = ref<number | null | 'nova'>(null);
const versao = ref<number | undefined>(undefined);
const f = ref({
  codigo: '',
  nome: '',
  terceirizada: false,
  fornecedor: null as number | null,
  especialidade: null as number | null,
  email: '',
  telefone: '',
  ramal: '',
  notificaPorEmail: false,
  exigeAvaliacao: false,
  ativo: true,
});
const membros = ref<MembroRascunho[]>([]);
const servicos = ref<ServicoRascunho[]>([]);
const fornecedorNome = ref<string | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);

const termoFornecedor = ref('');
const fornecedorBuscado = ref<string | null>(null);
const fornecedores = useQuery({
  queryKey: computed(() => ['manutencao', 'fornecedores', fornecedorBuscado.value]),
  queryFn: () => buscarFornecedores(fornecedorBuscado.value ?? ''),
  enabled: computed(() => fornecedorBuscado.value !== null),
});
const opcoesFornecedor = computed(() => {
  const l = (fornecedores.data.value ?? []).map((x) => ({
    valor: x.codigo as number | null,
    rotulo: `${x.nome} (${x.codigo})`,
  }));
  const atual = f.value.fornecedor;
  if (atual !== null && !l.some((o) => o.valor === atual))
    l.unshift({ valor: atual, rotulo: fornecedorNome.value ?? String(atual) });
  return comTodos(t('manutencao.nenhumSelecionado'), l);
});
const opcoesEspecialidade = computed(() =>
  comTodos(
    t('manutencao.nenhumSelecionado'),
    (opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: e.id as number | null, rotulo: e.nome })),
  ),
);
const opcoesServico = computed(() =>
  comTodos(
    t('manutencao.nenhumSelecionado'),
    (opcoes.data.value?.servicos ?? []).map((s) => ({
      valor: s.id as number | null,
      rotulo: `${s.codigo} - ${s.nome}`,
    })),
  ),
);
const opcoesFuncao = computed(() =>
  FUNCOES_MEMBRO.map((x) => ({ valor: x, rotulo: k(`membros.funcoes.${x}`) })),
);

function limpar() {
  versao.value = undefined;
  f.value = {
    codigo: '',
    nome: '',
    terceirizada: false,
    fornecedor: null,
    especialidade: null,
    email: '',
    telefone: '',
    ramal: '',
    notificaPorEmail: false,
    exigeAvaliacao: false,
    ativo: true,
  };
  fornecedorNome.value = null;
  membros.value = [];
  servicos.value = [];
}
function nova() {
  limpar();
  erro.value = null;
  mensagem.value = null;
  editando.value = 'nova';
}
async function editar(id: number) {
  erro.value = null;
  mensagem.value = null;
  try {
    const o = await lerOficina(id);
    limpar();
    versao.value = o.versao;
    f.value = {
      codigo: o.codigo,
      nome: o.nome,
      terceirizada: o.terceirizada,
      fornecedor: o.fornecedor,
      especialidade: o.especialidade,
      email: o.email ?? '',
      telefone: o.telefone ?? '',
      ramal: o.ramal ?? '',
      notificaPorEmail: o.notificaPorEmail,
      exigeAvaliacao: o.exigeAvaliacao,
      ativo: o.ativo,
    };
    fornecedorNome.value = o.fornecedorNome;
    membros.value = o.membros
      .filter((m) => m.ativo)
      .map((m) => ({
        login: m.login,
        funcao: m.funcao,
        alcada: m.alcada === null ? '' : String(m.alcada).replace('.', ','),
        vigenciaInicio: m.vigenciaInicio,
        vigenciaFim: m.vigenciaFim,
      }));
    servicos.value = o.servicos
      .filter((s) => s.ativo)
      .map((s) => ({
        servico: s.servico,
        tempo: s.tempoPadraoMinutos === null ? '' : String(s.tempoPadraoMinutos),
      }));
    editando.value = id;
  } catch (e) {
    erro.value = e;
  }
}

const textoN = (s: string) => (s.trim() ? s.trim() : null);
const alcadaDe = (m: MembroRascunho) => (m.alcada.trim() ? reaisDigitados(m.alcada) : null);
// A conferência na hora: a mesma regra do domínio que o servidor aplica.
const problemaOficina = computed(() =>
  conferirOficina({
    codigo: f.value.codigo,
    nome: f.value.nome,
    terceirizada: f.value.terceirizada,
    fornecedor: f.value.fornecedor,
    notificaPorEmail: f.value.notificaPorEmail,
    email: textoN(f.value.email),
  }),
);
const problemasMembros = computed(() =>
  membros.value.map((m) => {
    if (!m.login.trim() || !m.vigenciaInicio) return t('manutencao.oficinas.membros.login');
    const a = alcadaDe(m);
    if (m.alcada.trim() && (a === null || a <= 0)) return t('manutencao.recusas.corretiva.alcada-invalida');
    const r = conferirMembro({
      usuario: 0,
      funcao: m.funcao,
      alcada: a,
      vigenciaInicio: m.vigenciaInicio,
      vigenciaFim: m.vigenciaFim,
      ativo: true,
    });
    return r ? t(`manutencao.recusas.corretiva.${r.recusa}`) : null;
  }),
);
const problemas = computed(() => [
  ...(problemaOficina.value ? [t(`manutencao.recusas.corretiva.${problemaOficina.value.recusa}`)] : []),
  ...problemasMembros.value.filter((x): x is string => x !== null),
  ...(servicos.value.some((s) => s.servico === null) ? [k('servicos.servico')] : []),
]);
const tocado = ref(false);

function corpo(): OficinaParaGravar {
  return {
    ...(versao.value !== undefined ? { versao: versao.value } : {}),
    codigo: f.value.codigo.trim().toUpperCase(),
    nome: f.value.nome.trim(),
    terceirizada: f.value.terceirizada,
    fornecedor: f.value.fornecedor,
    especialidade: f.value.especialidade,
    email: textoN(f.value.email),
    telefone: textoN(f.value.telefone),
    ramal: textoN(f.value.ramal),
    notificaPorEmail: f.value.notificaPorEmail,
    exigeAvaliacao: f.value.exigeAvaliacao,
    ativo: f.value.ativo,
    membros: membros.value.map((m) => ({
      login: m.login.trim(),
      funcao: m.funcao,
      alcada: m.funcao === 'aprovador' ? alcadaDe(m) : null,
      vigenciaInicio: m.vigenciaInicio ?? hoje.value,
      vigenciaFim: m.vigenciaFim,
    })),
    servicos: servicos.value
      .filter((s): s is { servico: number; tempo: string } => s.servico !== null)
      .map((s) => ({
        servico: s.servico,
        tempoPadraoMinutos: s.tempo.trim() ? Number(s.tempo.trim()) : null,
      })),
  };
}

async function gravar() {
  tocado.value = true;
  if (problemas.value.length > 0) return;
  erro.value = null;
  gravando.value = true;
  try {
    const id = editando.value;
    const r = typeof id === 'number' ? await alterarOficina(id, corpo()) : await incluirOficina(corpo());
    mensagem.value = r.mensagem;
    editando.value = null;
    tocado.value = false;
    await cliente.invalidateQueries({ queryKey: ['manutencao', 'oficinas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <main class="tela-manutencao" aria-labelledby="oficinas-titulo" data-testid="tela-manutencao-oficinas">
    <h1 id="oficinas-titulo">{{ k('titulo') }}</h1>
    <p class="secundario">{{ k('ajuda') }}</p>
    <p v-if="mensagem" role="status" data-testid="oficina-mensagem">{{ mensagem }}</p>

    <div class="campos">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="k('buscar')"
        :max-bytes="80"
        data-testid="oficina-busca"
        @keydown.enter.prevent="buscado = termo.trim()"
      />
      <span class="campo">
        <input id="oficina-inativas" v-model="inativas" type="checkbox" data-testid="oficina-inativas" />
        <label for="oficina-inativas">{{ k('inativas') }}</label>
      </span>
      <SanteBotao
        :rotulo="k('nova')"
        :desabilitado="!podeEditar"
        data-testid="oficina-nova"
        @acionar="nova"
      />
    </div>

    <ErroManutencao v-if="lista.error.value" :erro="lista.error.value" grupo="corretiva" />
    <div v-else class="rolagem">
      <table class="tabela" data-testid="oficina-lista">
        <thead>
          <tr>
            <th>{{ k('campos.codigo') }}</th>
            <th>{{ k('campos.nome') }}</th>
            <th>{{ k('campos.especialidade') }}</th>
            <th>{{ k('campos.fornecedor') }}</th>
            <th>{{ k('ordensAbertas') }}</th>
            <th>{{ k('campos.ativo') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="(lista.data.value ?? []).length === 0">
            <td colspan="7" class="secundario">{{ k('nenhuma') }}</td>
          </tr>
          <tr v-for="o in lista.data.value ?? []" :key="o.id" :data-testid="`oficina-${o.codigo}`">
            <td>{{ o.codigo }}</td>
            <td>{{ o.nome }}</td>
            <td>{{ o.especialidadeNome ?? '' }}</td>
            <td>{{ o.terceirizada ? (o.fornecedorNome ?? '') : '' }}</td>
            <td>{{ o.ordensAbertas }}</td>
            <td>{{ o.ativo ? k('ativa') : k('inativa') }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('manutencao.editar')"
                :desabilitado="!podeEditar"
                :data-testid="`oficina-editar-${o.codigo}`"
                @acionar="editar(o.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form v-if="editando !== null" class="bloco" data-testid="oficina-form" @submit.prevent="gravar">
      <div class="campos">
        <SanteCampoTexto
          v-model="f.codigo"
          obrigatorio
          :rotulo="k('campos.codigo')"
          :max-bytes="30"
          data-testid="oficina-codigo"
        />
        <SanteCampoTexto
          v-model="f.nome"
          obrigatorio
          class="largo"
          :rotulo="k('campos.nome')"
          :max-bytes="150"
          data-testid="oficina-nome"
        />
        <SanteSelecao
          v-model="f.especialidade"
          :rotulo="k('campos.especialidade')"
          :opcoes="opcoesEspecialidade"
          data-testid="oficina-especialidade"
        />
      </div>
      <div class="campos">
        <span class="campo">
          <input
            id="oficina-terceirizada"
            v-model="f.terceirizada"
            type="checkbox"
            data-testid="oficina-terceirizada"
          />
          <label for="oficina-terceirizada">{{ k('campos.terceirizada') }}</label>
        </span>
        <template v-if="f.terceirizada">
          <SanteCampoTexto
            v-model="termoFornecedor"
            :rotulo="k('campos.buscarFornecedor')"
            :max-bytes="80"
            data-testid="oficina-termo-fornecedor"
            @keydown.enter.prevent="fornecedorBuscado = termoFornecedor.trim()"
          />
          <SanteBotao
            variante="texto"
            :rotulo="k('campos.buscarFornecedor')"
            data-testid="oficina-buscar-fornecedor"
            @acionar="fornecedorBuscado = termoFornecedor.trim()"
          />
          <SanteSelecao
            v-model="f.fornecedor"
            :rotulo="k('campos.fornecedor')"
            :opcoes="opcoesFornecedor"
            data-testid="oficina-fornecedor"
          />
        </template>
      </div>
      <div class="campos">
        <SanteCampoTexto
          v-model="f.email"
          :rotulo="k('campos.email')"
          :max-bytes="254"
          data-testid="oficina-email"
        />
        <SanteCampoTexto
          v-model="f.telefone"
          :rotulo="k('campos.telefone')"
          :max-bytes="20"
          data-testid="oficina-telefone"
        />
        <SanteCampoTexto
          v-model="f.ramal"
          :rotulo="k('campos.ramal')"
          :max-bytes="20"
          data-testid="oficina-ramal"
        />
      </div>
      <div class="campos">
        <span class="campo">
          <input
            id="oficina-notifica"
            v-model="f.notificaPorEmail"
            type="checkbox"
            data-testid="oficina-notifica"
          />
          <label for="oficina-notifica">{{ k('campos.notificaPorEmail') }}</label>
        </span>
        <span class="campo">
          <input
            id="oficina-avaliacao"
            v-model="f.exigeAvaliacao"
            type="checkbox"
            data-testid="oficina-avaliacao"
          />
          <label for="oficina-avaliacao">{{ k('campos.exigeAvaliacao') }}</label>
        </span>
        <span class="campo">
          <input id="oficina-ativo" v-model="f.ativo" type="checkbox" data-testid="oficina-ativo" />
          <label for="oficina-ativo">{{ k('campos.ativo') }}</label>
        </span>
      </div>

      <fieldset class="bloco" data-testid="oficina-membros">
        <legend>{{ k('membros.titulo') }}</legend>
        <div v-for="(m, i) in membros" :key="i" class="campos" :data-testid="`oficina-membro-${i}`">
          <SanteCampoTexto
            v-model="m.login"
            obrigatorio
            :rotulo="k('membros.login')"
            :max-bytes="100"
            :data-testid="`oficina-membro-login-${i}`"
          />
          <SanteSelecao
            v-model="m.funcao"
            :rotulo="k('membros.funcao')"
            :opcoes="opcoesFuncao"
            :data-testid="`oficina-membro-funcao-${i}`"
          />
          <SanteCampoTexto
            v-if="m.funcao === 'aprovador'"
            v-model="m.alcada"
            :rotulo="k('membros.alcada')"
            :max-bytes="16"
            :data-testid="`oficina-membro-alcada-${i}`"
          />
          <SanteData
            v-model="m.vigenciaInicio"
            editavel
            :rotulo="k('membros.inicio')"
            :data-testid="`oficina-membro-inicio-${i}`"
          />
          <SanteData
            v-model="m.vigenciaFim"
            editavel
            :rotulo="k('membros.fim')"
            :data-testid="`oficina-membro-fim-${i}`"
          />
          <SanteBotao variante="texto" :rotulo="k('membros.retirar')" @acionar="membros.splice(i, 1)" />
          <span v-if="tocado && problemasMembros[i]" class="vencido">{{ problemasMembros[i] }}</span>
        </div>
        <p class="secundario">{{ k('membros.alcadaAjuda') }}</p>
        <SanteBotao
          variante="secundario"
          :rotulo="k('membros.incluir')"
          data-testid="oficina-membro-incluir"
          @acionar="
            membros.push({
              login: '',
              funcao: 'tecnico',
              alcada: '',
              vigenciaInicio: hoje,
              vigenciaFim: null,
            })
          "
        />
      </fieldset>

      <fieldset class="bloco" data-testid="oficina-servicos">
        <legend>{{ k('servicos.titulo') }}</legend>
        <div v-for="(s, i) in servicos" :key="i" class="campos">
          <SanteSelecao
            v-model="s.servico"
            :rotulo="k('servicos.servico')"
            :opcoes="opcoesServico"
            :data-testid="`oficina-servico-${i}`"
          />
          <SanteCampoTexto
            v-model="s.tempo"
            :rotulo="k('servicos.tempo')"
            :max-bytes="5"
            :data-testid="`oficina-servico-tempo-${i}`"
          />
          <SanteBotao variante="texto" :rotulo="k('servicos.retirar')" @acionar="servicos.splice(i, 1)" />
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="k('servicos.incluir')"
          data-testid="oficina-servico-incluir"
          @acionar="servicos.push({ servico: null, tempo: '' })"
        />
      </fieldset>

      <ul v-if="problemas.length > 0" class="vencido" role="alert" data-testid="oficina-problemas">
        <li v-for="x in problemas" :key="x">{{ x }}</li>
      </ul>
      <ErroManutencao v-if="erro" :erro="erro" grupo="corretiva" />
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="k('gravar')"
          :desabilitado="gravando || !podeEditar || problemas.length > 0"
          data-testid="oficina-gravar"
        />
        <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="editando = null" />
      </div>
    </form>

    <section class="bloco" aria-labelledby="oficina-fora-titulo" data-testid="oficina-fora">
      <h2 id="oficina-fora-titulo">{{ k('fora.titulo') }}</h2>
      <p v-if="(fora.data.value ?? []).length === 0" class="secundario">{{ k('fora.nenhum') }}</p>
      <ul v-else class="historico">
        <li v-for="r in fora.data.value ?? []" :key="r.os" :class="{ vencido: r.atrasada }">
          {{ t('manutencao.oficinas.fora.os', { numero: r.numero }) }} · {{ r.equipamento }} ·
          {{ r.fornecedor }} · {{ instanteBr(r.enviadoEm) }}
          <template v-if="r.previsaoRetorno">
            · {{ k('fora.previsao') }} {{ dataBr(r.previsaoRetorno) }}</template
          >
          <strong v-if="r.atrasada"> · {{ k('fora.atrasada') }}</strong>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped src="./estilo-manutencao.css"></style>
