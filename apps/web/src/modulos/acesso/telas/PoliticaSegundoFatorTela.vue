<script setup lang="ts">
// "Política do segundo fator" (M59-F2; ficha do M59, seção 7: /administracao/acesso/2fa). Lista as linhas do
// estabelecimento (alvo, onda, início, prazo de adesão, situação), abre a onda 1 de uma vez, inclui uma linha
// (perfil, grupo ou todos) e volta a opcional (recolher). Toda gravação pede a senha de novo e o motivo; o
// servidor confere a permissão, a linha (sem passado, sem duplicar) e grava a trilha na mesma transação.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ALVOS_POLITICA_2FA,
  type AlvoPolitica2fa,
  CATALOGO_DECLARADO,
  PERFIS_COMPLEMENTARES,
  PERMISSOES_M59_F2_CODIGOS,
  type Politica2fa,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarOpcoesUsuarios } from '../../administracao/api.js';
import {
  abrirOnda1,
  alterarPolitica2fa,
  encerrarPolitica2fa,
  incluirPolitica2fa,
  listarPoliticas2fa,
} from '../api-identidade.js';
import { dataBr, fimDaAdesao, perfisDoCatalogo } from '../identidade-tela.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['identidade', 'politica-2fa'] as const;
const linhas = useQuery({ queryKey: CHAVE, queryFn: () => listarPoliticas2fa() });
const podeEditar = computed(() => pode(PERMISSOES_M59_F2_CODIGOS.politica2faEditar));
const podeUsuarios = computed(() => pode('acesso.usuario.ler'));
const grupos = useQuery({
  queryKey: ['adm', 'usuarios-opcoes'],
  queryFn: () => buscarOpcoesUsuarios(),
  enabled: podeEditar,
});
const aviso = ref('');

const ordenadas = computed(() =>
  [...(linhas.data.value ?? [])].sort(
    (a, b) => Number(b.ativa) - Number(a.ativa) || a.onda - b.onda || a.inicio.localeCompare(b.inicio),
  ),
);
const rotuloAlvo = (l: Pick<Politica2fa, 'alvo' | 'valor'>): string =>
  l.alvo === 'todos'
    ? t('identidade.politica.alvos.todos')
    : `${t(`identidade.politica.alvos.${l.alvo}`)}: ${l.valor ?? ''}`;

const amanha = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: CHAVE });
}

