<script setup lang="ts">
// Contas do portal do prestador credenciado (M56, etapa 8, F7; credenciamento da rede: `operadora.prestador.ler` /
// `.editar`): a lista (prestador, responsável, e-mail, funções liberadas, situação, validade da ativação, bloqueio e
// último acesso), a criação com o código de ativação de uso único (mostrado só uma vez), a troca das funções e do tipo de
// atendimento, a reemissão do código (zera a senha e o segundo fator) e o encerramento com o motivo. Só as funções
// liberáveis ao prestador podem ser marcadas; o servidor confere de novo. A fatia nasce desligada (POL-3).
import type { AcessoPortalPrestador, ResultadoAcessoPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import {
  alterarAcessoPortal,
  criarAcessoPortal,
  encerrarAcessoPortal,
  lerAcessosPortal,
  reemitirAcessoPortal,
} from '../../api-atendimento.js';

const { t } = useI18n();
const cliente = useQueryClient();
const acessos = useQuery({ queryKey: ['operadora', 'portal', 'acessos'], queryFn: () => lerAcessosPortal() });
const dados = computed(() => acessos.data.value);
const ligada = computed(() => dados.value?.ligada === true);
const podeEditar = computed(() => dados.value?.podeEditar === true && ligada.value);

const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string | null) =>
  d ? `${data(d)} ${d.slice(11, 16)}`.trim() : t('operadoraAtendimento.portal.nunca');
const rotuloFuncao = (c: number) => dados.value?.funcoes.find((f) => f.codigo === c)?.rotulo ?? String(c);
const rotuloTipo = (c: number) =>
  dados.value?.tiposAtendimento.find((f) => f.codigo === c)?.rotulo ?? String(c);

// ── Diálogo (criar, alterar, reemitir, encerrar) ────────────────────────────────────────────────
type Modo = 'criar' | 'alterar' | 'reemitir' | 'encerrar';
const modo = ref<Modo | null>(null);
const alvo = ref<AcessoPortalPrestador | null>(null);
const visivel = computed({
  get: () => modo.value !== null,
  set: (v: boolean) => {
    if (!v) modo.value = null;
  },
});
const f = reactive({
  operadora: null as number | null,
  prestador: null as number | null,
  login: '',
  nome: '',
  funcoes: [] as number[],
  tipoAtendimento: null as number | null,
  motivo: '',
});
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);
const mensagem = ref<string | null>(null);
const codigo = ref<{ codigo: string; ate: string } | null>(null);

function abrir(m: Modo, a: AcessoPortalPrestador | null = null): void {
  alvo.value = a;
  const ops = dados.value?.operadoras ?? [];
  Object.assign(f, {
    operadora: ops.length === 1 ? ops[0]!.id : null,
    prestador: null,
    login: '',
    nome: '',
    funcoes: a ? [...a.funcoes] : [],
    tipoAtendimento: a?.tipoAtendimento ?? dados.value?.tiposAtendimento[0]?.codigo ?? null,
    motivo: '',
  });
  recusa.value = null;
  erro.value = null;
  modo.value = m;
}

const opcoesOperadora = computed(() => [
  { valor: null, rotulo: t('operadoraAtendimento.form.escolha') },
  ...(dados.value?.operadoras ?? []).map((o) => ({
    valor: o.id as number | null,
    rotulo: `${o.nome} · ANS ${o.registroAns}`,
  })),
]);
const opcoesPrestador = computed(() => [
  { valor: null, rotulo: t('operadoraAtendimento.form.escolha') },
  ...(dados.value?.prestadores ?? []).map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
]);
const opcoesTipo = computed(() =>
  (dados.value?.tiposAtendimento ?? []).map((x) => ({ valor: x.codigo as number | null, rotulo: x.rotulo })),
);
const completo = computed(() => {
  if (modo.value === 'criar')
    return (
      f.operadora !== null &&
      f.prestador !== null &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.login.trim()) &&
      f.nome.trim().length >= 3 &&
      f.funcoes.length > 0 &&
      f.tipoAtendimento !== null
    );
  if (modo.value === 'alterar') return f.funcoes.length > 0 && f.tipoAtendimento !== null;
  if (modo.value === 'encerrar') return f.motivo.trim().length >= 10;
  return modo.value === 'reemitir';
});
const titulo = computed(() =>
  modo.value === 'criar'
    ? t('operadoraAtendimento.portal.nova')
    : modo.value
      ? `${t(`operadoraAtendimento.portal.${modo.value}`)} · ${alvo.value?.login ?? ''}`
      : '',
);

