<script setup lang="ts">
// Equipe assistencial do atendimento (F3.3, linha 03-PEP L94): quem cuida do paciente, com função, responsável
// principal e quem recebe as pendências. Incluir é uma linha só (profissional, função, avisos); a saída pede o motivo
// na própria linha e fica no histórico. As regras (um responsável, médico; sem repetir) vêm do domínio pela API e a
// tela já avisa antes de enviar. A especialidade só aparece em função médica e só com as do profissional; no fim do
// atendimento, a equipe se encerra (todos os vigentes saem com o motivo) e deixa de dar vínculo.
// Gravar exige pep.equipe.gerenciar; sem ela, a API recusa e a tela mostra o motivo.
// C2-064: a equipe padrão do setor entra num clique (a sugerida ao setor do atendimento vem escolhida), com quem
// ficou de fora e o porquê; quem administra o prontuário salva a equipe atual como padrão do setor.
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  aplicarEquipePadrao,
  type EquipePadrao,
  gravarEquipePadrao,
  lerConfiguracoesSetor,
  lerEquipesPadrao,
  encerrarEquipe,
  encerrarMembro,
  type FuncaoEquipe,
  incluirMembro,
  lerEquipe,
  lerEspecialidadesProfissional,
  lerFuncoesEquipe,
  type MembroEquipe,
} from '../api-equipe-painel.js';

const { t } = useI18n();
const props = defineProps<{ atendimento: string }>();
const atd = computed(() => Number(props.atendimento));
const membros = ref<MembroEquipe[]>([]);
const funcoes = ref<FuncaoEquipe[]>([]);
const erro = ref<string | null>(null);
const novo = ref({ profissional: '', funcao: 0, especialidade: 0, recebeNotificacao: true });
const especialidades = ref<{ id: number; descricao: string }[]>([]);
const encerrando = ref(false);
const motivoEquipe = ref('');
const aviso = ref<string | null>(null);
const saindo = ref<number | null>(null);
const motivo = ref('');

