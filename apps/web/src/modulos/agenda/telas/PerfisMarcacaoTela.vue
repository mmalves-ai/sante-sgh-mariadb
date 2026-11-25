<script setup lang="ts">
// 02-AGE linha 46: perfis de marcação. Uma tela só: a lista de perfis, a edição do perfil com os recortes (o que o
// grupo marca, por convênio, especialidade, setor, agenda, profissional e unidade, com exceções) e os usuários com a
// vigência. A validação é a do domínio, na hora (código, descrição, recorte repetido, vigência invertida); o servidor
// confere de novo e aplica o perfil na marcação. Quem não tem perfil segue marcando pelo escopo do cargo.
import { type RecortePerfil, validarPerfil, validarRecortes, validarVigencia } from '@sgh/dominio-agenda';
import { SanteBotao, SanteCampoTexto, SanteChave, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { novaChave } from '../api-agenda.js';
import {
  definirUsuarioPerfil,
  DIMENSOES,
  type Dimensao,
  type EntradaPerfil,
  lerOpcoesRecorte,
  lerPerfisMarcacao,
  type PerfilMarcacao,
  salvarPerfilMarcacao,
  TIPOS,
} from '../api-perfis-marcacao.js';
import { buscarUsuarios } from '../api-usuarios-agenda.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr } from '../formato.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeEditar = computed(() => podePermissao('agenda.cobertura.editar'));
const perfis = useQuery({ queryKey: ['agenda-perfis-marcacao'], queryFn: lerPerfisMarcacao });
const opcoes = useQuery({
  queryKey: ['agenda-perfis-marcacao-opcoes'],
  queryFn: lerOpcoesRecorte,
  enabled: podeEditar,
});
const erro = ref<unknown>(null);
const mensagem = ref('');

// ── Edição do perfil ────────────────────────────────────────────────────────────────────────────────
const editando = ref<number | null | 'novo'>(null);
/** Versão do perfil quando a edição abriu: vai na gravação (conflito com outro gestor vira 409). */
const versaoLida = ref<number | null>(null);
const form = reactive<EntradaPerfil & { recortes: (RecortePerfil & { nome: string })[] }>({
  codigo: '',
  descricao: '',
  tipoPerfil: 'geral',
  permiteEncaixe: false,
  ativo: true,
  recortes: [],
});
const perfilAtual = computed<PerfilMarcacao | null>(
  () => perfis.data.value?.find((p) => p.id === editando.value) ?? null,
);
function abrir(p: PerfilMarcacao | null) {
  erro.value = null;
  mensagem.value = '';
  editando.value = p ? p.id : 'novo';
  versaoLida.value = p?.versao ?? null;
  form.codigo = p?.codigo ?? '';
  form.descricao = p?.descricao ?? '';
  form.tipoPerfil = (p?.tipoPerfil as EntradaPerfil['tipoPerfil']) ?? 'geral';
  form.permiteEncaixe = p?.permiteEncaixe ?? false;
  form.ativo = p?.ativo ?? true;
  form.recortes = (p?.recortes ?? []).map((r) => ({ ...r }));
}
const recusaPerfil = computed(() =>
  editando.value === null ? null : (validarPerfil(form) ?? validarRecortes(form.recortes)),
);

const novaDimensao = ref<string>('fonte_pagadora');
const novoAlvo = ref('');
const novaRegra = ref('permitido');
watch(novaDimensao, () => (novoAlvo.value = ''));
const opcoesDimensao = DIMENSOES.map((d) => ({ valor: d, rotulo: t(`perfisMarcacao.dimensoes.${d}`) }));
const opcoesRegra = computed(() => [
  { valor: 'permitido', rotulo: t('perfisMarcacao.permitido') },
  { valor: 'excecao', rotulo: t('perfisMarcacao.excecao') },
]);
const opcoesTipo = computed(() => TIPOS.map((x) => ({ valor: x, rotulo: t(`perfisMarcacao.tipos.${x}`) })));
const opcoesAlvo = computed(() => {
  const d = novaDimensao.value as Dimensao;
  const ja = new Set(form.recortes.filter((r) => r.dimensao === d).map((r) => r.alvo));
  return [
    { valor: '', rotulo: '—' },
    ...(opcoes.data.value?.[d] ?? [])
      .filter((o) => !ja.has(o.id))
      .map((o) => ({ valor: String(o.id), rotulo: o.nome })),
  ];
});
function incluirRecorte() {
  const d = novaDimensao.value as Dimensao;
  const alvo = Number(novoAlvo.value);
  const nome = opcoes.data.value?.[d].find((o) => o.id === alvo)?.nome ?? `#${alvo}`;
  form.recortes.push({ dimensao: d, alvo, permitido: novaRegra.value === 'permitido', nome });
  novoAlvo.value = '';
}
const retirarRecorte = (i: number) => form.recortes.splice(i, 1);

async function gravarPerfil() {
  if (recusaPerfil.value) return;
  erro.value = null;
  try {
    const r = await salvarPerfilMarcacao(
      editando.value === 'novo' ? null : (editando.value as number),
      {
        ...(editando.value !== 'novo' && versaoLida.value !== null ? { versao: versaoLida.value } : {}),
        codigo: form.codigo.trim(),
        descricao: form.descricao.trim(),
        tipoPerfil: form.tipoPerfil,
        permiteEncaixe: form.permiteEncaixe,
        ativo: form.ativo,
        recortes: form.recortes.map(({ dimensao, alvo, permitido }) => ({ dimensao, alvo, permitido })),
      },
      novaChave('perfil-marcacao'),
    );
    await qc.invalidateQueries({ queryKey: ['agenda-perfis-marcacao'] });
    // Reabre pelo que o banco devolveu: a versão nova passa a ser a lida.
    const gravado = perfis.data.value?.find((p) => p.id === r.resultado['perfil']);
    if (gravado) abrir(gravado);
    else editando.value = r.resultado['perfil'] ?? null;
    mensagem.value = r.mensagem ?? '';
  } catch (e) {
    erro.value = e;
  }
}

// ── Usuários do perfil ──────────────────────────────────────────────────────────────────────────────
const termo = ref('');
const escolhido = ref('');
const vigenciaInicio = ref<string | null>(null);
const vigenciaFim = ref<string | null>(null);
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
const opcoesUsuario = computed(() => {
  const ja = new Set((perfilAtual.value?.usuarios ?? []).map((u) => u.usuario));
  return [
    { valor: '', rotulo: '—' },
    ...candidatos.value
      .filter((c) => !ja.has(c.usuario))
      .map((c) => ({ valor: String(c.usuario), rotulo: `${c.nome} (${c.login})` })),
  ];
});
const recusaVigencia = computed(() => validarVigencia(vigenciaInicio.value, vigenciaFim.value));

async function mudarUsuario(m: Parameters<typeof definirUsuarioPerfil>[1]) {
  if (!perfilAtual.value) return;
  erro.value = null;
  try {
    const r = await definirUsuarioPerfil(perfilAtual.value.id, m, novaChave('perfil-usuario'));
    mensagem.value = r.mensagem ?? '';
    if (m.acao === 'incluir') {
      escolhido.value = '';
      termo.value = '';
      vigenciaInicio.value = null;
      vigenciaFim.value = null;
    }
    await qc.invalidateQueries({ queryKey: ['agenda-perfis-marcacao'] });
  } catch (e) {
    erro.value = e;
  }
}
const incluirUsuario = () =>
  escolhido.value &&
  !recusaVigencia.value &&
  mudarUsuario({
    acao: 'incluir',
    usuario: Number(escolhido.value),
    vigenciaInicio: vigenciaInicio.value,
    vigenciaFim: vigenciaFim.value,
  });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="perfis-marcacao-titulo" data-testid="perfis-marcacao">
    <h1 id="perfis-marcacao-titulo">{{ t('perfisMarcacao.titulo') }}</h1>
    <p>{{ t('perfisMarcacao.explicacao') }}</p>
    <p v-if="perfis.isPending.value">{{ t('perfisMarcacao.carregando') }}</p>
    <template v-else-if="perfis.data.value">
      <p v-if="perfis.data.value.length === 0" data-testid="perfis-marcacao-vazio">
        {{ t('perfisMarcacao.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="perfis-marcacao-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('perfisMarcacao.codigo') }}</th>
            <th scope="col">{{ t('perfisMarcacao.descricao') }}</th>
            <th scope="col">{{ t('perfisMarcacao.recortes') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in perfis.data.value" :key="p.id">
            <td>
              {{ p.codigo }}<span v-if="!p.ativo"> ({{ t('perfisMarcacao.inativo') }})</span>
            </td>
            <td>{{ p.descricao }}</td>
            <td>
              {{
                p.recortes.length === 0
                  ? t('perfisMarcacao.semRecorte')
                  : p.recortes
                      .map(
                        (r) =>
                          `${r.permitido ? '' : '≠ '}${t(`perfisMarcacao.dimensoes.${r.dimensao}`)}: ${r.nome}`,
                      )
                      .join('; ')
              }}
              <br />
              {{ t('perfisMarcacao.resumo', { recortes: p.recortes.length, usuarios: p.usuarios.length }) }}
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="podeEditar"
                variante="secundario"
                :rotulo="t('perfisMarcacao.editar', { codigo: p.codigo })"
                @acionar="abrir(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar && editando === null"
        :rotulo="t('perfisMarcacao.novo')"
        data-testid="perfis-marcacao-novo"
        @acionar="abrir(null)"
      />
    </template>

    <section
      v-if="editando !== null"
      class="painel"
      aria-labelledby="perfil-edicao"
      data-testid="perfil-marcacao-edicao"
    >
      <h2 id="perfil-edicao">
        {{
          perfilAtual ? t('perfisMarcacao.editar', { codigo: perfilAtual.codigo }) : t('perfisMarcacao.novo')
        }}
      </h2>
      <form class="filtros" @submit.prevent="gravarPerfil">
        <SanteCampoTexto
          v-model="form.codigo"
          :rotulo="t('perfisMarcacao.codigo')"
          :max-bytes="30"
          obrigatorio
          data-testid="perfil-codigo"
        />
        <SanteCampoTexto
          v-model="form.descricao"
          :rotulo="t('perfisMarcacao.descricao')"
          :max-bytes="150"
          obrigatorio
          data-testid="perfil-descricao"
        />
        <SanteSelecao
          id="perfil-tipo"
          v-model="form.tipoPerfil"
          :rotulo="t('perfisMarcacao.tipo')"
          :opcoes="opcoesTipo"
        />
        <SanteChave
          :ligada="form.permiteEncaixe"
          :rotulo="t('perfisMarcacao.permiteEncaixe')"
          @alternar="(v: boolean) => (form.permiteEncaixe = v)"
        />
        <SanteChave
          :ligada="form.ativo"
          :rotulo="t('perfisMarcacao.ativo')"
          @alternar="(v: boolean) => (form.ativo = v)"
        />
      </form>

      <h3>{{ t('perfisMarcacao.recortes') }}</h3>
      <p v-if="form.recortes.length === 0">{{ t('perfisMarcacao.semRecorte') }}</p>
      <table v-else class="tabela" data-testid="perfil-recortes">
        <thead>
          <tr>
            <th scope="col">{{ t('perfisMarcacao.dimensao') }}</th>
            <th scope="col">{{ t('perfisMarcacao.item') }}</th>
            <th scope="col">{{ t('perfisMarcacao.regra') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in form.recortes" :key="`${r.dimensao}:${r.alvo}`">
            <td>{{ t(`perfisMarcacao.dimensoes.${r.dimensao}`) }}</td>
            <td>{{ r.nome }}</td>
            <td>{{ r.permitido ? t('perfisMarcacao.permitido') : t('perfisMarcacao.excecao') }}</td>
            <td class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('perfisMarcacao.retirarRecorte', { nome: r.nome })"
                @acionar="retirarRecorte(i)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div class="filtros">
        <SanteSelecao
          id="perfil-dimensao"
          v-model="novaDimensao"
          :rotulo="t('perfisMarcacao.dimensao')"
          :opcoes="opcoesDimensao"
        />
        <SanteSelecao
          id="perfil-alvo"
          v-model="novoAlvo"
          :rotulo="t('perfisMarcacao.item')"
          :opcoes="opcoesAlvo"
        />
        <SanteSelecao
          id="perfil-regra"
          v-model="novaRegra"
          :rotulo="t('perfisMarcacao.regra')"
          :opcoes="opcoesRegra"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('perfisMarcacao.incluirRecorte')"
          :desabilitado="!novoAlvo"
          data-testid="perfil-incluir-recorte"
          @acionar="incluirRecorte"
        />
      </div>
      <p v-if="recusaPerfil" role="alert" data-testid="perfil-recusa">{{ recusaPerfil.mensagem }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('perfisMarcacao.gravar')"
          :desabilitado="!!recusaPerfil"
          data-testid="perfil-gravar"
          @acionar="gravarPerfil"
        />
        <SanteBotao variante="secundario" :rotulo="t('perfisMarcacao.cancelar')" @acionar="editando = null" />
      </div>

      <template v-if="perfilAtual">
        <h3>{{ t('perfisMarcacao.usuarios') }}</h3>
        <p v-if="perfilAtual.usuarios.length === 0">{{ t('perfisMarcacao.semUsuarios') }}</p>
        <table v-else class="tabela" data-testid="perfil-usuarios">
          <thead>
            <tr>
              <th scope="col">{{ t('perfisMarcacao.escolher') }}</th>
              <th scope="col">{{ t('perfisMarcacao.vigencia') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in perfilAtual.usuarios" :key="u.usuario">
              <td>{{ u.nome }} ({{ u.login }})</td>
              <td>
                {{
                  t('perfisMarcacao.periodo', {
                    de: u.vigenciaInicio ? dataBr(u.vigenciaInicio) : t('perfisMarcacao.semInicio'),
                    ate: u.vigenciaFim ? dataBr(u.vigenciaFim) : t('perfisMarcacao.sempre'),
                  })
                }}
              </td>
              <td class="acoes">
                <SanteBotao
                  variante="destrutivo"
                  :rotulo="t('perfisMarcacao.retirarUsuario', { nome: u.nome })"
                  :confirmacao="t('perfisMarcacao.retirarPergunta', { nome: u.nome })"
                  @acionar="mudarUsuario({ acao: 'remover', usuario: u.usuario })"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form class="filtros" @submit.prevent="incluirUsuario">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('perfisMarcacao.buscar')"
            :max-bytes="60"
            data-testid="perfil-busca-usuario"
          />
          <SanteSelecao
            id="perfil-usuario"
            v-model="escolhido"
            :rotulo="t('perfisMarcacao.escolher')"
            :opcoes="opcoesUsuario"
          />
          <SanteData v-model="vigenciaInicio" :rotulo="t('perfisMarcacao.vigenciaInicio')" editavel />
          <SanteData v-model="vigenciaFim" :rotulo="t('perfisMarcacao.vigenciaFim')" editavel />
          <SanteBotao
            tipo="submit"
            :rotulo="t('perfisMarcacao.incluirUsuario')"
            :desabilitado="!escolhido || !!recusaVigencia"
            data-testid="perfil-incluir-usuario"
          />
        </form>
        <p v-if="recusaVigencia" role="alert">{{ recusaVigencia.mensagem }}</p>
      </template>
    </section>
    <p v-if="mensagem" role="status" data-testid="perfis-marcacao-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro || perfis.error.value" :erro="erro ?? perfis.error.value" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
