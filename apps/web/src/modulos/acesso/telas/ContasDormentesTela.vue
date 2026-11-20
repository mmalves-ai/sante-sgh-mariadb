<script setup lang="ts">
// W1-01 (parte 9b2b): "Contas dormentes" (/administracao/acesso/contas-dormentes). Parâmetros e estado do bloqueio,
// prévia de hoje (as que a rotina bloquearia), poupadas (exceção, nunca entrou, último gestor), exceções em vigor
// com incluir/alterar prazo/retirar (diálogo com motivo e a senha: reautenticação) e "Rodar agora" (senha) com o
// resultado. Cada exceção é uma linha nova (histórico visível); o bloqueio é pelo executor, na auditoria.
import type { ContaDormenteTela, RodadaContasDormentesTela } from '@sgh/contratos';
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import { buscarContasDormentes, registrarExcecaoDormencia, rodarContasDormentes } from '../api-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['acesso', 'contas-dormentes'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarContasDormentes() });
const dados = computed(() => consulta.data.value ?? null);

type Acao = 'excecao' | 'retirar' | 'rodar';
const dialogo = ref(false);
const acao = ref<Acao>('excecao');
const login = ref<string | null>(null);
const ate = ref('');
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const aviso = ref('');
const recusa = ref('');
const ocupado = ref(false);
const rodada = ref<RodadaContasDormentesTela | null>(null);

watch(dialogo, (aberto) => {
  if (!aberto) {
    senha.value = '';
    erroSenha.value = '';
  }
});

const data = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const situacao = (c: ContaDormenteTela) =>
  c.situacao === 'excecao'
    ? t('acesso.contasDormentes.situacoes.excecao', { motivo: c.motivoExcecao ?? '' })
    : t(`acesso.contasDormentes.situacoes.${c.situacao}`);
const tipo = (c: ContaDormenteTela) => t(`acesso.contasDormentes.tipos.${c.tipo}`);
const dias = (c: ContaDormenteTela) =>
  c.diasSemAcesso === null ? t('acesso.contasDormentes.nunca') : String(c.diasSemAcesso);

const opcoesLogin = computed(() => {
  const d = dados.value;
  const logins = new Set<string>([
    ...(d?.previa ?? []).map((c) => c.login),
    ...(d?.poupadas ?? []).map((c) => c.login),
    ...(d?.excecoes ?? []).map((x) => x.login),
  ]);
  return [...logins].sort().map((l) => ({ valor: l, rotulo: l }));
});

const ateValido = computed(() => ate.value === '' || /^\d{4}-\d{2}-\d{2}$/.test(ate.value));
const pronto = computed(() => {
  if (ocupado.value || senha.value.length === 0) return false;
  if (acao.value === 'rodar') return true;
  return !!login.value && motivo.value.trim().length >= 10 && (acao.value === 'retirar' || ateValido.value);
});

const titulo = computed(() =>
  acao.value === 'rodar'
    ? t('acesso.contasDormentes.dialogoRodar')
    : acao.value === 'retirar'
      ? t('acesso.contasDormentes.dialogoRetirar', { login: login.value ?? '' })
      : t('acesso.contasDormentes.dialogoIncluir'),
);

function abrir(a: Acao, l: string | null = null, prazo: string | null = null) {
  acao.value = a;
  login.value = l;
  ate.value = prazo ?? '';
  motivo.value = '';
  aviso.value = '';
  recusa.value = '';
  dialogo.value = true;
}

async function confirmar(): Promise<void> {
  if (!pronto.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    if (acao.value === 'rodar') {
      rodada.value = await rodarContasDormentes(senha.value);
    } else {
      const l = login.value ?? '';
      const retirar = acao.value === 'retirar';
      await registrarExcecaoDormencia({
        login: l,
        ate: retirar || ate.value === '' ? null : ate.value,
        retirar,
        motivo: motivo.value.trim(),
        senha: senha.value,
      });
      aviso.value = retirar
        ? t('acesso.contasDormentes.retiradaAviso', { login: l })
        : t('acesso.contasDormentes.gravada', { login: l });
    }
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    const p = e instanceof ErroApi ? e.problema : null;
    const tipoP = p ? tipoDoProblema(p) : null;
    if (e instanceof ErroApi && (tipoP === 'reautenticacao-necessaria' || e.status === 401)) {
      erroSenha.value = t('acesso.contasDormentes.senhaErrada');
      senha.value = '';
      return;
    }
    dialogo.value = false;
    const codigo = (p as { codigo?: unknown } | null)?.codigo;
    recusa.value =
      codigo === 'rodada-em-andamento'
        ? t('acesso.contasDormentes.emAndamento')
        : p?.detail || p?.title || t('acesso.contasDormentes.falha');
  } finally {
    ocupado.value = false;
  }
}