async function confirmar(): Promise<void> {
  if (!modo.value || !completo.value || gravando.value) return;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  try {
    const a = alvo.value;
    let r: ResultadoAcessoPortal;
    if (modo.value === 'criar')
      r = await criarAcessoPortal({
        operadora: f.operadora,
        prestador: f.prestador,
        login: f.login.trim(),
        nome: f.nome,
        funcoes: [...f.funcoes].sort((x, y) => x - y),
        tipoAtendimento: f.tipoAtendimento,
      });
    else if (modo.value === 'alterar' && a)
      r = await alterarAcessoPortal(a.id, {
        versao: a.versao,
        funcoes: [...f.funcoes].sort((x, y) => x - y),
        tipoAtendimento: f.tipoAtendimento,
      });
    else if (modo.value === 'reemitir' && a) r = await reemitirAcessoPortal(a.id, { versao: a.versao });
    else if (a) r = await encerrarAcessoPortal(a.id, { versao: a.versao, motivo: f.motivo });
    else return;
    modo.value = null;
    mensagem.value = r.mensagem;
    codigo.value =
      r.codigoAtivacao && r.ativacaoValidaAte ? { codigo: r.codigoAtivacao, ate: r.ativacaoValidaAte } : null;
    await cliente.invalidateQueries({ queryKey: ['operadora', 'portal', 'acessos'] });
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="portal-acessos-titulo" data-testid="operadora-portal-acessos">
    <h2 id="portal-acessos-titulo">{{ t('operadoraAtendimento.portal.titulo') }}</h2>
    <p>{{ t('operadoraAtendimento.portal.texto') }}</p>
    <MensagemErro v-if="acessos.isError.value" :erro="acessos.error.value" />
    <p v-else-if="!dados" role="status">{{ t('operadoraAtendimento.carregando') }}</p>
    <div v-else-if="!ligada" data-testid="portal-desligada">
      <SanteAlerta :texto="dados.motivo ?? t('operadoraAtendimento.portal.desligada')" variante="info" />
    </div>
    <template v-if="dados && ligada">
      <p v-if="mensagem" role="status" data-testid="portal-mensagem">{{ mensagem }}</p>
      <div v-if="codigo" role="status" data-testid="portal-codigo">
        <SanteAlerta
          variante="aviso"
          :texto="t('operadoraAtendimento.portal.codigo', { codigo: codigo.codigo, ate: quando(codigo.ate) })"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          v-if="podeEditar"
          :rotulo="t('operadoraAtendimento.portal.nova')"
          data-testid="portal-nova"
          @acionar="abrir('criar')"
        />
        <RouterLink to="/prestador/entrar" data-testid="portal-abrir">{{
          t('operadoraAtendimento.portal.abrirPortal')
        }}</RouterLink>
      </div>
      <p v-if="!dados.itens.length" data-testid="portal-nenhum">
        {{ t('operadoraAtendimento.portal.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="portal-lista">
        <caption class="visualmente-oculto">
          {{
            t('operadoraAtendimento.portal.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraAtendimento.portal.prestador') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.portal.nome') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.portal.funcoes') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.portal.situacao') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.portal.ultimoAcesso') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in dados.itens" :key="a.id" :data-testid="`portal-linha-${a.id}`">
            <td>{{ a.prestadorNome }}</td>
            <td>
              {{ a.nome }}<br /><span class="secundario">{{ a.login }}</span>
            </td>
            <td>
              {{ a.funcoes.map(rotuloFuncao).join(', ') }}<br /><span class="secundario">{{
                rotuloTipo(a.tipoAtendimento)
              }}</span>
            </td>
            <td>
              {{ t(`operadoraAtendimento.portal.situacoes.${a.situacao}`) }}
              <span v-if="a.situacao === 'pendente' && a.ativacaoValidaAte" class="secundario"
                ><br />{{ t('operadoraAtendimento.portal.ativacao') }} {{ quando(a.ativacaoValidaAte) }}</span
              >
              <span v-if="a.bloqueadoAte" class="secundario"
                ><br />{{ t('operadoraAtendimento.portal.bloqueado', { ate: quando(a.bloqueadoAte) }) }}</span
              >
              <span v-if="a.motivoEncerramento" class="secundario"><br />{{ a.motivoEncerramento }}</span>
            </td>
            <td>{{ quando(a.ultimoAcessoEm) }}</td>
            <td>
              <div v-if="podeEditar && a.situacao !== 'encerrado'" class="acoes">
                <SanteBotao
                  variante="texto"
                  :rotulo="t('operadoraAtendimento.portal.alterar')"
                  :data-testid="`portal-alterar-${a.id}`"
                  @acionar="abrir('alterar', a)"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('operadoraAtendimento.portal.reemitir')"
                  :data-testid="`portal-reemitir-${a.id}`"
                  @acionar="abrir('reemitir', a)"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('operadoraAtendimento.portal.encerrar')"
                  :data-testid="`portal-encerrar-${a.id}`"
                  @acionar="abrir('encerrar', a)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <SanteDialogo v-model:visivel="visivel" :titulo="titulo" largura="40rem">
      <form v-if="modo && dados" class="formulario" data-testid="portal-dialogo" @submit.prevent="confirmar">
        <template v-if="modo === 'criar'">
          <SanteSelecao
            v-if="dados.operadoras.length > 1"
            v-model="f.operadora"
            :rotulo="t('operadoraAtendimento.form.operadora')"
            :opcoes="opcoesOperadora"
            obrigatorio
            data-testid="portal-operadora"
          />
          <SanteSelecao
            v-model="f.prestador"
            :rotulo="t('operadoraAtendimento.portal.prestador')"
            :opcoes="opcoesPrestador"
            :busca="true"
            obrigatorio
            data-testid="portal-prestador"
          />
          <SanteCampoTexto
            id="portal-login"
            v-model="f.login"
            :rotulo="t('operadoraAtendimento.portal.login')"
            :max-bytes="100"
            obrigatorio
          />
          <SanteCampoTexto
            id="portal-nome"
            v-model="f.nome"
            :rotulo="t('operadoraAtendimento.portal.nome')"
            :max-bytes="120"
            obrigatorio
          />
        </template>
        <template v-if="modo === 'criar' || modo === 'alterar'">
          <fieldset class="funcoes">
            <legend>{{ t('operadoraAtendimento.portal.funcoes') }}</legend>
            <label v-for="x in dados.funcoes" :key="x.codigo" class="marcar">
              <input
                v-model="f.funcoes"
                type="checkbox"
                :value="x.codigo"
                :disabled="!x.liberavel"
                :data-testid="`portal-funcao-${x.codigo}`"
              />
              {{ x.rotulo }}
              <span v-if="!x.liberavel" class="secundario">{{
                t('operadoraAtendimento.portal.naoLiberavel')
              }}</span>
            </label>
          </fieldset>
          <SanteSelecao
            v-model="f.tipoAtendimento"
            :rotulo="t('operadoraAtendimento.portal.tipoAtendimento')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="portal-tipo"
          />
        </template>
        <p v-if="modo === 'reemitir'">{{ t('operadoraAtendimento.portal.reemitirAviso') }}</p>
        <SanteCampoTexto
          v-if="modo === 'encerrar'"
          id="portal-motivo"
          v-model="f.motivo"
          :rotulo="t('operadoraAtendimento.portal.motivo')"
          :max-bytes="200"
          multilinha
          obrigatorio
        />
        <div v-if="recusa" role="alert" data-testid="portal-recusa">
          <SanteAlerta :texto="recusa" variante="alerta" />
        </div>
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('operadoraAtendimento.portal.gravar')"
            :desabilitado="!completo || gravando"
            data-testid="portal-gravar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('operadoraAtendimento.portal.cancelar')"
            @acionar="modo = null"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.formulario {
  display: grid;
  gap: 0.75rem;
}
.funcoes {
  display: grid;
  gap: 0.25rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin: 0;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
</style>
