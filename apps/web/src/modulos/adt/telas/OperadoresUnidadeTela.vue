<script setup lang="ts">
// Quem opera cada unidade de internação (F3.4, 04-INT linha 65): `/internacao/unidades/operadores`. Uma tela só: a
// unidade, a lista atual com as três ações (admitir, transferir para ela, dar alta) marcadas por pessoa, a busca de um
// usuário para incluir e a gravação da lista inteira de uma vez. Quem sai da lista é retirado de forma lógica no
// servidor (fica no histórico); lista vazia devolve a unidade ao controle só pelo cargo.
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-adt.js';
import {
  buscarCandidatosOperadores,
  type CandidatoOperador,
  definirOperadores,
  lerOperadores,
  type OperadorUnidade,
} from '../api-registros.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { usarAdt } from '../usar-adt.js';

const { t } = useI18n();
const { apoio, pode, motivoDe } = usarAdt();
const podeGravar = pode('internacao.definirOperadoresUnidade');
const aviso = motivoDe('internacao.definirOperadoresUnidade');

const unidade = ref('');
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...(apoio.data.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome })),
]);

const lista = ref<OperadorUnidade[]>([]);
const gravada = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const assinatura = (l: readonly OperadorUnidade[]) => JSON.stringify(l);
const alterada = computed(() => assinatura(lista.value) !== gravada.value);

async function ler(): Promise<void> {
  erro.value = null;
  lista.value = [];
  gravada.value = assinatura([]);
  if (!unidade.value) return;
  try {
    lista.value = await lerOperadores(Number(unidade.value));
    gravada.value = assinatura(lista.value);
  } catch (x) {
    erro.value = x;
  }
}
watch(unidade, () => {
  mensagem.value = null;
  void ler();
});

// ── Inclusão: busca do usuário (login ou nome) e entrada na lista com as três ações marcadas ──
const termo = ref('');
const candidatos = ref<CandidatoOperador[]>([]);
const candidato = ref('');
const opcoesCandidato = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...candidatos.value
    .filter((c) => !lista.value.some((o) => o.usuario === c.usuario))
    .map((c) => ({ valor: String(c.usuario), rotulo: `${c.login} (${c.nome})` })),
]);
async function buscar(): Promise<void> {
  erro.value = null;
  try {
    candidatos.value = await buscarCandidatosOperadores(termo.value.trim());
    candidato.value = '';
  } catch (x) {
    erro.value = x;
  }
}
function incluir(): void {
  const c = candidatos.value.find((x) => String(x.usuario) === candidato.value);
  if (!c) return;
  lista.value = [
    ...lista.value,
    { usuario: c.usuario, login: c.login, podeAdmitir: true, podeTransferir: true, podeDarAlta: true },
  ];
  candidato.value = '';
}
function tirar(usuario: number): void {
  lista.value = lista.value.filter((o) => o.usuario !== usuario);
}

/** Na hora: cada pessoa da lista precisa de ao menos uma ação (sem nenhuma, é tirar da lista). */
const semAcao = computed(() =>
  lista.value.find((o) => !o.podeAdmitir && !o.podeTransferir && !o.podeDarAlta),
);

