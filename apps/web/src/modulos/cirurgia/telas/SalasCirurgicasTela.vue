<script setup lang="ts">
// Salas cirúrgicas e usuários permitidos (ficha do M18, seção 7): `/cirurgia/salas`. As salas com o centro de custo
// e a contagem de usuários; na sala escolhida, os usuários permitidos (a mesma lista que vale nas duas pontas):
// incluir e retirar pelo login (cirurgia.definirSalaUsuario). Incluir e alterar a sala é pelo cadastro de domínios.
// 04-CC linha 92: na mesma sala, a grade de funcionamento (componentes/GradeDaSala.vue, cirurgia.sala.editar).
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { definirUsuarioDaSala, lerUsuariosDaSala, listarSalas, novaChave } from '../api-cirurgia.js';
import AvisoCirurgia from '../componentes/AvisoCirurgia.vue';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';
import GradeDaSala from '../componentes/GradeDaSala.vue';
import { usarCirurgia } from '../usar-cirurgia.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivoAgenda } = usarCirurgia();
const salas = useQuery({ queryKey: ['cirurgia', 'salas'], queryFn: () => listarSalas() });
const sala = ref<number | null>(null);
const usuarios = useQuery({
  queryKey: computed(() => ['cirurgia', 'salas', 'usuarios', sala.value ?? 0]),
  queryFn: () => lerUsuariosDaSala(sala.value ?? 0),
  enabled: computed(() => sala.value !== null),
});
const podeEditar = pode('cirurgia.definirSalaUsuario');
const nomeDaSala = computed(
  () => salas.data.value?.find((s) => s.codigo === sala.value)?.nome ?? String(sala.value ?? ''),
);
const login = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
async function definir(acao: 'incluir' | 'remover', usuario: string): Promise<void> {
  if (sala.value === null) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await definirUsuarioDaSala(sala.value, { usuario, acao }, novaChave('sala-usuario'));
    mensagem.value = r.mensagem;
    login.value = '';
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="salas-titulo" data-testid="tela-salas-cirurgicas">
    <h1 id="salas-titulo">{{ t('cirurgia.salas.titulo') }}</h1>
    <p>{{ t('cirurgia.salas.texto') }}</p>
    <AvisoCirurgia :motivo="motivoAgenda" />
    <p class="acoes">
      <RouterLink to="/cadastros/dominios/cirurgia/sala">{{ t('cirurgia.salas.cadastro') }}</RouterLink>
    </p>
    <ErroCirurgia v-if="salas.isError.value" :erro="salas.error.value" />
    <p v-else-if="!salas.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <table v-else class="tabela" data-testid="tabela-salas">
      <thead>
        <tr>
          <th scope="col">{{ t('cirurgia.sala') }}</th>
          <th scope="col">{{ t('cirurgia.salas.centroCusto') }}</th>
          <th scope="col">{{ t('cirurgia.salas.usuarios') }}</th>
          <th scope="col">{{ t('cirurgia.salas.voce') }}</th>
          <th scope="col">{{ t('cirurgia.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in salas.data.value" :key="s.codigo">
          <td>{{ s.nome }}</td>
          <td>{{ s.centroCusto }}</td>
          <td>{{ s.usuarios }}</td>
          <td>{{ s.permitida ? t('cirurgia.salas.permitida') : t('cirurgia.salas.naoPermitida') }}</td>
          <td>
            <SanteBotao
              variante="texto"
              :rotulo="t('cirurgia.salas.abrir', { sala: s.nome })"
              :data-testid="`sala-${s.codigo}`"
              @acionar="sala = s.codigo"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <section
      v-if="usuarios.data.value"
      class="painel"
      aria-labelledby="usuarios-sala"
      data-testid="usuarios-da-sala"
    >
      <h2 id="usuarios-sala">
        {{
          t('cirurgia.salas.usuariosDe', {
            sala: usuarios.data.value.sala.nome,
            n: usuarios.data.value.total,
          })
        }}
      </h2>
      <form
        v-if="podeEditar"
        class="filtros"
        @submit.prevent="login.trim() && definir('incluir', login.trim())"
      >
        <div class="campo">
          <label for="sala-login">{{ t('cirurgia.salas.login') }}</label>
          <input id="sala-login" v-model="login" autocomplete="off" maxlength="31" data-testid="sala-login" />
        </div>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('cirurgia.salas.incluir')"
          :desabilitado="!login.trim()"
        />
      </form>
      <ul>
        <li v-for="u in usuarios.data.value.usuarios" :key="u.login" class="acoes">
          {{ u.login }}<span v-if="u.nome !== u.login" class="secundario"> · {{ u.nome }}</span>
          <span v-if="!u.ativo" class="secundario"> · {{ t('cirurgia.salas.inativo') }}</span>
          <SanteBotao
            v-if="podeEditar"
            variante="destrutivo"
            :rotulo="t('cirurgia.salas.retirar', { login: u.login })"
            :confirmacao="
              t('cirurgia.salas.retirarPergunta', { login: u.login, sala: usuarios.data.value.sala.nome })
            "
            @acionar="definir('remover', u.login)"
          />
        </li>
      </ul>
    </section>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
    <GradeDaSala v-if="sala !== null" :key="sala" :sala="sala" :nome-sala="nomeDaSala" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
