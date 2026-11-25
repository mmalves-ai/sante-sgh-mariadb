<script setup lang="ts">
// Cabeçalho da impressão por tipo de documento (03-PEP L131): as regras do cliente (do estabelecimento ou de todos,
// por tipo de documento ou padrão), com inclusão e alteração na mesma linha, ativar e desativar sem apagar, e a
// prévia das linhas que a emissão imprime para o tipo escolhido. A conferência das linhas é feita na hora (texto
// próprio só com a fonte "texto próprio", até 6 linhas no cabeçalho e 4 no rodapé, 120 caracteres por linha, sem
// marcação nem endereço da internet); a regra final é do servidor, e a recusa aparece como veio.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarCabecalho,
  ativarCabecalho,
  incluirCabecalho,
  lerCabecalhos,
  previaCabecalho,
  type RegraCabecalhoTela,
} from '../api-copias-prontuario.js';

const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({ queryKey: ['pep', 'cabecalhos'], queryFn: () => lerCabecalhos(), staleTime: 0 });
const d = computed(() => dados.data.value);
const podeGravar = computed(() => pode('pep.admin.editar'));
const erro = ref<unknown>(null);
const ok = ref('');

const FONTES = ['estabelecimento', 'mantenedora', 'personalizado'] as const;
type Fonte = (typeof FONTES)[number];
const opcoesFonte = computed(() =>
  FONTES.map((f) => ({ valor: f, rotulo: t(`pep.copias.cab.fontes.${f}`) })),
);
const opcoesTipo = computed(() => [
  { valor: '', rotulo: t('pep.copias.cab.todosTipos') },
  ...(d.value?.opcoes.tiposDocumento ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
]);

interface Formulario {
  tipoDocumento: string;
  todosEstabelecimentos: boolean;
  fonte: Fonte;
  cabecalho: string;
  rodape: string;
  exibeDadosPaciente: boolean;
  exibeAssinatura: boolean;
}
const vazio = (): Formulario => ({
  tipoDocumento: '',
  todosEstabelecimentos: false,
  fonte: 'estabelecimento',
  cabecalho: '',
  rodape: '',
  exibeDadosPaciente: true,
  exibeAssinatura: true,
});
const form = reactive<Formulario>(vazio());
const editando = ref<RegraCabecalhoTela | null>(null);

const linhas = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
const faltas = computed(() => {
  const f: string[] = [];
  const cab = linhas(form.cabecalho);
  const rod = linhas(form.rodape);
  if (form.fonte === 'personalizado' && cab.length === 0) f.push(t('pep.copias.cab.cabecalho'));
  if (form.fonte !== 'personalizado' && cab.length > 0) f.push(t('pep.copias.cab.fonte'));
  if (cab.length > 6 || cab.some((l) => l.length > 120)) f.push(t('pep.copias.cab.cabecalho'));
  if (rod.length > 4 || rod.some((l) => l.length > 120)) f.push(t('pep.copias.cab.rodape'));
  if (/[<>]/.test(form.cabecalho + form.rodape) || /https?:\/\//i.test(form.cabecalho + form.rodape))
    f.push(t('pep.copias.cab.semMarcacao'));
  return [...new Set(f)];
});

// Prévia da regra que vale para o tipo do formulário (lida do servidor, já com a regra mais específica).
const tipoPrevia = computed(() => (form.tipoDocumento ? Number(form.tipoDocumento) : null));
const previa = useQuery({
  queryKey: computed(() => ['pep', 'cabecalhos', 'previa', tipoPrevia.value]),
  queryFn: () => previaCabecalho(tipoPrevia.value),
  staleTime: 0,
});

async function executar(fn: () => Promise<unknown>) {
  erro.value = null;
  ok.value = '';
  try {
    await fn();
    ok.value = t('pep.copias.gravado');
    await cliente.invalidateQueries({ queryKey: ['pep', 'cabecalhos'] });
  } catch (e) {
    erro.value = e;
  }
}
const nulo = (s: string) => (s.trim() ? s.trim() : null);
function corpo() {
  return {
    fonte: form.fonte,
    cabecalho: nulo(form.cabecalho),
    rodape: nulo(form.rodape),
    exibeDadosPaciente: form.exibeDadosPaciente,
    exibeAssinatura: form.exibeAssinatura,
  };
}
function salvar() {
  if (faltas.value.length) return;
  const r = editando.value;
  void executar(async () => {
    if (r) await alterarCabecalho(r.id, { versao: r.versao, ...corpo() });
    else
      await incluirCabecalho({
        tipoDocumento: form.tipoDocumento ? Number(form.tipoDocumento) : null,
        todosEstabelecimentos: form.todosEstabelecimentos,
        ...corpo(),
      });
    cancelar();
  });
}
function editar(r: RegraCabecalhoTela) {
  editando.value = r;
  Object.assign(form, {
    tipoDocumento: r.tipoDocumento ? String(r.tipoDocumento) : '',
    todosEstabelecimentos: r.estabelecimento === null,
    fonte: r.fonte,
    cabecalho: r.cabecalho ?? '',
    rodape: r.rodape ?? '',
    exibeDadosPaciente: r.exibeDadosPaciente,
    exibeAssinatura: r.exibeAssinatura,
  });
}
function cancelar() {
  editando.value = null;
  Object.assign(form, vazio());
}
const alternar = (r: RegraCabecalhoTela) =>
  void executar(() => ativarCabecalho(r.id, { versao: r.versao, ativo: !r.ativo }));
</script>

<template>
  <section class="cabecalhos" data-testid="cabecalhos-impressao">
    <h1>{{ t('pep.copias.cab.titulo') }}</h1>
    <p class="explicacao">{{ t('pep.copias.cab.explicacao') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" />

    <form v-if="podeGravar" class="regra" data-testid="cabecalhos-form" @submit.prevent="salvar">
      <div class="linha">
        <SanteSelecao
          v-model="form.tipoDocumento"
          :rotulo="t('pep.copias.cab.tipo')"
          :opcoes="opcoesTipo"
          :desabilitado="editando !== null"
          data-testid="cabecalhos-tipo"
        />
        <SanteSelecao
          v-model="form.fonte"
          :rotulo="t('pep.copias.cab.fonte')"
          :opcoes="opcoesFonte"
          data-testid="cabecalhos-fonte"
        />
        <label class="marca">
          <input
            v-model="form.todosEstabelecimentos"
            type="checkbox"
            :disabled="editando !== null"
            data-testid="cabecalhos-todos"
          />
          {{ t('pep.copias.cab.todosEstabelecimentos') }}
        </label>
      </div>
      <div class="linha">
        <label v-if="form.fonte === 'personalizado'"
          >{{ t('pep.copias.cab.cabecalho') }}
          <textarea v-model="form.cabecalho" rows="4" cols="60" data-testid="cabecalhos-texto" />
        </label>
        <label
          >{{ t('pep.copias.cab.rodape') }}
          <textarea v-model="form.rodape" rows="3" cols="60" data-testid="cabecalhos-rodape" />
        </label>
      </div>
      <div class="linha">
        <label class="marca"
          ><input v-model="form.exibeDadosPaciente" type="checkbox" />
          {{ t('pep.copias.cab.exibePaciente') }}</label
        >
        <label class="marca"
          ><input v-model="form.exibeAssinatura" type="checkbox" />
          {{ t('pep.copias.cab.exibeAssinatura') }}</label
        >
      </div>
      <p v-if="faltas.length" class="faltas" data-testid="cabecalhos-faltas">{{ faltas.join(' · ') }}</p>
      <div class="linha">
        <SanteBotao
          tipo="submit"
          :rotulo="editando ? t('pep.copias.cab.salvar') : t('pep.copias.cab.incluir')"
          :desabilitado="faltas.length > 0"
          data-testid="cabecalhos-salvar"
        />
        <SanteBotao
          v-if="editando"
          variante="texto"
          :rotulo="t('pep.copias.cab.cancelar')"
          @acionar="cancelar"
        />
      </div>
    </form>

    <aside class="previa" data-testid="cabecalhos-previa">
      <h2>{{ t('pep.copias.cab.previa') }}</h2>
      <template v-if="previa.data.value">
        <p v-if="previa.data.value.regra === null">{{ t('pep.copias.cab.semRegra') }}</p>
        <p v-for="(l, i) in previa.data.value.linhas" :key="`c${i}`" class="linha-previa">{{ l }}</p>
        <hr v-if="previa.data.value.rodape.length" />
        <p v-for="(l, i) in previa.data.value.rodape" :key="`r${i}`">{{ l }}</p>
      </template>
    </aside>

    <p v-if="dados.isLoading.value">{{ t('pep.carregando') }}</p>
    <table v-else class="regras" data-testid="cabecalhos-lista">
      <thead>
        <tr>
          <th>{{ t('pep.copias.cab.tipo') }}</th>
          <th>{{ t('pep.copias.cab.alcance') }}</th>
          <th>{{ t('pep.copias.cab.fonte') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in d?.regras ?? []"
          :key="r.id"
          :class="{ inativa: !r.ativo }"
          :data-testid="`cabecalho-regra-${r.id}`"
        >
          <td>{{ r.tipoDocumentoNome ?? t('pep.copias.cab.todosTipos') }}</td>
          <td>
            {{
              r.estabelecimento === null
                ? t('pep.copias.cab.todosEstabelecimentos')
                : t('pep.copias.cab.deste')
            }}
            <span v-if="!r.ativo" class="selo">{{ t('pep.copias.cab.inativa') }}</span>
          </td>
          <td>{{ t(`pep.copias.cab.fontes.${r.fonte}`) }}</td>
          <td>
            <template v-if="podeGravar && r.gerenciavel">
              <SanteBotao variante="texto" :rotulo="t('pep.copias.cab.alterar')" @acionar="editar(r)" />
              <SanteBotao
                variante="texto"
                :rotulo="r.ativo ? t('pep.copias.cab.desativar') : t('pep.copias.cab.ativar')"
                :data-testid="`cabecalho-ativo-${r.id}`"
                @acionar="alternar(r)"
              />
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.cabecalhos {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
label {
  display: grid;
  gap: 2px;
}
label.marca {
  display: flex;
  align-items: center;
}
.previa {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
}
.linha-previa,
.selo,
.faltas {
  font-weight: 600;
}
.regras {
  border-collapse: collapse;
}
.regras th,
.regras td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.inativa {
  opacity: 0.6;
}
</style>