async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await definirOperadores(
      Number(unidade.value),
      {
        operadores: lista.value.map((o) => ({
          usuario: o.usuario,
          podeAdmitir: o.podeAdmitir,
          podeTransferir: o.podeTransferir,
          podeDarAlta: o.podeDarAlta,
        })),
      },
      novaChave('operadores-unidade'),
    );
    mensagem.value = r.mensagem;
    await ler();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="operadores-titulo" data-testid="tela-operadores-unidade">
    <h1 id="operadores-titulo">{{ t('adt.registros.operadores.titulo') }}</h1>
    <p>{{ t('adt.registros.operadores.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <ErroAdt v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!apoio.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <p v-if="apoio.data.value.unidades.length === 0" class="secundario">
        {{ t('adt.registros.operadores.semUnidade') }}
      </p>
      <div class="filtros">
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('adt.registros.operadores.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="operadores-unidade"
        />
      </div>
      <p v-if="mensagem" role="status" data-testid="operadores-gravado">{{ mensagem }}</p>
      <ErroAdt v-if="erro" :erro="erro" />

      <section v-if="unidade" class="painel" aria-labelledby="operadores-lista">
        <h2 id="operadores-lista">{{ t('adt.registros.operadores.unidade') }}</h2>
        <p v-if="lista.length === 0" class="secundario" data-testid="operadores-vazia">
          {{ t('adt.registros.operadores.vazia') }}
        </p>
        <table v-else class="tabela" data-testid="tabela-operadores">
          <thead>
            <tr>
              <th scope="col">{{ t('adt.registros.operadores.login') }}</th>
              <th scope="col">{{ t('adt.registros.operadores.admitir') }}</th>
              <th scope="col">{{ t('adt.registros.operadores.transferir') }}</th>
              <th scope="col">{{ t('adt.registros.operadores.darAlta') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in lista" :key="o.usuario" :data-testid="`operador-${o.login}`">
              <td>{{ o.login }}</td>
              <td>
                <input
                  v-model="o.podeAdmitir"
                  type="checkbox"
                  :disabled="!podeGravar"
                  :aria-label="`${t('adt.registros.operadores.admitir')} ${o.login}`"
                  :data-testid="`operador-${o.login}-admitir`"
                />
              </td>
              <td>
                <input
                  v-model="o.podeTransferir"
                  type="checkbox"
                  :disabled="!podeGravar"
                  :aria-label="`${t('adt.registros.operadores.transferir')} ${o.login}`"
                  :data-testid="`operador-${o.login}-transferir`"
                />
              </td>
              <td>
                <input
                  v-model="o.podeDarAlta"
                  type="checkbox"
                  :disabled="!podeGravar"
                  :aria-label="`${t('adt.registros.operadores.darAlta')} ${o.login}`"
                  :data-testid="`operador-${o.login}-alta`"
                />
              </td>
              <td>
                <SanteBotao
                  v-if="podeGravar"
                  :rotulo="t('adt.registros.operadores.tirar')"
                  variante="secundario"
                  :data-testid="`operador-${o.login}-tirar`"
                  @acionar="tirar(o.usuario)"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <template v-if="podeGravar">
          <form class="filtros" role="search" @submit.prevent="buscar">
            <SanteCampoTexto
              v-model="termo"
              :rotulo="t('adt.registros.operadores.buscar')"
              :max-bytes="60"
              data-testid="operadores-termo"
            />
            <SanteBotao
              tipo="submit"
              variante="secundario"
              :rotulo="t('adt.buscar')"
              :desabilitado="termo.trim().length < 2"
              data-testid="operadores-buscar"
            />
          </form>
          <div class="filtros">
            <SanteSelecao
              v-model="candidato"
              :rotulo="t('adt.registros.operadores.candidato')"
              :opcoes="opcoesCandidato"
              data-testid="operadores-candidato"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('adt.registros.operadores.incluir')"
              :desabilitado="!candidato"
              data-testid="operadores-incluir"
              @acionar="incluir"
            />
          </div>
          <p v-if="semAcao" class="secundario" role="alert" data-testid="operadores-sem-acao">
            {{ t('adt.registros.operadores.semAcao', { login: semAcao.login }) }}
          </p>
          <p v-else-if="alterada" class="secundario">{{ t('adt.registros.operadores.alterada') }}</p>
          <SanteBotao
            :rotulo="t('adt.registros.operadores.gravar')"
            :desabilitado="!alterada || !!semAcao || ocupado"
            data-testid="operadores-gravar"
            @acionar="gravar"
          />
        </template>
        <p v-else class="secundario">{{ t('adt.registros.operadores.semPermissao') }}</p>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