const padroes = ref<EquipePadrao[]>([]);
const sugeridos = ref<number[]>([]);
const padraoEscolhido = ref(0);
const resultadoPadrao = ref<{ incluidos: number; ignorados: { sequencia: number; codigo: string }[] } | null>(
  null,
);
const salvandoPadrao = ref(false);
const novoPadrao = ref({ nome: '', setor: 0 });
const setores = ref<{ id: number; nome: string }[]>([]);
const podeSalvarPadrao = computed(() => pode('pep.admin.editar'));
/** As sugeridas ao setor do atendimento primeiro, depois as demais ativas. */
const opcoesPadrao = computed(() => {
  const ativos = padroes.value.filter((p) => p.ativo);
  const ordem = [
    ...sugeridos.value.map((id) => ativos.find((p) => p.id === id)).filter((p): p is EquipePadrao => !!p),
    ...ativos.filter((p) => !sugeridos.value.includes(p.id)),
  ];
  return ordem.map((p) => ({
    valor: p.id,
    rotulo: sugeridos.value.includes(p.id) ? t('pep.equipe.padraoSugerida', { nome: p.nome }) : p.nome,
  }));
});
const opcoesSetor = computed(() => [
  { valor: 0, rotulo: '—' },
  ...setores.value.map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const motivoIgnorado = (codigo: string) =>
  t(`pep.equipe.motivosIgnorado.${codigo}`) === `pep.equipe.motivosIgnorado.${codigo}`
    ? codigo
    : t(`pep.equipe.motivosIgnorado.${codigo}`);
const vigentes = computed(() => membros.value.filter((m) => m.fim === null));
const historico = computed(() => membros.value.filter((m) => m.fim !== null));
const funcaoEscolhida = computed(() => funcoes.value.find((f) => f.id === Number(novo.value.funcao)));
/** Aviso na hora: o responsável principal já existe. */
const avisoResponsavel = computed(() =>
  funcaoEscolhida.value?.responsavelPrincipal && vigentes.value.some((m) => m.responsavelPrincipal)
    ? t('pep.equipe.avisoResponsavel')
    : null,
);
const funcaoMedica = computed(() => funcaoEscolhida.value?.categoria === 'medica');
const opcoesFuncao = computed(() => funcoes.value.map((f) => ({ valor: f.id, rotulo: f.descricao })));
const opcoesEspecialidade = computed(() => [
  { valor: 0, rotulo: t('pep.equipe.semEspecialidade') },
  ...especialidades.value.map((e) => ({ valor: e.id, rotulo: e.descricao })),
]);
/** Especialidades do profissional digitado (a tela só oferece as dele, e só em função médica). */
watch(
  () => [novo.value.profissional, funcaoMedica.value] as const,
  async ([prof, medica]) => {
    novo.value.especialidade = 0;
    especialidades.value = [];
    if (!medica || !/^\d+$/.test(prof)) return;
    try {
      especialidades.value = (await lerEspecialidadesProfissional(Number(prof))).itens;
    } catch {
      especialidades.value = [];
    }
  },
);
const podeIncluir = computed(
  () => /^\d+$/.test(novo.value.profissional) && !!funcaoEscolhida.value && !avisoResponsavel.value,
);

async function carregar(): Promise<void> {
  try {
    erro.value = null;
    const [e, f] = await Promise.all([lerEquipe(atd.value), lerFuncoesEquipe()]);
    membros.value = e.membros;
    funcoes.value = f.itens;
    if (!novo.value.funcao && f.itens[0]) novo.value.funcao = f.itens[0].id;
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function carregarPadroes(): Promise<void> {
  try {
    const r = await lerEquipesPadrao(atd.value);
    padroes.value = r.itens;
    sugeridos.value = r.sugeridos;
    const primeiro = r.sugeridos[0] ?? r.itens.find((p) => p.ativo)?.id ?? 0;
    if (!padraoEscolhido.value) padraoEscolhido.value = primeiro;
  } catch {
    padroes.value = [];
  }
}
async function aplicarPadrao(): Promise<void> {
  if (!padraoEscolhido.value) return;
  try {
    erro.value = null;
    resultadoPadrao.value = await aplicarEquipePadrao(atd.value, Number(padraoEscolhido.value));
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function abrirSalvarPadrao(): Promise<void> {
  salvandoPadrao.value = true;
  if (setores.value.length) return;
  try {
    setores.value = (await lerConfiguracoesSetor()).setores;
  } catch {
    setores.value = [];
  }
}
async function salvarPadrao(): Promise<void> {
  if (novoPadrao.value.nome.trim().length < 3 || !novoPadrao.value.setor) return;
  try {
    erro.value = null;
    await gravarEquipePadrao({
      nome: novoPadrao.value.nome.trim(),
      setor: Number(novoPadrao.value.setor),
      especialidade: null,
      membros: vigentes.value.map((m) => ({
        funcao: m.funcao,
        profissional: m.profissional,
        responsavel: m.responsavelPrincipal,
      })),
    });
    aviso.value = t('pep.equipe.padraoSalva');
    salvandoPadrao.value = false;
    novoPadrao.value = { nome: '', setor: 0 };
    await carregarPadroes();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function incluir(): Promise<void> {
  if (!podeIncluir.value) return;
  try {
    erro.value = null;
    await incluirMembro(atd.value, {
      profissional: Number(novo.value.profissional),
      funcao: Number(novo.value.funcao),
      especialidade: funcaoMedica.value && novo.value.especialidade ? Number(novo.value.especialidade) : null,
      recebeNotificacao: novo.value.recebeNotificacao,
    });
    novo.value.profissional = '';
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function confirmarSaida(id: number): Promise<void> {
  if (motivo.value.trim().length < 3) return;
  try {
    erro.value = null;
    await encerrarMembro(id, motivo.value.trim());
    saindo.value = null;
    motivo.value = '';
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function confirmarEncerramento(): Promise<void> {
  if (motivoEquipe.value.trim().length < 3) return;
  try {
    erro.value = null;
    const r = await encerrarEquipe(atd.value, motivoEquipe.value.trim());
    aviso.value = t('pep.equipe.equipeEncerrada', { n: r.membros });
    encerrando.value = false;
    motivoEquipe.value = '';
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
onMounted(() => {
  void carregar();
  void carregarPadroes();
});
</script>

<template>
  <section class="equipe" data-testid="equipe-assistencial">
    <h1>{{ t('pep.equipe.titulo') }}</h1>
    <SanteAlerta v-if="erro" :texto="erro" data-testid="equipe-erro" />
    <p v-if="aviso" role="status" data-testid="equipe-aviso-encerrada">{{ aviso }}</p>
    <table>
      <caption>
        {{
          t('pep.equipe.agora')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('pep.equipe.profissional') }}</th>
          <th scope="col">{{ t('pep.equipe.funcao') }}</th>
          <th scope="col">{{ t('pep.equipe.desde') }}</th>
          <th scope="col">{{ t('pep.equipe.pendencias') }}</th>
          <th scope="col">
            <span class="sr">{{ t('pep.equipe.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in vigentes" :key="m.id" :data-testid="`equipe-membro-${m.profissional}`">
          <td>
            {{ m.profissionalNome
            }}<strong v-if="m.responsavelPrincipal"> {{ t('pep.equipe.responsavel') }}</strong>
          </td>
          <td>{{ m.funcaoDescricao }}</td>
          <td>{{ m.inicio.replace('T', ' ').slice(0, 16) }}</td>
          <td>
            {{
              m.recebeNotificacao || m.responsavelPrincipal
                ? t('pep.equipe.recebe')
                : t('pep.equipe.naoRecebe')
            }}
          </td>
          <td>
            <template v-if="saindo === m.id">
              <label>
                {{ t('pep.equipe.motivoSaida') }}
                <input v-model="motivo" maxlength="500" data-testid="equipe-motivo" />
              </label>
              <button
                type="button"
                :disabled="motivo.trim().length < 3"
                data-testid="equipe-confirmar-saida"
                @click="confirmarSaida(m.id)"
              >
                {{ t('pep.equipe.confirmar') }}
              </button>
              <button type="button" @click="saindo = null">{{ t('pep.equipe.cancelar') }}</button>
            </template>
            <button
              v-else
              type="button"
              :data-testid="`equipe-sair-${m.profissional}`"
              @click="saindo = m.id"
            >
              {{ t('pep.equipe.encerrar') }}
            </button>
          </td>
        </tr>
        <tr v-if="!vigentes.length">
          <td colspan="5">{{ t('pep.equipe.vazia') }}</td>
        </tr>
      </tbody>
    </table>

    <div class="padrao" data-testid="equipe-padrao">
      <template v-if="opcoesPadrao.length">
        <SanteSelecao
          v-model="padraoEscolhido"
          :rotulo="t('pep.equipe.padraoEscolha')"
          :opcoes="opcoesPadrao"
          data-testid="equipe-padrao-escolha"
        />
        <button
          type="button"
          :disabled="!padraoEscolhido"
          data-testid="equipe-padrao-aplicar"
          @click="aplicarPadrao"
        >
          {{ t('pep.equipe.padraoAplicar') }}
        </button>
      </template>
      <p v-else class="dica">{{ t('pep.equipe.padraoNenhuma') }}</p>
      <div v-if="resultadoPadrao" role="status" data-testid="equipe-padrao-resultado">
        {{
          t('pep.equipe.padraoAplicada', {
            n: resultadoPadrao.incluidos,
            m: resultadoPadrao.ignorados.length,
          })
        }}
        <ul v-if="resultadoPadrao.ignorados.length">
          <li v-for="i in resultadoPadrao.ignorados" :key="i.sequencia">
            {{ t('pep.equipe.padraoIgnorado', { sequencia: i.sequencia, motivo: motivoIgnorado(i.codigo) }) }}
          </li>
        </ul>
      </div>
    </div>

    <form class="incluir" data-testid="equipe-incluir" @submit.prevent="incluir">
      <label>
        {{ t('pep.equipe.codigoProfissional') }}
        <input v-model="novo.profissional" inputmode="numeric" required data-testid="equipe-profissional" />
      </label>
      <SanteSelecao
        v-model="novo.funcao"
        :rotulo="t('pep.equipe.funcao')"
        :opcoes="opcoesFuncao"
        data-testid="equipe-funcao"
      />
      <SanteSelecao
        v-if="funcaoMedica"
        v-model="novo.especialidade"
        :rotulo="t('pep.equipe.especialidade')"
        :opcoes="opcoesEspecialidade"
        data-testid="equipe-especialidade"
      />
      <label>
        <input v-model="novo.recebeNotificacao" type="checkbox" />
        {{ t('pep.equipe.recebePendencias') }}
      </label>
      <button type="submit" :disabled="!podeIncluir" data-testid="equipe-incluir-botao">
        {{ t('pep.equipe.incluir') }}
      </button>
      <p v-if="avisoResponsavel" role="status" data-testid="equipe-aviso">{{ avisoResponsavel }}</p>
      <p class="dica">{{ t('pep.equipe.avisoCategoria') }}</p>
    </form>

    <div v-if="vigentes.length" class="encerrar-equipe">
      <template v-if="encerrando">
        <label>
          {{ t('pep.equipe.motivoEncerramento') }}
          <input v-model="motivoEquipe" maxlength="500" data-testid="equipe-motivo-encerramento" />
        </label>
        <button
          type="button"
          :disabled="motivoEquipe.trim().length < 3"
          data-testid="equipe-confirmar-encerramento"
          @click="confirmarEncerramento"
        >
          {{ t('pep.equipe.confirmar') }}
        </button>
        <button type="button" @click="encerrando = false">{{ t('pep.equipe.cancelar') }}</button>
      </template>
      <button v-else type="button" data-testid="equipe-encerrar" @click="encerrando = true">
        {{ t('pep.equipe.encerrarEquipe') }}
      </button>
    </div>

    <div v-if="podeSalvarPadrao && vigentes.length" class="salvar-padrao">
      <form v-if="salvandoPadrao" data-testid="equipe-salvar-padrao" @submit.prevent="salvarPadrao">
        <label>
          {{ t('pep.equipe.padraoNome') }}
          <input v-model="novoPadrao.nome" maxlength="100" required data-testid="equipe-padrao-nome" />
        </label>
        <SanteSelecao
          v-model="novoPadrao.setor"
          :rotulo="t('pep.equipe.padraoSetor')"
          :opcoes="opcoesSetor"
          data-testid="equipe-padrao-setor"
        />
        <button
          type="submit"
          :disabled="novoPadrao.nome.trim().length < 3 || !novoPadrao.setor"
          data-testid="equipe-padrao-confirmar"
        >
          {{ t('pep.equipe.confirmar') }}
        </button>
        <button type="button" @click="salvandoPadrao = false">{{ t('pep.equipe.cancelar') }}</button>
      </form>
      <button v-else type="button" data-testid="equipe-padrao-salvar" @click="abrirSalvarPadrao">
        {{ t('pep.equipe.padraoSalvar') }}
      </button>
    </div>

    <details v-if="historico.length" data-testid="equipe-historico">
      <summary>{{ t('pep.equipe.historico', { n: historico.length }) }}</summary>
      <ul>
        <li v-for="m in historico" :key="m.id">
          {{
            t('pep.equipe.periodo', {
              nome: m.profissionalNome,
              funcao: m.funcaoDescricao,
              inicio: m.inicio.slice(0, 16).replace('T', ' '),
              fim: (m.fim ?? '').slice(0, 16).replace('T', ' '),
              motivo: m.motivoSaida ?? '',
            })
          }}
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.equipe table {
  width: 100%;
  border-collapse: collapse;
}
.equipe th,
.equipe td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
.incluir {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  margin-top: 1rem;
}
.padrao,
.salvar-padrao {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  margin-top: 1rem;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
