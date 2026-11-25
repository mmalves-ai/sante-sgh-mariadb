<script setup lang="ts">
// Manutenção das regras de alerta administrativo (01-ADM L75), dentro de "Alertas e gatilhos do sistema".
// Desenho: a lista e o formulário na mesma tela; ativar e desativar num clique na linha (a regra volta inteira como
// foi lida, só a situação muda); a regra é conferida ENQUANTO se digita pela mesma função do domínio que o servidor
// usa, e o botão de gravar só libera sem pendência; perfis por marcação e usuários por login, sem diálogo.
// A gravação é do servidor (operação com trilha e versão); sem o banco do cliente a API responde 503 e a manutenção
// some, ficando só a consulta.
import { PERMISSOES_M10_CODIGOS as C } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarRegraAlerta, lerPainelNotificacao } from '../api-notificacao-regras.js';
import {
  CANAIS,
  conferirRegra,
  corpoDaRegra,
  corpoDaSituacao,
  type FormRegra,
  formDaRegra,
  formNovo,
  GRAVIDADES,
  incluirUsuario,
  MENSAGEM_FALHA_REGRA,
  type RegraLida,
  REPETICOES,
  SEXOS,
} from '../regra-alerta-tela.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeEditar = computed(() => pode(C.alertaEditar));
const painel = useQuery({
  queryKey: ['adm', 'regras-alerta'],
  queryFn: () => lerPainelNotificacao(),
  retry: false,
});
const indisponivel = computed(
  () => painel.error.value instanceof ErroApi && painel.error.value.status === 503,
);

const form = ref<FormRegra | null>(null);
const emEdicao = ref<RegraLida | null>(null);
const loginDigitado = ref('');
const loginInvalido = ref(false);
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);
const titulo = ref<HTMLElement | null>(null);

const hoje = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const cenarios = computed(() => painel.data.value?.cenarios ?? []);
const descricaoCenario = (codigo: string) =>
  cenarios.value.find((c) => c.codigo === codigo)?.descricao ?? codigo;
const opcoesCenario = computed(() => [
  { valor: '', rotulo: t('regrasAlerta.form.escolha') },
  ...cenarios.value.map((c) => ({ valor: c.codigo, rotulo: c.descricao })),
]);
const opcoesDe = (lista: readonly string[], grupo: string) =>
  computed(() => lista.map((v) => ({ valor: v, rotulo: t(`regrasAlerta.${grupo}.${v}`) })));
const opcoesGravidade = opcoesDe(GRAVIDADES, 'gravidades');
const opcoesRepeticao = opcoesDe(REPETICOES, 'repeticoes');
const opcoesSexo = opcoesDe(SEXOS, 'sexos');
const opcoesConsolidacao = computed(() => [
  { valor: '', rotulo: t('regrasAlerta.form.semConsolidacao') },
  ...(painel.data.value?.consolidacoes ?? [])
    .filter((c) => c.ativo || c.codigo === form.value?.consolidacao)
    .map((c) => ({ valor: c.codigo, rotulo: c.nome })),
]);
const perfis = computed(() => painel.data.value?.perfis ?? []);

/** Conteúdo travado: regra de todos os estabelecimentos ou padrão do sistema, para quem não pode mudá-la. */
const travado = computed(() => emEdicao.value !== null && !emEdicao.value.conteudoEditavel);
const falha = computed(() => (form.value ? conferirRegra(form.value) : null));

const canaisDe = (r: RegraLida) =>
  CANAIS.filter((c) => r.notifica[c])
    .map((c) => t(`regrasAlerta.canais.${c}`))
    .join(', ');
const destinatariosDe = (r: RegraLida) =>
  t('regrasAlerta.destinatariosN', {
    p: r.destinatarios.filter((d) => d.tipo === 'perfil').length,
    u: r.destinatarios.filter((d) => d.tipo === 'usuario').length,
  });

async function abrir(r: RegraLida | null): Promise<void> {
  aviso.value = '';
  erro.value = null;
  loginDigitado.value = '';
  loginInvalido.value = false;
  emEdicao.value = r;
  form.value = r ? formDaRegra(r) : formNovo(hoje());
  await nextTick();
  titulo.value?.focus();
}
function fechar(): void {
  form.value = null;
  emEdicao.value = null;
}
function adicionarUsuario(): void {
  if (!form.value) return;
  const nova = incluirUsuario(form.value.usuarios, loginDigitado.value);
  loginInvalido.value = nova === null;
  if (nova === null) return;
  form.value.usuarios = nova;
  loginDigitado.value = '';
}
function retirarUsuario(login: string): void {
  if (form.value) form.value.usuarios = form.value.usuarios.filter((u) => u !== login);
}

