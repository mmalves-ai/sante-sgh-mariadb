<script setup lang="ts">
// 02-AGE linha 40: quem vê e quem marca numa agenda. Sem lista, a agenda é aberta (vale o escopo do cargo); com lista,
// só os usuários dela a veem, e marca quem tem "vê e marca". A regra (nunca deixar a lista sem quem marca) é do
// domínio: a tela já desabilita o que seria recusado e mostra a recusa do servidor quando houver.
import { SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarUsuarios,
  definirUsuarioAgenda,
  lerUsuariosAgenda,
  type MudancaUsuarioAgenda,
} from '../api-usuarios-agenda.js';
import { novaChave } from '../api-agenda.js';
import ErroAgenda from './ErroAgenda.vue';

const props = defineProps<{ agendaId: number; podeEditar: boolean }>();
const { t } = useI18n();
const qc = useQueryClient();
const chave = computed(() => ['agenda-usuarios', props.agendaId]);
const lista = useQuery({ queryKey: chave, queryFn: () => lerUsuariosAgenda(props.agendaId) });
const erro = ref<unknown>(null);
const mensagem = ref('');

const termo = ref('');
const escolhido = ref('');
const podeMarcar = ref(true);
const candidatos = ref<{ usuario: number; login: string; nome: string }[]>([]);
let pedido = 0;
watch(termo, async (v) => {
  const meu = ++pedido;
  if (v.trim().length < 2) {
    candidatos.value = [];
    return;
  }
  try {
    const r = await buscarUsuarios(v.trim());
    if (meu === pedido) candidatos.value = r;
  } catch (e) {
    erro.value = e;
  }
});
const opcoes = computed(() => {
  const ja = new Set((lista.data.value?.usuarios ?? []).map((u) => u.usuario));
  return [
    { valor: '', rotulo: '—' },
    ...candidatos.value
      .filter((c) => !ja.has(c.usuario))
      .map((c) => ({ valor: String(c.usuario), rotulo: `${c.nome} (${c.login})` })),
  ];
});
const quemMarca = computed(() => (lista.data.value?.usuarios ?? []).filter((u) => u.podeMarcar).length);
// Validação na hora (a mesma regra do domínio): a lista nunca fica sem quem marca.
const primeiroSemMarcar = computed(() => (lista.data.value?.usuarios.length ?? 0) === 0 && !podeMarcar.value);
const ultimoQueMarca = (podeMarcarU: boolean) => podeMarcarU && quemMarca.value === 1;

async function mudar(m: MudancaUsuarioAgenda) {
  erro.value = null;
  mensagem.value = '';
  try {
    const r = await definirUsuarioAgenda(props.agendaId, m, novaChave('usuarios'));
    mensagem.value = r.mensagem ?? '';
    if (m.acao === 'incluir') {
      escolhido.value = '';
      termo.value = '';
    }
    await qc.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}
const incluir = () =>
  escolhido.value &&
  mudar({ acao: 'incluir', usuario: Number(escolhido.value), podeMarcar: podeMarcar.value });
</script>

<template>
  <section class="painel" aria-labelledby="agenda-usuarios" data-testid="agenda-usuarios">
    <h2 id="agenda-usuarios">{{ t('usuariosAgenda.titulo') }}</h2>
    <p v-if="lista.isPending.value">{{ t('usuariosAgenda.carregando') }}</p>
    <template v-else-if="lista.data.value">
      <p data-testid="agenda-usuarios-situacao">
        {{ lista.data.value.restrita ? t('usuariosAgenda.restrita') : t('usuariosAgenda.livre') }}
      </p>
      <p>
        {{
          t('usuariosAgenda.meuAcesso', {
            acesso: t(`usuariosAgenda.acessos.${lista.data.value.meuAcesso}`),
          })
        }}
      </p>
      <table v-if="lista.data.value.restrita" class="tabela" data-testid="agenda-usuarios-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('usuariosAgenda.usuario') }}</th>
            <th scope="col">{{ t('usuariosAgenda.acesso') }}</th>
            <th v-if="podeEditar" scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in lista.data.value.usuarios" :key="u.usuario">
            <td>{{ u.nome }} ({{ u.login }})</td>
            <td>{{ u.podeMarcar ? t('usuariosAgenda.marca') : t('usuariosAgenda.consulta') }}</td>
            <td v-if="podeEditar" class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="
                  u.podeMarcar
                    ? t('usuariosAgenda.tornarConsulta', { nome: u.nome })
                    : t('usuariosAgenda.tornarMarca', { nome: u.nome })
                "
                :desabilitado="ultimoQueMarca(u.podeMarcar)"
                @acionar="mudar({ acao: 'alterar', usuario: u.usuario, podeMarcar: !u.podeMarcar })"
              />
              <SanteBotao
                variante="destrutivo"
                :rotulo="t('usuariosAgenda.retirar', { nome: u.nome })"
                :confirmacao="t('usuariosAgenda.retirarPergunta', { nome: u.nome })"
                :desabilitado="ultimoQueMarca(u.podeMarcar) && lista.data.value.usuarios.length > 1"
                @acionar="mudar({ acao: 'remover', usuario: u.usuario })"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="podeEditar" class="filtros" @submit.prevent="incluir">
        <SanteCampoTexto v-model="termo" :rotulo="t('usuariosAgenda.buscar')" :max-bytes="60" />
        <SanteSelecao v-model="escolhido" :rotulo="t('usuariosAgenda.escolher')" :opcoes="opcoes" />
        <SanteChave
          :ligada="podeMarcar"
          :rotulo="t('usuariosAgenda.podeMarcar')"
          @alternar="(v: boolean) => (podeMarcar = v)"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('usuariosAgenda.incluir')"
          :desabilitado="!escolhido || primeiroSemMarcar"
        />
        <SanteBotao
          v-if="lista.data.value.restrita"
          variante="destrutivo"
          :rotulo="t('usuariosAgenda.liberar')"
          :confirmacao="t('usuariosAgenda.liberarPergunta')"
          @acionar="mudar({ acao: 'liberarTodos' })"
        />
      </form>
    </template>
    <p v-if="mensagem" role="status" data-testid="agenda-usuarios-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro || lista.error.value" :erro="erro ?? lista.error.value" />
  </section>
</template>