const resultado = computed(() => {
  const r = rodada.value;
  if (!r) return '';
  return r.ligada
    ? t('acesso.contasDormentes.resultado', {
        data: data(r.hoje),
        b: r.bloqueadas.length,
        p: r.poupadas.length,
        f: r.falhas.length,
      })
    : t('acesso.contasDormentes.resultadoDesligada', { data: data(r.hoje), motivo: r.motivo ?? '' });
});
</script>

<template>
  <section class="tela" aria-labelledby="contas-dormentes-titulo">
    <h1 id="contas-dormentes-titulo">{{ t('acesso.contasDormentes.titulo') }}</h1>
    <p>{{ t('acesso.contasDormentes.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="dormentes-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="dormentes-recusa" />
    <section v-if="rodada" class="dormentes__resultado" data-testid="dormentes-resultado" aria-live="polite">
      <p>{{ resultado }}</p>
      <ul v-if="rodada.bloqueadas.length" data-testid="dormentes-resultado-bloqueadas">
        <li v-for="c in rodada.bloqueadas" :key="c.login">{{ c.login }} · {{ dias(c) }}</li>
      </ul>
      <ul v-if="rodada.falhas.length" data-testid="dormentes-resultado-falhas">
        <li v-for="f in rodada.falhas" :key="f.login">
          {{ t('acesso.contasDormentes.falhaConta', { login: f.login, codigo: f.codigo }) }}
        </li>
      </ul>
    </section>

    <template v-if="dados">
      <div class="dormentes__cartoes">
        <section class="dormentes__cartao" aria-labelledby="dormentes-parametros">
          <h2 id="dormentes-parametros">{{ t('acesso.contasDormentes.parametros') }}</h2>
          <ul data-testid="dormentes-parametros">
            <li>
              {{ t('acesso.contasDormentes.rotina') }}:
              {{
                dados.parametros.ligada
                  ? t('acesso.contasDormentes.ligada')
                  : t('acesso.contasDormentes.desligada')
              }}
            </li>
            <li>{{ t('acesso.contasDormentes.diasPessoal', { n: dados.parametros.diasPessoal }) }}</li>
            <li>
              {{ t('acesso.contasDormentes.diasDispositivo', { n: dados.parametros.diasDispositivo }) }}
            </li>
          </ul>
        </section>
      </div>
      <SanteAlerta
        v-if="!dados.bloqueio.ligada"
        :texto="t('acesso.contasDormentes.bloqueioDesligado', { motivo: dados.bloqueio.motivo ?? '' })"
        variante="aviso"
        data-testid="dormentes-bloqueio-desligado"
      />
      <div class="dormentes__acoes">
        <SanteBotao
          :rotulo="t('acesso.contasDormentes.rodar')"
          data-testid="dormentes-rodar"
          @acionar="abrir('rodar')"
        />
        <SanteBotao
          :rotulo="t('acesso.contasDormentes.incluir')"
          variante="secundario"
          data-testid="dormentes-incluir"
          @acionar="abrir('excecao')"
        />
      </div>
      <p class="dormentes__hoje">{{ t('acesso.contasDormentes.hoje', { data: data(dados.hoje) }) }}</p>

      <section aria-labelledby="dormentes-previa">
        <h2 id="dormentes-previa">{{ t('acesso.contasDormentes.previa', { n: dados.previa.length }) }}</h2>
        <p v-if="!dados.previa.length" data-testid="dormentes-previa-nenhuma">
          {{ t('acesso.contasDormentes.previaNenhuma') }}
        </p>
        <div v-else class="dormentes__rolagem">
          <table data-testid="dormentes-previa">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.contasDormentes.colLogin') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colTipo') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colDias') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colLimite') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colUltimo') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.contasDormentes.poupar') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in dados.previa" :key="c.login" :data-testid="`dormentes-previa-${c.login}`">
                <td>{{ c.login }}</td>
                <td>{{ tipo(c) }}</td>
                <td>{{ dias(c) }}</td>
                <td>{{ c.limiteDias }}</td>
                <td>{{ data(c.ultimoAcesso) }}</td>
                <td>
                  <SanteBotao
                    :rotulo="t('acesso.contasDormentes.poupar')"
                    variante="texto"
                    :data-testid="`dormentes-poupar-${c.login}`"
                    @acionar="abrir('excecao', c.login)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="dormentes-poupadas">
        <h2 id="dormentes-poupadas">
          {{ t('acesso.contasDormentes.poupadas', { n: dados.poupadas.length }) }}
        </h2>
        <p v-if="!dados.poupadas.length" data-testid="dormentes-poupadas-nenhuma">
          {{ t('acesso.contasDormentes.poupadasNenhuma') }}
        </p>
        <div v-else class="dormentes__rolagem">
          <table data-testid="dormentes-poupadas">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.contasDormentes.colLogin') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colTipo') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colDias') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colSituacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in dados.poupadas" :key="c.login" :data-testid="`dormentes-poupada-${c.login}`">
                <td>{{ c.login }}</td>
                <td>{{ tipo(c) }}</td>
                <td>{{ dias(c) }}</td>
                <td>{{ situacao(c) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="dormentes-excecoes">
        <h2 id="dormentes-excecoes">
          {{ t('acesso.contasDormentes.excecoes', { n: dados.excecoes.length }) }}
        </h2>
        <p v-if="!dados.excecoes.length" data-testid="dormentes-excecoes-nenhuma">
          {{ t('acesso.contasDormentes.excecoesNenhuma') }}
        </p>
        <div v-else class="dormentes__rolagem">
          <table data-testid="dormentes-excecoes">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.contasDormentes.colLogin') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colAte') }}</th>
                <th scope="col">{{ t('acesso.contasDormentes.colMotivo') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.contasDormentes.alterarPrazo') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in dados.excecoes" :key="x.login" :data-testid="`dormentes-excecao-${x.login}`">
                <td>{{ x.login }}</td>
                <td>{{ x.ate ? data(x.ate) : t('acesso.contasDormentes.semPrazo') }}</td>
                <td>{{ x.motivo }}</td>
                <td class="dormentes__linha-acoes">
                  <SanteBotao
                    :rotulo="t('acesso.contasDormentes.alterarPrazo')"
                    variante="texto"
                    :data-testid="`dormentes-alterar-${x.login}`"
                    @acionar="abrir('excecao', x.login, x.ate)"
                  />
                  <SanteBotao
                    :rotulo="t('acesso.contasDormentes.retirar')"
                    variante="texto"
                    :data-testid="`dormentes-retirar-${x.login}`"
                    @acionar="abrir('retirar', x.login)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details v-if="dados.historico.length" class="dormentes__historico" data-testid="dormentes-historico">
        <summary>{{ t('acesso.contasDormentes.historico', { n: dados.historico.length }) }}</summary>
        <ul>
          <li v-for="(h, i) in dados.historico" :key="i">
            {{ quando(h.criadoEm) }} · {{ h.login }} ·
            {{
              h.situacao === 'vigente'
                ? t('acesso.contasDormentes.vigente')
                : t('acesso.contasDormentes.retirada')
            }}
            · {{ h.ate ? data(h.ate) : t('acesso.contasDormentes.semPrazo') }} · {{ h.criadoPor }} ·
            {{ h.motivo }}
          </li>
        </ul>
      </details>
    </template>

    <SanteDialogo v-model:visivel="dialogo" :titulo="titulo">
      <form class="dormentes__form" data-testid="dormentes-form" @submit.prevent="confirmar">
        <template v-if="acao === 'rodar'">
          <p>{{ t('acesso.contasDormentes.textoRodar', { n: dados?.previa.length ?? 0 }) }}</p>
          <SanteAlerta
            v-if="dados && !dados.bloqueio.ligada"
            :texto="t('acesso.contasDormentes.bloqueioDesligado', { motivo: dados.bloqueio.motivo ?? '' })"
            variante="aviso"
          />
        </template>
        <template v-else>
          <SanteSelecao
            v-if="acao === 'excecao'"
            v-model="login"
            :rotulo="t('acesso.contasDormentes.colLogin')"
            :opcoes="opcoesLogin"
            busca
            obrigatorio
            data-testid="dormentes-login"
          />
          <p v-else>{{ t('acesso.contasDormentes.textoRetirar') }}</p>
          <div v-if="acao === 'excecao'" class="campo">
            <label for="dormentes-ate">{{ t('acesso.contasDormentes.campoAte') }}</label>
            <input id="dormentes-ate" v-model="ate" type="date" data-testid="dormentes-ate" />
          </div>
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('acesso.contasDormentes.campoMotivo')"
            :max-bytes="200"
            data-testid="dormentes-motivo"
          />
        </template>
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="dormentes-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="dormentes-senha" />
        <div class="dormentes__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="
              ocupado
                ? acao === 'rodar'
                  ? t('acesso.contasDormentes.rodando')
                  : t('acesso.contasDormentes.gravando')
                : acao === 'rodar'
                  ? t('acesso.contasDormentes.rodar')
                  : t('acesso.contasDormentes.gravar')
            "
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="dormentes-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.dormentes__cartoes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.dormentes__cartao {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 8px);
  padding: var(--sgh-espaco-2);
}
.dormentes__acoes,
.dormentes__linha-acoes,
.dormentes__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.dormentes__botoes {
  justify-content: flex-end;
}
.dormentes__rolagem {
  overflow-x: auto;
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
.dormentes__form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.dormentes__historico {
  margin-top: var(--sgh-espaco-2);
}
input {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  max-width: 12rem;
}
</style>
