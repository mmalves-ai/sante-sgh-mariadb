<script setup lang="ts">
// Busca única de paciente (M11; ficha, seção 7): nome sem acento e por palavra, nome da mãe, telefone pelos 8
// últimos dígitos, CPF, prontuário, CNS e nascimento. Resultado mascarado pelo servidor (CPF, telefone, mãe);
// teto de 50 e sugestões pela pronúncia (até 5) quando nenhum nome casa. O termo fica na URL (?q=), para a
// paleta (Ctrl+K) e o menu Cadastros abrirem a mesma tela (a recepção usa esta). Nenhum nome de tabela do legado.
import { TIPOS_BUSCA_PACIENTE, type PacienteResumo, type TipoBuscaPaciente } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPacientes, lerGravacaoCadastro } from '../api-cadastro.js';
import { dataBr } from '../formato.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();

const textoDaRota = (v: unknown) => (typeof v === 'string' ? v : '');
const termo = ref(textoDaRota(rota.query['q']));
const tipo = ref<TipoBuscaPaciente>(
  (TIPOS_BUSCA_PACIENTE as readonly string[]).includes(textoDaRota(rota.query['tipo']))
    ? (rota.query['tipo'] as TipoBuscaPaciente)
    : 'auto',
);
const inativos = ref(rota.query['inativos'] === 'sim');
const pedido = ref<{ termo: string; tipo: TipoBuscaPaciente; inativos: boolean } | null>(
  termo.value.trim() ? { termo: termo.value.trim(), tipo: tipo.value, inativos: inativos.value } : null,
);

watch(
  () => rota.query,
  (q) => {
    const novo = textoDaRota(q['q']).trim();
    if (novo && novo !== pedido.value?.termo) {
      termo.value = novo;
      pedido.value = { termo: novo, tipo: tipo.value, inativos: inativos.value };
    }
  },
);

const opcoesTipo = computed(() =>
  TIPOS_BUSCA_PACIENTE.map((v) => ({ valor: v, rotulo: t(`cadastro.busca.tipos.${v}`) })),
);

const busca = useQuery({
  queryKey: computed(() => ['cadastro', 'busca', pedido.value]),
  queryFn: () => buscarPacientes(pedido.value!.termo, pedido.value!.tipo, pedido.value!.inativos),
  enabled: computed(() => pedido.value !== null),
  staleTime: 0,
});
const r = computed(() => busca.data.value);

// "Cadastrar paciente" segue a mesma regra do executor (estado, chave de liberação, sessão só consulta): o
// servidor responde antes, e a tela esconde o link e mostra o motivo (POL-3) em vez de recusar só ao salvar.
const gravacao = useQuery({
  queryKey: ['cadastro', 'gravacao'],
  queryFn: () => lerGravacaoCadastro(),
  enabled: computed(() => pode('cadastro.paciente.criar')),
  staleTime: 30_000,
});
const podeCadastrar = computed(() => gravacao.data.value?.cadastrar.pode === true);
const motivoSemCadastro = computed(() => {
  const g = gravacao.data.value;
  return g && !g.cadastrar.pode ? g.cadastrar.motivo : null;
});

function buscar(): void {
  const t0 = termo.value.trim();
  if (!t0) return;
  pedido.value = { termo: t0, tipo: tipo.value, inativos: inativos.value };
  void roteador.replace({
    query: {
      q: t0,
      ...(tipo.value !== 'auto' ? { tipo: tipo.value } : {}),
      ...(inativos.value ? { inativos: 'sim' } : {}),
    },
  });
}

function usarSugestao(p: PacienteResumo): void {
  termo.value = p.nome;
  tipo.value = 'nome';
  buscar();
}

function nomeDe(p: PacienteResumo): string {
  return p.nomeSocial ? `${p.nomeSocial} (${p.nome})` : p.nome;
}

function abrir(p: PacienteResumo): void {
  void roteador.push(`/cadastros/pacientes/${p.id}`);
}
</script>