async function enviar(corpo: Record<string, unknown>, mensagem: (versao: number) => string): Promise<void> {
  if (ocupado.value) return;
  aviso.value = '';
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await gravarRegraAlerta(corpo, crypto.randomUUID());
    aviso.value = mensagem(Number(r.resultado['numeroVersao'] ?? 0));
    fechar();
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['adm', 'regras-alerta'] }),
      qc.invalidateQueries({ queryKey: ['adm', 'alertas'] }),
    ]);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function gravar(): Promise<void> {
  const f = form.value;
  if (!f || falha.value) return;
  await enviar(corpoDaRegra(f), (n) => t('regrasAlerta.gravada', { nome: f.nome.trim(), n }));
}
async function trocarSituacao(r: RegraLida): Promise<void> {
  await enviar(corpoDaSituacao(r, !r.ativo), () =>
    t(r.ativo ? 'regrasAlerta.desativada' : 'regrasAlerta.ativada', { nome: r.nome }),
  );
}
</script>

<template>
  <section class="regras" aria-labelledby="regras-alerta-titulo" data-testid="regras-alerta">
    <h2 id="regras-alerta-titulo">{{ t('regrasAlerta.titulo') }}</h2>
    <p v-if="indisponivel" role="status" data-testid="regras-indisponivel">
      {{ t('regrasAlerta.indisponivel') }}
    </p>
    <MensagemErro v-else-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('regrasAlerta.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <p>{{ t('regrasAlerta.texto') }}</p>
      <p v-if="!podeEditar" data-testid="regras-sem-edicao">{{ t('regrasAlerta.semEdicao') }}</p>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="regras-aviso" />
      <MensagemErro v-if="erro" :erro="erro" />
      <SanteBotao
        v-if="podeEditar && !form"
        :rotulo="t('regrasAlerta.nova')"
        data-testid="regra-nova"
        @acionar="abrir(null)"
      />

      <div class="rolagem" tabindex="0" role="region" :aria-label="t('regrasAlerta.legenda')">
        <table data-testid="regras-tabela">
          <caption>
            {{
              t('regrasAlerta.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('regrasAlerta.col.regra') }}</th>
              <th scope="col">{{ t('regrasAlerta.col.cenario') }}</th>
              <th scope="col">{{ t('regrasAlerta.col.gravidade') }}</th>
              <th scope="col">{{ t('regrasAlerta.col.canais') }}</th>
              <th scope="col">{{ t('regrasAlerta.col.destinatarios') }}</th>
              <th scope="col">{{ t('regrasAlerta.col.situacao') }}</th>
              <th v-if="podeEditar" scope="col">{{ t('regrasAlerta.col.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="painel.data.value.regras.length === 0">
              <td :colspan="podeEditar ? 7 : 6">{{ t('regrasAlerta.nenhuma') }}</td>
            </tr>
            <tr v-for="r in painel.data.value.regras" :key="r.id" :data-testid="`regra-${r.codigo}`">
              <th scope="row">
                {{ r.nome }}
                <small>
                  {{ r.codigo }} · {{ t('regrasAlerta.versao', { n: r.numeroVersao }) }}
                  <template v-if="!r.editavel"> · {{ t('regrasAlerta.doProduto') }}</template>
                  <template v-else-if="r.global"> · {{ t('regrasAlerta.todos') }}</template>
                </small>
              </th>
              <td>{{ descricaoCenario(r.cenario) }}</td>
              <td>{{ t(`regrasAlerta.gravidades.${r.gravidade}`) }}</td>
              <td>{{ canaisDe(r) || '—' }}</td>
              <td>{{ destinatariosDe(r) }}</td>
              <td :data-testid="`regra-situacao-${r.codigo}`">
                {{ r.ativo ? t('regrasAlerta.ativa') : t('regrasAlerta.inativa') }}
              </td>
              <td v-if="podeEditar" class="acoes">
                <SanteBotao
                  :rotulo="t('regrasAlerta.alterar')"
                  :aria-label="t('regrasAlerta.alterarDe', { nome: r.nome })"
                  variante="secundario"
                  :desabilitado="ocupado"
                  :data-testid="`regra-alterar-${r.codigo}`"
                  @acionar="abrir(r)"
                />
                <SanteBotao
                  :rotulo="r.ativo ? t('regrasAlerta.desativar') : t('regrasAlerta.ativar')"
                  :aria-label="
                    t(r.ativo ? 'regrasAlerta.desativarDe' : 'regrasAlerta.ativarDe', { nome: r.nome })
                  "
                  variante="texto"
                  :desabilitado="ocupado"
                  :data-testid="`regra-situacao-trocar-${r.codigo}`"
                  @acionar="trocarSituacao(r)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <form
        v-if="podeEditar && form"
        class="formulario"
        data-testid="form-regra-alerta"
        novalidate
        @submit.prevent="gravar"
      >
        <h3 ref="titulo" tabindex="-1">
          {{
            emEdicao
              ? t('regrasAlerta.form.tituloAlterar', { nome: emEdicao.nome })
              : t('regrasAlerta.form.tituloNova')
          }}
        </h3>
        <p v-if="travado" data-testid="regra-travada">
          {{
            emEdicao && !emEdicao.editavel
              ? t('regrasAlerta.form.soSituacaoProduto')
              : t('regrasAlerta.form.soSituacaoGlobal')
          }}
        </p>
        <fieldset class="grupo" :disabled="travado">
          <legend class="sgh-visualmente-oculto">{{ t('regrasAlerta.col.regra') }}</legend>
          <div class="campo">
            <label for="regra-codigo">{{ t('regrasAlerta.form.codigo') }}</label>
            <input
              id="regra-codigo"
              v-model="form.codigo"
              maxlength="60"
              :disabled="emEdicao !== null"
              aria-describedby="regra-codigo-ajuda"
              data-testid="regra-codigo"
            />
            <small id="regra-codigo-ajuda">{{ t('regrasAlerta.form.codigoAjuda') }}</small>
          </div>
          <div class="campo">
            <label for="regra-nome">{{ t('regrasAlerta.form.nome') }}</label>
            <input id="regra-nome" v-model="form.nome" maxlength="150" data-testid="regra-nome" />
          </div>
          <SanteSelecao
            v-model="form.cenario"
            :rotulo="t('regrasAlerta.form.cenario')"
            :opcoes="opcoesCenario"
            :desabilitado="travado"
            obrigatorio
            data-testid="regra-cenario"
          />
          <div class="campo">
            <label for="regra-mensagem">{{ t('regrasAlerta.form.mensagem') }}</label>
            <textarea
              id="regra-mensagem"
              v-model="form.mensagem"
              maxlength="1000"
              rows="2"
              data-testid="regra-mensagem"
            />
          </div>
          <div class="campo">
            <label for="regra-descricao">{{ t('regrasAlerta.form.descricao') }}</label>
            <textarea
              id="regra-descricao"
              v-model="form.descricao"
              maxlength="1000"
              rows="2"
              data-testid="regra-descricao"
            />
          </div>
          <div class="linha">
            <SanteSelecao
              v-model="form.gravidade"
              :rotulo="t('regrasAlerta.form.gravidade')"
              :opcoes="opcoesGravidade"
              :desabilitado="travado"
              data-testid="regra-gravidade"
            />
            <SanteSelecao
              v-model="form.repeticao"
              :rotulo="t('regrasAlerta.form.repeticao')"
              :opcoes="opcoesRepeticao"
              :desabilitado="travado"
              data-testid="regra-repeticao"
            />
            <div v-if="form.repeticao === 'intervalo'" class="campo">
              <label for="regra-intervalo">{{ t('regrasAlerta.form.intervalo') }}</label>
              <input
                id="regra-intervalo"
                v-model="form.intervaloMinutos"
                inputmode="numeric"
                maxlength="6"
                data-testid="regra-intervalo"
              />
            </div>
          </div>
          <div class="linha">
            <SanteSelecao
              v-model="form.sexo"
              :rotulo="t('regrasAlerta.form.sexo')"
              :opcoes="opcoesSexo"
              :desabilitado="travado"
              data-testid="regra-sexo"
            />
            <div class="campo">
              <label for="regra-idade-minima">{{ t('regrasAlerta.form.idadeMinima') }}</label>
              <input
                id="regra-idade-minima"
                v-model="form.idadeMinima"
                inputmode="numeric"
                maxlength="3"
                data-testid="regra-idade-minima"
              />
            </div>
            <div class="campo">
              <label for="regra-idade-maxima">{{ t('regrasAlerta.form.idadeMaxima') }}</label>
              <input
                id="regra-idade-maxima"
                v-model="form.idadeMaxima"
                inputmode="numeric"
                maxlength="3"
                data-testid="regra-idade-maxima"
              />
            </div>
          </div>
          <label class="marcacao">
            <input v-model="form.bloqueante" type="checkbox" data-testid="regra-bloqueante" />
            {{ t('regrasAlerta.form.bloqueante') }}
          </label>
          <label class="marcacao">
            <input v-model="form.exigeJustificativa" type="checkbox" data-testid="regra-justificativa" />
            {{ t('regrasAlerta.form.exigeJustificativa') }}
          </label>
          <fieldset class="grupo">
            <legend>{{ t('regrasAlerta.form.canais') }}</legend>
            <label v-for="c in CANAIS" :key="c" class="marcacao">
              <input v-model="form.canais[c]" type="checkbox" :data-testid="`regra-canal-${c}`" />
              {{ t(`regrasAlerta.canais.${c}`) }}
            </label>
          </fieldset>
          <SanteSelecao
            v-model="form.consolidacao"
            :rotulo="t('regrasAlerta.form.consolidacao')"
            :opcoes="opcoesConsolidacao"
            :desabilitado="travado"
            data-testid="regra-consolidacao"
          />
          <div class="linha">
            <div class="campo">
              <label for="regra-vigencia-inicio">{{ t('regrasAlerta.form.vigenciaInicio') }}</label>
              <input
                id="regra-vigencia-inicio"
                v-model="form.vigenciaInicio"
                type="date"
                data-testid="regra-vigencia-inicio"
              />
            </div>
            <div class="campo">
              <label for="regra-vigencia-fim">{{ t('regrasAlerta.form.vigenciaFim') }}</label>
              <input
                id="regra-vigencia-fim"
                v-model="form.vigenciaFim"
                type="date"
                data-testid="regra-vigencia-fim"
              />
            </div>
          </div>
        </fieldset>

        <fieldset class="grupo">
          <legend>{{ t('regrasAlerta.form.perfis') }}</legend>
          <p v-if="perfis.length === 0">{{ t('regrasAlerta.form.semPerfis') }}</p>
          <label v-for="p in perfis" :key="p.codigo" class="marcacao">
            <input
              v-model="form.perfis"
              type="checkbox"
              :value="p.codigo"
              :data-testid="`regra-perfil-${p.codigo}`"
            />
            {{ p.nome }}
          </label>
        </fieldset>
        <div class="campo">
          <label for="regra-usuario">{{ t('regrasAlerta.form.usuario') }}</label>
          <div class="linha">
            <input
              id="regra-usuario"
              v-model="loginDigitado"
              maxlength="60"
              autocomplete="off"
              :aria-invalid="loginInvalido"
              data-testid="regra-usuario"
              @keydown.enter.prevent="adicionarUsuario"
            />
            <SanteBotao
              :rotulo="t('regrasAlerta.form.incluirUsuario')"
              variante="secundario"
              data-testid="regra-usuario-incluir"
              @acionar="adicionarUsuario"
            />
          </div>
          <small v-if="loginInvalido" role="alert">{{ t('regrasAlerta.form.usuarioInvalido') }}</small>
        </div>
        <ul
          v-if="form.usuarios.length > 0"
          class="usuarios"
          :aria-label="t('regrasAlerta.form.usuarios')"
          data-testid="regra-usuarios"
        >
          <li v-for="u in form.usuarios" :key="u">
            {{ u }}
            <SanteBotao
              :rotulo="t('regrasAlerta.form.retirar', { login: u })"
              variante="texto"
              :data-testid="`regra-usuario-retirar-${u}`"
              @acionar="retirarUsuario(u)"
            />
          </li>
        </ul>

        <label class="marcacao">
          <input v-model="form.ativo" type="checkbox" data-testid="regra-ativa" />
          {{ t('regrasAlerta.form.ativa') }}
        </label>
        <div v-if="emEdicao && !travado" class="campo">
          <label for="regra-motivo">{{ t('regrasAlerta.form.motivo') }}</label>
          <input id="regra-motivo" v-model="form.motivo" maxlength="500" data-testid="regra-motivo" />
        </div>

        <p v-if="falha" class="pendencia" role="status" data-testid="regra-pendencia">
          {{ MENSAGEM_FALHA_REGRA[falha] }}
        </p>
        <div class="linha">
          <SanteBotao
            :rotulo="t('regrasAlerta.form.gravar')"
            tipo="submit"
            :desabilitado="ocupado || falha !== null"
            data-testid="regra-gravar"
          />
          <SanteBotao
            :rotulo="t('regrasAlerta.form.cancelar')"
            variante="texto"
            data-testid="regra-cancelar"
            @acionar="fechar"
          />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.regras {
  margin-bottom: var(--sgh-espaco-3);
}
.rolagem {
  overflow-x: auto;
  margin: var(--sgh-espaco-2) 0;
}
th small {
  display: block;
  font-weight: normal;
}
.acoes {
  white-space: nowrap;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 48rem;
  margin: var(--sgh-espaco-3) 0;
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
}
.grupo {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.marcacao {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.usuarios {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.pendencia {
  margin: 0;
  font-weight: 600;
}
</style>