// ── nova linha ─────────────────────────────────────────────────────────────────────────────────
const dialogoNova = ref(false);
const nova = ref<{
  alvo: AlvoPolitica2fa;
  valor: string;
  onda: '1' | '2';
  inicio: string | null;
  prazo: string;
  motivo: string;
}>({ alvo: 'perfil', valor: '', onda: '1', inicio: null, prazo: '14', motivo: '' });
const senha = ref('');
const erro = ref<unknown>(null);
const falta = ref('');
const ocupado = ref(false);
const opcoesAlvo = computed(() =>
  ALVOS_POLITICA_2FA.map((a) => ({ valor: a, rotulo: t(`identidade.politica.alvos.${a}`) })),
);
const opcoesOnda = [
  { valor: '1', rotulo: '1' },
  { valor: '2', rotulo: '2' },
] as const;
const opcoesValor = computed(() =>
  nova.value.alvo === 'perfil'
    ? perfisDoCatalogo(CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES).map((p) => ({ valor: p, rotulo: p }))
    : (grupos.data.value?.grupos ?? [])
        .filter((g) => g.ativo)
        .map((g) => ({ valor: g.nome, rotulo: g.nome })),
);
function abrirNova(): void {
  nova.value = { alvo: 'perfil', valor: '', onda: '1', inicio: amanha(), prazo: '14', motivo: '' };
  senha.value = '';
  erro.value = null;
  falta.value = '';
  dialogoNova.value = true;
}
function trocouAlvo(): void {
  nova.value.valor = '';
  if (nova.value.alvo === 'todos') nova.value.onda = '2';
}
async function incluir(): Promise<void> {
  falta.value = '';
  if (nova.value.alvo !== 'todos' && !nova.value.valor) falta.value = t('identidade.politica.faltaValor');
  else if (!nova.value.inicio) falta.value = t('identidade.politica.faltaInicio');
  if (falta.value || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await incluirPolitica2fa(
      {
        alvo: nova.value.alvo,
        valor: nova.value.alvo === 'todos' ? null : nova.value.valor,
        onda: nova.value.onda === '2' ? 2 : 1,
        inicio: nova.value.inicio ?? '',
        prazoAdesaoDias: Number(nova.value.prazo),
        motivo: nova.value.motivo,
      },
      senha.value,
    );
    dialogoNova.value = false;
    aviso.value = t('identidade.politica.incluida');
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}

// ── onda 1 de uma vez ──────────────────────────────────────────────────────────────────────────
const dialogoOnda = ref(false);
const onda = ref<{ inicio: string | null; prazo: string; motivo: string }>({
  inicio: null,
  prazo: '14',
  motivo: '',
});
function abrirDialogoOnda(): void {
  onda.value = { inicio: amanha(), prazo: '14', motivo: '' };
  senha.value = '';
  erro.value = null;
  falta.value = '';
  dialogoOnda.value = true;
}
async function confirmarOnda(): Promise<void> {
  falta.value = onda.value.inicio ? '' : t('identidade.politica.faltaInicio');
  if (falta.value || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await abrirOnda1(
      {
        inicio: onda.value.inicio ?? '',
        prazoAdesaoDias: Number(onda.value.prazo),
        motivo: onda.value.motivo,
      },
      senha.value,
    );
    dialogoOnda.value = false;
    aviso.value = t('identidade.politica.onda1Aberta', { n: r.incluidas, m: r.jaExistiam });
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}

// ── voltar a opcional (recolher) ───────────────────────────────────────────────────────────────
const encerrando = ref<Politica2fa | null>(null);
const motivoEncerrar = ref('');
const dialogoEncerrar = computed({
  get: () => encerrando.value !== null,
  set: (v: boolean) => {
    if (!v) encerrando.value = null;
  },
});
function abrirEncerrar(l: Politica2fa): void {
  encerrando.value = l;
  motivoEncerrar.value = '';
  senha.value = '';
  erro.value = null;
}
async function encerrar(): Promise<void> {
  const l = encerrando.value;
  if (!l || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await encerrarPolitica2fa(l.id, { motivo: motivoEncerrar.value }, senha.value);
    encerrando.value = null;
    aviso.value = t('identidade.politica.encerradaOk');
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}

// ── alterar o alvo e o prazo da linha vigente (W0-09) ──────────────────────────────────────────
const alterando = ref<Politica2fa | null>(null);
const alt = ref<{ alvo: AlvoPolitica2fa; valor: string; prazo: string; motivo: string }>({
  alvo: 'perfil',
  valor: '',
  prazo: '14',
  motivo: '',
});
const dialogoAlterar = computed({
  get: () => alterando.value !== null,
  set: (v: boolean) => {
    if (!v) alterando.value = null;
  },
});
const opcoesValorAlt = computed(() =>
  alt.value.alvo === 'perfil'
    ? perfisDoCatalogo(CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES).map((p) => ({ valor: p, rotulo: p }))
    : (grupos.data.value?.grupos ?? [])
        .filter((g) => g.ativo)
        .map((g) => ({ valor: g.nome, rotulo: g.nome })),
);
function abrirAlterar(l: Politica2fa): void {
  alterando.value = l;
  alt.value = { alvo: l.alvo, valor: l.valor ?? '', prazo: String(l.prazoAdesaoDias), motivo: '' };
  senha.value = '';
  erro.value = null;
  falta.value = '';
}
async function alterar(): Promise<void> {
  const l = alterando.value;
  falta.value = '';
  if (alt.value.alvo !== 'todos' && !alt.value.valor) falta.value = t('identidade.politica.faltaValor');
  else if (alt.value.motivo.trim().length < 5) falta.value = t('identidade.comum.motivoAjuda');
  if (!l || falta.value || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await alterarPolitica2fa(
      l.id,
      {
        alvo: alt.value.alvo,
        valor: alt.value.alvo === 'todos' ? null : alt.value.valor,
        prazoAdesaoDias: Number(alt.value.prazo),
        motivo: alt.value.motivo.trim(),
      },
      senha.value,
    );
    alterando.value = null;
    aviso.value = t('identidade.politica.alterada');
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="politica-2fa-titulo">
    <h1 id="politica-2fa-titulo">{{ t('identidade.politica.titulo') }}</h1>
    <p>{{ t('identidade.politica.texto') }}</p>
    <p v-if="podeUsuarios">
      <RouterLink to="/administracao/acesso/usuarios?vista=identidade" data-testid="politica-ir-usuarios">{{
        t('identidade.politica.linkUsuarios')
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="politica-aviso" />
    <p v-if="!podeEditar" data-testid="politica-sem-edicao">{{ t('identidade.politica.semEdicao') }}</p>
    <div v-else class="botoes">
      <SanteBotao
        :rotulo="t('identidade.politica.abrirOnda1')"
        data-testid="politica-abrir-onda1"
        @acionar="abrirDialogoOnda"
      />
      <SanteBotao
        :rotulo="t('identidade.politica.nova')"
        variante="secundario"
        data-testid="politica-nova"
        @acionar="abrirNova"
      />
    </div>

    <MensagemErro v-if="linhas.isError.value" :erro="linhas.error.value" />
    <p v-else-if="linhas.isPending.value">{{ t('identidade.comum.carregando') }}</p>
    <p v-else-if="ordenadas.length === 0" role="status" data-testid="politica-vazia">
      {{ t('identidade.politica.nenhuma') }}
    </p>
    <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('identidade.usuarios.rolagem')">
      <table data-testid="tabela-politica-2fa">
        <caption>
          {{
            t('identidade.politica.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('identidade.politica.alvo') }}</th>
            <th scope="col">{{ t('identidade.politica.onda') }}</th>
            <th scope="col">{{ t('identidade.politica.inicio') }}</th>
            <th scope="col">{{ t('identidade.politica.fimAdesao') }}</th>
            <th scope="col">{{ t('identidade.politica.situacao') }}</th>
            <th scope="col">{{ t('identidade.politica.criadaPor') }}</th>
            <th v-if="podeEditar" scope="col">{{ t('identidade.politica.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in ordenadas" :key="l.id" :data-testid="`politica-linha-${l.id}`">
            <th scope="row">{{ rotuloAlvo(l) }}</th>
            <td>{{ l.onda }}</td>
            <td>{{ dataBr(l.inicio) }}</td>
            <td>{{ dataBr(fimDaAdesao(l.inicio, l.prazoAdesaoDias)) }} ({{ l.prazoAdesaoDias }})</td>
            <td>
              {{
                l.ativa
                  ? t('identidade.politica.ativa')
                  : t('identidade.politica.encerrada', { data: dataBr(l.encerradaEm) })
              }}
            </td>
            <td>{{ l.criadaPor }}</td>
            <td v-if="podeEditar">
              <SanteBotao
                v-if="l.ativa"
                :rotulo="t('identidade.politica.alterar')"
                variante="texto"
                :data-testid="`politica-alterar-${l.id}`"
                @acionar="abrirAlterar(l)"
              />
              <SanteBotao
                v-if="l.ativa"
                :rotulo="t('identidade.politica.encerrar')"
                variante="texto"
                :data-testid="`politica-encerrar-${l.id}`"
                @acionar="abrirEncerrar(l)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SanteDialogo v-model:visivel="dialogoNova" :titulo="t('identidade.politica.nova')">
      <form class="form" data-testid="form-politica-nova" @submit.prevent="incluir">
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteSelecao
          v-model="nova.alvo"
          :rotulo="t('identidade.politica.alvo')"
          :opcoes="opcoesAlvo"
          obrigatorio
          data-testid="politica-alvo"
          @update:model-value="trocouAlvo"
        />
        <SanteSelecao
          v-if="nova.alvo !== 'todos'"
          v-model="nova.valor"
          :rotulo="t('identidade.politica.valor')"
          :opcoes="opcoesValor"
          :busca="true"
          obrigatorio
          data-testid="politica-valor"
        />
        <SanteSelecao
          v-model="nova.onda"
          :rotulo="t('identidade.politica.onda')"
          :opcoes="opcoesOnda"
          :desabilitado="nova.alvo === 'todos'"
          data-testid="politica-onda"
        />
        <SanteData v-model="nova.inicio" :rotulo="t('identidade.politica.inicio')" editavel />
        <label class="campo">
          <span>{{ t('identidade.politica.prazo') }}</span>
          <input v-model="nova.prazo" type="number" min="0" max="90" required data-testid="politica-prazo" />
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.motivo') }}</span>
          <input v-model="nova.motivo" minlength="5" maxlength="200" required data-testid="politica-motivo" />
          <small>{{ t('identidade.comum.motivoAjuda') }}</small>
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="politica-senha"
          />
        </label>
        <SanteAlerta v-if="falta" :texto="falta" variante="aviso" anunciar />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="politica-incluir"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoNova = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoOnda" :titulo="t('identidade.politica.abrirOnda1')">
      <form class="form" data-testid="form-politica-onda1" @submit.prevent="confirmarOnda">
        <p>{{ t('identidade.politica.onda1Texto') }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteData v-model="onda.inicio" :rotulo="t('identidade.politica.inicio')" editavel />
        <label class="campo">
          <span>{{ t('identidade.politica.prazo') }}</span>
          <input v-model="onda.prazo" type="number" min="0" max="90" required data-testid="onda1-prazo" />
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.motivo') }}</span>
          <input v-model="onda.motivo" minlength="5" maxlength="200" required data-testid="onda1-motivo" />
          <small>{{ t('identidade.comum.motivoAjuda') }}</small>
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="onda1-senha"
          />
        </label>
        <SanteAlerta v-if="falta" :texto="falta" variante="aviso" anunciar />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="onda1-confirmar"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoOnda = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoAlterar"
      :titulo="alterando ? t('identidade.politica.alterarDe', { alvo: rotuloAlvo(alterando) }) : ''"
    >
      <form class="form" data-testid="form-politica-alterar" @submit.prevent="alterar">
        <p>{{ t('identidade.politica.alterarTexto') }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteSelecao
          v-model="alt.alvo"
          :rotulo="t('identidade.politica.alvo')"
          :opcoes="opcoesAlvo"
          obrigatorio
          data-testid="alterar-alvo"
          @update:model-value="alt.valor = ''"
        />
        <SanteSelecao
          v-if="alt.alvo !== 'todos'"
          v-model="alt.valor"
          :rotulo="t('identidade.politica.valor')"
          :opcoes="opcoesValorAlt"
          :busca="true"
          obrigatorio
          data-testid="alterar-valor"
        />
        <label class="campo">
          <span>{{ t('identidade.politica.prazo') }}</span>
          <input v-model="alt.prazo" type="number" min="0" max="90" required data-testid="alterar-prazo" />
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.motivo') }}</span>
          <input v-model="alt.motivo" minlength="5" maxlength="200" required data-testid="alterar-motivo" />
          <small>{{ t('identidade.comum.motivoAjuda') }}</small>
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="alterar-senha"
          />
        </label>
        <p v-if="falta" role="alert" data-testid="alterar-falta">{{ falta }}</p>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="alterar-confirmar"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoAlterar = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoEncerrar"
      :titulo="encerrando ? t('identidade.politica.encerrarDe', { alvo: rotuloAlvo(encerrando) }) : ''"
    >
      <form class="form" data-testid="form-politica-encerrar" @submit.prevent="encerrar">
        <p>{{ t('identidade.politica.encerrarTexto') }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
        <label class="campo">
          <span>{{ t('identidade.comum.motivo') }}</span>
          <input
            v-model="motivoEncerrar"
            minlength="5"
            maxlength="200"
            required
            data-testid="encerrar-motivo"
          />
          <small>{{ t('identidade.comum.motivoAjuda') }}</small>
        </label>
        <label class="campo">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="encerrar-senha"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="encerrar-confirmar"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoEncerrar = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.form {
  gap: var(--sgh-espaco-2);
  max-width: 32rem;
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
input:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