<template>
  <section class="tela" aria-labelledby="busca-paciente-titulo" data-testid="tela-busca-paciente">
    <h1 id="busca-paciente-titulo">{{ t('cadastro.busca.titulo') }}</h1>
    <p>{{ t('cadastro.busca.texto') }}</p>
    <form class="barra" role="search" data-testid="form-busca-paciente" @submit.prevent="buscar">
      <div class="campo">
        <label for="termo-paciente">{{ t('cadastro.busca.termo') }}</label>
        <input
          id="termo-paciente"
          v-model="termo"
          type="search"
          maxlength="100"
          autocomplete="off"
          data-testid="termo-paciente"
        />
      </div>
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('cadastro.busca.tipo')"
        :opcoes="opcoesTipo"
        data-testid="tipo-busca"
      />
      <label class="marcar">
        <input v-model="inativos" type="checkbox" data-testid="busca-inativos" />
        {{ t('cadastro.busca.inativos') }}
      </label>
      <SanteBotao
        :rotulo="t('cadastro.busca.buscar')"
        variante="primario"
        tipo="submit"
        data-testid="botao-buscar"
      />
      <RouterLink
        v-if="pode('cadastro.paciente.criar') && podeCadastrar"
        to="/cadastros/pacientes/novo"
        class="link-acao"
        data-testid="link-novo-paciente"
        >{{ t('cadastro.busca.novo') }}</RouterLink
      >
      <RouterLink
        v-if="pode('cadastro.duplicidade.ler')"
        to="/cadastros/pacientes/duplicidades"
        class="link-acao"
        >{{ t('cadastro.busca.duplicidades') }}</RouterLink
      >
    </form>
    <SanteAlerta
      v-if="motivoSemCadastro"
      :texto="t('cadastro.busca.semCadastro', { motivo: motivoSemCadastro })"
      variante="info"
      data-testid="sem-cadastro"
    />

    <MensagemErro v-if="busca.isError.value" :erro="busca.error.value" />
    <p v-else-if="busca.isFetching.value" role="status">{{ t('cadastro.carregando') }}</p>
    <template v-else-if="r">
      <SanteAlerta v-if="r.truncado" :texto="t('cadastro.busca.truncado')" variante="aviso" anunciar />
      <p v-if="r.itens.length === 0 && r.sugestoes.length === 0" role="status" data-testid="busca-vazia">
        {{ t('cadastro.busca.vazio') }}
      </p>
      <table v-if="r.itens.length > 0" data-testid="resultado-busca">
        <caption>
          {{
            t('cadastro.busca.legenda', { n: r.itens.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.busca.prontuario') }}</th>
            <th scope="col">{{ t('cadastro.busca.nome') }}</th>
            <th scope="col">{{ t('cadastro.busca.nascimento') }}</th>
            <th scope="col">{{ t('cadastro.busca.sexo') }}</th>
            <th scope="col">{{ t('cadastro.busca.mae') }}</th>
            <th scope="col">{{ t('cadastro.busca.cpf') }}</th>
            <th scope="col">{{ t('cadastro.busca.telefone') }}</th>
            <th scope="col">{{ t('cadastro.busca.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in r.itens" :key="p.id" :data-testid="`paciente-${p.id}`">
            <td>{{ p.prontuario }}</td>
            <td>
              <RouterLink
                :to="`/cadastros/pacientes/${p.id}`"
                :aria-label="t('cadastro.busca.abrir', { nome: nomeDe(p) })"
                >{{ nomeDe(p) }}</RouterLink
              >
              <span v-if="p.homonimo" class="marca" data-testid="alerta-homonimo">{{
                t('cadastro.busca.homonimo')
              }}</span>
              <span v-if="p.obito" class="marca">{{ t('cadastro.busca.obito') }}</span>
            </td>
            <td>{{ dataBr(p.nascimento) }}</td>
            <td>{{ p.sexo ?? '' }}</td>
            <td>{{ p.maeMascarada ?? '' }}</td>
            <td>{{ p.cpfMascarado ?? '' }}</td>
            <td>{{ p.telefoneMascarado ?? '' }}</td>
            <td>{{ t(`cadastro.situacoes.${p.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="r.sugestoes.length > 0" class="sugestoes" data-testid="sugestoes-foneticas">
        <p>{{ t('cadastro.busca.sugestoes') }}</p>
        <ul>
          <li v-for="p in r.sugestoes" :key="p.id">
            <button type="button" class="ligacao" @click="usarSugestao(p)">
              {{ t('cadastro.busca.sugestao', { nome: nomeDe(p) }) }}
            </button>
            <span> · {{ dataBr(p.nascimento) }} · {{ p.maeMascarada ?? '' }}</span>
            <SanteBotao :rotulo="t('cadastro.ficha.titulo')" variante="texto" @acionar="abrir(p)" />
          </li>
        </ul>
      </div>
      <p class="tempo">{{ t('cadastro.busca.tempo', { ms: r.duracaoMs }) }}</p>
    </template>
  </section>
</template>

<style scoped>
/* Alvo mínimo de toque (WCAG 2.5.8): links de ação e de lista. */
nav a,
.acoes a,
li a,
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}

table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.ligacao {
  background: none;
  border: none;
  color: var(--sgh-link, inherit);
  text-decoration: underline;
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.tempo {
  font-size: var(--sgh-fonte-pequena);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-width: 18rem;
}
</style>
