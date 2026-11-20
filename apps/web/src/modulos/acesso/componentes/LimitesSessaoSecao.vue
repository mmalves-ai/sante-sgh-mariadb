<script setup lang="ts">
// W1-01 (parte 8b): "Sessões simultâneas por perfil", seção da tela Política de senha. Incluir, alterar ou retirar
// o limite de um perfil ('*' = padrão de todos), com motivo e a senha num diálogo (reautenticação). Cada mudança é
// uma linha nova (o histórico fica visível com quem, quando e o motivo); a sessão excedente é recusada no login.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import { buscarLimitesSessao, definirLimiteSessao } from '../api-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['acesso', 'limites-sessao'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarLimitesSessao() });
const dados = computed(() => consulta.data.value ?? null);

const dialogo = ref(false);
const acao = ref<'definir' | 'retirar'>('definir');
const perfil = ref<string | null>('*');
const limite = ref('');
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const aviso = ref('');
const recusa = ref('');
const ocupado = ref(false);

watch(dialogo, (aberto) => {
  if (!aberto) {
    senha.value = '';
    erroSenha.value = '';
  }
});

const nomePerfil = (p: string) => (p === '*' ? t('acesso.limitesSessao.padrao') : p);
const opcoesPerfil = computed(() => [
  { valor: '*', rotulo: t('acesso.limitesSessao.padrao') },
  ...(dados.value?.perfis ?? []).map((p) => ({ valor: p, rotulo: p })),
]);
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const limiteValido = computed(
  () => /^\d{1,2}$/.test(limite.value) && +limite.value >= 1 && +limite.value <= 50,
);
const pronto = computed(
  () =>
    !ocupado.value &&
    !!perfil.value &&
    motivo.value.trim().length >= 3 &&
    senha.value.length > 0 &&
    (acao.value === 'retirar' || limiteValido.value),
);

function abrir(a: 'definir' | 'retirar', p: string | null, atual?: number) {
  acao.value = a;
  perfil.value = p ?? '*';
  limite.value = atual ? String(atual) : '';
  motivo.value = '';
  aviso.value = '';
  recusa.value = '';
  dialogo.value = true;
}

async function confirmar(): Promise<void> {
  if (!pronto.value || !perfil.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    const r = await definirLimiteSessao({
      perfil: perfil.value,
      limite: acao.value === 'retirar' ? null : Number(limite.value),
      motivo: motivo.value.trim(),
      senha: senha.value,
    });
    aviso.value =
      r.limite === null
        ? t('acesso.limitesSessao.retirado', { perfil: nomePerfil(perfil.value) })
        : t('acesso.limitesSessao.gravado', { perfil: nomePerfil(perfil.value), n: r.limite });
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if (e instanceof ErroApi && (tipo === 'reautenticacao-necessaria' || e.status === 401)) {
      erroSenha.value = t('acesso.politicaSenha.senhaErrada');
      senha.value = '';
      return;
    }
    dialogo.value = false;
    const p = e instanceof ErroApi ? e.problema : null;
    recusa.value = p?.detail || p?.title || t('acesso.limitesSessao.falha');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="limites" aria-labelledby="limites-sessao-titulo" data-testid="limites-sessao">
    <h2 id="limites-sessao-titulo">{{ t('acesso.limitesSessao.titulo') }}</h2>
    <p>{{ t('acesso.limitesSessao.texto') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="limites-sessao-aviso" />
    <SanteAlerta
      v-if="recusa"
      :texto="recusa"
      variante="aviso"
      anunciar
      data-testid="limites-sessao-recusa"
    />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="dados">
      <p v-if="dados.vigentes.length === 0" data-testid="limites-sessao-nenhum">
        {{ t('acesso.limitesSessao.nenhum') }}
      </p>
      <table v-else data-testid="limites-sessao-vigentes">
        <caption class="oculto">
          {{
            t('acesso.limitesSessao.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('acesso.limitesSessao.colPerfil') }}</th>
            <th scope="col">{{ t('acesso.limitesSessao.colLimite') }}</th>
            <th scope="col">
              <span class="oculto">{{ t('acesso.limitesSessao.alterar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in dados.vigentes" :key="v.perfil" :data-testid="`limite-sessao-${v.perfil}`">
            <td>{{ nomePerfil(v.perfil) }}</td>
            <td>{{ v.limite }}</td>
            <td class="limites__acoes">
              <SanteBotao
                :rotulo="t('acesso.limitesSessao.alterar')"
                variante="texto"
                :data-testid="`limite-sessao-alterar-${v.perfil}`"
                @acionar="abrir('definir', v.perfil, v.limite)"
              />
              <SanteBotao
                :rotulo="t('acesso.limitesSessao.retirar')"
                variante="texto"
                :data-testid="`limite-sessao-retirar-${v.perfil}`"
                @acionar="abrir('retirar', v.perfil)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        :rotulo="t('acesso.limitesSessao.incluir')"
        variante="secundario"
        data-testid="limites-sessao-incluir"
        @acionar="abrir('definir', '*')"
      />
      <details
        v-if="dados.historico.length"
        class="limites__historico"
        data-testid="limites-sessao-historico"
      >
        <summary>{{ t('acesso.limitesSessao.historico', { n: dados.historico.length }) }}</summary>
        <ul>
          <li v-for="(h, i) in dados.historico" :key="i">
            {{ quando(h.criadoEm) }} · {{ nomePerfil(h.perfil) }}:
            {{ h.limite === null ? t('acesso.limitesSessao.semLimite') : h.limite }} · {{ h.criadoPor }} ·
            {{ h.motivo }}
          </li>
        </ul>
      </details>
    </template>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="acao === 'retirar' ? t('acesso.limitesSessao.retirar') : t('acesso.limitesSessao.definir')"
    >
      <form class="limites__form" data-testid="limites-sessao-form" @submit.prevent="confirmar">
        <SanteSelecao
          v-if="acao === 'definir'"
          v-model="perfil"
          :rotulo="t('acesso.limitesSessao.colPerfil')"
          :opcoes="opcoesPerfil"
          obrigatorio
          data-testid="limites-sessao-perfil"
        />
        <p v-else>{{ t('acesso.limitesSessao.textoRetirar', { perfil: nomePerfil(perfil ?? '*') }) }}</p>
        <div v-if="acao === 'definir'" class="campo">
          <label for="limite-sessao-n">{{ t('acesso.limitesSessao.colLimite') }}</label>
          <input
            id="limite-sessao-n"
            v-model="limite"
            type="number"
            min="1"
            max="50"
            required
            data-testid="limites-sessao-limite"
          />
        </div>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('acesso.politicaSenha.campos.motivo')"
          :max-bytes="200"
          data-testid="limites-sessao-motivo"
        />
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="limites-sessao-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="limites-sessao-senha" />
        <div class="limites__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('acesso.politicaSenha.gravando') : t('acesso.limitesSessao.gravar')"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="limites-sessao-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.limites {
  margin-top: var(--sgh-espaco-4, 2rem);
}
table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: var(--sgh-espaco-2);
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.limites__acoes,
.limites__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.limites__botoes {
  justify-content: flex-end;
}
.limites__form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.limites__historico {
  margin-top: var(--sgh-espaco-2);
}
input {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  max-width: 8rem;
}
</style>
